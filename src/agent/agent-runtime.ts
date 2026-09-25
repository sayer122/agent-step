import { ActionExecutor } from './action-executor.js';
import { createModelClient, loadAgentConfig } from './model.js';
import { Verifier } from './verifier.js';
import type {
  AgentRuntimeOptions,
  AgentStepInput,
  AgentStepResult,
  TokenUsage,
} from './types.js';

const DEFAULT_MAX_TURNS = 8;
const DEFAULT_TIMEOUT_MS = 60_000;

export class AgentRuntime {
  constructor(private readonly options: AgentRuntimeOptions) {}

  async runStep(input: AgentStepInput): Promise<AgentStepResult> {
    const maxTurns = this.options.maxTurns ?? DEFAULT_MAX_TURNS;
    const defaultTimeout = this.options.defaultTimeout ?? DEFAULT_TIMEOUT_MS;
    const timeout = input.timeout ?? defaultTimeout;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const modelClient =
        this.options.modelClient ??
        createModelClient({
          ...loadAgentConfig(),
          headers: this.options.headers,
        });

      const allowedOrigins =
        this.options.allowedOrigins ??
        deriveAllowedOrigins(this.options.page.url());

      const { action, expect } = normalizeStepInput(input);
      const secrets = input.secrets ?? {};
      const ctx = {
        page: this.options.page,
        allowedOrigins,
        secrets,
      };

      const actionResult = action
        ? await new ActionExecutor({
            modelClient,
            ctx,
            action,
            maxTurns,
            signal: controller.signal,
          }).run()
        : {
            transcript: [],
            tokenUsage: emptyUsage(),
            doneSummary: '',
          };

      const snapshotResult = await this.options.page.ariaSnapshotJSON({
        mode: 'ai',
      });

      const verificationResult = await new Verifier({
        modelClient,
        expect,
        snapshot: snapshotResult,
        url: this.options.page.url(),
        signal: controller.signal,
      }).run();

      const tokenUsage = mergeUsage(
        actionResult.tokenUsage,
        verificationResult.tokenUsage,
      );

      const result: AgentStepResult = {
        action,
        expect,
        actionTranscript: actionResult.transcript,
        verification: verificationResult.verification,
        tokenUsage,
        rawVerifierContent: verificationResult.rawContent,
      };

      if (!result.verification.passed) {
        const message = formatVerificationFailure(result);
        if (input.soft) {
          this.options.testInfo.annotations.push({
            type: 'agent-soft-fail',
            description: message,
          });
          return result;
        }
        throw new AgentStepError(message, result);
      }

      return result;
    } catch (error) {
      if (error instanceof AgentStepError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new Error(`Agent step timed out after ${timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export class AgentStepError extends Error {
  constructor(
    message: string,
    readonly result?: AgentStepResult,
  ) {
    super(message);
    this.name = 'AgentStepError';
  }
}

function formatVerificationFailure(result: AgentStepResult): string {
  const failed = result.verification.criteria
    .filter((item) => !item.passed)
    .map((item) => `- ${item.criterion}: ${item.evidence}`)
    .join('\n');
  const prefix = result.verification.inconclusive
    ? 'Agent verification inconclusive'
    : 'Agent verification failed';
  return `${prefix}:\n${failed}`;
}

function normalizeStepInput(input: AgentStepInput): {
  action?: string;
  expect: string[];
} {
  const action = input.action?.trim() || undefined;
  if (!Array.isArray(input.expect) || input.expect.length === 0) {
    throw new Error('agentStep requires at least one expect criterion');
  }

  const expect = input.expect.map((item) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error('agentStep expect criteria must be non-empty strings');
    }
    return item.trim();
  });

  return { action, expect };
}

function emptyUsage(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

function deriveAllowedOrigins(currentUrl: string): string[] {
  try {
    const origin = new URL(currentUrl).origin;
    return origin === 'null' ? ['null'] : [origin];
  } catch {
    return ['null'];
  }
}

function mergeUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}
