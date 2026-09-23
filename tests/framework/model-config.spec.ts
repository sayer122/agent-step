import { test, expect } from '@playwright/test';
import type { ClientOptions } from 'openai';
import {
  createModelClient,
  modelRequestHeaders,
  normalizeOpenAICompatibleBaseURL,
  parseOpenAIChatResponse,
} from '../../src/agent/model.js';

test.describe('OpenAI-compatible base URL', () => {
  test('keeps provider roots unchanged', () => {
    expect(
      normalizeOpenAICompatibleBaseURL('https://openrouter.ai/api/v1'),
    ).toBe('https://openrouter.ai/api/v1');
    expect(
      normalizeOpenAICompatibleBaseURL('https://api.openai.com/v1/'),
    ).toBe('https://api.openai.com/v1');
  });

  test('strips a trailing chat completions path', () => {
    expect(
      normalizeOpenAICompatibleBaseURL(
        'https://openrouter.ai/api/v1/chat/completions',
      ),
    ).toBe('https://openrouter.ai/api/v1');
  });
});

test.describe('OpenAI-compatible chat responses', () => {
  test('parses a normal tool-calling completion', () => {
    const parsed = parseOpenAIChatResponse(
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  function: {
                    name: 'browser_snapshot',
                    arguments: '{}',
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      },
      'https://openrouter.ai/api/v1',
      'openai/gpt-4o-mini',
    );

    expect(parsed.toolCalls).toEqual([
      { id: 'call_1', name: 'browser_snapshot', arguments: '{}' },
    ]);
    expect(parsed.usage.totalTokens).toBe(3);
  });

  test('fails clearly when choices are missing', () => {
    expect(() =>
      parseOpenAIChatResponse(
        { id: 'empty' },
        'https://openrouter.ai/api/v1',
        'openai/gpt-5.6-luna',
      ),
    ).toThrow(/no chat choices/);
  });

  test('surfaces an embedded provider error object', () => {
    expect(() =>
      parseOpenAIChatResponse(
        {
          error: {
            message: 'No endpoints found for this model',
            code: 404,
          },
        },
        'https://openrouter.ai/api/v1',
        'openai/gpt-5.6-luna',
      ),
    ).toThrow(/No endpoints found for this model/);
  });
});

test.describe('LLM request headers', () => {
  test('keeps built-in attribution headers', () => {
    withAttributionEnv(undefined, undefined, () => {
      expect(modelRequestHeaders()).toEqual({
        'HTTP-Referer': 'https://github.com/Sayer122/agent-step',
        'X-OpenRouter-Title': 'agent-step',
      });
    });
  });

  test('merges custom headers and lets them replace built-in names', () => {
    withAttributionEnv(undefined, undefined, () => {
      expect(
        modelRequestHeaders({
          'X-Title': 'checkout-tests',
          'HTTP-Referer': 'https://example.test',
        }),
      ).toEqual({
        'HTTP-Referer': 'https://example.test',
        'X-OpenRouter-Title': 'agent-step',
        'X-Title': 'checkout-tests',
      });
    });
  });

  test('rejects header values that are not strings', () => {
    expect(() =>
      modelRequestHeaders({ 'X-Title': 1 } as unknown as Record<string, string>),
    ).toThrow(/X-Title/);
  });

  test('sends custom headers on the chat request', async () => {
    const seen: Array<Headers | undefined> = [];
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as ClientOptions['fetch'];

    const client = createModelClient(
      {
        baseURL: 'https://example.test/v1',
        apiKey: 'test-key',
        model: 'test-model',
        headers: { 'X-Title': 'checkout-tests' },
      },
      { fetch: fetchImpl },
    );
    await client.chat({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(seen[0]?.get('x-title')).toBe('checkout-tests');
    expect(seen[0]?.get('authorization')).toBe('Bearer test-key');
  });
});

function withAttributionEnv(
  siteUrl: string | undefined,
  siteName: string | undefined,
  run: () => void,
): void {
  const previousUrl = process.env.AGENT_LLM_SITE_URL;
  const previousName = process.env.AGENT_LLM_SITE_NAME;
  setEnv('AGENT_LLM_SITE_URL', siteUrl);
  setEnv('AGENT_LLM_SITE_NAME', siteName);
  try {
    run();
  } finally {
    setEnv('AGENT_LLM_SITE_URL', previousUrl);
    setEnv('AGENT_LLM_SITE_NAME', previousName);
  }
}

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
