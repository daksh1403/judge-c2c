import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin =
  process.env.REVIEW_URL ||
  'https://feat-frontend-polish-judge-c2c.dakshx.workers.dev';
const statePath = '.wrangler/frontend-public-proof-state.json';
await mkdir('docs/qa', { recursive: true });
const browser = await chromium.launch({ headless: true });
let storageState;
try {
  storageState = JSON.parse(await readFile(statePath, 'utf8'));
} catch {}
const context = await browser.newContext({ storageState });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const parse = (value) =>
  typeof value === 'string' ? JSON.parse(value) : value;
try {
  await page.goto(origin);
  await page
    .getByRole('heading', { name: 'Evaluate a real public PR', exact: true })
    .waitFor();
  const initial = await (
    await context.request.get(origin + '/api/overview')
  ).json();
  let run = initial.runs?.find(
    (item) =>
      item.request?.prUrl ===
      'https://github.com/Daksh-Codebase/payment-engine/pull/11',
  );
  if (!run || process.env.PUBLIC_PROOF_NEW_ATTEMPT === 'true') {
    await page
      .getByLabel('Public GitHub pull request URL')
      .fill('https://github.com/Daksh-Codebase/payment-engine/pull/11');
    await page
      .getByLabel('What was the team expected to implement?')
      .fill(
        'Implement the issue #6 bounded payment retry behavior while preserving the existing payment API.',
      );
    await page
      .getByText('Baseline and objective assertions (optional)', {
        exact: true,
      })
      .click();
    await page
      .getByLabel('Frozen baseline commit SHA')
      .fill('65cb717281eaa2aced69dfaa68ac06c6d540ce2a');
    await page
      .getByLabel('Protected paths (one per line)')
      .fill('.github/workflows\ntests');
    const submitted = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/preview/evaluations') &&
        response.request().method() === 'POST',
    );
    await page
      .getByRole('button', { name: 'Evaluate PR', exact: true })
      .click();
    const response = await submitted;
    assert.equal(response.status(), 202);
    const result = await response.json();
    run = { id: result.runId };
  }
  await context.storageState({ path: statePath });
  await page.goto(origin + '/?run=' + run.id);
  for (let attempt = 0; attempt < 80; attempt++) {
    const response = await context.request.get(
      origin + '/api/evaluations/' + run.id,
    );
    assert.equal(response.status(), 200);
    run = await response.json();
    if (['COMPLETED', 'FAILED'].includes(run.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  await page.reload();
  await page
    .getByRole('heading', { name: 'Requirements', exact: true })
    .waitFor();
  const evidence = parse(run.evidence) || [];
  const report = parse(run.report);
  const contract = parse(run.contract_snapshot);
  const reviewContext = parse(run.context);
  const text = await page.locator('#content').innerText();
  const functional =
    contract?.requirements
      .flatMap((item) => item.criteria)
      .filter((item) => item.kind === 'functional') || [];
  if (run.state === 'COMPLETED') {
    assert.ok(functional.length > 0);
    assert.ok(
      functional.every(
        (item) =>
          report?.assessments?.find((result) => result.criterionId === item.id)
            ?.status === 'UNVERIFIED',
      ),
    );
    assert.ok(
      evidence
        .filter((item) => item.kind === 'execution')
        .every((item) => item.status === 'UNVERIFIED'),
    );
    assert.equal((run.execution || []).length, 0);
    assert.equal(run.ai_status, 'NOT_RUN');
    assert.equal(reviewContext.environment, 'public-github-api-no-execution');
    assert.ok(
      Object.keys(reviewContext).every((key) =>
        [
          'files',
          'sources',
          'risk',
          'environment',
          'toolVersion',
          'evidenceStage',
        ].includes(key),
      ),
    );
    assert.ok(
      !report.aiTrace,
      'Public review must not claim an AI reviewer trace',
    );
    assert.ok(
      !reviewContext?.executionResults &&
        !reviewContext?.runner &&
        !reviewContext?.trustedChecks,
    );
  }
  assert.ok(!text.includes('[object Object]'));
  assert.equal(errors.length, 0);
  const regressions = page.locator('.panel').filter({
    has: page.getByRole('heading', { name: 'Regressions', exact: true }),
  });
  const regressionScopeTruthful = (await regressions.innerText()).includes(
    'Regression safety remains UNVERIFIED',
  );
  await page.screenshot({
    path: 'docs/qa/current-native-preview-public.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: /All submissions/ }).click();
  await page
    .getByRole('heading', { name: 'Competition metrics', exact: true })
    .waitFor();
  const overview = await (
    await context.request.get(origin + '/api/overview')
  ).json();
  const displayedNewest = await page
    .locator('#rows [data-run]')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.run));
  const newest = [...overview.runs]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((item) => item.id);
  assert.deepEqual(displayedNewest, newest);
  await page.getByLabel('Sort submissions').selectOption('oldest');
  assert.deepEqual(
    await page
      .locator('#rows [data-run]')
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.run)),
    [...newest].reverse(),
  );
  const result = {
    mode: 'ACTUAL_DEPLOYED_BROWSER_NO_MOCKS',
    at: new Date().toISOString(),
    origin,
    role: 'public-review-session',
    run: {
      id: run.id,
      state: run.state,
      prUrl: run.request.prUrl,
      baseline: run.baseline_sha,
      head: run.head_sha,
      aiStatus: run.ai_status,
      failureCode: run.failure_code,
      timeline: run.timeline,
    },
    scope:
      'One real GitHub PR submitted in an isolated public review session; no runner or scoring decisions. Retrieval may fail before evidence capture.',
    evidence: {
      count: evidence.length,
      functionalCriterionCount: functional.length,
      aiReviewRun: false,
      functionalCriteriaUnverified: run.state === 'COMPLETED' ? true : null,
      executionRecordCount: 0,
      contextKeys: Object.keys(reviewContext || {}),
      privilegedExecutionAbsent: reviewContext ? true : null,
    },
    limitations:
      run.state === 'COMPLETED'
        ? [
            'Source-only public review does not verify runtime behavior or represent scored hackathon judging.',
          ]
        : [
            'GitHub rejected unauthenticated public metadata retrieval before contract capture: ' +
              run.failure_code,
            'Successful public review, criterion grounding and AI context could not be verified.',
          ],
    browser: {
      errors,
      structuredObservationsRendered: report?.solution_approach
        ? !text.includes('[object Object]')
        : null,
      regressionScopeTruthful,
      sortingVerified: overview.runs.length > 1,
      displayedRunCount: overview.runs.length,
      teamCountsUnavailable: (
        await page.locator('.metrics-grid').innerText()
      ).includes('Unavailable'),
    },
  };
  await writeFile(
    'docs/qa/current-native-preview-public.json',
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify(result));
} finally {
  await context.close();
  await browser.close();
}
