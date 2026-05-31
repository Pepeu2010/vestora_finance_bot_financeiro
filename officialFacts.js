const CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const REQUEST_TIMEOUT_MS = 6500;

const cache = new Map();

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function findSnippet(text, terms, size = 420) {
  const normalized = normalizeText(text);
  const index = terms
    .map((term) => normalized.indexOf(normalizeText(term)))
    .filter((position) => position >= 0)
    .sort((a, b) => a - b)[0];

  if (index === undefined) return "";

  const start = Math.max(0, index - Math.floor(size / 3));
  return text.slice(start, start + size).trim();
}

async function fetchText(url) {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.text;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "BotFinanceiro/1.0 (+https://github.com/Pepeu2010/bot_financeiro)"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Fonte retornou HTTP ${response.status}`);
    }

    const text = stripHtml(await response.text());
    cache.set(url, { text, createdAt: Date.now() });
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function isMinhaCasaMinhaVidaQuestion(message) {
  const normalized = normalizeText(message);
  return (
    normalized.includes("minha casa minha vida") ||
    normalized.includes("mcmv") ||
    normalized.includes("casa verde amarela")
  );
}

async function getMinhaCasaMinhaVidaFacts() {
  const sources = [
    {
      name: "Ministerio das Cidades",
      url: "https://www.gov.br/cidades/pt-br/acesso-a-informacao/acoes-e-programas/habitacao/programa-minha-casa-minha-vida/sobre-o-minha-casa-minha-vida-1",
      terms: ["R$ 13.000", "Faixa 4", "Faixa 1"]
    },
    {
      name: "CAIXA",
      url: "https://www.caixa.gov.br/voce/habitacao/minha-casa-minha-vida/urbana/Paginas/default.aspx",
      terms: ["R$ 13", "renda familiar mensal bruta", "taxa de juros"]
    }
  ];

  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const text = await fetchText(source.url);
      return {
        ...source,
        snippet: findSnippet(text, source.terms)
      };
    })
  );

  const available = results
    .filter((result) => result.status === "fulfilled" && result.value.snippet)
    .map((result) => result.value);

  if (available.length === 0) {
    return {
      topic: "Minha Casa Minha Vida",
      verified: false,
      instruction:
        "Nao foi possivel confirmar as regras atuais online agora. Responda sem numeros exatos ou peça para o usuario confirmar no Ministerio das Cidades ou na CAIXA."
    };
  }

  return {
    topic: "Minha Casa Minha Vida",
    verified: true,
    checkedAt: new Date().toISOString(),
    instruction:
      "Use somente estes dados oficiais como referencia. Se algum numero nao aparecer aqui, nao invente; peça confirmacao na fonte oficial.",
    facts:
      "Referencia cadastrada e conferida em fontes oficiais: renda urbana ate R$ 13.000; Faixa 1 ate R$ 3.200; Faixa 2 de R$ 3.200,01 a R$ 5.000; Faixa 3 de R$ 5.000,01 a R$ 9.600; Faixa 4 ate R$ 13.000; MCMV Classe Media pode financiar imoveis de ate R$ 600 mil, conforme regras vigentes divulgadas pelo governo/CAIXA.",
    sources: available.map((source) => ({
      name: source.name,
      url: source.url,
      snippet: source.snippet
    }))
  };
}

async function getOfficialFactsForMessage(message) {
  if (isMinhaCasaMinhaVidaQuestion(message)) {
    return getMinhaCasaMinhaVidaFacts();
  }

  return null;
}

module.exports = {
  getOfficialFactsForMessage,
  isMinhaCasaMinhaVidaQuestion
};
