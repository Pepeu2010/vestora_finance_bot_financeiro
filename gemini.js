const { GoogleGenerativeAI } = require("@google/generative-ai");
const { SYSTEM_PROMPT } = require("./prompts");

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey || apiKey === "COLE_SUA_CHAVE_GEMINI_AQUI") {
  console.warn("[Gemini] Configure GEMINI_API_KEY no arquivo .env antes de usar respostas reais.");
}

const genAI = new GoogleGenerativeAI(apiKey || "missing-key");

const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  systemInstruction: SYSTEM_PROMPT
});

function formatHistory(history) {
  return history.map((message) => ({
    role: message.role,
    parts: [{ text: message.text }]
  }));
}

async function askGemini({ message, history }) {
  if (!apiKey || apiKey === "COLE_SUA_CHAVE_GEMINI_AQUI") {
    return "A chave Gemini ainda nao foi configurada. Edite o arquivo .env, insira sua GEMINI_API_KEY e reinicie o servidor.";
  }

  const chat = model.startChat({
    history: formatHistory(history)
  });

  const result = await chat.sendMessage(message);
  const text = result.response.text();

  return text || "Nao consegui responder agora. Pode tentar reformular sua pergunta?";
}

module.exports = {
  askGemini
};
