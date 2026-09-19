import { test, expect } from '../../fixtures/agent-test.js';
import { DEMO_HTML } from '../helpers/demo-page.js';

test.beforeAll(() => {
  if (
    !process.env.AGENT_LLM_BASE_URL ||
    !process.env.AGENT_LLM_API_KEY ||
    !process.env.AGENT_LLM_MODEL
  ) {
    throw new Error(
      'Agentic project requires AGENT_LLM_BASE_URL, AGENT_LLM_API_KEY, and AGENT_LLM_MODEL',
    );
  }
});

test('demo shop checkout flow', async ({ page, agentStep }) => {
  await page.setContent(DEMO_HTML);

  await agentStep({
    action: 'Add the red medium shirt to the basket',
    expect: [
      'The basket badge shows 1',
      'The basket contains the red medium shirt',
    ],
  });

  await expect(page.locator('#badge')).toHaveText('1');
});
