const { test, expect } = require("@playwright/test");

test.describe("Settings Modal Integration", () => {
  test.beforeEach(async ({ page }) => {
    // Mock authentication
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: "user-123", name: "Teste Config", email: "config@botfinanceiro.local", username: "testeconfig" }
        })
      })
    );

    await page.route("**/api/conversations", (route) => {
      if (route.request().method() === "DELETE") {
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ configured: true }) });
      }
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ configured: false, conversations: [] })
      });
    });

    await page.route("**/api/auth/sessions", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          sessions: [
            { id: "current", device: "Chrome em Linux", ip: "127.0.0.1", current: true, lastActive: new Date().toISOString() }
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
  });

  test("can open Settings, navigate tabs and change language settings", async ({ page }) => {
    // Open Account menu
    await page.click(".account-button");
    await expect(page.locator(".account-menu")).toBeVisible();

    // Click Configurações
    await page.click('button:has-text("Configurações")');
    await expect(page.locator(".settings-modal")).toBeVisible();

    // Navigate to tabs
    await page.click('button:has-text("Personalização")');
    await expect(page.locator(".settings-pane-title").first()).toHaveText("Personalização");

    await page.click('button:has-text("Geral")');
    await expect(page.locator(".settings-pane-title").first()).toHaveText("Geral");

    // Change language to English
    await page.locator('.settings-row:has(strong:has-text("Idioma")) select').selectOption('en');
    
    // Check that UI translation works instantly
    await expect(page.locator(".settings-pane-title").first()).toHaveText("General");
    await expect(page.locator('button:has-text("Account")')).toBeVisible();

    // Switch back to Portuguese
    await page.locator('.settings-row:has(strong:has-text("Language")) select').selectOption('pt-br');
    await expect(page.locator(".settings-pane-title").first()).toHaveText("Geral");
  });

  test("can access security features (password and sessions) in Conta tab", async ({ page }) => {
    // Open account menu & settings
    await page.click(".account-button");
    await page.click('button:has-text("Configurações")');

    // Go to Conta tab
    await page.click('button:has-text("Conta")');
    await expect(page.locator(".settings-pane-title").first()).toHaveText("Conta");

    // Verify Password form opens
    await page.click('button:has-text("Alterar")');
    await expect(page.locator('label:has-text("Senha atual")')).toBeVisible();

    // Verify Active Sessions load
    await page.click('button:has-text("Ver")');
    await expect(page.locator('h4:has-text("Dispositivos conectados")')).toBeVisible();
    await expect(page.locator('span:has-text("Chrome em Linux")')).toBeVisible();
  });
});
