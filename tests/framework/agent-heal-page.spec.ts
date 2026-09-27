import { existsSync, readFileSync } from 'node:fs';
import { expect, test as base } from '@playwright/test';
import { agentHealFixture } from '../../src/agent-heal-fixture.js';
import { findRefByName } from '../helpers/snapshot-utils.js';
import type { ChatParams, ChatResponse, ModelClient } from '../../src/agent/types.js';

const CLASS_BUTTON_HTML = `<!doctype html>
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

function healingModel(name: string): ModelClient {
  return {
    async chat(params: ChatParams): Promise<ChatResponse> {
      const user = params.messages.find((message) => message.role === 'user');
      const body = JSON.parse(String(user?.content)) as { snapshot?: unknown };
      const snapshot = Array.isArray(body.snapshot) ? body.snapshot : [];
      const ref = findRefByName(snapshot as never[], name);
      return {
        content: JSON.stringify(ref ? { ref } : { ref: null }),
        toolCalls: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    },
  };
}

const test = base.extend(agentHealFixture);

test.describe('renamed class', () => {
test.use({ agentHealModelClient: healingModel('Add to cart') });

test('heals a broken class locator and writes a patch', async ({ page }, testInfo) => {
  await page.setContent(CLASS_BUTTON_HTML);

  await page.locator('.add-to-basket').click({ timeout: 1_000, noWaitAfter: true });

  expect(await page.locator('#badge').textContent()).toBe('1');
  expect(
    testInfo.annotations.some(
      (annotation) =>
        annotation.type === 'agent-healed' &&
        annotation.description?.includes("locator('.add-to-cart')"),
    ),
  ).toBe(true);

  const patch = readFileSync(testInfo.outputPath('agent-heal.patch'), 'utf8');
  expect(patch).toContain("locator('.add-to-basket')");
  expect(patch).toContain("locator('.add-to-cart')");
  expect(patch).toContain('tests/framework/agent-heal-page.spec.ts');
});

test('heals a locator that matches multiple elements', async ({ page }, testInfo) => {
  await page.setContent(`
    <button class="add-to-cart">Add to cart</button>
    <button class="add-to-cart">Add to cart later</button>
  `);

  await page.locator('.add-to-cart').click({ timeout: 1_000, noWaitAfter: true });

  expect(
    testInfo.annotations.some((annotation) => annotation.type === 'agent-healed'),
  ).toBe(true);
});

test('does not patch an unrelated unique class', async ({
  page,
}, testInfo) => {
  await page.setContent(`
    <button class="unrelated">Add to cart</button>
    <span id="badge">0</span>
    <script>
      document.querySelector('button').addEventListener('click', () => {
        document.getElementById('badge').textContent = '1';
      });
    </script>
  `);

  await page.locator('.add-to-basket').click({ timeout: 1_000, noWaitAfter: true });

  expect(await page.locator('#badge').textContent()).toBe('1');
  const patch = readFileSync(testInfo.outputPath('agent-heal.patch'), 'utf8');
  expect(patch).toContain('getByRole("button", { name: "Add to cart" })');
  expect(patch).not.toContain("locator('.unrelated')");
});
});

test.describe('ambiguous name', () => {
test.use({ agentHealModelClient: healingModel('Save') });

test('does not write a patch when the name is still ambiguous', async ({
  page,
}, testInfo) => {
  await page.setContent(`
    <button class="alpha">Save</button>
    <button class="beta">Save</button>
  `);

  await page.locator('.missing').click({ timeout: 1_000, noWaitAfter: true });

  expect(
    testInfo.annotations.some(
      (annotation) =>
        annotation.type === 'agent-healed' &&
        annotation.description?.includes('no unique locator to patch'),
    ),
  ).toBe(true);
  expect(existsSync(testInfo.outputPath('agent-heal.patch'))).toBe(false);
});
});
