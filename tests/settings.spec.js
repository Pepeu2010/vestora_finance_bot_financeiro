const { test, expect } = require("@playwright/test");

test.describe("Settings Modal Integration", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: {
            id: "user-123",
            name: "Nome Legado",
            display_name: "Pedro Conta",
            email: "config@botfinanceiro.local",
            username: null
          }
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
    await page.click(".account-button");
    await expect(page.locator(".account-menu")).toBeVisible();

    await page.click('button:has-text("Configurações")');
    await expect(page.locator(".settings-modal")).toBeVisible();

    await page.click('button:has-text("Geral")');
    await expect(page.locator(".settings-pane-title").first()).toHaveText("Geral");

    await page.locator('.settings-row:has(strong:has-text("Idioma")) select').selectOption('en');

    await expect(page.locator(".settings-pane-title").first()).toHaveText("General");
    await expect(page.locator('button:has-text("Account")')).toBeVisible();

    await page.locator('.settings-row:has(strong:has-text("Language")) select').selectOption('pt-br');
    await expect(page.locator(".settings-pane-title").first()).toHaveText("Geral");
  });

  test("can access security features (password and sessions) in Conta tab", async ({ page }) => {
    await page.click(".account-button");
    await page.click('button:has-text("Configurações")');

    await page.locator('.settings-nav-item:has-text("Conta")').click();
    await expect(page.locator(".settings-pane-title").first()).toHaveText("Conta");

    await page.click('button:has-text("Alterar")');
    await expect(page.locator('label:has-text("Senha atual")')).toBeVisible();

    await page.click('button:has-text("Ver")');
    await expect(page.locator('h4:has-text("Dispositivos conectados")')).toBeVisible();
    await expect(page.locator('span:has-text("Chrome em Linux")')).toBeVisible();
  });

  test("Conta tab prefers display_name and shows fallback for null username", async ({ page }) => {
    await page.click(".account-button");
    await page.click('button:has-text("Configurações")');
    await page.locator('.settings-nav-item:has-text("Conta")').click();

    const accountRows = page.locator(".settings-section").first().locator(".settings-row");

    await expect(accountRows.nth(0)).toContainText("Nome");
    await expect(accountRows.nth(0)).toContainText("Pedro Conta");
    await expect(accountRows.nth(0)).not.toContainText("Nome Legado");

    await expect(accountRows.nth(2)).toContainText("Nome de usuário");
    await expect(accountRows.nth(2)).toContainText("Não definido");
  });

  test("saving profile updates account info immediately", async ({ page }) => {
    let profilePayload = null;

    await page.route("**/api/auth/profile", async (route) => {
      profilePayload = JSON.parse(route.request().postData() || "{}");

      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "user-123",
            name: "Pedro Martins",
            display_name: "Pedro Martins",
            email: "config@botfinanceiro.local",
            username: "pedromartins"
          }
        })
      });
    });

    await page.click(".account-button");
    await page.click('button:has-text("Configurações")');
    await page.locator('.settings-nav-item:has-text("Conta")').click();

    await page.locator(".settings-section").first().locator(".settings-row").nth(0).getByRole("button", { name: "Editar" }).click();

    const nameInput = page.locator(".profile-field input").first();
    const usernameInput = page.locator(".profile-field input").nth(1);

    await nameInput.fill("Pedro Martins");
    await usernameInput.fill("pedromartins");
    await page.locator(".profile-btn-save").click();

    expect(profilePayload).toEqual({
      name: "Pedro Martins",
      username: "pedromartins"
    });

    await expect(page.locator(".profile-modal")).not.toBeVisible();

    const accountSection = page.locator(".settings-section").first();
    await expect(accountSection).toContainText("Pedro Martins");
    await expect(accountSection).toContainText("pedromartins");
  });
});
