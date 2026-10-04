import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const origin =
  process.env.REVIEW_URL ||
  'https://feat-evaluation-completeness-judge-c2c.dakshx.workers.dev';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(origin + '/?organization=1');
  await page
    .getByLabel('Organizer access code or named console code')
    .fill((await readFile('.wrangler/judge-access.txt', 'utf8')).trim());
  await page.getByRole('button', { name: 'Unlock organization' }).click();
  await page.getByRole('heading', { name: 'Hackathon workflow' }).waitFor();
  const records = [];
  for (const pr of [8, 9, 11]) {
    const proof = JSON.parse(
      await readFile(`docs/qa/current-payment-grounding-${pr}.json`, 'utf8'),
    );
    await page.goto(origin + '/?organization=1&evaluation=' + proof.runId);
    await page
      .getByRole('heading', { name: 'Authoritative requirements', exact: true })
      .waitFor();
    const text = await page.locator('#content').innerText();
    const sections = [
      'Authoritative requirements',
      'Needs attention',
      'Evidence ledger',
      'Baseline and head check comparison',
      'Isolated execution',
      'Protected artifacts',
      'Evaluation history',
      'Additional contributions',
    ];
    for (const s of sections)
      if (!text.includes(s)) throw Error('MISSING_SECTION_' + s);
    if (!text.includes(proof.head) || !text.includes('UNVERIFIED'))
      throw Error('MISSING_HEAD_OR_UNVERIFIED');
    if (pr === 8 && !text.includes('PARTIAL')) throw Error('MISSING_PARTIAL');
    if (pr === 9 && !text.includes('FAIL'))
      throw Error('MISSING_PROTECTED_FAILURE');
    const evidenceLinks = await page.locator('a.evidence-link').count();
    if (!evidenceLinks) throw Error('NO_EVIDENCE_LINKS');
    records.push({
      pr,
      runId: proof.runId,
      head: proof.head,
      sections,
      evidenceLinks,
      unverifiedQualitativeVisible: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileFits = await page.evaluate(
    () => document.documentElement.scrollWidth <= innerWidth,
  );
  const result = {
    at: new Date().toISOString(),
    mode: 'REAL_DEPLOYED_BROWSER_NO_MOCKS',
    origin,
    role: 'judge',
    records,
    mobileFits,
    errors,
  };
  await writeFile(
    'docs/qa/current-judge-preview.json',
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify({ records: records.length, mobileFits, errors }));
  if (errors.length || !mobileFits) throw Error('PREVIEW_BROWSER_FAILURE');
} finally {
  await browser.close();
}
