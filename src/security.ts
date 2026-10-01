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
export function redact(text: string) {
  return text
    .replace(
      /(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{20,})/g,
      '[REDACTED]',
    )
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      '[REDACTED PRIVATE KEY]',
    )
    .replace(
      /((?:password|secret|api[_-]?key|token)\s*[:=]\s*["']?)[^\s"',;]{8,}/gi,
      '$1[REDACTED]',
    );
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
