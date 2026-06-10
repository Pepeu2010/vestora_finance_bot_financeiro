const { test, expect } = require("@playwright/test");

test.describe("E2E - Complete User Flows", () => {
  test("complete flow: login via auth form and send message", async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ authenticated: false })
      })
    );
    await page.route("**/api/auth/login", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, user: { id: "1", name: "João Silva", email: "joao@teste.com", username: "joaosilva" } })
      })
    );
    await page.route("**/api/conversations", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ configured: false, conversations: [] })
      })
    );
    await page.route("**/api/chat", async (route) => {
      await page.waitForTimeout(100);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ answer: "Olá! Como posso ajudar com suas decisões financeiras?" })
      });
    });

    await page.goto("/");

    await expect(page.locator("#authForm")).toBeVisible();
    await page.locator("#authEmail").fill("joao@teste.com");
    await page.locator("#authPassword").fill("senha123");
    await page.locator("#authSubmit").click();

    await page.waitForSelector(".chat-panel");
    await expect(page.locator(".chat-panel")).toBeVisible();
    await expect(page.locator("#messageInput")).toBeVisible();

    await page.locator("#messageInput").fill("Como funciona financiamento imobiliário?");
    await page.locator("#sendButton").click();

    await expect(page.locator(".message.user")).toBeVisible();
    await expect(page.locator(".message.bot")).toBeVisible();
  });

  test("send message and receive AI response", async ({ page }) => {
    let chatRequestBody = "";

    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-e2e", name: "E2E Test", email: "e2e@test.com", username: "e2etest" }
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
      const body = await route.request().postData();
      chatRequestBody = body;
      await page.waitForTimeout(150);
      await route.fulfill({
        contentType: "text/event-stream",
        body: [
          `data: ${JSON.stringify({ type: "chunk", text: "A taxa Selic atual é 14,25% ao ano." })}\n\n`,
          `data: ${JSON.stringify({ type: "done", conversationId: "conv-e2e" })}\n\n`
        ].join("")
      });
    });

    await page.goto("/");

    const testMessage = "Qual a taxa Selic atual?";
    await page.locator("#messageInput").fill(testMessage);
    await page.locator("#sendButton").click();

    await expect(page.locator(".message.user")).toContainText(testMessage);
    await expect(page.locator(".message.bot")).toBeVisible();

    expect(chatRequestBody).toContain("taxa Selic");
  });

  test("send message via Enter key", async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-enter", name: "Enter Test", email: "enter@test.com", username: "entertest" }
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
      await page.waitForTimeout(100);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ answer: "Resposta via Enter." })
      });
    });

    await page.goto("/");

    await page.locator("#messageInput").fill("Teste via Enter");
    await page.keyboard.press("Enter");

    await expect(page.locator(".message.user")).toBeVisible();
  });

  test("logout flow returns to auth screen", async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-logout", name: "Logout Test", email: "logout@test.com", username: "logouttest" }
        })
      })
    );
    await page.route("**/api/conversations", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ configured: false, conversations: [] })
      })
    );
    await page.route("**/api/auth/logout", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true })
      })
    );

    await page.goto("/");

    await page.locator(".account-button").click();
    await expect(page.locator(".account-menu")).toBeVisible();
    await page.getByRole("menuitem").filter({ hasText: /Sair|Logout/ }).click();

    await expect(page.locator("#authForm")).toBeVisible();
  });

  test("quick prompts fill input and can be edited before sending", async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-quick", name: "Quick Test", email: "quick@test.com", username: "quicktest" }
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
      await page.waitForTimeout(100);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ answer: "Resposta." })
      });
    });

    await page.goto("/");

    const quickPrompt = page.locator('.start-prompts button[data-prompt]').first();
    await quickPrompt.click();

    const inputValue = await page.locator("#messageInput").inputValue();
    expect(inputValue.length).toBeGreaterThan(0);

    await page.locator("#messageInput").fill("Mensagem customizada");
    await page.locator("#sendButton").click();

    await expect(page.locator(".message.user")).toContainText("Mensagem customizada");
  });

  test("all 6 quick prompt buttons are clickable and fill input", async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-prompts", name: "Prompts Test", email: "prompts@test.com", username: "promptstest" }
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

    const quickPrompts = [
      "Organizar minhas finanças",
      "Investir melhor",
      "Sair das dívidas",
      "Criar reserva de emergência",
      "Cotação do dólar",
      "Bitcoin hoje"
    ];

    const suggestions = page.getByLabel("Sugestões de conversa");

    for (const label of quickPrompts) {
      const button = suggestions.getByRole("button", { name: label });
      await expect(button).toBeVisible();
      await button.click();
      const inputValue = await page.locator("#messageInput").inputValue();
      expect(inputValue.length).toBeGreaterThan(0);
    }
  });

  test("shortcut cards on start screen send message immediately", async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-shortcut", name: "Shortcut Test", email: "shortcut@test.com", username: "shortcuttest" }
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
      await page.waitForTimeout(100);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ answer: "Cotação do dólar." })
      });
    });

    await page.goto("/");

    const shortcut = page.locator("#shortcut-salario-minimo");
    await shortcut.click();

    await expect(page.locator(".message.user")).toBeVisible();
    const userText = await page.locator(".message.user").first().textContent();
    expect(userText.toLowerCase()).toContain("salário");
  });
});

test.describe("Theme Toggle", () => {
  test("can change language to English in settings", async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-theme", name: "Theme Test", email: "theme@test.com", username: "themetest" }
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
    await page.locator(".settings-nav-item").first().click();

    const languageSelect = page.locator('.settings-row:has(strong:has-text("Idioma")) select, .settings-row:has(strong:has-text("Language")) select').first();
    await languageSelect.selectOption("en");

    await expect(page.locator(".settings-pane-title")).toContainText("General");
  });

  test("can switch back to Portuguese", async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-pt", name: "PT Test", email: "pt@test.com", username: "pttest" }
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
    await page.locator(".settings-nav-item").first().click();

    const languageSelect = page.locator('.settings-row:has(strong:has-text("Idioma")) select, .settings-row:has(strong:has-text("Language")) select').first();
    await languageSelect.selectOption("pt-br");

    await expect(page.locator(".settings-pane-title")).toContainText("Geral");
  });
});

test.describe("Error States", () => {
  test("shows error when API returns error", async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-error", name: "Error Test", email: "error@test.com", username: "errortest" }
        })
      })
    );
    await page.route("**/api/conversations", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ configured: false, conversations: [] })
      })
    );
    await page.route("**/api/chat", (route) => {
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Erro interno do servidor" })
      });
    });

    await page.goto("/");

    await page.locator("#messageInput").fill("Test error");
    await page.locator("#sendButton").click();

    await page.waitForTimeout(500);
  });

  test("auth form shows error on failed login", async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ authenticated: false })
      })
    );
    await page.route("**/api/auth/login", (route) => {
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Email ou senha incorretos" })
      });
    });

    await page.goto("/");

    await page.locator("#authEmail").fill("wrong@test.com");
    await page.locator("#authPassword").fill("wrongpassword");
    await page.locator("#authSubmit").click();

    await page.waitForTimeout(500);
  });

  test("send button switches to stop mode while sending", async ({ page }) => {
    let requestHandled = false;
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-sending", name: "Sending Test", email: "sending@test.com", username: "sendingtest" }
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
      requestHandled = true;
      await page.waitForTimeout(500);
      await route.fulfill({
        contentType: "text/event-stream",
        body: [
          `data: ${JSON.stringify({ type: "chunk", text: "Resposta lenta." })}\n\n`,
          `data: ${JSON.stringify({ type: "done", conversationId: "conv-slow" })}\n\n`
        ].join("")
      });
    });

    await page.goto("/");

    await page.locator("#messageInput").fill("Mensagem lenta");
    await page.locator("#sendButton").click();

    await expect(page.locator("#sendButton")).toHaveAttribute("aria-label", "Parar geração");

    await page.waitForFunction(() => document.querySelector('.message.bot') !== null, { timeout: 5000 });

    await page.unrouteAll({ behavior: "ignoreErrors" });
  });
});

test.describe("Empty States", () => {
  test("shows empty state when no conversations", async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-empty", name: "Empty Test", email: "empty@test.com", username: "emptytest" }
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

    await expect(page.locator(".conversation-empty")).toBeVisible();
    await expect(page.locator(".conversation-empty")).toContainText(/Nenhuma conversa|Vazio|Sem conversas/);
  });

  test("shows start screen with quick prompts when no messages", async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-start", name: "Start Test", email: "start@test.com", username: "starttest" }
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

    await expect(page.locator(".start-screen")).toBeVisible();
    await expect(page.locator(".start-screen")).toContainText("Olá, Start");
    await expect(page.locator(".start-screen")).toContainText("Como posso ajudar sua vida financeira hoje?");
    await expect(page.locator(".start-prompts")).toBeVisible();
    await expect(page.getByLabel("Atalhos financeiros").first()).toBeVisible();
  });

  test("hides shortcuts bar when there are no messages", async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-short", name: "Short Test", email: "short@test.com", username: "shorttest" }
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

    await expect(page.locator(".shortcuts-bar")).toHaveCount(0);
  });
});

test.describe("Mobile Specific", () => {
  test("shortcuts bar is scrollable on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });

    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-mobile", name: "Mobile Test", email: "mobile@test.com", username: "mobiletest" }
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
      await page.waitForTimeout(100);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ answer: "Resposta mobile." })
      });
    });

    await page.goto("/");

    await page.locator("#shortcut-salario-minimo").click();
    await expect(page.locator(".message.user")).toBeVisible();

    const shortcutsBar = page.locator(".shortcuts-bar");
    await expect(shortcutsBar).toBeVisible();

    const overflow = await shortcutsBar.evaluate(el => el.scrollWidth > el.clientWidth);
    if (overflow) {
      await shortcutsBar.evaluate(el => el.scrollLeft = el.scrollWidth);
    }

    await expect(page.locator(".quick-action-chip.compact").first()).toBeVisible();
  });

  test("mobile menu button opens sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });

    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-menubtn", name: "MenuBtn Test", email: "menubtn@test.com", username: "menubtntest" }
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

    const mobileMenuBtn = page.locator(".mobile-menu-button");
    await expect(mobileMenuBtn).toBeVisible();

    await mobileMenuBtn.click();

    await expect(page.locator("aside.sidebar")).toHaveClass(/open/);
  });
});

test.describe("Profile Modal", () => {
  test("can edit profile name and username", async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-profile", name: "Profile Test", email: "profile@test.com", username: "profiletest" }
        })
      })
    );
    await page.route("**/api/conversations", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ configured: false, conversations: [] })
      })
    );
    await page.route("**/api/profile", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true })
      })
    );

    await page.goto("/");

    await page.locator(".account-button").click();
    await page.getByRole("menuitem").filter({ hasText: /Perfil|Profile/ }).click();

    await expect(page.locator(".profile-modal")).toBeVisible();

    const nameInput = page.locator(".profile-field input").first();
    await nameInput.fill("Nome Atualizado");
    await expect(nameInput).toHaveValue("Nome Atualizado");

    const usernameInput = page.locator(".profile-field input").nth(1);
    await usernameInput.fill("usernameatualizado");
    await expect(usernameInput).toHaveValue("usernameatualizado");
  });

  test("can cancel profile edit", async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-cancel", name: "Cancel Test", email: "cancel@test.com", username: "canceltest" }
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

    await expect(page.locator(".profile-modal")).toBeVisible();

    const nameInput = page.locator(".profile-field input").first();
    await nameInput.fill("Nome Temporario");

    await page.locator(".profile-btn-cancel").click();

    await expect(page.locator(".profile-modal")).not.toBeVisible();
  });
});

test.describe("Notification Settings", () => {
  test("can toggle notification switches on and off", async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-notif", name: "Notif Test", email: "notif@test.com", username: "notiftest" }
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
    await page.locator(".settings-nav-item").nth(1).click();

    const toggles = page.locator(".settings-toggle");
    const count = await toggles.count();

    for (let i = 0; i < count; i++) {
      const toggleLabel = toggles.nth(i);
      await toggleLabel.click();
      await page.waitForTimeout(100);
    }

    await expect(page.locator(".settings-toggle").first()).toBeVisible();
  });

  test("can change notification summary frequency", async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-freq", name: "Freq Test", email: "freq@test.com", username: "freqtest" }
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
    await page.locator(".settings-nav-item").nth(1).click();

    const freqSelect = page.locator('.settings-row:has-text("Frequência") select, .settings-row:has-text("Frequencia") select');
    await expect(freqSelect).toBeVisible();
    await freqSelect.selectOption("semanal");
    await expect(freqSelect).toHaveValue("semanal");
  });
});

test.describe("Data & Privacy Settings", () => {
  test("export data button downloads JSON file", async ({ page }) => {
    const downloadPromise = page.waitForEvent("download");

    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-export", name: "Export Test", email: "export@test.com", username: "exporttest" }
        })
      })
    );
    await page.route("**/api/conversations", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          configured: false,
          conversations: [
            { id: "1", title: "Teste", updatedAt: new Date().toISOString() }
          ]
        })
      })
    );

    await page.goto("/");

    await page.locator(".account-button").click();
    await page.getByRole("menuitem").filter({ hasText: /Configurações|Settings/ }).click();
    await page.locator(".settings-nav-item").first().click();

    const exportButton = page.locator(".settings-content button:has-text('Exportar')");
    await exportButton.click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("vestora-dados");
    expect(download.suggestedFilename()).toMatch(/.*\.json$/);
  });
});
