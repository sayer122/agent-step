import { expect, test as base } from '@playwright/test';
import {
  agentStepFixture,
  type AgentStepFixtures,
} from '../../src/agent-test.js';
import { SHOP_HEAL_HTML } from '../helpers/shop-heal-page.js';

const slowMo = Number(process.env.DEMO_SLOW_MO || 0);
const test = base.extend<AgentStepFixtures>(agentStepFixture);

test.use({
  viewport: { width: 960, height: 720 },
  launchOptions: { slowMo: Number.isFinite(slowMo) ? slowMo : 0 },
});

test.beforeAll(() => {
  if (
    !process.env.AGENT_LLM_BASE_URL ||
    !process.env.AGENT_LLM_API_KEY ||
    !process.env.AGENT_LLM_MODEL
  ) {
    throw new Error(
      'Live agent tests require AGENT_LLM_BASE_URL, AGENT_LLM_API_KEY, and AGENT_LLM_MODEL',
    );
  }
});

test('adds the red shirt with a live agent step', async ({ page, agentStep }) => {
  test.setTimeout(120_000);
  await page.setContent(SHOP_HEAL_HTML);

  const started = Date.now();
  const result = await agentStep({
    action: 'Add the red medium shirt to the basket',
    expect: ['The basket count shows 1'],
    timeout: 90_000,
  });
  const elapsedMs = Date.now() - started;

  expect(result.verification.passed).toBe(true);
  await expect(page.locator('#count')).toHaveText('1');
  console.log(`live agent step took ${elapsedMs}ms`);
  if (slowMo > 0) await page.waitForTimeout(1_500);
});
