import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const origin =
    process.env.REVIEW_URL ||
    'https://feat-evaluation-completeness-judge-c2c.dakshx.workers.dev',
  browser = await chromium.launch(),
  page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(origin + '/?organization=1');
  await page
    .getByLabel('Organizer access code or named console code')
    .fill((await readFile('.wrangler/judge-access.txt', 'utf8')).trim());
  await page.getByRole('button', { name: 'Unlock organization' }).click();
  await page.getByRole('heading', { name: 'Hackathon workflow' }).waitFor();
  const data = await (
    await page.request.get(
      origin + '/api/organization/manage/issues/1371407339/6',
    )
  ).json();
  if (!data.issue || !data.submissions?.length)
    throw Error('NO_CURRENT_RELATED_SUBMISSION_FIXTURE');
  await page.getByRole('button', { name: 'Issues', exact: true }).click();
  await page.getByLabel('Repository filter').selectOption('1371407339');
  await page.getByLabel('Source filter').selectOption(data.issue.source);
  const query = page.waitForResponse(
    (r) =>
      r.url().includes('/manage/issues?') &&
      new URL(r.url()).searchParams.get('source') === data.issue.source,
  );
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await query;
  await page
    .getByRole('button', {
      name: 'Daksh-Codebase/payment-engine #6 · ' + data.issue.title,
      exact: false,
    })
    .click();
  await page
    .getByRole('heading', { name: 'Related submissions', exact: true })
    .waitFor();
  const text = await page.locator('#workflow-detail').innerText();
  for (const s of data.submissions) {
    if (
      !text.includes('PR #' + s.pr_number) ||
      !text.includes(s.head_sha) ||
      !text.includes(s.evaluation_state || 'Not available for current head')
    )
      throw Error('MISSING_RELATED_SUBMISSION_' + s.pr_number);
  }
  const result = {
    at: new Date().toISOString(),
    mode: 'REAL_DEPLOYED_JUDGE_BROWSER_NO_MOCKS',
    origin,
    issue: 6,
    sourceFilter: data.issue.source,
    relatedSubmissions: data.submissions.map((s) => ({
      pr: s.pr_number,
      head: s.head_sha,
      evaluationState: s.evaluation_state,
    })),
    errors,
  };
  await writeFile(
    'docs/qa/current-issue-preview.json',
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({ relatedSubmissions: data.submissions.length, errors }),
  );
  if (errors.length) throw Error('ISSUE_VIEW_ERRORS');
} finally {
  await browser.close();
}
