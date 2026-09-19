import { test, expect } from '@playwright/test';
import { Verifier } from '../../src/agent/verifier.js';
import { FakeModelClient } from './fake-model-client.js';

const expectCriteria = [
  'The basket badge shows 1',
  'The basket contains the red medium shirt',
];

test.describe('Verifier JSON normalization', () => {
  test('accepts pass/reason aliases', async () => {
    const modelClient = new FakeModelClient([
      {
        content: JSON.stringify({
          inconclusive: false,
          criteria: [
            {
              criterion: expectCriteria[0],
              pass: true,
              reason: 'Badge text is 1',
            },
            {
              criterion: expectCriteria[1],
              status: 'pass',
              notes: 'List includes Red medium shirt',
            },
          ],
        }),
      },
    ]);

    const result = await new Verifier({
      modelClient,
      expect: expectCriteria,
      snapshot: { badge: '1' },
      url: 'about:blank',
      signal: new AbortController().signal,
    }).run();

    expect(result.verification.passed).toBe(true);
    expect(result.verification.criteria[0]?.evidence).toBe('Badge text is 1');
  });

  test('repairs omitted passed/evidence instead of throwing', async () => {
    const modelClient = new FakeModelClient([
      {
        content: JSON.stringify({
          criteria: expectCriteria.map((criterion) => ({ criterion })),
        }),
      },
      {
        content: JSON.stringify({
          inconclusive: false,
          criteria: [
            {
              criterion: expectCriteria[0],
              passed: true,
              evidence: 'Badge is 1',
            },
            {
              criterion: expectCriteria[1],
              passed: true,
              evidence: 'Red medium shirt is listed',
            },
          ],
        }),
      },
    ]);

    const result = await new Verifier({
      modelClient,
      expect: expectCriteria,
      snapshot: { badge: '1' },
      url: 'about:blank',
      signal: new AbortController().signal,
    }).run();

    expect(result.verification.passed).toBe(true);
  });

  test('fails closed when repaired JSON still omits verdicts', async () => {
    const modelClient = new FakeModelClient([
      {
        content: JSON.stringify({
          criteria: [{ criterion: expectCriteria[0] }],
        }),
      },
      {
        content: JSON.stringify({
          criteria: [{ criterion: expectCriteria[0] }],
        }),
      },
    ]);

    const result = await new Verifier({
      modelClient,
      expect: expectCriteria,
      snapshot: {},
      url: 'about:blank',
      signal: new AbortController().signal,
    }).run();

    expect(result.verification.passed).toBe(false);
    expect(result.verification.inconclusive).toBe(true);
  });
});
