const test = require("node:test");
const assert = require("node:assert/strict");

function loadSearchModule(env = {}) {
  const modulePath = require.resolve("../internetSearch");
  delete require.cache[modulePath];

  const previous = {
    WEB_SEARCH_CACHE_TTL_MS: process.env.WEB_SEARCH_CACHE_TTL_MS,
    SEARXNG_BASE_URL: process.env.SEARXNG_BASE_URL,
    ENABLE_DDG_PROVIDER: process.env.ENABLE_DDG_PROVIDER,
    ENABLE_SEARXNG_PROVIDER: process.env.ENABLE_SEARXNG_PROVIDER,
    ENABLE_PLAYWRIGHT_PROVIDER: process.env.ENABLE_PLAYWRIGHT_PROVIDER
  };

  Object.assign(process.env, {
    WEB_SEARCH_CACHE_TTL_MS: "900000",
    SEARXNG_BASE_URL: "",
    ENABLE_DDG_PROVIDER: "true",
    ENABLE_SEARXNG_PROVIDER: "true",
    ENABLE_PLAYWRIGHT_PROVIDER: "true",
    ...env
  });

  const mod = require("../internetSearch");
  return {
    ...mod,
    restore() {
      Object.assign(process.env, previous);
      delete require.cache[modulePath];
      delete global.__VESTORA_PLAYWRIGHT_SEARCH__;
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

test("usa cache de 15 minutos para evitar pesquisa repetida em curto periodo", async () => {
  const { pesquisarInternet, clearSearchCaches, restore } = loadSearchModule();
  clearSearchCaches();

  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url) => {
    const target = String(url);
    calls.push(target);

    if (target.startsWith("https://duckduckgo.com/html/")) {
      return new Response(`
        <html><body>
          <div class="result">
            <a class="result__a" href="https://www.bcb.gov.br/conversao">Conversor de Moedas - Banco Central</a>
            <div class="result__snippet">Cotacao oficial do dolar.</div>
          </div>
        </body></html>
      `, {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" }
      });
    }

    if (target === "https://www.bcb.gov.br/conversao") {
      return new Response("<html><body>Cotacao oficial do dolar no Banco Central</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" }
      });
    }

    throw new Error(`URL nao esperada no teste: ${target}`);
  };

  try {
    const first = await pesquisarInternet("Qual a cotacao do dolar hoje?");
    const second = await pesquisarInternet("Qual a cotacao do dolar hoje?");

    assert.equal(first.results.length > 0, true);
    assert.equal(first.externalSuccess, true);
    assert.equal(second.fromCache, true);
    assert.equal(
      calls.filter((url) => url.startsWith("https://duckduckgo.com/html/")).length,
      1
    );
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("faz fallback do DuckDuckGo para o SearXNG quando necessario", async () => {
  const { pesquisarInternet, clearSearchCaches, restore } = loadSearchModule({
    SEARXNG_BASE_URL: "https://search.exemplo.local"
  });
  clearSearchCaches();

  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    const target = String(url);

    if (target.startsWith("https://duckduckgo.com/html/")) {
      return new Response("falha temporaria", { status: 503 });
    }

    if (target.startsWith("https://lite.duckduckgo.com/lite/")) {
      return new Response("falha temporaria", { status: 503 });
    }

    if (target.startsWith("https://search.exemplo.local/search?")) {
      return makeJsonResponse({
        results: [
          {
            title: "Receita Federal - Tabelas 2026",
            url: "https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026",
            content: "Tabela oficial do IRPF 2026."
          }
        ]
      });
    }

    if (target === "https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026") {
      return new Response("<html><body>Tabela oficial do IRPF 2026</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" }
      });
    }

    throw new Error(`URL nao esperada no teste: ${target}`);
  };

  try {
    const result = await pesquisarInternet("Qual e a tabela de faixas do Imposto de Renda em 2026?");
    assert.equal(result.results.length > 0, true);
    assert.equal(result.engine, "searxng");
    assert.equal(result.externalSuccess, true);
    assert.match(result.results[0].url, /gov\.br/);
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("faz fallback final para Playwright quando DuckDuckGo e SearXNG falham", async () => {
  const { pesquisarInternet, clearSearchCaches, restore } = loadSearchModule({
    SEARXNG_BASE_URL: "https://search.exemplo.local"
  });
  clearSearchCaches();

  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    const target = String(url);

    if (target.startsWith("https://duckduckgo.com/html/")) {
      return new Response("falha temporaria", { status: 503 });
    }

    if (target.startsWith("https://lite.duckduckgo.com/lite/")) {
      return new Response("falha temporaria", { status: 503 });
    }

    if (target.startsWith("https://search.exemplo.local/search?")) {
      return new Response(JSON.stringify({ error: "offline" }), {
        status: 503,
        headers: { "content-type": "application/json" }
      });
    }

    if (target === "https://www.b3.com.br/pt_br/produtos-e-servicos/") {
      return new Response("<html><body>Produtos e servicos B3</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" }
      });
    }

    throw new Error(`URL nao esperada no teste: ${target}`);
  };

  global.__VESTORA_PLAYWRIGHT_SEARCH__ = async () => ([
    {
      title: "B3 - Produtos e servicos",
      url: "https://www.b3.com.br/pt_br/produtos-e-servicos/",
      snippet: "Informacoes do mercado financeiro brasileiro."
    }
  ]);

  try {
    const result = await pesquisarInternet("Quais sao as informacoes mais recentes sobre a B3?");
    assert.equal(result.results.length > 0, true);
    assert.equal(result.engine, "playwright");
    assert.equal(result.externalSuccess, true);
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("retorna no maximo 5 resultados deduplicados", async () => {
  const { pesquisarInternet, clearSearchCaches, restore } = loadSearchModule();
  clearSearchCaches();

  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    const target = String(url);

    if (target.startsWith("https://duckduckgo.com/html/")) {
      return new Response(`
        <html><body>
          ${Array.from({ length: 7 }).map((_, index) => `
            <div class="result">
              <a class="result__a" href="https://www.exemplo.com/noticia-${index < 2 ? 1 : index}">Resultado ${index}</a>
              <div class="result__snippet">Trecho ${index}</div>
            </div>
          `).join("")}
        </body></html>
      `, {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" }
      });
    }

    if (target.startsWith("https://www.exemplo.com/noticia-")) {
      return new Response("<html><body>Conteudo limpo</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" }
      });
    }

    throw new Error(`URL nao esperada no teste: ${target}`);
  };

  try {
    const result = await pesquisarInternet("Ultimas noticias economicas do Brasil");
    assert.equal(result.results.length <= 5, true);
    assert.equal(new Set(result.results.map((item) => item.url)).size, result.results.length);
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("falha com honestidade quando todos os providers gratuitos estao desativados", async () => {
  const { pesquisarInternet, restore } = loadSearchModule({
    ENABLE_DDG_PROVIDER: "false",
    ENABLE_SEARXNG_PROVIDER: "false",
    ENABLE_PLAYWRIGHT_PROVIDER: "false"
  });

  try {
    const result = await pesquisarInternet("Quais as ultimas noticias sobre a Selic?");
    assert.equal(result.searched, true);
    assert.equal(result.externalSuccess, false);
    assert.equal(result.results.length, 0);
    assert.match(result.warning, /provider gratuito/i);
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

    throw new Error(`URL nao esperada no teste: ${target}`);
  };

  try {
    const enriched = await enrichWithRealtimeData({
      searched: true,
      engine: "unavailable",
      externalSuccess: false,
      usedWebSearch: false,
      usedRealtimeData: false,
      results: [],
      warning: "Nenhum provider gratuito de busca externa esta configurado no momento."
    }, "Qual a cotacao atual do dolar, euro, bitcoin e taxa selic hoje?");

    assert.equal(enriched.externalSuccess, true);
    assert.equal(enriched.usedRealtimeData, true);
    assert.equal(enriched.warning, undefined);
    assert.equal(enriched.results.length >= 4, true);
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});
