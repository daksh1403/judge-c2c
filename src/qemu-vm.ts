import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { canonical, digest } from './domain';
import {
  runnerRequestSchema,
  validateRunnerResult,
  type RunnerRequest,
  type RunnerResult,
} from './runner';
import { RUNNER_VERSION } from './runner-policy';
import { acceptance, benchmark } from './runner-http';
import { redact } from './security';
export type VMImage = { disk: string; kernel: string; initrd: string };
export function vmArguments(
  image: VMImage,
  input: string,
  port: number,
  kvm: boolean,
  diagnostic = false,
) {
  return [
    '-nodefaults',
    '-no-reboot',
    '-display',
    'none',
    '-monitor',
    'none',
    '-machine',
    'q35',
    '-accel',
    kvm ? 'kvm' : 'tcg',
    '-m',
    '256',
    '-smp',
    '1',
    '-kernel',
    image.kernel,
    '-initrd',
    image.initrd,
    '-append',
    'root=/dev/vda ro console=ttyS0 ' +
      (diagnostic ? '' : 'quiet loglevel=0 ') +
      'init=/opt/judge/init.sh panic=1',
    '-drive',
    `file=${image.disk},format=raw,if=virtio,readonly=on`,
    '-serial',
    'stdio',
    '-fw_cfg',
    'name=opt/judge/job,file=' + input,
    '-nic',
    `user,model=virtio-net-pci,restrict=on,hostfwd=tcp:127.0.0.1:${port}-:9000`,
    '-sandbox',
    'on,obsolete=deny,elevateprivileges=deny,spawn=deny,resourcecontrol=deny',
  ];
}
export function guestInput(
  request: Pick<RunnerRequest, 'files' | 'policy'>,
  argv?: string[],
) {
  if (
    request.files.some(
      (f) =>
        f.path
          .split('/')
          .some((p) => !p || p === '.' || p === '..' || p === '.git') ||
        f.path.startsWith('/') ||
        /[\x00-\x1f\\]/.test(f.path),
    )
  )
    throw new Error('VM_SOURCE_INVALID');
  return {
    files: request.files,
    argv: argv ?? ['node', request.policy.entrypoint],
    mode: argv ? 'command' : 'service',
  };
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
export async function imageIdentity(image: VMImage) {
  const hashes: string[] = [];
  for (const path of [image.disk, image.kernel, image.initrd]) {
    // Streaming avoids loading an entire disk into the trusted host heap.
    const { createReadStream } = await import('node:fs');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    hashes.push(hash.digest('hex'));
  }
  return (
    'qemu-vm@sha256:' +
    (await digest(
      canonical({
        version: 'qemu-node-v1',
        disk: hashes[0],
        kernel: hashes[1],
        initrd: hashes[2],
      }),
    ))
  );
}
async function boot(
  image: VMImage,
  input: ReturnType<typeof guestInput>,
  budget: number,
  diagnostic = false,
) {
  const dir = await mkdtemp(join(tmpdir(), 'judge-vm-'));
  const path = join(dir, 'input.json'),
    port = await freePort();
  await writeFile(path, JSON.stringify(input), { mode: 0o600 });
  const kvm = await access('/dev/kvm', 6).then(
    () => true,
    () => false,
  );
  const started = Date.now();
  const child = spawn(
    'prlimit',
    [
      '--cpu=120',
      '--',
      'qemu-system-x86_64',
      ...vmArguments(image, path, port, kvm, diagnostic),
    ],
    {
      env: { PATH: process.env.PATH },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let trace = '',
    stderrTrace = '';
  let partial = '',
    bytes = 0,
    closed = false;
  let resolveReady!: (v: any) => void, rejectReady!: (e: Error) => void;
  const ready = new Promise<any>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const closedPromise = new Promise<void>((resolve) =>
    child.once('close', () => {
      closed = true;
      rejectReady(new Error('VM_TERMINATED'));
      resolve();
    }),
  );
  const timer = setTimeout(
    () => {
      rejectReady(new Error('VM_TIMEOUT'));
      child.kill('SIGKILL');
    },
    Math.max(1, Math.min(120000, budget)),
  );
  child.once('error', () => {
    rejectReady(new Error('VM_START_FAILED'));
    clearTimeout(timer);
  });
  child.stderr.on('data', (data) => {
    if (diagnostic) stderrTrace = (stderrTrace + data.toString()).slice(-16000);
    bytes += data.length;
    if (bytes > 64000) {
      rejectReady(new Error('VM_OUTPUT_LIMIT'));
      child.kill('SIGKILL');
    }
  });
  child.stdout.on('data', (data) => {
    if (diagnostic) trace = (trace + data.toString()).slice(-16000);
    bytes += data.length;
    if (bytes > 64000) {
      rejectReady(new Error('VM_OUTPUT_LIMIT'));
      child.kill('SIGKILL');
      return;
    }
    partial += data.toString();
    let end;
    while ((end = partial.indexOf('\n')) >= 0) {
      const line = partial.slice(0, end).trim();
      partial = partial.slice(end + 1);
      if (!line.startsWith('JUDGE_VM:')) continue;
      try {
        const value = JSON.parse(line.slice(9));
        if (value.error || value.overflow)
          rejectReady(new Error('VM_COMMAND_UNAVAILABLE'));
        else if (
          input.mode === 'service'
            ? value.ready === true
            : Number.isInteger(value.exitCode)
        )
          resolveReady(value);
      } catch {
        rejectReady(new Error('VM_PROTOCOL_INVALID'));
      }
    }
  });
  const stop = async () => {
    clearTimeout(timer);
    if (!closed) child.kill('SIGKILL');
    await closedPromise;
    if (diagnostic)
      console.error(
        JSON.stringify({
          event: 'synthetic_vm_trace',
          trace: redact(trace),
          stderr: redact(stderrTrace),
        }),
      );
    await rm(dir, { recursive: true, force: true });
  };
  try {
    const result = await ready;
    return { result, port, started, stop };
  } catch (error) {
    if (diagnostic)
      console.error(
        JSON.stringify({
          event: 'synthetic_vm_boot_failure',
          trace: redact(trace),
          stderr: redact(stderrTrace),
        }),
      );
    await stop();
    throw error;
  }
}
export async function evaluateVM(
  raw: unknown,
  image: VMImage,
  diagnostic = false,
): Promise<RunnerResult> {
  const request = runnerRequestSchema.parse(raw);
  const identity = await imageIdentity(image);
  if (identity !== request.policy.image) throw new Error('VM_IMAGE_MISMATCH');
  const requestHash = await digest(canonical(request));
  const startedAt = new Date().toISOString(),
    deadline = Date.now() + request.timeoutSeconds * 1000;
  const checks: RunnerResult['checks'] = [];
  const missing = (
    id: string,
    kind: RunnerResult['checks'][number]['kind'],
    detail: string,
  ) => ({
    id,
    kind,
    status: 'UNVERIFIED' as const,
    exitCode: null,
    durationMs: 0,
    stdout: '',
    stderr: '',
    detail,
  });
  let runtime = 'unavailable';
  // Prepared offline dependency profiles need separate image provisioning. Fail closed.
  if (request.policy.dependencies)
    checks.push(
      missing(
        'dependency-preparation',
        'dependency',
        'Offline dependency preparation is unsupported by this VM profile.',
      ),
    );
  const implemented = request.files.some(
    (f) => f.path === request.policy.entrypoint,
  );
  let guest: Awaited<ReturnType<typeof boot>> | undefined;
  try {
    if (implemented && !request.policy.dependencies) {
      guest = await boot(
        image,
        guestInput(request),
        deadline - Date.now(),
        diagnostic,
      );
      runtime = guest.result.runtime;
    }
    const port = guest?.port;
    const transport = {
      fetch: (url: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(url)).pathname;
        return fetch(`http://127.0.0.1:${port}${path}`, {
          ...init,
          redirect: 'manual',
        });
      },
    } as Pick<Fetcher, 'fetch'>;
    for (const test of request.policy.cases)
      checks.push(
        request.policy.dependencies
          ? missing(
              test.id,
              'acceptance',
              'Required dependency environment unavailable.',
            )
          : await acceptance(transport, test, implemented, deadline),
      );
    for (const spec of request.policy.benchmarks ?? [])
      checks.push(
        request.policy.dependencies
          ? missing(
              spec.id,
              'benchmark',
              'Required dependency environment unavailable.',
            )
          : await benchmark(transport, spec, implemented, deadline),
      );
  } catch (error) {
    if (diagnostic)
      console.error(
        JSON.stringify({
          event: 'synthetic_vm_acceptance_failure',
          code: error instanceof Error ? error.message : 'VM_FAILURE',
        }),
      );
    for (const spec of [
      ...request.policy.cases,
      ...(request.policy.benchmarks ?? []),
    ])
      if (!checks.some((c) => c.id === spec.id))
        checks.push(
          missing(
            spec.id,
            request.policy.cases.some((c) => c.id === spec.id)
              ? 'acceptance'
              : 'benchmark',
            'Guest unavailable; functional behavior is unverified.',
          ),
        );
  } finally {
    if (guest) await guest.stop();
  }
  for (const command of request.policy.commands) {
    const started = Date.now();
    let commandGuest: Awaited<ReturnType<typeof boot>> | undefined;
    try {
      if (request.policy.dependencies || Date.now() >= deadline)
        throw Error('UNAVAILABLE');
      commandGuest = await boot(
        image,
        guestInput(request, command.argv),
        deadline - Date.now(),
        diagnostic,
      );
      runtime = commandGuest.result.runtime;
      const result = commandGuest.result;
      checks.push({
        id: command.id,
        kind: command.kind,
        status: result.exitCode === 0 ? 'PASS' : 'FAIL',
        exitCode: result.exitCode,
        durationMs: Date.now() - started,
        stdout: redact(result.stdout ?? ''),
        stderr: redact(result.stderr ?? ''),
        detail:
          'Supplemental repository command executed in a fresh QEMU guest; does not establish functional acceptance.',
      });
    } catch {
      checks.push(
        missing(
          command.id,
          command.kind,
          'Guest command unavailable or overall execution deadline exhausted.',
        ),
      );
    } finally {
      if (commandGuest) await commandGuest.stop();
    }
  }
  return validateRunnerResult(
    {
      requestHash,
      commit: request.commit,
      contractHash: request.contractHash,
      version: RUNNER_VERSION,
      image: identity,
      runtime,
      startedAt,
      finishedAt: new Date().toISOString(),
      checks,
    },
    request,
    requestHash,
  );
}
