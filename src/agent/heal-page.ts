import type { Locator, Page, TestInfo } from '@playwright/test';
import {
  captureCallerFrame,
  healLocatorMiss,
  isHealableLocatorMiss,
  rememberLocatorStep,
  type AgentHealOptions,
} from './heal.js';

const PAGE_LOCATORS = new Set([
  'locator',
  'getByRole',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByAltText',
  'getByTitle',
  'getByTestId',
]);

const LOCATOR_CHAINS = new Set([
  ...PAGE_LOCATORS,
  'filter',
  'first',
  'last',
  'nth',
  'and',
  'or',
]);

const LOCATOR_ACTIONS = new Set([
  'click',
  'dblclick',
  'tap',
  'fill',
  'clear',
  'type',
  'press',
  'check',
  'uncheck',
  'setChecked',
  'selectOption',
  'hover',
  'focus',
  'blur',
  'dragTo',
  'setInputFiles',
  'pressSequentially',
  'scrollIntoViewIfNeeded',
  'waitFor',
]);

export function createHealingPage(
  page: Page,
  options: AgentHealOptions & { testInfo: TestInfo },
): Page {
  return new Proxy(page, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string' || typeof value !== 'function') return value;
      if (!PAGE_LOCATORS.has(prop)) return value.bind(target);
      return (...args: unknown[]) => {
        const created = value.apply(target, args) as Locator;
        rememberCreatedLocator(created, prop, args);
        return wrapLocator(created, options);
      };
    },
  });
}

function wrapLocator(locator: Locator, options: AgentHealOptions): Locator {
  return new Proxy(locator, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string' || typeof value !== 'function') return value;
      if (LOCATOR_CHAINS.has(prop)) {
        return (...args: unknown[]) => {
          const created = value.apply(target, args) as Locator;
          rememberCreatedLocator(created, prop, args, target);
          return wrapLocator(created, options);
        };
      }
      if (!LOCATOR_ACTIONS.has(prop)) return value.bind(target);
      return (...args: unknown[]) => runAction(target, prop, args, options);
    },
  });
}

async function runAction(
  locator: Locator,
  methodName: string,
  args: unknown[],
  options: AgentHealOptions,
): Promise<unknown> {
  try {
    return await invoke(locator, methodName, args);
  } catch (error) {
    if (!isHealableLocatorMiss(error)) throw error;
    return healLocatorMiss(
      locator,
      error,
      (healed) => invoke(healed, methodName, argsForRetry(args)),
      options,
    );
  }
}

function invoke(
  locator: Locator,
  methodName: string,
  args: unknown[],
): Promise<unknown> {
  switch (methodName) {
    case 'click':
      return locator.click(...(args as Parameters<Locator['click']>));
    case 'dblclick':
      return locator.dblclick(...(args as Parameters<Locator['dblclick']>));
    case 'tap':
      return locator.tap(...(args as Parameters<Locator['tap']>));
    case 'fill':
      return locator.fill(...(args as Parameters<Locator['fill']>));
    case 'clear':
      return locator.clear(...(args as Parameters<Locator['clear']>));
    case 'type':
      return locator.type(...(args as Parameters<Locator['type']>));
    case 'press':
      return locator.press(...(args as Parameters<Locator['press']>));
    case 'check':
      return locator.check(...(args as Parameters<Locator['check']>));
    case 'uncheck':
      return locator.uncheck(...(args as Parameters<Locator['uncheck']>));
    case 'setChecked':
      return locator.setChecked(...(args as Parameters<Locator['setChecked']>));
    case 'selectOption':
      return locator.selectOption(...(args as Parameters<Locator['selectOption']>));
    case 'hover':
      return locator.hover(...(args as Parameters<Locator['hover']>));
    case 'focus':
      return locator.focus(...(args as Parameters<Locator['focus']>));
    case 'blur':
      return locator.blur(...(args as Parameters<Locator['blur']>));
    case 'dragTo':
      return locator.dragTo(...(args as Parameters<Locator['dragTo']>));
    case 'setInputFiles':
      return locator.setInputFiles(...(args as Parameters<Locator['setInputFiles']>));
    case 'pressSequentially':
      return locator.pressSequentially(...(args as Parameters<Locator['pressSequentially']>));
    case 'scrollIntoViewIfNeeded':
      return locator.scrollIntoViewIfNeeded(...(args as Parameters<Locator['scrollIntoViewIfNeeded']>));
    case 'waitFor':
      return locator.waitFor(...(args as Parameters<Locator['waitFor']>));
    default:
      throw new Error(`Unsupported heal action: ${methodName}`);
  }
}

function rememberCreatedLocator(
  locator: Locator,
  methodName: string,
  args: unknown[],
  parent?: Locator,
): void {
  rememberLocatorStep(locator, {
    selector: methodName === 'locator' && typeof args[0] === 'string' ? args[0] : undefined,
    parent,
    origin: captureCallerFrame(),
  });
}

function argsForRetry(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (!arg || typeof arg !== 'object' || Array.isArray(arg) || !('timeout' in arg)) {
      return arg;
    }
    const record = { ...(arg as Record<string, unknown>) };
    if (process.env.PWDEBUG) {
      delete record.timeout;
      return record;
    }
    const timeout = typeof record.timeout === 'number' ? record.timeout : 0;
    record.timeout = Math.max(timeout, 15_000);
    return record;
  });
}
