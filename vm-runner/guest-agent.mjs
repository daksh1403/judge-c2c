// Runs as guest root from the immutable image. Participant output never reaches
// the serial protocol directly; it is bounded, captured and encoded as data.
import { readFileSync, mkdirSync, writeFileSync, chownSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
const emit = (value) =>
  process.stdout.write('JUDGE_VM:' + JSON.stringify(value) + '\n');
try {
  const job = JSON.parse(
    readFileSync('/sys/firmware/qemu_fw_cfg/by_name/opt/judge/job/raw', 'utf8'),
  );
  if (
    !['service', 'command'].includes(job.mode) ||
    !Array.isArray(job.files) ||
    job.files.length > 100 ||
    !Array.isArray(job.argv) ||
    job.argv.length < 1 ||
    job.argv.length > 20
  )
    throw Error('INPUT_INVALID');
  let bytes = 0;
  for (const file of job.files) {
    if (
      typeof file.path !== 'string' ||
      file.path.startsWith('/') ||
      file.path.includes('..') ||
      /[\x00-\x1f\\]/.test(file.path) ||
      file.path.split('/').some((p) => !p || p === '.' || p === '.git') ||
      typeof file.text !== 'string' ||
      Buffer.byteLength(file.text) > 100000
    )
      throw Error('SOURCE_INVALID');
    bytes += Buffer.byteLength(file.text);
    if (bytes > 750000) throw Error('SOURCE_LIMIT');
    const path = '/work/' + file.path;
    mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
    writeFileSync(path, file.text, { mode: 0o644 });
    chownSync(path, 65534, 65534);
  }
  const child = spawn(
    '/usr/bin/prlimit',
    [
      '--nproc=64',
      '--fsize=16777216',
      '--cpu=20',
      '--',
      '/usr/bin/setpriv',
      '--reuid=65534',
      '--regid=65534',
      '--clear-groups',
      '--no-new-privs',
      '--bounding-set=-all',
      '--',
      ...job.argv,
    ],
    {
      cwd: '/work',
      env: {
        PATH: '/usr/local/bin:/usr/bin:/bin',
        HOME: '/tmp',
        NODE_OPTIONS: '--max-old-space-size=128',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '',
    stderr = '',
    size = 0,
    overflow = false;
  const append = (kind, data) => {
    size += data.length;
    if (size > 16384) {
      overflow = true;
      child.kill('SIGKILL');
    } else if (kind === 'stdout') stdout += data.toString();
    else stderr += data.toString();
  };
  child.stdout.on('data', (data) => append('stdout', data));
  child.stderr.on('data', (data) => append('stderr', data));
  child.on('error', () => emit({ error: 'COMMAND_UNAVAILABLE' }));
  child.on('spawn', () => {
    if (job.mode !== 'service') return;
    // A process spawn is not HTTP readiness. Only the trusted agent reports
    // readiness after the fixed guest port is listening; assertions stay on host.
    const deadline = Date.now() + 8000;
    const probe = () => {
      if (child.exitCode !== null || Date.now() >= deadline) return;
      const socket = createConnection({ host: '127.0.0.1', port: 9000 });
      let settled = false;
      const retry = () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        setTimeout(probe, 100).unref();
      };
      socket.setTimeout(200, retry);
      socket.once('error', retry);
      socket.once('connect', () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        emit({ ready: true, runtime: process.version });
      });
    };
    probe();
  });
  child.on('close', (code) =>
    emit({
      exitCode: code ?? -1,
      stdout: stdout.slice(0, 8192),
      stderr: stderr.slice(0, 8192),
      overflow,
      runtime: process.version,
    }),
  );
  setTimeout(() => {
    child.kill('SIGKILL');
    emit({ error: 'COMMAND_TIMEOUT' });
  }, 10000).unref();
} catch {
  emit({ error: 'GUEST_INITIALIZATION_FAILED' });
}
