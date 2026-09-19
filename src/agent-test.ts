import type { Fixtures, Page } from '@playwright/test';
import { createAgentStep, type AgentStep } from './agent-step.js';

export type AgentStepFixtures = {
  agentStep: AgentStep;
};

export type AgentFixtures = AgentStepFixtures;

export const agentStepFixture: Fixtures<
  AgentStepFixtures,
  {},
  { page: Page }
> = {
  agentStep: async ({ page }, use, testInfo) => {
    await use(createAgentStep({ page, testInfo }));
  },
};
