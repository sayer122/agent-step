import { expect, test as base } from '@playwright/test';
import { agentHealFixture } from '../../src/agent-heal-fixture.js';
import {
  CrowdedCheckoutChain,
  CrowdedCheckoutPage,
  crowdedCheckoutHtml,
} from '../helpers/crowded-checkout.page.js';
import { findRefByName } from '../helpers/snapshot-utils.js';
import type { ChatParams, ChatResponse, ModelClient } from '../../src/agent/types.js';

const model: ModelClient & { calls: number } = {
  calls: 0,
  async chat(params: ChatParams): Promise<ChatResponse> {
    model.calls += 1;
    const user = params.messages.find((message) => message.role === 'user');
    const body = JSON.parse(String(user?.content)) as { snapshot?: unknown };
    const text = JSON.stringify(body.snapshot);
    if ((text.match(/Pay invoice/g) ?? []).length < 20) {
      throw new Error('crowded snapshot was not sent to the model');
    }
    const snapshot = Array.isArray(body.snapshot) ? body.snapshot : [body.snapshot];
    const ref = findRefByName(snapshot as never[], 'Pay invoice 1042');
    return {
      content: JSON.stringify(ref ? { ref } : { ref: null }),
      toolCalls: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  },
};

const test = base.extend(agentHealFixture);
test.use({ agentHealModelClient: model });

test('asks the model to choose among many similar controls', async ({ page }) => {
  model.calls = 0;
  await page.setContent(crowdedCheckoutHtml());

  await new CrowdedCheckoutPage(page).pay.click({ timeout: 1_000, noWaitAfter: true });

  expect(model.calls).toBe(1);
  await expect(page.locator('#chosen')).toHaveText('Pay invoice 1042');
});

test('asks the model to choose through a three-level locator chain', async ({
  page,
}, testInfo) => {
  model.calls = 0;
  await page.setContent(crowdedCheckoutHtml());

  await new CrowdedCheckoutChain(page).pay.click({ timeout: 1_000, noWaitAfter: true });

  expect(model.calls).toBe(1);
  await expect(page.locator('#chosen')).toHaveText('Pay invoice 1042');
  const healed = testInfo.annotations.find((annotation) => annotation.type === 'agent-healed');
  expect(healed?.description).toContain('locator(');
  expect(healed?.description).not.toContain('getByRole');
});
