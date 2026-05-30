const { SYSTEM_PROMPT } = require("./prompts");

const apiKey = process.env.GROQ_API_KEY;
const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const baseUrl = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";

if (!apiKey || apiKey === "COLE_SUA_CHAVE_GROQ_AQUI") {
  console.warn("[Groq] Configure GROQ_API_KEY no arquivo .env antes de usar respostas reais.");
}

function formatMessages({ message, history }) {
  const messages = [
    {
      role: "system",
      content: SYSTEM_PROMPT
    }
  ];

  for (const item of history) {
    messages.push({
      role: item.role === "model" ? "assistant" : "user",
      content: item.text
    });
  }

  messages.push({
    role: "user",
    content: message
  });

  return messages;
}

async function askGroq({ message, history }) {
  if (!apiKey || apiKey === "COLE_SUA_CHAVE_GROQ_AQUI") {
    return "A chave da Groq ainda nao foi configurada. Edite o arquivo .env, insira sua GROQ_API_KEY e reinicie o servidor.";
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: formatMessages({ message, history }),
      temperature: 0.55,
      max_tokens: 1800
    })
  });

  const data = await response.json();

  if (!response.ok) {
    const message = data?.error?.message || "Erro ao chamar a API da Groq.";
    throw new Error(message);
  }

  return data?.choices?.[0]?.message?.content || "Nao consegui responder agora. Pode tentar reformular sua pergunta?";
}

module.exports = {
  askGroq
};
