export function agentStepDebugEnabled(): boolean {
  const value = process.env.AGENT_STEP_DEBUG?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

export function debugLog(label: string, details?: unknown): void {
  if (!agentStepDebugEnabled()) return;
  const prefix = `[agent-step] ${label}`;
  if (details === undefined) {
    console.log(prefix);
    return;
  }
  const text = typeof details === 'string' ? details : JSON.stringify(details, null, 2);
  console.log(`${prefix}\n${truncate(text)}`);
}

function truncate(text: string, max = 12_000): string {
  return text.length > max ? `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]` : text;
}
