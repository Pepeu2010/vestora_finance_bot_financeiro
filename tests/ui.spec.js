// @ts-check
const { test, expect } = require("@playwright/test");

test.describe("UI - App React", () => {
  test("carrega titulo e metadados principais", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle("Bot Financeiro");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0f766e");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      /educacao financeira/
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
    await expect(page.locator(".brand h1").first()).toHaveText("Bot Financeiro");
    await expect(page.locator("#statusText")).toHaveText("Online");
    await expect(page.locator(".live-pill")).toContainText("IA ativa");
  });

  test("renderiza os botoes de intencao atuais", async ({ page }) => {
    await page.goto("/");

    const labels = [
      "Comprar imóvel",
      "Vender imóvel",
      "Financiamento",
      "Investir melhor",
      "Sair das dívidas",
      "Montar reserva"
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
    await expect(textarea).toHaveAttribute("placeholder", /investimentos|dívidas|reserva/);
    await expect(page.locator("#sendButton")).toHaveText("Enviar");
    await expect(page.locator("#messages")).toHaveAttribute("aria-live", "polite");
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
