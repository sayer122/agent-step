import type { Page, TestInfo } from '@playwright/test';

export interface AgentStepInput {
  action: string;
  expect: string[];
  timeout?: number;
  secrets?: Record<string, string>;
}

export interface AgentStepResult {
  action: string;
  expect: string[];
  actionTranscript: TranscriptEntry[];
  verification: VerificationResult;
  tokenUsage: TokenUsage;
  rawVerifierContent?: string;
}

export interface TranscriptEntry {
  turn: number;
  type: 'tool_call' | 'tool_result' | 'message';
  name?: string;
  input?: unknown;
  output?: unknown;
  content?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface CriterionVerdict {
  criterion: string;
  passed: boolean;
  evidence: string;
}

export interface VerificationResult {
  passed: boolean;
  criteria: CriterionVerdict[];
  inconclusive: boolean;
}

export interface AgentRuntimeOptions {
  page: Page;
  testInfo: TestInfo;
  allowedOrigins?: string[];
  maxTurns?: number;
  defaultTimeout?: number;
  /** Override model client for deterministic framework tests. */
  modelClient?: ModelClient;
}

export interface ModelClient {
  chat(params: ChatParams): Promise<ChatResponse>;
}

export interface ChatParams {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required';
  responseFormat?: { type: 'json_object' };
  signal?: AbortSignal;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatResponse {
  content: string | null;
  toolCalls: ToolCall[];
  usage: TokenUsage;
}

export interface AgentConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}
