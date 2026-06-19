// @ts-check
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  webServer: {
    command: "node server.js",
    port: 3005,
    timeout: 30000,
    reuseExistingServer: true,
  },
  use: {
    baseURL: "http://localhost:3005",
    headless: true,
    screenshot: "only-on-failure",
    trace: "off",
    actionTimeout: 10000,
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
