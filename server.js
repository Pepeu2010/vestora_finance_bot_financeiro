require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const path = require("path");
const { askGemini } = require("./gemini");
const { supabase, isSupabaseConfigured } = require("./supabase");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_NAME = process.env.APP_NAME || "Bot Financeiro";
const MAX_HISTORY_MESSAGES = 16;

// Memoria temporaria por sessao do navegador.
// Sem banco de dados: se o servidor reiniciar, a memoria some.
const sessions = new Map();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function now() {
  return new Date().toLocaleString("pt-BR");
}

function createSessionId() {
  return crypto.randomUUID();
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
  return value.length >= 12 && value.length <= 120 ? value : "";
}

function makeTitle(text) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return "Nova conversa";
  return clean.length > 48 ? `${clean.slice(0, 48)}...` : clean;
}

async function ensureConversation({ conversationId, deviceId, firstMessage }) {
  if (!isSupabaseConfigured) return conversationId || createSessionId();

  if (conversationId) {
    const { data, error } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("device_id", deviceId)
      .maybeSingle();

    if (error) throw error;
    if (data) return data.id;
  }

  const { data, error } = await supabase
    .from("conversations")
    .insert({
      device_id: deviceId,
      title: makeTitle(firstMessage)
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

async function getConversationMessages({ conversationId, deviceId }) {
  if (!isSupabaseConfigured || !conversationId) return [];

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("device_id", deviceId)
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

app.get("/api/conversations", async (req, res) => {
  const deviceId = validateDeviceId(req.query.deviceId);

  if (!deviceId) {
    return res.status(400).json({ error: "deviceId invalido." });
  }

  if (!isSupabaseConfigured) {
    return res.json({ configured: false, conversations: [] });
  }

  try {
    const { data, error } = await supabase
      .from("conversations")
      .select("id, title, created_at, updated_at")
      .eq("device_id", deviceId)
      .order("updated_at", { ascending: false });

    if (error) throw error;

    res.json({ configured: true, conversations: data });
  } catch (error) {
    console.error(`[${now()}] Erro ao listar conversas:`, error.message);
    res.status(500).json({ error: "Nao consegui listar as conversas." });
  }
});

app.get("/api/conversations/:id/messages", async (req, res) => {
  const deviceId = validateDeviceId(req.query.deviceId);

  if (!deviceId) {
    return res.status(400).json({ error: "deviceId invalido." });
  }

  if (!isSupabaseConfigured) {
    return res.json({ configured: false, messages: [] });
  }

  try {
    const messages = await getConversationMessages({
      conversationId: req.params.id,
      deviceId
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

app.patch("/api/conversations/:id", async (req, res) => {
  const deviceId = validateDeviceId(req.body.deviceId);
  const title = makeTitle(req.body.title);

  if (!deviceId) {
    return res.status(400).json({ error: "deviceId invalido." });
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
      .eq("device_id", deviceId);

    if (error) throw error;

    res.json({ configured: true });
  } catch (error) {
    console.error(`[${now()}] Erro ao renomear conversa:`, error.message);
    res.status(500).json({ error: "Nao consegui renomear a conversa." });
  }
});

app.delete("/api/conversations/:id", async (req, res) => {
  const deviceId = validateDeviceId(req.query.deviceId);

  if (!deviceId) {
    return res.status(400).json({ error: "deviceId invalido." });
  }

  if (!isSupabaseConfigured) {
    return res.json({ configured: false });
  }

  try {
    const { error } = await supabase
      .from("conversations")
      .delete()
      .eq("id", req.params.id)
      .eq("device_id", deviceId);

    if (error) throw error;

    res.json({ configured: true });
  } catch (error) {
    console.error(`[${now()}] Erro ao apagar conversa:`, error.message);
    res.status(500).json({ error: "Nao consegui apagar a conversa." });
  }
});

app.post("/api/chat", async (req, res) => {
  const userMessage = String(req.body.message || "").trim();
  const deviceId = validateDeviceId(req.body.deviceId);
  const conversationIdFromRequest = req.body.conversationId;
  const session = getSession(req.body.sessionId || conversationIdFromRequest);

  if (!userMessage) {
    return res.status(400).json({
      error: "Mensagem vazia.",
      sessionId: session.id
    });
  }

  if (isSupabaseConfigured && !deviceId) {
    return res.status(400).json({
      error: "deviceId invalido.",
      sessionId: session.id
    });
  }

  console.log(`[${now()}] [${session.id}] Usuario: ${userMessage}`);

  try {
    const conversationId = await ensureConversation({
      conversationId: conversationIdFromRequest,
      deviceId,
      firstMessage: userMessage
    });

    const cloudHistory = await getConversationMessages({
      conversationId,
      deviceId
    });

    const historyForGemini = isSupabaseConfigured
      ? cloudHistory.slice(-MAX_HISTORY_MESSAGES)
      : session.history.slice(-MAX_HISTORY_MESSAGES);

    await saveCloudMessage({
      conversationId,
      role: "user",
      content: userMessage
    });

    const answer = await askGemini({
      message: userMessage,
      history: historyForGemini
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
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`[${now()}] ${APP_NAME} rodando em http://localhost:${PORT}`);
});
