import { afterEach, describe, it, expect, vi } from 'vitest';
import { benchmark } from '../src/runner-http';
import { runnerPolicySchema, paymentRetryPolicy } from '../src/runner-policy';
const spec = {
  id: 'health-latency',
  method: 'GET' as const,
  path: '/health',
  expectedStatus: 200,
  expectedBody: { ok: true },
  samples: 10,
  warmup: 2,
  maxP95Ms: 5,
};
afterEach(() => vi.restoreAllMocks());
describe('trusted HTTP latency evidence', () => {
  it('checks behavior on every sample, excludes warmups and retains measured samples', async () => {
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (time += 2));
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const r = await benchmark(
      { fetch } as unknown as Pick<Fetcher, 'fetch'>,
      spec,
      true,
      Date.now() + 30000,
    );
    expect(r.status).toBe('PASS');
    expect(fetch).toHaveBeenCalledTimes(12);
    expect(JSON.parse(r.stdout)).toMatchObject({
      protocol: 'http-latency-v1',
      p95Ms: 2,
      samplesMs: Array(10).fill(2),
    });
    expect(
      (
        await benchmark(
          { fetch } as unknown as Pick<Fetcher, 'fetch'>,
          { ...spec, maxP95Ms: 1 },
          true,
          Date.now() + 30000,
        )
      ).status,
    ).toBe('FAIL');
  });
  it('cannot receive performance credit by returning incorrect output quickly', async () => {
    const fetch = vi.fn(async () => Response.json({ ok: false }));
    const r = await benchmark(
      { fetch } as unknown as Pick<Fetcher, 'fetch'>,
      spec,
      true,
      Date.now() + 30000,
    );
    expect(r.status).toBe('FAIL');
    expect(JSON.parse(r.stdout).p95Ms).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('marks an exhausted budget unverified without issuing network work', async () => {
    const fetch = vi.fn();
    expect(
      (
        await benchmark(
          { fetch } as unknown as Pick<Fetcher, 'fetch'>,
          spec,
          true,
          Date.now() - 1,
        )
      ).status,
    ).toBe('UNVERIFIED');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects duplicate check identities and unbounded benchmark policies', () => {
    expect(() =>
      runnerPolicySchema.parse({
        ...paymentRetryPolicy,
        benchmarks: [{ ...spec, id: 'build' }],
      }),
    ).toThrow();
    expect(() =>
      runnerPolicySchema.parse({
        ...paymentRetryPolicy,
        benchmarks: [{ ...spec, samples: 10000 }],
      }),
    ).toThrow();
  });
});
