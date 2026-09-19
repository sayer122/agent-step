import { test as base, expect } from '@playwright/test';
import {
  agentStepFixture,
  type AgentStepFixtures,
} from '@sayer122/playwright-agent-step';

export const test = base.extend<AgentStepFixtures>(agentStepFixture);

export { expect };
