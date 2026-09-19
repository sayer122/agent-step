# agent-step

A Playwright fixture for adding agentic actions to tests and combining them with other test steps.

You keep writing Playwright as usual. When a bit of the UI is annoying to locate, you hand that part to `agentStep` in plain English, then assert the result yourself.

```ts
await agentStep({
  action: 'Add the red medium shirt to the basket',
  expect: ['The basket badge shows 1'],
});

await expect(page.locator('#badge')).toHaveText('1');
```

It drives the test's existing `page`. It does not spin up another browser or go through Playwright MCP.

## Install

```bash
npm install -D @sayer/agent-step @playwright/test
```

Needs Playwright 1.63+ and an OpenAI-compatible model that can do tool calling. OpenRouter works.

## Add it as a fixture

This is the bit you want. Put this in `tests/fixtures.ts` so it sits next to your other fixtures:

```ts
import { test as base, expect } from '@playwright/test';
import {
  agentStepFixture,
  type AgentStepFixtures,
} from '@sayer/agent-step';

export const test = base.extend<AgentStepFixtures>(agentStepFixture);
export { expect };
```

Then import `test` from there, not from `@playwright/test`:

```ts
import { test, expect } from './fixtures';

test('checkout', async ({ page, agentStep }) => {
  await page.goto('/shop');

  await agentStep({
    action: 'Add the red medium shirt to the basket',
    expect: [
      'The basket badge shows 1',
      'The basket contains the red medium shirt',
    ],
  });

  await expect(page.locator('#badge')).toHaveText('1');
});
```

`action` is what to do. `expect` is what should be true afterwards. Those are checked separately so the model that clicked around is not also marking its own homework.

## Or call it directly

If you do not want a fixture, keep the normal Playwright import and pass `page` in:

```ts
import { test, expect } from '@playwright/test';
import { agentStep } from '@sayer/agent-step';

test('checkout', async ({ page }) => {
  await page.goto('/shop');

  await agentStep(page, {
    action: 'Add the red medium shirt to the basket',
    expect: ['The basket contains the red medium shirt'],
  });
});
```

## Env

Set these where you run Playwright. The package reads `process.env` and does not load `.env` for you.

```bash
export AGENT_LLM_BASE_URL=https://openrouter.ai/api/v1
export AGENT_LLM_API_KEY=sk-or-...
export AGENT_LLM_MODEL=openai/gpt-4o-mini
```

`AGENT_LLM_BASE_URL` is the API root. Do not put `/chat/completions` on the end.

Same shape works for OpenAI (`https://api.openai.com/v1`) or anything else that speaks Chat Completions with tools.

The model has to support tool calling. If you get "no choices" back, it is usually the model slug or tools not being supported.

## Secrets

Do not put passwords in the prompt. Use a placeholder and pass the real value in `secrets`:

```ts
await agentStep({
  action: 'Sign in with the test account email',
  expect: ['Signed in as the test account email'],
  secrets: { EMAIL: process.env.TEST_EMAIL! },
});
```

In the action, tell it to type `%EMAIL%`. The value is filled in the browser and redacted from reports.

## How it behaves

Each `agentStep` is a Playwright `test.step`. It snapshots the page, does a small allowlisted set of actions (`browser_click`, `browser_type`, etc), then asks the model again whether the `expect` lines hold. Transcripts and failures get attached to the report.

It will not run arbitrary JS or leave the current origin. Retries are off so it does not click pay twice.

This is not a replacement for Playwright assertions. Use `expect` for anything you actually care about. Pin the model in CI. It will cost tokens and it will flake more than a locator.

## Repo

Source is at [github.com/Sayer122/agent-step](https://github.com/Sayer122/agent-step).
