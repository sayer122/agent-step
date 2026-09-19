import { test, expect } from '@playwright/test';
import { normalizeOpenAICompatibleBaseURL } from '../../src/agent/model.js';

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
