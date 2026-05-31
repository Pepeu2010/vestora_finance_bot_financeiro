import { useEffect, useMemo, useRef, useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

const DEVICE_KEY = "bot-financeiro-device-id";
const CONVERSATIONS_KEY = "bot-financeiro-conversations";
const CURRENT_CONVERSATION_KEY = "bot-financeiro-current-conversation";
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

function formatText(text) {
  return String(text || "").trim();
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
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
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
  const lines = String(text || "").split(/\r?\n/);
  const html = [];
  let listItems = [];

  function flushList() {
    if (listItems.length > 0) {
      html.push(`<ul>${listItems.join("")}</ul>`);
      listItems = [];
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (!line) {
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

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushList();
      html.push(`<h3>${formatInlineMarkdown(heading[2])}</h3>`);
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      listItems.push(`<li>${formatInlineMarkdown(bullet[1])}</li>`);
      continue;
    }

    flushList();
    html.push(`<p>${formatInlineMarkdown(line)}</p>`);
  }

  flushList();
  return html.join("");
}

function MessageBubble({ message }) {
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
      <article
        className="message bot"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text) }}
      />
    );
  }

  return <article className="message user">{message.text}</article>;
}

function StartScreen({ onPrompt }) {
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
    </section>
  );
}

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

  const messagesRef = useRef(null);
  const inputRef = useRef(null);
  const authHideTimer = useRef(null);

  const currentConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === currentConversationId) || null,
    [conversations, currentConversationId]
  );

  const messages = currentConversation?.messages || [];

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

  async function sendMessage(text) {
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

    setIsSending(true);
    setStatusText("Pesquisando fontes...");

    const typingId = crypto.randomUUID();
    appendMessageToConversation(activeConversationId, {
      id: typingId,
      role: "bot typing",
      text: "Digitando..."
    });

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          conversationId: activeConversationId,
          sessionId: activeConversationId || deviceId,
          message: text
        })
      });

      const data = await response.json();

      if (data.conversationId && data.conversationId !== activeConversationId) {
        replaceConversationId(activeConversationId, data.conversationId);
        activeConversationId = data.conversationId;
        setCurrentConversationId(data.conversationId);
        localStorage.setItem(CURRENT_CONVERSATION_KEY, data.conversationId);
      }

      removeMessageFromConversation(activeConversationId, typingId);

      if (!response.ok) {
        appendMessageToConversation(activeConversationId, {
          id: crypto.randomUUID(),
          role: "bot",
          text: data.error || "Não consegui responder agora. Tente novamente."
        });
        return;
      }

      appendMessageToConversation(activeConversationId, {
        id: crypto.randomUUID(),
        role: "bot",
        text: data.answer
      });
      await loadCloudConversations();
    } catch {
      removeMessageFromConversation(activeConversationId, typingId);
      appendMessageToConversation(activeConversationId, {
        id: crypto.randomUUID(),
        role: "bot",
        text: "Não consegui conectar ao servidor. Verifique se o Bot Financeiro está rodando."
      });
    } finally {
      setIsSending(false);
      setStatusText("Online");
      inputRef.current?.focus();
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (isSending) return;

    const text = formatText(input);
    if (!text) return;

    setComposerBurst(submitSource === "button" ? "sending-burst button-submit" : "sending-burst");
    window.setTimeout(() => setComposerBurst(""), 560);
    setSubmitSource("keyboard");

    setInput("");

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
    inputRef.current?.focus();
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
    const element = messagesRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length, currentConversationId]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [input]);

  return (
    <>
      <Analytics />
      <SpeedInsights />

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

      <main className="app-shell">
        <aside className="sidebar" aria-label="Painel do Bot Financeiro">
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
            <span aria-hidden="true">+</span>
            Novo chat
          </button>

          <section className="insight-panel sidebar-focus" aria-label="Visao financeira">
            <div>
              <span>Foco atual</span>
              <strong>Clareza financeira</strong>
            </div>
            <div className="meter" aria-hidden="true">
              <span></span>
            </div>
          </section>

          <section className="history-panel" aria-label="Histórico de conversas">
            <div className="history-head">
              <span>Recentes</span>
            </div>
            <div className="conversation-list" id="conversationList">
              {conversations.length === 0 ? (
                <p className="conversation-empty">Nenhuma conversa ainda.</p>
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
                      {conversation.title || "Nova conversa"}
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

        </aside>

        <section className="chat-panel" aria-label="Conversa com o Bot Financeiro">
          <header className="chat-header">
            <div className="chat-title">
              <strong>Bot Financeiro</strong>
              <span id="statusText">{statusText}</span>
            </div>
            <div className="chat-actions">
              <div className="live-pill" aria-hidden="true">
                <span></span>
                IA ativa
              </div>
              <button className="logout-button" id="logoutButton" type="button" onClick={handleLogout}>
                Sair
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
              />
            ) : (
              messages.map((message) => <MessageBubble key={message.id} message={message} />)
            )}
          </div>

          <form className={`composer ${composerBurst}`.trim()} id="chatForm" onSubmit={handleSubmit}>
            <textarea
              id="messageInput"
              name="message"
              rows="1"
              maxLength="1200"
              placeholder="Pergunte sobre investimentos, dívidas, reserva ou organização financeira..."
              autoComplete="off"
              ref={inputRef}
              value={input}
              disabled={isSending}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  setSubmitSource("keyboard");
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button
              id="sendButton"
              type="submit"
              aria-label="Enviar mensagem"
              title="Enviar mensagem"
              disabled={isSending}
              onPointerDown={() => setSubmitSource("button")}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 19V5" />
                <path d="M5 12l7-7 7 7" />
              </svg>
            </button>
          </form>
        </section>
      </main>
    </>
  );
}
