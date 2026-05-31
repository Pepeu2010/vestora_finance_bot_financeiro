require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const cookieParser = require("cookie-parser");
const fs = require("fs");
const path = require("path");
const { askGroq } = require("./groq");
const { getOfficialFactsForMessage } = require("./officialFacts");
const { supabase, isSupabaseConfigured } = require("./supabase");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_NAME = process.env.APP_NAME || "Bot Financeiro";
const MAX_HISTORY_MESSAGES = Number(process.env.MAX_HISTORY_MESSAGES || 8);
const MAX_MESSAGE_LENGTH = 1200;
const SESSION_COOKIE_NAME = "bot_financeiro_session";
const SESSION_SECRET = process.env.APP_SESSION_SECRET || "dev-only-change-this-secret";
const SECURITY_REFUSAL = "Não posso ajudar com arquivos internos, código, chaves, prompts ou configurações do sistema. Posso te ajudar com educação financeira, organização do dinheiro e investimentos.";

// Memoria temporaria por sessao do navegador.
// Sem banco de dados: se o servidor reiniciar, a memoria some.
const sessions = new Map();

app.disable("x-powered-by");

app.use(
  helmet({
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
        formAction: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/api/health",
  message: {
    error: "Muitas requisições em pouco tempo. Aguarde um pouco e tente novamente."
  }
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 18,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Muitas mensagens em pouco tempo. Aguarde alguns segundos antes de enviar novamente."
  }
});

app.use(express.json({ limit: "32kb", strict: true }));
app.use(cookieParser());

app.use((req, res, next) => {
  if (!req.path.startsWith("/api/")) return next();

  res.setHeader("Cache-Control", "no-store");

  const origin = req.get("origin");
  const host = req.get("host");

  if (origin && host) {
    try {
      const parsedOrigin = new URL(origin);
      if (parsedOrigin.host !== host) {
        return res.status(403).json({ error: "Origem não permitida." });
      }
    } catch {
      return res.status(403).json({ error: "Origem inválida." });
    }
  }

  return next();
});

app.use("/api/", apiLimiter);
const publicPath = path.join(__dirname, "public");
const distPath = path.join(__dirname, "dist");

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
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7
  });

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 7
  });
}

function getAuthUser(req) {
  return readSession(req.cookies?.[SESSION_COOKIE_NAME]);
}

function requireAuth(req, res, next) {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Login necessario." });
  req.user = user;
  return next();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validatePassword(password) {
  return String(password || "").length >= 6 && String(password || "").length <= 120;
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
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > 80 ? `${clean.slice(0, 80)}...` : clean;
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

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0
  }).format(value);
}

function updateProfileFromMessage(session, text) {
  const normalized = normalizeText(text);
  const values = parseMoneyValues(text);
  session.profile = session.profile || {};

  const setFirstValue = (key, terms) => {
    if (terms.some((term) => normalized.includes(term)) && values[0]) {
      session.profile[key] = values[0];
    }
  };

  setFirstValue("renda", ["renda", "ganho", "salario", "recebo"]);
  setFirstValue("gastos", ["gasto", "gastos", "despesa", "despesas", "custo mensal"]);
  setFirstValue("dividas", ["divida", "dividas", "devo", "financiamento atrasado"]);
  setFirstValue("entrada", ["entrada"]);
  setFirstValue("valorImovel", ["valor do imovel", "imovel de", "casa de", "apartamento de"]);

  const objectiveMatch = text.match(/(?:objetivo|quero|pretendo)\s+(?:e|é|eh|:)?\s*([^.,\n]{4,80})/i);
  if (objectiveMatch) session.profile.objetivo = objectiveMatch[1].trim();

  const prazoMatch = text.match(/(\d{1,2})\s*(meses|anos|ano|mes)/i);
  if (prazoMatch) session.profile.prazo = `${prazoMatch[1]} ${prazoMatch[2]}`;

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

function tryQuickCalculator(text, session, officialFacts) {
  const normalized = normalizeText(text);
  const values = parseMoneyValues(text);
  const profile = session.profile || {};
  const officialFactItems = Array.isArray(officialFacts?.facts) ? officialFacts.facts : [];
  const macroFacts = officialFactItems.find((fact) => fact.topic === "Indicadores economicos 2026");

  if (
    normalized.includes("minha casa minha vida") ||
    normalized.includes("mcmv") ||
    normalized.includes("casa verde amarela")
  ) {
    const checked = officialFacts?.verified
      ? "Conferi fontes oficiais antes de responder."
      : "Não consegui confirmar online agora, então use isto como referência e valide na CAIXA/Ministério das Cidades.";

    return `${checked}\n\nSobre o **Minha Casa, Minha Vida**, famílias em área urbana podem entrar no programa com renda bruta familiar mensal de até **R$ 13.000**.\n\nFaixas urbanas atuais: **Faixa 1 até R$ 3.200**, **Faixa 2 de R$ 3.200,01 a R$ 5.000**, **Faixa 3 de R$ 5.000,01 a R$ 9.600** e **Faixa 4 até R$ 13.000**. Para a Faixa 4, o MCMV Classe Média tem regras específicas, como imóvel de até R$ 600 mil.\n\nPróximo passo: confirme sua renda familiar bruta, cidade, valor do imóvel e entrada disponível. Antes de fechar contrato, valide no simulador da CAIXA ou em uma agência, porque taxas, subsídio e aprovação dependem do perfil e da data.`;
  }

  if (macroFacts?.facts && (normalized.includes("selic") || normalized.includes("ipca") || normalized.includes("cdi"))) {
    const lines = ["Conferi os dados do Banco Central antes de responder:"];

    if (normalized.includes("selic") && macroFacts.facts.selicMeta) {
      lines.push(`- **Selic meta:** ${macroFacts.facts.selicMeta.value} (referencia ${macroFacts.facts.selicMeta.date}).`);
    }

    if ((normalized.includes("ipca") || normalized.includes("inflacao")) && macroFacts.facts.ipca) {
      lines.push(`- **IPCA:** ultimo mes ${macroFacts.facts.ipca.latestMonthly} (${macroFacts.facts.ipca.latestMonth}); acumulado aproximado em 12 meses ${macroFacts.facts.ipca.accumulated12mApprox}.`);
    }

    if (normalized.includes("cdi") && macroFacts.facts.cdi) {
      lines.push(`- **CDI:** ultimo dado diario ${macroFacts.facts.cdi.latestDaily} (${macroFacts.facts.cdi.latestDate}); anualizado aproximado ${macroFacts.facts.cdi.annualizedApprox}.`);
    }

    lines.push("Esses indicadores mudam. Para aplicar dinheiro hoje, confirme a taxa no banco/corretora e veja liquidez, IR, IOF e risco.");
    return lines.join("\n");
  }

  if (normalized.includes("reserva") && (values[0] || profile.gastos)) {
    const monthlyCost = values[0] || profile.gastos;
    const min = monthlyCost * 6;
    const max = monthlyCost * 12;
    return `Para uma reserva de emergência, uma faixa prática seria entre **${formatCurrency(min)} e ${formatCurrency(max)}**.\n\nIsso considera 6 a 12 meses dos seus gastos mensais (${formatCurrency(monthlyCost)}). Próximo passo: separe esse dinheiro em algo líquido e conservador, como Tesouro Selic, CDB com liquidez diária ou conta remunerada segura.`;
  }

  if ((normalized.includes("parcela") || normalized.includes("financiamento")) && (profile.renda || values.length)) {
    const income = profile.renda || values.find((value) => value <= 100000);
    if (income) {
      const conservative = income * 0.25;
      const limit = income * 0.3;
      return `Como referência, uma parcela imobiliária mais prudente ficaria perto de **${formatCurrency(conservative)}** e o limite comum de 30% da renda seria **${formatCurrency(limit)}**.\n\nAtenção: financiamento envolve juros, seguros, CET e prazo longo. Próximo passo: compare a parcela com seus gastos fixos e mantenha uma reserva antes de assumir o contrato.`;
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

  if (normalized.includes("comprar ou alugar") || normalized.includes("alugar ou comprar")) {
    return "Para comparar comprar ou alugar, me envie 5 dados: valor do imóvel, aluguel mensal, entrada disponível, renda mensal e prazo que pretende ficar no imóvel. Com isso eu monto uma análise curta de custo, risco e flexibilidade.";
  }

  return "";
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
    "configuracao do servidor"
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

setInterval(cleanOldSessions, 1000 * 60 * 30);

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: APP_NAME,
    sessions: sessions.size,
    supabase: isSupabaseConfigured
  });
});

app.get("/api/auth/me", (req, res) => {
  const user = getAuthUser(req);
  res.json({ authenticated: Boolean(user), user });
});

app.post("/api/auth/register", async (req, res) => {
  if (!isSupabaseConfigured) {
    return res.status(503).json({ error: "Supabase nao configurado." });
  }

  const name = String(req.body.name || "").trim().slice(0, 80);
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");

  if (!name || !email.includes("@") || !validatePassword(password)) {
    return res.status(400).json({ error: "Informe nome, email valido e senha com pelo menos 6 caracteres." });
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

    setSessionCookie(res, data);
    res.json({ user: data });
  } catch (error) {
    console.error(`[${now()}] Erro ao cadastrar usuario:`, error.message);
    res.status(500).json({ error: "Nao consegui criar sua conta." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  if (!isSupabaseConfigured) {
    return res.status(503).json({ error: "Supabase nao configurado." });
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
      return res.status(401).json({ error: "Email ou senha invalidos." });
    }

    const user = {
      id: data.id,
      name: data.name,
      email: data.email
    };

    setSessionCookie(res, user);
    res.json({ user });
  } catch (error) {
    console.error(`[${now()}] Erro ao fazer login:`, error.message);
    res.status(500).json({ error: "Nao consegui fazer login." });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: false
  });

  res.json({ ok: true });
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
    console.error(`[${now()}] Erro ao listar conversas:`, error.message);
    res.status(500).json({ error: "Nao consegui listar as conversas." });
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
    console.error(`[${now()}] Erro ao buscar mensagens:`, error.message);
    res.status(500).json({ error: "Nao consegui carregar esta conversa." });
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
    console.error(`[${now()}] Erro ao renomear conversa:`, error.message);
    res.status(500).json({ error: "Nao consegui renomear a conversa." });
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
    console.error(`[${now()}] Erro ao apagar conversa:`, error.message);
    res.status(500).json({ error: "Nao consegui apagar a conversa." });
  }
});

app.post("/api/chat", requireAuth, chatLimiter, async (req, res) => {
  const userMessage = sanitizeMessage(req.body.message);
  const conversationIdFromRequest = isUuid(req.body.conversationId) ? req.body.conversationId : "";
  const webSearchEnabled = req.body.webSearchEnabled !== false;
  const session = getSession(req.body.sessionId || conversationIdFromRequest);

  if (!userMessage) {
    return res.status(400).json({
      error: "Mensagem vazia.",
      sessionId: session.id
    });
  }

  if (String(req.body.message || "").length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({
      error: `Mensagem muito longa. Use no máximo ${MAX_MESSAGE_LENGTH} caracteres.`,
      sessionId: session.id
    });
  }

  console.log(`[${now()}] [${session.id}] Usuario: ${previewForLog(userMessage)}`);
  updateProfileFromMessage(session, userMessage);

  try {
    const conversationId = await ensureConversation({
      conversationId: conversationIdFromRequest,
      userId: req.user.id,
      firstMessage: userMessage
    });

    const cloudHistory = await getConversationMessages({
      conversationId,
      userId: req.user.id
    });

    const historyForGroq = isSupabaseConfigured
      ? cloudHistory.slice(-MAX_HISTORY_MESSAGES)
      : session.history.slice(-MAX_HISTORY_MESSAGES);

    const officialFacts = await getOfficialFactsForMessage(userMessage, {
      online: webSearchEnabled
    }).catch((error) => {
      console.warn(`[${now()}] [${session.id}] Nao consegui buscar fonte oficial:`, error.message);
      return null;
    });

    await saveCloudMessage({
      conversationId,
      role: "user",
      content: userMessage
    });

    if (isSensitiveSystemRequest(userMessage)) {
      addToHistory(session, "user", userMessage);
      addToHistory(session, "model", SECURITY_REFUSAL);

      await saveCloudMessage({
        conversationId,
        role: "model",
        content: SECURITY_REFUSAL
      });

      console.warn(`[${now()}] [${session.id}] Pedido sensivel bloqueado.`);

      return res.json({
        sessionId: session.id,
        conversationId,
        answer: SECURITY_REFUSAL
      });
    }

    const quickAnswer = tryQuickCalculator(userMessage, session, officialFacts);
    if (quickAnswer) {
      addToHistory(session, "user", userMessage);
      addToHistory(session, "model", quickAnswer);

      await saveCloudMessage({
        conversationId,
        role: "model",
        content: quickAnswer
      });

      console.log(`[${now()}] [${session.id}] Resposta por calculadora simples.`);

      return res.json({
        sessionId: session.id,
        conversationId,
        answer: quickAnswer
      });
    }

    const answer = await askGroq({
      message: userMessage,
      history: historyForGroq,
      profileSummary: getProfileSummary(session),
      officialFacts
    });

    addToHistory(session, "user", userMessage);
    addToHistory(session, "model", answer);

    await saveCloudMessage({
      conversationId,
      role: "model",
      content: answer
    });

    console.log(`[${now()}] [${session.id}] Resposta enviada.`);

    res.json({
      sessionId: session.id,
      conversationId,
      answer
    });
  } catch (error) {
    console.error(`[${now()}] [${session.id}] Erro:`, error.message);

    res.status(500).json({
      sessionId: session.id,
      error: "Tive um problema ao gerar a resposta. Tente novamente em instantes."
    });
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

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[${now()}] ${APP_NAME} rodando em http://localhost:${PORT}`);
  });
}

module.exports = app;
