import { test, expect } from '../../fixtures/agent-test.js';
import { FakeModelClient, verificationResponse } from './fake-model-client.js';
import { AgentRuntime } from '../../src/agent/agent-runtime.js';
import { DEMO_HTML } from '../helpers/demo-page.js';

test.describe('agentStep fixture', () => {
  test.beforeEach(async ({ page }) => {
    await page.setContent(DEMO_HTML);
  });

  test('wraps execution in a Playwright test step', async ({
    page,
  }, testInfo) => {
    const modelClient = new FakeModelClient([
      { toolCalls: [{ id: '1', name: 'browser_snapshot', arguments: {} }] },
      {
        toolCalls: [
          { id: '2', name: 'done', arguments: { summary: 'noop' } },
        ],
      },
      verificationResponse([
        {
          criterion: 'Shop heading is visible',
          passed: true,
          evidence: 'Heading present in snapshot',
        },
      ]),
    ]);

    // Inject fake model by replacing runtime creation via env bypass pattern:
    // fixture uses env model by default, so call runtime directly here to validate step wrapper behavior.
    const runtime = new AgentRuntime({
      page,
      testInfo,
      modelClient,
      allowedOrigins: ['null'],
      maxTurns: 3,
    });

    await test.step('manual agent wrapper', async () => {
      const result = await runtime.runStep({
        action: 'Confirm shop heading',
        expect: ['Shop heading is visible'],
      });
      expect(result.verification.passed).toBe(true);
    });
  });
});
