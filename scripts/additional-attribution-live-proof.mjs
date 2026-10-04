import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const source = JSON.parse(
  await readFile('.wrangler/cache-proof-fixtures.json', 'utf8'),
);
const origin = process.env.REVIEW_URL || source.origin;
const repositoryId = source.repositoryId;
const hash = (text) => createHash('sha256').update(text).digest('hex');
const gh = (...args) =>
  JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));
const checkpoint = '.wrangler/additional-attribution-fixture.json';
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
if (!login.ok) throw Error('AUTH_' + login.status);
const cookie = login.headers.get('set-cookie').split(';')[0];
async function call(path, body) {
  const response = await fetch(origin + '/api/organization/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin, cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  return { status: response.status, value };
}
async function required(path, body) {
  const result = await call(path, body);
  if (result.status >= 400)
    throw Error(
      'HTTP_' + result.status + '_' + path + '_' + result.value.error,
    );
  return result.value;
}
async function ghWrite(path, body) {
  await writeFile('.wrangler/attribution-request.json', JSON.stringify(body));
  return gh(
    'api',
    '--method',
    'POST',
    path,
    '--input',
    '.wrangler/attribution-request.json',
  );
}
async function waitRun(head) {
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const sub = await required(
      `manage/submissions/${repositoryId}/${fixture.pr.number}`,
    );
    const id = sub.submission.latest_run_id;
    if (id) {
      const run = await required('evaluations/' + id);
      if (run.head_sha === head && run.state === 'COMPLETED') return run;
      if (run.head_sha === head && ['FAILED', 'SUPERSEDED'].includes(run.state))
        throw Error('RUN_' + run.state + '_' + run.failure_code);
      console.log(
        JSON.stringify({
          event: 'attribution-wait',
          runId: id,
          state: run.state,
        }),
      );
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw Error('RUN_DEADLINE');
}
const decision = (reason) => ({
  decision: 'RECOGNIZED',
  reason,
  requestId: randomUUID(),
  expectedPreviousSequence: null,
});
const output = {
  at: new Date().toISOString(),
  origin,
  mode: 'LIVE_ISOLATED_NOT_SCORED_FUNCTIONAL_ATTRIBUTION',
  synthetic: true,
  records: [],
};
try {
  if (!fixture) {
    const originals = [];
    for (const pr of [8, 9, 11, 13, 14]) {
      const sub = await required(`manage/submissions/${repositoryId}/${pr}`);
      const run = await required('evaluations/' + sub.submission.latest_run_id);
      originals.push({
        pr,
        runId: run.id,
        snapshotHash: hash(run.contract_snapshot),
      });
    }
    const issue = await ghWrite(`repos/${source.repository}/issues`, {
      title: 'Synthetic NOT_SCORED review QA: functional diff attribution',
      body: 'Isolated review fixture for optional functional contribution attribution and stale/regression rejection. NOT_SCORED. No real participant score, hackathon completion, or final credit is requested.',
    });
    fixture = {
      origin,
      repositoryId,
      repository: source.repository,
      issue: issue.number,
      issueUrl: issue.html_url,
      baseline: source.baseline,
      head: source.head,
      teamId: source.teamId,
      originals,
    };
    await save();
  }
  if (fixture.origin !== origin) throw Error('FIXTURE_ORIGIN_MISMATCH');
  if (!fixture.contractHash) {
    const contract = structuredClone(source.contract);
    contract.issueNumbers = [fixture.issue];
    contract.challengeVersion = 'synthetic-attribution-v1';
    contract.evaluationVersion = 'synthetic-attribution-v1';
    contract.additionalCategories = [
      ...new Set([...contract.additionalCategories, 'feature']),
    ];
    contract.requirements.find((r) => r.id === 'bounded-retry').mandatory =
      false;
    const result = await required('manage/challenges', {
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
    fixture.contractHash = result.contractHash;
    fixture.contract = contract;
    await save();
  }
  if (!fixture.assignmentId) {
    fixture.assignmentId = (
      await required('manage/assignments', {
        teamId: fixture.teamId,
        repositoryId,
        issueNumber: fixture.issue,
      })
    ).id;
    await save();
  }
  if (!fixture.pr) {
    const branch = 'qa/attribution-proof-' + fixture.issue;
    await ghWrite(`repos/${fixture.repository}/git/refs`, {
      ref: 'refs/heads/' + branch,
      sha: fixture.head,
    });
    const native = gh('api', `repos/${fixture.repository}`);
    const pr = await ghWrite(`repos/${fixture.repository}/pulls`, {
      title: 'Synthetic NOT_SCORED functional attribution and denial proof',
      head: branch,
      base: native.default_branch,
      body: `References #${fixture.issue}\n\nIsolated review-only fixture, no real participant score/completion/final credit. Optional bounded retry is judged against the unchanged reference baseline.`,
    });
    fixture.pr = { number: pr.number, url: pr.html_url, branch };
    await save();
  }
  if (!fixture.positiveRunId) {
    await required(
      `manage/submissions/${repositoryId}/${fixture.pr.number}/sync`,
      {},
    );
    const run = await waitRun(fixture.head);
    fixture.positiveRunId = run.id;
    await save();
  }
  const positive = await required('evaluations/' + fixture.positiveRunId);
  const evidence =
    typeof positive.evidence === 'string'
      ? JSON.parse(positive.evidence)
      : positive.evidence;
  const objective = evidence.filter(
    (e) => e.criterionId === 'retry-bounded' && e.kind === 'execution',
  );
  if (
    !objective.some((e) => e.baselineStatus === 'FAIL' && e.status === 'PASS')
  )
    throw Error('LIVE_OPTIONAL_DELTA_ABSENT');
  const context =
    typeof positive.context === 'string'
      ? JSON.parse(positive.context)
      : positive.context;
  if (!context.files.some((f) => f.filename === 'server.mjs'))
    throw Error('DIFF_PATH_ABSENT');
  const input = {
    category: 'feature',
    title: 'Synthetic bounded retry optional functional improvement',
    description:
      'Isolated NOT_SCORED fixture: bounded attempts improve the frozen baseline with objective guest execution and a changed server.mjs diff.',
    paths: ['server.mjs'],
    evidenceIds: objective.filter((e) => e.status === 'PASS').map((e) => e.id),
    criterionIds: ['retry-bounded'],
  };
  if (!fixture.candidate) {
    fixture.candidate = await required(
      `evaluations/${positive.id}/contributions`,
      input,
    );
    await save();
  }
  if (fixture.candidate.verificationStatus !== 'VERIFIED')
    throw Error('CANDIDATE_NOT_VERIFIED');
  if (!fixture.recognition) {
    fixture.recognition = await required(
      `contributions/${fixture.candidate.id}/decisions`,
      decision(
        'Synthetic review fixture only: inspected the changed server.mjs retry loop, exact frozen baseline/head and optional bounded-attempt check. Baseline fails; reference head passes. This is useful bounded retry behavior and no mandatory payment regression is present. Recognition proves the organizer workflow and awards no score/completion/final credit.',
      ),
    );
    await save();
  }
  if (!fixture.staleCandidate) {
    fixture.staleCandidate = await required(
      `evaluations/${positive.id}/contributions`,
      { ...input, title: 'Synthetic pending candidate for stale-head denial' },
    );
    await save();
  }
  if (!fixture.regressedHead) {
    const native = gh(
      'api',
      `repos/${fixture.repository}/git/commits/${fixture.head}`,
    );
    const file = gh(
      'api',
      `repos/${fixture.repository}/contents/server.mjs?ref=${fixture.head}`,
    );
    const text = Buffer.from(file.content, 'base64').toString('utf8');
    const target =
      "if (req.method === 'GET' && url.pathname === '/health') return respond(res, 200, { ok: true });";
    if (!text.includes(target))
      throw Error('REGRESSION_FIXTURE_SOURCE_MISMATCH');
    const changed = text.replace(
      target,
      target.replace('{ ok: true }', '{ ok: false }'),
    );
    const blob = await ghWrite(`repos/${fixture.repository}/git/blobs`, {
      content: changed,
      encoding: 'utf-8',
    });
    const tree = await ghWrite(`repos/${fixture.repository}/git/trees`, {
      base_tree: native.tree.sha,
      tree: [
        { path: 'server.mjs', mode: '100644', type: 'blob', sha: blob.sha },
      ],
    });
    const commit = await ghWrite(`repos/${fixture.repository}/git/commits`, {
      message:
        'Synthetic isolated QA: health regression for recognition denial',
      tree: tree.sha,
      parents: [fixture.head],
    });
    fixture.regressedHead = commit.sha;
    await save();
    await writeFile(
      '.wrangler/attribution-request.json',
      JSON.stringify({ sha: commit.sha, force: false }),
    );
    gh(
      'api',
      '--method',
      'PATCH',
      `repos/${fixture.repository}/git/refs/heads/${fixture.pr.branch}`,
      '--input',
      '.wrangler/attribution-request.json',
    );
  }
  if (!fixture.negativeRunId) {
    await required(
      `manage/submissions/${repositoryId}/${fixture.pr.number}/sync`,
      {},
    );
    const run = await waitRun(fixture.regressedHead);
    fixture.negativeRunId = run.id;
    await save();
  }
  const stale = await call(
    `contributions/${fixture.staleCandidate.id}/decisions`,
    decision(
      'Synthetic denial probe: this candidate belongs to the superseded reference head and must remain unrecognized after the isolated fixture branch advances.',
    ),
  );
  if (stale.status !== 409)
    throw Error('STALE_RECOGNITION_NOT_DENIED_' + stale.status);
  const negative = await required('evaluations/' + fixture.negativeRunId);
  const negativeEvidence =
    typeof negative.evidence === 'string'
      ? JSON.parse(negative.evidence)
      : negative.evidence;
  if (
    !negativeEvidence.some(
      (e) =>
        e.criterionId === 'health-preserved' &&
        e.baselineStatus === 'PASS' &&
        e.status === 'FAIL',
    )
  )
    throw Error('HEALTH_REGRESSION_NOT_OBSERVED');
  const negativeObjective = negativeEvidence.filter(
    (e) =>
      e.criterionId === 'retry-bounded' &&
      e.kind === 'execution' &&
      e.status === 'PASS',
  );
  if (!fixture.regressionCandidate) {
    fixture.regressionCandidate = await required(
      `evaluations/${negative.id}/contributions`,
      {
        ...input,
        title: 'Synthetic candidate for mandatory regression denial',
        evidenceIds: negativeObjective.map((e) => e.id),
      },
    );
    await save();
  }
  const regression = await call(
    `contributions/${fixture.regressionCandidate.id}/decisions`,
    decision(
      'Synthetic denial probe: the optional bounded retry still passes, but mandatory health has regressed from the baseline and recognition must be denied.',
    ),
  );
  if (regression.status !== 409)
    throw Error('REGRESSION_RECOGNITION_NOT_DENIED_' + regression.status);
  const originals = await Promise.all(
    fixture.originals.map(async (row) => {
      const run = await required('evaluations/' + row.runId);
      return {
        ...row,
        unchanged: row.snapshotHash === hash(run.contract_snapshot),
      };
    }),
  );
  if (originals.some((r) => !r.unchanged))
    throw Error('ORIGINAL_CONTRACT_CHANGED');
  const finalPositive = await required('evaluations/' + positive.id);
  const finalNegative = await required('evaluations/' + negative.id);
  output.fixture = fixture;
  output.records = [
    { label: 'positive', run: finalPositive },
    { label: 'mandatory-regression', run: finalNegative },
  ];
  output.denials = { stale, regression };
  output.originalContracts = originals;
  output.assertions = {
    baselineFailHeadPass: true,
    functionalCandidateVerified: true,
    explicitOrganizerRecognition: true,
    staleDenied: true,
    regressionDenied: true,
    originalContractsPreserved: true,
  };
  output.boundaries = [
    'Separate synthetic NOT_SCORED contract intentionally declares bounded retry optional; original challenge contracts remain mandatory and unchanged.',
    'Recognition is an organizer additional-contribution decision only; no competition completion, score or final credit was created.',
    'The recognized historical candidate is preserved; fixture branch now retains a deliberate health regression and denied candidates.',
  ];
} catch (error) {
  output.blocker = String(error.message);
  output.fixture = fixture;
  throw error;
} finally {
  await writeFile(
    'docs/qa/additional-attribution-live-evidence.json',
    JSON.stringify(output, null, 2) + '\n',
  );
}
console.log(
  JSON.stringify({
    issue: fixture.issue,
    pr: fixture.pr.number,
    positiveRun: fixture.positiveRunId,
    negativeRun: fixture.negativeRunId,
    assertions: output.assertions,
  }),
);
