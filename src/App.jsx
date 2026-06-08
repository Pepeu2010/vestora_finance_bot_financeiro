import { useEffect, useMemo, useRef, useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

const DEVICE_KEY = "bot-financeiro-device-id";
const CONVERSATIONS_KEY = "bot-financeiro-conversations";
const CURRENT_CONVERSATION_KEY = "bot-financeiro-current-conversation";
const SETTINGS_KEY = "bot-financeiro-settings";
const AUTH_TRANSITION_MS = 420;

const QUICK_PROMPTS = [
  {
    label: "Comprar imóvel",
    prompt: "Quero comprar um imóvel. Quais dados você precisa para me orientar?"
  },
  {
    label: "Vender imóvel",
    prompt: "Quero vender um imóvel. Como definir preço, preparar anúncio e negociar?"
  },
  {
    label: "Financiamento",
    prompt: "Quero simular um financiamento imobiliário. Minha renda é R$ , entrada R$ , valor do imóvel R$ ."
  },
  {
    label: "Investir melhor",
    prompt: "Quero investir melhor. Minha renda é R$ , gastos R$ , objetivo e prazo são ."
  },
  {
    label: "Sair das dívidas",
    prompt: "Quero sair das dívidas. Tenho dívidas de R$ , juros aproximados de ao mês e renda de R$ ."
  },
  {
    label: "Montar reserva",
    prompt: "Quero montar uma reserva de emergência. Meus gastos mensais são R$ ."
  }
];

// Atalhos financeiros de consulta rápida — aparecem embaixo do chat
const SHORTCUT_ACTIONS = [
  {
    id: "salario-minimo",
    icon: "💼",
    label: "Salário Mínimo",
    prompt: "Qual é o valor atual do salário mínimo no Brasil em 2026?"
  },
  {
    id: "dolar-hoje",
    icon: "💵",
    label: "Dólar Hoje",
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
    label: "Bitcoin Hoje",
    prompt: "Qual é a cotação atual do Bitcoin em reais e em dólares?"
  }
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
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
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
      vozBot: true,
      vozAvancada: true,
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
      vozBot: true,
      vozAvancada: true,
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
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function formatText(text) {
  return String(text || "").trim();
}

function getDisplayName(user) {
  return user?.name || user?.email?.split("@")[0] || "Usuário";
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
    { terms: ["investir", "investimento", "acoes", "fii", "renda fixa"], title: "Plano de investimentos" }
  ];

  const matched = titleRules.find((rule) =>
    rule.terms.some((term) => normalized.includes(term))
  );

  if (matched) return matched.title;
  if (!clean) return "Nova conversa";
  return clean.length > 44 ? `${clean.slice(0, 44)}...` : clean;
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

function renderMarkdown(text) {
  const raw = String(text || "");
  const lines = raw.split(/\r?\n/);
  const html = [];
  let listItems = [];
  let orderedItems = [];
  let inCodeBlock = false;
  let codeLines = [];
  let codeLanguage = "";

  function flushList() {
    if (listItems.length > 0) {
      html.push(`<ul>${listItems.join("")}</ul>`);
      listItems = [];
    }
    if (orderedItems.length > 0) {
      html.push(`<ol>${orderedItems.join("")}</ol>`);
      orderedItems = [];
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    // Fenced code blocks
    if (line.trimStart().startsWith("```")) {
      if (inCodeBlock) {
        html.push(`<div class="code-block"><div class="code-block-header">${codeLanguage || "código"}</div><pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre></div>`);
        codeLines = [];
        codeLanguage = "";
        inCodeBlock = false;
      } else {
        flushList();
        inCodeBlock = true;
        codeLanguage = line.trim().slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    const table = renderTable(lines, index);
    if (table) {
      flushList();
      html.push(table.html);
      index = table.nextIndex - 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushList();
      html.push(`<h3>${formatInlineMarkdown(heading[2])}</h3>`);
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      orderedItems = [];
      listItems.push(`<li>${formatInlineMarkdown(bullet[1])}</li>`);
      continue;
    }

    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      listItems = [];
      orderedItems.push(`<li>${formatInlineMarkdown(ordered[1])}</li>`);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith("> ")) {
      flushList();
      html.push(`<blockquote class="message-quote">${formatInlineMarkdown(trimmed.slice(2))}</blockquote>`);
      continue;
    }

    flushList();
    html.push(`<p>${formatInlineMarkdown(trimmed)}</p>`);
  }

  // Flush any unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    html.push(`<div class="code-block"><pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre></div>`);
  }

  flushList();
  return html.join("");
}

function MessageSources({ sources }) {
  return null;
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
        <article
          className={`message bot${message.hasError ? " has-error" : ""}`}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text) }}
        />
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

  return <article className="message user">{message.text}</article>;
}

function StartScreen({ onPrompt, onSend }) {
  return (
    <section className="start-screen" aria-label="Novo chat">
      <div className="start-brand" aria-hidden="true">
        <img src="/icon.svg?v=34" alt="" />
      </div>
      <p className="start-kicker">Bot Financeiro</p>
      <h2>Qual decisão financeira você quer clarear hoje?</h2>
      <p className="start-copy">
        Pergunte sobre dinheiro, imóveis, financiamento, investimentos, dívidas ou planejamento.
      </p>
      <div className="summary start-prompts" aria-label="Sugestões de conversa">
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
      <div className="start-shortcuts" aria-label="Consultas rápidas">
        <p className="start-shortcuts-label">Consulta imediata</p>
        <div className="start-shortcuts-grid">
          {SHORTCUT_ACTIONS.map((action) => (
            <button
              key={action.id}
              id={`shortcut-${action.id}`}
              type="button"
              className="shortcut-card"
              onClick={() => onSend(action.prompt)}
            >
              <span className="shortcut-icon">{action.icon}</span>
              <span className="shortcut-label">{action.label}</span>
            </button>
          ))}
        </div>
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
    composerPlaceholder: "Pergunte ao Bot Financeiro",
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
    composerPlaceholder: "Ask Financial Bot",
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
    composerPlaceholder: "Pregunta al Bot Financiero",
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

  // Input draft auto-save (debounced)
  const DRAFT_KEY = "bot-financeiro-draft";
  const inputTimeoutRef = useRef(null);

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
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: "", username: "" });
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("personalizacao");
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

  // Voice recognition state
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
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

  function showToast(message, type = "info", duration = 4000) {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
    }, duration);
  }

  function startListening() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      showToast('Voz não suportada neste navegador. Use Chrome ou Edge.', 'error');
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'pt-BR';
    recognition.maxAlternatives = 1;

    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setIsListening(true);
      setStatusText('Ouvindo...');
    };

    recognition.onresult = (event) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (finalTranscript) {
        setInput((prev) => (prev ? prev + ' ' + finalTranscript : finalTranscript));
      }
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      setStatusText('Online');

      if (event.error === 'not-allowed') {
        showToast('Permissão de microfone negada. permita o acesso nas configurações.', 'error');
      } else if (event.error === 'no-speech') {
        showToast('Nenhuma fala detectada. Tente novamente.', 'info');
      } else if (event.error !== 'aborted') {
        showToast('Erro no reconhecimento de voz.', 'error');
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      setStatusText('Online');
      inputRef.current?.focus();
    };

    try {
      recognition.start();
    } catch {
      showToast('Erro ao iniciar o microfone.', 'error');
      setIsListening(false);
    }
  }

  function stopListening() {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setStatusText('Online');
    inputRef.current?.focus();
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
      const response = await fetch("/api/auth/password", {
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

  function speakText(text) {
    if (!settings.vozBot) return;
    if (!window.speechSynthesis) return;

    window.speechSynthesis.cancel();

    const cleanText = text
      .replace(/<[^>]*>/g, "")
      .replace(/[*#_~`\[\]()|]/g, "")
      .trim();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    const langMap = { "pt-br": "pt-BR", "en": "en-US", "es": "es-ES" };
    utterance.lang = langMap[settings.idioma] || "pt-BR";

    if (settings.vozAvancada) {
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      const voices = window.speechSynthesis.getVoices();
      const preferredVoice = voices.find(v => 
        v.lang.startsWith(utterance.lang.slice(0, 2)) &&
        (v.name.includes("Google") || v.name.includes("Natural") || v.name.includes("Microsoft"))
      );
      if (preferredVoice) utterance.voice = preferredVoice;
    } else {
      utterance.rate = 1.0;
    }

    window.speechSynthesis.speak(utterance);
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

  function removeMessage(id) {
    if (!currentConversationId) return;

    updateConversation(currentConversationId, (conversation) => ({
      messages: (conversation.messages || []).filter((message) => message.id !== id)
    }));
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
        showAuth();
        return false;
      }

      setCurrentUser(data.user);
      hideAuth();
      return true;
    } catch {
      showAuth();
      return false;
    }
  }

  async function loadCloudMessages(conversationId) {
    const response = await fetch(`/api/conversations/${conversationId}/messages`);
    const data = await response.json();

    if (!response.ok || !data.configured) return null;
    return data.messages || [];
  }

  async function openConversation(conversationId) {
    setCurrentConversationId(conversationId);
    localStorage.setItem(CURRENT_CONVERSATION_KEY, conversationId);
    setStatusText("Carregando...");

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

    setStatusText("Online");
    setIsSidebarOpen(false);
  }

  async function loadCloudConversations() {
    if (!currentUser) return;

    try {
      const response = await fetch("/api/conversations");

      if (response.status === 401) {
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
        const response = await fetch(`/api/conversations/${conversationId}`, {
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

  async function sendMessage(text) {
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
      text
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

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeConversationId,
          sessionId: activeConversationId || deviceId,
          message: text,
          settings: settings,
          stream: true
        }),
        signal: abortController.signal
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        removeMessageFromConversation(activeConversationId, typingId);
        appendMessageToConversation(activeConversationId, {
          id: crypto.randomUUID(),
          role: "bot",
          text: data.error || "Não consegui responder agora.",
          hasError: true,
          retryFor: text
        });
        showToast(data.error || "Erro ao enviar mensagem", "error");
        return;
      }

      // Streaming: read SSE line by line
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamText = "";
      let streamSources = [];
      let finalConversationId = activeConversationId;
      const botMsgId = crypto.randomUUID();

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
              throw new Error(event.error);
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
        speakText(streamText);
        showToast("Mensagem enviada", "success", 2000);
        await loadCloudConversations();
      }
    } catch (error) {
      if (error.name === "AbortError") {
        // User stopped generation — keep partial text
        removeMessageFromConversation(activeConversationId, typingId);
        showToast("Geração interrompida", "info", 2000);
      } else {
        removeMessageFromConversation(activeConversationId, typingId);
        appendMessageToConversation(activeConversationId, {
          id: crypto.randomUUID(),
          role: "bot",
          text: "Não consegui conectar ao servidor.",
          hasError: true,
          retryFor: text
        });
        showToast("Erro de conexão", "error");
      }
    } finally {
      abortControllerRef.current = null;
      sendingLockRef.current = false;
      setIsSending(false);
      setStatusText(t("online"));
      inputRef.current?.focus();
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (isSending || sendingLockRef.current) return;

    const text = formatText(input);
    if (!text) return;

    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    setComposerBurst(submitSource === "button" ? "sending-burst button-submit" : "sending-burst");
    window.setTimeout(() => setComposerBurst(""), 560);
    setSubmitSource("keyboard");

    setInput("");
    localStorage.removeItem(DRAFT_KEY);

    await sendMessage(text);
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();

    setAuthError("");
    setAuthLoading(true);

    try {
      const response = await fetch(isRegisterMode ? "/api/auth/register" : "/api/auth/login", {
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
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setAccountMenuOpen(false);
    setIsSidebarOpen(false);
    setCurrentUser(null);
    setCurrentConversationId("");
    localStorage.removeItem(CURRENT_CONVERSATION_KEY);
    persistConversations([]);
    showAuth();
  }

  function handleNewChat() {
    setCurrentConversationId("");
    localStorage.removeItem(CURRENT_CONVERSATION_KEY);
    setStatusText("Online");
    setIsSidebarOpen(false);
    inputRef.current?.focus();
  }

  function handleAccountInfo(label) {
    setAccountMenuOpen(false);
    setStatusText(label);
    window.setTimeout(() => setStatusText("Online"), 1500);
  }

  function openProfileModal() {
    setAccountMenuOpen(false);
    setProfileForm({
      name: currentUser?.name || "",
      username: currentUser?.username || ""
    });
    setProfileError("");
    setProfileModalOpen(true);
  }

  function openSettings() {
    setAccountMenuOpen(false);
    setSettingsTab("personalizacao");
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
      const response = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileForm)
      });

      const data = await response.json();

      if (!response.ok) {
        setProfileError(data.error || "Nao consegui atualizar o perfil.");
        return;
      }

      setCurrentUser(data.user);
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
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

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
    if (element) element.scrollTop = element.scrollHeight;
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
      <Analytics />
      <SpeedInsights />

      <a href="#main-content" className="skip-link">Pular para o conteúdo principal</a>

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
          aria-label="Login do Bot Financeiro"
        >
          <form className="auth-card" id="authForm" onSubmit={handleAuthSubmit}>
            <div className="brand auth-brand">
              <div className="brand-mark" aria-hidden="true">
                <img src="/icon.svg?v=34" alt="" />
              </div>
              <div>
                <h1>Bot Financeiro</h1>
                <p>Entre para organizar decisões financeiras e imobiliárias</p>
              </div>
            </div>

            {isRegisterMode && (
              <input
                id="authName"
                name="name"
                type="text"
                placeholder="Nome"
                autoComplete="name"
                value={authForm.name}
                onChange={(event) => setAuthForm({ ...authForm, name: event.target.value })}
              />
            )}
            <input
              id="authEmail"
              name="email"
              type="email"
              placeholder="Email"
              autoComplete="email"
              required
              value={authForm.email}
              onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })}
            />
            <input
              id="authPassword"
              name="password"
              type="password"
              placeholder="Senha"
              autoComplete={isRegisterMode ? "new-password" : "current-password"}
              required
              minLength="6"
              value={authForm.password}
              onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}
            />
            <p className="auth-error" id="authError" role="alert">
              {authError}
            </p>
            <button id="authSubmit" type="submit" disabled={authLoading}>
              {isRegisterMode ? "Criar conta" : "Entrar"}
            </button>
            <button
              className="auth-toggle"
              id="authToggle"
              type="button"
              onClick={() => {
                setIsRegisterMode(!isRegisterMode);
                setAuthError("");
              }}
            >
              {isRegisterMode ? "Já tenho conta" : "Criar conta"}
            </button>
          </form>
        </section>
      )}

      <main className="app-shell" id="main-content">
        <button
          className={`sidebar-scrim${isSidebarOpen ? " open" : ""}`}
          type="button"
          aria-label="Fechar menu"
          onClick={() => setIsSidebarOpen(false)}
        ></button>

        <aside className={`sidebar${isSidebarOpen ? " open" : ""}`} aria-label="Painel do Bot Financeiro">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              <img src="/icon.svg?v=34" alt="" />
            </div>
            <div>
              <h1>Bot Financeiro</h1>
              <p>Consultor de educação financeira</p>
            </div>
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
 
          <section className="history-panel" aria-label="Histórico de conversas">
            <div className="history-head">
              <span>{t("recent")}</span>
            </div>
            <div className="conversation-list" id="conversationList">
              {conversations.length === 0 ? (
                <p className="conversation-empty">{t("emptyHistory")}</p>
              ) : (
                conversations.map((conversation) => (
                  <div className="conversation-item" key={conversation.id}>
                    <button
                      className={`conversation-open${
                        conversation.id === currentConversationId ? " active" : ""
                      }`}
                      type="button"
                      data-id={conversation.id}
                      onClick={() => openConversation(conversation.id)}
                    >
                      {conversation.title || t("newChat")}
                    </button>
                    <button
                      className="conversation-delete"
                      type="button"
                      data-id={conversation.id}
                      title="Apagar conversa"
                      aria-label="Apagar conversa"
                      onClick={() => deleteConversation(conversation.id)}
                    >
                      <span></span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
 
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
                  onClick={openSettings}
                >
                  <span aria-hidden="true">✦</span>
                  {t("personalization")}
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

        <section className="chat-panel" aria-label="Conversa com o Bot Financeiro">
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
              <strong>Bot Financeiro</strong>
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

          <div className="shortcuts-bar" aria-label="Atalhos financeiros" id="shortcutsBar">
            {SHORTCUT_ACTIONS.map((action) => (
              <button
                key={action.id}
                id={`chat-shortcut-${action.id}`}
                type="button"
                className="shortcuts-bar-item"
                title={action.prompt}
                disabled={isSending}
                onClick={() => {
                  if (!isSending) sendMessage(action.prompt);
                }}
              >
                <span>{action.icon}</span>
                <span>{action.label}</span>
              </button>
            ))}
          </div>

          <form className={`composer ${composerBurst}`.trim()} id="chatForm" onSubmit={handleSubmit}>
            <button
              id="micButton"
              type="button"
              className={`mic-button${isListening ? " listening" : ""}`}
              aria-label={isListening ? "Ouvindo... clique para parar" : "Entrada por voz"}
              title="Falar para o bot"
              disabled={isSending}
              onClick={() => {
                if (isListening) {
                  stopListening();
                  return;
                }
                startListening();
              }}
            >
              {isListening ? (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="2" width="6" height="11" rx="3" />
                  <path d="M5 10a7 7 0 0 0 14 0" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                  <line x1="9" y1="22" x2="15" y2="22" />
                </svg>
              )}
            </button>
            <textarea
              id="messageInput"
              name="message"
              rows="1"
              maxLength="1200"
              placeholder="Pergunte ao Bot Financeiro"
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
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                {t("notifications")}
              </button>
              <button
                className={`settings-nav-item${settingsTab === "personalizacao" ? " active" : ""}`}
                type="button"
                onClick={() => setSettingsTab("personalizacao")}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                {t("personalization")}
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
              {settingsTab === "personalizacao" && (
                <div className="settings-pane">
                  <h2 className="settings-pane-title">{t("personalization")}</h2>

                  <div className="settings-section">
                    <div className="settings-row">
                      <div className="settings-row-text">
                        <strong>Estilo e tom básicos</strong>
                        <span>Defina o tom e o estilo que o Bot Financeiro usa ao responder.</span>
                      </div>
                      <select
                        className="settings-select"
                        value={settings.estiloTom}
                        onChange={(e) => updateSetting("estiloTom", e.target.value)}
                      >
                        <option value="padrao">Padrão</option>
                        <option value="formal">Formal</option>
                        <option value="informal">Informal</option>
                        <option value="didatico">Didático</option>
                      </select>
                    </div>
                  </div>

                  <div className="settings-section">
                    <h3 className="settings-section-title">Características</h3>
                    <p className="settings-section-desc">Escolha personalizações adicionais junto com o estilo e tom básicos.</p>

                    <div className="settings-row">
                      <span className="settings-row-label">Acolhedor</span>
                      <select
                        className="settings-select"
                        value={settings.acolhedor}
                        onChange={(e) => updateSetting("acolhedor", e.target.value)}
                      >
                        <option value="padrao">Padrão</option>
                        <option value="sim">Sim</option>
                        <option value="nao">Não</option>
                      </select>
                    </div>

                    <div className="settings-row">
                      <span className="settings-row-label">Entusiasmado</span>
                      <select
                        className="settings-select"
                        value={settings.entusiasmado}
                        onChange={(e) => updateSetting("entusiasmado", e.target.value)}
                      >
                        <option value="padrao">Padrão</option>
                        <option value="sim">Sim</option>
                        <option value="nao">Não</option>
                      </select>
                    </div>

                    <div className="settings-row">
                      <span className="settings-row-label">Listas e cabeçalhos</span>
                      <select
                        className="settings-select"
                        value={settings.listasCabecalhos}
                        onChange={(e) => updateSetting("listasCabecalhos", e.target.value)}
                      >
                        <option value="padrao">Padrão</option>
                        <option value="sim">Sim</option>
                        <option value="nao">Não</option>
                      </select>
                    </div>

                    <div className="settings-row">
                      <span className="settings-row-label">Emoji</span>
                      <select
                        className="settings-select"
                        value={settings.emoji}
                        onChange={(e) => updateSetting("emoji", e.target.value)}
                      >
                        <option value="padrao">Padrão</option>
                        <option value="sim">Sim</option>
                        <option value="nao">Não</option>
                      </select>
                    </div>
                  </div>

                  <div className="settings-section">
                    <div className="settings-row settings-row-col">
                      <div className="settings-row-text">
                        <strong>Respostas rápidas</strong>
                        <span>Às vezes, o Bot Financeiro pode usar conhecimento geral para dar respostas rápidas e detalhadas. Elas não são personalizadas e não usam sua memória.</span>
                      </div>
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={settings.respostasRapidas}
                          onChange={(e) => updateSetting("respostasRapidas", e.target.checked)}
                        />
                        <span className="settings-toggle-slider"></span>
                      </label>
                    </div>
                  </div>

                  <div className="settings-section">
                    <h3 className="settings-section-title">Instruções personalizadas</h3>
                    <textarea
                      className="settings-textarea"
                      placeholder="Outras preferências de tom, estilo e comportamento"
                      value={settings.instrucoesPersonalizadas}
                      onChange={(e) => updateSetting("instrucoesPersonalizadas", e.target.value)}
                      rows={3}
                    />
                  </div>

                  <div className="settings-section">
                    <h3 className="settings-section-title">Sobre você</h3>

                    <label className="settings-field">
                      <span className="settings-field-label">Apelido</span>
                      <input
                        type="text"
                        className="settings-input"
                        placeholder="Como o Bot Financeiro deveria te chamar?"
                        value={settings.apelido}
                        onChange={(e) => updateSetting("apelido", e.target.value)}
                      />
                    </label>

                    <label className="settings-field">
                      <span className="settings-field-label">Ocupação</span>
                      <input
                        type="text"
                        className="settings-input"
                        placeholder="Ex: Representante farmacêutico"
                        value={settings.ocupacao}
                        onChange={(e) => updateSetting("ocupacao", e.target.value)}
                      />
                    </label>

                    <label className="settings-field">
                      <span className="settings-field-label">Mais sobre você</span>
                      <textarea
                        className="settings-textarea"
                        placeholder="Interesses, valores ou preferências a serem lembrados"
                        value={settings.maisSobreVoce}
                        onChange={(e) => updateSetting("maisSobreVoce", e.target.value)}
                        rows={2}
                      />
                    </label>
                  </div>

                  <div className="settings-section">
                    <div className="settings-row settings-row-col">
                      <div className="settings-row-text">
                        <strong>Memória</strong>
                      </div>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <span>Referenciar memórias salvas</span>
                        <small>Permitir que o Bot Financeiro salve e use memórias ao responder.</small>
                      </div>
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={settings.referenciarMemorias}
                          onChange={(e) => updateSetting("referenciarMemorias", e.target.checked)}
                        />
                        <span className="settings-toggle-slider"></span>
                      </label>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <span>Referenciar histórico de chats</span>
                        <small>Permitir que o Bot Financeiro referencie conversas recentes ao responder.</small>
                      </div>
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={settings.referenciarHistorico}
                          onChange={(e) => updateSetting("referenciarHistorico", e.target.checked)}
                        />
                        <span className="settings-toggle-slider"></span>
                      </label>
                    </div>
                  </div>

                  <div className="settings-section">
                    <h3 className="settings-section-title">Avançado</h3>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <span>Busca na web</span>
                        <small>Deixe o Bot Financeiro buscar respostas na Web automaticamente.</small>
                      </div>
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={settings.buscaNaWeb}
                          onChange={(e) => updateSetting("buscaNaWeb", e.target.checked)}
                        />
                        <span className="settings-toggle-slider"></span>
                      </label>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <span>Lousa</span>
                        <small>Colabore com o Bot Financeiro em textos e códigos.</small>
                      </div>
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={settings.lousa}
                          onChange={(e) => updateSetting("lousa", e.target.checked)}
                        />
                        <span className="settings-toggle-slider"></span>
                      </label>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <span>Voz do Bot Financeiro</span>
                        <small>Habilitar Voz no Bot Financeiro.</small>
                      </div>
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={settings.vozBot}
                          onChange={(e) => updateSetting("vozBot", e.target.checked)}
                        />
                        <span className="settings-toggle-slider"></span>
                      </label>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <span>Voz avançada</span>
                        <small>Tenha conversas mais naturais com a Voz.</small>
                      </div>
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={settings.vozAvancada}
                          onChange={(e) => updateSetting("vozAvancada", e.target.checked)}
                        />
                        <span className="settings-toggle-slider"></span>
                      </label>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <span>Busca do conector</span>
                        <small>Deixe o Bot Financeiro buscar respostas nas fontes conectadas automaticamente.</small>
                      </div>
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={settings.buscaConector}
                          onChange={(e) => updateSetting("buscaConector", e.target.checked)}
                        />
                        <span className="settings-toggle-slider"></span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {settingsTab === "geral" && (
                <div className="settings-pane">
                  <h2 className="settings-pane-title">{t("general")}</h2>

                  <div className="settings-section">
                    <h3 className="settings-section-title">Aparência</h3>
                    <p className="settings-section-desc">Personalize a aparência do Bot Financeiro.</p>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <strong>{t("language")}</strong>
                        <small>Escolha o idioma de interface do Bot Financeiro.</small>
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
                        a.download = "bot-financeiro-dados.json";
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
                              await fetch("/api/conversations", { method: "DELETE" }).catch(() => {});
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
                        <strong>Bot Financeiro</strong>
                        <small>Versão 1.0.0 — Consultor de educação financeira com IA.</small>
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-text">
                        <small>Desenvolvido para ajudar você a tomar decisões financeiras mais inteligentes sobre imóveis, investimentos, dívidas e planejamento.</small>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {settingsTab === "notificacoes" && (
                <div className="settings-pane">
                  <h2 className="settings-pane-title">{t("notifications")}</h2>
                  <p className="settings-empty-text">Configure alertas e resumos para acompanhar suas finanças.</p>

                  <div className="settings-section">
                    <h3 className="settings-section-title">Alertas</h3>
                    <p className="settings-section-desc">Receba notificações quando algo importante acontecer no mercado ou nas suas metas.</p>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <strong>Alertas de mercado</strong>
                        <small>Notificações sobre variações significativas da Selic, IPCA, CDI e indicadores econômicos.</small>
                      </div>
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={settings.alertasMercado}
                          onChange={(e) => updateSetting("alertasMercado", e.target.checked)}
                        />
                        <span className="settings-toggle-slider"></span>
                      </label>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <strong>Alertas de preços</strong>
                        <small>Avisos quando imóveis ou produtos financeiros atingirem faixas de preço de interesse.</small>
                      </div>
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={settings.alertasPrecos}
                          onChange={(e) => updateSetting("alertasPrecos", e.target.checked)}
                        />
                        <span className="settings-toggle-slider"></span>
                      </label>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <strong>Notícias financeiras</strong>
                        <small>Resumos de notícias relevantes sobre investimentos, impostos e economia pessoal.</small>
                      </div>
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={settings.noticiasFinanceiras}
                          onChange={(e) => updateSetting("noticiasFinanceiras", e.target.checked)}
                        />
                        <span className="settings-toggle-slider"></span>
                      </label>
                    </div>
                  </div>

                  <div className="settings-section">
                    <h3 className="settings-section-title">Resumos</h3>
                    <p className="settings-section-desc">Receba resumos periódicos do seu progresso financeiro e das suas conversas.</p>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <strong>Resumo financeiro periódico</strong>
                        <small>Um resumo com indicadores do mercado e dicas personalizadas com base no seu perfil.</small>
                      </div>
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={settings.resumoDiario}
                          onChange={(e) => updateSetting("resumoDiario", e.target.checked)}
                        />
                        <span className="settings-toggle-slider"></span>
                      </label>
                    </div>

                    <div className="settings-row settings-row-col">
                      <div className="settings-row-text">
                        <strong>Frequência do resumo</strong>
                        <small>Com que frequência você deseja receber o resumo financeiro.</small>
                      </div>
                      <select
                        className="settings-select"
                        value={settings.frequenciaResumo}
                        onChange={(e) => updateSetting("frequenciaResumo", e.target.value)}
                      >
                        <option value="diario">Diário</option>
                        <option value="semanal">Semanal</option>
                        <option value="quinzenal">Quinzenal</option>
                        <option value="mensal">Mensal</option>
                        <option value="desabilitado">Desabilitado</option>
                      </select>
                    </div>
                  </div>

                  <div className="settings-section">
                    <h3 className="settings-section-title">Metas e Lembretes</h3>
                    <p className="settings-section-desc">Acompanhe suas metas financeiras com lembretes inteligentes.</p>

                    <div className="settings-row">
                      <div className="settings-row-text">
                        <strong>Lembretes de metas</strong>
                        <small>Receba lembretes sobre suas metas de reserva, investimento ou pagamento de dívidas.</small>
                      </div>
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={settings.lembretesMetas}
                          onChange={(e) => updateSetting("lembretesMetas", e.target.checked)}
                        />
                        <span className="settings-toggle-slider"></span>
                      </label>
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
                        <small>{currentUser?.name || "Não definido"}</small>
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
                        <small>{currentUser?.username || "Não definido"}</small>
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
                          <label style={{ fontSize: "12px", fontWeight: "700" }}>{t("currentPasswordLabel")}</label>
                          <input
                            type="password"
                            required
                            className="settings-input"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                          />
                        </div>
                        <div style={{ display: "grid", gap: "4px" }}>
                          <label style={{ fontSize: "12px", fontWeight: "700" }}>{t("newPasswordLabel")}</label>
                          <input
                            type="password"
                            required
                            className="settings-input"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                          />
                        </div>
                        <div style={{ display: "grid", gap: "4px" }}>
                          <label style={{ fontSize: "12px", fontWeight: "700" }}>{t("confirmNewPasswordLabel")}</label>
                          <input
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
