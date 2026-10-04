import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin = process.env.REVIEW_URL || 'https://feat-frontend-polish-judge-c2c.dakshx.workers.dev';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const output = { at: new Date().toISOString(), origin, mode: 'REAL_FRONTEND_CLICKS_NO_MOCKS_NO_DIRECT_API_CALLS', evaluations: [], errors, boundary: 'Actual isolated deployed review frontend and real provider/runner evaluation records for the original GitHub PRs. One authenticated operator account, not a production hackathon or multiple independent participants.' };
try {
  await page.goto(origin + '/?organization=1');
  await page.locator('#organization-token').fill((await readFile('.wrangler/organization-access.txt', 'utf8')).trim());
  await page.locator('#organization-login').getByRole('button').click();
  await page.getByRole('heading', { name: 'Hackathon workflow' }).waitFor({ timeout: 20000 });
  await page.locator('#test-reviewer').waitFor();
  const checkResponse = page.waitForResponse(r => r.url().endsWith('/api/organization/reviewer-check') && r.request().method() === 'POST', { timeout: 180000 });
  await page.locator('#test-reviewer').click();
  const response = await checkResponse;
  const check = await response.json();
  output.reviewerButton = { http: response.status(), status: check.status, code: check.error ?? check.code, trace: check.trace, summary: check.summary };
  await page.locator('#test-reviewer:enabled').waitFor({ timeout: 20000 });
  output.reviewerButton.visibleMessage = await page.locator('#reviewer-status').innerText();
  await page.screenshot({ path: 'docs/qa/current-ai-reviewer-button.png', fullPage: true });
  assert.equal(response.status(), 200, 'Live AI reviewer button must succeed');
  assert.ok(['COMPLETED', 'NEEDS_REVIEW'].includes(check.status), 'Provider diagnostic must return a validated review');
  if (check.status === 'NEEDS_REVIEW') assert.equal(check.trace.requiresHumanAttention, true);
  for (const pr of [11, 8, 9]) {
    const stored = JSON.parse(await readFile(`docs/qa/current-payment-grounding-${pr}.json`, 'utf8'));
    const loaded = page.waitForResponse(r => r.url().endsWith('/api/organization/evaluations/' + stored.runId), { timeout: 20000 });
    await page.goto(origin + '/?organization=1&evaluation=' + stored.runId);
    let data = await (await loaded).json();
    if (process.env.FRONTEND_RETRY === '1' && data.reviewPolicyCurrent === false) {
      await page.locator('#retry-evaluation').waitFor();
      const retryResponse = page.waitForResponse(r => r.url().endsWith('/evaluations/' + stored.runId + '/retry') && r.request().method() === 'POST');
      await page.locator('#retry-evaluation').click();
      const retry = await retryResponse;
      assert.equal(retry.status(), 202);
      const next = await retry.json();
      console.log(JSON.stringify({ event: 'frontend-retry', pr, runId: next.runId }));
      const finished = await page.waitForResponse(async r => {
        if (!r.url().endsWith('/api/organization/evaluations/' + next.runId)) return false;
        const value = await r.json();
        return ['COMPLETED', 'FAILED', 'SUPERSEDED'].includes(value.state);
      }, { timeout: 300000 });
      data = await finished.json();
    }
    await page.getByText('Authoritative requirements', { exact: true }).waitFor();
    const text = await page.locator('body').innerText();
    const report = JSON.parse(data.report);
    assert.ok(['COMPLETED', 'NEEDS_REVIEW'].includes(data.ai_status));
    if (data.ai_status === 'NEEDS_REVIEW') assert.equal(report.aiTrace.requiresHumanAttention, true);
    assert.equal(report.aiTrace.policy, process.env.EXPECT_POLICY || 'requirements-and-approach-v14');
    assert.ok(text.includes('AI review: ' + data.ai_status));
    assert.ok(text.includes('UNVERIFIED'));
    assert.ok(text.includes('Evidence ledger'));
    assert.ok(text.includes('Needs attention'));
    const evidence = JSON.parse(data.evidence);
    const known = new Set(evidence.map(e => e.id));
    const observations = Object.entries(report.solution_approach).flatMap(([key, value]) => key === 'evidence' ? [] : Array.isArray(value) ? value : [value]);
    const cited = [...observations.flatMap(o => o.evidenceIds), ...report.assessments.flatMap(a => a.evidenceIds), ...report.findings.flatMap(f => f.evidenceIds)];
    const unknownCitations = cited.filter(id => !known.has(id));
    const unsupportedObserved = observations.filter(o => o.verification === 'OBSERVED' && !o.evidenceIds.some(id => evidence.some(e => e.id === id && e.status !== 'UNVERIFIED' && e.claim.trim() === o.text.trim())));
    const actual = Object.fromEntries(data.requirementResults.flatMap(r => r.criteria.map(c => [c.criterionId, c.status])));
    assert.equal(unsupportedObserved.length, 0);
    assert.equal(unknownCitations.length, 0);
    assert.ok(report.assessments.every(a => actual[a.criterionId] === a.status));
    const protectedEvidence = evidence.filter(e => e.kind === 'policy' && e.status === 'FAIL');
    if (pr === 9) {
      assert.ok(protectedEvidence.length > 0);
      assert.ok(text.includes('FAIL'));
    }
    const citation = page.locator('#engineering-review a[href^="#evidence-"]').first();
    if (await citation.count()) {
      const id = (await citation.getAttribute('href')).slice(1);
      await citation.click();
      assert.ok(await page.locator('[id="' + id + '"]').isVisible());
    }
    const rubric = report.engineeringReview.rubric;
    assert.ok(rubric.every(f => f.scope !== 'bounded-evidence-backed-analysis' || (f.status === 'UNVERIFIED' && f.needsReview)));
    output.evaluations.push({ pr, runId: data.id, state: data.state, ai: data.ai_status, provider: report.aiTrace.provider, model: report.aiTrace.model, policy: report.aiTrace.policy, publication: data.publication_status, objectiveStatuses: data.requirementResults.map(r => ({ id: r.requirementId, status: r.status })), unsupportedFacts: unsupportedObserved.length, unknownCitations: unknownCitations.length, policyFailures: protectedEvidence.length, humanAttentionVisible: text.includes('Needs attention'), evidenceCitationOpened: !!(await citation.count()) });
    await page.screenshot({ path: `docs/qa/current-ai-reviewer-pr${pr}.png`, fullPage: true });
  }
  assert.equal(errors.length, 0);
  output.status = 'PASS';
} catch (error) {
  output.status = 'FAIL';
  output.failure = error.message;
  throw error;
} finally {
  await writeFile('docs/qa/current-ai-reviewer-frontend.json', JSON.stringify(output, null, 2) + '\n');
  await browser.close();
}
console.log(JSON.stringify({ status: output.status, reviewerButton: output.reviewerButton?.status, evaluations: output.evaluations.map(e => ({ pr: e.pr, ai: e.ai, provider: e.provider })) }));
