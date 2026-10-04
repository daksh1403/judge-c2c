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

// Trusted end-to-end HTTP latency protocol, including transport overhead. This is
// deliberately not a claim about isolated algorithm time or production capacity.
export async function benchmark(
  transport: Pick<Fetcher, 'fetch'>,
  spec: NonNullable<RunnerPolicy['benchmarks']>[number],
  implemented: boolean,
  deadline: number,
): Promise<RunnerResult['checks'][number]> {
  const started = Date.now(),
    samples: number[] = [];
  let failure: 'FAIL' | 'UNVERIFIED' | null = null;
  for (let i = 0; i < spec.warmup + spec.samples; i++) {
    const t = performance.now();
    const result = await acceptance(transport, spec, implemented, deadline);
    if (result.status !== 'PASS') {
      failure = result.status;
      break;
    }
    if (i >= spec.warmup)
      samples.push(Math.round((performance.now() - t) * 1000) / 1000);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const p95 =
    sorted.length === spec.samples
      ? sorted[Math.ceil(sorted.length * 0.95) - 1]!
      : null;
  return {
    id: spec.id,
    kind: 'benchmark',
    status: failure ?? (p95 !== null && p95 <= spec.maxP95Ms ? 'PASS' : 'FAIL'),
    exitCode: null,
    durationMs: Date.now() - started,
    stdout: canonical({
      protocol: 'http-latency-v1',
      samplesMs: samples,
      p95Ms: p95,
      budgetMs: spec.maxP95Ms,
      warmup: spec.warmup,
      scope:
        'End-to-end HTTP including evaluator transport overhead; development capacity only.',
    }),
    stderr: '',
    detail: failure
      ? 'Benchmark incomplete or behavior mismatch; no valid latency conclusion.'
      : `Trusted HTTP latency benchmark: p95 ${p95} ms over ${spec.samples} validated samples, budget ${spec.maxP95Ms} ms. Includes transport overhead; environment-specific.`,
  };
}
