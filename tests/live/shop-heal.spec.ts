import { readFileSync } from 'node:fs';
import { expect, test as base } from '@playwright/test';
import { agentHealFixture } from '../../src/agent-heal-fixture.js';
import { SHOP_HEAL_HTML } from '../helpers/shop-heal-page.js';

const slowMo = Number(process.env.DEMO_SLOW_MO || 0);
const test = base.extend(agentHealFixture);

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
      'Live heal tests require AGENT_LLM_BASE_URL, AGENT_LLM_API_KEY, and AGENT_LLM_MODEL',
    );
  }
});

test('adds the shirt with a live model after the button class was renamed', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setContent(SHOP_HEAL_HTML);

  const started = Date.now();
  await page.locator('.add-to-basket').click({ timeout: 1_200, noWaitAfter: true });
  const elapsedMs = Date.now() - started;

  await expect(page.locator('#count')).toHaveText('1');
  const patch = readFileSync(testInfo.outputPath('agent-heal.patch'), 'utf8');
  console.log(`live shop heal took ${elapsedMs}ms`);
  console.log(patch);
  if (slowMo > 0) await page.waitForTimeout(1_500);
});
