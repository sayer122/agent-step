import type { Fixtures, Page } from '@playwright/test';
import { createHealingPage } from './agent/heal-page.js';
import type { ModelClient } from './agent/types.js';

export type AgentHealFixtures = {
  page: Page;
  agentHealModelClient: ModelClient | undefined;
  agentHealHeaders: Record<string, string> | undefined;
};

export const agentHealFixture: Fixtures<
  AgentHealFixtures,
  {},
  { page: Page }
> = {
  agentHealModelClient: [undefined, { option: true }],
  agentHealHeaders: [undefined, { option: true }],
  page: async ({ page, agentHealModelClient, agentHealHeaders }, use, testInfo) => {
    await use(
      createHealingPage(page, {
        testInfo,
        modelClient: agentHealModelClient,
        headers: agentHealHeaders,
      }),
    );
  },
};
