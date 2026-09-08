import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const dataDir = join(tmpdir(), `mola-e2e-${randomUUID()}`);

export default defineConfig({
  testDir: './tests',
  testMatch: ['e2e.spec.ts', '**/*.e2e.spec.ts'],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
  webServer: [
    {
      command: 'node --import tsx server/index.ts',
      url: 'http://127.0.0.1:3101/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
      // The full suite shares one localhost IP for demo, login and registration.
      // This override is accepted only in NODE_ENV=test; production limits stay intact.
      env: { NODE_ENV: 'test', PORT: '3101', HOST: '127.0.0.1', DATA_DIR: dataDir, APP_ORIGIN: 'http://127.0.0.1:5174', ENABLE_DEMO: 'true', TRUST_PROXY: '0', MOLA_TEST_AUTH_LIMIT: '500', MOLA_TEST_API_LIMIT: '2000' },
    },
    {
      command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174 --strictPort',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { API_PROXY_TARGET: 'http://127.0.0.1:3101' },
    },
  ],
});
