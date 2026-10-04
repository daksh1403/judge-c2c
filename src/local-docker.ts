import { spawn } from 'node:child_process';
import {
  runnerRequestSchema,
  type RunnerRequest,
  type RunnerResult,
} from './runner';
import { canonical, digest } from './domain';
import { RUNNER_VERSION } from './runner-policy';
import { acceptance, benchmark } from './runner-http';
import { redact } from './security';
import {
  DEPENDENCY_PREPARE,
  dependencyUnavailable,
  validateDependencyInputs,
} from './dependency-preparation';
const INITIALIZE = `let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{const fs=require('node:fs'),p=require('node:path');for(const f of JSON.parse(s)){const target='/work/'+f.path;fs.mkdirSync(p.dirname(target),{recursive:true});fs.writeFileSync(target,f.text,{mode:0o644});}console.log(process.version);});`;
// Trusted probe runs as a different UID, using read-only prepared Node, with no repository imports.
const PROBE = `let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',async()=>{try{const t=JSON.parse(s);const r=await fetch('http://127.0.0.1:9000'+t.path,{method:t.method,headers:{'content-type':'application/json'},body:t.body,redirect:'manual',signal:AbortSignal.timeout(2000)});let n=0,b=[];for await(const c of r.body){n+=c.length;if(n>16000)throw Error('limit');b.push(Buffer.from(c));}console.log(JSON.stringify({status:r.status,body:Buffer.concat(b).toString('base64')}));}catch{process.exitCode=1;}});`;
const TOOLS = `console.log(JSON.stringify({node:process.version,npm:require('/usr/local/lib/node_modules/npm/package.json').version}));`;
// Kernel-owned cgroup counters; no guest log or participant import is trusted.
const RESOURCES = `const fs=require('node:fs'),read=p=>fs.readFileSync('/sys/fs/cgroup/'+p,'utf8');console.log(JSON.stringify({cpuUsageUsec:Number(read('cpu.stat').match(/^usage_usec (\\d+)$/m)[1]),memoryBytes:Number(read('memory.current')),pids:Number(read('pids.current'))}));`;
export function containerArguments(name: string, image: string) {
  return [
    'create',
    '--name',
    name,
    '--label',
    'judge-c2c.local-runner=1',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges=true',
    '--pids-limit',
    '64',
    '--memory',
    '256m',
    '--memory-swap',
    '256m',
    '--cpus',
    '0.5',
    '--ulimit',
    'nofile=128:128',
    '--ulimit',
    'fsize=16777216:16777216',
    '--user',
    '65534:65534',
    '--tmpfs',
    '/work:rw,nosuid,nodev,size=64m,uid=65534,gid=65534,mode=0755',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777',
    '--workdir',
    '/work',
    '--log-driver',
    'none',
    image,
    'sleep',
    // Independent lifetime bound survives runner SIGKILL and lost JS timers.
    '120',
  ];
}
export async function docker(
  argv: string[],
  input?: string,
  timeout = 10000,
  limit = 8192,
) {
  return new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
  }>((resolve, reject) => {
    const started = Date.now();
    const process = spawn('docker', argv, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: globalThis.process.env.PATH,
        HOME: globalThis.process.env.HOME,
        DOCKER_HOST: globalThis.process.env.DOCKER_HOST,
        DOCKER_CONTEXT: globalThis.process.env.DOCKER_CONTEXT,
      },
    });
    let stdout = '',
      stderr = '',
      size = 0,
      failed = false;
    const fail = (e: Error) => {
      if (failed) return;
      failed = true;
      process.kill('SIGKILL');
      reject(e);
    };
    const timer = setTimeout(() => fail(new Error('DOCKER_TIMEOUT')), timeout);
    process.once('error', fail);
    const append = (where: 'stdout' | 'stderr', b: Buffer) => {
      size += b.length;
      if (size > limit) fail(new Error('DOCKER_OUTPUT_LIMIT'));
      else if (where === 'stdout') stdout += b.toString();
      else stderr += b.toString();
    };
    process.stdout.on('data', (b) => append('stdout', b));
    process.stderr.on('data', (b) => append('stderr', b));
    process.stdin.on('error', () => {});
    process.stdin.end(input);
    process.once('close', (code) => {
      clearTimeout(timer);
      if (!failed)
        resolve({
          stdout: redact(stdout),
          stderr: redact(stderr),
          exitCode: code ?? -1,
          durationMs: Date.now() - started,
        });
    });
  });
}
const activeContainers = new Set<string>();
export async function removeContainer(name: string, run = docker) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await run(['rm', '--force', name], undefined, 10000);
      if (
        result.exitCode === 0 ||
        result.stderr.includes('No such container')
      ) {
        activeContainers.delete(name);
        return;
      }
    } catch {
      /* Retain identity and retry; never accept an unconfirmed cleanup. */
    }
  }
  throw new Error('DOCKER_CLEANUP_UNCONFIRMED');
}
export async function cleanupDocker() {
  const results = await Promise.allSettled(
    [...activeContainers].map((name) => removeContainer(name)),
  );
  if (results.some((r) => r.status === 'rejected'))
    throw new Error('DOCKER_CLEANUP_UNCONFIRMED');
}
export async function reapOrphanContainers(run = docker) {
  const result = await run([
    'ps',
    '--all',
    '--quiet',
    '--no-trunc',
    '--filter',
    'label=judge-c2c.local-runner=1',
  ]);
  if (result.exitCode !== 0) throw new Error('DOCKER_ORPHAN_DISCOVERY_FAILED');
  const ids = result.stdout.trim().split(/\s+/).filter(Boolean);
  if (ids.some((id) => !/^[a-f0-9]{64}$/.test(id)))
    throw new Error('DOCKER_ORPHAN_ID_INVALID');
  for (const id of ids) await removeContainer(id, run);
}
export async function evaluateDocker(
  raw: unknown,
  image: string,
): Promise<RunnerResult> {
  if (activeContainers.size) await cleanupDocker();
  const request: RunnerRequest = runnerRequestSchema.parse(raw);
  if (
    request.policy.image !== 'docker-local@' + image ||
    !/^sha256:[a-f0-9]{64}$/.test(image)
  )
    throw new Error('DOCKER_IMAGE_MISMATCH');
  if (request.timeoutSeconds > 80) throw new Error('DOCKER_DEADLINE_LIMIT');
  const paths = new Set(request.files.map((f) => f.path));
  if (
    paths.size !== request.files.length ||
    request.files.some((f) =>
      f.path.split('/').some((s) => s === '.' || s === '.git' || s === ''),
    ) ||
    Buffer.byteLength(canonical(request.files)) > 850000
  )
    throw new Error('DOCKER_SOURCE_INVALID');
  const startedAt = new Date().toISOString(),
    deadline = Date.now() + request.timeoutSeconds * 1000;
  let runtime = 'unavailable';
  const checks: RunnerResult['checks'] = [];
  const metrics: NonNullable<RunnerResult['metrics']> = { resources: [] };
  const active = activeContainers;
  const cleanup = removeContainer;
  const timer = setTimeout(() => {
    for (const name of active) void cleanup(name).catch(() => {});
  }, request.timeoutSeconds * 1000);
  const remaining = () => Math.max(1, Math.min(10000, deadline - Date.now()));
  const sampleResources = async (name: string, scope: string) => {
    if (Date.now() >= deadline || metrics.resources.length >= 9) return;
    try {
      const result = await docker(
        [
          'exec',
          '--user',
          '65533:65533',
          '--workdir',
          '/opt/judge',
          name,
          'node',
          '-e',
          RESOURCES,
        ],
        undefined,
        Math.min(1000, remaining()),
      );
      if (result.exitCode !== 0) return;
      const value = JSON.parse(result.stdout);
      if (
        ['cpuUsageUsec', 'memoryBytes', 'pids'].some(
          (key) =>
            !Number.isSafeInteger(value[key]) ||
            value[key] < 0 ||
            value[key] > 1e12,
        ) ||
        value.pids > 100000
      )
        return;
      metrics.resources.push({
        scope,
        sampledAt: new Date().toISOString(),
        cpuUsageUsec: value.cpuUsageUsec,
        memoryBytes: value.memoryBytes,
        pids: value.pids,
      });
    } catch {
      /* Optional observation unavailable: never substitute limits. */
    }
  };
  const prepare = async () => {
    const preparingAt = Date.now();
    if (Date.now() >= deadline) throw new Error('DOCKER_DEADLINE');
    const name = 'judge-c2c-' + crypto.randomUUID();
    active.add(name);
    const created = await docker(
      containerArguments(name, image),
      undefined,
      remaining(),
    );
    if (created.exitCode !== 0) throw new Error('DOCKER_CREATE_FAILED');
    const started = await docker(['start', name], undefined, remaining());
    if (started.exitCode !== 0) throw new Error('DOCKER_START_FAILED');
    const initialized = await docker(
      ['exec', '-i', name, 'node', '-e', INITIALIZE],
      canonical(request.files),
      remaining(),
    );
    if (initialized.exitCode !== 0)
      throw new Error('DOCKER_PREPARATION_FAILED');
    runtime = initialized.stdout.trim();
    metrics.startupMs ??= Date.now() - preparingAt;
    if (!metrics.tools) {
      try {
        const tools = await docker(
          [
            'exec',
            '--user',
            '65533:65533',
            '--workdir',
            '/opt/judge',
            name,
            'node',
            '-e',
            TOOLS,
          ],
          undefined,
          remaining(),
        );
        const versions = JSON.parse(tools.stdout);
        if (
          tools.exitCode === 0 &&
          /^v\d+\.\d+\.\d+$/.test(versions.node) &&
          /^\d+\.\d+\.\d+$/.test(versions.npm)
        )
          metrics.tools = versions;
      } catch {
        /* Tool observation unavailable. */
      }
    }
    if (request.policy.dependencies) {
      const installed = await docker(
        [
          'exec',
          '-i',
          '--workdir',
          '/opt/judge',
          name,
          'node',
          '-e',
          DEPENDENCY_PREPARE,
          request.policy.dependencies.npmVersion,
        ],
        undefined,
        remaining(),
      );
      if (!checks.some((c) => c.id === 'dependency-preparation'))
        checks.push({
          ...installed,
          id: 'dependency-preparation',
          kind: 'dependency',
          status: installed.exitCode === 0 ? 'PASS' : 'FAIL',
          detail: `Offline npm@${request.policy.dependencies.npmVersion} ci with scripts disabled; immutable image cache ${image}; frozen lock SHA-256 ${request.policy.dependencies.lockHash}. Setup reuse only; all benchmark timings are fresh.`,
        });
      if (installed.exitCode !== 0)
        throw new Error('DEPENDENCY_PREPARATION_FAILED');
      runtime =
        initialized.stdout.trim() +
        '; npm@' +
        request.policy.dependencies.npmVersion +
        '; offline-image-cache';
    }
    return name;
  };
  try {
    await validateDependencyInputs(request);
    const name = await prepare();
    // Do not attach guest logs to the trusted assertion channel.
    const server = await docker(
      [
        'exec',
        '--detach',
        '--env',
        'PORT=9000',
        '--env',
        'HOST=0.0.0.0',
        '--env',
        'NODE_OPTIONS=--max-old-space-size=128',
        name,
        'node',
        './' + request.policy.entrypoint,
      ],
      undefined,
      remaining(),
    );
    if (server.exitCode !== 0) throw new Error('DOCKER_SERVICE_FAILED');
    const transport = {
      fetch: async (_url: RequestInfo | URL, options?: RequestInit) => {
        const path = new URL(String(_url)).pathname;
        const result = await docker(
          [
            'exec',
            '--user',
            '65533:65533',
            '--workdir',
            '/opt/judge',
            '-i',
            name,
            'node',
            '-e',
            PROBE,
          ],
          canonical({ path, method: options?.method, body: options?.body }),
          Math.min(3000, remaining()),
          24000,
        );
        if (result.exitCode !== 0) throw new Error('DOCKER_HTTP_UNAVAILABLE');
        const parsed = JSON.parse(result.stdout);
        if (!Number.isInteger(parsed.status) || typeof parsed.body !== 'string')
          throw new Error('DOCKER_PROBE_INVALID');
        return new Response(Buffer.from(parsed.body, 'base64'), {
          status: parsed.status,
        });
      },
    };
    for (const test of request.policy.cases)
      checks.push(
        await acceptance(
          transport as Pick<Fetcher, 'fetch'>,
          test,
          paths.has(request.policy.entrypoint),
          deadline,
        ),
      );
    for (const spec of request.policy.benchmarks ?? [])
      checks.push(
        await benchmark(
          transport as Pick<Fetcher, 'fetch'>,
          spec,
          paths.has(request.policy.entrypoint),
          deadline,
        ),
      );
    await sampleResources(name, 'service');
    await cleanup(name);
    // Two fresh guests at a time. No check shares participant-mutated files,
    // processes, or caches; result order remains the frozen policy order.
    const runCommand = async (
      command: RunnerRequest['policy']['commands'][number],
    ) => {
      let guest: string | undefined;
      try {
        guest = await prepare();
        const result = await docker(
          [
            'exec',
            '--env',
            'NODE_OPTIONS=--max-old-space-size=128',
            guest,
            ...command.argv,
          ],
          undefined,
          remaining(),
        );
        await sampleResources(guest, 'command:' + command.id);
        return {
          ...result,
          id: command.id,
          kind: command.kind,
          status: result.exitCode === 0 ? 'PASS' : 'FAIL',
          detail: `Configured ${command.kind} command ${result.exitCode === 0 ? 'passed' : 'failed'}.`,
        } satisfies RunnerResult['checks'][number];
      } catch (error) {
        return {
          id: command.id,
          kind: command.kind,
          status: 'UNVERIFIED',
          exitCode: null,
          durationMs: 0,
          stdout: '',
          stderr: '',
          detail:
            error instanceof Error && error.message.startsWith('DEPENDENCY_')
              ? 'Offline dependency preparation failed; command did not run.'
              : 'Command unavailable or exceeded resource/time/output limits.',
        } satisfies RunnerResult['checks'][number];
      } finally {
        if (guest) await cleanup(guest);
      }
    };
    for (let offset = 0; offset < request.policy.commands.length; offset += 2) {
      const results = await Promise.allSettled(
        request.policy.commands.slice(offset, offset + 2).map(runCommand),
      );
      for (const result of results) {
        if (result.status === 'rejected') throw result.reason;
        checks.push(result.value);
      }
    }
    return {
      requestHash: await digest(canonical(request)),
      commit: request.commit,
      contractHash: request.contractHash,
      version: RUNNER_VERSION,
      image: request.policy.image,
      runtime: runtime + '; docker-local-v1',
      startedAt,
      finishedAt: new Date().toISOString(),
      checks,
      metrics,
    };
  } catch (error) {
    const detail =
      error instanceof Error && error.message.startsWith('DEPENDENCY_')
        ? 'Offline dependency preparation failed or pinned lock/tool inputs were rejected. No dependent check ran.'
        : 'Isolated service preparation unavailable or exceeded resource/time/output limits.';
    checks.push(
      ...dependencyUnavailable(request, detail).filter(
        (c) => !checks.some((existing) => existing.id === c.id),
      ),
    );
    return {
      requestHash: await digest(canonical(request)),
      commit: request.commit,
      contractHash: request.contractHash,
      version: RUNNER_VERSION,
      image: request.policy.image,
      runtime: runtime + '; docker-local-v1',
      startedAt,
      finishedAt: new Date().toISOString(),
      checks,
      metrics,
    };
  } finally {
    clearTimeout(timer);
    await cleanupDocker();
  }
}
