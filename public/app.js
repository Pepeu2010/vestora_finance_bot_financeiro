const messagesEl = document.querySelector("#messages");
const chatForm = document.querySelector("#chatForm");
const messageInput = document.querySelector("#messageInput");
const sendButton = document.querySelector("#sendButton");
const statusText = document.querySelector("#statusText");
const newChatButton = document.querySelector("#newChatButton");
const promptButtons = document.querySelectorAll("[data-prompt]");
const conversationListEl = document.querySelector("#conversationList");
const storageStatusEl = document.querySelector("#storageStatus");
const syncButton = document.querySelector("#syncButton");
const authScreen = document.querySelector("#authScreen");
const authForm = document.querySelector("#authForm");
const authName = document.querySelector("#authName");
const authEmail = document.querySelector("#authEmail");
const authPassword = document.querySelector("#authPassword");
const authError = document.querySelector("#authError");
const authSubmit = document.querySelector("#authSubmit");
const authToggle = document.querySelector("#authToggle");
const logoutButton = document.querySelector("#logoutButton");

const DEVICE_KEY = "bot-financeiro-device-id";
const CONVERSATIONS_KEY = "bot-financeiro-conversations";
const CURRENT_CONVERSATION_KEY = "bot-financeiro-current-conversation";

let deviceId = getOrCreateDeviceId();
let conversations = loadLocalConversations();
let currentConversationId = localStorage.getItem(CURRENT_CONVERSATION_KEY) || "";
let messages = getCurrentMessages();
let isSending = false;
let cloudEnabled = false;
let submitSource = "keyboard";
let isRegisterMode = false;
let currentUser = null;

function getOrCreateDeviceId() {
  const saved = localStorage.getItem(DEVICE_KEY);
  if (saved) return saved;

  const id = crypto.randomUUID();
  localStorage.setItem(DEVICE_KEY, id);
  return id;
}

function setDeviceId(nextDeviceId) {
  const clean = String(nextDeviceId || "").trim();

  if (!/^[a-zA-Z0-9_-]{12,120}$/.test(clean)) {
    return false;
  }

  deviceId = clean;
  localStorage.setItem(DEVICE_KEY, deviceId);
  return true;
}

function showAuth() {
  currentUser = null;
  authScreen.classList.add("visible");
}

function hideAuth() {
  authScreen.classList.remove("visible");
}

function setAuthMode(registerMode) {
  isRegisterMode = registerMode;
  authName.style.display = registerMode ? "block" : "none";
  authSubmit.textContent = registerMode ? "Criar conta" : "Entrar";
  authToggle.textContent = registerMode ? "Já tenho conta" : "Criar conta";
  authError.textContent = "";
}

async function checkAuth() {
  const response = await fetch("/api/auth/me");
  const data = await response.json();

  if (!data.authenticated) {
    showAuth();
    return false;
  }

  currentUser = data.user;
  hideAuth();
  return true;
}

function loadLocalConversations() {
  try {
    return JSON.parse(localStorage.getItem(CONVERSATIONS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalConversations() {
  localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
}

function getCurrentConversation() {
  return conversations.find((conversation) => conversation.id === currentConversationId) || null;
}

function getCurrentMessages() {
  const conversation = getCurrentConversation();
  return conversation ? conversation.messages || [] : [];
}

function makeTitle(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "Nova conversa";
  return clean.length > 44 ? `${clean.slice(0, 44)}...` : clean;
}

function ensureLocalConversation(firstMessage = "") {
  let conversation = getCurrentConversation();

  if (conversation) return conversation;

  conversation = {
    id: crypto.randomUUID(),
    title: makeTitle(firstMessage),
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  conversations.unshift(conversation);
  currentConversationId = conversation.id;
  localStorage.setItem(CURRENT_CONVERSATION_KEY, currentConversationId);
  saveLocalConversations();
  renderConversationList();
  return conversation;
}

function persistCurrentMessages() {
  const conversation = getCurrentConversation();
  if (!conversation) return;

  conversation.messages = messages;
  conversation.updatedAt = new Date().toISOString();
  saveLocalConversations();
  renderConversationList();
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function formatText(text) {
  return String(text || "").trim();
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

function addMessage(role, text, options = {}) {
  ensureLocalConversation(text);

  const message = {
    id: options.id || crypto.randomUUID(),
    role,
    text
  };

  messages.push(message);
  persistCurrentMessages();
  renderMessages();
  return message;
}

function removeMessage(id) {
  messages = messages.filter((message) => message.id !== id);
  persistCurrentMessages();
  renderMessages();
}

function renderMessages() {
  messagesEl.innerHTML = "";

  if (messages.length === 0) {
    addWelcomeMessage();
    return;
  }

  for (const message of messages) {
    const bubble = document.createElement("article");
    bubble.className = `message ${message.role}`;

    if (message.role === "bot typing") {
      bubble.setAttribute("aria-label", "Bot digitando");
      bubble.innerHTML = `
        <span class="typing-indicator" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </span>
      `;
    } else if (message.role === "bot") {
      bubble.innerHTML = renderMarkdown(message.text);
    } else {
      bubble.textContent = message.text;
    }

    messagesEl.appendChild(bubble);
  }

  scrollToBottom();
}

function addWelcomeMessage() {
  const bubble = document.createElement("article");
  bubble.className = "message bot";
  bubble.innerHTML = renderMarkdown("Olá. Sou o Bot Financeiro. Posso te ajudar a organizar dinheiro, montar reserva, entender investimentos, FIIs, financiamento, imóveis e planejamento. Qual decisão financeira você quer clarear hoje?");
  messagesEl.appendChild(bubble);
}

function renderConversationList() {
  conversationListEl.innerHTML = "";

  if (conversations.length === 0) {
    const empty = document.createElement("p");
    empty.className = "conversation-empty";
    empty.textContent = "Nenhuma conversa ainda.";
    conversationListEl.appendChild(empty);
    return;
  }

  for (const conversation of conversations) {
    const item = document.createElement("div");
    item.className = "conversation-item";

    const openButton = document.createElement("button");
    openButton.className = "conversation-open";
    if (conversation.id === currentConversationId) {
      openButton.classList.add("active");
    }
    openButton.type = "button";
    openButton.dataset.id = conversation.id;
    openButton.textContent = conversation.title || "Nova conversa";

    const deleteButton = document.createElement("button");
    deleteButton.className = "conversation-delete";
    deleteButton.type = "button";
    deleteButton.dataset.id = conversation.id;
    deleteButton.title = "Apagar conversa";
    deleteButton.setAttribute("aria-label", "Apagar conversa");
    deleteButton.innerHTML = "<span></span>";

    item.append(openButton, deleteButton);
    conversationListEl.appendChild(item);
  }
}

function setSendingState(sending) {
  isSending = sending;
  sendButton.disabled = sending;
  messageInput.disabled = sending;
  statusText.textContent = sending ? "Digitando..." : "Online";
}

function resizeInput() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${messageInput.scrollHeight}px`;
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

    cloudEnabled = Boolean(data.configured);
    storageStatusEl.textContent = cloudEnabled ? "nuvem" : "local";

    if (!cloudEnabled || !Array.isArray(data.conversations)) return;

    const previousConversations = new Map(
      conversations.map((conversation) => [conversation.id, conversation])
    );

    conversations = data.conversations.map((conversation) => {
      const previous = previousConversations.get(conversation.id);

      return {
        id: conversation.id,
        title: conversation.title,
        messages: previous?.messages || [],
        createdAt: conversation.created_at,
        updatedAt: conversation.updated_at
      };
    });

    saveLocalConversations();

    if (!currentConversationId && conversations[0]) {
      currentConversationId = conversations[0].id;
      localStorage.setItem(CURRENT_CONVERSATION_KEY, currentConversationId);
      await openConversation(currentConversationId);
      return;
    }

    const activeConversation = getCurrentConversation();
    if (activeConversation) {
      messages = activeConversation.messages || [];
    }

    renderConversationList();
  } catch {
    cloudEnabled = false;
    storageStatusEl.textContent = "local";
  }
}

async function syncDeviceHistory() {
  await loadCloudConversations();
}

async function loadCloudMessages(conversationId) {
  if (!cloudEnabled) return null;

  const response = await fetch(`/api/conversations/${conversationId}/messages`);
  const data = await response.json();

  if (!response.ok || !data.configured) return null;
  return data.messages || [];
}

async function openConversation(conversationId) {
  currentConversationId = conversationId;
  localStorage.setItem(CURRENT_CONVERSATION_KEY, currentConversationId);

  const conversation = getCurrentConversation();
  if (!conversation) return;

  messages = conversation.messages || [];
  renderConversationList();
  renderMessages();
  statusText.textContent = "Carregando...";

  const cloudMessages = await loadCloudMessages(conversationId);
  if (cloudMessages) {
    conversation.messages = cloudMessages.map((message) => ({
      id: crypto.randomUUID(),
      role: message.role,
      text: message.text
    }));
    saveLocalConversations();
  }

  messages = conversation.messages || [];
  statusText.textContent = "Online";
  renderConversationList();
  renderMessages();
}

async function deleteConversation(conversationId) {
  if (cloudEnabled) {
    await fetch(`/api/conversations/${conversationId}`, {
      method: "DELETE"
    }).catch(() => {});
  }

  conversations = conversations.filter((conversation) => conversation.id !== conversationId);

  if (currentConversationId === conversationId) {
    currentConversationId = conversations[0]?.id || "";
    localStorage.setItem(CURRENT_CONVERSATION_KEY, currentConversationId);
    messages = getCurrentMessages();
  }

  saveLocalConversations();
  renderConversationList();
  renderMessages();
}

async function sendMessage(text) {
  const conversation = ensureLocalConversation(text);

  if (conversation.messages.length === 0) {
    conversation.title = makeTitle(text);
  }

  setSendingState(true);

  const typingId = crypto.randomUUID();
  addMessage("bot typing", "Digitando...", { id: typingId });

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        conversationId: currentConversationId,
        message: text
      })
    });

    const data = await response.json();

    if (data.conversationId && data.conversationId !== currentConversationId) {
      conversation.id = data.conversationId;
      currentConversationId = data.conversationId;
      localStorage.setItem(CURRENT_CONVERSATION_KEY, currentConversationId);
    }

    removeMessage(typingId);

    if (!response.ok) {
      addMessage("bot", data.error || "Não consegui responder agora. Tente novamente.");
      return;
    }

    addMessage("bot", data.answer);
    await loadCloudConversations();
  } catch {
    removeMessage(typingId);
    addMessage("bot", "Não consegui conectar ao servidor. Verifique se o Bot Financeiro está rodando.");
  } finally {
    setSendingState(false);
    messageInput.focus();
  }
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isSending) return;

  const text = formatText(messageInput.value);
  if (!text) return;

  chatForm.classList.remove("sending-burst", "button-submit");
  void chatForm.offsetWidth;
  chatForm.classList.add("sending-burst");
  if (submitSource === "button") {
    chatForm.classList.add("button-submit");
  }
  submitSource = "keyboard";

  addMessage("user", text);
  messageInput.value = "";
  resizeInput();

  await sendMessage(text);
});

chatForm.addEventListener("animationend", (event) => {
  if (event.animationName === "composerBurst") {
    chatForm.classList.remove("sending-burst", "button-submit");
  }
});

messageInput.addEventListener("input", resizeInput);

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submitSource = "keyboard";
    chatForm.requestSubmit();
  }
});

sendButton.addEventListener("pointerdown", () => {
  submitSource = "button";
});

newChatButton.addEventListener("click", () => {
  currentConversationId = "";
  messages = [];
  localStorage.removeItem(CURRENT_CONVERSATION_KEY);
  renderConversationList();
  renderMessages();
  statusText.textContent = "Online";
  messageInput.focus();
});

conversationListEl.addEventListener("click", async (event) => {
  const openButton = event.target.closest(".conversation-open");
  const deleteButton = event.target.closest(".conversation-delete");

  if (openButton) {
    await openConversation(openButton.dataset.id);
    return;
  }

  if (deleteButton) {
    await deleteConversation(deleteButton.dataset.id);
  }
});

promptButtons.forEach((button) => {
  button.addEventListener("click", () => {
    messageInput.value = button.dataset.prompt || "";
    resizeInput();
    messageInput.focus();
  });
});

syncButton.addEventListener("click", syncDeviceHistory);

authToggle.addEventListener("click", () => {
  setAuthMode(!isRegisterMode);
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  authError.textContent = "";
  authSubmit.disabled = true;

  try {
    const response = await fetch(isRegisterMode ? "/api/auth/register" : "/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: authName.value,
        email: authEmail.value,
        password: authPassword.value
      })
    });

    const data = await response.json();

    if (!response.ok) {
      authError.textContent = data.error || "Não foi possível entrar.";
      return;
    }

    currentUser = data.user;
    hideAuth();
    currentConversationId = "";
    messages = [];
    conversations = [];
    localStorage.removeItem(CURRENT_CONVERSATION_KEY);
    saveLocalConversations();
    renderMessages();
    await loadCloudConversations();
  } catch {
    authError.textContent = "Não consegui conectar ao servidor.";
  } finally {
    authSubmit.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  currentUser = null;
  currentConversationId = "";
  messages = [];
  conversations = [];
  localStorage.removeItem(CURRENT_CONVERSATION_KEY);
  saveLocalConversations();
  renderConversationList();
  renderMessages();
  showAuth();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

renderConversationList();
renderMessages();
resizeInput();
setAuthMode(false);
checkAuth().then((authenticated) => {
  if (authenticated) loadCloudConversations();
});
