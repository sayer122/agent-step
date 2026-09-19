import { expect, test } from '@playwright/test';
import { agentStep } from '@sayer/agent-step';

test('uses agentStep without a fixture', async ({ page }) => {
  await page.goto('/shop');

  await agentStep(page, {
    action: 'Add the red medium shirt to the basket',
    expect: ['The basket contains the red medium shirt'],
  });

  await expect(page.locator('[data-testid="basket-count"]')).toHaveText('1');
});
