import { DurableObject } from 'cloudflare:workers';
import { canonical, digest, pathSchema } from './domain';
import {
  runnerRequestSchema,
  type RunnerRequest,
  type RunnerResult,
} from './runner';
import { RUNNER_VERSION } from './runner-policy';
import { redact } from './security';
import { acceptance } from './runner-http';
import type { Env } from './env';
const MAX_LOG = 8192;
const INITIALIZE = `const fs=require('node:fs'); let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{const files=JSON.parse(s);fs.mkdirSync('/work',{recursive:true});fs.chownSync('/work',65534,65534);for(const f of files){const path='/work/'+f.path;fs.mkdirSync(require('node:path').dirname(path),{recursive:true});fs.writeFileSync(path,f.text,{mode:0o644});fs.chownSync(path,65534,65534);}console.log(process.version);});`;
function isolatedArgv(argv: string[]) {
  return [
    'prlimit',
    '--nproc=64',
    '--fsize=16777216',
    '--cpu=20',
    '--',
    'setpriv',
    '--reuid=65534',
    '--regid=65534',
    '--clear-groups',
    '--no-new-privs',
    '--bounding-set=-all',
    '--',
    ...argv,
  ];
}
function stop(process: ExecProcess) {
  try {
    process.kill(9);
  } catch {
    // The process may already have exited; whole-guest cleanup still follows.
  }
}
async function readLog(
  stream: ReadableStream | null,
  process: ExecProcess,
): Promise<string> {
  if (!stream) return '';
  const reader = stream.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const b = value as Uint8Array;
      size += b.length;
      if (size > MAX_LOG) {
        stop(process);
        throw new Error('RUNNER_OUTPUT_LIMIT');
      }
      chunks.push(b);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const b of chunks) {
    result.set(b, offset);
    offset += b.length;
  }
  return redact(new TextDecoder().decode(result));
}
async function captured(
  container: Container,
  argv: string[],
  timeoutMs: number,
  stdin?: string,
) {
  const started = Date.now();
  const process = await container.exec(argv, {
    cwd: '/work',
    env: {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: '/tmp',
      NODE_OPTIONS: '--max-old-space-size=128',
    },
    stdin: stdin === undefined ? undefined : 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const timer = setTimeout(() => stop(process), timeoutMs);
  try {
    const stdout = readLog(process.stdout, process),
      stderr = readLog(process.stderr, process);
    if (stdin !== undefined) {
      const writer = process.stdin!.getWriter();
      await writer.write(new TextEncoder().encode(stdin));
      await writer.close();
    }
    const [out, err, code] = await Promise.all([
      stdout,
      stderr,
      process.exitCode,
    ]);
    return {
      stdout: out,
      stderr: err,
      exitCode: code,
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
    stop(process);
  }
}
export class IsolatedRunner extends DurableObject<Env> {
  async alarm() {
    if (this.ctx.container) await this.ctx.container.destroy();
  }
  async evaluate(raw: RunnerRequest): Promise<RunnerResult> {
    if (this.env.RUNNER_ENABLED !== 'true') throw new Error('RUNNER_DISABLED');
    const request = runnerRequestSchema.parse(raw),
      container = this.ctx.container;
    if (!container) throw new Error('RUNNER_NOT_BOUND');
    if (
      request.policy.image === 'UNCONFIGURED' ||
      request.policy.image !== this.env.RUNNER_IMAGE_URI
    )
      throw new Error('RUNNER_IMAGE_NOT_PINNED');
    if (await this.ctx.storage.get('used'))
      throw new Error('RUNNER_INSTANCE_ALREADY_USED');
    await this.ctx.storage.put('used', true);
    const paths = new Set<string>();
    let bytes = 0;
    for (const file of request.files) {
      pathSchema.parse(file.path);
      if (file.path.startsWith('.git/') || paths.has(file.path))
        throw new Error('RUNNER_UNSAFE_PATH');
      paths.add(file.path);
      bytes += new TextEncoder().encode(file.text).length;
    }
    if (bytes > 750000) throw new Error('RUNNER_SNAPSHOT_LIMIT');
    const startedAt = new Date().toISOString(),
      deadline = Date.now() + request.timeoutSeconds * 1000,
      checks: RunnerResult['checks'] = [];
    const current = async () => {
      if (!this.env.ORG_DB) return true;
      const row = await this.env.ORG_DB.prepare(
        'SELECT e.state,s.latest_run_id FROM evaluations e JOIN submissions s ON s.repository_id=e.repository_id AND s.pr_number=e.pr_number WHERE e.id=?',
      )
        .bind(request.runId)
        .first<{ state: string; latest_run_id: string }>();
      return (
        !!row && row.latest_run_id === request.runId && row.state === 'CHECKING'
      );
    };
    const remaining = () => Math.max(1, Math.min(10000, deadline - Date.now()));
    await this.ctx.storage.setAlarm(deadline);
    const timer = setTimeout(() => {
      void container.destroy().catch(() => {});
    }, request.timeoutSeconds * 1000);
    let runtime = 'unavailable';
    const prepare = async () => {
      if (Date.now() >= deadline) throw new Error('RUNNER_DEADLINE');
      if (!(await current())) throw new Error('RUNNER_SUPERSEDED');
      container.start({
        image: request.policy.image,
        entrypoint: ['sleep', 'infinity'],
        enableInternet: false,
        instance: 'lite',
        env: {},
      });
      await container.setInactivityTimeout(Math.max(1, deadline - Date.now()));
      const actual = await container.inspect();
      if (actual?.image !== request.policy.image)
        throw new Error('RUNNER_IMAGE_MISMATCH');
      const mkdir = await container.exec(['mkdir', '-p', '/work'], {
        signal: AbortSignal.timeout(remaining()),
      });
      await mkdir.exitCode;
      const initialized = await captured(
        container,
        ['node', '-e', INITIALIZE],
        remaining(),
        canonical(request.files),
      );
      if (initialized.exitCode !== 0)
        throw new Error('RUNNER_PREPARATION_FAILED');
      runtime = initialized.stdout.trim();
    };
    try {
      // Acceptance starts from the exact frozen tree before any participant test/build.
      await prepare();
      const service = await container.exec(
        isolatedArgv(['node', request.policy.entrypoint]),
        {
          cwd: '/work',
          env: {
            PATH: '/usr/local/bin:/usr/bin:/bin',
            HOME: '/tmp',
            NODE_OPTIONS: '--max-old-space-size=128',
            PORT: '9000',
            HOST: '0.0.0.0',
          },
          stdout: 'ignore',
          stderr: 'ignore',
          signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        },
      );
      try {
        const transport = container.getTcpPort(9000);
        for (const test of request.policy.cases)
          checks.push(
            await acceptance(
              transport,
              test,
              paths.has(request.policy.entrypoint),
              deadline,
            ),
          );
      } finally {
        stop(service);
        await container.destroy();
      }
      // Every supplemental command gets another clean guest and original source.
      // Detached children and filesystem edits are destroyed with that whole VM.
      for (const command of request.policy.commands) {
        if (Date.now() >= deadline) {
          checks.push({
            id: command.id,
            kind: command.kind,
            status: 'UNVERIFIED',
            exitCode: null,
            durationMs: 0,
            stdout: '',
            stderr: '',
            detail: 'Overall execution time budget exhausted.',
          });
          continue;
        }
        try {
          await prepare();
          const result = await captured(
            container,
            isolatedArgv(command.argv),
            remaining(),
          );
          checks.push({
            id: command.id,
            kind: command.kind,
            status: result.exitCode === 0 ? 'PASS' : 'FAIL',
            ...result,
            detail: `Configured ${command.kind} command ${result.exitCode === 0 ? 'passed' : 'failed'}.`,
          });
        } catch {
          checks.push({
            id: command.id,
            kind: command.kind,
            status: 'UNVERIFIED',
            exitCode: null,
            durationMs: 0,
            stdout: '',
            stderr: '',
            detail:
              'Command unavailable or exceeded resource/time/output limits.',
          });
        } finally {
          await container.destroy();
        }
      }
      return {
        requestHash: await digest(canonical(request)),
        commit: request.commit,
        contractHash: request.contractHash,
        version: RUNNER_VERSION,
        image: request.policy.image,
        runtime,
        startedAt,
        finishedAt: new Date().toISOString(),
        checks,
      };
    } finally {
      clearTimeout(timer);
      await container.destroy();
      await this.ctx.storage.deleteAlarm();
    }
  }
}
