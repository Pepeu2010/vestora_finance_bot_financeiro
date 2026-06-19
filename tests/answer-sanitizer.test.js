const test = require("node:test");
const assert = require("node:assert/strict");

const { sanitizeModelAnswer } = require("../answerSanitizer");

test("remove bloco think completo", () => {
  const input = "<think>texto interno</think>\nResposta final aqui";
  assert.equal(sanitizeModelAnswer(input), "Resposta final aqui");
});

test("remove think aberto sem fechamento", () => {
  const input = "Resposta valida\n<think>analise privada";
  assert.equal(sanitizeModelAnswer(input), "Resposta valida");
});

test("remove prefacio de raciocinio em ingles", () => {
  const input = "Here is my reasoning:\nI will think step by step.\n\nResposta final em português.";
  assert.equal(sanitizeModelAnswer(input), "Resposta final em português.");
});

test("remove aviso contraditorio quando ha resposta util em seguida", () => {
  const input = "Não consegui responder agora.\n\nA tabela oficial do IRPF 2026 começa em até R$ 2.428,80.";
  assert.equal(
    sanitizeModelAnswer(input),
    "A tabela oficial do IRPF 2026 começa em até R$ 2.428,80."
  );
});

test("remove atributos html vazando como texto cru", () => {
  const input = '<a href="https://www.bcb.gov.br" target="_blank" rel="noopener noreferrer" class="message-link">Banco Central</a>';
  assert.equal(
    sanitizeModelAnswer(input),
    "Banco Central (https://www.bcb.gov.br)"
  );
});

test("remove detalhes tecnicos de falhas de fontes", () => {
  const input = [
    "As demais fontes retornaram erros técnicos: HTTP 403 em Investing.",
    "Falhas de navegador: TimeoutError: page.goto failed.",
    "A Selic meta está em **15% ao ano**."
  ].join("\n\n");

  const output = sanitizeModelAnswer(input);

  assert.equal(output, "A Selic meta está em **15% ao ano**.");
  assert.doesNotMatch(output, /HTTP 403/i);
  assert.doesNotMatch(output, /Falhas de navegador/i);
  assert.doesNotMatch(output, /erros técnicos/i);
});

test("remove stack traces e mensagens internas preservando a resposta util", () => {
  const input = [
    "Error: Request failed with status code 403",
    "    at fetchSource (/app/internetSearch.js:123:45)",
    "Mensagem interna do sistema: provider unavailable",
    "Não foi possível responder com segurança agora.",
    "O dólar varia durante o dia; acompanhe a cotação em uma fonte financeira confiável."
  ].join("\n");

  const output = sanitizeModelAnswer(input);

  assert.equal(
    output,
    "O dólar varia durante o dia; acompanhe a cotação em uma fonte financeira confiável."
  );
  assert.doesNotMatch(output, /status code|internetSearch|Mensagem interna|segurança/i);
});

test("usa fallback amigavel quando so restam detalhes tecnicos", () => {
  const input = [
    "HTTP 403 Forbidden",
    "TypeError: Failed to fetch",
    "Falhas de navegador: browser closed"
  ].join("\n");

  assert.equal(
    sanitizeModelAnswer(input),
    "Resposta baseada em conhecimento geral. Dados em tempo real indisponiveis."
  );
});
