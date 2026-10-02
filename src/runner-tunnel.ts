import { canonical, digest } from './domain';
import { boundedBody, verifyWebhook } from './security';
import type { RunnerRequest } from './runner';
import type { Env } from './env';
export async function runnerSignature(secret: string, text: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)),
  );
  return (
    'sha256=' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  );
}
export const requestMessage = (
  timestamp: string,
  nonce: string,
  bodyHash: string,
) => `judge-runner-v1\nPOST\n/evaluate\n${timestamp}\n${nonce}\n${bodyHash}`;
export const responseMessage = (
  nonce: string,
  requestHash: string,
  bodyHash: string,
) => `judge-runner-result-v1\n${nonce}\n${requestHash}\n${bodyHash}`;
export async function tunnelEvaluate(env: Env, request: RunnerRequest) {
  if (
    !env.RUNNER_ENDPOINT ||
    !env.RUNNER_TUNNEL_KEY ||
    env.RUNNER_TUNNEL_KEY.length < 64
  )
    throw new Error('RUNNER_TUNNEL_NOT_CONFIGURED');
  const endpoint = new URL(env.RUNNER_ENDPOINT);
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== '/' ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error('RUNNER_TUNNEL_ENDPOINT_INVALID');
  const body = canonical(request),
    hash = await digest(body),
    nonce = crypto.randomUUID(),
    timestamp = String(Date.now());
  const response = await fetch(new URL('/evaluate', endpoint), {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(95000),
    headers: {
      'content-type': 'application/json',
      'x-runner-time': timestamp,
      'x-runner-nonce': nonce,
      'x-runner-signature': await runnerSignature(
        env.RUNNER_TUNNEL_KEY,
        requestMessage(timestamp, nonce, hash),
      ),
    },
    body,
  });
  if (response.status === 429) throw new Error('RUNNER_BUSY');
  if (!response.ok) throw new Error('RUNNER_TUNNEL_UNAVAILABLE');
  const bytes = await boundedBody(
    new Request('https://internal/', {
      method: 'POST',
      body: response.body,
      duplex: 'half',
    } as RequestInit),
    512000,
  );
  const text = new TextDecoder().decode(bytes);
  if (
    !(await verifyWebhook(
      new TextEncoder().encode(
        responseMessage(nonce, hash, await digest(text)),
      ),
      response.headers.get('x-runner-signature'),
      env.RUNNER_TUNNEL_KEY,
    ))
  )
    throw new Error('RUNNER_TUNNEL_INVALID_RESULT_SIGNATURE');
  return JSON.parse(text);
}
