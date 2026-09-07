import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

process.env.MOLA_ADMIN_E2E_DATA_DIR ||= join(
  tmpdir(),
  `mola-admin-e2e-${randomUUID()}`,
);

export default defineConfig({
  testDir: "./tests",
  testMatch: "system-admin.browser.ts",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results/admin-system",
  use: {
    baseURL: "http://127.0.0.1:5178",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "admin-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  webServer: [
    {
      command: "node --import tsx server/index.ts",
      url: "http://127.0.0.1:3114/api/health",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: "test",
        PORT: "3114",
        HOST: "127.0.0.1",
        DATA_DIR: process.env.MOLA_ADMIN_E2E_DATA_DIR,
        APP_ORIGIN: "http://127.0.0.1:5178",
        REQUIRE_EMAIL_VERIFICATION: "false",
        TRUST_PROXY: "0",
        MOLA_TEST_AUTH_LIMIT: "100",
        SMTP_HOST: "",
      },
    },
    {
      command:
        "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5178 --strictPort",
      url: "http://127.0.0.1:5178",
      reuseExistingServer: false,
      timeout: 120_000,
      env: { API_PROXY_TARGET: "http://127.0.0.1:3114" },
    },
  ],
});
