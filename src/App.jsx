import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import {
  ACCEPTED_EXTENSIONS,
  ACCEPTED_FILE_TYPES,
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_ATTACHMENTS,
  DragDropZone,
  FilePreviewList,
  FileUploadButton,
  buildAttachmentDescriptor
} from "./components/file-attachments";

const DEVICE_KEY = "vestora-device-id";
const CONVERSATIONS_KEY = "vestora-conversations";
const CURRENT_CONVERSATION_KEY = "vestora-current-conversation";
const SETTINGS_KEY = "vestora-settings";
const AUTH_TRANSITION_MS = 420;
const CHAT_FALLBACK_MESSAGE = "Tive um problema ao gerar a resposta agora. Tente novamente em instantes.";
const BRAND_ASSET_VERSION = 42;
const FILE_ATTACHMENTS_INPUT_ID = "fileUploadInput";
const MIN_LOADING_FEEDBACK_MS = 250;
const PERSISTED_SETTINGS_KEYS = [
  "estiloTom",
  "acolhedor",
  "entusiasmado",
  "listasCabecalhos",
  "emoji",
  "respostasRapidas",
  "referenciarMemorias",
  "referenciarHistorico",
  "buscaNaWeb",
  "lousa",
  "buscaConector",
  "alertasMercado",
  "resumoDiario",
  "alertasPrecos",
  "noticiasFinanceiras",
  "lembretesMetas",
  "frequenciaResumo",
  "idioma",
  "tema"
];

const QUICK_PROMPTS = [
  {
    label: "Organizar minhas finanças",
    prompt: "Quero organizar minhas finanças pessoais. Quais dados você precisa para me orientar com clareza?"
  },
  {
    label: "Investir melhor",
    prompt: "Quero investir melhor. Minha renda é R$ , gastos R$ , objetivo principal é e meu prazo é ."
  },
  {
    label: "Sair das dívidas",
    prompt: "Quero sair das dívidas. Tenho dívidas de R$ , juros aproximados de ao mês e renda de R$ ."
  },
  {
    label: "Criar reserva de emergência",
    prompt: "Quero criar uma reserva de emergência. Meus gastos mensais são R$ ."
  },
  {
    label: "Cotação do dólar",
    prompt: "Qual é a cotação atual do dólar hoje em reais?"
  },
  {
    label: "Bitcoin hoje",
    prompt: "Qual é a cotação atual do Bitcoin em reais e em dólares?"
  }
];

// Atalhos financeiros de consulta rápida — aparecem embaixo do chat
const SHORTCUT_ACTIONS = [
  {
    id: "salario-minimo",
    icon: "💼",
    label: "Salário mínimo",
    prompt: "Qual é o valor atual do salário mínimo no Brasil em 2026?"
  },
  {
    id: "dolar-hoje",
    icon: "💵",
    label: "Dólar hoje",
    prompt: "Qual é a cotação atual do dólar hoje em reais?"
  },
  {
    id: "selic",
    icon: "📊",
    label: "Taxa Selic",
    prompt: "Qual é a taxa Selic atual definida pelo Banco Central do Brasil?"
  },
  {
    id: "fgts",
    icon: "🏦",
    label: "FGTS",
    prompt: "Como funciona o FGTS? Como posso sacar ou usar meu saldo?"
  },
  {
    id: "ir-tabela",
    icon: "📋",
    label: "Tabela do IR",
    prompt: "Qual é a tabela de faixas do Imposto de Renda em 2026?"
  },
  {
    id: "bitcoin",
    icon: "₿",
    label: "Bitcoin hoje",
    prompt: "Qual é a cotação atual do Bitcoin em reais e em dólares?"
  }
];

const AUTH_BENEFITS = [
  "Investimentos",
  "Patrimônio",
  "Planejamento financeiro",
  "Mercado em tempo real"
];

const AUTH_TRUST_ITEMS = [
  { icon: "🔒", text: "Seus dados protegidos" },
  { icon: "🔐", text: "Autenticação segura" },
  { icon: "📈", text: "Dados financeiros privados" }
];

function loadLocalConversations() {
  try {
    return JSON.parse(localStorage.getItem(CONVERSATIONS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalConversations(conversations) {
  localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
}

function getOrCreateDeviceId() {
  const saved = localStorage.getItem(DEVICE_KEY);
  if (saved) return saved;

  const id = crypto.randomUUID();
  localStorage.setItem(DEVICE_KEY, id);
  return id;
}

function loadLocalSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    const saved = Object.fromEntries(
      PERSISTED_SETTINGS_KEYS
        .filter((key) => Object.prototype.hasOwnProperty.call(raw, key))
        .map((key) => [key, raw[key]])
    );
    return {
      estiloTom: "padrao",
      acolhedor: "padrao",
      entusiasmado: "padrao",
      listasCabecalhos: "padrao",
      emoji: "padrao",
      respostasRapidas: true,
      instrucoesPersonalizadas: "",
      apelido: "",
      ocupacao: "",
      maisSobreVoce: "",
      referenciarMemorias: true,
      referenciarHistorico: true,
      buscaNaWeb: true,
      lousa: true,
      buscaConector: false,
      alertasMercado: true,
      resumoDiario: true,
      alertasPrecos: false,
      noticiasFinanceiras: true,
      lembretesMetas: true,
      frequenciaResumo: "diario",
      idioma: "pt-br",
      tema: "escuro",
      ...saved
    };
  } catch {
    return {
      estiloTom: "padrao",
      acolhedor: "padrao",
      entusiasmado: "padrao",
      listasCabecalhos: "padrao",
      emoji: "padrao",
      respostasRapidas: true,
      instrucoesPersonalizadas: "",
      apelido: "",
      ocupacao: "",
      maisSobreVoce: "",
      referenciarMemorias: true,
      referenciarHistorico: true,
      buscaNaWeb: true,
      lousa: true,
      buscaConector: false,
      alertasMercado: true,
      resumoDiario: true,
      alertasPrecos: false,
      noticiasFinanceiras: true,
      lembretesMetas: true,
      frequenciaResumo: "diario",
      idioma: "pt-br",
      tema: "escuro"
    };
  }
}

function saveLocalSettings(settings) {
  const persisted = Object.fromEntries(
    PERSISTED_SETTINGS_KEYS.map((key) => [key, settings[key]])
  );
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(persisted));
}

function isLocalHost() {
  return typeof window !== "undefined" &&
    ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function formatText(text) {
  return String(text || "").trim();
}

function getDisplayName(user) {
  return user?.display_name || user?.name || user?.email?.split("@")[0] || "Usuário";
}

function getInitials(name) {
  const parts = String(name || "Usuário")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function getFirstName(name) {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)[0] || "Pedro";
}

function normalizeFiles(inputFiles) {
  return Array.from(inputFiles || []);
}

function buildAttachmentFallbackText(nextAttachments) {
  if (!nextAttachments?.length) return "";
  if (nextAttachments.length === 1) {
    return `Analise o arquivo anexado ${nextAttachments[0].name}.`;
  }
  return `Analise os ${nextAttachments.length} arquivos anexados: ${nextAttachments.map((item) => item.name).join(", ")}.`;
}

function serializeAttachmentsForApi(nextAttachments) {
  return nextAttachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    size: attachment.size,
    type: attachment.type,
    extension: attachment.extension,
    category: attachment.category,
    status: attachment.status
  }));
}

function makeTitle(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  const normalized = clean
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const titleRules = [
    { terms: ["financiamento", "financiar", "parcela"], title: "Financiamento de imóvel" },
    { terms: ["comprar", "compra", "imovel", "apartamento", "casa"], title: "Compra de imóvel" },
    { terms: ["vender", "venda", "anuncio", "preco"], title: "Venda de imóvel" },
    { terms: ["alugar", "aluguel", "locacao"], title: "Aluguel de imóvel" },
    { terms: ["reserva", "emergencia"], title: "Reserva de emergência" },
    { terms: ["divida", "dividas", "vermelho"], title: "Organização de dívidas" },
    { terms: ["investir", "investimento", "acoes", "fii", "renda fixa"], title: "Plano de investimentos" },
    { terms: ["dolar", "cotacao do dolar", "cambio"], title: "Dólar hoje" },
    { terms: ["bitcoin", "btc"], title: "Bitcoin hoje" },
    { terms: ["selic"], title: "Taxa Selic" },
    { terms: ["salario minimo"], title: "Salário mínimo" },
    { terms: ["tabela do ir", "irpf", "imposto de renda"], title: "Tabela do IR" },
    { terms: ["fgts"], title: "FGTS" }
  ];

  const matched = titleRules.find((rule) =>
    rule.terms.some((term) => normalized.includes(term))
  );

  if (matched) return matched.title;
  if (!clean) return "Nova conversa";
  return clean.length > 44 ? `${clean.slice(0, 44)}...` : clean;
}

function getConversationTimestamp(conversation) {
  const value = conversation?.updatedAt || conversation?.updated_at || conversation?.createdAt || conversation?.created_at;
  const time = new Date(value || Date.now()).getTime();
  return Number.isFinite(time) ? time : Date.now();
}

function getStartOfDay(time = Date.now()) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function getConversationGroupLabel(conversation, now = Date.now()) {
  const diffDays = Math.floor((getStartOfDay(now) - getStartOfDay(getConversationTimestamp(conversation))) / 86400000);

  if (diffDays <= 0) return "Hoje";
  if (diffDays === 1) return "Ontem";
  if (diffDays <= 7) return "Últimos 7 dias";
  return "Antigas";
}

function getConversationDisplayTitle(conversation) {
  const source = conversation?.title || conversation?.messages?.find((message) => message.role === "user")?.text || "";
  const title = makeTitle(source);
  return title.length > 34 ? `${title.slice(0, 31)}...` : title;
}

function groupConversationsByDate(conversations, now = Date.now()) {
  const order = ["Hoje", "Ontem", "Últimos 7 dias", "Antigas"];
  const groups = new Map(order.map((label) => [label, []]));

  [...(conversations || [])]
    .sort((a, b) => getConversationTimestamp(b) - getConversationTimestamp(a))
    .forEach((conversation) => {
      groups.get(getConversationGroupLabel(conversation, now)).push(conversation);
    });

  return order
    .map((label) => ({ label, conversations: groups.get(label) }))
    .filter((group) => group.conversations.length > 0);
}

function dedupeSources(sources) {
  const seen = new Set();

  return (Array.isArray(sources) ? sources : [])
    .filter((source) => source?.url)
    .map((source) => ({
      ...source,
      url: safeExternalHref(source.url)
    }))
    .filter((source) => {
      if (!source.url) return false;
      const key = source.url.replace(/#.*$/, "").replace(/\/$/, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatInlineMarkdown(text) {
  let result = escapeHtml(text);
  // Inline code (must come before other formatting)
  result = result.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // Auto-link URLs
  result = result.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="message-link">$1</a>');
  // Markdown links [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="message-link">$1</a>');
  return result;
}

function isTableDivider(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isTableRow(line) {
  return line.includes("|") && line.trim().split("|").filter(Boolean).length >= 2;
}

function renderTable(lines, startIndex) {
  const header = lines[startIndex];
  const divider = lines[startIndex + 1];

  if (!header || !divider || !isTableRow(header) || !isTableDivider(divider)) {
    return null;
  }

  const rows = [header];
  let index = startIndex + 2;

  while (index < lines.length && isTableRow(lines[index])) {
    rows.push(lines[index]);
    index += 1;
  }

  const cells = rows.map((row) =>
    row
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => formatInlineMarkdown(cell.trim()))
  );

  const head = cells[0].map((cell) => `<th>${cell}</th>`).join("");
  const body = cells
    .slice(1)
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("");

  return {
    html: `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
    nextIndex: index
  };
}

function safeExternalHref(href) {
  if (!href) return "";

  try {
    const parsed = new URL(href, window.location.origin);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {}

  return "";
}

function getCookieValue(name) {
  if (typeof document === "undefined") return "";

  const prefix = `${name}=`;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  if (!match) return "";

  try {
    return decodeURIComponent(match.slice(prefix.length));
  } catch {
    return match.slice(prefix.length);
  }
}

function apiFetch(input, init = {}) {
  const requestInit = { ...init };
  const headers = new Headers(init.headers || {});
  const method = String(requestInit.method || "GET").toUpperCase();

  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrfToken = getCookieValue("vestora_csrf");
    if (csrfToken) {
      headers.set("x-csrf-token", csrfToken);
    }
  }

  requestInit.headers = headers;
  return fetch(input, requestInit);
}

function prepareMarkdownForRender(text) {
  return String(text || "")
    .replace(/<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/gi, "")
    .replace(/<\/?think\b[^>]*>/gi, "")
    .replace(/<reasoning\b[^>]*>[\s\S]*?(?:<\/reasoning>|$)/gi, "")
    .replace(/<\/?reasoning\b[^>]*>/gi, "")
    .replace(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_, __, href, label) => {
      const cleanLabel = String(label || "").replace(/<[^>]+>/g, "").trim() || href;
      return `[${cleanLabel}](${href})`;
    })
    .replace(/<\/?(?:div|span|p|a|strong|em|code|pre|table|thead|tbody|tr|th|td|ul|ol|li|blockquote|br)[^>]*>/gi, "")
    .replace(/^\s*(?:target|rel|class|style|title)=["'][^"']*["']\s*$/gim, "")
    .replace(/\s+(?:target|rel|class|style|title)=["'][^"']*["']/gi, "")
    .replace(/^\s*(?:thought:|reasoning:|analysis:|thinking:)\s.*$/gim, "")
    .replace(/^\s*(?:here(?:'|’)s|here is)\s+(?:my\s+)?(?:reasoning|analysis|thought process)[\s:.-]*$/gim, "")
    .replace(/^\s*(?:internal\s+)?(?:reasoning|analysis|thinking)[\s:.-]*$/gim, "")
    .replace(/^\s*(?:let(?:'|’)s|i(?:'|’)ll|i will)\s+think(?:\s+step by step)?[\s:.-]*.*$/gim, "")
    .replace(/^.*\bHTTP\s*\d{3}\b.*$/gim, "")
    .replace(/^.*\b(?:status\s+code|statusCode)\s*\d{3}\b.*$/gim, "")
    .replace(/^.*\b(?:stack\s*trace|traceback|exception|typeerror|referenceerror|syntaxerror|timeouterror|aborterror|failed\s+to\s+fetch|request\s+failed)\b.*$/gim, "")
    .replace(/^\s*at\s+[\w.<anonymous>/$-]+(?:\s|\().*$/gim, "")
    .replace(/^.*\b(?:internetSearch|server\.js|groq\.js|playwright|chromium|browser|page\.goto|fetchSource)\b.*$/gim, "")
    .replace(/^.*\b(?:falhas?\s+de\s+navegador|erro(?:s)?\s+de\s+navegador|navegador\s+falhou)\b.*$/gim, "")
    .replace(/^.*\b(?:erro(?:s)?\s+t[eé]cnico(?:s)?|falha(?:s)?\s+t[eé]cnica(?:s)?|demais\s+fontes\s+retornaram)\b.*$/gim, "")
    .replace(/^.*\b(?:mensagem|instru[cç][aã]o|prompt|log)\s+intern[ao]\b.*$/gim, "")
    .replace(/^.*n[aã]o\s+foi\s+poss[ií]vel\s+responder\s+com\s+seguran[cç]a\s+agora.*$/gim, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#039;/gi, "'")
    .trim();
}

function BotMessageContent({ text }) {
  const prepared = prepareMarkdownForRender(text);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        p: ({ children }) => <p>{children}</p>,
        h1: ({ children }) => <h3>{children}</h3>,
        h2: ({ children }) => <h3>{children}</h3>,
        h3: ({ children }) => <h3>{children}</h3>,
        a: ({ href, children }) => {
          const safeHref = safeExternalHref(href);
          if (!safeHref) {
            return <span>{children}</span>;
          }

          return (
            <a
              href={safeHref}
              target="_blank"
              rel="noopener noreferrer"
              className="message-link"
            >
              {children}
            </a>
          );
        },
        blockquote: ({ children }) => <blockquote className="message-quote">{children}</blockquote>,
        table: ({ children }) => (
          <div className="table-wrap">
            <table>{children}</table>
          </div>
        ),
        th: ({ children }) => <th>{children}</th>,
        td: ({ children }) => <td>{children}</td>,
        pre: ({ children }) => <div className="code-block"><pre>{children}</pre></div>,
        code: ({ inline, className, children }) =>
          inline ? (
            <code className="inline-code">{children}</code>
          ) : (
            <code className={className}>{children}</code>
          )
      }}
    >
      {prepared}
    </ReactMarkdown>
  );
}

function MessageSources({ sources }) {
  const items = dedupeSources(sources);

  if (items.length === 0) return null;

  return (
    <div className="message-sources">
      <p className="message-sources-title">Fontes</p>
      <ul className="message-sources-list">
        {items.map((source, index) => {
          const safeHref = safeExternalHref(source.url);
          if (!safeHref) return null;
          const domain = source.domain || safeHref.replace(/^https?:\/\//, "").split("/")[0];
          const shortDomain = domain.replace(/^www\./, "");
          const label = source.title || shortDomain;

          return (
            <li key={`${safeHref}-${index}`}>
              <a
                href={safeHref}
                target="_blank"
                rel="noopener noreferrer"
                className="message-source-item"
              >
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MessageBubble({ message, onRetry }) {
  if (message.role === "bot typing") {
    return (
      <article className="message bot typing" aria-label="Bot digitando">
        <span className="typing-indicator" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </span>
      </article>
    );
  }

  if (message.role === "bot") {
    return (
      <div className="message-bot-wrap">
        <article className={`message bot${message.hasError ? " has-error" : ""}`}>
          <BotMessageContent text={message.text} />
        </article>
        {message.hasError && onRetry && message.retryFor && (
          <button
            className="retry-button"
            onClick={() => onRetry(message.retryFor)}
            aria-label="Tentar novamente"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M1 4v6h6" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            Tentar novamente
          </button>
        )}
        <MessageSources sources={message.sources} />
      </div>
    );
  }

  return (
    <article className="message user">
      {message.text ? <p>{message.text}</p> : null}
      {message.attachments?.length ? <FilePreviewList attachments={message.attachments} compact /> : null}
    </article>
  );
}

function QuickActions({ actions, onSend, compact = false, disabled = false }) {
  const [pendingActionId, setPendingActionId] = useState("");
  const actionsDisabled = disabled || Boolean(pendingActionId);

  useEffect(() => {
    if (!disabled) {
      setPendingActionId("");
    }
  }, [disabled]);

  return (
    <div className={compact ? "quick-actions compact" : "quick-actions"} aria-label="Atalhos financeiros">
      {actions.map((action) => (
        <button
          key={action.id}
          id={compact ? `chat-shortcut-${action.id}` : `shortcut-${action.id}`}
          type="button"
          className={compact ? "quick-action-chip compact" : "quick-action-chip"}
          title={action.prompt}
          disabled={actionsDisabled}
          onClick={async () => {
            if (actionsDisabled) return;
            setPendingActionId(action.id);
            try {
              await Promise.resolve(onSend(action.prompt));
            } finally {
              setPendingActionId("");
            }
          }}
        >
          <span aria-hidden="true">{action.icon}</span>
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
}

function BrandLockup({
  className = "",
  variant = "full",
  subtitle = "Inteligência financeira pessoal",
  subtitleAccent = "pessoal"
}) {
  const isCompact = variant === "compact";
  const subtitleParts = String(subtitle).split(subtitleAccent);

  return (
    <div className={`brand-lockup ${isCompact ? "compact" : "full"} ${className}`.trim()}>
      <div className={`brand-mark-shell ${isCompact ? "compact" : "full"}`} aria-hidden="true">
        <img src={`/brand-mark.svg?v=${BRAND_ASSET_VERSION}`} alt="" />
      </div>
      <div className="brand-copy">
        <strong className="brand-wordmark-text">Vestora</strong>
        {!isCompact && (
          <span className="brand-tagline">
            {subtitleParts[0]}
            <em>{subtitleAccent}</em>
            {subtitleParts[1] || ""}
          </span>
        )}
      </div>
    </div>
  );
}

function AuthField({ id, name, type, placeholder, autoComplete, value, onChange, required, minLength, icon, inputMode }) {
  return (
    <label className="auth-field" htmlFor={id}>
      <span className="auth-field-icon" aria-hidden="true">{icon}</span>
      <input
        id={id}
        name={name}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        inputMode={inputMode}
        value={value}
        onChange={onChange}
      />
    </label>
  );
}

function AuthTrustBar() {
  return (
    <div className="auth-trust-bar" aria-label="Sinais de confiança">
      {AUTH_TRUST_ITEMS.map((item) => (
        <div className="auth-trust-item" key={item.text}>
          <span aria-hidden="true">{item.icon}</span>
          <small>{item.text}</small>
        </div>
      ))}
    </div>
  );
}

function StartScreen({ userName, onPrompt, onSend }) {
  return (
    <section className="start-screen" aria-label="Novo chat">
      <div className="start-hero" data-reveal>
        <BrandLockup className="start-brand-lockup" />
        <h2>Olá, {userName} 👋</h2>
        <p>Como posso ajudar sua vida financeira hoje?</p>

        <div className="start-prompts" aria-label="Sugestões de conversa">
          {QUICK_PROMPTS.map((item) => (
            <button
              key={item.label}
              type="button"
              data-prompt={item.prompt}
              onClick={() => onPrompt(item.prompt)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="start-shortcuts" aria-label="Consultas rápidas" data-reveal>
        <p className="start-shortcuts-label">Consultas rápidas</p>
        <QuickActions actions={SHORTCUT_ACTIONS} onSend={onSend} />
      </div>
    </section>
  );
}

function ConversationHistory({
  conversations,
  currentConversationId,
  onOpenConversation,
  onDeleteConversation,
  emptyText
}) {
  const groups = groupConversationsByDate(conversations);

  return (
    <section className="history-panel" aria-label="Histórico de conversas">
      <div className="history-head">
        <span>Conversas</span>
      </div>
      <div className="conversation-list" id="conversationList">
        {groups.length === 0 ? (
          <p className="conversation-empty">{emptyText}</p>
        ) : (
          groups.map((group) => (
            <div className="conversation-group" key={group.label}>
              <p className="conversation-group-title">{group.label}</p>
              {group.conversations.map((conversation) => {
                const title = getConversationDisplayTitle(conversation);

                return (
                  <div className="conversation-item" key={conversation.id}>
                    <button
                      className={`conversation-open${
                        conversation.id === currentConversationId ? " active" : ""
                      }`}
                      type="button"
                      data-id={conversation.id}
                      title={title}
                      onClick={() => onOpenConversation(conversation.id)}
                    >
                      {title}
                    </button>
                    <button
                      className="conversation-delete"
                      type="button"
                      data-id={conversation.id}
                      title="Apagar conversa"
                      aria-label={`Apagar ${title}`}
                      onClick={() => onDeleteConversation(conversation.id)}
                    >
                      <span></span>
                    </button>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

const TRANSLATIONS = {
  "pt-br": {
    newChat: "Novo chat",
    recent: "Recentes",
    emptyHistory: "Nenhuma conversa ainda.",
    logout: "Sair",
    profile: "Perfil",
    personalization: "Personalização",
    settings: "Configurações",
    online: "Online",
    offline: "Offline",
    typing: "Digitando...",
    composerPlaceholder: "Digite sua pergunta financeira...",
    activeIa: "IA ativa",
    waitAnswer: "Aguardando resposta",
    sendMessage: "Enviar mensagem",
    confirmClearAllConversations: "Tem certeza que deseja apagar todas as conversas? Esta ação não pode ser desfeita.",
    clear: "Limpar",
    save: "Salvar",
    saving: "Salvando...",
    cancel: "Cancelar",
    edit: "Editar",
    general: "Geral",
    notifications: "Notificações",
    account: "Conta",
    notificationsTitle: "Notificacoes",
    notificationsDescription: "Escolha quais avisos e resumos voce quer receber na sua experiencia.",
    marketAlerts: "Alertas de mercado",
    marketAlertsDescription: "Receba avisos sobre movimentos relevantes do mercado financeiro.",
    dailySummary: "Resumo diario",
    dailySummaryDescription: "Ative um resumo com destaques financeiros e acompanhamento da sua rotina.",
    priceAlerts: "Alertas de precos",
    priceAlertsDescription: "Monitore precos e cotacoes de ativos ou indicadores importantes.",
    financeNews: "Noticias financeiras",
    financeNewsDescription: "Exiba noticias e sinais relevantes para acompanhar o cenario economico.",
    goalsReminders: "Lembretes de metas",
    goalsRemindersDescription: "Receba lembretes para acompanhar suas metas e compromissos financeiros.",
    summaryFrequency: "Frequencia",
    summaryFrequencyDescription: "Defina com que ritmo a Vestora organiza seus resumos.",
    frequencyDaily: "Diario",
    frequencyWeekly: "Semanal",
    frequencyMonthly: "Mensal",
    change: "Alterar",
    view: "Ver",
    currentDevice: "Este dispositivo (Navegador atual)",
    revoke: "Revogar",
    connectedDevices: "Dispositivos conectados",
    passwordChangedSuccess: "Senha alterada com sucesso!",
    currentPasswordLabel: "Senha atual",
    newPasswordLabel: "Nova senha",
    confirmNewPasswordLabel: "Confirmar nova senha",
    passwordMismatch: "As senhas novas não coincidem.",
    language: "Idioma",
    theme: "Tema",
    clearConversations: "Limpar todas as conversas"
  },
  "en": {
    newChat: "New chat",
    recent: "Recent",
    emptyHistory: "No conversations yet.",
    logout: "Logout",
    profile: "Profile",
    personalization: "Personalization",
    settings: "Settings",
    online: "Online",
    offline: "Offline",
    typing: "Typing...",
    composerPlaceholder: "Ask about your finances...",
    activeIa: "AI active",
    waitAnswer: "Waiting for answer",
    sendMessage: "Send message",
    confirmClearAllConversations: "Are you sure you want to clear all conversations? This action cannot be undone.",
    clear: "Clear",
    save: "Save",
    saving: "Saving...",
    cancel: "Cancel",
    edit: "Edit",
    general: "General",
    notifications: "Notifications",
    account: "Account",
    notificationsTitle: "Notifications",
    notificationsDescription: "Choose which alerts and summaries you want in your experience.",
    marketAlerts: "Market alerts",
    marketAlertsDescription: "Get alerts about relevant movements in the financial markets.",
    dailySummary: "Daily summary",
    dailySummaryDescription: "Enable a summary with financial highlights and routine follow-up.",
    priceAlerts: "Price alerts",
    priceAlertsDescription: "Track prices and quotes for assets or important indicators.",
    financeNews: "Financial news",
    financeNewsDescription: "Show relevant news and signals to follow the economic landscape.",
    goalsReminders: "Goal reminders",
    goalsRemindersDescription: "Get reminders to track your financial goals and commitments.",
    summaryFrequency: "Frequency",
    summaryFrequencyDescription: "Define how often Vestora organizes your summaries.",
    frequencyDaily: "Daily",
    frequencyWeekly: "Weekly",
    frequencyMonthly: "Monthly",
    change: "Change",
    view: "View",
    currentDevice: "This device (Current browser)",
    revoke: "Revoke",
    connectedDevices: "Connected devices",
    passwordChangedSuccess: "Password changed successfully!",
    currentPasswordLabel: "Current password",
    newPasswordLabel: "New password",
    confirmNewPasswordLabel: "Confirm new password",
    passwordMismatch: "The new passwords do not match.",
    language: "Language",
    theme: "Theme",
    clearConversations: "Clear all conversations"
  },
  "es": {
    newChat: "Nuevo chat",
    recent: "Recientes",
    emptyHistory: "Sin conversaciones aún.",
    logout: "Salir",
    profile: "Perfil",
    personalization: "Personalización",
    settings: "Configuración",
    online: "En línea",
    offline: "Desconectado",
    typing: "Escribiendo...",
    composerPlaceholder: "Escribe tu pregunta financiera...",
    activeIa: "IA activa",
    waitAnswer: "Esperando respuesta",
    sendMessage: "Enviar mensaje",
    confirmClearAllConversations: "¿Está seguro de que desea borrar todas las conversaciones? Esta acción no se puede deshacer.",
    clear: "Limpiar",
    save: "Guardar",
    saving: "Guardando...",
    cancel: "Cancelar",
    edit: "Editar",
    general: "General",
    notifications: "Notificaciones",
    account: "Cuenta",
    notificationsTitle: "Notificaciones",
    notificationsDescription: "Elige qu? alertas y res?menes quieres recibir en tu experiencia.",
    marketAlerts: "Alertas de mercado",
    marketAlertsDescription: "Recibe alertas sobre movimientos relevantes del mercado financiero.",
    dailySummary: "Resumen diario",
    dailySummaryDescription: "Activa un resumen con destaques financieros y seguimiento de tu rutina.",
    priceAlerts: "Alertas de precios",
    priceAlertsDescription: "Monitorea precios y cotizaciones de activos o indicadores importantes.",
    financeNews: "Noticias financieras",
    financeNewsDescription: "Muestra noticias y se?ales relevantes para seguir el panorama econ?mico.",
    goalsReminders: "Recordatorios de metas",
    goalsRemindersDescription: "Recibe recordatorios para seguir tus metas y compromisos financieros.",
    summaryFrequency: "Frecuencia",
    summaryFrequencyDescription: "Define con qu? ritmo Vestora organiza tus res?menes.",
    frequencyDaily: "Diario",
    frequencyWeekly: "Semanal",
    frequencyMonthly: "Mensual",
    change: "Cambiar",
    view: "Ver",
    currentDevice: "Este dispositivo (Navegador actual)",
    revoke: "Revocar",
    connectedDevices: "Conexiones activas",
    passwordChangedSuccess: "¡Contraseña cambiada con éxito!",
    currentPasswordLabel: "Contraseña actual",
    newPasswordLabel: "Nueva contraseña",
    confirmNewPasswordLabel: "Confirmar nueva contraseña",
    passwordMismatch: "Las nuevas contraseñas no coinciden.",
    language: "Idioma",
    theme: "Tema",
    clearConversations: "Limpar todas las conversaciones"
  }
};

export default function App() {
  const shouldLoadVercelInsights = typeof window !== "undefined" &&
    !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const [deviceId] = useState(getOrCreateDeviceId);
  const [conversations, setConversations] = useState(loadLocalConversations);
  const [currentConversationId, setCurrentConversationId] = useState("");
  const [input, setInput] = useState("");
  const [statusText, setStatusText] = useState("Online");
  const [isSending, setIsSending] = useState(false);
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [submitSource, setSubmitSource] = useState("keyboard");
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [authVisible, setAuthVisible] = useState(false);
  const [authMounted, setAuthMounted] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [composerBurst, setComposerBurst] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [showSplash, setShowSplash] = useState(() => {
    if (typeof navigator === "undefined") return true;
    return !navigator.webdriver;
  });

  // Input draft auto-save (debounced)
  const DRAFT_KEY = "vestora-draft";
  const inputTimeoutRef = useRef(null);
  const attachmentInputRef = useRef(null);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    const savedDraft = localStorage.getItem(DRAFT_KEY);
    if (savedDraft) {
      setInput(savedDraft);
      localStorage.removeItem(DRAFT_KEY);
    }
  }, []);

  useEffect(() => {
    if (inputTimeoutRef.current) {
      clearTimeout(inputTimeoutRef.current);
    }
    if (input) {
      inputTimeoutRef.current = setTimeout(() => {
        localStorage.setItem(DRAFT_KEY, input);
      }, 1500);
    }
    return () => {
      if (inputTimeoutRef.current) {
        clearTimeout(inputTimeoutRef.current);
      }
    };
  }, [input]);

  useEffect(() => {
    if (!showSplash) return undefined;
    const timer = window.setTimeout(() => setShowSplash(false), 1250);
    return () => window.clearTimeout(timer);
  }, [showSplash]);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: "", username: "" });
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("geral");
  const [settings, setSettings] = useState(loadLocalSettings);

  // Translation helpers
  const currentLanguage = settings.idioma || "pt-br";
  function t(key) {
    return TRANSLATIONS[currentLanguage]?.[key] || TRANSLATIONS["pt-br"]?.[key] || key;
  }

  // Password change states
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Active sessions states
  const [showSessions, setShowSessions] = useState(false);
  const [sessionsList, setSessionsList] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");

  // Toast notification state
  const [toast, setToast] = useState(null);
  const toastTimeoutRef = useRef(null);

  useEffect(() => {
    if (!isLocalHost() && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          console.log("SW registered:", registration.scope);
        })
        .catch((err) => {
          console.warn("SW registration failed:", err);
        });
    }
  }, []);

  useEffect(() => {
    const updatePointer = (event) => {
      document.documentElement.style.setProperty("--cursor-x", `${event.clientX}px`);
      document.documentElement.style.setProperty("--cursor-y", `${event.clientY}px`);
    };

    const updateRevealTargets = () => {
      const elements = document.querySelectorAll("[data-reveal]");
      if (elements.length === 0) return undefined;

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
            }
          }
        },
        { threshold: 0.16 }
      );

      elements.forEach((element) => observer.observe(element));
      return observer;
    };

    let observer = updateRevealTargets();
    window.addEventListener("mousemove", updatePointer, { passive: true });

    const refreshTimer = window.setTimeout(() => {
      observer?.disconnect();
      observer = updateRevealTargets();
    }, 120);

    return () => {
      window.removeEventListener("mousemove", updatePointer);
      window.clearTimeout(refreshTimer);
      observer?.disconnect();
    };
  }, [conversations, currentConversationId, authMounted]);

  function showToast(message, type = "info", duration = 4000) {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
    }, duration);
  }

  // Focus trap for modals
  const settingsModalRef = useRef(null);
  const profileModalRef = useRef(null);

  useEffect(() => {
    if (settingsOpen && settingsModalRef.current) {
      const focusableElements = settingsModalRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      firstElement?.focus();

      const handleTabKey = (e) => {
        if (e.key === "Tab") {
          if (e.shiftKey && document.activeElement === firstElement) {
            e.preventDefault();
            lastElement?.focus();
          } else if (!e.shiftKey && document.activeElement === lastElement) {
            e.preventDefault();
            firstElement?.focus();
          }
        }
        if (e.key === "Escape") {
          setSettingsOpen(false);
        }
      };

      document.addEventListener("keydown", handleTabKey);
      return () => document.removeEventListener("keydown", handleTabKey);
    }
  }, [settingsOpen]);

  useEffect(() => {
    if (profileModalOpen && profileModalRef.current) {
      const focusableElements = profileModalRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      firstElement?.focus();

      const handleTabKey = (e) => {
        if (e.key === "Tab") {
          if (e.shiftKey && document.activeElement === firstElement) {
            e.preventDefault();
            lastElement?.focus();
          } else if (!e.shiftKey && document.activeElement === lastElement) {
            e.preventDefault();
            firstElement?.focus();
          }
        }
        if (e.key === "Escape") {
          setProfileModalOpen(false);
        }
      };

      document.addEventListener("keydown", handleTabKey);
      return () => document.removeEventListener("keydown", handleTabKey);
    }
  }, [profileModalOpen]);

  async function loadActiveSessions() {
    setSessionsLoading(true);
    setSessionsError("");
    try {
      const response = await fetch("/api/auth/sessions");
      if (!response.ok) throw new Error("Failed to load sessions");
      const data = await response.json();
      setSessionsList(data.sessions || []);
    } catch {
      setSessionsError("Erro ao carregar sessões.");
    } finally {
      setSessionsLoading(false);
    }
  }

  useEffect(() => {
    if (showSessions) {
      loadActiveSessions();
    }
  }, [showSessions]);

  async function handlePasswordSave(e) {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");

    if (newPassword !== confirmPassword) {
      setPasswordError(t("passwordMismatch"));
      return;
    }

    setPasswordLoading(true);
    try {
      const response = await apiFetch("/api/auth/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await response.json();
      if (!response.ok) {
        setPasswordError(data.error || "Erro ao alterar senha.");
        return;
      }
      setPasswordSuccess(t("passwordChangedSuccess"));
      showToast(t("passwordChangedSuccess"), "success");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => {
        setShowChangePassword(false);
        setPasswordSuccess("");
      }, 2000);
    } catch {
      setPasswordError("Erro de conexão.");
    } finally {
      setPasswordLoading(false);
    }
  }

  function markAttachmentsReady(ids) {
    setAttachments((previous) => previous.map((item) => (
      ids.includes(item.id) ? { ...item, status: "ready", error: "" } : item
    )));
  }

  function removeAttachment(attachmentId) {
    setAttachments((previous) => previous.filter((item) => item.id !== attachmentId));
  }

  function validateAndQueueFiles(inputFiles) {
    const files = normalizeFiles(inputFiles);
    if (files.length === 0) return;

    setAttachments((previous) => {
      const next = [...previous];
      const accepted = [];
      const seenKeys = new Set(previous.map((item) => `${item.name}-${item.size}-${item.type}`));

      for (const file of files) {
        const fingerprint = `${file.name}-${file.size}-${file.type}`;
        if (seenKeys.has(fingerprint)) {
          showToast(`O arquivo ${file.name} já está anexado.`, "info", 3200);
          continue;
        }

        if (next.length + accepted.length >= MAX_ATTACHMENTS) {
          showToast(`Você pode anexar até ${MAX_ATTACHMENTS} arquivos por mensagem.`, "error");
          break;
        }

        const extension = file.name.split(".").pop()?.toLowerCase() || "";
        if (!ACCEPTED_EXTENSIONS.includes(extension)) {
          showToast(`O arquivo ${file.name} não é compatível com a Vestora.`, "error");
          continue;
        }

        if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
          showToast(`O arquivo ${file.name} excede o limite de 15 MB.`, "error");
          continue;
        }

        const descriptor = buildAttachmentDescriptor(file, { status: "uploading" });
        accepted.push(descriptor);
        seenKeys.add(fingerprint);
      }

      if (accepted.length) {
        const acceptedIds = accepted.map((item) => item.id);
        window.setTimeout(() => markAttachmentsReady(acceptedIds), 420);
      }

      return [...next, ...accepted];
    });
  }

  function handleAttachmentSelection(event) {
    validateAndQueueFiles(event.target.files);
    event.target.value = "";
  }

  function handleAttachmentPaste(event) {
    const clipboardFiles = Array.from(event.clipboardData?.files || []);
    if (!clipboardFiles.length) return;
    event.preventDefault();
    validateAndQueueFiles(clipboardFiles);
  }

  function handleDragEnter(event) {
    event.preventDefault();
    dragDepthRef.current += 1;
    if (!isSending) {
      setDragActive(true);
    }
  }

  function handleDragOver(event) {
    event.preventDefault();
  }

  function handleDragLeave(event) {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragActive(false);
    }
  }

  function handleAttachmentDrop(event) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    validateAndQueueFiles(event.dataTransfer?.files);
  }

  const messagesRef = useRef(null);
  const inputRef = useRef(null);
  const authHideTimer = useRef(null);
  const sendingLockRef = useRef(false);
  const abortControllerRef = useRef(null);

  const currentConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === currentConversationId) || null,
    [conversations, currentConversationId]
  );

  const messages = currentConversation?.messages || [];
  const displayName = getDisplayName(currentUser);
  const userEmail = currentUser?.email || "Conta conectada";
  const userInitials = getInitials(displayName);
  const accountName = currentUser?.display_name || currentUser?.name || "Não definido";
  const accountUsername = currentUser?.username || "Não definido";

  function persistConversations(nextConversations) {
    setConversations(nextConversations);
    saveLocalConversations(nextConversations);
  }

  function showAuth() {
    clearTimeout(authHideTimer.current);
    setCurrentUser(null);
    setCurrentConversationId("");
    localStorage.removeItem(CURRENT_CONVERSATION_KEY);
    persistConversations([]);
    setAuthMounted(true);
    requestAnimationFrame(() => setAuthVisible(true));
  }

  function hideAuth() {
    clearTimeout(authHideTimer.current);
    setAuthVisible(false);
    authHideTimer.current = setTimeout(() => {
      setAuthMounted(false);
    }, AUTH_TRANSITION_MS);
  }

  function ensureLocalConversation(firstMessage = "", baseConversations = conversations) {
    const existing = baseConversations.find(
      (conversation) => conversation.id === currentConversationId
    );

    if (existing) {
      return { conversation: existing, nextConversations: baseConversations };
    }

    const conversation = {
      id: crypto.randomUUID(),
      title: makeTitle(firstMessage),
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const nextConversations = [conversation, ...baseConversations];
    setCurrentConversationId(conversation.id);
    localStorage.setItem(CURRENT_CONVERSATION_KEY, conversation.id);
    persistConversations(nextConversations);

    return { conversation, nextConversations };
  }

  function updateConversation(conversationId, updater) {
    setConversations((previous) => {
      const next = previous.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        return {
          ...conversation,
          ...updater(conversation),
          updatedAt: new Date().toISOString()
        };
      });
      saveLocalConversations(next);
      return next;
    });
  }

  function addMessage(role, text, options = {}) {
    const { conversation } = ensureLocalConversation(text);
    const message = {
      id: options.id || crypto.randomUUID(),
      role,
      text
    };

    updateConversation(conversation.id, (current) => ({
      messages: [...(current.messages || []), message]
    }));

    return message;
  }

  function appendMessageToConversation(conversationId, message) {
    updateConversation(conversationId, (conversation) => ({
      messages: [...(conversation.messages || []), message]
    }));
  }

  function removeMessageFromConversation(conversationId, messageId) {
    updateConversation(conversationId, (conversation) => ({
      messages: (conversation.messages || []).filter((message) => message.id !== messageId)
    }));
  }

  function replaceConversationId(previousId, nextId) {
    setConversations((previous) => {
      const next = previous.map((conversation) =>
        conversation.id === previousId ? { ...conversation, id: nextId } : conversation
      );
      saveLocalConversations(next);
      return next;
    });
  }

  async function checkAuth() {
    try {
      const response = await fetch("/api/auth/me");
      const data = await response.json();

      if (!data.authenticated) {
        setCurrentUser(null);
        setCloudEnabled(false);
        return false;
      }

      setCurrentUser(data.user);
      hideAuth();
      return true;
    } catch {
      setCurrentUser(null);
      setCloudEnabled(false);
      return false;
    }
  }

  async function loadCloudMessages(conversationId) {
    try {
      const response = await fetch(`/api/conversations/${conversationId}/messages`);
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.configured) return null;
      return data.messages || [];
    } catch (error) {
      console.error("Falha ao carregar mensagens da conversa:", error);
      return null;
    }
  }

  async function openConversation(conversationId) {
    setCurrentConversationId(conversationId);
    localStorage.setItem(CURRENT_CONVERSATION_KEY, conversationId);
    setStatusText("Carregando...");

    try {
      const cloudMessages = await loadCloudMessages(conversationId);
      if (cloudMessages) {
        updateConversation(conversationId, () => ({
          messages: cloudMessages.map((message) => ({
            id: crypto.randomUUID(),
            role: message.role,
            text: message.text
          }))
        }));
      }
    } finally {
      setStatusText("Online");
      setIsSidebarOpen(false);
    }
  }

  async function loadCloudConversations() {
    if (!currentUser) return;

    try {
      const response = await fetch("/api/conversations");

      if (response.status === 401) {
        setCurrentUser(null);
        setCloudEnabled(false);
        showAuth();
        return;
      }

      const data = await response.json();
      const configured = Boolean(data.configured);
      setCloudEnabled(configured);

      if (!configured || !Array.isArray(data.conversations)) return;

      const cloudConversations = data.conversations;

      setConversations((previous) => {
        const previousConversations = new Map(
          previous.map((conversation) => [conversation.id, conversation])
        );

        const nextConversations = cloudConversations.map((conversation) => {
          const previousConversation = previousConversations.get(conversation.id);
          return {
            id: conversation.id,
            title: conversation.title,
            messages: previousConversation?.messages || [],
            createdAt: conversation.created_at,
            updatedAt: conversation.updated_at
          };
        });

        saveLocalConversations(nextConversations);
        return nextConversations;
      });

      if (!currentConversationId) {
        localStorage.removeItem(CURRENT_CONVERSATION_KEY);
      }
    } catch {
      setCloudEnabled(false);
    }
  }

  async function deleteConversation(conversationId) {
    if (cloudEnabled) {
      try {
        const response = await apiFetch(`/api/conversations/${conversationId}`, {
          method: "DELETE"
        });

        if (!response.ok) {
          throw new Error("Delete failed");
        }
      } catch {
        setStatusText("Não consegui apagar a conversa.");
        return;
      }
    }

    const nextConversations = conversations.filter(
      (conversation) => conversation.id !== conversationId
    );
    const nextCurrentId = currentConversationId === conversationId ? "" : currentConversationId;

    setCurrentConversationId(nextCurrentId);
    localStorage.setItem(CURRENT_CONVERSATION_KEY, nextCurrentId);
    persistConversations(nextConversations);
  }

  function stopGeneration() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }

  async function sendMessage(text, outgoingAttachments = []) {
    if (sendingLockRef.current) return;
    sendingLockRef.current = true;
    setIsSending(true);

    const { conversation } = ensureLocalConversation(text);
    let activeConversationId = conversation.id;

    if ((conversation.messages || []).length === 0) {
      updateConversation(conversation.id, () => ({ title: makeTitle(text) }));
    }

    appendMessageToConversation(activeConversationId, {
      id: crypto.randomUUID(),
      role: "user",
      text,
      attachments: outgoingAttachments
    });

    setStatusText("Pesquisando fontes...");

    const typingId = crypto.randomUUID();
    appendMessageToConversation(activeConversationId, {
      id: typingId,
      role: "bot typing",
      text: "Digitando..."
    });

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    let botMsgId = "";

    try {
      const response = await apiFetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeConversationId,
          sessionId: activeConversationId || deviceId,
          message: text,
          attachments: serializeAttachmentsForApi(outgoingAttachments),
          settings: settings,
          stream: true
        }),
        signal: abortController.signal
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        console.error("Falha ao enviar mensagem:", {
          status: response.status,
          error: data?.error
        });
        removeMessageFromConversation(activeConversationId, typingId);
        appendMessageToConversation(activeConversationId, {
          id: crypto.randomUUID(),
          role: "bot",
          text: CHAT_FALLBACK_MESSAGE,
          hasError: true,
          retryFor: text
        });
        showToast(CHAT_FALLBACK_MESSAGE, "error");
        return;
      }

      // Streaming: read SSE line by line
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamText = "";
      let streamSources = [];
      let finalConversationId = activeConversationId;
      botMsgId = crypto.randomUUID();

      // Replace typing indicator with streaming message (empty at first)
      removeMessageFromConversation(activeConversationId, typingId);
      appendMessageToConversation(activeConversationId, {
        id: botMsgId,
        role: "bot",
        text: ""
      });

      setStatusText("Digitando...");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;

          try {
            const event = JSON.parse(trimmed.slice(5).trim());

            if (event.type === "sources") {
              streamSources = event.sources || [];
              updateConversation(activeConversationId, (conversation) => ({
                messages: conversation.messages.map((message) =>
                  message.id === botMsgId ? { ...message, sources: streamSources } : message
                )
              }));
            } else if (event.type === "meta") {
              streamSources = event.sources || streamSources;
            } else if (event.type === "chunk") {
              streamText += event.text;
              updateConversation(activeConversationId, (conversation) => ({
                messages: conversation.messages.map((message) =>
                  message.id === botMsgId ? { ...message, text: streamText } : message
                )
              }));
            } else if (event.type === "done") {
              finalConversationId = event.conversationId || activeConversationId;
            } else if (event.type === "error") {
              console.error("Falha no stream da IA:", event.error);
              throw new Error("stream-error");
            }
          } catch (parseErr) {
            if (parseErr.name === "AbortError") throw parseErr;
            if (parseErr.message && !parseErr.message.includes("JSON")) throw parseErr;
          }
        }
      }

      // Handle conversation ID change
      if (finalConversationId !== activeConversationId) {
        replaceConversationId(activeConversationId, finalConversationId);
        activeConversationId = finalConversationId;
        setCurrentConversationId(finalConversationId);
        localStorage.setItem(CURRENT_CONVERSATION_KEY, finalConversationId);
      }

      // Finalize: update message with sources
      if (streamText) {
        updateConversation(activeConversationId, (conversation) => ({
          messages: conversation.messages.map((message) =>
            message.id === botMsgId ? { ...message, text: streamText, sources: streamSources } : message
          )
        }));
        showToast("Mensagem enviada", "success", 2000);
        await loadCloudConversations();
      }
    } catch (error) {
      if (error.name === "AbortError") {
        // User stopped generation — keep partial text
        removeMessageFromConversation(activeConversationId, typingId);
        showToast("Geração interrompida", "info", 2000);
      } else {
        console.error("Falha ao receber resposta da IA:", error);
        removeMessageFromConversation(activeConversationId, typingId);

        if (botMsgId) {
          updateConversation(activeConversationId, (conversation) => ({
            messages: conversation.messages.map((message) =>
              message.id === botMsgId
                ? {
                    ...message,
                    text: message.text || CHAT_FALLBACK_MESSAGE,
                    hasError: !message.text,
                    retryFor: !message.text ? text : undefined
                  }
                : message
            )
          }));
        } else {
          appendMessageToConversation(activeConversationId, {
            id: crypto.randomUUID(),
            role: "bot",
            text: CHAT_FALLBACK_MESSAGE,
            hasError: true,
            retryFor: text
          });
        }

        showToast(CHAT_FALLBACK_MESSAGE, "error");
      }
    } finally {
      abortControllerRef.current = null;
      sendingLockRef.current = false;
      setIsSending(false);
      setStatusText(t("online"));
      setAttachments([]);
      inputRef.current?.focus();
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (isSending || sendingLockRef.current) return;

    const text = formatText(input);
    const readyAttachments = attachments.filter((item) => item.status !== "error");
    const submissionText = text || buildAttachmentFallbackText(readyAttachments);
    if (!submissionText) return;

    setComposerBurst(submitSource === "button" ? "sending-burst button-submit" : "sending-burst");
    window.setTimeout(() => setComposerBurst(""), 560);
    setSubmitSource("keyboard");

    setInput("");
    localStorage.removeItem(DRAFT_KEY);
    setAttachments((previous) => previous.map((item) => ({ ...item, status: "sent" })));

    await sendMessage(submissionText, readyAttachments);
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();

    setAuthError("");
    setAuthLoading(true);
    const loadingStartedAt = Date.now();

    try {
      const response = await apiFetch(isRegisterMode ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(authForm)
      });

      const data = await response.json();

      if (!response.ok) {
        setAuthError(data.error || "Não foi possível entrar.");
        return;
      }

      setCurrentUser(data.user);
      hideAuth();
      setCurrentConversationId("");
      localStorage.removeItem(CURRENT_CONVERSATION_KEY);
      persistConversations([]);
    } catch {
      setAuthError("Não consegui conectar ao servidor.");
    } finally {
      const remaining = MIN_LOADING_FEEDBACK_MS - (Date.now() - loadingStartedAt);
      if (remaining > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remaining));
      }
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setAccountMenuOpen(false);
    setIsSidebarOpen(false);
    setCurrentUser(null);
    setCloudEnabled(false);
    setCurrentConversationId("");
    localStorage.removeItem(CURRENT_CONVERSATION_KEY);
    persistConversations([]);
    hideAuth();
  }

  function handleNewChat() {
    setCurrentConversationId("");
    localStorage.removeItem(CURRENT_CONVERSATION_KEY);
    setStatusText("Online");
    setIsSidebarOpen(false);
    inputRef.current?.focus();
  }

  function openProfileModal() {
    setAccountMenuOpen(false);
    setProfileForm({
      name: currentUser?.display_name || currentUser?.name || "",
      username: currentUser?.username || ""
    });
    setProfileError("");
    setProfileModalOpen(true);
  }

  function openSettings() {
    setAccountMenuOpen(false);
    setSettingsTab("geral");
    setSettingsOpen(true);
  }

  function updateSetting(key, value) {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveLocalSettings(next);
      return next;
    });
  }

  async function handleProfileSave() {
    setProfileError("");
    setProfileLoading(true);

    try {
      const response = await apiFetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileForm)
      });

      const data = await response.json();

      if (!response.ok) {
        setProfileError(data.error || "Nao consegui atualizar o perfil.");
        return;
      }

      setCurrentUser((previous) => ({ ...previous, ...data.user }));
      setProfileModalOpen(false);
    } catch {
      setProfileError("Nao consegui conectar ao servidor.");
    } finally {
      setProfileLoading(false);
    }
  }

  useEffect(() => {
    checkAuth().then((authenticated) => {
      if (authenticated) loadCloudConversations();
    });

    return () => clearTimeout(authHideTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (currentUser) loadCloudConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  useEffect(() => {
    const syncWhenVisible = () => {
      if (!document.hidden && currentUser) loadCloudConversations();
    };
    const syncWhenFocused = () => {
      if (currentUser) loadCloudConversations();
    };

    document.addEventListener("visibilitychange", syncWhenVisible);
    window.addEventListener("focus", syncWhenFocused);

    return () => {
      document.removeEventListener("visibilitychange", syncWhenVisible);
      window.removeEventListener("focus", syncWhenFocused);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  useEffect(() => {
    document.body.classList.remove("theme-light", "theme-dark");
    if (settings.tema === "claro") {
      document.body.classList.add("theme-light");
    } else if (settings.tema === "auto" && window.matchMedia("(prefers-color-scheme: light)").matches) {
      document.body.classList.add("theme-light");
    }
  }, [settings.tema]);

  useEffect(() => {
    const element = messagesRef.current;
    if (!element) return;
    element.scrollTop = messages.length > 0 ? element.scrollHeight : 0;
  }, [messages.length, currentConversationId]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const isCompactScreen = window.matchMedia("(max-width: 900px)").matches;
    const maxHeight = isCompactScreen ? 104 : 150;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [input]);

  return (
    <>
      {shouldLoadVercelInsights && (
        <>
          <Analytics />
          <SpeedInsights />
        </>
      )}

      <a href="#main-content" className="skip-link">Pular para o conteúdo principal</a>

      {showSplash && (
        <div className="startup-screen" aria-hidden="true">
          <div className="startup-core">
            <BrandLockup className="startup-brand-lockup" />
            <span>Financial intelligence, beautifully orchestrated.</span>
            <div className="startup-bar">
              <span></span>
            </div>
          </div>
        </div>
      )}

      <div className="cursor-aura" aria-hidden="true"></div>

      {toast && (
        <div
          className={`toast toast-${toast.type}`}
          role="alert"
          aria-live="polite"
        >
          <span className="toast-icon" aria-hidden="true">
            {toast.type === "success" && "✓"}
            {toast.type === "error" && "✕"}
            {toast.type === "info" && "ℹ"}
          </span>
          <span className="toast-message">{toast.message}</span>
          <button
            className="toast-close"
            onClick={() => setToast(null)}
            aria-label="Fechar notificação"
          >
            ×
          </button>
        </div>
      )}

      <div className="ambient" aria-hidden="true">
        <div className="grid-layer"></div>
        <div className="scan-layer"></div>
        <div className="signal signal-a"></div>
        <div className="signal signal-b"></div>
      </div>

      {authMounted && (
        <section
          className={`auth-screen${authVisible ? " visible" : ""}`}
          aria-label="Login da Vestora"
        >
          <div className="auth-layout">
            <section className="auth-hero" aria-label="Apresentação da Vestora">
              <BrandLockup className="auth-hero-brand" />
              <div className="auth-hero-copy">
                <h1>Sua inteligência financeira pessoal para decisões mais inteligentes.</h1>
                <p>
                  Centralize visão de patrimônio, acompanhe mercado e transforme análise financeira em decisões claras, rápidas e confiáveis.
                </p>
              </div>

              <div className="auth-benefits" aria-label="Benefícios da plataforma">
                {AUTH_BENEFITS.map((benefit) => (
                  <div className="auth-benefit" key={benefit}>
                    <span className="auth-benefit-check" aria-hidden="true">✓</span>
                    <strong>{benefit}</strong>
                  </div>
                ))}
              </div>

              <div className="auth-hero-panel" aria-hidden="true">
                <div className="auth-hero-panel-header">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                <div className="auth-hero-panel-body">
                  <div className="auth-hero-kpi">
                    <small>Visão consolidada</small>
                    <strong>Patrimônio, caixa e mercado em uma única conversa</strong>
                  </div>
                  <div className="auth-hero-pulse">
                    <div className="auth-hero-pulse-line pulse-a"></div>
                    <div className="auth-hero-pulse-line pulse-b"></div>
                    <div className="auth-hero-pulse-line pulse-c"></div>
                  </div>
                </div>
              </div>
            </section>

            <form className="auth-card" id="authForm" onSubmit={handleAuthSubmit}>
              <div className="auth-card-top">
                <BrandLockup className="auth-brand-lockup" />
                <div className="auth-card-copy">
                  <strong>{isRegisterMode ? "Crie sua conta" : "Entrar na Vestora"}</strong>
                  <p>Continue com uma experiência financeira premium, privada e segura.</p>
                </div>
              </div>

              <div className="auth-form-fields">
                {isRegisterMode && (
                  <AuthField
                    id="authName"
                    name="name"
                    type="text"
                    placeholder="Nome"
                    autoComplete="name"
                    icon="◎"
                    value={authForm.name}
                    onChange={(event) => setAuthForm({ ...authForm, name: event.target.value })}
                  />
                )}

                <AuthField
                  id="authEmail"
                  name="email"
                  type="email"
                  placeholder="Email"
                  autoComplete="email"
                  required
                  inputMode="email"
                  icon="✉"
                  value={authForm.email}
                  onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })}
                />

                <AuthField
                  id="authPassword"
                  name="password"
                  type="password"
                  placeholder="Senha"
                  autoComplete={isRegisterMode ? "new-password" : "current-password"}
                  required
                  minLength="6"
                  icon="•"
                  value={authForm.password}
                  onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}
                />
              </div>

              <div className="auth-card-links">
                <button
                  className="auth-link auth-forgot"
                  type="button"
                  onClick={() => showToast("A recuperação de senha será liberada nesta mesma experiência em breve.", "info")}
                >
                  Esqueci minha senha
                </button>
                <button
                  className="auth-link"
                  id="authToggle"
                  type="button"
                  onClick={() => {
                    setIsRegisterMode(!isRegisterMode);
                    setAuthError("");
                  }}
                >
                  {isRegisterMode ? "Já tenho conta" : "Criar conta"}
                </button>
              </div>

              <p className="auth-error" id="authError" role="alert">
                {authError}
              </p>

              <button id="authSubmit" type="submit" disabled={authLoading}>
                {authLoading ? (
                  <span className="auth-submit-content">
                    <span className="auth-spinner" aria-hidden="true"></span>
                    <span>{isRegisterMode ? "Criando conta..." : "Entrando..."}</span>
                  </span>
                ) : (
                  isRegisterMode ? "Criar conta" : "Entrar"
                )}
              </button>

              <AuthTrustBar />
            </form>
          </div>
        </section>
      )}

      <main className="app-shell" id="main-content">
        <button
          className={`sidebar-scrim${isSidebarOpen ? " open" : ""}`}
          type="button"
          aria-label="Fechar menu"
          onClick={() => setIsSidebarOpen(false)}
        ></button>

        <aside className={`sidebar${isSidebarOpen ? " open" : ""}`} aria-label="Painel da Vestora">
          <div className="brand">
            <BrandLockup className="sidebar-brand-lockup" />
          </div>

          <button className="new-chat" id="newChatButton" type="button" onClick={handleNewChat}>
            <span aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
            </span>
            {t("newChat")}
          </button>

          <ConversationHistory
            conversations={conversations}
            currentConversationId={currentConversationId}
            onOpenConversation={openConversation}
            onDeleteConversation={deleteConversation}
            emptyText={t("emptyHistory")}
          />
 
          <div className="account-area">
            {accountMenuOpen && (
              <div className="account-menu" role="menu" aria-label="Menu da conta">
                <div className="account-menu-head">
                  <span className="account-avatar large" aria-hidden="true">
                    {userInitials}
                  </span>
                  <div>
                    <strong>{displayName}</strong>
                    <small>{userEmail}</small>
                  </div>
                </div>
 
                <button type="button" role="menuitem" onClick={openProfileModal}>
                  <span aria-hidden="true">◎</span>
                  {t("profile")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setAccountMenuOpen(false); setSettingsTab("geral"); setSettingsOpen(true); }}
                >
                  <span aria-hidden="true">⚙</span>
                  {t("settings")}
                </button>
                <button className="danger" type="button" role="menuitem" onClick={handleLogout}>
                  <span aria-hidden="true">↪</span>
                  {t("logout")}
                </button>
              </div>
            )}

            <button
              className="account-button"
              type="button"
              aria-label="Abrir menu da conta"
              aria-expanded={accountMenuOpen}
              onClick={() => setAccountMenuOpen((open) => !open)}
            >
              <span className="account-avatar" aria-hidden="true">
                {userInitials}
              </span>
              <span className="account-name">
                <strong>{displayName}</strong>
                <small>{userEmail}</small>
              </span>
              <span className="account-chevron" aria-hidden="true">›</span>
            </button>
          </div>

        </aside>

        <section className="chat-panel" aria-label="Conversa com a Vestora">
          <header className="chat-header">
            <button
              className="mobile-menu-button"
              type="button"
              aria-label="Abrir menu"
              onClick={() => setIsSidebarOpen(true)}
            >
              <span></span>
              <span></span>
            </button>
            <div className="chat-title">
              <BrandLockup className="chat-brand-lockup" variant="compact" />
              <span id="statusText">{statusText}</span>
            </div>
            <div className="chat-actions">
              <div className="live-pill" aria-hidden="true">
                <span></span>
                IA ativa
              </div>
              <button
                className="mobile-account-button"
                type="button"
                aria-label="Abrir conta"
                onClick={() => setIsSidebarOpen(true)}
              >
                {userInitials}
              </button>
            </div>
          </header>

          <div
            className={`messages${messages.length === 0 ? " empty" : ""}`}
            id="messages"
            aria-live="polite"
            ref={messagesRef}
          >
            {messages.length === 0 ? (
              <StartScreen
                userName={getFirstName(displayName)}
                onPrompt={(prompt) => {
                  setInput(prompt);
                  inputRef.current?.focus();
                }}
                onSend={(prompt) => {
                  if (!isSending) sendMessage(prompt);
                }}
              />
            ) : (
              messages.map((message) => <MessageBubble key={message.id} message={message} onRetry={sendMessage} />)
            )}
          </div>

          {messages.length > 0 && (
            <div className="shortcuts-bar" id="shortcutsBar">
              <QuickActions
                actions={SHORTCUT_ACTIONS}
                onSend={sendMessage}
                compact
                disabled={isSending}
              />
            </div>
          )}

          <DragDropZone
            isActive={dragActive}
            disabled={isSending}
            onDrop={handleAttachmentDrop}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onPaste={handleAttachmentPaste}
          >
            {attachments.length > 0 && (
              <div className="composer-attachments">
                <FilePreviewList attachments={attachments} onRemove={removeAttachment} disabled={isSending} />
              </div>
            )}

            <form className={`composer ${composerBurst}`.trim()} id="chatForm" onSubmit={handleSubmit}>
              <input
                id={FILE_ATTACHMENTS_INPUT_ID}
                ref={attachmentInputRef}
                type="file"
                className="file-upload-input"
                accept={ACCEPTED_FILE_TYPES}
                multiple
                onChange={handleAttachmentSelection}
              />
              <FileUploadButton
                inputId={FILE_ATTACHMENTS_INPUT_ID}
                disabled={isSending}
                onClick={() => attachmentInputRef.current?.click()}
              />
              <textarea
                id="messageInput"
                name="message"
                rows="1"
                maxLength="1200"
                placeholder={t("composerPlaceholder")}
                autoComplete="off"
                ref={inputRef}
                value={input}
                disabled={isSending}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (isSending || sendingLockRef.current) return;
                    setSubmitSource("keyboard");
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <button
                id="sendButton"
                type={isSending ? "button" : "submit"}
                aria-label={isSending ? "Parar geração" : "Enviar mensagem"}
                title={isSending ? "Parar geração" : "Enviar mensagem"}
                disabled={!isSending && !formatText(input) && attachments.length === 0}
                onPointerDown={() => setSubmitSource("button")}
                onClick={isSending ? (e) => { e.preventDefault(); stopGeneration(); } : undefined}
              >
                {isSending ? (
                  <svg className="stop-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <rect x="8" y="8" width="8" height="8" rx="1.8" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M12 19V5" />
                    <path d="M5 12l7-7 7 7" />
                  </svg>
                )}
              </button>
            </form>
          </DragDropZone>
        </section>

      </main>

      {settingsOpen && (
        <section className="settings-modal-screen" aria-label="Configurações">
          <div className="settings-modal-backdrop" onClick={() => setSettingsOpen(false)} aria-hidden="true"></div>
          <div className="settings-modal" role="dialog" aria-label="Configurações">
            <button
              className="settings-close"
              type="button"
              aria-label="Fechar"
              onClick={() => setSettingsOpen(false)}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18" /><path d="M6 6l12 12" />
              </svg>
            </button>

            <nav className="settings-sidebar" aria-label="Categorias">
              <button
                className={`settings-nav-item${settingsTab === "geral" ? " active" : ""}`}
                type="button"
                onClick={() => setSettingsTab("geral")}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                {t("general")}
              </button>
              <button
                className={`settings-nav-item${settingsTab === "notificacoes" ? " active" : ""}`}
                type="button"
                onClick={() => setSettingsTab("notificacoes")}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.17V11a6 6 0 1 0-12 0v3.17a2 2 0 0 1-.6 1.42L4 17h5"/><path d="M9 17a3 3 0 0 0 6 0"/></svg>
                {t("notifications")}
              </button>
              <button
                className={`settings-nav-item${settingsTab === "conta" ? " active" : ""}`}
                type="button"
                onClick={() => setSettingsTab("conta")}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                {t("account")}
              </button>
            </nav>

            <div className="settings-content">
              {settingsTab === "geral" && (
                <div className="settings-pane">
                  <h2 className="settings-pane-title">{t("general")}</h2>

                  <div className="settings-section">
                    <h3 className="settings-section-title">Aparência</h3>
                    <p className="settings-section-desc">Personalize a aparência da Vestora.</p>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <strong>{t("language")}</strong>
                        <small>Escolha o idioma da interface da Vestora.</small>
                      </div>
                      <select className="settings-select" value={settings.idioma || "pt-br"} onChange={(e) => updateSetting("idioma", e.target.value)}>
                        <option value="pt-br">Português (Brasil)</option>
                        <option value="en">English</option>
                        <option value="es">Español</option>
                      </select>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <strong>{t("theme")}</strong>
                        <small>Escolha entre o tema escuro ou claro.</small>
                      </div>
                      <select className="settings-select" value={settings.tema || "escuro"} onChange={(e) => updateSetting("tema", e.target.value)}>
                        <option value="escuro">Escuro</option>
                        <option value="claro">Claro</option>
                        <option value="auto">Automático</option>
                      </select>
                    </div>
                  </div>

                  <div className="settings-section">
                    <h3 className="settings-section-title">Dados e Privacidade</h3>
                    <p className="settings-section-desc">Controle seus dados pessoais e conversas salvas.</p>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <strong>Exportar dados</strong>
                        <small>Baixe uma cópia de todas as suas conversas e configurações.</small>
                      </div>
                      <button className="settings-select" style={{ cursor: "pointer" }} onClick={() => {
                        const data = { conversas: conversations, configuracoes: settings, exportadoEm: new Date().toISOString() };
                        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "vestora-dados.json";
                        a.click();
                        URL.revokeObjectURL(url);
                      }}>Exportar</button>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <strong>{t("clearConversations")}</strong>
                        <small>Remove permanentemente todas as conversas salvas localmente e na nuvem.</small>
                      </div>
                      <button className="settings-select" style={{ cursor: "pointer", color: "#fb7185" }} onClick={async () => {
                        if (window.confirm(t("confirmClearAllConversations"))) {
                          if (cloudEnabled) {
                            try {
                              await apiFetch("/api/conversations", { method: "DELETE" }).catch(() => {});
                            } catch (err) {
                              console.error("Erro ao limpar conversas em nuvem:", err);
                            }
                          }
                          persistConversations([]);
                          setCurrentConversationId("");
                          localStorage.removeItem(CURRENT_CONVERSATION_KEY);
                        }
                      }}>{t("clear")}</button>
                    </div>
                  </div>

                  <div className="settings-section">
                    <h3 className="settings-section-title">Sobre</h3>
                    <div className="settings-row">
                      <div className="settings-row-text">
                        <strong>Vestora</strong>
                        <small>Versão 1.0.0 — Plataforma de inteligência financeira pessoal com IA.</small>
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-text">
                        <small>Desenvolvida para ajudar você a tomar decisões financeiras mais inteligentes sobre patrimônio, investimentos, crédito, dívidas e planejamento.</small>
                      </div>
                    </div>
                  </div>
                </div>
              )}


              {settingsTab === "notificacoes" && (
                <div className="settings-pane">
                  <h2 className="settings-pane-title">{t("notificationsTitle")}</h2>

                  <div className="settings-section">
                    <h3 className="settings-section-title">{t("notifications")}</h3>
                    <p className="settings-section-desc">{t("notificationsDescription")}</p>

                    {[
                      ["alertasMercado", "marketAlerts", "marketAlertsDescription"],
                      ["resumoDiario", "dailySummary", "dailySummaryDescription"],
                      ["alertasPrecos", "priceAlerts", "priceAlertsDescription"],
                      ["noticiasFinanceiras", "financeNews", "financeNewsDescription"],
                      ["lembretesMetas", "goalsReminders", "goalsRemindersDescription"]
                    ].map(([key, titleKey, descKey]) => (
                      <div className="settings-row" key={key}>
                        <div className="settings-row-text">
                          <strong>{t(titleKey)}</strong>
                          <small>{t(descKey)}</small>
                        </div>
                        <label className="settings-toggle" aria-label={t(titleKey)}>
                          <input
                            type="checkbox"
                            checked={Boolean(settings[key])}
                            onChange={(event) => updateSetting(key, event.target.checked)}
                          />
                          <span className="settings-toggle-slider" aria-hidden="true"></span>
                        </label>
                      </div>
                    ))}

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <strong>{t("summaryFrequency")}</strong>
                        <small>{t("summaryFrequencyDescription")}</small>
                      </div>
                      <select
                        className="settings-select"
                        value={settings.frequenciaResumo || "diario"}
                        onChange={(e) => updateSetting("frequenciaResumo", e.target.value)}
                      >
                        <option value="diario">{t("frequencyDaily")}</option>
                        <option value="semanal">{t("frequencyWeekly")}</option>
                        <option value="mensal">{t("frequencyMonthly")}</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {settingsTab === "conta" && (
                <div className="settings-pane">
                  <h2 className="settings-pane-title">{t("account")}</h2>

                  <div className="settings-section">
                    <h3 className="settings-section-title">Informações da Conta</h3>
                    <p className="settings-section-desc">Visualize e gerencie os dados da sua conta.</p>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <strong>Nome</strong>
                        <small>{accountName}</small>
                      </div>
                      <button className="settings-select" style={{ cursor: "pointer" }} onClick={openProfileModal}>Editar</button>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <strong>Email</strong>
                        <small>{currentUser?.email || "Não definido"}</small>
                      </div>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <strong>Nome de usuário</strong>
                        <small>{accountUsername}</small>
                      </div>
                      <button className="settings-select" style={{ cursor: "pointer" }} onClick={openProfileModal}>Editar</button>
                    </div>
                  </div>

                  <div className="settings-section">
                    <h3 className="settings-section-title">Segurança</h3>
                    <p className="settings-section-desc">Mantenha sua conta segura.</p>

                    {showChangePassword ? (
                      <form onSubmit={handlePasswordSave} style={{ display: "grid", gap: "12px", padding: "12px", border: "1px solid rgba(190, 255, 232, 0.1)", borderRadius: "12px", background: "rgba(0,0,0,0.15)", marginBottom: "16px" }}>
                        <div style={{ display: "grid", gap: "4px" }}>
                          <label htmlFor="currentPassword" style={{ fontSize: "12px", fontWeight: "700" }}>{t("currentPasswordLabel")}</label>
                          <input
                            id="currentPassword"
                            type="password"
                            required
                            className="settings-input"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                          />
                        </div>
                        <div style={{ display: "grid", gap: "4px" }}>
                          <label htmlFor="newPassword" style={{ fontSize: "12px", fontWeight: "700" }}>{t("newPasswordLabel")}</label>
                          <input
                            id="newPassword"
                            type="password"
                            required
                            className="settings-input"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                          />
                        </div>
                        <div style={{ display: "grid", gap: "4px" }}>
                          <label htmlFor="confirmPassword" style={{ fontSize: "12px", fontWeight: "700" }}>{t("confirmNewPasswordLabel")}</label>
                          <input
                            id="confirmPassword"
                            type="password"
                            required
                            className="settings-input"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                          />
                        </div>
                        {passwordError && <p style={{ color: "#fb7185", fontSize: "12px", margin: 0 }}>{passwordError}</p>}
                        {passwordSuccess && <p style={{ color: "#34d399", fontSize: "12px", margin: 0 }}>{passwordSuccess}</p>}
                        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                          <button type="button" className="settings-select" style={{ cursor: "pointer", background: "transparent", border: "1px solid rgba(255,255,255,0.15)" }} onClick={() => { setShowChangePassword(false); setPasswordError(""); }}>{t("cancel")}</button>
                          <button type="submit" className="settings-select" style={{ cursor: "pointer", background: "rgba(34, 197, 94, 0.2)", color: "#eafff6", borderColor: "rgba(34, 197, 94, 0.4)" }} disabled={passwordLoading}>
                            {passwordLoading ? t("saving") : t("save")}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="settings-row">
                        <div className="settings-row-text">
                          <strong>Alterar senha</strong>
                          <small>Atualize sua senha regularmente para manter a segurança.</small>
                        </div>
                        <button className="settings-select" style={{ cursor: "pointer" }} onClick={() => setShowChangePassword(true)}>{t("change")}</button>
                      </div>
                    )}

                    {showSessions ? (
                      <div style={{ padding: "12px", border: "1px solid rgba(190, 255, 232, 0.1)", borderRadius: "12px", background: "rgba(0,0,0,0.15)" }}>
                        <h4 style={{ fontSize: "14px", fontWeight: "800", margin: "0 0 12px 0", color: "#eafff6" }}>{t("connectedDevices")}</h4>
                        {sessionsLoading && <p style={{ fontSize: "12px", color: "var(--muted)", margin: 0 }}>Carregando...</p>}
                        {sessionsError && <p style={{ fontSize: "12px", color: "#fb7185", margin: 0 }}>{sessionsError}</p>}
                        {!sessionsLoading && !sessionsError && (
                          <div style={{ display: "grid", gap: "10px" }}>
                            {sessionsList.map((sess, idx) => (
                              <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                                <div style={{ display: "grid", gap: "2px" }}>
                                  <span style={{ fontSize: "13px", fontWeight: "700", color: "#eafff6" }}>
                                    {sess.device} {sess.current && <span style={{ fontSize: "10px", background: "rgba(34, 197, 94, 0.2)", color: "#34d399", padding: "2px 6px", borderRadius: "8px", marginLeft: "6px" }}>{t("currentDevice")}</span>}
                                  </span>
                                  <small style={{ fontSize: "11px", color: "var(--muted)" }}>IP: {sess.ip} • Ativo agora</small>
                                </div>
                                <button className="settings-select" style={{ cursor: "pointer", color: "#fb7185", fontSize: "12px", padding: "0 12px", minHeight: "30px" }} onClick={() => handleLogout()}>
                                  {t("revoke")}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px" }}>
                          <button type="button" className="settings-select" style={{ cursor: "pointer", background: "transparent", border: "1px solid rgba(255,255,255,0.15)" }} onClick={() => setShowSessions(false)}>Fechar</button>
                        </div>
                      </div>
                    ) : (
                      <div className="settings-row">
                        <div className="settings-row-text">
                          <strong>Sessões ativas</strong>
                          <small>Gerencie os dispositivos conectados à sua conta.</small>
                        </div>
                        <button className="settings-select" style={{ cursor: "pointer" }} onClick={() => setShowSessions(true)}>{t("view")}</button>
                      </div>
                    )}
                  </div>

                  <div className="settings-section">
                    <h3 className="settings-section-title">Área de risco</h3>
                    <p className="settings-section-desc">Ações irreversíveis da conta.</p>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <strong>Sair da conta</strong>
                        <small>Desconecte-se de todos os dispositivos.</small>
                      </div>
                      <button className="settings-select" style={{ cursor: "pointer", color: "#f59e0b" }} onClick={handleLogout}>Sair</button>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <strong>Excluir conta</strong>
                        <small>Remove permanentemente sua conta e todos os dados associados.</small>
                      </div>
                      <button className="settings-select" style={{ cursor: "pointer", color: "#fb7185" }} onClick={() => {
                        if (window.confirm("Tem certeza que deseja excluir sua conta? Esta ação não pode ser desfeita.")) {
                          handleLogout();
                        }
                      }}>Excluir</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {profileModalOpen && (
        <section className="profile-modal-screen" aria-label="Editar perfil">
          <div className="profile-modal-backdrop" onClick={() => setProfileModalOpen(false)} aria-hidden="true"></div>
          <div className="profile-modal" role="dialog" aria-label="Editar perfil">
            <div className="profile-modal-header">
              <h2 className="profile-modal-title">Editar perfil</h2>
              <button
                className="profile-modal-close"
                type="button"
                aria-label="Fechar"
                onClick={() => setProfileModalOpen(false)}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6L6 18" /><path d="M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="profile-avatar-area">
              <span className="profile-avatar-xlarge" aria-hidden="true">
                {getInitials(profileForm.name || displayName)}
              </span>
              <button
                className="profile-avatar-camera"
                type="button"
                aria-label="Alterar foto do perfil"
                tabIndex={-1}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </button>
            </div>

            <label className="profile-field">
              <span className="profile-field-label">Nome de exibição</span>
              <input
                type="text"
                value={profileForm.name}
                onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })}
                maxLength={80}
                autoComplete="name"
              />
            </label>

            <label className="profile-field">
              <span className="profile-field-label">Nome de usuário</span>
              <input
                type="text"
                value={profileForm.username}
                onChange={(event) => setProfileForm({ ...profileForm, username: event.target.value })}
                maxLength={30}
                autoComplete="username"
              />
            </label>

            <p className="profile-hint">
              Seu perfil ajuda as pessoas a reconhecer você nas conversas em grupo.
            </p>

            <p className="profile-error" role="alert">
              {profileError}
            </p>

            <div className="profile-actions">
              <button
                className="profile-btn profile-btn-cancel"
                type="button"
                onClick={() => setProfileModalOpen(false)}
              >
                Cancelar
              </button>
              <button
                className="profile-btn profile-btn-save"
                type="button"
                onClick={handleProfileSave}
                disabled={profileLoading}
              >
                {profileLoading ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
