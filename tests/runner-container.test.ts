import { describe, it, expect, vi } from 'vitest';
import { IsolatedRunner } from '../src/runner-container';
import { paymentRetryPolicy } from '../src/runner-policy';
import type { RunnerRequest } from '../src/runner';
import type { Env } from '../src/env';
const image = 'registry.cloudflare.com/account/runner@sha256:' + 'a'.repeat(64);
const request: RunnerRequest = {
  runId: 'a'.repeat(64),
  contractHash: 'b'.repeat(64),
  commit: 'c'.repeat(40),
  timeoutSeconds: 60,
  memoryMiB: 256,
  policy: { ...paymentRetryPolicy, image },
  files: [{ path: 'server.mjs', text: 'incorrect source at frozen commit' }],
};
function platform() {
  let files = new Map<string, string>(),
    spoof = false,
    running = false;
  const starts: ContainerStartupOptions[] = [],
    commands: string[][] = [];
  const destroy = vi.fn(async () => {
    files.clear();
    spoof = false;
    running = false;
  });
  const container = {
    get running() {
      return running;
    },
    start(options: ContainerStartupOptions) {
      running = true;
      starts.push(options);
    },
    destroy,
    inspect: async () => ({ image, labels: {} }),
    setInactivityTimeout: vi.fn(async () => {}),
    async exec(argv: string[]) {
      commands.push(argv);
      const initializer = argv[0] === 'node' && argv[1] === '-e';
      if (argv.includes('--test')) {
        files.set('server.mjs', 'fake passing source from malicious test');
        spoof = true;
      }
      return {
        stdin: initializer
          ? new WritableStream({
              write(chunk) {
                for (const file of JSON.parse(
                  new TextDecoder().decode(chunk),
                ) as { path: string; text: string }[])
                  files.set(file.path, file.text);
              },
            })
          : null,
        stdout: new ReadableStream({
          start(c) {
            if (initializer) c.enqueue(new TextEncoder().encode('v24.0.0\n'));
            c.close();
          },
        }),
        stderr: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        exitCode: Promise.resolve(0),
        kill: vi.fn(),
        pid: 10,
        isPty: false,
      } as unknown as ExecProcess;
    },
    getTcpPort() {
      return {
        fetch: async (_url: unknown, init: RequestInit) => {
          const payload = JSON.parse(String(init.body));
          if (spoof || files.get('server.mjs')?.includes('fake')) {
            const fixture = request.policy.cases.find(
              (c) => JSON.stringify(c.body) === JSON.stringify(payload),
            );
            return Response.json(fixture?.expectedBody ?? {});
          }
          return Response.json({ status: 'failed', attempts: 999 });
        },
      };
    },
  } as unknown as Container;
  const values = new Map();
  const storage = {
    get: async (k: string) => values.get(k),
    put: async (k: string, v: unknown) => {
      values.set(k, v);
    },
    setAlarm: vi.fn(async () => {}),
    deleteAlarm: vi.fn(async () => {}),
  };
  const runner = new IsolatedRunner(
    { container, storage } as unknown as DurableObjectState,
    { RUNNER_ENABLED: 'true', RUNNER_IMAGE_URI: image } as Env,
  );
  return { runner, starts, commands, destroy };
}
describe('microVM adapter boundary (mock platform, no code execution)', () => {
  it('malicious repository tests cannot rewrite acceptance source or leave a spoof server', async () => {
    const { runner, starts, commands, destroy } = platform();
    const result = await runner.evaluate(request);
    expect(
      result.checks
        .filter((c) => c.kind === 'acceptance')
        .every((c) => c.status === 'FAIL'),
    ).toBe(true);
    expect(result.checks.find((c) => c.id === 'repository-tests')!.status).toBe(
      'PASS',
    );
    expect(starts).toHaveLength(4);
    expect(
      starts.every(
        (s) =>
          s.enableInternet === false &&
          s.instance === 'lite' &&
          Object.keys(s.env ?? {}).length === 0,
      ),
    ).toBe(true);
    expect(
      commands
        .filter((a) => a[0] === 'prlimit')
        .every(
          (a) =>
            a.includes('--nproc=64') &&
            a.includes('--reuid=65534') &&
            a.includes('--no-new-privs'),
        ),
    ).toBe(true);
    expect(destroy.mock.calls.length).toBeGreaterThanOrEqual(4);
    await expect(runner.evaluate(request)).rejects.toThrow('ALREADY_USED');
  });
  it('requires opt-in and an immutable configured image before boot', async () => {
    const { runner, starts } = platform();
    await expect(
      runner.evaluate({
        ...request,
        policy: { ...request.policy, image: 'UNCONFIGURED' },
      }),
    ).rejects.toThrow('IMAGE_NOT_PINNED');
    expect(starts).toHaveLength(0);
    const disabled = new IsolatedRunner(
      {} as DurableObjectState,
      { RUNNER_ENABLED: 'false' } as Env,
    );
    await expect(disabled.evaluate(request)).rejects.toThrow('DISABLED');
  });
});
