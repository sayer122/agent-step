import type { Locator, Page } from '@playwright/test';

type Part = { text: string };

const SIMPLE_SEGMENT = /^(#|\.)([A-Za-z_-][\w-]*)((?::[\w-]+)*)$/;
const ATTRIBUTE_SEGMENT =
  /^\[([A-Za-z_:][\w:.-]*)=(?:"([^"]*)"|'([^']*)'|([^\s\]"']+))\]((?::[\w-]+)*)$/;

export async function repairSelectors(
  page: Page,
  input: string | string[],
): Promise<{ selectors: string[]; index: number } | undefined> {
  const parts = typeof input === 'string' ? partsFromSelector(input) : partsFromSteps(input);
  if (!parts) return undefined;

  const brokenAt = await firstBrokenIndex(page, parts);
  if (brokenAt === undefined) return undefined;
  const parsed = parseSimpleSegment(parts[brokenAt].text);
  if (!parsed) return undefined;
  if (await visibilityFilterOnly(page, parts, brokenAt, parsed)) return undefined;

  const chosen = chooseReplacement(await matchingReplacements(page, parts, brokenAt, parsed));
  if (!chosen) return undefined;
  const selectors = parts.map((part, index) => (index === brokenAt ? chosen.segment : part.text));
  return { selectors, index: brokenAt };
}

export async function repairSelectorsFromRef(
  page: Page,
  selectors: string[],
  ref: string,
): Promise<{ selectors: string[] } | undefined> {
  const ancestry = await readAncestry(page, ref);
  if (ancestry.length === 0) return undefined;
  const next = [...selectors];
  let changed = false;
  for (let index = 0; index < next.length; index += 1) {
    const prefix = next.slice(0, index);
    if (
      (await chainCount(page, [...prefix, next[index]])) === 1 &&
      (await containsRef(page, [...prefix, next[index]], ref))
    ) {
      continue;
    }
    const parsed = parseSimpleSegment(next[index]);
    if (!parsed) return undefined;
    let options = await replacementsContainingRef(page, prefix, parsed, ancestry, ref);
    if (index < next.length - 1) {
      const ancestors = [];
      for (const option of options) {
        if (!(await isSelf(page, [...prefix, option.segment], ref))) ancestors.push(option);
      }
      if (ancestors.length > 0) options = ancestors;
    }
    const chosen = chooseReplacement(options);
    if (!chosen) return undefined;
    next[index] = chosen.segment;
    changed = true;
  }
  if (!changed) return undefined;
  if ((await chainCount(page, next)) !== 1 || !(await containsRef(page, next, ref))) {
    return undefined;
  }
  return { selectors: next };
}

async function replacementsContainingRef(
  page: Page,
  prefix: string[],
  parsed: SimpleSegment,
  ancestry: DomSnapshot[],
  ref: string,
): Promise<Array<{ selector: string; segment: string; score: number }>> {
  const dom = {
    classes: [...new Set(ancestry.flatMap((node) => node.classes))],
    ids: [...new Set(ancestry.flatMap((node) => node.ids))],
    attributes: ancestry.flatMap((node) => node.attributes),
  };
  const matches: Array<{ selector: string; segment: string; score: number }> = [];
  for (const candidate of replacementCandidates(parsed, dom)) {
    const selectors = [...prefix, candidate.segment];
    if ((await chainCount(page, selectors)) !== 1) continue;
    if (!(await containsRef(page, selectors, ref))) continue;
    matches.push({ selector: candidate.segment, segment: candidate.segment, score: candidate.score });
  }
  return matches;
}

async function readAncestry(page: Page, ref: string): Promise<DomSnapshot[]> {
  try {
    return await page.locator(`aria-ref=${ref}`).evaluate((element) => {
      const nodes: Array<{
        classes: string[];
        ids: string[];
        attributes: Array<{ name: string; value: string }>;
      }> = [];
      let current: Element | null = element instanceof Element ? element : null;
      while (current && current !== document.body.parentElement) {
        nodes.push({
          classes: [...current.classList],
          ids: current.id ? [current.id] : [],
          attributes: [...current.attributes]
            .filter((attribute) => attribute.name !== 'class' && attribute.name !== 'id' && attribute.name !== 'style')
            .filter((attribute) => attribute.value.length <= 200)
            .map((attribute) => ({ name: attribute.name, value: attribute.value })),
        });
        current = current.parentElement;
      }
      return nodes;
    });
  } catch {
    return [];
  }
}

async function isSelf(page: Page, selectors: string[], ref: string): Promise<boolean> {
  if ((await chainCount(page, selectors)) !== 1) return false;
  const target = page.locator(`aria-ref=${ref}`);
  await target.evaluate((element) => {
    element.setAttribute('data-heal-target', '1');
  }).catch(() => undefined);
  try {
    let locator = page.locator(selectors[0]);
    for (const selector of selectors.slice(1)) locator = locator.locator(selector);
    return await locator.evaluateAll(
      (elements) => elements.length === 1 && elements[0].getAttribute('data-heal-target') === '1',
    );
  } catch {
    return false;
  } finally {
    await target.evaluate((element) => {
      element.removeAttribute('data-heal-target');
    }).catch(() => undefined);
  }
}

async function chainCount(page: Page, selectors: string[]): Promise<number> {
  if (selectors.length === 0) return 0;
  let locator = page.locator(selectors[0]);
  for (const selector of selectors.slice(1)) locator = locator.locator(selector);
  try {
    return await locator.count();
  } catch {
    return 0;
  }
}

async function containsRef(page: Page, selectors: string[], ref: string): Promise<boolean> {
  if (selectors.length === 0) return false;
  const target = page.locator(`aria-ref=${ref}`);
  await target.evaluate((element) => {
    element.setAttribute('data-heal-target', '1');
  }).catch(() => undefined);
  try {
    let locator = page.locator(selectors[0]);
    for (const selector of selectors.slice(1)) locator = locator.locator(selector);
    return await locator.evaluateAll((elements) =>
      elements.some(
        (element) =>
          element.getAttribute('data-heal-target') === '1' ||
          element.querySelector('[data-heal-target="1"]') !== null,
      ),
    );
  } catch {
    return false;
  } finally {
    await target.evaluate((element) => {
      element.removeAttribute('data-heal-target');
    }).catch(() => undefined);
  }
}

function partsFromSteps(selectors: string[]): Part[] | undefined {
  if (selectors.length < 2 || selectors.some((selector) => !parseSimpleSegment(selector))) {
    return undefined;
  }
  return selectors.map((text) => ({ text }));
}

function partsFromSelector(selector: string): Part[] | undefined {
  const trimmed = selector.trim();
  const parsed = parseSimpleSegment(trimmed);
  if (parsed?.kind === 'attr') return [{ text: trimmed }];
  const parts = splitSelector(trimmed);
  if (!parts || parts.filter((part) => !isCombinator(part.text)).length < 2) return undefined;
  if (parts.some((part) => !isCombinator(part.text) && !parseSimpleSegment(part.text))) {
    return undefined;
  }
  return parts;
}

function chooseReplacement(
  matches: Array<{ selector: string; segment: string; score: number }>,
): { selector: string; segment: string; score: number } | undefined {
  if (matches.length === 1) return matches[0];
  if (matches.length < 2) return undefined;
  const ranked = [...matches].sort((a, b) => b.score - a.score);
  if (ranked[0].score > ranked[1].score && ranked[0].score > 0) return ranked[0];
  return undefined;
}

function splitSelector(selector: string): Part[] | undefined {
  const parts: Part[] = [];
  let current = '';
  let quote: string | undefined;
  let depth = 0;
  for (const char of selector.trim()) {
    if (quote) {
      current += char;
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(' || char === '[') {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ')' || char === ']') {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }
    if (char === ' ' && depth === 0) {
      if (current.trim()) parts.push({ text: current.trim() });
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push({ text: current.trim() });
  return parts.length > 1 ? parts : undefined;
}

async function firstBrokenIndex(
  page: Page,
  parts: Part[],
): Promise<number | undefined> {
  let previous = 1;
  let ambiguousAt: number | undefined;
  for (let index = 0; index < parts.length; index += 1) {
    if (isCombinator(parts[index].text)) continue;
    const count = await safeCount(page, join(parts.slice(0, index + 1)));
    if (count === 0) return index;
    if (previous === 1 && count > 1) ambiguousAt = index;
    previous = count;
  }
  return previous === 1 ? undefined : ambiguousAt;
}

async function visibilityFilterOnly(
  page: Page,
  parts: Part[],
  brokenAt: number,
  parsed: SimpleSegment,
): Promise<boolean> {
  if (!parsed.pseudos) return false;
  const withoutPseudo = parts.map((part, index) =>
    index === brokenAt ? { text: segmentWithoutPseudos(parsed) } : part,
  );
  return (await safeCount(page, join(withoutPseudo.slice(0, brokenAt + 1)))) >= 1;
}

async function matchingReplacements(
  page: Page,
  parts: Part[],
  brokenAt: number,
  parsed: SimpleSegment,
): Promise<Array<{ selector: string; segment: string; score: number }>> {
  const parent = join(parts.slice(0, brokenAt));
  const scope = parent ? page.locator(parent) : page;
  const dom = await collectDom(scope);
  const matches: Array<{ selector: string; segment: string; score: number }> = [];
  for (const candidate of replacementCandidates(parsed, dom)) {
    const selector = join(
      parts.map((part, index) => (index === brokenAt ? { text: candidate.segment } : part)),
    );
    if ((await safeCount(page, selector)) !== 1) continue;
    matches.push({ selector, segment: candidate.segment, score: candidate.score });
  }
  return matches;
}

type SimpleSegment =
  | { kind: 'id' | 'class'; prefix: '#' | '.'; token: string; pseudos: string }
  | { kind: 'attr'; name: string; value: string; pseudos: string };

function parseSimpleSegment(text: string): SimpleSegment | undefined {
  const attribute = ATTRIBUTE_SEGMENT.exec(text);
  if (attribute) {
    return {
      kind: 'attr',
      name: attribute[1],
      value: attribute[2] ?? attribute[3] ?? attribute[4] ?? '',
      pseudos: attribute[5] ?? '',
    };
  }
  const match = SIMPLE_SEGMENT.exec(text);
  if (!match) return undefined;
  return {
    kind: match[1] === '#' ? 'id' : 'class',
    prefix: match[1] as '#' | '.',
    token: match[2],
    pseudos: match[3] ?? '',
  };
}

function segmentWithoutPseudos(parsed: SimpleSegment): string {
  if (parsed.kind === 'attr') return formatAttribute(parsed.name, parsed.value);
  return `${parsed.prefix}${parsed.token}`;
}

type DomSnapshot = {
  classes: string[];
  ids: string[];
  attributes: Array<{ name: string; value: string }>;
};

function replacementCandidates(
  parsed: SimpleSegment,
  dom: DomSnapshot,
): Array<{ segment: string; score: number }> {
  const needle = parsed.kind === 'attr' ? parsed.value : parsed.token;
  const candidates: Array<{ segment: string; score: number }> = [];
  const push = (segment: string, score: number, allowUnrelated: boolean) => {
    if (!segment || (!allowUnrelated && score <= 0)) return;
    candidates.push({ segment: `${segment}${parsed.pseudos}`, score });
  };

  if (parsed.kind === 'class' || parsed.kind === 'attr') {
    for (const className of dom.classes) {
      if (!isCssToken(className)) continue;
      push(`.${cssEscape(className)}`, matchScore(needle, className), parsed.kind === 'class');
    }
  }
  if (parsed.kind === 'id' || parsed.kind === 'attr') {
    for (const id of dom.ids) {
      if (!isCssToken(id)) continue;
      push(`#${cssEscape(id)}`, matchScore(needle, id), parsed.kind === 'id');
    }
  }
  for (const attribute of dom.attributes) {
    if (!isCssToken(attribute.name) || !isAttributeValue(attribute.value)) continue;
    const sameName = parsed.kind === 'attr' && attribute.name === parsed.name ? 3 : 0;
    const nameScore = parsed.kind === 'attr' ? similarity(parsed.name, attribute.name) : 0;
    push(
      formatAttribute(attribute.name, attribute.value),
      sameName + matchScore(needle, attribute.value) + nameScore,
      false,
    );
  }
  return candidates.slice(0, 80);
}

function matchScore(needle: string, value: string): number {
  if (!needle || !value) return 0;
  if (needle === value) return 5;
  return similarity(needle, value);
}

function isCombinator(text: string): boolean {
  return text === '>' || text === '+' || text === '~';
}

function join(parts: Part[]): string {
  return parts.map((part) => part.text).join(' ');
}

async function safeCount(page: Page, selector: string): Promise<number> {
  if (!selector) return 0;
  try {
    return await page.locator(selector).count();
  } catch {
    return 0;
  }
}

async function collectDom(scope: Page | Locator): Promise<DomSnapshot> {
  try {
    return await scope.locator('*').evaluateAll((elements) => {
      const classes = new Set<string>();
      const ids = new Set<string>();
      const attributes = new Map<string, { name: string; value: string }>();
      for (const element of elements) {
        if (!(element instanceof Element)) continue;
        if (element.id) ids.add(element.id);
        for (const className of element.classList) classes.add(className);
        for (const attribute of element.attributes) {
          if (attribute.name === 'class' || attribute.name === 'id' || attribute.name === 'style') {
            continue;
          }
          if (attribute.value.length > 200) continue;
          attributes.set(`${attribute.name}=${attribute.value}`, {
            name: attribute.name,
            value: attribute.value,
          });
        }
      }
      return {
        classes: [...classes],
        ids: [...ids],
        attributes: [...attributes.values()],
      };
    });
  } catch {
    return { classes: [], ids: [], attributes: [] };
  }
}

function formatAttribute(name: string, value: string): string {
  const quote = value.includes('"') && !value.includes("'") ? "'" : '"';
  const escaped = quote === '"' ? value.replace(/"/g, '\\"') : value.replace(/'/g, "\\'");
  return `[${name}=${quote}${escaped}${quote}]`;
}

function isAttributeValue(value: string): boolean {
  return value.length > 0 && !/[\n\r]/.test(value);
}

function similarity(left: string, right: string): number {
  const leftTokens = new Set(left.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const rightTokens = new Set(right.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  let score = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) score += 1;
  }
  return score;
}

function isCssToken(value: string): boolean {
  return value.length > 0 && !/['"\\\s]/.test(value);
}

function cssEscape(value: string): string {
  return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}
