import type {
  CriterionVerdict,
  ModelClient,
  TokenUsage,
  VerificationResult,
} from './types.js';

export interface VerifierOptions {
  modelClient: ModelClient;
  expect: string[];
  snapshot: unknown;
  url: string;
  signal: AbortSignal;
}

export interface VerifierResult {
  verification: VerificationResult;
  tokenUsage: TokenUsage;
  rawContent: string;
}

const VERIFIER_SYSTEM_PROMPT = [
  'You are a read-only test verifier.',
  'Given an accessibility snapshot and pass criteria, decide whether each criterion is satisfied.',
  'Use only evidence visible in the snapshot or URL.',
  'If evidence is insufficient, set passed=false for that criterion and inconclusive=true.',
  'Respond with a JSON object only. Do not wrap it in markdown.',
  'Required shape:',
  '{"inconclusive":false,"criteria":[{"criterion":"<exact expected string>","passed":true,"evidence":"<short visible evidence>"}]}',
  'Every criteria item MUST include boolean passed and string evidence.',
  'Include one criteria object for every expected string, using the expected text as criterion.',
].join(' ');

export class Verifier {
  constructor(private readonly options: VerifierOptions) {}

  async run(): Promise<VerifierResult> {
    const first = await this.requestVerdict(undefined);
    const firstVerification = normalizeVerification(
      first.parsed,
      this.options.expect,
    );

    if (!needsRepair(firstVerification)) {
      return {
        verification: firstVerification,
        tokenUsage: first.usage,
        rawContent: first.content,
      };
    }

    const repaired = await this.requestVerdict(first.content);
    const repairedVerification = normalizeVerification(
      repaired.parsed,
      this.options.expect,
    );
    const tokenUsage = {
      promptTokens: first.usage.promptTokens + repaired.usage.promptTokens,
      completionTokens:
        first.usage.completionTokens + repaired.usage.completionTokens,
      totalTokens: first.usage.totalTokens + repaired.usage.totalTokens,
    };

    return {
      verification: repairedVerification,
      tokenUsage,
      rawContent: repaired.content,
    };
  }

  private async requestVerdict(
    previousContent: string | undefined,
  ): Promise<{
    content: string;
    parsed: Record<string, unknown>;
    usage: TokenUsage;
  }> {
    const response = await this.options.modelClient.chat({
      messages: [
        {
          role: 'system',
          content: VERIFIER_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: JSON.stringify(
            {
              url: this.options.url,
              snapshot: this.options.snapshot,
              expect: this.options.expect,
            },
            null,
            2,
          ),
        },
        ...(previousContent
          ? [
              {
                role: 'assistant' as const,
                content: previousContent,
              },
              {
                role: 'user' as const,
                content:
                  'That JSON omitted required fields. Reply with JSON only in this exact shape: {"inconclusive":false,"criteria":[{"criterion":"<exact expected string>","passed":true,"evidence":"<short visible evidence>"}]}. Include every expected criterion, with boolean passed and string evidence on each item.',
              },
            ]
          : []),
      ],
      toolChoice: 'none',
      responseFormat: { type: 'json_object' },
      signal: this.options.signal,
    });

    if (!response.content) {
      throw new Error('Verifier returned empty content');
    }

    return {
      content: response.content,
      parsed: parseJsonObject(response.content),
      usage: response.usage,
    };
  }
}

export function parseJsonObject(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Verifier JSON was not an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`Verifier returned malformed JSON: ${truncate(content)}`);
  }
}

export function normalizeVerification(
  parsed: Record<string, unknown>,
  expected: string[],
): VerificationResult {
  const rawCriteria = Array.isArray(parsed.criteria)
    ? parsed.criteria
    : Array.isArray(parsed.results)
      ? parsed.results
      : [];

  const normalized = rawCriteria.map((item, index) =>
    normalizeCriterion(item, expected[index]),
  );

  const criteria = expected.map((criterion, index) => {
    const exact = normalized.find((item) => item.criterion === criterion);
    if (exact) return { ...exact, criterion };

    const loose = normalized.find(
      (item) => item.criterion.trim().toLowerCase() === criterion.trim().toLowerCase(),
    );
    if (loose) return { ...loose, criterion };

    if (normalized.length === expected.length) {
      return { ...normalized[index], criterion };
    }

    return {
      criterion,
      passed: false,
      evidence: 'Verifier did not return a verdict for this criterion',
    };
  });

  const omittedVerdict = criteria.some((item) =>
    item.evidence.startsWith('Verifier omitted') ||
    item.evidence.startsWith('Verifier did not return') ||
    item.evidence.startsWith('Verifier returned a non-object'),
  );
  const inconclusive =
    coerceBoolean(parsed.inconclusive) === true || omittedVerdict;

  return {
    passed: !inconclusive && criteria.every((item) => item.passed),
    criteria,
    inconclusive,
  };
}

function needsRepair(verification: VerificationResult): boolean {
  return verification.criteria.some(
    (item) =>
      item.evidence.startsWith('Verifier omitted') ||
      item.evidence.startsWith('Verifier did not return') ||
      item.evidence.startsWith('Verifier returned a non-object'),
  );
}

function normalizeCriterion(
  item: unknown,
  fallbackCriterion?: string,
): CriterionVerdict {
  if (typeof item === 'string') {
    return {
      criterion: item,
      passed: false,
      evidence: 'Verifier omitted boolean passed and string evidence',
    };
  }

  if (!item || typeof item !== 'object') {
    return {
      criterion: fallbackCriterion ?? 'unknown',
      passed: false,
      evidence: 'Verifier returned a non-object criterion',
    };
  }

  const record = item as Record<string, unknown>;
  const criterion =
    readString(record.criterion) ??
    readString(record.expected) ??
    readString(record.text) ??
    fallbackCriterion ??
    'unknown';

  const passed = coerceBoolean(
    record.passed ??
      record.pass ??
      record.ok ??
      record.met ??
      record.satisfied ??
      record.success ??
      record.status,
  );

  const evidence =
    readString(record.evidence) ??
    readString(record.reason) ??
    readString(record.explanation) ??
    readString(record.details) ??
    readString(record.notes);

  if (passed === undefined) {
    return {
      criterion,
      passed: false,
      evidence: evidence
        ? `Verifier omitted boolean passed. ${evidence}`
        : 'Verifier omitted boolean passed and string evidence',
    };
  }

  return {
    criterion,
    passed,
    evidence: evidence ?? 'Verifier omitted evidence',
  };
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'pass', 'passed', 'yes', 'ok', 'success'].includes(normalized)) {
      return true;
    }
    if (['false', 'fail', 'failed', 'no', 'not_passed'].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function truncate(value: string, max = 500): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
