import OpenAI from 'openai';
import type {
  AgentConfig,
  ChatParams,
  ChatResponse,
  ModelClient,
  TokenUsage,
} from './types.js';

export function normalizeOpenAICompatibleBaseURL(baseURL: string): string {
  let normalized = baseURL.trim().replace(/\/+$/, '');
  normalized = normalized.replace(/\/chat\/completions$/i, '');
  normalized = normalized.replace(/\/+$/, '');
  return normalized;
}

export function loadAgentConfig(): AgentConfig {
  const baseURL = process.env.AGENT_LLM_BASE_URL;
  const apiKey = process.env.AGENT_LLM_API_KEY;
  const model = process.env.AGENT_LLM_MODEL;

  if (!baseURL || !apiKey || !model) {
    throw new Error(
      'Missing required environment variables: AGENT_LLM_BASE_URL, AGENT_LLM_API_KEY, AGENT_LLM_MODEL',
    );
  }

  return {
    baseURL: normalizeOpenAICompatibleBaseURL(baseURL),
    apiKey,
    model,
  };
}

export function createModelClient(config: AgentConfig): ModelClient {
  const baseURL = normalizeOpenAICompatibleBaseURL(config.baseURL);
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL,
    defaultHeaders: {
      'HTTP-Referer': process.env.AGENT_LLM_SITE_URL ?? 'https://github.com/Sayer122/playwright-agent-step',
      'X-OpenRouter-Title':
        process.env.AGENT_LLM_SITE_NAME ?? 'playwright-agent-step',
    },
  });

  return {
    async chat(params: ChatParams): Promise<ChatResponse> {
      let response;
      try {
        response = await client.chat.completions.create(
          {
            model: config.model,
            messages: params.messages.map(toOpenAIMessage),
            tools: params.tools?.map((tool) => ({
              type: 'function' as const,
              function: tool.function,
            })),
            tool_choice: params.toolChoice ?? 'auto',
            response_format: params.responseFormat,
          },
          { signal: params.signal },
        );
      } catch (error) {
        throw wrapModelRequestError(error, baseURL, config.model);
      }

      const choice = response.choices[0];
      const usage: TokenUsage = {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      };

      return {
        content: choice.message.content,
        toolCalls: (choice.message.tool_calls ?? []).map((call) => ({
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        })),
        usage,
      };
    },
  };
}

function wrapModelRequestError(
  error: unknown,
  baseURL: string,
  model: string,
): Error {
  const status =
    error && typeof error === 'object' && 'status' in error
      ? Number((error as { status?: number }).status)
      : undefined;
  const message = error instanceof Error ? error.message : String(error);
  const hint =
    status === 404
      ? ` Check AGENT_LLM_BASE_URL. The OpenAI SDK posts to ${baseURL}/chat/completions; for OpenRouter use https://openrouter.ai/api/v1, not .../chat/completions.`
      : '';

  return new Error(
    `LLM request failed (${status ?? 'unknown'}): ${message}. model=${model} baseURL=${baseURL}.${hint}`,
    { cause: error },
  );
}

function toOpenAIMessage(
  message: ChatParams['messages'][number],
): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId!,
      content: message.content ?? '',
    };
  }

  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls?.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: {
          name: call.name,
          arguments: call.arguments,
        },
      })),
    };
  }

  return {
    role: message.role,
    content: message.content ?? '',
  };
}
