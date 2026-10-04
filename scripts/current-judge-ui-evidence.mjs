import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const origin =
  'https://feat-evaluation-completeness-judge-c2c.dakshx.workers.dev';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
try {
  const response = await context.request.post(
    origin + '/api/organization/login',
    {
      headers: { origin },
      data: {
        token: (await readFile('.wrangler/judge-access.txt', 'utf8')).trim(),
      },
    },
  );
  if (response.status() !== 200)
    throw Error('Judge authentication failed: ' + response.status());
  const page = await context.newPage();
  await page.goto(origin + '/?organization=1');
  await page
    .getByRole('heading', { name: 'Hackathon workflow' })
    .waitFor({ timeout: 15000 });
  const home = await page.locator('body').innerText();
  await page.locator('[data-tab="issues"]').click();
  await page.locator('[data-query="source"]').selectOption('PARTICIPANT');
  const sourceRequest = page.waitForResponse(
    (r) =>
      r.url().includes('/manage/issues?') &&
      r.url().includes('source=PARTICIPANT'),
  );
  await page
    .locator('#workflow-query')
    .getByRole('button', { name: 'Search', exact: true })
    .click();
  const sourceData = await (await sourceRequest).json();
  const sourceFilterVerified = sourceData.issues.every(
    (issue) => issue.source === 'PARTICIPANT',
  );
  await page.locator('[data-query="source"]').selectOption('');
  const allRequest = page.waitForResponse(
    (r) => r.url().includes('/manage/issues?') && !r.url().includes('source='),
  );
  await page
    .locator('#workflow-query')
    .getByRole('button', { name: 'Search', exact: true })
    .click();
  await allRequest;
  let relatedPrRendered = false,
    evaluationStateRendered = false;
  for (const button of (
    await page.locator('[data-detail^="issues/"]').all()
  ).slice(0, 8)) {
    await button.click();
    await page
      .getByRole('heading', { name: 'Related submissions', exact: true })
      .waitFor();
    const text = await page.locator('#workflow-detail').innerText();
    if (text.includes('PR #')) {
      relatedPrRendered = true;
      evaluationStateRendered =
        text.includes('evaluation COMPLETED') ||
        text.includes('evaluation FAILED') ||
        text.includes('Not available for current head');
      break;
    }
  }

  const overviewResponse = await context.request.get(
    origin + '/api/organization/overview',
  );
  if (!overviewResponse.ok())
    throw Error('Overview unavailable ' + overviewResponse.status());
  const overview = await overviewResponse.json();
  const runs = overview.runs ?? [];
  const sorted = runs.every(
    (run, index) => !index || runs[index - 1].created_at >= run.created_at,
  );
  const candidates = runs
    .filter((run) => run.state === 'COMPLETED')
    .slice(0, 12);
  let selected;
  for (const run of candidates) {
    const response = await context.request.get(
      origin + '/api/organization/evaluations/' + run.id,
    );
    if (!response.ok()) continue;
    const detail = await response.json();
    if (detail.additionalContributions?.length || detail.execution?.length) {
      selected = detail;
      break;
    }
  }
  selected ??=
    candidates[0] &&
    (await (
      await context.request.get(
        origin + '/api/organization/evaluations/' + candidates[0].id,
      )
    ).json());
  if (!selected) throw Error('No completed deployed evaluation available');
  await page.goto(origin + '/?organization=1&evaluation=' + selected.id);
  await page
    .getByText('Authoritative requirements', { exact: true })
    .waitFor({ timeout: 20000 });
  const detailText = await page.locator('body').innerText();
  const report =
    typeof selected.report === 'string'
      ? JSON.parse(selected.report)
      : selected.report;
  const result = {
    mode: 'ACTUAL_DEPLOYED_BROWSER_NO_MOCKS',
    at: new Date().toISOString(),
    origin,
    role: 'judge',
    home: {
      rendered: home.includes('Follow the evidence'),
      latestTimeSorting: sorted,
      runCount: runs.length,
      sourceFilterVerified,
      relatedPrRendered,
      evaluationStateRendered,
    },
    evaluation: {
      id: selected.id,
      state: selected.state,
      historyWarning:
        detailText.includes('Historical') ||
        detailText.includes('historical') ||
        detailText.includes('Current submission'),
      artifactsRendered: detailText.toLowerCase().includes('artifact'),
      persistedArtifactCount: selected.artifacts?.length ?? 0,
      additionalWorkRendered:
        detailText.includes('Additional contributions') ||
        detailText.includes('additional contributions'),
      persistedContributionCount: selected.additionalContributions?.length ?? 0,
      reviewerTracePersisted: !!report?.aiTrace,
      reviewerVersion: report?.aiTrace?.policy ?? null,
      reviewerRoutingVersion: report?.aiTrace?.modelRouting?.version ?? null,
      decisionButtonsDisabled:
        (await page
          .locator('[data-contribution-decision="RECOGNIZED"]:enabled')
          .count()) === 0,
    },
  };
  let historyWarningVerified = false;
  for (const run of runs
    .filter((run) => run.state === 'COMPLETED')
    .slice(0, 20)) {
    const response = await context.request.get(
      origin + '/api/organization/evaluations/' + run.id,
    );
    if (!response.ok()) continue;
    const detail = await response.json();
    if (
      detail.currentSubmission &&
      detail.currentSubmission.latestRunId !== run.id
    ) {
      await page.goto(origin + '/?organization=1&evaluation=' + run.id);
      await page
        .getByText('Authoritative requirements', { exact: true })
        .waitFor();
      historyWarningVerified = await page
        .locator('.freshness.historical')
        .isVisible();
      break;
    }
  }
  result.evaluation.historyWarning = historyWarningVerified;
  await page.screenshot({
    path: 'docs/qa/current-native-preview-judge.png',
    fullPage: true,
  });
  await writeFile(
    'docs/qa/current-native-preview-judge.json',
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify(result));
  await context.request.post(origin + '/api/organization/logout', {
    headers: { origin },
    data: {},
  });
} finally {
  await context.close();
  await browser.close();
}
