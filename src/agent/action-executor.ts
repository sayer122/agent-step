import {
  BrowserTools,
  BROWSER_TOOL_DEFINITIONS,
  type BrowserToolContext,
} from './browser-tools.js';
import { redactObject } from './redaction.js';
import type {
  ChatMessage,
  ModelClient,
  TokenUsage,
  TranscriptEntry,
} from './types.js';

export interface ActionExecutorOptions {
  modelClient: ModelClient;
  ctx: BrowserToolContext;
  action: string;
  maxTurns: number;
  signal: AbortSignal;
}

export interface ActionExecutorResult {
  transcript: TranscriptEntry[];
  tokenUsage: TokenUsage;
  doneSummary: string;
}

export class ActionExecutor {
  constructor(private readonly options: ActionExecutorOptions) {}

  async run(): Promise<ActionExecutorResult> {
    const tools = new BrowserTools(this.options.ctx);
    const transcript: TranscriptEntry[] = [];
    const tokenUsage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: [
          'You are a browser automation agent operating inside a Playwright test.',
          'Use only the provided tools. Always start with browser_snapshot.',
          'Interact using snapshot refs via target (or ref).',
          'Use %SECRET_NAME% placeholders for sensitive browser_type values.',
          'Call done when the requested action is complete.',
          'Do not navigate away from the current origin unless the action requires it.',
        ].join(' '),
      },
      {
        role: 'user',
        content: `Perform this action:\n${this.options.action}`,
      },
    ];

    for (let turn = 1; turn <= this.options.maxTurns; turn++) {
      if (this.options.signal.aborted) {
        throw new Error('Agent step timed out during action execution');
      }

      const response = await this.options.modelClient.chat({
        messages,
        tools: BROWSER_TOOL_DEFINITIONS,
        toolChoice: 'required',
        signal: this.options.signal,
      });

      accumulateUsage(tokenUsage, response.usage);

      if (response.content) {
        transcript.push({
          turn,
          type: 'message',
          content: response.content,
        });
      }

      if (response.toolCalls.length === 0) {
        throw new Error('Model returned no tool calls during action execution');
      }

      messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      });

      for (const toolCall of response.toolCalls) {
        let parsedArgs: Record<string, unknown>;
        try {
          parsedArgs = JSON.parse(toolCall.arguments) as Record<string, unknown>;
        } catch {
          throw new Error(`Malformed tool arguments for ${toolCall.name}`);
        }

        transcript.push({
          turn,
          type: 'tool_call',
          name: toolCall.name,
          input: redactObject(parsedArgs, this.options.ctx.secrets),
        });

        let output: unknown;
        try {
          output = await tools.execute(toolCall.name, parsedArgs);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.startsWith('Origin not allowed')) {
            throw error;
          }
          output = { error: message };
        }

        transcript.push({
          turn,
          type: 'tool_result',
          name: toolCall.name,
          output: redactObject(output, this.options.ctx.secrets),
        });

        messages.push({
          role: 'tool',
          toolCallId: toolCall.id,
          content: JSON.stringify(output),
        });

        if (toolCall.name === 'done' && tools.isDone()) {
          return {
            transcript,
            tokenUsage,
            doneSummary: tools.getDoneSummary() ?? 'Action completed',
          };
        }
      }
    }

    throw new Error(`Action executor exhausted maximum turns (${this.options.maxTurns})`);
  }
}

function accumulateUsage(target: TokenUsage, delta: TokenUsage): void {
  target.promptTokens += delta.promptTokens;
  target.completionTokens += delta.completionTokens;
  target.totalTokens += delta.totalTokens;
}
