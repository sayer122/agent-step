import { readFileSync } from 'node:fs';
import { expect, test as base } from '@playwright/test';
import { agentHealFixture } from '../../src/agent-heal-fixture.js';
import {
  BrokenBodySection,
  BrokenContentLevel,
  BrokenSectionLevel,
  SECTION_HTML,
} from '../helpers/section.page.js';
import type { ChatParams, ChatResponse, ModelClient } from '../../src/agent/types.js';

const refusingModel: ModelClient = {
  async chat(_params: ChatParams): Promise<ChatResponse> {
    throw new Error('stored locator chain should not call the model');
  },
};

const test = base.extend(agentHealFixture);
test.use({ agentHealModelClient: refusingModel });

test.beforeEach(async ({ page }) => {
  await page.setContent(SECTION_HTML);
});

test('repairs this.body when the stored parent locator is stale', async ({ page }, testInfo) => {
  await new BrokenBodySection(page).content.click({ timeout: 1_000, noWaitAfter: true });

  await expect(page.locator('#badge')).toHaveText('1');
  const patch = readFileSync(testInfo.outputPath('agent-heal.patch'), 'utf8');
  expect(patch).toContain("this.body = page.locator('.old-body')");
  expect(patch).toContain("this.body = page.locator('.body')");
  expect(patch).not.toContain('.contentsection');
  expect(patch).toContain('tests/helpers/section.page.ts');
});

test('repairs this.contentsection when the middle stored locator is stale', async ({
  page,
}, testInfo) => {
  await new BrokenSectionLevel(page).content.click({ timeout: 1_000, noWaitAfter: true });

  await expect(page.locator('#badge')).toHaveText('1');
  const patch = readFileSync(testInfo.outputPath('agent-heal.patch'), 'utf8');
  expect(patch).toContain("this.contentsection = this.body.locator('.old-section')");
  expect(patch).toContain("this.contentsection = this.body.locator('.contentsection')");
  expect(patch).not.toContain('.old-body');
});

test('repairs this.content when the last stored locator is stale', async ({ page }, testInfo) => {
  await new BrokenContentLevel(page).content.click({ timeout: 1_000, noWaitAfter: true });

  await expect(page.locator('#badge')).toHaveText('1');
  const patch = readFileSync(testInfo.outputPath('agent-heal.patch'), 'utf8');
  expect(patch).toContain("this.content = this.contentsection.locator('.old-content')");
  expect(patch).toContain("this.content = this.contentsection.locator('.content')");
  expect(patch).not.toContain('.old-section');
});
