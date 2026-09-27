import { expect, test as base } from '@playwright/test';
import { agentHealFixture } from '../../src/agent-heal-fixture.js';
import {
  CrowdedCheckoutPage,
  crowdedCheckoutHtml,
} from '../helpers/crowded-checkout.page.js';

const test = base.extend(agentHealFixture);

test.beforeAll(() => {
  if (
    !process.env.AGENT_LLM_BASE_URL ||
    !process.env.AGENT_LLM_API_KEY ||
    !process.env.AGENT_LLM_MODEL
  ) {
    throw new Error(
      'Live heal tests require AGENT_LLM_BASE_URL, AGENT_LLM_API_KEY, and AGENT_LLM_MODEL',
    );
  }
});

test('chooses the pay button for invoice 1042 among many invoices', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setContent(crowdedCheckoutHtml());

  const started = Date.now();
  await new CrowdedCheckoutPage(page).pay.click({ timeout: 1_000, noWaitAfter: true });
  const elapsedMs = Date.now() - started;

  await expect(page.locator('#chosen')).toHaveText('Pay invoice 1042');
  const healed = testInfo.annotations.find((annotation) => annotation.type === 'agent-healed');
  console.log(`live crowded heal took ${elapsedMs}ms: ${healed?.description}`);
});
