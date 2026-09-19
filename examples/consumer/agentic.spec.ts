import type { AgentStepInput } from '@sayer/agent-step';
import { expect, test } from './fixtures.js';

const addToBasket: AgentStepInput = {
  action: 'Add the red medium shirt to the basket',
  expect: [
    'The basket badge shows 1',
    'The basket contains the red medium shirt',
  ],
};

test('uses the package fixture', async ({ page, agentStep }) => {
  await page.goto('/shop');
  await agentStep(addToBasket);
  await expect(page.locator('[data-testid="basket-count"]')).toHaveText('1');
});
