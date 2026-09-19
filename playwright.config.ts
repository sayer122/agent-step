import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: {
      mode: 'on-first-retry',
      snapshots: { dom: true, aria: true, screen: true },
    },
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'framework',
      testMatch: /framework\/.*\.spec\.ts/,
      retries: 0,
    },
    {
      name: 'agentic',
      testMatch: /agentic\/.*\.spec\.ts/,
      retries: 0,
      use: {
        baseURL: process.env.AGENT_BASE_URL ?? 'http://127.0.0.1:4173',
      },
    },
    {
      name: 'live',
      testMatch: /live\/.*\.spec\.ts/,
      retries: 0,
      use: {
        baseURL: process.env.AGENT_BASE_URL ?? 'http://127.0.0.1:4173',
      },
    },
  ],
});
