import { test, expect } from '@playwright/test';
import { AgentRuntime, AgentStepError } from '../../src/agent/agent-runtime.js';
import { DEMO_HTML } from '../helpers/demo-page.js';
import { findRefByName } from '../helpers/snapshot-utils.js';
import {
  FakeModelClient,
  HangingModelClient,
  verificationResponse,
} from './fake-model-client.js';

test.describe('AgentRuntime framework tests', () => {
  test('executes action and passes verification', async ({ page }, testInfo) => {
    await page.setContent(DEMO_HTML);

    const snapshot = await page.ariaSnapshotJSON({ mode: 'ai' });
    const addRef = findRefByName(snapshot as never[], 'Add to basket');
    expect(addRef).toBeTruthy();

    const modelClient = new FakeModelClient([
      {
        toolCalls: [{ id: '1', name: 'snapshot', arguments: {} }],
      },
      {
        toolCalls: [
          {
            id: '2',
            name: 'click',
            arguments: { ref: addRef! },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: '3',
            name: 'done',
            arguments: { summary: 'Added red shirt' },
          },
        ],
      },
      verificationResponse([
        {
          criterion: 'The basket badge shows 1',
          passed: true,
          evidence: 'Badge text is 1',
        },
        {
          criterion: 'The basket contains the red medium shirt',
          passed: true,
          evidence: 'Basket list includes Red medium shirt',
        },
      ]),
    ]);

    const runtime = new AgentRuntime({
      page,
      testInfo,
      modelClient,
      allowedOrigins: ['null'],
      maxTurns: 5,
      defaultTimeout: 5_000,
    });

    const result = await runtime.runStep({
      action: 'Add the red medium shirt to the basket',
      expect: [
        'The basket badge shows 1',
        'The basket contains the red medium shirt',
      ],
    });

    expect(result.verification.passed).toBe(true);
    expect(await page.locator('#badge').textContent()).toBe('1');
  });

  test('fails closed when verification does not pass', async ({ page }, testInfo) => {
    await page.setContent(DEMO_HTML);

    const modelClient = new FakeModelClient([
      { toolCalls: [{ id: '1', name: 'snapshot', arguments: {} }] },
      {
        toolCalls: [
          { id: '2', name: 'done', arguments: { summary: 'Did nothing' } },
        ],
      },
      verificationResponse([
        {
          criterion: 'The basket badge shows 1',
          passed: false,
          evidence: 'Badge still shows 0',
        },
      ]),
    ]);

    const runtime = new AgentRuntime({
      page,
      testInfo,
      modelClient,
      allowedOrigins: ['null'],
      maxTurns: 3,
    });

    await expect(
      runtime.runStep({
        action: 'Add the red medium shirt to the basket',
        expect: ['The basket badge shows 1'],
      }),
    ).rejects.toBeInstanceOf(AgentStepError);
  });

  test('rejects malformed tool arguments', async ({ page }, testInfo) => {
    await page.setContent(DEMO_HTML);

    const modelClient = new FakeModelClient([
      {
        toolCalls: [
          {
            id: '1',
            name: 'click',
            arguments: { ref: 'e2' },
          },
        ],
      },
    ]);

    // Override chat to return malformed JSON arguments.
    modelClient.chat = async () => ({
      content: null,
      toolCalls: [{ id: 'bad', name: 'click', arguments: '{not-json' }],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });

    const runtime = new AgentRuntime({
      page,
      testInfo,
      modelClient,
      allowedOrigins: ['null'],
      maxTurns: 2,
    });

    await expect(
      runtime.runStep({
        action: 'Click add to basket',
        expect: ['The basket badge shows 1'],
      }),
    ).rejects.toThrow(/Malformed tool arguments/);
  });

  test('rejects disallowed origin navigation', async ({ page }, testInfo) => {
    await page.setContent(DEMO_HTML);

    const modelClient = new FakeModelClient([
      { toolCalls: [{ id: '1', name: 'snapshot', arguments: {} }] },
    ]);

    await page.goto('https://example.com');

    const runtime = new AgentRuntime({
      page,
      testInfo,
      modelClient,
      allowedOrigins: ['null'],
      maxTurns: 2,
    });

    await expect(
      runtime.runStep({
        action: 'Take a snapshot',
        expect: ['Page is visible'],
      }),
    ).rejects.toThrow(/Origin not allowed/);
  });

  test('exhausts max turns without done', async ({ page }, testInfo) => {
    await page.setContent(DEMO_HTML);

    const modelClient = new FakeModelClient([
      { toolCalls: [{ id: '1', name: 'snapshot', arguments: {} }] },
      { toolCalls: [{ id: '2', name: 'snapshot', arguments: {} }] },
      { toolCalls: [{ id: '3', name: 'snapshot', arguments: {} }] },
    ]);

    const runtime = new AgentRuntime({
      page,
      testInfo,
      modelClient,
      allowedOrigins: ['null'],
      maxTurns: 2,
    });

    await expect(
      runtime.runStep({
        action: 'Keep snapshotting forever',
        expect: ['Done'],
      }),
    ).rejects.toThrow(/exhausted maximum turns/);
  });

  test('redacts secret values in transcript attachments', async ({ page }, testInfo) => {
    await page.setContent(DEMO_HTML);

    const snapshot = await page.ariaSnapshotJSON({ mode: 'ai' });
    const emailRef = findRefByName(snapshot as never[], 'Email');
    expect(emailRef).toBeTruthy();

    const modelClient = new FakeModelClient([
      { toolCalls: [{ id: '1', name: 'snapshot', arguments: {} }] },
      {
        toolCalls: [
          {
            id: '2',
            name: 'fill',
            arguments: { ref: emailRef!, value: '%EMAIL%' },
          },
        ],
      },
      {
        toolCalls: [
          { id: '3', name: 'done', arguments: { summary: 'Filled email' } },
        ],
      },
      verificationResponse([
        {
          criterion: 'Signed in status mentions the email',
          passed: true,
          evidence: 'Login status updated',
        },
      ]),
    ]);

    const runtime = new AgentRuntime({
      page,
      testInfo,
      modelClient,
      allowedOrigins: ['null'],
      maxTurns: 4,
    });

    const result = await runtime.runStep({
      action: 'Sign in with email',
      expect: ['Signed in status mentions the email'],
      secrets: { EMAIL: 'secret@example.com' },
    });

    const fillCall = result.actionTranscript.find(
      (entry) => entry.type === 'tool_call' && entry.name === 'fill',
    );
    expect(fillCall?.input).toEqual({ ref: emailRef, value: '%EMAIL%' });
    expect(JSON.stringify(result.actionTranscript)).not.toContain('secret@example.com');
  });

  test('times out long-running steps', async ({ page }, testInfo) => {
    test.setTimeout(5_000);
    await page.setContent(DEMO_HTML);

    const modelClient = new HangingModelClient();

    const runtime = new AgentRuntime({
      page,
      testInfo,
      modelClient,
      allowedOrigins: ['null'],
      maxTurns: 2,
      defaultTimeout: 500,
    });

    await expect(
      runtime.runStep({
        action: 'Hang forever',
        expect: ['Done'],
        timeout: 500,
      }),
    ).rejects.toThrow(/timed out/);
  });
});
