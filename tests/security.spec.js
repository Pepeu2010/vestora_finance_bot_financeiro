// @ts-check
const { test, expect } = require("@playwright/test");

test.describe("Segurança - Simulação de DDoS", () => {
  test("requisições POST sem auth retornam 401 ou 429", async ({ request }) => {
    const responses = [];
    for (let i = 0; i < 20; i++) {
      responses.push(request.post("/api/chat", { data: { message: `teste ${i}` } }));
    }
    const results = await Promise.all(responses);
    const blocked = results.filter((r) => r.status() === 401 || r.status() === 429);
    expect(blocked.length).toBe(results.length);
  });

  test("rate limit bloqueia requisições excessivas em endpoints autenticados", async ({ request }) => {
    const responses = [];
    for (let i = 0; i < 25; i++) {
      responses.push(request.get("/api/conversations"));
    }
    const results = await Promise.all(responses);
    const blocked = results.filter((r) => r.status() === 401 || r.status() === 429);
    expect(blocked.length).toBe(results.length);
  });

  test("requisições concorrentes não derrubam o servidor", async ({ request }) => {
    const responses = [];
    for (let i = 0; i < 15; i++) {
      responses.push(request.get("/api/health"));
    }
    const results = await Promise.all(responses);
    const ok = results.filter((r) => r.status() === 200);
    expect(ok.length).toBeGreaterThan(0);
  });
});

test.describe("Segurança - XSS (Cross-Site Scripting)", () => {
  test("payload XSS no chat retorna erro seguro ou resposta sanitizada", async ({ request }) => {
    const xssPayloads = [
      '<script>alert("xss")</script>',
      '<img src=x onerror=alert(1)>',
      '"><script>document.cookie</script>',
      "javascript:alert(1)",
      '<svg onload=alert(1)>',
    ];

    for (const payload of xssPayloads) {
      const response = await request.post("/api/chat", {
        data: { message: payload }
      });

      if (response.status() === 429) continue;
      const status = response.status();
      expect([200, 401]).toContain(status);

      if (status === 200) {
        const body = await response.json();
        expect(body.answer).toBeDefined();
        expect(body.answer.toLowerCase()).not.toContain("<script>");
        expect(body.answer.toLowerCase()).not.toContain("onerror");
      }
    }
  });

  test("headers CSP previnem execução de scripts", async ({ request }) => {
    const response = await request.get("/");
    const headers = response.headers();
    const csp = headers["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("script-src 'unsafe-inline'");
  });
});

test.describe("Segurança - Brute Force no Login", () => {
  test("múltiplas tentativas de login com senha errada recebem 401", async ({ request }) => {
    const attempts = [];
    for (let i = 0; i < 10; i++) {
      attempts.push(
        request.post("/api/auth/login", {
          data: { email: "admin@admin.com", password: `wrong${i}` }
        })
      );
    }
    const results = await Promise.all(attempts);
    const failed = results.filter((r) => r.status() === 401 || r.status() === 429);
    expect(failed.length).toBeGreaterThan(0);
  });

  test("login com email inválido retorna erro apropriado", async ({ request }) => {
    const response = await request.post("/api/auth/login", {
      data: { email: "naoexiste@fake.com", password: "qualquer123" }
    });
    expect([401, 403, 429]).toContain(response.status());
  });
});

test.describe("Segurança - Headers de Segurança", () => {
  test("x-powered-by não é exposto", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.headers()["x-powered-by"]).toBeUndefined();
  });

  test("x-content-type-options é nosniff", async ({ request }) => {
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

test.describe("Segurança - Autenticação e Sessão", () => {
  test("cookie de sessão tem flags de segurança", async ({ request }) => {
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

  test("com cookie inválido, endpoint retorna 401", async ({ request }) => {
    const response = await request.get("/api/conversations", {
      headers: { Cookie: "bot_financeiro_session=invalid.token.here" }
    });
    expect([401, 403, 429]).toContain(response.status());
  });

  test("registro com dados inválidos é rejeitado", async ({ request }) => {
    const tests = [
      { name: "", email: "a@b.com", password: "12345" },
      { name: "Test", email: "", password: "12345" },
      { name: "Test", email: "invalido", password: "12345" },
      { name: "Test", email: "a@b.com", password: "123" }
    ];

    for (const data of tests) {
      const response = await request.post("/api/auth/register", { data });
      expect([400, 429]).toContain(response.status());
    }
  });
});

test.describe("Segurança - Injeção e Manipulação", () => {
  test("SQL injection no login não causa erro de servidor", async ({ request }) => {
    const payloads = [
      "' OR '1'='1",
      "admin'--",
      "1; DROP TABLE users",
      "' UNION SELECT * FROM app_users--",
    ];

    for (const payload of payloads) {
      const response = await request.post("/api/auth/login", {
        data: { email: payload, password: "test" }
      });
      expect([400, 401, 403, 429]).toContain(response.status());
    }
  });

  test("body com JSON inválido é rejeitado", async ({ request }) => {
    const response = await request.post("/api/chat", {
      headers: { "Content-Type": "application/json" },
      data: "not json"
    });
    expect([400, 415, 429]).toContain(response.status());
  });

  test("payload excessivamente grande é rejeitado", async ({ request }) => {
    const bigPayload = { message: "a".repeat(100000) };
    const response = await request.post("/api/chat", {
      data: bigPayload
    });
    expect([400, 413, 429]).toContain(response.status());
  });

  test("manipulação de conversationId path traversal não expõe dados", async ({ request }) => {
    const response = await request.get(
      "/api/conversations/../../../etc/passwd/messages"
    );
    const status = response.status();
    expect([400, 401, 404, 429, 200]).toContain(status);
    const body = await response.text();
    expect(body).not.toContain("root:");
    expect(body).not.toContain("/bin/bash");
  });
});

test.describe("Segurança - Endpoint Exposure", () => {
  test("arquivos sensíveis não retornam conteúdo real via HTTP", async ({ request }) => {
    const sensitiveFiles = [
      "/.env",
      "/server.js",
      "/groq.js",
      "/supabase.js",
      "/package.json",
      "/.gitignore",
    ];

    for (const file of sensitiveFiles) {
      const response = await request.get(file);
      const status = response.status();
      expect([404, 403, 429, 200]).toContain(status);
      if (status === 200) {
        const body = await response.text();
        expect(body).not.toContain("GROQ_API_KEY");
        expect(body).not.toContain("SUPABASE");
        expect(body).not.toContain("SESSION_SECRET");
      }
    }
  });

  test("diretório listing não é exposto", async ({ request }) => {
    const response = await request.get("/");
    const body = await response.text();
    expect(body).not.toContain("Index of");
    expect(body).not.toContain("Directory listing");
  });
});

test.describe("Segurança - CSRF e Origem", () => {
  test("requisição com origin diferente é bloqueada na API", async ({ request }) => {
    const response = await request.post("/api/chat", {
      headers: {
        Origin: "https://evil-site.com",
        "Content-Type": "application/json"
      },
      data: { message: "teste" }
    });
    expect([403, 401, 429]).toContain(response.status());
  });

  test("requisições OPTIONS são tratadas corretamente", async ({ request }) => {
    const response = await request.fetch("/api/health", {
      method: "OPTIONS"
    });
    expect([200, 204, 404, 405, 429]).toContain(response.status());
  });
});

test.describe("Segurança - Informação", () => {
  test("erros não expõem stack traces", async ({ request }) => {
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

  test("health check não expõe dados sensíveis", async ({ request }) => {
    const response = await request.get("/api/health");
    if (response.status() === 429) return;
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.env).toBeUndefined();
  });
});
