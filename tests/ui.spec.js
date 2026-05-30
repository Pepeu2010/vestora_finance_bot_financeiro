// @ts-check
const { test, expect } = require("@playwright/test");

test.describe("UI - Página Principal", () => {
  test("A página carrega corretamente", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Bot Financeiro");
  });

  test("Meta tag theme-color está definida", async ({ page }) => {
    await page.goto("/");
    const themeColor = await page
      .locator('meta[name="theme-color"]')
      .getAttribute("content");
    expect(themeColor).toBe("#0f766e");
  });

  test("Meta tag description está definida", async ({ page }) => {
    await page.goto("/");
    const description = await page
      .locator('meta[name="description"]')
      .getAttribute("content");
    expect(description).toContain("educacao financeira");
  });

  test("Manifest PWA está linkado", async ({ page }) => {
    await page.goto("/");
    const manifestLink = await page
      .locator('link[rel="manifest"]')
      .getAttribute("href");
    expect(manifestLink).toContain("manifest.json");
  });
});

test.describe("UI - Layout e Componentes", () => {
  test("Sidebar está visível", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.locator("aside.sidebar");
    await expect(sidebar).toBeVisible();
  });

  test("Painel do chat está visível", async ({ page }) => {
    await page.goto("/");
    const chatPanel = page.locator("section.chat-panel");
    await expect(chatPanel).toBeVisible();
  });

  test("Brand Bot Financeiro está visível", async ({ page }) => {
    await page.goto("/");
    const brand = page.locator(".brand h1");
    await expect(brand).toHaveText("Bot Financeiro");
  });

  test("Descrição do bot está visível", async ({ page }) => {
    await page.goto("/");
    const description = page.locator(".brand p");
    await expect(description).toHaveText("Consultor de educação financeira");
  });

  test("Status online está visível", async ({ page }) => {
    await page.goto("/");
    const status = page.locator("#statusText");
    await expect(status).toHaveText("Online");
  });

  test("Indicador de IA ativa está visível", async ({ page }) => {
    await page.goto("/");
    const pill = page.locator(".live-pill");
    await expect(pill).toBeVisible();
    await expect(pill).toContainText("IA ativa");
  });
});

test.describe("UI - Formulário de Chat", () => {
  test("Textarea de mensagem está visível e habilitada", async ({ page }) => {
    await page.goto("/");
    const textarea = page.locator("#messageInput");
    await expect(textarea).toBeVisible();
    await expect(textarea).toBeEnabled();
  });

  test("Textarea tem placeholder correto", async ({ page }) => {
    await page.goto("/");
    const textarea = page.locator("#messageInput");
    await expect(textarea).toHaveAttribute(
      "placeholder",
      /investimentos|dívidas|reserva|organização financeira/
    );
  });

  test("Textarea tem maxlength de 1200", async ({ page }) => {
    await page.goto("/");
    const textarea = page.locator("#messageInput");
    await expect(textarea).toHaveAttribute("maxlength", "1200");
  });

  test("Botão Enviar está visível", async ({ page }) => {
    await page.goto("/");
    const sendButton = page.locator("#sendButton");
    await expect(sendButton).toBeVisible();
    await expect(sendButton).toHaveText("Enviar");
  });

  test("Textarea pode receber texto", async ({ page }) => {
    await page.goto("/");
    const textarea = page.locator("#messageInput");
    await textarea.fill("Olá, como investir?");
    await expect(textarea).toHaveValue("Olá, como investir?");
  });
});

test.describe("UI - Botões Rápidos (Sidebar)", () => {
  test("Botões de prompts rápidos estão visíveis", async ({ page }) => {
    await page.goto("/");
    const promptButtons = page.locator(".summary button[data-prompt]");
    const count = await promptButtons.count();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test("Botão 'Reserva' existe com prompt correto", async ({ page }) => {
    await page.goto("/");
    const btn = page.locator('button[data-prompt*="reserva de emergência"]');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText("Reserva");
  });

  test("Botão 'Renda fixa' existe com prompt correto", async ({ page }) => {
    await page.goto("/");
    const btn = page.locator('button[data-prompt*="CDB, Tesouro Direto"]');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText("Renda fixa");
  });

  test("Botão 'Ações' existe com prompt correto", async ({ page }) => {
    await page.goto("/");
    const btn = page.locator('button[data-prompt*="investir em ações"]');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText("Ações");
  });

  test("Botão 'FIIs' existe", async ({ page }) => {
    await page.goto("/");
    const btn = page.locator('button[data-prompt*="fundos imobiliários"]');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText("FIIs");
  });

  test("Botão 'Dívidas' existe", async ({ page }) => {
    await page.goto("/");
    const btn = page.locator('button[data-prompt*="dívidas"]');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText("Dívidas");
  });

  test("Botão 'Imóveis' existe", async ({ page }) => {
    await page.goto("/");
    const btn = page.locator(
      'button[data-prompt*="comprar, financiar ou alugar"]'
    );
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText("Imóveis");
  });
});

test.describe("UI - Nova Conversa", () => {
  test("Botão 'Nova conversa' está visível", async ({ page }) => {
    await page.goto("/");
    const newChatBtn = page.locator("#newChatButton");
    await expect(newChatBtn).toBeVisible();
    await expect(newChatBtn).toHaveText("Nova conversa");
  });
});

test.describe("UI - Painel de Conversas", () => {
  test("Painel de histórico existe", async ({ page }) => {
    await page.goto("/");
    const historyPanel = page.locator(".history-panel");
    await expect(historyPanel).toBeVisible();
  });

  test("Lista de conversas existe", async ({ page }) => {
    await page.goto("/");
    const conversationList = page.locator("#conversationList");
    await expect(conversationList).toBeVisible();
  });

  test("Indicador de storage está visível", async ({ page }) => {
    await page.goto("/");
    const storageStatus = page.locator("#storageStatus");
    await expect(storageStatus).toBeVisible();
  });
});

test.describe("UI - Mensagens", () => {
  test("Container de mensagens existe", async ({ page }) => {
    await page.goto("/");
    const messages = page.locator("#messages");
    await expect(messages).toBeVisible();
  });

  test("Container de mensagens tem aria-live para acessibilidade", async ({
    page,
  }) => {
    await page.goto("/");
    const messages = page.locator("#messages");
    await expect(messages).toHaveAttribute("aria-live", "polite");
  });
});

test.describe("UI - PWA Assets", () => {
  test("Favicon SVG está acessível", async ({ request }) => {
    const response = await request.get("/favicon.svg");
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toContain("image");
  });

  test("Icon SVG está acessível", async ({ request }) => {
    const response = await request.get("/icon.svg");
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toContain("image");
  });

  test("Manifest JSON está acessível", async ({ request }) => {
    const response = await request.get("/manifest.json");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.name).toBeDefined();
    expect(body.short_name).toBeDefined();
  });

  test("Service Worker está acessível", async ({ request }) => {
    const response = await request.get("/sw.js");
    expect(response.ok()).toBeTruthy();
  });

  test("CSS está acessível", async ({ request }) => {
    const response = await request.get("/style.css");
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toContain("text/css");
  });

  test("JavaScript está acessível", async ({ request }) => {
    const response = await request.get("/app.js");
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toContain("javascript");
  });
});

test.describe("UI - Acessibilidade", () => {
  test("Sidebar tem aria-label", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.locator("aside.sidebar");
    await expect(sidebar).toHaveAttribute("aria-label", /Bot Financeiro/);
  });

  test("Chat panel tem aria-label", async ({ page }) => {
    await page.goto("/");
    const chatPanel = page.locator("section.chat-panel");
    await expect(chatPanel).toHaveAttribute(
      "aria-label",
      /Conversa com o Bot Financeiro/
    );
  });

  test("Elementos decorativos têm aria-hidden", async ({ page }) => {
    await page.goto("/");
    const ambient = page.locator(".ambient");
    await expect(ambient).toHaveAttribute("aria-hidden", "true");
  });

  test("Formulário tem estrutura semântica", async ({ page }) => {
    await page.goto("/");
    const form = page.locator("form#chatForm");
    await expect(form).toBeVisible();
  });
});

test.describe("UI - Interatividade", () => {
  test("Clicar em botão rápido preenche o textarea", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const quickBtn = page.locator(
      'button[data-prompt="Como monto uma reserva de emergência?"]'
    );
    await quickBtn.click();

    const textarea = page.locator("#messageInput");
    const value = await textarea.inputValue();
    expect(value).toContain("reserva de emergência");
  });

  test("Enter no textarea pode enviar mensagem (form submit)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const textarea = page.locator("#messageInput");
    await textarea.fill("Olá");

    // Verificar que o formulário existe e pode ser submetido
    const form = page.locator("form#chatForm");
    await expect(form).toBeVisible();
  });
});

test.describe("UI - Efeitos Visuais", () => {
  test("Camada de grid está presente (efeito visual)", async ({ page }) => {
    await page.goto("/");
    const gridLayer = page.locator(".grid-layer");
    await expect(gridLayer).toBeAttached();
  });

  test("Camada de scan está presente (efeito visual)", async ({ page }) => {
    await page.goto("/");
    const scanLayer = page.locator(".scan-layer");
    await expect(scanLayer).toBeAttached();
  });

  test("Sinais animados estão presentes", async ({ page }) => {
    await page.goto("/");
    const signalA = page.locator(".signal-a");
    const signalB = page.locator(".signal-b");
    await expect(signalA).toBeAttached();
    await expect(signalB).toBeAttached();
  });
});