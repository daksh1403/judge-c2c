import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { canonical, digest } from './domain';
import {
  runnerSignature,
  requestMessage,
  responseMessage,
} from './runner-tunnel';
import { verifyWebhook } from './security';
import type { RunnerResult } from './runner';
export function createRunnerServer(
  key: string | readonly string[],
  evaluate: (body: unknown) => Promise<RunnerResult>,
) {
  const keys = typeof key === 'string' ? [key] : [...key];
  if (
    keys.length < 1 ||
    keys.length > 2 ||
    keys.some((secret) => !/^[a-f0-9]{64}$/.test(secret)) ||
    new Set(keys).size !== keys.length
  )
    throw new Error('RUNNER_KEYS_INVALID');
  const seen = new Map<string, number>();
  let busy = false;
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const reply = (code: number, text: string) => {
      res.writeHead(code, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(text);
    };
    if (req.method !== 'POST' || req.url !== '/evaluate')
      return reply(404, '{"error":"NOT_FOUND"}');
    const timestamp = String(req.headers['x-runner-time'] ?? ''),
      nonce = String(req.headers['x-runner-nonce'] ?? ''),
      signature = String(req.headers['x-runner-signature'] ?? '');
    if (
      !/^\d{13}$/.test(timestamp) ||
      Math.abs(Date.now() - Number(timestamp)) > 30000 ||
      !/^[a-f0-9-]{36}$/.test(nonce)
    )
      return reply(401, '{"error":"UNAUTHORIZED"}');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1000000) return reply(413, '{"error":"BODY_LIMIT"}');
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks);
    const hash = [
      ...new Uint8Array(
        await crypto.subtle.digest('SHA-256', new Uint8Array(raw)),
      ),
    ]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const body = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true,
    }).decode(raw);
    let matchedKey: string | undefined;
    for (const secret of keys)
      if (
        await verifyWebhook(
          new TextEncoder().encode(requestMessage(timestamp, nonce, hash)),
          signature,
          secret,
        )
      )
        matchedKey = secret;
    if (!matchedKey) return reply(401, '{"error":"UNAUTHORIZED"}');
    for (const [id, time] of seen)
      if (time < Date.now() - 60000) seen.delete(id);
    if (seen.has(nonce)) return reply(409, '{"error":"REPLAY"}');
    if (busy) return reply(429, '{"error":"RUNNER_BUSY"}');
    seen.set(nonce, Date.now());
    busy = true;
    try {
      const result = await evaluate(JSON.parse(body)),
        text = canonical(result);
      res.setHeader(
        'x-runner-signature',
        await runnerSignature(
          matchedKey,
          responseMessage(nonce, hash, await digest(text)),
        ),
      );
      reply(200, text);
    } catch {
      reply(422, '{"error":"RUNNER_EXECUTION_UNAVAILABLE"}');
    } finally {
      busy = false;
    }
  }
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      } else res.destroy();
    });
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.maxConnections = 16;
  return server;
}
