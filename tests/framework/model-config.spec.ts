import { test, expect } from '@playwright/test';
import {
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
