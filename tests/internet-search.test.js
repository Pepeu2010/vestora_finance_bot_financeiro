const test = require("node:test");
const assert = require("node:assert/strict");

function loadSearchModule(env = {}) {
  const modulePath = require.resolve("../internetSearch");
  delete require.cache[modulePath];

  const previous = {
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    SERPER_API_KEY: process.env.SERPER_API_KEY,
    BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY,
    GOOGLE_CSE_API_KEY: process.env.GOOGLE_CSE_API_KEY,
    GOOGLE_CSE_CX: process.env.GOOGLE_CSE_CX
  };

  Object.assign(process.env, {
    TAVILY_API_KEY: "",
    SERPER_API_KEY: "",
    BRAVE_SEARCH_API_KEY: "",
    GOOGLE_CSE_API_KEY: "",
    GOOGLE_CSE_CX: "",
    ...env
  });

  const mod = require("../internetSearch");
  return {
    ...mod,
    restore() {
      Object.assign(process.env, previous);
      delete require.cache[modulePath];
    }
  };
}

function makeJsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

test("classifica pergunta temporal de mercado como busca obrigatoria", () => {
  const { classifyFreshnessNeed, shouldPesquisarInternet, restore } = loadSearchModule();
  try {
    const classification = classifyFreshnessNeed("Qual a cotacao do dolar hoje?");
    assert.equal(classification.shouldSearch, true);
    assert.equal(classification.category, "finance");
    assert.equal(shouldPesquisarInternet("Qual a cotacao do dolar hoje?"), true);
  } finally {
    restore();
  }
});

test("nao dispara busca para pergunta explicativa estavel", () => {
  const { classifyFreshnessNeed, shouldPesquisarInternet, restore } = loadSearchModule();
  try {
    const classification = classifyFreshnessNeed("Explique o que e reserva de emergencia.");
    assert.equal(classification.shouldSearch, false);
    assert.equal(classification.category, "educational");
    assert.equal(shouldPesquisarInternet("Explique o que e reserva de emergencia."), false);
  } finally {
    restore();
  }
});

test("usa cache para evitar pesquisa repetida em curto periodo", async () => {
  const { pesquisarInternet, clearSearchCaches, restore } = loadSearchModule({
    BRAVE_SEARCH_API_KEY: "test-brave-key"
  });
  clearSearchCaches();

  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url) => {
    calls.push(String(url));

    if (String(url).startsWith("https://api.search.brave.com/res/v1/web/search")) {
      return makeJsonResponse({
        web: {
          results: [
            {
              title: "Conversor de Moedas - Banco Central",
              url: "https://www.bcb.gov.br/conversao",
              description: "Cotacao oficial do dolar."
            }
          ]
        }
      });
    }

    if (String(url) === "https://www.bcb.gov.br/conversao") {
      return new Response("<html><body>Cotacao oficial do dolar no Banco Central</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" }
      });
    }

    throw new Error(`URL nao esperada no teste: ${url}`);
  };

  try {
    const first = await pesquisarInternet("Qual a cotacao do dolar hoje?");
    const second = await pesquisarInternet("Qual a cotacao do dolar hoje?");

    assert.equal(first.results.length > 0, true);
    assert.equal(first.externalSuccess, true);
    assert.equal(second.fromCache, true);
    assert.equal(
      calls.filter((url) => url.startsWith("https://api.search.brave.com/res/v1/web/search")).length,
      1
    );
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("faz fallback para outro provider de API quando o primeiro falha", async () => {
  const { pesquisarInternet, clearSearchCaches, restore } = loadSearchModule({
    TAVILY_API_KEY: "test-tavily-key",
    BRAVE_SEARCH_API_KEY: "test-brave-key"
  });
  clearSearchCaches();

  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    if (String(url) === "https://api.tavily.com/search") {
      return new Response(JSON.stringify({ error: "temporarily unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" }
      });
    }

    if (String(url).startsWith("https://api.search.brave.com/res/v1/web/search")) {
      return makeJsonResponse({
        web: {
          results: [
            {
              title: "Presidencia da Republica",
              url: "https://www.gov.br/planalto",
              description: "Informacoes oficiais do governo federal."
            }
          ]
        }
      });
    }

    if (String(url) === "https://www.gov.br/planalto") {
      return new Response("<html><body>Presidencia da Republica Federativa do Brasil</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" }
      });
    }

    throw new Error(`URL nao esperada no teste: ${url}`);
  };

  try {
    const result = await pesquisarInternet("Quem e o presidente do Brasil atualmente?");
    assert.equal(result.results.length > 0, true);
    assert.equal(result.engine, "brave");
    assert.equal(result.externalSuccess, true);
    assert.match(result.results[0].url, /gov\.br/);
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("falha com honestidade quando nenhuma API de busca esta configurada", async () => {
  const { pesquisarInternet, restore } = loadSearchModule();
  try {
    const result = await pesquisarInternet("Quais as ultimas noticias sobre a Selic?");
    assert.equal(result.searched, true);
    assert.equal(result.externalSuccess, false);
    assert.equal(result.results.length, 0);
    assert.match(result.warning, /api de busca externa/i);
  } finally {
    restore();
  }
});

test("remove aviso de indisponibilidade quando dados financeiros em tempo real sao obtidos", async () => {
  const {
    enrichWithRealtimeData,
    restore
  } = loadSearchModule();

  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    const target = String(url);

    if (target === "https://economia.awesomeapi.com.br/json/last/USD-BRL") {
      return makeJsonResponse({
        USDBRL: {
          bid: "5.1824",
          high: "5.2239",
          low: "5.1327",
          varBid: "0.0055",
          pctChange: "0.11",
          timestamp: "1780934864"
        }
      });
    }

    if (target === "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json") {
      return makeJsonResponse([{ data: "17/06/2026", valor: "14.50" }]);
    }

    if (target === "https://economia.awesomeapi.com.br/json/last/EUR-BRL") {
      return makeJsonResponse({
        EURBRL: {
          bid: "5.9773",
          high: "6.0277",
          low: "5.9207",
          varBid: "0.0143",
          pctChange: "0.24",
          timestamp: "1780934741"
        }
      });
    }

    if (target === "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=brl%2Cusd&include_24hr_change=true") {
      return makeJsonResponse({
        bitcoin: {
          brl: 329328,
          usd: 63278,
          brl_24h_change: 0.64
        }
      });
    }

    if (target.includes("bcdata.sgs.433") || target.includes("bcdata.sgs.12")) {
      return makeJsonResponse([{ data: "05/06/2026", valor: "0.67" }]);
    }

    throw new Error(`URL nao esperada no teste: ${url}`);
  };

  try {
    const enriched = await enrichWithRealtimeData({
      searched: true,
      engine: "unavailable",
      externalSuccess: false,
      results: [],
      warning: "Nenhuma API de busca externa esta configurada no momento."
    }, "Qual a cotacao atual do dolar, euro, bitcoin e taxa selic hoje?");

    assert.equal(enriched.externalSuccess, true);
    assert.equal(enriched.engine, "realtime-api");
    assert.equal(enriched.warning, undefined);
    assert.equal(enriched.results.length >= 4, true);
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});
