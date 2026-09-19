import { test, expect } from '../../fixtures/agent-test.js';
import { DEMO_HTML } from '../helpers/demo-page.js';

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

test('adds red shirt to basket with live model', async ({ page, agentStep }) => {
  await page.setContent(DEMO_HTML);

  const result = await agentStep({
    action: 'Add the red medium shirt to the basket',
    expect: [
      'The basket badge shows 1',
      'The basket contains the red medium shirt',
    ],
    timeout: 120_000,
  });

  expect(result.verification.passed).toBe(true);
  await expect(page.locator('#badge')).toHaveText('1');
});
