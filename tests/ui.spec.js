// @ts-check
const { test, expect } = require("@playwright/test");

test.describe("UI - App React", () => {
  test("carrega titulo e metadados principais", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle("Vestora | Inteligência Financeira Pessoal");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#08111f");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      /educa(ç|c)ão financeira|educacao financeira/i
    );
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      /manifest\.json/
    );
  });

  test("mostra a tela de login quando nao ha sessao", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("#authForm")).toBeVisible();
    await expect(page.locator("#authEmail")).toBeVisible();
    await expect(page.locator("#authPassword")).toBeVisible();
    await expect(page.locator("#authSubmit")).toHaveText("Entrar");
    await expect(page.locator("#authToggle")).toHaveText("Criar conta");
  });

  test("alterna entre login e criar conta", async ({ page }) => {
    await page.goto("/");

    await page.locator("#authToggle").click();

    await expect(page.locator("#authName")).toBeVisible();
    await expect(page.locator("#authSubmit")).toHaveText("Criar conta");
    await expect(page.locator("#authToggle")).toHaveText("Já tenho conta");
  });

  test("mantem o layout principal renderizado", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("aside.sidebar")).toBeVisible();
    await expect(page.locator("section.chat-panel")).toBeVisible();
    await expect(page.locator(".brand h1").first()).toHaveText("Vestora");
    await expect(page.locator("#statusText")).toHaveText("Online");
    await expect(page.locator(".live-pill")).toContainText("IA ativa");
  });

  test("renderiza os botoes de intencao atuais", async ({ page }) => {
    await page.goto("/");

    const labels = [
      "Plano financeiro",
      "Organizar patrimônio",
      "Financiamento",
      "Investir melhor",
      "Sair das dívidas",
      "Reserva"
    ];

    for (const label of labels) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    }

    await expect(page.locator(".summary button[data-prompt]")).toHaveCount(6);
  });

  test("mantem o formulario do chat acessivel", async ({ page }) => {
    await page.goto("/");

    const textarea = page.locator("#messageInput");
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveAttribute("maxlength", "1200");
    await expect(textarea).toHaveAttribute("placeholder", "Converse com a Vestora");
    await expect(page.locator("#sendButton")).toHaveAttribute("aria-label", "Enviar mensagem");
    await expect(page.locator("#messages")).toHaveAttribute("aria-live", "polite");
  });

  test("adapta a barra de mensagem no celular", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto("/");

    const composer = page.locator(".composer");
    const textarea = page.locator("#messageInput");
    const sendButton = page.locator("#sendButton");

    await expect(page.locator(".mobile-menu-button")).toBeVisible();
    await expect(composer).toBeVisible();
    await expect(textarea).toHaveAttribute("placeholder", "Converse com a Vestora");

    const composerBox = await composer.boundingBox();
    const textareaBox = await textarea.boundingBox();
    const buttonBox = await sendButton.boundingBox();

    expect(composerBox).not.toBeNull();
    expect(textareaBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();

    expect(composerBox.width).toBeLessThanOrEqual(371);
    expect(composerBox.x).toBeGreaterThanOrEqual(10);
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(composerBox.x + composerBox.width);
    expect(textareaBox.x + textareaBox.width).toBeLessThanOrEqual(buttonBox.x - 4);
  });

  test("bloqueia envios duplicados enquanto a IA responde", async ({ page }) => {
    let chatRequests = 0;

    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "teste", name: "Teste", email: "teste@app.local" }
        })
      })
    );
    await page.route("**/api/conversations", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ configured: false, conversations: [] })
      })
    );
    await page.route("**/api/chat/stream", async (route) => {
      chatRequests += 1;
      await page.waitForTimeout(250);
      await route.fulfill({
        contentType: "text/event-stream",
        body: [
          `data: ${JSON.stringify({ type: "chunk", text: "Resposta de teste." })}\n\n`,
          `data: ${JSON.stringify({ type: "done", conversationId: "conv-ui" })}\n\n`
        ].join("")
      });
    });

    await page.goto("/");

    const textarea = page.locator("#messageInput");
    const sendButton = page.locator("#sendButton");

    await textarea.fill("Quero simular um financiamento");
    await sendButton.click();
    await page.keyboard.press("Enter");
    await sendButton.click({ force: true });

    await page.waitForTimeout(500);
    expect(chatRequests).toBe(1);
  });

  test("mantem camadas visuais futuristas", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".ambient")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(".grid-layer")).toBeAttached();
    await expect(page.locator(".scan-layer")).toBeAttached();
    await expect(page.locator(".signal-a")).toBeAttached();
    await expect(page.locator(".signal-b")).toBeAttached();
  });
});

test.describe("UI - Assets", () => {
  test("assets publicos essenciais estao acessiveis", async ({ request }) => {
    const favicon = await request.get("/favicon.svg");
    const icon = await request.get("/icon.svg");
    const manifest = await request.get("/manifest.json");
    const serviceWorker = await request.get("/sw.js");

    expect(favicon.ok()).toBeTruthy();
    expect(favicon.headers()["content-type"]).toContain("image");
    expect(icon.ok()).toBeTruthy();
    expect(icon.headers()["content-type"]).toContain("image");
    expect(manifest.ok()).toBeTruthy();
    expect(serviceWorker.ok()).toBeTruthy();

    const manifestBody = await manifest.json();
    expect(manifestBody.name).toBeDefined();
    expect(manifestBody.short_name).toBeDefined();
  });
});
