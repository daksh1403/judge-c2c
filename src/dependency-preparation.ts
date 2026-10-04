import { digest } from './domain';
import type { RunnerRequest, RunnerResult } from './runner';

/** Validate data only in the control plane. No package code is imported here. */
export async function validateDependencyInputs(request: RunnerRequest) {
  const policy = request.policy.dependencies;
  if (!policy) return;
  const source = (path: string) =>
    request.files.find((f) => f.path === path)?.text;
  const lockText = source('package-lock.json'),
    manifestText = source('package.json');
  if (
    !lockText ||
    !manifestText ||
    (await digest(lockText)) !== policy.lockHash
  )
    throw new Error('DEPENDENCY_LOCK_MISMATCH');
  const manifest = JSON.parse(manifestText),
    lock = JSON.parse(lockText);
  if (
    manifest.packageManager !== `npm@${policy.npmVersion}` ||
    lock.lockfileVersion !== 3 ||
    !lock.packages ||
    Array.isArray(lock.packages)
  )
    throw new Error('DEPENDENCY_INPUT_UNSUPPORTED');
  for (const [path, value] of Object.entries(lock.packages)) {
    if (path === '') continue;
    const pkg = value as Record<string, unknown>;
    if (
      !path.startsWith('node_modules/') ||
      path.split('/').some((s) => s === '..' || s === '.') ||
      pkg.link ||
      typeof pkg.version !== 'string' ||
      typeof pkg.resolved !== 'string' ||
      !/^https:\/\/registry\.npmjs\.org\/[^?#]+\.tgz$/.test(pkg.resolved) ||
      typeof pkg.integrity !== 'string' ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(pkg.integrity)
    )
      throw new Error('DEPENDENCY_INPUT_UNSUPPORTED');
  }
}

// This trusted launcher runs only inside the bounded, network-free guest.
// Copy the immutable catalogue into a per-guest writable cache: npm never writes
// into a cache shared with other attempts. No participant .npmrc is honored.
export const DEPENDENCY_PREPARE = `const fs=require('node:fs'),cp=require('node:child_process');if(require('/usr/local/lib/node_modules/npm/package.json').version!==process.argv[1])throw Error('DEPENDENCY_TOOL_MISMATCH');fs.rmSync('/work/.npmrc',{force:true});fs.writeFileSync('/tmp/judge-empty-user','');fs.writeFileSync('/tmp/judge-empty-global','');fs.cpSync('/opt/judge/npm-cache','/tmp/judge-npm-cache',{recursive:true});const r=cp.spawnSync('/usr/local/bin/npm',['ci','--offline','--ignore-scripts','--no-audit','--no-fund','--cache=/tmp/judge-npm-cache','--userconfig=/tmp/judge-empty-user','--globalconfig=/tmp/judge-empty-global','--registry=https://registry.npmjs.org/'],{cwd:'/work',stdio:'inherit',env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/tmp',NODE_OPTIONS:'--max-old-space-size=128',npm_config_ignore_scripts:'true',npm_config_offline:'true'}});process.exit(r.status??1);`;

export function dependencyUnavailable(
  request: RunnerRequest,
  detail: string,
): RunnerResult['checks'] {
  return [
    ...(request.policy.dependencies
      ? [{ id: 'dependency-preparation', kind: 'dependency' as const }]
      : []),
    ...request.policy.cases.map((c) => ({ ...c, kind: 'acceptance' as const })),
    ...(request.policy.benchmarks ?? []).map((c) => ({
      ...c,
      kind: 'benchmark' as const,
    })),
    ...request.policy.commands,
  ].map(({ id, kind }) => ({
    id,
    kind,
    status: 'UNVERIFIED',
    exitCode: null,
    durationMs: 0,
    stdout: '',
    stderr: '',
    detail,
  }));
}
