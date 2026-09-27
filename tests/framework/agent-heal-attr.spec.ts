import { readFileSync } from 'node:fs';
import { expect, test as base } from '@playwright/test';
import { agentHealFixture } from '../../src/agent-heal-fixture.js';
import type { ChatParams, ChatResponse, ModelClient } from '../../src/agent/types.js';

const refusingModel: ModelClient = {
  async chat(_params: ChatParams): Promise<ChatResponse> {
    throw new Error('attribute repair should not call the model');
  },
};

const test = base.extend(agentHealFixture);
test.use({ agentHealModelClient: refusingModel });

function changedPatchLines(patch: string): string {
  return patch
    .split('\n')
    .filter((line) => /^[+-]/.test(line) && !line.startsWith('+++') && !line.startsWith('---'))
    .join('\n');
}

test('repairs an attribute selector when the value moves to another attribute', async ({
  page,
}, testInfo) => {
  await page.setContent(`
    <button data-qa="asdf1234" id="go">Go</button>
    <span id="badge">0</span>
    <script>
      document.getElementById('go').addEventListener('click', () => {
        document.getElementById('badge').textContent = '1';
      });
    </script>
  `);

  await page.locator('[hook="asdf1234"]').click({ timeout: 1_000, noWaitAfter: true });

  await expect(page.locator('#badge')).toHaveText('1');
  const patch = readFileSync(testInfo.outputPath('agent-heal.patch'), 'utf8');
  expect(patch).toContain('[hook="asdf1234"]');
  expect(patch).toContain('[data-qa="asdf1234"]');
});

test('repairs an attribute selector when the value moves to a class', async ({
  page,
}, testInfo) => {
  await page.setContent(`
    <button class="asdf1234" id="go">Go</button>
    <span id="badge">0</span>
    <script>
      document.getElementById('go').addEventListener('click', () => {
        document.getElementById('badge').textContent = '1';
      });
    </script>
  `);

  await page.locator('[test="asdf1234"]').click({ timeout: 1_000, noWaitAfter: true });

  await expect(page.locator('#badge')).toHaveText('1');
  const patch = readFileSync(testInfo.outputPath('agent-heal.patch'), 'utf8');
  expect(patch).toContain('[test="asdf1234"]');
  expect(patch).toContain("locator('.asdf1234')");
});

test('repairs the attribute step in a stored locator chain', async ({ page }, testInfo) => {
  await page.setContent(`
    <section class="checkout">
      <button data-action="pay" id="go">Pay</button>
    </section>
    <span id="badge">0</span>
    <script>
      document.getElementById('go').addEventListener('click', () => {
        document.getElementById('badge').textContent = '1';
      });
    </script>
  `);

  const checkout = page.locator('.checkout');
  const pay = checkout.locator('[test="pay"]');
  await pay.click({ timeout: 1_000, noWaitAfter: true });

  await expect(page.locator('#badge')).toHaveText('1');
  const patch = readFileSync(testInfo.outputPath('agent-heal.patch'), 'utf8');
  expect(patch).toContain('[test="pay"]');
  expect(patch).toContain('[data-action="pay"]');
  expect(changedPatchLines(patch)).not.toContain('.checkout');
});
