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
  const initialResponse = page.waitForResponse(
    (response) =>
      response.url() === origin + '/api/overview' &&
      response.request().method() === 'GET',
  );
  await page.goto(origin);
  await page
    .getByRole('heading', { name: 'Evaluate a real public PR', exact: true })
    .waitFor();
  const initial = await (await initialResponse).json();
  let run = initial.runs?.find(
    (item) =>
      item.request?.prUrl ===
      'https://github.com/Daksh-Codebase/payment-engine/pull/11',
  );
  assert.ok(
    run,
    'Existing isolated public attempt is required; this capture creates no new runs',
  );
  const detailResponse = page.waitForResponse(
    (response) =>
      response.url() === origin + '/api/evaluations/' + run.id &&
      response.request().method() === 'GET',
  );
  await page.goto(origin + '/?run=' + run.id);
  run = await (await detailResponse).json();
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
  assert.equal(run.state, 'FAILED');
  assert.equal(run.failure_code, 'GITHUB_HTTP_403');
  assert.equal(evidence.length, 0);
  assert.equal(contract, null);
  assert.equal(report, null);
  assert.equal(reviewContext, null);
  await page
    .getByText('FAILED EVALUATION · GITHUB_HTTP_403', { exact: true })
    .waitFor();
  assert.equal(
    await page.locator('#mode-label').innerText(),
    'PUBLIC PR REVIEW',
  );
  assert.ok(
    (await page.locator('#demo-banner').innerText()).includes(
      'Read-only GitHub',
    ),
  );
  assert.ok(
    (await page.locator('.summary-assessment').innerText()).includes(
      'GITHUB_HTTP_403',
    ),
  );
  assert.ok(!text.includes('[object Object]'));
  assert.equal(errors.length, 0);
  const regressions = page.locator('.panel').filter({
    has: page.getByRole('heading', { name: 'Regressions', exact: true }),
  });
  const regressionScopeTruthful = (await regressions.innerText()).includes(
    'Regression safety remains UNVERIFIED',
  );
  assert.ok(regressionScopeTruthful);
  await page.screenshot({
    path: 'docs/qa/current-native-preview-public.png',
    fullPage: true,
  });
  const overviewResponse = page.waitForResponse(
    (response) =>
      response.url() === origin + '/api/overview' &&
      response.request().method() === 'GET',
  );
  await page.getByRole('button', { name: /All submissions/ }).click();
  await page
    .getByRole('heading', { name: 'Competition metrics', exact: true })
    .waitFor();
  const overview = await (await overviewResponse).json();
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
  const teamCountsUnavailable =
    (
      await page
        .locator('.metric-item')
        .filter({ hasText: 'Submitted teams' })
        .innerText()
    ).includes('Unavailable') &&
    (
      await page
        .locator('.metric-item')
        .filter({ hasText: 'Not submitted' })
        .innerText()
    ).includes('Unavailable');
  assert.ok(teamCountsUnavailable);
  await page.screenshot({
    path: 'docs/qa/current-native-preview-public-overview.png',
    fullPage: true,
  });
  const result = {
    mode: 'ACTUAL_DEPLOYED_BROWSER_NO_MOCKS',
    capture:
      'Native UI network responses only; no direct API requests, interception, or new attempts',
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
      directLinkModeVerified: true,
      failureSummaryVerified: true,
      structuredObservationsRendered: report?.solution_approach
        ? !text.includes('[object Object]')
        : null,
      regressionScopeTruthful,
      sortingVerified: overview.runs.length > 1,
      displayedRunCount: overview.runs.length,
      teamCountsUnavailable,
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
