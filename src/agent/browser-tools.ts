import type { Page } from '@playwright/test';
import { resolveSecretValue } from './redaction.js';
import type { ToolDefinition } from './types.js';

export interface BrowserToolContext {
  page: Page;
  allowedOrigins: string[];
  secrets: Record<string, string>;
}

export const BROWSER_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'snapshot',
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
      name: 'click',
      description: 'Click an element identified by an aria-ref from the latest snapshot.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref such as e2 or f1e3.' },
        },
        required: ['ref'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fill',
      description:
        'Fill a text input identified by aria-ref. Use %SECRET_NAME% placeholders for sensitive values.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          value: { type: 'string' },
        },
        required: ['ref', 'value'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'select',
      description: 'Select an option in a select element by aria-ref.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          value: { type: 'string' },
        },
        required: ['ref', 'value'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check',
      description: 'Check or uncheck a checkbox by aria-ref.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          checked: { type: 'boolean' },
        },
        required: ['ref', 'checked'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'press',
      description: 'Press a keyboard key on the page. Allowed keys: Enter, Tab, Escape, ArrowDown, ArrowUp.',
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
      description: 'Signal that the requested action has been completed.',
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
      case 'snapshot':
        return this.snapshot();
      case 'click':
        return this.click(String(args.ref));
      case 'fill':
        return this.fill(String(args.ref), String(args.value));
      case 'select':
        return this.select(String(args.ref), String(args.value));
      case 'check':
        return this.check(String(args.ref), Boolean(args.checked));
      case 'press':
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

  private async fill(ref: string, value: string): Promise<{ ok: true }> {
    this.assertRef(ref);
    const resolved = resolveSecretValue(value, this.ctx.secrets);
    await this.ctx.page.locator(`aria-ref=${ref}`).fill(resolved);
    return { ok: true };
  }

  private async select(ref: string, value: string): Promise<{ ok: true }> {
    this.assertRef(ref);
    await this.ctx.page.locator(`aria-ref=${ref}`).selectOption(value);
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
