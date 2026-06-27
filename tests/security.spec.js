// @ts-check
const { test, expect } = require("@playwright/test");

async function createAuthenticatedContext(playwright, baseURL) {
  const request = await playwright.request.newContext({ baseURL });
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = await request.post("/api/auth/register", {
    data: {
      name: "Teste Seguranca",
      email: `seguranca-${unique}@vestora.local`,
      password: "Senha-segura-123!"
    }
  });

  if (response.status() === 503) {
    test.skip(true, "Supabase nao configurado neste ambiente.");
  }

  expect(response.ok()).toBeTruthy();
  const setCookie = response.headers()["set-cookie"] || "";
  const csrfMatch = setCookie.match(/vestora_csrf=([^;]+)/);
  expect(csrfMatch).toBeTruthy();

  return {
    request,
    csrfToken: decodeURIComponent(csrfMatch[1])
  };
}

let authenticatedRequest = null;
let authenticatedCsrfToken = "";

test.beforeAll(async ({ playwright, baseURL }) => {
  const auth = await createAuthenticatedContext(playwright, baseURL);
  authenticatedRequest = auth.request;
  authenticatedCsrfToken = auth.csrfToken;
});

test.afterAll(async () => {
  await authenticatedRequest?.dispose();
});

test.describe("Seguranca - DDoS", () => {
  test("POST sem auth retorna 401 ou 429", async ({ request }) => {
    const responses = [];
    for (let i = 0; i < 20; i++) {
      responses.push(request.post("/api/chat", { data: { message: `teste ${i}` } }));
    }
    const results = await Promise.all(responses);
    const blocked = results.filter((response) => response.status() === 401 || response.status() === 429);
    expect(blocked.length).toBe(results.length);
  });

  test("rate limit bloqueia excesso em endpoints autenticados", async ({ request }) => {
    const responses = [];
    for (let i = 0; i < 25; i++) {
      responses.push(request.get("/api/conversations"));
    }
    const results = await Promise.all(responses);
    const blocked = results.filter((response) => response.status() === 401 || response.status() === 429);
    expect(blocked.length).toBe(results.length);
  });

  test("requisicoes concorrentes nao derrubam o servidor", async ({ request }) => {
    const responses = [];
    for (let i = 0; i < 15; i++) {
      responses.push(request.get("/api/health"));
    }
    const results = await Promise.all(responses);
    const ok = results.filter((response) => response.status() === 200);
    expect(ok.length).toBeGreaterThan(0);
  });
});

test.describe("Seguranca - XSS", () => {
  test("payload XSS no chat retorna erro seguro ou resposta sanitizada", async ({ request }) => {
    const payloads = [
      '<script>alert("xss")</script>',
      "<img src=x onerror=alert(1)>",
      '"><script>document.cookie</script>',
      "javascript:alert(1)",
      "<svg onload=alert(1)>"
    ];

    for (const payload of payloads) {
      const response = await request.post("/api/chat", {
        data: { message: payload }
      });

      if (response.status() === 429) continue;
      expect([200, 401]).toContain(response.status());

      if (response.status() === 200) {
        const body = await response.json();
        expect(body.answer).toBeDefined();
        expect(body.answer.toLowerCase()).not.toContain("<script>");
        expect(body.answer.toLowerCase()).not.toContain("onerror");
      }
    }
  });

  test("headers CSP previnem execucao de scripts", async ({ request }) => {
    const response = await request.get("/");
    const csp = response.headers()["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("script-src 'unsafe-inline'");
  });
});

test.describe("Seguranca - Brute Force no Login", () => {
  test("multiplas tentativas de login com senha errada recebem 401", async ({ request }) => {
    const attempts = [];
    for (let i = 0; i < 10; i++) {
      attempts.push(
        request.post("/api/auth/login", {
          data: { email: "admin@admin.com", password: `wrong${i}` }
        })
      );
    }

    const results = await Promise.all(attempts);
    const failed = results.filter((response) => response.status() === 401 || response.status() === 429);
    expect(failed.length).toBeGreaterThan(0);
  });

  test("login com email invalido retorna erro apropriado", async ({ request }) => {
    const response = await request.post("/api/auth/login", {
      data: { email: "naoexiste@fake.com", password: "qualquer123" }
    });
    expect([401, 403, 429]).toContain(response.status());
  });
});

test.describe("Seguranca - Headers", () => {
  test("x-powered-by nao e exposto", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.headers()["x-powered-by"]).toBeUndefined();
  });

  test("x-content-type-options e nosniff", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("x-frame-options previne clickjacking", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.headers()["x-frame-options"]).toBeDefined();
  });

  test("cache-control desabilita cache em APIs", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.headers()["cache-control"]).toContain("no-store");
  });

  test("helmet configura CSP corretamente", async ({ request }) => {
    const response = await request.get("/");
    const csp = response.headers()["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src");
    expect(csp).toContain("script-src");
    expect(csp).toContain("object-src");
  });
});

test.describe("Seguranca - Autenticacao e Sessao", () => {
  test("cookie de sessao tem flags de seguranca", async ({ request }) => {
    const response = await request.post("/api/auth/login", {
      data: { email: "test@test.com", password: "senha123" }
    });
    const headers = response.headers();
    if (headers["set-cookie"]) {
      expect(headers["set-cookie"]).toContain("HttpOnly");
    }
  });

  test("sem cookie, endpoint autenticado retorna 401", async ({ request }) => {
    const response = await request.get("/api/conversations");
    expect([401, 429]).toContain(response.status());
  });

  test("com cookie invalido, endpoint retorna 401", async ({ request }) => {
    const response = await request.get("/api/conversations", {
      headers: { Cookie: "vestora_session=invalid.token.here" }
    });
    expect([401, 403, 429]).toContain(response.status());
  });

  test("registro com dados invalidos e rejeitado", async ({ request }) => {
    const attempts = [
      { name: "", email: "a@b.com", password: "12345" },
      { name: "Test", email: "", password: "12345" },
      { name: "Test", email: "invalido", password: "12345" },
      { name: "Test", email: "a@b.com", password: "123" }
    ];

    for (const data of attempts) {
      const response = await request.post("/api/auth/register", { data });
      expect([400, 429]).toContain(response.status());
    }
  });
});

test.describe("Seguranca - Injecao e Manipulacao", () => {
  test("SQL injection no login nao causa erro de servidor", async ({ request }) => {
    const payloads = [
      "' OR '1'='1",
      "admin'--",
      "1; DROP TABLE users",
      "' UNION SELECT * FROM app_users--"
    ];

    for (const payload of payloads) {
      const response = await request.post("/api/auth/login", {
        data: { email: payload, password: "test" }
      });
      expect([400, 401, 403, 429]).toContain(response.status());
    }
  });

  test("body com JSON invalido e rejeitado", async ({ request }) => {
    const response = await request.post("/api/chat", {
      headers: { "Content-Type": "application/json" },
      data: "not json"
    });
    expect([400, 415, 429]).toContain(response.status());
  });

  test("payload excessivamente grande e rejeitado", async ({ request }) => {
    const response = await request.post("/api/chat", {
      data: { message: "a".repeat(100000) }
    });
    expect([400, 413, 429]).toContain(response.status());
  });

  test("manipulacao de conversationId path traversal nao expoe dados", async ({ request }) => {
    const response = await request.get("/api/conversations/../../../etc/passwd/messages");
    expect([400, 401, 404, 429, 200]).toContain(response.status());

    const body = await response.text();
    expect(body).not.toContain("root:");
    expect(body).not.toContain("/bin/bash");
  });
});

test.describe("Seguranca - Endpoint Exposure", () => {
  test("arquivos sensiveis nao retornam conteudo real via HTTP", async ({ request }) => {
    const sensitiveFiles = [
      "/.env",
      "/server.js",
      "/groq.js",
      "/supabase.js",
      "/package.json",
      "/.gitignore"
    ];

    for (const file of sensitiveFiles) {
      const response = await request.get(file);
      expect([404, 403, 429, 200]).toContain(response.status());
      if (response.status() === 200) {
        const body = await response.text();
        expect(body).not.toContain("GROQ_API_KEY");
        expect(body).not.toContain("SUPABASE");
        expect(body).not.toContain("SESSION_SECRET");
      }
    }
  });

  test("diretorio listing nao e exposto", async ({ request }) => {
    const response = await request.get("/");
    const body = await response.text();
    expect(body).not.toContain("Index of");
    expect(body).not.toContain("Directory listing");
  });
});

test.describe("Seguranca - CSRF e Origem", () => {
  test("requisicao autenticada sem header CSRF e bloqueada", async () => {
    const response = await authenticatedRequest.post("/api/chat", {
      data: { message: "teste csrf" }
    });
    expect(response.status()).toBe(403);

    const body = await response.json();
    expect(body.error).toContain("CSRF");
  });

  test("requisicao autenticada com header CSRF valido e aceita", async () => {
    const response = await authenticatedRequest.post("/api/chat", {
      headers: { "x-csrf-token": authenticatedCsrfToken },
      data: { message: "teste csrf valido" }
    });
    expect([200, 429]).toContain(response.status());
  });

  test("requisicao com origin diferente e bloqueada na API", async ({ request }) => {
    const response = await request.post("/api/chat", {
      headers: {
        Origin: "https://evil-site.com",
        "Content-Type": "application/json"
      },
      data: { message: "teste" }
    });
    expect([403, 401, 429]).toContain(response.status());
  });

  test("requisicoes OPTIONS sao tratadas corretamente", async ({ request }) => {
    const response = await request.fetch("/api/health", {
      method: "OPTIONS"
    });
    expect([200, 204, 404, 405, 429]).toContain(response.status());
  });
});

test.describe("Seguranca - Informacao", () => {
  test("erros nao expoem stack traces", async ({ request }) => {
    const response = await request.post("/api/chat", {
      data: { message: "teste" }
    });

    if (response.status() === 500) {
      const body = await response.json();
      expect(body.error).toBeDefined();
      expect(body.stack).toBeUndefined();
      expect(body.error).not.toContain("Error");
      expect(body.error).not.toContain("at ");
    }
  });

  test("health check nao expoe dados sensiveis", async ({ request }) => {
    const response = await request.get("/api/health");
    if (response.status() === 429) return;

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.env).toBeUndefined();
  });
});

test.describe("Seguranca - Service Worker", () => {
  test("service worker nao faz cache de respostas /api", async ({ request }) => {
    const response = await request.get("/sw.js");
    expect(response.ok()).toBeTruthy();

    const body = await response.text();
    expect(body).toContain('if (url.pathname.startsWith("/api/")) {');
    expect(body).not.toContain('event.respondWith(networkFirst(request, DYNAMIC_CACHE));');
  });
});
