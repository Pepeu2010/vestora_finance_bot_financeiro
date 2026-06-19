const test = require("node:test");
const assert = require("node:assert/strict");

const { buildInternetContext } = require("../groq");

test("preserva resultados web quando a busca funciona", () => {
  const context = buildInternetContext({
    searched: true,
    checkedAt: "2026-06-14T12:00:00.000Z",
    classification: { category: "realtime" },
    engine: "bing",
    externalSuccess: true,
    usedWebSearch: true,
    usedRealtimeData: false,
    results: [
      {
        title: "Dolar hoje",
        url: "https://example.com/dolar",
        source: "example.com",
        snippet: "R$ 5,10"
      }
    ],
    warning: "nao deve vazar"
  });

  assert.equal(context.externalSuccess, true);
  assert.equal(context.results.length, 1);
  assert.equal("warning" in context, false);
});

test("converte falha de busca em orientacao interna sem mensagem contraditoria", () => {
  const context = buildInternetContext({
    searched: true,
    checkedAt: "2026-06-14T12:00:00.000Z",
    classification: { category: "realtime" },
    engine: "unavailable",
    externalSuccess: false,
    usedWebSearch: false,
    usedRealtimeData: false,
    results: [],
    warning: "Falha na pesquisa online no momento.",
    errors: ["timeout"]
  });

  assert.equal(context.externalSuccess, false);
  assert.equal("warning" in context, false);
  assert.equal("errors" in context, false);
  assert.match(context.guidance, /conhecimento geral/i);
  assert.match(context.guidance, /Dados em tempo real indisponiveis/i);
});
