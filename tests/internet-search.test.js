const test = require("node:test");
const assert = require("node:assert/strict");

const {
  pesquisarInternet,
  classifyFreshnessNeed,
  shouldPesquisarInternet,
  clearSearchCaches
} = require("../internetSearch");

function makeHtmlResponse(body, contentType = "text/html; charset=UTF-8") {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType }
  });
}

test.afterEach(() => {
  clearSearchCaches();
});

test("classifica pergunta temporal de mercado como busca obrigatoria", () => {
  const classification = classifyFreshnessNeed("Qual a cotacao do dolar hoje?");
  assert.equal(classification.shouldSearch, true);
  assert.equal(classification.category, "finance");
  assert.equal(shouldPesquisarInternet("Qual a cotacao do dolar hoje?"), true);
});

test("nao dispara busca para pergunta explicativa estavel", () => {
  const classification = classifyFreshnessNeed("Explique o que e reserva de emergencia.");
  assert.equal(classification.shouldSearch, false);
  assert.equal(classification.category, "educational");
  assert.equal(shouldPesquisarInternet("Explique o que e reserva de emergencia."), false);
});

test("usa cache para evitar pesquisa repetida em curto periodo", async () => {
  clearSearchCaches();
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url) => {
    calls.push(String(url));

    if (String(url).startsWith("https://duckduckgo.com/html/")) {
      return makeHtmlResponse(`
        <div class="result">
          <a class="result__a" href="https://www.bcb.gov.br/conversao">Conversor de Moedas - Banco Central</a>
          <div class="result__snippet">Cotacao oficial do dolar.</div>
        </div>
      `);
    }

    if (String(url) === "https://www.bcb.gov.br/conversao") {
      return makeHtmlResponse("<html><body>Cotacao oficial do dolar atual no Banco Central</body></html>");
    }

    throw new Error(`URL nao esperada no teste: ${url}`);
  };

  try {
    const first = await pesquisarInternet("Qual a cotacao do dolar hoje?");
    const second = await pesquisarInternet("Qual a cotacao do dolar hoje?");

    assert.equal(first.results.length > 0, true);
    assert.equal(second.fromCache, true);
    assert.equal(
      calls.filter((url) => url.startsWith("https://duckduckgo.com/html/")).length,
      1
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("faz fallback para Bing quando DuckDuckGo falha", async () => {
  clearSearchCaches();
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    if (String(url).startsWith("https://duckduckgo.com/html/")) {
      throw new Error("Duck bloqueado");
    }

    if (String(url).startsWith("https://lite.duckduckgo.com/lite/")) {
      return makeHtmlResponse("<html><body>sem resultados validos</body></html>");
    }

    if (String(url).startsWith("https://www.bing.com/search?")) {
      return makeHtmlResponse(`
        <li class="b_algo">
          <h2><a href="https://www.gov.br/planalto">Presidencia da Republica</a></h2>
          <p>Informacoes oficiais do governo federal.</p>
        </li>
      `);
    }

    if (String(url) === "https://www.gov.br/planalto") {
      return makeHtmlResponse("<html><body>Presidencia da Republica Federativa do Brasil</body></html>");
    }

    throw new Error(`URL nao esperada no teste: ${url}`);
  };

  try {
    const result = await pesquisarInternet("Quem e o presidente do Brasil atualmente?");
    assert.equal(result.results.length > 0, true);
    assert.equal(result.engine, "bing");
    assert.match(result.results[0].url, /gov\.br/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("executa pesquisa real na internet quando habilitado", {
  skip: !process.env.RUN_WEB_LIVE_TESTS
}, async () => {
  clearSearchCaches();
  const result = await pesquisarInternet("Qual a cotacao do dolar hoje?");

  assert.equal(result.searched, true);
  assert.equal(result.results.length > 0, true);
  assert.match(result.results[0].url, /^https?:\/\//);
});
