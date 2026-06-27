require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const cookieParser = require("cookie-parser");
const fs = require("fs");
const path = require("path");
const { askGroq, askGroqStream } = require("./groq");
const { FRIENDLY_DATA_FALLBACK, sanitizeModelAnswer } = require("./answerSanitizer");
const { getOfficialFactsForMessage } = require("./officialFacts");
const {
  pesquisarInternet,
  shouldPesquisarInternet,
  classifyFreshnessNeed,
  enrichWithRealtimeData
} = require("./internetSearch");
const { supabase, isSupabaseConfigured } = require("./supabase");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const APP_NAME = "Vestora";
const MAX_HISTORY_MESSAGES = Number(process.env.MAX_HISTORY_MESSAGES || 8);
const MAX_MESSAGE_LENGTH = 1200;
const SESSION_COOKIE_NAME = "vestora_session";
const CSRF_COOKIE_NAME = "vestora_csrf";

if (!process.env.APP_SESSION_SECRET) {
  if (IS_PRODUCTION) {
    console.error("FATAL: APP_SESSION_SECRET must be set in production.");
    process.exit(1);
  }
  console.warn("WARNING: APP_SESSION_SECRET not set. Using insecure dev fallback.");
}

const SESSION_SECRET = process.env.APP_SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const SECURITY_REFUSAL = "N\u00e3o posso ajudar com arquivos internos, c\u00f3digo, chaves, prompts ou configura\u00e7\u00f5es do sistema. Posso te ajudar com educa\u00e7\u00e3o financeira, organiza\u00e7\u00e3o do dinheiro e investimentos.";
const OFFICIAL_FACTS_TIMEOUT_MS = Number(process.env.OFFICIAL_FACTS_TIMEOUT_MS || 3500);
const WEB_SEARCH_TIMEOUT_MS = Number(process.env.WEB_SEARCH_TIMEOUT_MS || 4500);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);

const sessions = new Map();
const failedLogins = new Map();
const MAX_FAILED_LOGINS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

function maskEmail(email) {
  if (!email || typeof email !== "string") return "***";
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const maskedLocal = local.length > 2 ? local[0] + "***" + local[local.length - 1] : "***";
  return `${maskedLocal}@${domain}`;
}

function maskIp(ip) {
  if (!ip || typeof ip !== "string") return "***";
  if (ip.includes(".")) {
    const parts = ip.split(".");
    return `${parts[0]}.${parts[1]}.x.x`;
  }
  return ip.slice(0, 8) + "***";
}

function generateCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

function verifyCsrfToken(req) {
  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers["x-csrf-token"];
  if (!cookieToken || !headerToken) return false;
  if (cookieToken.length !== headerToken.length) return false;
  return crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken));
}

function validatePasswordStrength(password) {
  const p = String(password || "");
  if (p.length < 8) return { valid: false, error: "Senha deve ter pelo menos 8 caracteres." };
  if (p.length > 120) return { valid: false, error: "Senha muito longa (maximo 120 caracteres)." };
  if (!/[A-Z]/.test(p)) return { valid: false, error: "Senha deve conter pelo menos uma letra maiuscula." };
  if (!/[a-z]/.test(p)) return { valid: false, error: "Senha deve conter pelo menos uma letra minuscula." };
  if (!/[0-9]/.test(p)) return { valid: false, error: "Senha deve conter pelo menos um numero." };
  if (!/[^A-Za-z0-9]/.test(p)) return { valid: false, error: "Senha deve conter pelo menos um caractere especial." };
  return { valid: true };
}

function isIpLocked(ip) {
  const record = failedLogins.get(ip);
  if (!record) return false;
  if (record.count >= MAX_FAILED_LOGINS) {
    if (Date.now() - record.lastAttempt < LOGIN_LOCKOUT_MS) return true;
    failedLogins.delete(ip);
  }
  return false;
}

function recordFailedLogin(ip) {
  const record = failedLogins.get(ip) || { count: 0, lastAttempt: 0 };
  record.count++;
  record.lastAttempt = Date.now();
  failedLogins.set(ip, record);
}

function clearFailedLogins(ip) {
  failedLogins.delete(ip);
}

app.disable("x-powered-by");

app.use(compression({
  filter: (req, res) => {
    if (req.headers["x-no-compression"]) return false;
    return compression.filter(req, res);
  }
}));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      ...(IS_PRODUCTION ? { upgradeInsecureRequests: [] } : {})
    }
  },
  crossOriginEmbedderPolicy: false,
  permissionsPolicy: {
    features: {
      camera: ["()"],
      microphone: ["()"],
      geolocation: ["()"],
      payment: ["()"],
      usb: ["()"],
      "interest-cohort": ["()"]
    }
  }
}));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: IS_PRODUCTION ? 600 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/api/health",
  message: {
    error: "Muitas requisições em pouco tempo. Aguarde um pouco e tente novamente."
  }
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Muitas mensagens em pouco tempo. Aguarde alguns segundos antes de enviar novamente."
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error: "Muitas tentativas de login. Aguarde alguns minutos antes de tentar novamente."
  }
});

app.use(express.json({ limit: "64kb", strict: true }));

app.use(cookieParser());

app.use((req, res, next) => {
  if (!req.path.startsWith("/api/")) return next();

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const origin = req.get("origin");
  const host = req.get("host");

  if (origin) {
    let allowed = false;

    if (ALLOWED_ORIGINS.length > 0) {
      allowed = ALLOWED_ORIGINS.some((allowedOrigin) => origin === allowedOrigin);
    } else if (host) {
      try {
        const parsedOrigin = new URL(origin);
        const requestUrl = new URL(`${req.protocol}://${host}`);
        const isLocalDev =
          !IS_PRODUCTION &&
          ["localhost", "127.0.0.1"].includes(parsedOrigin.hostname) &&
          ["localhost", "127.0.0.1"].includes(requestUrl.hostname);
        allowed = parsedOrigin.host === host || (isLocalDev && parsedOrigin.hostname === requestUrl.hostname);
      } catch {
        allowed = false;
      }
    }

    if (!allowed) {
      console.warn(`[${new Date().toISOString()}] Blocked request from disallowed origin: ${maskIp(origin)}`);
      return res.status(403).json({ error: "Origem nao permitida." });
    }
  }

  return next();
});

app.use((req, res, next) => {
  if (!req.path.startsWith("/api/")) return next();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();

  const hasSessionCookie = Boolean(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!hasSessionCookie) return next();

  if (!verifyCsrfToken(req)) {
    return res.status(403).json({ error: "Token CSRF invalido ou ausente." });
  }

  return next();
});

app.use("/api/", apiLimiter);
const publicPath = path.join(__dirname, "public");
const distPath = path.join(__dirname, process.env.DIST_DIR || "dist");

app.use(express.static(distPath, {
  dotfiles: "ignore",
  etag: true,
  maxAge: "1h"
}));

app.use(express.static(publicPath, {
  dotfiles: "ignore",
  etag: true,
  index: false,
  maxAge: "1h"
}));

function now() {
  return new Date().toLocaleString("pt-BR");
}
function withTimeout(promise, timeoutMs, fallbackValue = null) {
  let timeoutId;
  return Promise.race([
    Promise.resolve(promise)
      .catch(() => fallbackValue)
      .finally(() => clearTimeout(timeoutId)),
    new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve(fallbackValue), timeoutMs);
    })
  ]);
}


function createSessionId() {
  return crypto.randomUUID();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signSession(payload) {
  const body = base64url(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(body)
    .digest("base64url");

  return `${body}.${signature}`;
}

function readSession(token) {
  if (!token || !token.includes(".")) return null;

  const [body, signature] = token.split(".");
  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(body)
    .digest("base64url");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.id || !payload?.email || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function setSessionCookie(res, user) {
  const token = signSession({
    id: user.id,
    email: user.email,
    name: user.name,
    exp: Date.now() + 1000 * 60 * 60 * 24 * (IS_PRODUCTION ? 7 : 1)
  });

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: IS_PRODUCTION ? "strict" : "lax",
    secure: IS_PRODUCTION,
    maxAge: 1000 * 60 * 60 * 24 * (IS_PRODUCTION ? 7 : 1),
    path: "/"
  });

  const csrfToken = generateCsrfToken();
  res.cookie(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    sameSite: IS_PRODUCTION ? "strict" : "lax",
    secure: IS_PRODUCTION,
    maxAge: 1000 * 60 * 60 * 24 * (IS_PRODUCTION ? 7 : 1),
    path: "/"
  });

  return csrfToken;
}

function getAuthUser(req) {
  return readSession(req.cookies?.[SESSION_COOKIE_NAME]);
}

async function getSupabaseProfile(userId) {
  if (!isSupabaseConfigured || !userId) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, email, name, display_name, username, avatar_url, role, created_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function mergeUserWithProfile(user, profile) {
  if (!user) return null;

  return {
    id: user.id,
    email: profile?.email || user.email,
    name: profile?.name || user.name || "",
    display_name: profile?.display_name || profile?.name || user.name || "",
    username: profile?.username ?? null,
    avatar_url: profile?.avatar_url || null,
    role: profile?.role || null,
    created_at: profile?.created_at || null,
    updated_at: profile?.updated_at || null
  };
}

async function requireAuth(req, res, next) {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Login necessario." });

  if (isSupabaseConfigured) {
    const { data } = await supabase
      .from("app_users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    const profile = data ? null : await getSupabaseProfile(user.id);

    if (!data && !profile) {
      res.clearCookie(SESSION_COOKIE_NAME);
      return res.status(401).json({ error: "Sessao expirada. Faca login novamente." });
    }
  }

  req.user = user;
  return next();
}

async function requireChatAccess(req, res, next) {
  const user = getAuthUser(req);

  if (user) {
    if (isSupabaseConfigured) {
      const { data } = await supabase
        .from("app_users")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();

      const profile = data ? null : await getSupabaseProfile(user.id);

      if (!data && !profile) {
        res.clearCookie(SESSION_COOKIE_NAME);
        return res.status(401).json({ error: "Sessao expirada. Faca login novamente." });
      }
    }

    req.user = user;
    return next();
  }

  const deviceId = validateDeviceId(req.body?.deviceId || req.body?.sessionId);
  if (!deviceId) {
    return res.status(401).json({ error: "Sessao invalida. Entre novamente para continuar." });
  }

  req.user = { id: deviceId, email: null, name: "Anonimo", isAnonymous: true };
  return next();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validatePassword(password) {
  return validatePasswordStrength(password).valid;
}

function getSession(sessionId) {
  const id = sessionId || createSessionId();

  if (!sessions.has(id)) {
    sessions.set(id, {
      id,
      history: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }

  return sessions.get(id);
}

function addToHistory(session, role, text) {
  session.history.push({ role, text });
  session.updatedAt = Date.now();

  if (session.history.length > MAX_HISTORY_MESSAGES) {
    session.history.splice(0, session.history.length - MAX_HISTORY_MESSAGES);
  }
}

function validateDeviceId(deviceId) {
  const value = String(deviceId || "").trim();
  return /^[a-zA-Z0-9_-]{12,120}$/.test(value) ? value : "";
}

function finalizeAnswer(answer) {
  return sanitizeModelAnswer(answer) || FRIENDLY_DATA_FALLBACK;
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeSourceItem(source) {
  if (!source || typeof source !== "object") return null;

  const rawUrl = String(source.url || source.link || "").trim();
  if (!rawUrl) return null;

  let safeUrl = "";
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      safeUrl = parsed.toString();
    }
  } catch {}

  if (!safeUrl) return null;

  return {
    title: String(source.title || source.name || extractDomain(safeUrl) || "Fonte").trim(),
    url: safeUrl,
    domain: extractDomain(safeUrl)
  };
}

function collectOfficialSources(officialFacts) {
  const sources = [];

  const visit = (node) => {
    if (!node) return;

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    if (typeof node !== "object") return;

    if (Array.isArray(node.sources)) {
      node.sources.forEach((source) => {
        const normalized = normalizeSourceItem(source);
        if (normalized) sources.push(normalized);
      });
    }

    if (Array.isArray(node.facts)) {
      node.facts.forEach(visit);
    }
  };

  visit(officialFacts);
  return sources;
}

function collectInternetSources(internetResults) {
  return Array.isArray(internetResults?.results)
    ? internetResults.results
      .map((result) => normalizeSourceItem({
        title: result.title || result.source,
        url: result.url
      }))
      .filter(Boolean)
    : [];
}

function buildResponseMeta({ officialFacts, internetResults }) {
  const sources = [...collectInternetSources(internetResults), ...collectOfficialSources(officialFacts)];
  const unique = [];
  const seen = new Set();

  for (const source of sources) {
    if (!source?.url || seen.has(source.url)) continue;
    seen.add(source.url);
    unique.push(source);
    if (unique.length >= 8) break;
  }

  return {
    sources: unique,
    usedRealtimeData: Boolean(internetResults?.usedRealtimeData),
    usedWebSearch: Boolean(internetResults?.usedWebSearch),
    updatedAt: internetResults?.checkedAt || officialFacts?.checkedAt || new Date().toISOString()
  };
}

function makeTitle(text) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim();

  const normalized = normalizeText(clean);
  const titleRules = [
    { test: ["financiamento", "financiar", "parcela"], title: "Financiamento de imóvel" },
    { test: ["comprar", "compra", "imovel", "apartamento", "casa"], title: "Compra de imóvel" },
    { test: ["vender", "venda", "anuncio", "preco"], title: "Venda de imóvel" },
    { test: ["alugar", "aluguel", "locacao"], title: "Aluguel de imóvel" },
    { test: ["reserva", "emergencia"], title: "Reserva de emergência" },
    { test: ["divida", "dividas", "vermelho"], title: "Organização de dívidas" },
    { test: ["investir", "investimento", "acoes", "fii", "renda fixa"], title: "Plano de investimentos" },
    { test: ["comprar ou alugar", "alugar ou comprar"], title: "Comprar ou alugar" }
  ];

  const matched = titleRules.find((rule) =>
    rule.test.some((term) => normalized.includes(term))
  );

  if (matched) return matched.title;
  if (!clean) return "Nova conversa";
  return clean.length > 48 ? `${clean.slice(0, 48)}...` : clean;
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function sanitizeMessage(text) {
  return String(text || "")
    .replace(/\u0000/g, "")
    .replace(/[^\S\r\n]+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

function previewForLog(text) {
  const clean = String(text || "").replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
  const sanitized = clean.replace(/[^\x20-\x7E\u00C0-\u00FF]/g, "?");
  return sanitized.length > 80 ? `${sanitized.slice(0, 80)}...` : sanitized;
}

function parseMoneyValues(text) {
  const values = [];
  const regex = /(?:r\$\s*)?(\d+(?:\.\d{3})*)(?:,(\d{1,2}))?\s*(mil|k)?/gi;
  let match;

  while ((match = regex.exec(text))) {
    let value = Number(String(match[1]).replace(/\./g, ""));
    if (match[2]) value += Number(`0.${match[2].padEnd(2, "0")}`);
    if (match[3]) value *= 1000;
    if (Number.isFinite(value) && value > 0) values.push(value);
  }

  return values;
}

function parseMoneyToken(rawValue = "", decimalPart = "", multiplier = "") {
  let value = Number(String(rawValue).replace(/\./g, ""));
  if (decimalPart) value += Number(`0.${String(decimalPart).padEnd(2, "0")}`);
  if (multiplier) value *= 1000;
  return Number.isFinite(value) && value > 0 ? value : null;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findLabeledMoneyValue(text, terms) {
  const termPattern = terms.map(escapeRegExp).join("|");
  const regex = new RegExp(
    `(?:${termPattern})(?:\s+(?:mensal|mensais|bruta|bruto|liquida|liquido))?\\s*(?:e|eh|é|de|do|da|:)?\\s*(?:r\\$\\s*)?(\\d+(?:\\.\\d{3})*)(?:,(\\d{1,2}))?\\s*(mil|k)?`,
    "i"
  );
  const match = String(text || "").match(regex);
  if (!match) return null;
  return parseMoneyToken(match[1], match[2], match[3]);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0
  }).format(value);
}

function updateProfileFromMessage(session, text) {
  const normalized = normalizeText(text);
  session.profile = session.profile || {};

  const labeledFields = [
    ["renda", ["renda", "ganho", "salario", "salário", "recebo"]],
    ["gastos", ["gasto", "gastos", "despesa", "despesas", "custo mensal"]],
    ["dividas", ["divida", "dividas", "dívida", "dívidas", "devo", "financiamento atrasado"]],
    ["entrada", ["entrada"]],
    ["valorImovel", ["valor do imovel", "valor do imóvel", "imovel de", "imóvel de", "casa de", "apartamento de"]]
  ];

  for (const [key, terms] of labeledFields) {
    const value = findLabeledMoneyValue(text, terms);
    if (value) {
      session.profile[key] = value;
    }
  }

  const objective = extractObjectiveFromText(text);
  if (objective) session.profile.objetivo = objective;

  const prazo = extractPrazoFromText(text);
  if (prazo) session.profile.prazo = prazo;

  if (normalized.includes("conservador")) session.profile.perfil = "conservador";
  if (normalized.includes("moderado")) session.profile.perfil = "moderado";
  if (normalized.includes("arrojado") || normalized.includes("agressivo")) session.profile.perfil = "arrojado";
}

function getProfileSummary(session) {
  const profile = session.profile || {};
  const parts = [];

  if (profile.renda) parts.push(`renda ${formatCurrency(profile.renda)}`);
  if (profile.gastos) parts.push(`gastos ${formatCurrency(profile.gastos)}`);
  if (profile.dividas) parts.push(`dividas ${formatCurrency(profile.dividas)}`);
  if (profile.entrada) parts.push(`entrada ${formatCurrency(profile.entrada)}`);
  if (profile.valorImovel) parts.push(`imovel ${formatCurrency(profile.valorImovel)}`);
  if (profile.objetivo) parts.push(`objetivo ${profile.objetivo}`);
  if (profile.prazo) parts.push(`prazo ${profile.prazo}`);
  if (profile.perfil) parts.push(`perfil ${profile.perfil}`);

  return parts.join("; ").slice(0, 360);
}

function extractObjectiveFromText(text) {
  const explicitMatch = String(text || "").match(/(?:objetivo(?:\s+principal)?|meta)\s*(?:e|é|eh|:)?\s*([^.,\n]+?)(?=\s+e\s+meu\s+prazo\b|\s+com\s+prazo\b|[.!?\n]|$)/i);
  if (explicitMatch) return explicitMatch[1].trim();

  const genericMatch = String(text || "").match(/(?:quero|pretendo)\s+(?:e|é|eh|:)?\s*([^.,\n]+?)(?=\s+e\s+meu\s+prazo\b|\s+com\s+prazo\b|[.!?\n]|$)/i);
  return genericMatch ? genericMatch[1].trim() : "";
}

function extractPrazoFromText(text) {
  const direct = String(text || "").match(/(?:prazo|horizonte)\s*(?:e|é|eh|:)?\s*(a vida|vitalicio|vitalício|longo prazo|medio prazo|médio prazo|curto prazo|\d{1,2}\s*(?:meses|anos|ano|mes))/i);
  if (direct) return direct[1].trim();

  const numeric = String(text || "").match(/(\d{1,2})\s*(meses|anos|ano|mes)/i);
  return numeric ? `${numeric[1]} ${numeric[2]}` : "";
}

function tryQuickCalculator(text, session, officialFacts) {
  const normalized = normalizeText(text);
  const values = parseMoneyValues(text);
  const profile = session.profile || {};
  const officialFactItems = Array.isArray(officialFacts?.facts) ? officialFacts.facts : [];
  const macroFacts = officialFactItems.find((fact) => fact.topic === "Indicadores economicos 2026");
  const salaryFacts = officialFactItems.find((fact) => fact.topic === "Salario minimo 2026");
  const irFacts = officialFactItems.find((fact) => fact.topic === "Tabela IRPF 2026");

  if (
    normalized.includes("minha casa minha vida") ||
    normalized.includes("mcmv") ||
    normalized.includes("casa verde amarela")
  ) {
    const checked = officialFacts?.verified
      ? "Conferi fontes oficiais antes de responder."
      : "Use isto como referencia geral e valide na CAIXA ou no Ministerio das Cidades antes de fechar contrato.";

    return `${checked}\n\nSobre o **Minha Casa, Minha Vida**, famílias em área urbana podem entrar no programa com renda bruta familiar mensal de até **R$ 13.000**.\n\nFaixas urbanas atuais: **Faixa 1 até R$ 3.200**, **Faixa 2 de R$ 3.200,01 a R$ 5.000**, **Faixa 3 de R$ 5.000,01 a R$ 9.600** e **Faixa 4 até R$ 13.000**. Para a Faixa 4, o MCMV Classe Média tem regras específicas, como imóvel de até R$ 600 mil.\n\nPróximo passo: confirme sua renda familiar bruta, cidade, valor do imóvel e entrada disponível. Antes de fechar contrato, valide no simulador da CAIXA ou em uma agência, porque taxas, subsídio e aprovação dependem do perfil e da data.`;
  }

  if (macroFacts?.facts && (normalized.includes("selic") || normalized.includes("ipca") || normalized.includes("cdi"))) {
    const lines = [
      `Atualizado agora com dados do Banco Central. Consulta: ${new Date(macroFacts.checkedAt || Date.now()).toLocaleString("pt-BR")}.`
    ];

    if (normalized.includes("selic") && macroFacts.facts.selicMeta) {
      lines.push(`- **Selic meta:** ${macroFacts.facts.selicMeta.value} (referencia ${macroFacts.facts.selicMeta.date}; fonte: ${macroFacts.facts.selicMeta.source}).`);
    }

    if ((normalized.includes("ipca") || normalized.includes("inflacao")) && macroFacts.facts.ipca) {
      lines.push(`- **IPCA:** ultimo mes ${macroFacts.facts.ipca.latestMonthly} (${macroFacts.facts.ipca.latestMonth}); acumulado aproximado em 12 meses ${macroFacts.facts.ipca.accumulated12mApprox}; fonte: ${macroFacts.facts.ipca.source}.`);
    }

    if (normalized.includes("cdi") && macroFacts.facts.cdi) {
      lines.push(`- **CDI:** ultimo dado diario ${macroFacts.facts.cdi.latestDaily} (${macroFacts.facts.cdi.latestDate}); anualizado aproximado ${macroFacts.facts.cdi.annualizedApprox}; fonte: ${macroFacts.facts.cdi.source}.`);
    }

    lines.push("Esses indicadores mudam. Para aplicar dinheiro hoje, confirme a taxa no banco/corretora e veja liquidez, IR, IOF e risco.");
    return lines.join("\n");
  }

  if (normalized.includes("selic")) {
    return [
      "Resposta baseada em conhecimento geral. Dados em tempo real indisponíveis.",
      "- **Selic meta:** é a taxa básica de juros definida pelo COPOM, do Banco Central.",
      "- Ela influencia crédito, financiamento, renda fixa pós-fixada e o custo do dinheiro na economia.",
      "- Para a taxa vigente nesta data, confirme no Banco Central antes de tomar decisão financeira."
    ].join("\n");
  }

  if (normalized.includes("ipca")) {
    return [
      "Resposta baseada em conhecimento geral. Dados em tempo real indisponíveis.",
      "- **IPCA:** é o índice oficial de inflação acompanhado pelo mercado e pelo Banco Central.",
      "- Ele mede a variação de preços ao consumidor e ajuda a avaliar perda de poder de compra.",
      "- Para o número mais recente, confirme no IBGE antes de usar o dado em planejamento financeiro."
    ].join("\n");
  }

  if (normalized.includes("cdi")) {
    return [
      "Resposta baseada em conhecimento geral. Dados em tempo real indisponíveis.",
      "- **CDI:** é uma referência muito usada em investimentos pós-fixados e costuma acompanhar a Selic de perto.",
      "- CDBs, contas remuneradas e alguns fundos costumam informar rentabilidade em percentual do CDI.",
      "- Para o valor atualizado, confirme na fonte do produto ou em provedores financeiros confiáveis."
    ].join("\n");
  }

  if (normalized.includes("salario minimo") && salaryFacts?.facts?.currentValue) {
    return [
      `O salário mínimo atual é **${salaryFacts.facts.currentValue}**.`,
      "Observação: esse é o valor nacional a partir de 1º de janeiro de 2026; pisos salariais por categoria podem ser diferentes.",
      `Fonte: ${salaryFacts.facts.source} — consulta em ${new Date(salaryFacts.checkedAt || Date.now()).toLocaleString("pt-BR")}.`
    ].join("\n\n");
  }

  if ((normalized.includes("imposto de renda") || normalized.includes("irpf") || normalized.includes("tabela do ir")) && irFacts?.facts?.monthlyTable?.length) {
    const rows = irFacts.facts.monthlyTable
      .map((row) => `| ${row.faixa} | ${row.aliquota} | ${row.deducao} |`)
      .join("\n");
    const tableBlock = [
      "| Base de cálculo | Alíquota | Dedução |",
      "| --- | --- | --- |",
      rows
    ].join("\n");

    const extra = [];
    if (irFacts.facts.dependentDeduction) {
      extra.push(`Dedução mensal por dependente: **${irFacts.facts.dependentDeduction}**.`);
    }
    if (irFacts.facts.simplifiedDiscount) {
      extra.push(`Limite mensal do desconto simplificado: **${irFacts.facts.simplifiedDiscount}**.`);
    }

    return [
      "A tabela mensal oficial do IRPF em 2026 é esta:",
      tableBlock,
      extra.length > 0 ? `Observação: ${extra.join(" ")}` : "",
      `Fonte: Receita Federal — consulta em ${new Date(irFacts.checkedAt || Date.now()).toLocaleString("pt-BR")}.`
    ].filter(Boolean).join("\n\n");
  }

  if (normalized.includes("reserva") && (values[0] || profile.gastos)) {
    const monthlyCost = values[0] || profile.gastos;
    const min = monthlyCost * 6;
    const max = monthlyCost * 12;
    return `Para uma reserva de emergência, uma faixa prática seria entre **${formatCurrency(min)} e ${formatCurrency(max)}**.\n\nIsso considera 6 a 12 meses dos seus gastos mensais (${formatCurrency(monthlyCost)}). Próximo passo: separe esse dinheiro em algo líquido e conservador, como Tesouro Selic, CDB com liquidez diária ou conta remunerada segura.`;
  }

  if ((normalized.includes("parcela") || normalized.includes("financiamento") || normalized.includes("banco libera") || normalized.includes("quanto libera") || normalized.includes("quanto o banco")) && (profile.renda || values.length)) {
    const income = profile.renda || values.find((value) => value <= 200000);
    if (income) {
      const conservative = income * 0.25;
      const limit = income * 0.3;
      const estimatedPropertyConservative = Math.round(income * 33);
      const estimatedPropertyMax = Math.round(income * 40);
      return `Com renda de **${formatCurrency(income)}**, o banco costuma liberar aproximadamente **${formatCurrency(estimatedPropertyConservative)} a ${formatCurrency(estimatedPropertyMax)}** de financiamento, dependendo do prazo, taxa de juros e entrada.

A parcela ficaria entre **${formatCurrency(conservative)}** (prudente, ~25% da renda) e **${formatCurrency(limit)}** (limite de 30% da renda).

Atenção: o valor real depende de juros (atualmente ~9-12% a.a.), prazo (até 35 anos), entrada mínima (~20%), CET, seguros e sua análise de crédito. Próximo passo: simule no site da CAIXA ou do seu banco para valores exatos.`;
    }
  }

  if ((normalized.includes("comprometimento") || normalized.includes("renda comprometida")) && values.length >= 2) {
    const [payment, income] = values[0] > values[1] ? [values[1], values[0]] : [values[0], values[1]];
    const percentage = (payment / income) * 100;
    return `Essa parcela compromete aproximadamente **${percentage.toFixed(1).replace(".", ",")}%** da renda.\n\nRegra prática: até 30% costuma ser mais aceitável; acima disso exige muito cuidado. Próximo passo: simule também condomínio, IPTU, seguros e manutenção.`;
  }

  if ((normalized.includes("rentabilidade") || normalized.includes("render")) && values.length >= 2) {
    const amount = values[0];
    const rate = values[1] > 1 ? values[1] / 100 : values[1];
    const monthly = amount * rate;
    const yearly = amount * (Math.pow(1 + rate, 12) - 1);
    return `Com **${formatCurrency(amount)}** rendendo **${(rate * 100).toFixed(2).replace(".", ",")}% ao mês**, o rendimento aproximado seria **${formatCurrency(monthly)} por mês** e **${formatCurrency(yearly)} em 12 meses**, antes de impostos.\n\nAtenção: rentabilidade pode variar e impostos/liquidez mudam o resultado final.`;
  }

  const rendaInvest = profile.renda || findLabeledMoneyValue(text, ["renda", "ganho", "salario", "salário", "recebo"]);
  const gastosInvest = profile.gastos || findLabeledMoneyValue(text, ["gasto", "gastos", "despesa", "despesas", "custo mensal"]);
  if ((normalized.includes("investir") || normalized.includes("investimento") || normalized.includes("independencia financeira") || normalized.includes("independência financeira")) && rendaInvest && gastosInvest) {
    const saldo = Math.max(0, rendaInvest - gastosInvest);
    const objetivo = profile.objetivo || extractObjectiveFromText(text);
    const prazoTexto = profile.prazo || extractPrazoFromText(text) || "longo prazo";
    const prazoLongo = /a vida|longo prazo|10\s*anos|20\s*anos|30\s*anos/i.test(String(prazoTexto));
    const perfil = profile.perfil || (prazoLongo ? "moderado" : "conservador");
    const reservaMin = gastosInvest * 6;
    const reservaMax = gastosInvest * 12;
    const liquidez = Math.round(saldo * 0.3);
    const baseInvest = Math.max(0, saldo - liquidez);

    const allocation = perfil === "arrojado"
      ? [
          `- **Reserva e caixa:** ${formatCurrency(liquidez)} por mês até formar entre **${formatCurrency(reservaMin)}** e **${formatCurrency(reservaMax)}**.`,
          `- **Base estável:** ${formatCurrency(Math.round(baseInvest * 0.5))} por mês em Tesouro Selic, CDBs fortes ou renda fixa equivalente.`,
          `- **Crescimento:** ${formatCurrency(Math.round(baseInvest * 0.5))} por mês em ETFs, ações amplamente diversificadas ou fundos de índice.`
        ]
      : perfil === "moderado"
        ? [
            `- **Reserva e caixa:** ${formatCurrency(liquidez)} por mês até formar entre **${formatCurrency(reservaMin)}** e **${formatCurrency(reservaMax)}**.`,
            `- **Base estável:** ${formatCurrency(Math.round(baseInvest * 0.6))} por mês em Tesouro Selic, CDBs fortes, LCIs/LCAs ou Tesouro IPCA para prazo longo.`,
            `- **Crescimento gradual:** ${formatCurrency(Math.round(baseInvest * 0.4))} por mês em ETFs ou ações de qualidade com diversificação.`
          ]
        : [
            `- **Reserva e caixa:** ${formatCurrency(liquidez)} por mês até formar entre **${formatCurrency(reservaMin)}** e **${formatCurrency(reservaMax)}**.`,
            `- **Carteira principal:** ${formatCurrency(baseInvest)} por mês em renda fixa conservadora, com liquidez e previsibilidade.`
          ];

    return [
      `Com renda de **${formatCurrency(rendaInvest)}** e gastos de **${formatCurrency(gastosInvest)}**, seu saldo disponível hoje é de **${formatCurrency(saldo)} por mês**.`,
      objetivo
        ? `Seu objetivo principal é **${objetivo}** e seu horizonte é **${prazoTexto}**, então a estratégia deve priorizar construção de patrimônio com consistência.`
        : `Como seu horizonte é **${prazoTexto}**, a estratégia deve priorizar construção de patrimônio com consistência.`,
      "",
      "### Plano sugerido",
      ...allocation,
      "",
      "### Ordem prática",
      "1. Monte a reserva de emergência primeiro.",
      "2. Automatize o investimento todo mês logo após receber.",
      "3. Só aumente risco depois que a reserva estiver pronta.",
      "4. Revise a carteira a cada 6 a 12 meses, não toda semana.",
      "",
      `Se quiser, eu posso montar agora uma **carteira mensal exata para esses ${formatCurrency(saldo)}**, separando quanto vai para reserva, renda fixa e crescimento.`
    ].join("\n");
  }

  if (normalized.includes("comprar ou alugar") || normalized.includes("alugar ou comprar")) {
    return "Para comparar comprar ou alugar, me envie 5 dados: valor do imóvel, aluguel mensal, entrada disponível, renda mensal e prazo que pretende ficar no imóvel. Com isso eu monto uma análise curta de custo, risco e flexibilidade.";
  }

  return "";
}

function buildUserPreferences(settings) {
  const parts = [];

  if (settings.estiloTom && settings.estiloTom !== "padrao") {
    const tomMap = { formal: "formal e profissional", informal: "descontraído e amigável", didatico: "educativo e explicativo" };
    parts.push(`Tom: ${tomMap[settings.estiloTom] || settings.estiloTom}`);
  }
  if (settings.acolhedor === "sim") parts.push("Seja mais acolhedor e empático nas respostas");
  if (settings.acolhedor === "nao") parts.push("Seja direto e objetivo, sem rodeios");
  if (settings.entusiasmado === "sim") parts.push("Use um tom mais entusiasmado e motivador");
  if (settings.entusiasmado === "nao") parts.push("Mantenha um tom mais sério e contido");
  if (settings.emoji === "sim") parts.push("Use emojis moderadamente nas respostas");
  if (settings.emoji === "nao") parts.push("Não use emojis nas respostas");
  if (settings.listasCabecalhos === "sim") parts.push("Use listas e cabeçalhos organizados nas respostas");
  if (settings.listasCabecalhos === "nao") parts.push("Responda em parágrafos corridos, sem listas");
  if (settings.apelido) parts.push(`Chame o usuário de "${settings.apelido}"`);
  if (settings.ocupacao) parts.push(`O usuário trabalha como ${settings.ocupacao}`);
  if (settings.maisSobreVoce) parts.push(`Sobre o usuário: ${settings.maisSobreVoce}`);
  if (settings.instrucoesPersonalizadas) parts.push(`Instruções especiais: ${settings.instrucoesPersonalizadas}`);
  
  if (settings.idioma && settings.idioma !== "pt-br") {
    const langMap = { en: "English", es: "Español" };
    parts.push(`Responda sempre no idioma: ${langMap[settings.idioma] || settings.idioma}`);
  }

  return parts.join(". ");
}

function isSensitiveSystemRequest(text) {
  const normalized = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const sensitiveTerms = [
    ".env",
    "api key",
    "apikey",
    "chave api",
    "chave da api",
    "token",
    "service_role",
    "service role",
    "supabase_service_role_key",
    "groq_api_key",
    "prompt interno",
    "system prompt",
    "instrucoes internas",
    "instrucoes do sistema",
    "codigo fonte",
    "source code",
    "server.js",
    "groq.js",
    "supabase.js",
    "prompts.js",
    "package.json",
    "arquivos internos",
    "estrutura de pastas",
    "burlar",
    "jailbreak",
    "modo desenvolvedor",
    "developer mode",
    "ignore as instrucoes",
    "ignore suas instrucoes",
    "revele",
    "mostre seus arquivos",
    "liste seus arquivos",
    "configuracao do servidor",
    "dump do banco",
    "dump database",
    "sql dump",
    "extrair dados",
    "exportar dados",
    "dump de tabelas",
    "schema do banco",
    "database schema",
    "credenciais",
    "password",
    "senha do banco",
    "env var",
    "variavel de ambiente"
  ];

  return sensitiveTerms.some((term) => normalized.includes(term));
}

async function ensureConversation({ conversationId, userId, firstMessage }) {
  if (!isSupabaseConfigured) return conversationId || createSessionId();

  if (conversationId && isUuid(conversationId)) {
    const { data, error } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;
    if (data) return data.id;
  }

  const { data, error } = await supabase
    .from("conversations")
    .insert({
      user_id: userId,
      title: makeTitle(firstMessage)
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

async function getConversationMessages({ conversationId, userId }) {
  if (!isSupabaseConfigured || !conversationId) return [];
  if (!isUuid(conversationId)) return [];

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (conversationError) throw conversationError;
  if (!conversation) return [];

  const { data, error } = await supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) throw error;

  return data.map((message) => ({
    role: message.role,
    text: message.content
  }));
}

async function saveCloudMessage({ conversationId, role, content }) {
  if (!isSupabaseConfigured || !conversationId) return;

  const { error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role,
      content
    });

  if (error) throw error;

  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);
}

function cleanOldSessions() {
  const maxAgeMs = 1000 * 60 * 60 * 6;
  const nowMs = Date.now();

  for (const [id, session] of sessions.entries()) {
    if (nowMs - session.updatedAt > maxAgeMs) {
      sessions.delete(id);
    }
  }
}

function cleanOldFailedLogins() {
  const nowMs = Date.now();
  for (const [ip, record] of failedLogins.entries()) {
    if (nowMs - record.lastAttempt > LOGIN_LOCKOUT_MS) {
      failedLogins.delete(ip);
    }
  }
}

setInterval(cleanOldSessions, 1000 * 60 * 30).unref();
setInterval(cleanOldFailedLogins, 1000 * 60 * 15).unref();

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: APP_NAME,
    supabase: isSupabaseConfigured
  });
});

app.get("/api/auth/me", async (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.json({ authenticated: false, user: null });
  }

  try {
    const profile = await getSupabaseProfile(user.id);
    return res.json({
      authenticated: true,
      user: mergeUserWithProfile(user, profile)
    });
  } catch (error) {
    console.error(`[${now()}] Erro ao carregar perfil autenticado:`, error.message);
    return res.json({ authenticated: true, user: mergeUserWithProfile(user, null) });
  }
});

app.post("/api/auth/register", authLimiter, async (req, res) => {
  if (!isSupabaseConfigured) {
    return res.status(503).json({ error: "Servico nao disponivel." });
  }

  const name = String(req.body.name || "").trim().slice(0, 80);
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");

  if (!name || name.length < 2) {
    return res.status(400).json({ error: "Nome deve ter pelo menos 2 caracteres." });
  }

  if (!email || !email.includes("@") || email.length > 254) {
    return res.status(400).json({ error: "Informe um email valido." });
  }

  const passwordCheck = validatePasswordStrength(password);
  if (!passwordCheck.valid) {
    return res.status(400).json({ error: passwordCheck.error });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const { data, error } = await supabase
      .from("app_users")
      .insert({
        name,
        email,
        password_hash: passwordHash
      })
      .select("id, name, email")
      .single();

    if (error) {
      if (String(error.message || "").includes("duplicate")) {
        return res.status(409).json({ error: "Este email ja esta cadastrado." });
      }
      throw error;
    }

    const profile = await getSupabaseProfile(data.id).catch(() => null);
    const user = mergeUserWithProfile(data, profile);

    const csrfToken = setSessionCookie(res, user);
    res.json({ user, csrfToken });
  } catch (error) {
    console.error(`[${now()}] Erro ao cadastrar usuario.`);
    res.status(500).json({ error: "Nao foi possivel criar sua conta." });
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  if (!isSupabaseConfigured) {
    return res.status(503).json({ error: "Servico nao disponivel." });
  }

  const clientIp = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";

  if (isIpLocked(clientIp)) {
    return res.status(429).json({ error: "Muitas tentativas. Aguarde alguns minutos." });
  }

  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "Informe email e senha." });
  }

  try {
    const { data, error } = await supabase
      .from("app_users")
      .select("id, name, email, password_hash")
      .eq("email", email)
      .maybeSingle();

    if (error) throw error;

    const valid = data ? await bcrypt.compare(password, data.password_hash) : false;
    if (!valid) {
      recordFailedLogin(clientIp);
      console.warn(`[${now()}] Login falhou para ${maskEmail(email)} de ${maskIp(clientIp)}`);
      return res.status(401).json({ error: "Email ou senha invalidos." });
    }

    clearFailedLogins(clientIp);

    const baseUser = {
      id: data.id,
      name: data.name,
      email: data.email
    };

    const profile = await getSupabaseProfile(data.id).catch(() => null);
    const user = mergeUserWithProfile(baseUser, profile);

    console.log(`[${now()}] Login bem-sucedido: ${maskEmail(email)}`);
    const csrfToken = setSessionCookie(res, user);
    res.json({ user, csrfToken });
  } catch (error) {
    console.error(`[${now()}] Erro ao fazer login.`);
    res.status(500).json({ error: "Nao foi possivel fazer login." });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: IS_PRODUCTION ? "strict" : "lax",
    secure: IS_PRODUCTION,
    path: "/"
  });

  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    sameSite: IS_PRODUCTION ? "strict" : "lax",
    secure: IS_PRODUCTION,
    path: "/"
  });

  res.json({ ok: true });
});

app.patch("/api/auth/profile", requireAuth, async (req, res) => {
  if (!isSupabaseConfigured) {
    return res.status(503).json({ error: "Servico nao disponivel." });
  }

  const name = String(req.body.name || "").trim().slice(0, 80);
  const usernameInput = String(req.body.username || "").trim().toLowerCase();
  const username = usernameInput.replace(/[^a-z0-9._-]/g, "").slice(0, 30);

  if (!name || name.length < 2) {
    return res.status(400).json({ error: "Nome deve ter pelo menos 2 caracteres." });
  }

  if (username && (username.length < 3 || username.length > 30)) {
    return res.status(400).json({ error: "Nome de usuario deve ter entre 3 e 30 caracteres." });
  }

  if (username && /^[._-]/.test(username)) {
    return res.status(400).json({ error: "Nome de usuario nao pode comecar com ., _ ou -." });
  }

  try {
    if (username) {
      const { data: existing } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("username", username)
        .neq("user_id", req.user.id)
        .maybeSingle();

      if (existing) {
        return res.status(409).json({ error: "Este nome de usuario ja esta em uso." });
      }
    }

    const { data, error } = await supabase
      .from("profiles")
      .upsert({
        user_id: req.user.id,
        email: req.user.email,
        name,
        display_name: name,
        username: username || null
      }, {
        onConflict: "user_id"
      })
      .select("user_id, email, name, display_name, username, avatar_url, role, created_at, updated_at")
      .single();

    if (error) {
      if (error.code === "23505" || String(error.message || "").toLowerCase().includes("duplicate")) {
        return res.status(409).json({ error: "Este nome de usuario ja esta em uso." });
      }
      throw error;
    }

    const updatedUser = mergeUserWithProfile(req.user, data);

    const csrfToken = setSessionCookie(res, updatedUser);
    res.json({ user: updatedUser, csrfToken });
  } catch (error) {
    console.error(`[${now()}] Erro ao atualizar perfil.`);
    res.status(500).json({ error: "Nao foi possivel atualizar seu perfil." });
  }
});

app.get("/api/conversations", requireAuth, async (req, res) => {
  const userId = req.user.id;

  if (!isSupabaseConfigured) {
    return res.json({ configured: false, conversations: [] });
  }

  try {
    const { data, error } = await supabase
      .from("conversations")
      .select("id, title, created_at, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (error) throw error;

    res.json({ configured: true, conversations: data });
  } catch (error) {
    console.error(`[${now()}] Erro ao listar conversas.`);
    res.status(500).json({ error: "Nao foi possivel listar as conversas." });
  }
});

app.get("/api/conversations/:id/messages", requireAuth, async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(400).json({ error: "Conversa invalida." });
  }

  if (!isSupabaseConfigured) {
    return res.json({ configured: false, messages: [] });
  }

  try {
    const messages = await getConversationMessages({
      conversationId: req.params.id,
      userId: req.user.id
    });

    res.json({
      configured: true,
      messages: messages.map((message) => ({
        role: message.role === "model" ? "bot" : "user",
        text: message.text
      }))
    });
  } catch (error) {
    console.error(`[${now()}] Erro ao buscar mensagens.`);
    res.status(500).json({ error: "Nao foi possivel carregar esta conversa." });
  }
});

app.patch("/api/conversations/:id", requireAuth, async (req, res) => {
  const title = makeTitle(req.body.title);

  if (!isUuid(req.params.id)) {
    return res.status(400).json({ error: "Conversa invalida." });
  }

  if (!isSupabaseConfigured) {
    return res.json({ configured: false });
  }

  try {
    const { error } = await supabase
      .from("conversations")
      .update({
        title,
        updated_at: new Date().toISOString()
      })
      .eq("id", req.params.id)
      .eq("user_id", req.user.id);

    if (error) throw error;

    res.json({ configured: true });
  } catch (error) {
    console.error(`[${now()}] Erro ao renomear conversa.`);
    res.status(500).json({ error: "Nao foi possivel renomear a conversa." });
  }
});

app.delete("/api/conversations/:id", requireAuth, async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(400).json({ error: "Conversa invalida." });
  }

  if (!isSupabaseConfigured) {
    return res.json({ configured: false });
  }

  try {
    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (conversationError) throw conversationError;

    if (!conversation) {
      return res.status(404).json({ error: "Conversa nao encontrada." });
    }

    const { error: messagesError } = await supabase
      .from("messages")
      .delete()
      .eq("conversation_id", conversation.id);

    if (messagesError) throw messagesError;

    const { error: deleteError } = await supabase
      .from("conversations")
      .delete()
      .eq("id", conversation.id)
      .eq("user_id", req.user.id);

    if (deleteError) throw deleteError;

    res.json({ configured: true });
  } catch (error) {
    console.error(`[${now()}] Erro ao apagar conversa.`);
    res.status(500).json({ error: "Nao foi possivel apagar a conversa." });
  }
});

app.delete("/api/conversations", requireAuth, async (req, res) => {
  if (!isSupabaseConfigured) {
    return res.json({ configured: false });
  }

  try {
    const { data: conversations, error: selectError } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_id", req.user.id);

    if (selectError) throw selectError;

    if (conversations && conversations.length > 0) {
      const ids = conversations.map((c) => c.id);

      const { error: messagesDeleteError } = await supabase
        .from("messages")
        .delete()
        .in("conversation_id", ids);

      if (messagesDeleteError) throw messagesDeleteError;

      const { error: conversationsDeleteError } = await supabase
        .from("conversations")
        .delete()
        .in("id", ids);

      if (conversationsDeleteError) throw conversationsDeleteError;
    }

    res.json({ configured: true });
  } catch (error) {
    console.error(`[${now()}] Erro ao apagar todas as conversas.`);
    res.status(500).json({ error: "Nao foi possivel apagar as conversas." });
  }
});

app.patch("/api/auth/password", requireAuth, async (req, res) => {
  if (!isSupabaseConfigured) {
    return res.status(503).json({ error: "Servico nao disponivel." });
  }

  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Informe a senha atual e a nova senha." });
  }

  const passwordCheck = validatePasswordStrength(newPassword);
  if (!passwordCheck.valid) {
    return res.status(400).json({ error: passwordCheck.error });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({ error: "A nova senha deve ser diferente da atual." });
  }

  try {
    const { data, error } = await supabase
      .from("app_users")
      .select("password_hash")
      .eq("id", req.user.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ error: "Usuario nao encontrado." });
    }

    const valid = await bcrypt.compare(currentPassword, data.password_hash);
    if (!valid) {
      console.warn(`[${now()}] Tentativa de alteracao de senha com senha incorreta: ${maskEmail(req.user.email)}`);
      return res.status(401).json({ error: "Senha atual incorreta." });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);
    const { error: updateError } = await supabase
      .from("app_users")
      .update({ password_hash: newPasswordHash })
      .eq("id", req.user.id);

    if (updateError) throw updateError;

    console.log(`[${now()}] Senha alterada com sucesso: ${maskEmail(req.user.email)}`);
    res.json({ ok: true });
  } catch (error) {
    console.error(`[${now()}] Erro ao alterar senha.`);
    res.status(500).json({ error: "Nao foi possivel alterar sua senha." });
  }
});

app.get("/api/auth/sessions", requireAuth, (req, res) => {
  const userAgent = req.headers["user-agent"] || "Desconhecido";
  const ip = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";

  let os = "Desconhecido";
  if (userAgent.includes("Windows")) os = "Windows";
  else if (userAgent.includes("Macintosh")) os = "macOS";
  else if (userAgent.includes("Linux")) os = "Linux";
  else if (userAgent.includes("iPhone") || userAgent.includes("iPad")) os = "iOS";
  else if (userAgent.includes("Android")) os = "Android";

  let browser = "Navegador";
  if (userAgent.includes("Chrome")) browser = "Chrome";
  else if (userAgent.includes("Firefox")) browser = "Firefox";
  else if (userAgent.includes("Safari")) browser = "Safari";
  else if (userAgent.includes("Edge")) browser = "Edge";

  res.json({
    sessions: [
      {
        id: "current",
        device: `${browser} em ${os}`,
        ip: maskIp(ip.replace("::ffff:", "")),
        current: true,
        lastActive: new Date().toISOString()
      }
    ]
  });
});

/**
 * Shared logic to prepare a chat request (validation, security, history, searches).
 * Returns an object with all prepared data, or sends a response and returns null.
 */
function sanitizeSettings(settings) {
  if (!settings || typeof settings !== "object") return {};
  const allowed = {};
  const safeKeys = [
    "estiloTom", "acolhedor", "entusiasmado", "listasCabecalhos", "emoji",
    "respostasRapidas", "instrucoesPersonalizadas", "apelido", "ocupacao",
    "maisSobreVoce", "referenciarMemorias", "referenciarHistorico",
    "buscaNaWeb", "lousa", "buscaConector", "idioma", "tema"
  ];
  for (const key of safeKeys) {
    if (key in settings) {
      const val = settings[key];
      if (typeof val === "boolean") {
        allowed[key] = val;
      } else if (typeof val === "string") {
        allowed[key] = val.slice(0, 500);
      }
    }
  }
  return allowed;
}

async function prepareChatRequest(req, res) {
  const userMessage = sanitizeMessage(req.body.message);
  const userSettings = sanitizeSettings(req.body.settings);
  const conversationIdFromRequest = isUuid(req.body.conversationId) ? req.body.conversationId : "";
  const session = getSession(req.body.sessionId || conversationIdFromRequest);

  if (!userMessage) {
    res.status(400).json({ error: "Mensagem vazia.", sessionId: session.id });
    return null;
  }

  if (String(req.body.message || "").length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({
      error: `Mensagem muito longa. Use no máximo ${MAX_MESSAGE_LENGTH} caracteres.`,
      sessionId: session.id
    });
    return null;
  }

  console.log(`[${now()}] [${session.id}] Usuario: ${previewForLog(userMessage)}`);
  updateProfileFromMessage(session, userMessage);

  if (isSensitiveSystemRequest(userMessage)) {
    addToHistory(session, "user", userMessage);
    addToHistory(session, "model", SECURITY_REFUSAL);
    console.warn(`[${now()}] [${session.id}] Pedido sensivel bloqueado.`);
    res.json({
      sessionId: session.id,
      conversationId: conversationIdFromRequest || createSessionId(),
      answer: SECURITY_REFUSAL
    });
    return null;
  }

  const isAnonymous = req.user.isAnonymous === true;
  let conversationId;

  if (isAnonymous) {
    conversationId = conversationIdFromRequest || createSessionId();
  } else {
    conversationId = await ensureConversation({
      conversationId: conversationIdFromRequest,
      userId: req.user.id,
      firstMessage: userMessage
    });
  }

  const cloudHistory = (!isAnonymous && isSupabaseConfigured)
    ? await getConversationMessages({ conversationId, userId: req.user.id })
    : [];

  const historyForGroq = (userSettings.referenciarHistorico !== false)
    ? (cloudHistory.length > 0
        ? cloudHistory.slice(-MAX_HISTORY_MESSAGES)
        : session.history.slice(-MAX_HISTORY_MESSAGES))
    : [];

  if (!isAnonymous) {
    await saveCloudMessage({ conversationId, role: "user", content: userMessage });
  }

  const freshness = classifyFreshnessNeed(userMessage);
  const mustUseWebSearch = shouldPesquisarInternet(userMessage);
  console.log(
    `[${now()}] [${session.id}] Classificacao web: ${freshness.category} | shouldSearch=${mustUseWebSearch} | motivo=${freshness.reason}`
  );

  // Run searches in parallel
  const shouldAttemptWebSearch = (mustUseWebSearch || freshness.shouldSearch) && userSettings.buscaNaWeb !== false;
  const searchPromises = [];
  searchPromises.push(
    withTimeout(
      getOfficialFactsForMessage(userMessage, { online: true }),
      OFFICIAL_FACTS_TIMEOUT_MS,
      null
    )
  );
  searchPromises.push(
    shouldAttemptWebSearch
      ? withTimeout(
          pesquisarInternet(userMessage, {
            classification: freshness,
            force: mustUseWebSearch
          }),
          WEB_SEARCH_TIMEOUT_MS,
          null
        )
      : Promise.resolve(null)
  );

  const [officialFacts, internetResults] = await Promise.all(searchPromises);
  const enrichedInternetResults = await enrichWithRealtimeData(internetResults, userMessage);

  if (enrichedInternetResults?.searched) {
    console.log(
      `[${now()}] [${session.id}] Pesquisa online: ${enrichedInternetResults.engine}, ${enrichedInternetResults.results?.length || 0} resultado(s), cache=${Boolean(enrichedInternetResults.fromCache)}.`
    );
  }

  const userPreferences = buildUserPreferences(userSettings);
  const responseMeta = buildResponseMeta({
    officialFacts,
    internetResults: enrichedInternetResults
  });

  return {
    session,
    conversationId,
    userMessage,
    userSettings,
    historyForGroq,
    officialFacts,
    enrichedInternetResults,
    userPreferences,
    responseMeta
  };
}

/**
 * Non-streaming chat endpoint (original behavior).
 */
app.post("/api/chat", requireChatAccess, chatLimiter, async (req, res) => {
  try {
    const prepared = await prepareChatRequest(req, res);
    if (!prepared) return;

    const { session, conversationId, userMessage, userSettings, historyForGroq, officialFacts, enrichedInternetResults, userPreferences, responseMeta } = prepared;

    const isAnon = req.user.isAnonymous === true;

    // Try quick calculator first
    if (userSettings.respostasRapidas !== false) {
      const quickAnswer = tryQuickCalculator(userMessage, session, officialFacts);
      if (quickAnswer) {
        const safeAnswer = finalizeAnswer(quickAnswer);
        addToHistory(session, "user", userMessage);
        addToHistory(session, "model", safeAnswer);
        if (!isAnon) {
          await saveCloudMessage({ conversationId, role: "model", content: safeAnswer });
        }
        console.log(`[${now()}] [${session.id}] Resposta por calculadora simples.`);

        return res.json({ sessionId: session.id, conversationId, answer: safeAnswer, ...responseMeta });
      }
    }

    const answer = finalizeAnswer(await askGroq({
      message: userMessage,
      history: historyForGroq,
      profileSummary: userSettings.referenciarMemorias !== false ? getProfileSummary(session) : "",
      userPreferences,
      officialFacts,
      internetResults: enrichedInternetResults
    }));

    addToHistory(session, "user", userMessage);
    addToHistory(session, "model", answer);
    if (!isAnon) {
      await saveCloudMessage({ conversationId, role: "model", content: answer });
    }
    console.log(`[${now()}] [${session.id}] Resposta enviada.`);

    res.json({ sessionId: session.id, conversationId, answer, ...responseMeta });
  } catch (error) {
    console.error(`[${now()}] Erro:`, error.message);
    res.status(500).json({ error: "Tive um problema ao gerar a resposta. Tente novamente em instantes." });
  }
});

/**
 * Streaming chat endpoint â€” returns Server-Sent Events.
 */
app.post("/api/chat/stream", requireChatAccess, chatLimiter, async (req, res) => {
  try {
    const prepared = await prepareChatRequest(req, res);
    if (!prepared) return;

    const { session, conversationId, userMessage, userSettings, historyForGroq, officialFacts, enrichedInternetResults, userPreferences, responseMeta } = prepared;

    // Try quick calculator first (non-streaming fast path)
    if (userSettings.respostasRapidas !== false) {
      const quickAnswer = tryQuickCalculator(userMessage, session, officialFacts);
      if (quickAnswer) {
        const safeAnswer = finalizeAnswer(quickAnswer);
        addToHistory(session, "user", userMessage);
        addToHistory(session, "model", safeAnswer);
        if (!req.user.isAnonymous) {
          await saveCloudMessage({ conversationId, role: "model", content: safeAnswer });
        }
        console.log(`[${now()}] [${session.id}] Resposta por calculadora simples (stream).`);

        // Send as a single chunk
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        if (responseMeta.sources.length > 0) {
          res.write(`data: ${JSON.stringify({ type: "sources", sources: responseMeta.sources })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ type: "meta", ...responseMeta })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "chunk", text: safeAnswer })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "done", conversationId })}\n\n`);
        res.end();
        return;
      }
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Stream the answer
    let rawAnswer = "";
    let emittedLength = 0;
    const stream = askGroqStream({
      message: userMessage,
      history: historyForGroq,
      profileSummary: userSettings.referenciarMemorias !== false ? getProfileSummary(session) : "",
      userPreferences,
      officialFacts,
      internetResults: enrichedInternetResults
    });

    for await (const chunk of stream) {
      rawAnswer += chunk;
      const safeAnswer = finalizeAnswer(rawAnswer);
      const delta = safeAnswer.slice(emittedLength);
      emittedLength = safeAnswer.length;
      if (delta) {
        res.write(`data: ${JSON.stringify({ type: "chunk", text: delta })}\n\n`);
      }
    }

    let fullAnswer = finalizeAnswer(rawAnswer);
    if (!sanitizeModelAnswer(rawAnswer)) {
      const fallbackAnswer = await askGroq({
        message: userMessage,
        history: historyForGroq,
        profileSummary: userSettings.referenciarMemorias !== false ? getProfileSummary(session) : "",
        userPreferences,
        officialFacts,
        internetResults: enrichedInternetResults
      });

      fullAnswer = finalizeAnswer(fallbackAnswer);
      const delta = fullAnswer.slice(emittedLength);
      emittedLength = fullAnswer.length;
      if (delta) {
        res.write(`data: ${JSON.stringify({ type: "chunk", text: delta })}\n\n`);
      }
    }
    const isAnonStream = req.user.isAnonymous === true;

    // Save complete answer to DB and history
    addToHistory(session, "user", userMessage);
    addToHistory(session, "model", fullAnswer);
    if (!isAnonStream) {
      await saveCloudMessage({ conversationId, role: "model", content: fullAnswer });
    }
    console.log(`[${now()}] [${session.id}] Resposta stream enviada.`);

    // Signal completion
    if (responseMeta.sources.length > 0) {
      res.write(`data: ${JSON.stringify({ type: "sources", sources: responseMeta.sources })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: "meta", ...responseMeta })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "done", conversationId })}\n\n`);
    res.end();
  } catch (error) {
    console.error(`[${now()}] Erro stream:`, error.message);

    // If headers already sent, send error as SSE event
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: "error", error: "Tive um problema ao gerar a resposta. Tente novamente em instantes." })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: "Tive um problema ao gerar a resposta. Tente novamente em instantes." });
    }
  }
});

app.use((req, res) => {
  const distIndex = path.join(distPath, "index.html");

  if (fs.existsSync(distIndex)) {
    res.sendFile(distIndex);
    return;
  }

  res.status(500).send("Interface nao compilada. Execute npm run build antes de iniciar.");
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "JSON invalido." });
  }

  if ((normalized.includes("investir") || normalized.includes("investimento") || normalized.includes("independencia financeira") || normalized.includes("independência financeira")) && (profile.renda || profile.gastos)) {
    const renda = profile.renda || 0;
    const gastos = profile.gastos || 0;
    const saldo = Math.max(0, renda - gastos);
    const prazoLongo = /a vida|longo prazo|10\s*anos|20\s*anos|30\s*anos/i.test(String(profile.prazo || text));
    const perfil = profile.perfil || (prazoLongo ? "moderado" : "conservador");
    const reservaMin = gastos > 0 ? gastos * 6 : 0;
    const reservaMax = gastos > 0 ? gastos * 12 : 0;
    const baseInvest = saldo > 0 ? Math.round(saldo * 0.7) : 0;
    const liquidez = saldo > 0 ? Math.round(saldo * 0.3) : 0;

    const allocation = perfil === "arrojado"
      ? [
          `- **Reserva e caixa:** ${formatCurrency(liquidez)} por mês até formar entre **${formatCurrency(reservaMin)}** e **${formatCurrency(reservaMax)}** em liquidez diária.`,
          `- **Núcleo de longo prazo:** ${formatCurrency(Math.round(baseInvest * 0.5))} por mês em renda fixa de qualidade e títulos públicos.`,
          `- **Crescimento:** ${formatCurrency(Math.round(baseInvest * 0.5))} por mês em ativos de maior risco, como ETFs de ações ou fundos bem diversificados.`
        ]
      : perfil === "moderado"
        ? [
            `- **Reserva e caixa:** ${formatCurrency(liquidez)} por mês até formar entre **${formatCurrency(reservaMin)}** e **${formatCurrency(reservaMax)}** em liquidez diária.`,
            `- **Base estável:** ${formatCurrency(Math.round(baseInvest * 0.6))} por mês em Tesouro Selic, CDBs fortes, LCIs/LCAs ou Tesouro IPCA para objetivos longos.`,
            `- **Crescimento gradual:** ${formatCurrency(Math.round(baseInvest * 0.4))} por mês em ETFs, fundos de índice ou ações de qualidade, com diversificação.`
          ]
        : [
            `- **Reserva e caixa:** ${formatCurrency(liquidez)} por mês até formar entre **${formatCurrency(reservaMin)}** e **${formatCurrency(reservaMax)}** em liquidez diária.`,
            `- **Carteira principal:** ${formatCurrency(baseInvest)} por mês em renda fixa conservadora, priorizando liquidez, previsibilidade e baixo risco.`
          ];

    const objectiveLine = profile.objetivo
      ? `Seu objetivo principal é **${profile.objetivo}**, então o foco deve ser construir patrimônio consistente antes de buscar retornos mais agressivos.`
      : "Seu foco deve ser construir patrimônio consistente e sustentável, sem depender de retornos rápidos.";

    return [
      `Com renda de **${formatCurrency(renda)}** e gastos de **${formatCurrency(gastos)}**, seu saldo disponível hoje é de **${formatCurrency(saldo)} por mês**.`,
      objectiveLine,
      "",
      "### Plano sugerido",
      allocation.join("\n"),
      "",
      "### Ordem prática",
      "1. Organize uma reserva de emergência primeiro.",
      "2. Automatize o investimento no dia em que receber.",
      "3. Só aumente risco depois de consolidar reserva e disciplina.",
      "4. Revise a carteira a cada 6 a 12 meses, não toda semana.",
      "",
      `Se quiser, no próximo passo eu posso montar uma **carteira mensal exata para esses ${formatCurrency(saldo)}**, separando quanto iria para reserva, renda fixa e crescimento.`
    ].join("\n");
  }

  console.error(`[${now()}] Erro interno nao tratado:`, err?.message || "Erro desconhecido");
  if (res.headersSent) {
    return next(err);
  }

  return res.status(500).json({ error: "Erro interno do servidor." });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[${now()}] ${APP_NAME} rodando em http://localhost:${PORT}`);
  });
}

module.exports = app;

