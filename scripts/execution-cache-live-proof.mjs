import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const origin =
  process.env.REVIEW_URL ||
  'https://feat-evaluation-completeness-judge-c2c.dakshx.workers.dev';
const repositoryId = 1371407339;
const hash = (text) => createHash('sha256').update(text).digest('hex');
const gh = (...args) =>
  JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));
const checkpoint = '.wrangler/cache-proof-fixtures.json';
let fixture;
try {
  fixture = JSON.parse(await readFile(checkpoint, 'utf8'));
} catch {}
const save = () =>
  writeFile(checkpoint, JSON.stringify(fixture, null, 2) + '\n');
const login = await fetch(origin + '/api/organization/login', {
  method: 'POST',
  headers: { origin, 'content-type': 'application/json' },
  body: JSON.stringify({
    token: (await readFile('.wrangler/organization-access.txt', 'utf8')).trim(),
  }),
});
if (!login.ok) throw Error('CACHE_PROOF_AUTH_' + login.status);
const cookie = login.headers.get('set-cookie').split(';')[0];
async function call(path, body) {
  const response = await fetch(origin + '/api/organization/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin, cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok)
    throw Error(
      'CACHE_PROOF_HTTP_' +
        response.status +
        '_' +
        path +
        '_' +
        String(value.error ?? 'UNKNOWN'),
    );
  return value;
}
async function ghWrite(path, body) {
  await writeFile('.wrangler/cache-proof-request.json', JSON.stringify(body));
  return gh(
    'api',
    '--method',
    'POST',
    path,
    '--input',
    '.wrangler/cache-proof-request.json',
  );
}
async function waitExecution(pr) {
  const deadline = Date.now() + 300000;
  let last;
  while (Date.now() < deadline) {
    const submission = await call(`manage/submissions/${repositoryId}/${pr}`);
    const id = submission.submission.latest_run_id;
    if (id) {
      last = await call('evaluations/' + id);
      if ((last.execution ?? []).length === 2) return last;
      if (['FAILED', 'SUPERSEDED'].includes(last.state))
        throw Error(
          'CACHE_PROOF_RUN_' + last.state + '_' + (last.failure_code ?? ''),
        );
    }
    console.log(
      JSON.stringify({
        event: 'cache-proof-wait',
        pr,
        runId: id ?? null,
        state: last?.state ?? submission.submission.status,
      }),
    );
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw Error('CACHE_PROOF_EXECUTION_DEADLINE');
}
try {
  const sourceSubmission = await call(`manage/submissions/${repositoryId}/11`);
  const source = await call(
    'evaluations/' + sourceSubmission.submission.latest_run_id,
  );
  const originalContract = JSON.parse(source.contract_snapshot);
  const nativeRepo = gh('api', `repositories/${repositoryId}`);
  const originalPR = gh('api', `repos/${nativeRepo.full_name}/pulls/11`);
  if (
    originalPR.head.sha !== source.head_sha ||
    originalContract.repository.id !== repositoryId
  )
    throw Error('CACHE_PROOF_ORIGINAL_IDENTITY_CHANGED');
  if (!fixture) {
    const original = [];
    for (const pr of [8, 9, 11]) {
      const submission = await call(`manage/submissions/${repositoryId}/${pr}`);
      const run = await call(
        'evaluations/' + submission.submission.latest_run_id,
      );
      original.push({
        pr,
        runId: run.id,
        contractHash: run.contract_hash,
        snapshotHash: hash(run.contract_snapshot),
      });
    }
    const issue = await ghWrite(`repos/${nativeRepo.full_name}/issues`, {
      title:
        'Synthetic review QA: immutable baseline execution cache provenance',
      body: 'Isolated review validation fixture, NOT_SCORED. Replays the original immutable payment baseline and reference submission to verify exact-input cache reuse. No hackathon completion or additional credit is requested.',
    });
    fixture = {
      origin,
      repositoryId,
      repository: nativeRepo.full_name,
      issue: issue.number,
      issueUrl: issue.html_url,
      baseline: source.baseline_sha,
      head: source.head_sha,
      teamId: sourceSubmission.submission.team_id,
      original,
      prs: [],
    };
    await save();
  }
  if (
    fixture.origin !== origin ||
    fixture.head !== source.head_sha ||
    fixture.baseline !== source.baseline_sha
  )
    throw Error('CACHE_PROOF_CHECKPOINT_MISMATCH');
  if (!fixture.contractHash) {
    const contract = structuredClone(originalContract);
    contract.issueNumbers = [fixture.issue];
    contract.challengeVersion = 'synthetic-cache-proof-v1';
    contract.evaluationVersion = 'synthetic-cache-proof-v1';
    contract.execution.runner.cache = 'BASELINE';
    const registered = await call('manage/challenges', {
      repositoryId,
      issueNumber: fixture.issue,
      contract,
      ownership: 'EXCLUSIVE',
      claimable: false,
      capacity: 1,
      availability: 'AVAILABLE',
      eligibleTeams: [fixture.teamId],
      evaluationKind: 'NOT_SCORED',
    });
    fixture.contractHash = registered.contractHash;
    fixture.contract = contract;
    await save();
  }
  if (!fixture.assignmentId) {
    fixture.assignmentId = (
      await call('manage/assignments', {
        teamId: fixture.teamId,
        repositoryId,
        issueNumber: fixture.issue,
      })
    ).id;
    await save();
  }
  // Preserve runner capacity for the original payment replay before fixtures.
  const originalDeadline = Date.now() + 300000;
  while (Date.now() < originalDeadline) {
    const submission = await call(`manage/submissions/${repositoryId}/9`);
    const run = await call(
      'evaluations/' + submission.submission.latest_run_id,
    );
    if (['COMPLETED', 'FAILED', 'SUPERSEDED'].includes(run.state)) break;
    console.log(
      JSON.stringify({ event: 'await-original-pr9', state: run.state }),
    );
    await new Promise((r) => setTimeout(r, 4000));
  }
  const runs = [];
  for (let index = 0; index < 2; index++) {
    if (!fixture.prs[index]) {
      const branch = `qa/cache-proof-${fixture.issue}-${index + 1}`;
      await ghWrite(`repos/${fixture.repository}/git/refs`, {
        ref: 'refs/heads/' + branch,
        sha: fixture.head,
      });
      const pr = await ghWrite(`repos/${fixture.repository}/pulls`, {
        title: `Synthetic NOT_SCORED cache proof ${index === 0 ? 'MISS' : 'HIT'}`,
        head: branch,
        base: nativeRepo.default_branch,
        body: `References #${fixture.issue}\n\nIsolated review fixture at the exact original payment reference head. This tests baseline cache provenance only; no completion decision or final credit is requested.`,
      });
      fixture.prs.push({
        number: pr.number,
        url: pr.html_url,
        branch,
        head: pr.head.sha,
      });
      await save();
    }
    const pr = fixture.prs[index];
    const native = gh('api', `repos/${fixture.repository}/pulls/${pr.number}`);
    if (native.head.sha !== fixture.head)
      throw Error('CACHE_PROOF_FIXTURE_HEAD_CHANGED');
    await call(`manage/submissions/${repositoryId}/${pr.number}/sync`, {});
    runs.push(await waitExecution(pr.number));
  }
  const records = runs.map((run) => ({
    runId: run.id,
    pr: run.pr_number,
    stateAtCapture: run.state,
    contractHash: run.contract_hash,
    baseline: run.baseline_sha,
    head: run.head_sha,
    execution: run.execution.map((row) => ({
      id: row.id,
      commit: row.commit_sha,
      cacheStatus: row.cache_status,
      cacheKey: row.cache_key,
      requestHash: row.request_hash,
      resultHash: row.result_hash,
      originRunId: row.origin_run_id,
      originExecutionId: row.origin_execution_id,
      recordedAt: row.created_at,
      request: JSON.parse(row.request),
      result: JSON.parse(row.result),
    })),
  }));
  const baseline = records.map((run) =>
    run.execution.find((row) => row.commit === fixture.baseline),
  );
  const heads = records.map((run) =>
    run.execution.find((row) => row.commit === fixture.head),
  );
  const assertions = {
    baselineMissThenHit:
      baseline[0].cacheStatus === 'MISS' && baseline[1].cacheStatus === 'HIT',
    immutableOrigin:
      baseline[1].originRunId === records[0].runId &&
      baseline[1].originExecutionId === baseline[0].id,
    sameCacheIdentity: baseline[0].cacheKey === baseline[1].cacheKey,
    sameOriginalResult:
      baseline[0].resultHash === baseline[1].resultHash &&
      hash(JSON.stringify(baseline[0].result)) ===
        hash(JSON.stringify(baseline[1].result)),
    historicalTimingPreserved:
      baseline[0].result.startedAt === baseline[1].result.startedAt &&
      baseline[0].result.finishedAt === baseline[1].result.finishedAt,
    headNotReused:
      heads.every((row) => row.cacheStatus !== 'HIT') &&
      heads[0].id !== heads[1].id &&
      heads[0].requestHash !== heads[1].requestHash,
    headSeparateFromBaseline: heads.every(
      (row) => row.cacheKey !== baseline[0].cacheKey,
    ),
    originalSnapshotsUnchanged: true,
  };
  for (const original of fixture.original) {
    const current = await call('evaluations/' + original.runId);
    assertions.originalSnapshotsUnchanged &&=
      current.contract_hash === original.contractHash &&
      hash(current.contract_snapshot) === original.snapshotHash;
  }
  const evidence = {
    at: new Date().toISOString(),
    mode: 'REAL_DEPLOYED_REVIEW_SIGNED_DOCKER_CACHE',
    synthetic: true,
    scope:
      'Separate NOT_SCORED fixtures using actual original immutable payment baseline/head. Original contracts and completion decisions are unchanged. Cached timestamps are historical observations, not fresh execution timings.',
    fixture: { ...fixture, contract: undefined },
    assertions,
    records,
    benchmarkBoundary: {
      liveProfileHasBenchmarks:
        !!fixture.contract.execution.runner.benchmarks?.length,
      liveBenchmarkReuse:
        'UNVERIFIED: this original payment profile has no benchmarks.',
      separateRealDockerEvidence:
        'docs/qa/dependency-docker-evidence.json validates fresh benchmark measurements and rejects result reuse.',
    },
  };
  await writeFile(
    'docs/qa/execution-cache-live-evidence.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      fixtureIssue: fixture.issue,
      prs: fixture.prs.map((p) => p.number),
      runs: records.map((r) => r.runId),
      assertions,
    }),
  );
  if (Object.values(assertions).some((value) => value !== true))
    throw Error('CACHE_PROOF_ASSERTIONS_FAILED');
} catch (error) {
  await writeFile(
    'docs/qa/execution-cache-live-blocker.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        origin,
        fixture,
        code: error.message,
        scope:
          'No baseline reuse PASS is claimed without complete deployed assertions.',
      },
      null,
      2,
    ) + '\n',
  );
  throw error;
} finally {
  await call('logout', {});
}
