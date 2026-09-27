import { readFileSync } from 'node:fs';
import { expect, test as base } from '@playwright/test';
import { agentHealFixture } from '../../src/agent-heal-fixture.js';
import { CheckoutPage, checkoutHtml } from '../helpers/checkout.page.js';
import type { ChatParams, ChatResponse, ModelClient } from '../../src/agent/types.js';

const refusingModel: ModelClient = {
  async chat(_params: ChatParams): Promise<ChatResponse> {
    throw new Error('chain repair should not call the model');
  },
};

const test = base.extend(agentHealFixture);
test.use({ agentHealModelClient: refusingModel });

test('repairs the selector when the page header has changed', async ({ page }, testInfo) => {
  await page.setContent(checkoutHtml('header'));
  await new CheckoutPage(page).payButton().click({ timeout: 1_000, noWaitAfter: true });

  await expect(page.locator('#badge')).toHaveText('1');
  const patch = readFileSync(testInfo.outputPath('agent-heal.patch'), 'utf8');
  expect(patch).toContain('.site-header .body-custom-name:visible .sub-element .pay-now');
  expect(patch).not.toContain('checkout-panel');
  expect(patch).not.toContain('submit-payment');
});

test('repairs the selector when the page body has changed', async ({ page }, testInfo) => {
  await page.setContent(checkoutHtml('body'));
  await new CheckoutPage(page).payButton().click({ timeout: 1_000, noWaitAfter: true });

  await expect(page.locator('#badge')).toHaveText('1');
  const patch = readFileSync(testInfo.outputPath('agent-heal.patch'), 'utf8');
  expect(patch).toContain('.header .checkout-panel:visible .sub-element .pay-now');
  expect(patch).not.toContain('site-header');
  expect(patch).not.toContain('submit-payment');
});

test('repairs the selector when the page button has changed', async ({ page }, testInfo) => {
  await page.setContent(checkoutHtml('button'));
  await new CheckoutPage(page).payButton().click({ timeout: 1_000, noWaitAfter: true });

  await expect(page.locator('#badge')).toHaveText('1');
  const patch = readFileSync(testInfo.outputPath('agent-heal.patch'), 'utf8');
  expect(patch).toContain('.header .body-custom-name:visible .sub-element .submit-payment');
  expect(patch).not.toContain('site-header');
  expect(patch).not.toContain('checkout-panel');
});
