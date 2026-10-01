import { canonical, digest } from './domain';
import type { RunnerPolicy } from './runner-policy';
import type { RunnerResult } from './runner';
import { boundedBody, redact } from './security';
// Runs in the trusted Durable Object, never in the participant guest.
export async function acceptance(
  transport: Pick<Fetcher, 'fetch'>,
  test: RunnerPolicy['cases'][number],
  implemented: boolean,
  deadline = Date.now() + 15000,
) {
  const started = Date.now();
  let status: 'PASS' | 'FAIL' | 'UNVERIFIED' = implemented
    ? 'UNVERIFIED'
    : 'FAIL';
  let detail = implemented
    ? 'Acceptance endpoint unavailable. Functional behavior is unverified.'
    : 'Required service entrypoint is missing.';
  let stdout = '';
  if (implemented)
    for (let attempt = 0; attempt < 5; attempt++) {
      if (Date.now() >= deadline) {
        detail = 'Overall execution time budget exhausted.';
        break;
      }
      try {
        const response = await transport.fetch('http://runner' + test.path, {
          method: test.method,
          headers: { 'content-type': 'application/json' },
          body: test.body === undefined ? undefined : canonical(test.body),
          redirect: 'manual',
          signal: AbortSignal.timeout(
            Math.max(1, Math.min(2000, deadline - Date.now())),
          ),
        });
        const body = await boundedBody(
          new Request('https://internal/', {
            method: 'POST',
            body: response.body,
            duplex: 'half',
          } as RequestInit),
          16000,
        );
        const text = new TextDecoder().decode(body);
        stdout = redact(text).slice(0, 8192);
        let actual;
        try {
          actual = JSON.parse(text);
        } catch {
          status = 'FAIL';
          detail = `Completed HTTP ${response.status} response is not valid JSON. Observed body SHA-256 ${await digest(text)}.`;
          break;
        }
        status =
          response.status === test.expectedStatus &&
          canonical(actual) === canonical(test.expectedBody)
            ? 'PASS'
            : 'FAIL';
        detail = `Trusted HTTP acceptance ${test.id}: ${status}. Expected status ${test.expectedStatus}; observed ${response.status}.`;
        break;
      } catch {
        if (attempt < 4)
          await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  return {
    id: test.id,
    kind: 'acceptance',
    status,
    exitCode: null,
    durationMs: Date.now() - started,
    stdout,
    stderr: '',
    detail,
  } satisfies RunnerResult['checks'][number];
}
