export async function verifyWebhook(
  body: Uint8Array,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature))
    return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const bytes = Uint8Array.from(signature.slice(7).match(/../g)!, (x) =>
    parseInt(x, 16),
  );
  return crypto.subtle.verify(
    'HMAC',
    key,
    bytes,
    body as Uint8Array<ArrayBuffer>,
  );
}
export async function equalSecret(
  actual: string | null,
  expected: string | undefined,
) {
  if (!actual || !expected || expected.length < 32) return false;
  const hash = async (s: string) =>
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)),
    );
  const [a, b] = await Promise.all([hash(actual), hash(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
const secretKey = `["']?\\b(?:password|passwd|secret|secret[_-]?key|api[_-]?key|token|aws[_-]?secret[_-]?access[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|private[_-]?key|credential|bearer[_-]?token)["']?`;
const sensitiveJsonField =
  /(?:password|passwd|secret|api[_-]?key|token|credential|private[_-]?key)/i;
const MAX_JSON_REDACTION_DEPTH = 100;

function redactPlainText(text: string) {
  const prefix = `(${secretKey}\\s*[:=]\\s*)`;
  return (
    text
      .replace(
        /(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{20,})/g,
        '[REDACTED]',
      )
      .replace(
        /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
        '[REDACTED PRIVATE KEY]',
      )
      // Quote-specific forms allow the other quote character inside the value
      // and honor escapes, so e.g. a double-quoted value may contain apostrophes.
      .replace(
        new RegExp(`${prefix}"((?:\\\\.|[^"\\\\]){8,})"`, 'gi'),
        '$1"[REDACTED]"',
      )
      .replace(
        new RegExp(`${prefix}'((?:\\\\.|[^'\\\\]){8,})'`, 'gi'),
        "$1'[REDACTED]'",
      )
      .replace(
        new RegExp(`${prefix}([^\\s"'\\x60,;}\\]]{8,})`, 'gi'),
        '$1[REDACTED]',
      )
  );
}

function jsonNestingTooDeep(text: string) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{' || char === '[') {
      depth++;
      if (depth > MAX_JSON_REDACTION_DEPTH) return true;
    } else if (char === '}' || char === ']') depth--;
  }
  return false;
}

function redactJsonStrings(text: string) {
  if (jsonNestingTooDeep(text))
    return JSON.stringify({
      redacted: true,
      reason: 'JSON nesting limit exceeded',
    });
  try {
    const parsed: unknown = JSON.parse(text);
    let changed = false;
    const cleaned = JSON.stringify(parsed, (key: string, value: unknown) => {
      if (typeof value !== 'string') return value;
      const redacted = redactPlainText(value);
      if (redacted !== value) changed = true;
      if (key && sensitiveJsonField.test(key) && value.length > 0) {
        changed = true;
        return '[REDACTED]';
      }
      return redacted;
    });
    return changed ? cleaned : text;
  } catch {
    return null;
  }
}

export function redact(text: string) {
  const structured = redactJsonStrings(text);
  return structured === null ? redactPlainText(text) : structured;
}
export async function boundedBody(
  request: Request,
  max: number,
): Promise<Uint8Array> {
  if (Number(request.headers.get('content-length')) > max)
    throw new Error('BODY_LIMIT');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new Error('BODY_LIMIT');
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}
