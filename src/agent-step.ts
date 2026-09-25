import { test, type Page, type TestInfo } from '@playwright/test';
import { AgentRuntime, AgentStepError } from './agent/agent-runtime.js';
import { redactObject } from './agent/redaction.js';
import type { AgentStepInput, AgentStepResult } from './agent/types.js';

export type AgentStep = (input: AgentStepInput) => Promise<AgentStepResult>;

export interface CreateAgentStepOptions {
  page: Page;
  testInfo: TestInfo;
  /**
   * Extra headers sent on every LLM request for steps created by this factory.
   * String values only. A name here replaces the built-in attribution header.
   */
  headers?: Record<string, string>;
}

export function createAgentStep({
  page,
  testInfo,
  headers,
}: CreateAgentStepOptions): AgentStep {
  const runtime = new AgentRuntime({ page, testInfo, headers });

  return async (input) => {
    const action = input.action?.trim();
    const expectDescription = Array.isArray(input.expect)
      ? input.expect.join(' | ')
      : '';

    testInfo.annotations.push({
      type: 'agent-expect',
      description: expectDescription,
    });

    const title = action
      ? `agent: ${action}`
      : `agent: check ${expectDescription}`;

    return test.step(title, async (step) => {
      try {
        const result = await runtime.runStep(input);

        await step.attach('agent-transcript.json', {
          body: JSON.stringify(
            redactObject(result.actionTranscript, input.secrets ?? {}),
            null,
            2,
          ),
          contentType: 'application/json',
        });

        await step.attach('agent-verification.json', {
          body: JSON.stringify(result.verification, null, 2),
          contentType: 'application/json',
        });

        if (result.rawVerifierContent) {
          await step.attach('agent-verifier-raw.json', {
            body: result.rawVerifierContent,
            contentType: 'application/json',
          });
        }

        await step.attach('agent-token-usage.json', {
          body: JSON.stringify(result.tokenUsage, null, 2),
          contentType: 'application/json',
        });

        if (!result.verification.passed) {
          const screenshot = await page
            .screenshot({ fullPage: true })
            .catch(() => null);
          if (screenshot) {
            await step.attach('agent-failure.png', {
              body: screenshot,
              contentType: 'image/png',
            });
          }
        }

        return result;
      } catch (error) {
        const screenshot = await page
          .screenshot({ fullPage: true })
          .catch(() => null);
        if (screenshot) {
          await step.attach('agent-failure.png', {
            body: screenshot,
            contentType: 'image/png',
          });
        }

        if (error instanceof AgentStepError && error.result) {
          await step.attach('agent-transcript.json', {
            body: JSON.stringify(
              redactObject(error.result.actionTranscript, input.secrets ?? {}),
              null,
              2,
            ),
            contentType: 'application/json',
          });
            await step.attach('agent-verification.json', {
              body: JSON.stringify(error.result.verification, null, 2),
              contentType: 'application/json',
            });
            if (error.result.rawVerifierContent) {
              await step.attach('agent-verifier-raw.json', {
                body: error.result.rawVerifierContent,
                contentType: 'application/json',
              });
            }
        }

        throw error;
      }
    });
  };
}

export async function agentStep(
  page: Page,
  input: AgentStepInput,
): Promise<AgentStepResult> {
  return createAgentStep({ page, testInfo: test.info() })(input);
}
