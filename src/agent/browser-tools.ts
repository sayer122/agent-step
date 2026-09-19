import type { Page } from '@playwright/test';
import { resolveSecretValue } from './redaction.js';
import type { ToolDefinition } from './types.js';

export interface BrowserToolContext {
  page: Page;
  allowedOrigins: string[];
  secrets: Record<string, string>;
}

const targetParam = {
  type: 'string',
  description:
    'Element ref from the latest accessibility snapshot, such as e2 or f1e3.',
};

export const BROWSER_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'browser_snapshot',
      description:
        'Capture the current page accessibility snapshot with element refs for interaction.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description: 'Click an element identified by a snapshot ref.',
      parameters: {
        type: 'object',
        properties: {
          target: targetParam,
          ref: targetParam,
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description:
        'Fill a text input identified by a snapshot ref. Use %SECRET_NAME% placeholders for sensitive values.',
      parameters: {
        type: 'object',
        properties: {
          target: targetParam,
          ref: targetParam,
          text: { type: 'string' },
          value: { type: 'string' },
          submit: {
            type: 'boolean',
            description: 'If true, press Enter after filling.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_select_option',
      description: 'Select dropdown option(s) identified by a snapshot ref.',
      parameters: {
        type: 'object',
        properties: {
          target: targetParam,
          ref: targetParam,
          values: {
            type: 'array',
            items: { type: 'string' },
          },
          value: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_check',
      description: 'Check a checkbox or radio identified by a snapshot ref.',
      parameters: {
        type: 'object',
        properties: {
          target: targetParam,
          ref: targetParam,
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_uncheck',
      description: 'Uncheck a checkbox identified by a snapshot ref.',
      parameters: {
        type: 'object',
        properties: {
          target: targetParam,
          ref: targetParam,
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_press_key',
      description:
        'Press a keyboard key. Allowed keys: Enter, Tab, Escape, ArrowDown, ArrowUp.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
        },
        required: ['key'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'done',
      description:
        'Signal that the requested Playwright test action has been completed.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
        },
        required: ['summary'],
        additionalProperties: false,
      },
    },
  },
];

const ALLOWED_KEYS = new Set(['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp']);

export class BrowserTools {
  private doneSummary: string | null = null;

  constructor(private readonly ctx: BrowserToolContext) {}

  isDone(): boolean {
    return this.doneSummary !== null;
  }

  getDoneSummary(): string | null {
    return this.doneSummary;
  }

  async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.assertAllowedOrigin();

    switch (name) {
      case 'browser_snapshot':
        return this.snapshot();
      case 'browser_click':
        return this.click(readTarget(args));
      case 'browser_type':
        return this.type(readTarget(args), readText(args), Boolean(args.submit));
      case 'browser_select_option':
        return this.select(readTarget(args), readSelectValues(args));
      case 'browser_check':
        return this.check(readTarget(args), true);
      case 'browser_uncheck':
        return this.check(readTarget(args), false);
      case 'browser_press_key':
        return this.press(String(args.key));
      case 'done':
        this.doneSummary = String(args.summary);
        return { ok: true, summary: this.doneSummary };
      default:
        throw new Error(`Disallowed tool: ${name}`);
    }
  }

  async snapshot(): Promise<{ snapshot: unknown; url: string }> {
    await this.assertAllowedOrigin();
    const snapshot = await this.ctx.page.ariaSnapshotJSON({ mode: 'ai' });
    return { snapshot, url: this.ctx.page.url() };
  }

  private async click(ref: string): Promise<{ ok: true; url: string }> {
    this.assertRef(ref);
    await this.ctx.page.locator(`aria-ref=${ref}`).click();
    return { ok: true, url: this.ctx.page.url() };
  }

  private async type(
    ref: string,
    text: string,
    submit: boolean,
  ): Promise<{ ok: true }> {
    this.assertRef(ref);
    const resolved = resolveSecretValue(text, this.ctx.secrets);
    await this.ctx.page.locator(`aria-ref=${ref}`).fill(resolved);
    if (submit) {
      await this.press('Enter');
    }
    return { ok: true };
  }

  private async select(ref: string, values: string[]): Promise<{ ok: true }> {
    this.assertRef(ref);
    await this.ctx.page.locator(`aria-ref=${ref}`).selectOption(values);
    return { ok: true };
  }

  private async check(ref: string, checked: boolean): Promise<{ ok: true }> {
    this.assertRef(ref);
    const locator = this.ctx.page.locator(`aria-ref=${ref}`);
    if (checked) {
      await locator.check();
    } else {
      await locator.uncheck();
    }
    return { ok: true };
  }

  private async press(key: string): Promise<{ ok: true }> {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`Disallowed key: ${key}`);
    }
    await this.ctx.page.keyboard.press(key);
    return { ok: true };
  }

  private assertRef(ref: string): void {
    if (!/^(?:f\d+)?e\d+$/.test(ref)) {
      throw new Error(`Invalid aria-ref format: ${ref}`);
    }
  }

  private async assertAllowedOrigin(): Promise<void> {
    const url = this.ctx.page.url();
    if (url === 'about:blank') return;

    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      throw new Error(`Invalid page URL: ${url}`);
    }

    if (!this.ctx.allowedOrigins.includes(origin)) {
      throw new Error(`Origin not allowed: ${origin}`);
    }
  }
}

function readTarget(args: Record<string, unknown>): string {
  const target = args.target ?? args.ref;
  if (typeof target !== 'string' || !target) {
    throw new Error('Missing snapshot target/ref');
  }
  return target;
}

function readText(args: Record<string, unknown>): string {
  const text = args.text ?? args.value;
  if (typeof text !== 'string') {
    throw new Error('Missing text/value to type');
  }
  return text;
}

function readSelectValues(args: Record<string, unknown>): string[] {
  if (Array.isArray(args.values)) {
    return args.values.map(String);
  }
  if (typeof args.value === 'string') {
    return [args.value];
  }
  throw new Error('Missing values to select');
}
