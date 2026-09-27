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

test('adds the shirt after the button class was renamed', async ({ page }, testInfo) => {
  await page.setContent(SHOP_HEAL_HTML);

  await page.locator('.card .add-to-basket').click({ timeout: 1_200, noWaitAfter: true });

  await expect(page.locator('#count')).toHaveText('1');
  const patch = readFileSync(testInfo.outputPath('agent-heal.patch'), 'utf8');
  console.log(patch);
  if (slowMo > 0) await page.waitForTimeout(1_500);
});
