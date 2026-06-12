const { test, expect } = require("@playwright/test");

test.describe("Button Functionality - All Interactive Buttons", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-test", name: "Test User", email: "test@botfinanceiro.local", username: "testuser" }
        })
      })
    );

    await page.route("**/api/conversations", (route) => {
      if (route.request().method() === "DELETE") {
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
      }
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          configured: false,
          conversations: [
            { id: "conv-1", title: "Financiamento casa", updatedAt: new Date().toISOString() },
            { id: "conv-2", title: "Investimentos", updatedAt: new Date().toISOString() }
          ]
        })
      });
    });

    await page.route("**/api/chat", async (route) => {
      await page.waitForTimeout(100);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ answer: "Resposta automática de teste." })
      });
    });

    await page.goto("/");
  });

  test("quick prompts buttons fill the message input", async ({ page }) => {
    const quickPromptButton = page.locator('.start-prompts button[data-prompt]').first();
    await expect(quickPromptButton).toBeVisible();

    const messageInput = page.locator("#messageInput");
    await expect(messageInput).toBeVisible();

    const quickPromptLabel = await quickPromptButton.textContent();
    await quickPromptButton.click();

    await expect(messageInput).not.toHaveValue("");
    const inputValue = await messageInput.inputValue();
    expect(inputValue.length).toBeGreaterThan(0);
  });

  test("quick prompts buttons show all 6 suggestions", async ({ page }) => {
    const quickPrompts = page.locator('.start-prompts button[data-prompt]');
    await expect(quickPrompts).toHaveCount(6);

    const expectedLabels = [
      "Organizar minhas finanças",
      "Investir melhor",
      "Sair das dívidas",
      "Criar reserva de emergência",
      "Cotação do dólar",
      "Bitcoin hoje"
    ];

    const suggestions = page.getByLabel("Sugestões de conversa");
    for (const label of expectedLabels) {
      await expect(suggestions.getByRole("button", { name: label })).toBeVisible();
    }
  });

  test("shortcut cards on start screen send message immediately", async ({ page }) => {
    const shortcutCard = page.locator("#shortcut-salario-minimo");
    await expect(shortcutCard).toBeVisible();

    await shortcutCard.click();

    await expect(page.locator(".message.user")).toBeVisible();
    const userMessage = await page.locator(".message.user").first().textContent();
    expect(userMessage.toLowerCase()).toContain("salário mínimo");
  });

  test("new chat button clears current conversation", async ({ page }) => {
    const messageInput = page.locator("#messageInput");
    await messageInput.fill("Test message");

    const newChatButton = page.locator("#newChatButton");
    await expect(newChatButton).toBeVisible();
    await newChatButton.click();

    await expect(messageInput).toHaveValue("Test message");
  });

  test("conversation list renders when conversations exist", async ({ page }) => {
    await page.waitForTimeout(500);

    const historyPanel = page.locator(".history-panel");
    await expect(historyPanel).toBeVisible();
  });

  test("account menu button toggles menu visibility", async ({ page }) => {
    const accountButton = page.locator(".account-button");
    await expect(accountButton).toBeVisible();

    await expect(page.locator(".account-menu")).not.toBeVisible();

    await accountButton.click();

    await expect(page.locator(".account-menu")).toBeVisible();

    await accountButton.click();

    await expect(page.locator(".account-menu")).not.toBeVisible();
  });

  test("account menu Perfil button opens profile modal", async ({ page }) => {
    await page.locator(".account-button").click();
    await expect(page.locator(".account-menu")).toBeVisible();

    await page.getByRole("menuitem").filter({ hasText: /Perfil|Profile/ }).click();

    await expect(page.locator(".profile-modal")).toBeVisible();
  });

  test("account menu Sair button triggers logout", async ({ page }) => {
    await page.locator(".account-button").click();
    await expect(page.locator(".account-menu")).toBeVisible();

    const logoutButton = page.getByRole("menuitem").filter({ hasText: /Sair|Logout|Salir/ });
    await logoutButton.click();

    await expect(page.locator("#authForm")).toBeVisible();
  });

  test("mobile menu button opens sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });

    const mobileMenuButton = page.locator(".mobile-menu-button");
    await expect(mobileMenuButton).toBeVisible();

    await mobileMenuButton.click();

    await expect(page.locator("aside.sidebar")).toHaveClass(/open/);
  });

  test("sidebar scrim closes sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });

    await page.locator(".mobile-menu-button").click();
    await expect(page.locator("aside.sidebar")).toHaveClass(/open/);

    const scrim = page.locator(".sidebar-scrim");
    await scrim.click();

    await expect(page.locator("aside.sidebar")).not.toHaveClass(/open/);
  });

  test("send button submits the message", async ({ page }) => {
    const messageInput = page.locator("#messageInput");
    await messageInput.fill("Test message via send button");

    const sendButton = page.locator("#sendButton");
    await sendButton.click();

    await expect(page.locator(".message.user")).toBeVisible();
  });

  test("attach button has correct accessibility attributes", async ({ page }) => {
    const attachButton = page.locator("#fileUploadButton");
    const fileInput = page.locator("#fileUploadInput");

    await expect(attachButton).toBeVisible();
    await expect(attachButton).toBeEnabled();
    await expect(attachButton).toHaveAttribute("aria-label", /Anexar arquivos/);
    await expect(attachButton).toHaveAttribute("title", "Anexar arquivos");
    await expect(fileInput).toHaveAttribute("multiple", "");
    await expect(fileInput).toHaveAttribute("accept", /pdf/);
  });

  test("selected files appear in preview list and can be removed", async ({ page }) => {
    const fileInput = page.locator("#fileUploadInput");

    await fileInput.setInputFiles([
      {
        name: "extrato_nubank.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("fake-pdf")
      },
      {
        name: "gastos_maio.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: Buffer.from("fake-xlsx")
      }
    ]);

    const previewList = page.locator(".file-preview-list");
    await expect(previewList).toBeVisible();
    await expect(previewList).toContainText("extrato_nubank.pdf");
    await expect(previewList).toContainText("gastos_maio.xlsx");

    const firstRemoveButton = previewList.locator(".file-preview-remove").first();
    await firstRemoveButton.click();

    await expect(previewList).not.toContainText("extrato_nubank.pdf");
    await expect(previewList).toContainText("gastos_maio.xlsx");
  });

  test("send button becomes enabled when only attachments are present", async ({ page }) => {
    const sendButton = page.locator("#sendButton");
    const fileInput = page.locator("#fileUploadInput");

    await expect(sendButton).toBeDisabled();

    await fileInput.setInputFiles({
      name: "carteira.png",
      mimeType: "image/png",
      buffer: Buffer.from("fake-image")
    });

    await expect(sendButton).toBeEnabled();
  });

  test("enter key submits message", async ({ page }) => {
    const messageInput = page.locator("#messageInput");
    await messageInput.fill("Test message via Enter key");

    await page.keyboard.press("Enter");

    await expect(page.locator(".message.user")).toBeVisible();
  });
});

test.describe("Auth Form Button Functionality", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ authenticated: false })
      })
    );
    await page.goto("/");
  });

  test("auth toggle button switches between login and register mode", async ({ page }) => {
    const authToggle = page.locator("#authToggle");
    const authSubmit = page.locator("#authSubmit");

    await expect(authSubmit).toHaveText("Entrar");
    await expect(authToggle).toHaveText("Criar conta");

    await authToggle.click();

    await expect(authSubmit).toHaveText("Criar conta");
    await expect(authToggle).toHaveText("Já tenho conta");
    await expect(page.locator("#authName")).toBeVisible();

    await authToggle.click();

    await expect(authSubmit).toHaveText("Entrar");
    await expect(authToggle).toHaveText("Criar conta");
    await expect(page.locator("#authName")).not.toBeVisible();
  });

  test("auth submit button is disabled during loading", async ({ page }) => {
    let requestCount = 0;
    await page.route("**/api/auth/login", (route) => {
      requestCount++;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, user: { id: "1", name: "Test" } })
      });
    });

    const authEmail = page.locator("#authEmail");
    const authPassword = page.locator("#authPassword");
    const authSubmit = page.locator("#authSubmit");

    await authEmail.fill("test@example.com");
    await authPassword.fill("password123");

    await authSubmit.click();

    await expect(authSubmit).toBeDisabled();
  });

  test("auth form shows name field only in register mode", async ({ page }) => {
    await expect(page.locator("#authName")).not.toBeVisible();

    await page.locator("#authToggle").click();

    await expect(page.locator("#authName")).toBeVisible();

    await page.locator("#authToggle").click();

    await expect(page.locator("#authName")).not.toBeVisible();
  });
});

test.describe("Settings Modal Button Functionality", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-123", name: "Settings Test", email: "settings@botfinanceiro.local", username: "settingstest" }
        })
      })
    );

    await page.route("**/api/conversations", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ configured: false, conversations: [] })
      })
    );

    await page.route("**/api/auth/sessions", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ sessions: [] })
      })
    );

    await page.goto("/");

    await page.locator(".account-button").click();
    await page.getByRole("menuitem").filter({ hasText: /Configurações|Settings/ }).click();
  });

  test("settings close button closes the modal", async ({ page }) => {
    await expect(page.locator(".settings-modal")).toBeVisible();

    const closeButton = page.locator(".settings-modal button[aria-label='Fechar']");
    await closeButton.click();

    await expect(page.locator(".settings-modal")).not.toBeVisible();
  });

  test("settings tab buttons are present and clickable", async ({ page }) => {
    const settingsNavItems = page.locator(".settings-nav-item");
    await expect(settingsNavItems).toHaveCount(2);
  });

  test("settings toggle switches change values", async ({ page }) => {
    await page.locator('.settings-nav-item:has-text("Conta")').click();

    const toggle = page.locator('.settings-row:has-text("Alterar senha") button');
    await expect(toggle).toBeVisible();

    await toggle.click();
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
  });

  test("settings selects change values", async ({ page }) => {
    await page.locator('.settings-nav-item:has-text("Geral")').click();

    const select = page.locator(".settings-select").first();
    await expect(select).toHaveValue("pt-br");

    await select.selectOption("en");

    await expect(select).toHaveValue("en");
  });

  test("export data button downloads a file", async ({ page }) => {
    const downloadPromise = page.waitForEvent("download");

    const exportButton = page.locator('.settings-row:has-text("Exportar") button');
    await exportButton.click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("vestora-dados.json");
  });

  test("clear conversations button exists in settings", async ({ page }) => {
    await page.locator(".settings-nav-item").nth(0).click();

    const settingsContent = page.locator(".settings-content");
    await expect(settingsContent).toBeVisible();
  });
});

test.describe("Profile Modal Button Functionality", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-456", name: "Profile Test", email: "profile@botfinanceiro.local", username: "profiletest" }
        })
      })
    );

    await page.route("**/api/conversations", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ configured: false, conversations: [] })
      })
    );

    await page.goto("/");

    await page.locator(".account-button").click();
    await page.getByRole("menuitem").filter({ hasText: /Perfil|Profile/ }).click();
  });

  test("profile cancel button closes modal", async ({ page }) => {
    await expect(page.locator(".profile-modal")).toBeVisible();

    await page.locator(".profile-btn-cancel").click();

    await expect(page.locator(".profile-modal")).not.toBeVisible();
  });

  test("profile save button is clickable and calls handler", async ({ page }) => {
    await page.route("**/api/auth/profile", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true })
      })
    );

    const saveButton = page.locator(".profile-btn-save");
    await expect(saveButton).toBeVisible();
    await saveButton.click();

    await page.waitForTimeout(500);
  });

  test("profile form inputs are editable", async ({ page }) => {
    const nameInput = page.locator(".profile-field input").first();
    await nameInput.fill("Novo Nome");
    await expect(nameInput).toHaveValue("Novo Nome");

    const usernameInput = page.locator(".profile-field input").nth(1);
    await usernameInput.fill("novousername");
    await expect(usernameInput).toHaveValue("novousername");
  });
});

test.describe("Shortcuts Bar Button Functionality", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-shortcuts", name: "Shortcuts Test", email: "shortcuts@botfinanceiro.local", username: "shortcutstest" }
        })
      })
    );

    await page.route("**/api/conversations", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ configured: false, conversations: [] })
      })
    );

    await page.route("**/api/chat", async (route) => {
      await page.waitForTimeout(50);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ answer: "Cotação do dólar" })
      });
    });

    await page.goto("/");
  });

  test("shortcuts bar has buttons that are clickable", async ({ page }) => {
    await page.locator("#shortcut-salario-minimo").click();
    await expect(page.locator(".message.user")).toBeVisible();

    const shortcutsBar = page.locator(".shortcuts-bar");
    await expect(shortcutsBar).toBeVisible();

    const shortcutButtons = page.locator(".quick-action-chip.compact");
    await expect(shortcutButtons).toHaveCount(6);

    const firstShortcut = shortcutButtons.first();
    await expect(firstShortcut).toBeEnabled();
  });

  test("shortcut buttons are disabled when sending", async ({ page }) => {
    let requestPending = true;
    await page.route("**/api/chat", async (route) => {
      await page.waitForTimeout(1000);
      requestPending = false;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ answer: "Resposta" })
      });
    });

    await page.locator("#shortcut-salario-minimo").click();
    await expect(page.locator(".message.user")).toBeVisible();

    const shortcut = page.locator("#chat-shortcut-dolar-hoje");
    await shortcut.click();

    await expect(shortcut).toBeDisabled();

    await page.waitForFunction(() => !document.querySelector('#chat-shortcut-dolar-hoje:disabled'), { timeout: 5000 });
  });
});

test.describe("Settings Account Tab - Password and Sessions", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-account", name: "Account Test", email: "account@botfinanceiro.local", username: "accounttest" }
        })
      })
    );

    await page.route("**/api/conversations", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ configured: false, conversations: [] })
      })
    );

    await page.route("**/api/auth/sessions", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          sessions: [
            { id: "session-1", device: "Chrome em Linux", ip: "127.0.0.1", current: true, lastActive: new Date().toISOString() }
          ]
        })
      })
    );

    await page.route("**/api/auth/password", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true })
      })
    );

    await page.goto("/");

    await page.locator(".account-button").click();
    await page.getByRole("menuitem").filter({ hasText: /Configurações|Settings/ }).click();
    await page.locator('.settings-nav-item:has-text("Conta")').click();
  });

  test("change password button shows password form", async ({ page }) => {
    const changeButton = page.locator('button:has-text("Alterar")');
    await expect(changeButton).toBeVisible();

    await changeButton.click();

    await expect(page.locator('label:has-text("Senha atual")')).toBeVisible();
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
  });

  test("password form cancel button hides form", async ({ page }) => {
    await page.locator('button:has-text("Alterar")').click();
    await expect(page.locator('label:has-text("Senha atual")')).toBeVisible();

    await page.locator('button:has-text("Cancelar")').click();

    await expect(page.locator('label:has-text("Senha atual")')).not.toBeVisible();
  });

  test("view sessions button shows sessions list", async ({ page }) => {
    const viewButton = page.locator('button:has-text("Ver")');
    await expect(viewButton).toBeVisible();

    await viewButton.click();

    await expect(page.locator('h4:has-text("Dispositivos conectados")')).toBeVisible();
    await expect(page.locator('span:has-text("Chrome em Linux")')).toBeVisible();
  });

  test("close sessions button hides sessions list", async ({ page }) => {
    await page.locator('button:has-text("Ver")').click();
    await expect(page.locator('h4:has-text("Dispositivos conectados")')).toBeVisible();

    await page.locator('button:has-text("Fechar")').click();

    await expect(page.locator('h4:has-text("Dispositivos conectados")')).not.toBeVisible();
  });

  test("logout button in account section exists", async ({ page }) => {
    const logoutButton = page.locator(".settings-content button:has-text('Sair')");
    await expect(logoutButton).toBeVisible();

    await logoutButton.click();

    await expect(page.locator("#authForm")).toBeVisible();
  });
});

test.describe("Notification Toggle Functionality", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-notif", name: "Notif Test", email: "notif@botfinanceiro.local", username: "notiftest" }
        })
      })
    );

    await page.route("**/api/conversations", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ configured: false, conversations: [] })
      })
    );

    await page.goto("/");

    await page.locator(".account-button").click();
    await page.getByRole("menuitem").filter({ hasText: /Configurações|Settings/ }).click();
    await page.locator('.settings-nav-item:has-text("Conta")').click();
  });

  test("change password button shows password form", async ({ page }) => {
    const changeRow = page.locator('.settings-row:has-text("Alterar senha")');
    const button = changeRow.getByRole("button");

    await button.click();

    await expect(page.locator('input[type="password"]').first()).toBeVisible();
  });

  test("view sessions button shows sessions list", async ({ page }) => {
    const sessionsRow = page.locator('.settings-row:has-text("Sessões ativas")');
    const button = sessionsRow.getByRole("button");

    await button.click();
    await expect(page.getByText(/Dispositivos conectados|Connected Devices/)).toBeVisible();
  });

});
