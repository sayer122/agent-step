import { expect, test } from '@playwright/test';
import { agentHeal, suggestionFromModel } from '../../src/agent/heal.js';
import { findRefByName } from '../helpers/snapshot-utils.js';
import { FakeModelClient } from './fake-model-client.js';

const RENAMED_BUTTON_HTML = `<!doctype html>
<html>
  <body>
    <button id="add-red">Add to cart</button>
    <span id="badge">0</span>
    <script>
      document.getElementById('add-red').addEventListener('click', () => {
        document.getElementById('badge').textContent = '1';
      });
    </script>
  </body>
</html>`;

test.describe('agentHeal', () => {
  test('retries a missing locator against the renamed control', async ({
    page,
  }, testInfo) => {
    await page.setContent(RENAMED_BUTTON_HTML);
    const snapshot = await page.ariaSnapshotJSON({ mode: 'ai' });
    const ref = findRefByName(snapshot as never[], 'Add to cart');
    expect(ref).toBeTruthy();

    const calls: string[] = [];
    const modelClient = new FakeModelClient([
      {
        content: JSON.stringify({
          ref,
          role: 'button',
          name: 'Add to cart',
        }),
      },
    ]);
    const chat = modelClient.chat.bind(modelClient);
    modelClient.chat = async (params) => {
      calls.push(params.toolChoice ?? 'auto');
      return chat(params);
    };

    await agentHeal(
      page.getByRole('button', { name: 'Add to basket' }),
      (locator) => locator.click({ timeout: 1_000, noWaitAfter: true }),
      { modelClient, testInfo, timeout: 5_000 },
    );

    expect(await page.locator('#badge').textContent()).toBe('1');
    expect(calls).toEqual(['none']);
    expect(
      testInfo.annotations.some(
        (annotation) =>
          annotation.type === 'agent-healed' &&
          annotation.description?.includes(
            'getByRole("button", { name: "Add to cart" })',
          ),
      ),
    ).toBe(true);
  });

  test('does not call the model when the locator works', async ({
    page,
  }, testInfo) => {
    await page.setContent(RENAMED_BUTTON_HTML);
    const modelClient = new FakeModelClient([]);
    await expect(page.getByRole('button', { name: 'Add to cart' })).toBeVisible();

    await agentHeal(
      page.getByRole('button', { name: 'Add to cart' }),
      (locator) => locator.click(),
      { modelClient, testInfo },
    );

    expect(await page.locator('#badge').textContent()).toBe('1');
    expect(testInfo.annotations.some((annotation) => annotation.type === 'agent-healed')).toBe(
      false,
    );
  });

  test('rethrows the timeout when the model finds no single match', async ({
    page,
  }, testInfo) => {
    await page.setContent(RENAMED_BUTTON_HTML);
    const modelClient = new FakeModelClient([
      { content: JSON.stringify({ ref: null }) },
    ]);

    await expect(
      agentHeal(
        page.getByRole('button', { name: 'Add to basket' }),
        (locator) => locator.click({ timeout: 1_000, noWaitAfter: true }),
        { modelClient, testInfo },
      ),
    ).rejects.toThrow(/Timeout \d+ms exceeded/);
    expect(testInfo.annotations.some((annotation) => annotation.type === 'agent-healed')).toBe(
      false,
    );
  });

  test('rethrows when the suggested ref is not in the snapshot', async ({
    page,
  }, testInfo) => {
    await page.setContent(RENAMED_BUTTON_HTML);
    const modelClient = new FakeModelClient([
      { content: JSON.stringify({ ref: 'e999', role: 'button', name: 'Missing' }) },
    ]);

    await expect(
      agentHeal(
        page.getByRole('button', { name: 'Add to basket' }),
        (locator) => locator.click({ timeout: 1_000, noWaitAfter: true }),
        { modelClient, testInfo },
      ),
    ).rejects.toThrow(/Timeout \d+ms exceeded/);
  });

  test('does not heal an assertion failure', async ({ page }, testInfo) => {
    await page.setContent(RENAMED_BUTTON_HTML);
    const modelClient = new FakeModelClient([]);

    await expect(
      agentHeal(
        page.getByRole('button', { name: 'Add to cart' }),
        async (locator) => {
          await expect(locator).toHaveText('Missing label');
        },
        { modelClient, testInfo },
      ),
    ).rejects.toThrow(/Missing label/);
  });

  test('rethrows a strict mode violation when no single control is chosen', async ({
    page,
  }, testInfo) => {
    await page.setContent(`
      <button>Add to basket</button>
      <button>Add to basket</button>
    `);
    const modelClient = new FakeModelClient([
      { content: JSON.stringify({ ref: null }) },
    ]);

    await expect(
      agentHeal(
        page.getByRole('button', { name: 'Add to basket' }),
        (locator) => locator.click({ timeout: 1_000, noWaitAfter: true }),
        { modelClient, testInfo },
      ),
    ).rejects.toThrow(/strict mode violation/);
  });

  test('rejects a ref that appears more than once in the snapshot', () => {
    expect(
      suggestionFromModel(
        { ref: 'e1' },
        [
          { role: 'button', name: 'Save', ref: 'e1' },
          {
            role: 'group',
            name: 'Actions',
            children: [{ role: 'button', name: 'Save', ref: 'e1' }],
          },
        ],
      ),
    ).toBeUndefined();
  });
});
