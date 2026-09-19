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
      'HTTP-Referer': process.env.AGENT_LLM_SITE_URL ?? 'https://github.com/Sayer122/agent-step',
      'X-OpenRouter-Title':
        process.env.AGENT_LLM_SITE_NAME ?? 'agent-step',
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

      return parseOpenAIChatResponse(response, baseURL, config.model);
    },
  };
}

export function parseOpenAIChatResponse(
  response: unknown,
  baseURL: string,
  model: string,
): ChatResponse {
  const record = asRecord(response);
  if (record?.error) {
    throw wrapModelRequestError(
      embeddedProviderError(record.error),
      baseURL,
      model,
    );
  }

  const choices = record?.choices;
  const choice = Array.isArray(choices) ? asRecord(choices[0]) : undefined;
  const message = asRecord(choice?.message);

  if (!choice || !message) {
    throw wrapModelRequestError(
      new Error(
        `LLM returned no chat choices. body=${truncateJson(response)}`,
      ),
      baseURL,
      model,
    );
  }

  const usageRecord = asRecord(record?.usage);
  const usage: TokenUsage = {
    promptTokens: numberOrZero(usageRecord?.prompt_tokens),
    completionTokens: numberOrZero(usageRecord?.completion_tokens),
    totalTokens: numberOrZero(usageRecord?.total_tokens),
  };

  return {
    content: typeof message.content === 'string' ? message.content : null,
    toolCalls: readToolCalls(message.tool_calls),
    usage,
  };
}

function wrapModelRequestError(
  error: unknown,
  baseURL: string,
  model: string,
): Error {
  const record = asRecord(error);
  const status = numberOrUndefined(record?.status);
  const message = error instanceof Error ? error.message : String(error);
  const hint =
    status === 404
      ? ` Check AGENT_LLM_BASE_URL. The OpenAI SDK posts to ${baseURL}/chat/completions; for OpenRouter use https://openrouter.ai/api/v1, not .../chat/completions.`
      : message.includes('no chat choices')
        ? ' The provider accepted the request but returned no completion. Check AGENT_LLM_MODEL supports tool calling on this endpoint.'
        : '';

  return new Error(
    `LLM request failed (${status ?? 'unknown'}): ${message}. model=${model} baseURL=${baseURL}.${hint}`,
    { cause: error instanceof Error ? error : undefined },
  );
}

function readToolCalls(value: unknown): ChatResponse['toolCalls'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const call = asRecord(item);
    const fn = asRecord(call?.function);
    const name = typeof fn?.name === 'string' ? fn.name : undefined;
    if (!name) return [];
    return [
      {
        id: typeof call?.id === 'string' ? call.id : `call_${index}`,
        name,
        arguments: typeof fn?.arguments === 'string' ? fn.arguments : '{}',
      },
    ];
  });
}

function embeddedProviderError(error: unknown): Error {
  const record = asRecord(error);
  const message =
    typeof record?.message === 'string'
      ? record.message
      : truncateJson(error);
  const code = record?.code;
  return new Error(
    code === undefined ? message : `${message} (code ${String(code)})`,
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function truncateJson(value: unknown, max = 800): string {
  try {
    const text = JSON.stringify(value) ?? String(value);
    return text.length > max ? `${text.slice(0, max)}…` : text;
  } catch {
    return String(value);
  }
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
