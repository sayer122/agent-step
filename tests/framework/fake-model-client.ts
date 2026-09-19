import type { ChatParams, ChatResponse, ModelClient, TokenUsage } from '../../src/agent/types.js';

const EMPTY_USAGE: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

export type FakeResponse =
  | {
      content?: string | null;
      toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    }
  | Error;

export class FakeModelClient implements ModelClient {
  private index = 0;

  constructor(private readonly script: FakeResponse[]) {}

  async chat(params: ChatParams): Promise<ChatResponse> {
    if (params.signal?.aborted) {
      throw new Error('Aborted');
    }

    await new Promise<void>((resolve, reject) => {
      if (!params.signal) {
        resolve();
        return;
      }
      if (params.signal.aborted) {
        reject(new Error('Aborted'));
        return;
      }
      params.signal.addEventListener(
        'abort',
        () => reject(new Error('Aborted')),
        { once: true },
      );
      resolve();
    });

    if (this.index >= this.script.length) {
      throw new Error('Fake model script exhausted');
    }

    const next = this.script[this.index++];
    if (next instanceof Error) {
      throw next;
    }

    const isVerification = params.toolChoice === 'none';
    if (isVerification && !next.content) {
      return {
        content: JSON.stringify({
          criteria: [],
          inconclusive: true,
        }),
        toolCalls: [],
        usage: EMPTY_USAGE,
      };
    }

    return {
      content: next.content ?? null,
      toolCalls: (next.toolCalls ?? []).map((call, index) => ({
        id: call.id ?? `call_${this.index}_${index}`,
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      })),
      usage: EMPTY_USAGE,
    };
  }
}

export class HangingModelClient implements ModelClient {
  async chat(params: ChatParams): Promise<ChatResponse> {
    return new Promise((_resolve, reject) => {
      if (params.signal?.aborted) {
        reject(new Error('Aborted'));
        return;
      }
      params.signal?.addEventListener(
        'abort',
        () => reject(new Error('Aborted')),
        { once: true },
      );
    });
  }
}

export function verificationResponse(
  criteria: Array<{ criterion: string; passed: boolean; evidence: string }>,
  inconclusive = false,
): FakeResponse {
  return {
    content: JSON.stringify({ criteria, inconclusive }),
  };
}
