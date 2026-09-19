const SECRET_PLACEHOLDER = /^%([A-Za-z_][A-Za-z0-9_]*)%$/;

export function resolveSecretValue(
  value: string,
  secrets: Record<string, string>,
): string {
  const match = value.match(SECRET_PLACEHOLDER);
  if (!match) return value;
  const key = match[1];
  if (!(key in secrets)) {
    throw new Error(`Missing secret placeholder value for %${key}%`);
  }
  return secrets[key];
}

export function redactSecrets(
  text: string,
  secrets: Record<string, string>,
): string {
  let result = text;
  for (const [key, value] of Object.entries(secrets)) {
    if (!value) continue;
    result = result.split(value).join(`%${key}%`);
  }
  return result;
}

export function redactObject(
  value: unknown,
  secrets: Record<string, string>,
): unknown {
  if (typeof value === 'string') {
    return redactSecrets(value, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactObject(item, secrets));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = redactObject(nested, secrets);
    }
    return result;
  }
  return value;
}
