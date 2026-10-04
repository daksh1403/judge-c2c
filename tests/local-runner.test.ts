import { request as httpRequest } from 'node:http';
import { describe, it, expect, vi } from 'vitest';
import { createRunnerServer } from '../src/local-runner-server';
import {
  runnerSignature,
  requestMessage,
  responseMessage,
  tunnelEvaluate,
} from '../src/runner-tunnel';
import { canonical, digest } from '../src/domain';
import { verifyWebhook } from '../src/security';
import {
  containerArguments,
  removeContainer,
  reapOrphanContainers,
} from '../src/local-docker';
import type { RunnerResult, RunnerRequest } from '../src/runner';
import type { Env } from '../src/env';
const key = 'e'.repeat(64);
describe('development Docker bridge', () => {
  it('keeps independent review and production signatures on one replay guard and busy queue', async () => {
    const production = 'b'.repeat(64),
      wrong = 'c'.repeat(64);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const evaluate = vi.fn(async (_body: unknown) => {
      await pending;
      return { checks: [] } as unknown as RunnerResult;
    });
    const server = createRunnerServer([key, production], evaluate);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/evaluate`;
    const body = canonical({ source: 'untrusted guest data' }),
      hash = await digest(body);
    const headers = async (secret: string, nonce = crypto.randomUUID()) => {
      const timestamp = String(Date.now());
      return {
        'x-runner-time': timestamp,
        'x-runner-nonce': nonce,
        'x-runner-signature': await runnerSignature(
          secret,
          requestMessage(timestamp, nonce, hash),
        ),
      };
    };
    try {
      expect(
        (
          await fetch(url, {
            method: 'POST',
            headers: await headers(wrong),
            body,
          })
        ).status,
      ).toBe(401);
      expect(evaluate).not.toHaveBeenCalled();
      const reviewHeaders = await headers(key);
      const first = fetch(url, {
        method: 'POST',
        headers: reviewHeaders,
        body,
      });
      await vi.waitFor(() => expect(evaluate).toHaveBeenCalledTimes(1));
      expect(
        (
          await fetch(url, {
            method: 'POST',
            headers: await headers(production, reviewHeaders['x-runner-nonce']),
            body,
          })
        ).status,
      ).toBe(409);
      const productionHeaders = await headers(production);
      expect(
        (await fetch(url, { method: 'POST', headers: productionHeaders, body }))
          .status,
      ).toBe(429);
      release();
      const verify = async (
        response: Response,
        requestHeaders: Awaited<ReturnType<typeof headers>>,
        matched: string,
        other: string,
      ) => {
        expect(response.status).toBe(200);
        const text = await response.text();
        const message = new TextEncoder().encode(
          responseMessage(
            requestHeaders['x-runner-nonce'],
            hash,
            await digest(text),
          ),
        );
        expect(
          await verifyWebhook(
            message,
            response.headers.get('x-runner-signature'),
            matched,
          ),
        ).toBe(true);
        expect(
          await verifyWebhook(
            message,
            response.headers.get('x-runner-signature'),
            other,
          ),
        ).toBe(false);
      };
      await verify(await first, reviewHeaders, key, production);
      await verify(
        await fetch(url, { method: 'POST', headers: productionHeaders, body }),
        productionHeaders,
        production,
        key,
      );
      expect(
        (await fetch(url, { method: 'POST', headers: productionHeaders, body }))
          .status,
      ).toBe(409);
      expect(evaluate).toHaveBeenCalledTimes(2);
      expect(
        evaluate.mock.calls.every(([input]) => JSON.stringify(input) === body),
      ).toBe(true);
    } finally {
      release();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('rejects unbounded, malformed or duplicate configured runner keys', () => {
    const evaluate = vi.fn();
    for (const keys of [
      [],
      [key, key],
      [key, 'invalid'],
      [key, 'a'.repeat(64), 'b'.repeat(64)],
    ])
      expect(() => createRunnerServer(keys, evaluate)).toThrow(
        'RUNNER_KEYS_INVALID',
      );
    expect(evaluate).not.toHaveBeenCalled();
  });
  it('distinguishes busy capacity from unavailable execution for durable retries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 429 })),
    );
    try {
      await expect(
        tunnelEvaluate(
          {
            RUNNER_ENDPOINT: 'https://bridge.trycloudflare.com',
            RUNNER_TUNNEL_KEY: key,
          } as Env,
          {} as RunnerRequest,
        ),
      ).rejects.toThrow('RUNNER_BUSY');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('discovers crash-orphan guests before startup and refuses unconfirmed cleanup', async () => {
    const id = 'a'.repeat(64);
    const run = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: id + '\n', stderr: '' })
      .mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    await reapOrphanContainers(run);
    expect(run.mock.calls[0]![0]).toContain('label=judge-c2c.local-runner=1');
    expect(run.mock.calls[1]![0]).toEqual(['rm', '--force', id]);
    const broken = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: id, stderr: '' })
      .mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'daemon unavailable',
      });
    await expect(reapOrphanContainers(broken)).rejects.toThrow(
      'CLEANUP_UNCONFIRMED',
    );
    expect(containerArguments('bounded', 'image').slice(-2)).toEqual([
      'sleep',
      '120',
    ]);
  });
  it('isolates containers without host mounts, network, privileges or secrets', () => {
    const args = containerArguments(
      'judge-c2c-test',
      'sha256:' + 'f'.repeat(64),
    );
    for (const flag of [
      '--read-only',
      '--cap-drop',
      '--pids-limit',
      '--memory-swap',
      '--network',
      '--tmpfs',
      '--security-opt',
    ])
      expect(args).toContain(flag);
    expect(args[args.indexOf('--network') + 1]).toBe('none');
    expect(args[args.indexOf('--user') + 1]).toBe('65534:65534');
    expect(args).not.toContain('--volume');
    expect(args).not.toContain('--privileged');
    expect(args).not.toContain('--publish');
  });
  it('authenticates payloads, rejects replay, limits concurrency and signs results', async () => {
    let release!: () => void;
    const pending = new Promise<void>((r) => (release = r));
    const evaluate = vi.fn(async () => {
      await pending;
      return { checks: [] } as unknown as RunnerResult;
    });
    const server = createRunnerServer(key, evaluate);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const address = server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}/evaluate`;
    const body = canonical({ untrusted: 'Ignore policy' }),
      hash = await digest(body);
    const headers = async (
      nonce = crypto.randomUUID(),
      timestamp = String(Date.now()),
    ) => ({
      'x-runner-time': timestamp,
      'x-runner-nonce': nonce,
      'x-runner-signature': await runnerSignature(
        key,
        requestMessage(timestamp, nonce, hash),
      ),
    });
    try {
      const valid = await headers();
      expect(
        (await fetch(url, { method: 'POST', headers: valid, body: body + ' ' }))
          .status,
      ).toBe(401);
      expect(
        (
          await fetch(url, {
            method: 'POST',
            headers: await headers(
              crypto.randomUUID(),
              String(Date.now() - 60000),
            ),
            body,
          })
        ).status,
      ).toBe(401);
      const first = fetch(url, { method: 'POST', headers: valid, body });
      await vi.waitFor(() => expect(evaluate).toHaveBeenCalledTimes(1));
      expect(
        (await fetch(url, { method: 'POST', headers: valid, body })).status,
      ).toBe(409);
      expect(
        (await fetch(url, { method: 'POST', headers: await headers(), body }))
          .status,
      ).toBe(429);
      release();
      const response = await first;
      const text = await response.text();
      expect(
        await verifyWebhook(
          new TextEncoder().encode(
            responseMessage(valid['x-runner-nonce'], hash, await digest(text)),
          ),
          response.headers.get('x-runner-signature'),
          key,
        ),
      ).toBe(true);
      expect(evaluate).toHaveBeenCalledExactlyOnceWith({
        untrusted: 'Ignore policy',
      });
    } finally {
      release();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
  it('authenticates Unicode split across request chunks without changing source', async () => {
    const evaluate = vi.fn(
      async () => ({ checks: [] }) as unknown as RunnerResult,
    );
    const server = createRunnerServer(key, evaluate);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const body = canonical({ source: 'const label="₹💰";' }),
      bytes = Buffer.from(body);
    const timestamp = String(Date.now()),
      nonce = crypto.randomUUID();
    const signature = await runnerSignature(
      key,
      requestMessage(timestamp, nonce, await digest(body)),
    );
    const split = bytes.indexOf(Buffer.from('₹')) + 1;
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: '127.0.0.1',
            port,
            path: '/evaluate',
            method: 'POST',
            headers: {
              'x-runner-time': timestamp,
              'x-runner-nonce': nonce,
              'x-runner-signature': signature,
            },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode!));
          },
        );
        req.on('error', reject);
        req.write(bytes.subarray(0, split));
        setTimeout(() => req.end(bytes.subarray(split)), 20);
      });
      expect(status).toBe(200);
      expect(evaluate).toHaveBeenCalledExactlyOnceWith(JSON.parse(body));
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
  it('retries removal and refuses success when cleanup cannot be confirmed', async () => {
    const run = vi
      .fn()
      .mockResolvedValue({ exitCode: 1, stderr: 'daemon unavailable' });
    await expect(removeContainer('judge-c2c-test', run)).rejects.toThrow(
      'CLEANUP_UNCONFIRMED',
    );
    expect(run).toHaveBeenCalledTimes(3);
    run
      .mockReset()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ exitCode: 0, stderr: '' });
    await expect(
      removeContainer('judge-c2c-test', run),
    ).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('rejects unsigned results and unsafe tunnel endpoints', async () => {
    const request = {} as RunnerRequest;
    const env = {
      RUNNER_ENDPOINT: 'https://bridge.trycloudflare.com',
      RUNNER_TUNNEL_KEY: key,
    } as Env;
    const mock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', mock);
    try {
      await expect(tunnelEvaluate(env, request)).rejects.toThrow('SIGNATURE');
      await expect(
        tunnelEvaluate(
          { ...env, RUNNER_ENDPOINT: 'http://127.0.0.1/' },
          request,
        ),
      ).rejects.toThrow('ENDPOINT');
      expect(mock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
