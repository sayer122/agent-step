import { expect, test as base } from '@playwright/test';
import { agentHealFixture } from '../../src/agent-heal-fixture.js';

const test = base.extend(agentHealFixture);

const RENAMED_CLASS_HTML = `<!doctype html>
<html>
  <body>
    <button id="add-red" class="add-to-cart">Add to cart</button>
    <span id="badge">0</span>
    <script>
      document.getElementById('add-red').addEventListener('click', () => {
        document.getElementById('badge').textContent = '1';
      });
    </script>
  </body>
</html>`;

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

test('heals a renamed class locator with the live model', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setContent(RENAMED_CLASS_HTML);

  const started = Date.now();
  await page.locator('.add-to-basket').click({ timeout: 1_000, noWaitAfter: true });
  const elapsedMs = Date.now() - started;

  await expect(page.locator('#badge')).toHaveText('1');
  const healed = testInfo.annotations.find((annotation) => annotation.type === 'agent-healed');
  expect(healed?.description).toContain("locator('.add-to-basket')");
  console.log(`live heal took ${elapsedMs}ms: ${healed?.description}`);
});
