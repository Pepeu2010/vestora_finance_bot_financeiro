const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const app = require("../server");

async function withServer(run) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test("gera plano deterministico completo para pergunta estruturada de investimento", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "invest-session-12345",
        message: "Quero investir melhor. Minha renda é R$5000, gastos R$2400, objetivo principal é tornar independente do dinheiro e meu prazo é a vida.",
        settings: { respostasRapidas: true, buscaNaWeb: true }
      })
    });

    assert.equal(response.status, 200);
    const body = await response.json();

    assert.match(body.answer, /saldo dispon[íi]vel hoje [ée] de \*\*R\$\s*2\.600 por m[êe]s\*\*/i);
    assert.match(body.answer, /### Plano sugerido/i);
    assert.match(body.answer, /### Ordem pr[aá]tica/i);
    assert.match(body.answer, /independente do dinheiro/i);
    assert.ok(!body.answer.includes("\n- \n"), "nao deve haver bullet vazio");
    assert.ok(body.answer.length > 300, "a resposta deve ser substancial e completa");
  });
});
