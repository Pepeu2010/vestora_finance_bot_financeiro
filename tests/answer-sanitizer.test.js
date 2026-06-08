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
