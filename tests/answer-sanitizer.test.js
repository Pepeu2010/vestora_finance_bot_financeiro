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
