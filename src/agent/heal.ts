import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, dirname, relative } from 'node:path';
import { test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { createModelClient, loadAgentConfig } from './model.js';
import { debugLog } from './debug.js';
import { repairSelectors, repairSelectorsFromRef } from './selector-chain.js';
import { parseJsonObject } from './verifier.js';
import type { ModelClient } from './types.js';

const HEAL_TIMEOUT_MS = 30_000;
const REF_PATTERN = /^(?:f\d+)?e\d+$/;

const HEAL_RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  jsonSchema: {
    name: 'heal_match',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ref: { type: ['string', 'null'] },
        role: { type: ['string', 'null'] },
        name: { type: ['string', 'null'] },
      },
      required: ['ref', 'role', 'name'],
    },
  },
};

const HEAL_SYSTEM_PROMPT = [
  'You match a failed Playwright locator to one control on the page.',
  'Use only the accessibility snapshot and the Playwright error.',
  'Identifiers in the locator pick among similar controls. .invoice-18 .pay-button means the pay control grouped with invoice 18, not view or download, and not another invoice.',
  'If the error is a strict mode violation, choose the one control the action should hit.',
  'Return {"ref":null} when the locator does not identify a single control.',
  'Respond with JSON only.',
  'Shape: {"ref":"e12","role":"button","name":"Pay invoice 18"} or {"ref":null}.',
].join(' ');

export interface AgentHealOptions {
  /** Extra headers sent on the heal model request. */
  headers?: Record<string, string>;
  /** Override model client for deterministic framework tests. */
  modelClient?: ModelClient;
  testInfo?: TestInfo;
  /** Budget for the heal model request. */
  timeout?: number;
}

export interface HealSuggestion {
  ref: string;
  role: string;
  name: string;
  suggestion: string;
  /** When set, the retry uses this selector instead of an aria ref. */
  retrySelector?: string;
  /** When set, the retry rebuilds page.locator().locator() steps. */
  retrySelectors?: string[];
  /** True only when `suggestion` matches exactly one element. */
  patchable: boolean;
  patchFrom?: string;
  patchTo?: string;
  patchOrigin?: { file: string; line: number };
  patches?: Array<{ from: string; to: string; origin?: { file: string; line: number } }>;
}

type LocatorStep = {
  selector: string;
  parent?: Locator;
  origin?: { file: string; line: number };
};

const locatorSteps = new WeakMap<Locator, LocatorStep>();

export function rememberLocatorStep(
  locator: Locator,
  step: { selector?: string; parent?: Locator; origin?: { file: string; line: number } },
): void {
  if (!step.selector) return;
  locatorSteps.set(locator, {
    selector: step.selector,
    parent: step.parent,
    origin: step.origin,
  });
}

function locatorStepChain(locator: Locator): LocatorStep[] | undefined {
  const steps: LocatorStep[] = [];
  const seen = new Set<Locator>();
  let current: Locator | undefined = locator;
  while (current) {
    if (seen.has(current)) return undefined;
    seen.add(current);
    const step = locatorSteps.get(current);
    if (!step) return undefined;
    steps.unshift(step);
    current = step.parent;
  }
  return steps.length >= 2 ? steps : undefined;
}

export function captureCallerFrame(): { file: string; line: number } | undefined {
  return callerFrame(new Error('locator origin'));
}

export async function agentHeal<T>(
  locator: Locator,
  action: (locator: Locator) => Promise<T> | T,
  options?: AgentHealOptions,
): Promise<T> {
  try {
    return await action(locator);
  } catch (error) {
    if (!isHealableLocatorMiss(error)) {
      throw error;
    }
    return healLocatorMiss(locator, error, action, options);
  }
}

export async function healLocatorMiss<T>(
  locator: Locator,
  error: unknown,
  action: (locator: Locator) => Promise<T> | T,
  options?: AgentHealOptions,
): Promise<T> {
  const testInfo = options?.testInfo ?? test.info();
  let suggestion: HealSuggestion | undefined;
  try {
    suggestion = await proposeHeal(locator, error, options);
  } catch (healError) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nLocator heal failed: ${healError instanceof Error ? healError.message : String(healError)}`,
      { cause: error instanceof Error ? error : undefined },
    );
  }

  if (!suggestion) {
    throw error;
  }

  const healed = healedLocator(locator.page(), suggestion);
  let result: T;
  try {
    result = await action(healed);
  } catch (retryError) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nHealed action failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
      { cause: retryError instanceof Error ? retryError : undefined },
    );
  }

  const from = locatorDescription(locator);
  const description = suggestion.patchable
    ? `${from} -> ${suggestion.suggestion}`
    : `${from} -> ref ${suggestion.ref} (no unique locator to patch)`;
  testInfo.annotations.push({
    type: 'agent-healed',
    description,
  });
  debugLog('annotation agent-healed', description);
  await testInfo.attach('agent-heal.json', {
    body: JSON.stringify(
      {
        from,
        suggestion: suggestion.patchable ? suggestion.suggestion : null,
        ref: suggestion.ref,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  if (suggestion.patchable) {
    const patches = suggestion.patches ?? [
      {
        from: suggestion.patchFrom ?? from,
        to: suggestion.patchTo ?? suggestion.suggestion,
        origin: suggestion.patchOrigin ?? locatorSteps.get(locator)?.origin,
      },
    ];
    for (const patch of patches) {
      try {
        await recordHealPatch({
          testInfo,
          error,
          from: patch.from,
          to: patch.to,
          origin: patch.origin,
        });
      } catch {
        // The action already succeeded. A patch write must not fail the test.
      }
    }
  }
  return result;
}

export function isHealableLocatorMiss(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message;
  if (/\bexpect\(/.test(message)) return false;
  if (/strict mode violation/i.test(message)) return true;
  if (/locator resolved to/i.test(message)) return false;
  return /Timeout \d+ms exceeded/.test(message);
}

async function proposeHeal(
  locator: Locator,
  error: unknown,
  options: AgentHealOptions | undefined,
): Promise<HealSuggestion | undefined> {
  const page = locator.page();
  const steps = locatorStepChain(locator);
  const originalSelector = selectorOf(locatorDescription(locator));
  const repaired = steps
    ? await repairSelectors(page, steps.map((step) => step.selector))
    : originalSelector
      ? await repairSelectors(page, originalSelector)
      : undefined;
  if (repaired && steps) {
    const broken = steps[repaired.index];
    const previous = quoteSelector(broken.selector);
    const next = quoteSelector(repaired.selectors[repaired.index]);
    debugLog('heal: repaired from the DOM', next);
    return {
      ref: 'chain',
      role: 'generic',
      name: repaired.selectors[repaired.index],
      suggestion: `locator(${next})`,
      retrySelectors: repaired.selectors,
      patchable: true,
      patchFrom: `locator(${previous})`,
      patchTo: `locator(${next})`,
      patchOrigin: broken.origin,
    };
  }
  if (repaired) {
    const selector = repaired.selectors.join(' ');
    debugLog('heal: repaired from the DOM', selector);
    return {
      ref: 'chain',
      role: 'generic',
      name: selector,
      suggestion: `locator(${quoteSelector(selector)})`,
      retrySelector: selector,
      patchable: true,
    };
  }
  debugLog('heal: asking the model');
  const snapshot = await page.ariaSnapshotJSON({ mode: 'ai' });
  const modelClient =
    options?.modelClient ??
    createModelClient({
      ...loadAgentConfig(),
      headers: options?.headers,
    });
  const timeout = options?.timeout ?? HEAL_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await modelClient.chat({
      messages: [
        { role: 'system', content: HEAL_SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify(
            {
              locator: locatorDescription(locator),
              error: plainError(error),
              url: page.url(),
              snapshot,
            },
            null,
            2,
          ),
        },
      ],
      toolChoice: 'none',
      responseFormat: HEAL_RESPONSE_FORMAT,
      signal: controller.signal,
    });

    if (!response.content) {
      throw new Error('Heal model returned empty content');
    }

    const suggestion = suggestionFromModel(
      parseJsonObject(response.content),
      snapshot,
    );
    if (!suggestion) return undefined;
    const steps = locatorStepChain(locator);
    if (steps) {
      const restyled = await repairSelectorsFromRef(
        page,
        steps.map((step) => step.selector),
        suggestion.ref,
      );
      if (restyled) {
        const patches = steps.flatMap((step, index) => {
          if (step.selector === restyled.selectors[index]) return [];
          const from = `locator(${quoteSelector(step.selector)})`;
          const to = `locator(${quoteSelector(restyled.selectors[index])})`;
          return [{ from, to, origin: step.origin }];
        });
        debugLog('heal: kept locator style from the chosen element', patches);
        return {
          ...suggestion,
          suggestion: patches.map((patch) => `${patch.from} -> ${patch.to}`).join('; '),
          retrySelectors: restyled.selectors,
          patchable: patches.length > 0,
          patches,
        };
      }
    }
    const text = await preferDomLocator(
      page,
      locatorDescription(locator),
      suggestion,
    );
    return {
      ...suggestion,
      suggestion: text,
      patchable: await replacementIsUnique(page, text, suggestion),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function suggestionFromModel(
  parsed: Record<string, unknown>,
  snapshot: unknown,
): HealSuggestion | undefined {
  const ref = parsed.ref;
  if (ref === null || ref === undefined) return undefined;
  if (typeof ref !== 'string' || !REF_PATTERN.test(ref)) return undefined;

  const node = findNodeByRef(snapshot, ref);
  if (!node?.role || !node.name) return undefined;

  return {
    ref,
    role: node.role,
    name: node.name,
    suggestion: `getByRole(${JSON.stringify(node.role)}, { name: ${JSON.stringify(node.name)} })`,
    patchable: false,
  };
}

function findNodeByRef(
  snapshot: unknown,
  ref: string,
): { role?: string; name?: string } | undefined {
  const matches = collectNodesByRef(snapshot, ref);
  if (matches.length !== 1) return undefined;
  return matches[0];
}

function collectNodesByRef(
  snapshot: unknown,
  ref: string,
): Array<{ role?: string; name?: string }> {
  if (Array.isArray(snapshot)) {
    return snapshot.flatMap((item) => collectNodesByRef(item, ref));
  }
  if (!snapshot || typeof snapshot !== 'object') return [];
  const record = snapshot as {
    role?: unknown;
    name?: unknown;
    ref?: unknown;
    children?: unknown;
  };
  const matches: Array<{ role?: string; name?: string }> = record.ref === ref
    ? [
        {
          role: typeof record.role === 'string' ? record.role : undefined,
          name: typeof record.name === 'string' ? record.name : undefined,
        },
      ]
    : [];
  return [...matches, ...collectNodesByRef(record.children, ref)];
}

function locatorDescription(locator: Locator): string {
  return typeof locator.toString === 'function' ? locator.toString() : 'locator';
}

async function preferDomLocator(
  page: Page,
  original: string,
  suggestion: HealSuggestion,
): Promise<string> {
  const selector = selectorOf(original);
  if (!selector) return suggestion.suggestion;

  const dom = await page
    .locator(`aria-ref=${suggestion.ref}`)
    .evaluate((el) => {
      if (!(el instanceof Element)) return undefined;
      return {
        id: el.id,
        classes: (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean),
      };
    })
    .catch(() => undefined);
  if (!dom) return suggestion.suggestion;

  if (selector.startsWith('#') && isCssToken(dom.id)) {
    const idSelector = `#${cssEscape(dom.id)}`;
    if (await isUnique(page, idSelector)) return `locator('${idSelector}')`;
  }

  if (selector.startsWith('.') || /^[a-z][\w-]*\./i.test(selector)) {
    const ranked = [...dom.classes].sort(
      (a, b) => similarity(selector, b) - similarity(selector, a),
    );
    for (const className of ranked) {
      if (!isCssToken(className) || similarity(selector, className) <= 0) {
        continue;
      }
      const classSelector = `.${cssEscape(className)}`;
      if (await isUnique(page, classSelector)) {
        return `locator('${classSelector}')`;
      }
    }
  }

  if (isCssToken(dom.id)) {
    const idSelector = `#${cssEscape(dom.id)}`;
    if (await isUnique(page, idSelector)) return `locator('${idSelector}')`;
  }

  return suggestion.suggestion;
}

function selectorOf(description: string): string | undefined {
  if (/\.(?:locator|getBy[A-Z]\w*)\(/.test(description.slice('locator('.length))) {
    return undefined;
  }
  const match = description.match(/^locator\((['"])(.*)\1\)$/);
  return match?.[2];
}

function plainError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\u001b\[[0-9;]*m/g, '');
}

function isCssToken(value: string): boolean {
  return value.length > 0 && !/['"\\\s]/.test(value);
}

function cssEscape(value: string): string {
  return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

function similarity(selector: string, className: string): number {
  const left = new Set(selector.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const right = new Set(className.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  let score = 0;
  for (const token of left) {
    if (right.has(token)) score += 1;
  }
  return score;
}

async function isUnique(page: Page, selector: string): Promise<boolean> {
  try {
    return (await page.locator(selector).count()) === 1;
  } catch {
    return false;
  }
}

async function replacementIsUnique(
  page: Page,
  suggestion: string,
  node: { role: string; name: string },
): Promise<boolean> {
  const selector = selectorOf(suggestion);
  if (selector) return isUnique(page, selector);
  try {
    const count = await page
      .getByRole(node.role as Parameters<Page['getByRole']>[0], {
        name: node.name,
        exact: true,
      })
      .count();
    return count === 1;
  } catch {
    return false;
  }
}

function healedLocator(page: Page, suggestion: HealSuggestion): Locator {
  const selectors = suggestion.retrySelectors;
  if (selectors?.length) {
    let locator = page.locator(selectors[0]);
    for (const selector of selectors.slice(1)) {
      locator = locator.locator(selector);
    }
    return locator;
  }
  if (suggestion.retrySelector) return page.locator(suggestion.retrySelector);
  return page.locator(`aria-ref=${suggestion.ref}`);
}

function quoteSelector(selector: string): string {
  if (!selector.includes("'")) return `'${selector}'`;
  return `"${selector.replace(/"/g, '\\"')}"`;
}

async function recordHealPatch(input: {
  testInfo: TestInfo;
  error: unknown;
  from: string;
  to: string;
  origin?: { file: string; line: number };
}): Promise<void> {
  const frame = input.origin ?? callerFrame(input.error);
  if (!frame) return;
  let source: string;
  try {
    source = readFileSync(frame.file, 'utf8');
  } catch {
    return;
  }

  const lines = source.replace(/\n$/, '').split('\n');
  const lineIndex = findLineIndex(lines, frame.line, input.from);
  if (lineIndex === undefined) return;
  const updated = replaceLocator(lines[lineIndex], input.from, input.to);
  if (!updated || updated === lines[lineIndex]) return;

  const rel = relative(process.cwd(), frame.file);
  if (rel.startsWith('..') || isAbsolute(rel)) return;
  const patchFile = rel.split('\\').join('/');
  const context = 3;
  const start = Math.max(0, lineIndex - context);
  const before = lines.slice(start, lineIndex);
  const after = lines.slice(lineIndex + 1, lineIndex + 1 + context);
  const hunk = [
    `--- a/${patchFile}`,
    `+++ b/${patchFile}`,
    `@@ -${start + 1},${before.length + 1 + after.length} +${start + 1},${before.length + 1 + after.length} @@`,
    ...before.map((line) => ` ${line}`),
    `-${lines[lineIndex]}`,
    `+${updated}`,
    ...after.map((line) => ` ${line}`),
    '',
  ].join('\n');
  const patchPath = input.testInfo.outputPath('agent-heal.patch');
  mkdirSync(dirname(patchPath), { recursive: true });
  const existing = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '';
  if (existing.includes(hunk)) return;
  writeFileSync(patchPath, existing ? `${existing.replace(/\n?$/, '\n')}${hunk}` : hunk);
  await input.testInfo.attach('agent-heal.patch', {
    body: hunk,
    contentType: 'text/x-diff',
  });
}

function callerFrame(
  error: unknown,
): { file: string; line: number } | undefined {
  const stack = error instanceof Error ? error.stack ?? '' : '';
  for (const line of stack.split('\n')) {
    const match = line.match(/at (?:async )?(?:.+ \()?(.+):(\d+):\d+\)?$/);
    if (!match) continue;
    const file = match[1].replace(/^file:\/\//, '');
    if (file.includes('node_modules') || file.includes('node:')) continue;
    if (/[/\\]heal(?:-page)?\.(?:ts|[cm]?js)$/.test(file)) continue;
    if (file.includes('agent-heal-fixture.')) continue;
    if (!file.endsWith('.ts') && !file.endsWith('.js') && !file.endsWith('.mjs')) {
      continue;
    }
    return { file, line: Number(match[2]) };
  }
  return undefined;
}

function findLineIndex(
  lines: string[],
  reportedLine: number,
  from: string,
): number | undefined {
  const reported = lines[reportedLine - 1];
  if (reported && lineHasLocator(reported, from)) {
    return reportedLine - 1;
  }
  const matches = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => lineHasLocator(line, from));
  return matches.length === 1 ? matches[0].index : undefined;
}

function lineHasLocator(line: string, from: string): boolean {
  if (line.includes(from)) return true;
  const selector = selectorOf(from);
  if (!selector) return false;
  return (
    line.includes(`locator('${selector}')`) ||
    line.includes(`locator("${selector}")`)
  );
}

function replaceLocator(line: string, from: string, to: string): string {
  const direct = replaceOnce(line, from, to);
  if (direct) return direct;
  const selector = selectorOf(from);
  if (!selector) return line;
  return (
    replaceOnce(line, `locator('${selector}')`, to) ??
    replaceOnce(line, `locator("${selector}")`, to) ??
    line
  );
}

function replaceOnce(line: string, from: string, to: string): string | undefined {
  if (!from || occurrences(line, from) !== 1) return undefined;
  return line.replace(from, to);
}

function occurrences(line: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (index <= line.length) {
    const found = line.indexOf(needle, index);
    if (found === -1) return count;
    count += 1;
    index = found + needle.length;
  }
  return count;
}
