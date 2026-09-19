import { test as base, expect } from '@playwright/test';
import {
  agentStepFixture,
  type AgentStepFixtures,
} from '../src/agent-test.js';

export const test = base.extend<AgentStepFixtures>(agentStepFixture);

export { expect };
