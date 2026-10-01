import { test, expect } from '@playwright/test';
import { demoDetail, demoContract, demoRun } from '../../src/demo';
test('judges can filter submissions and follow criterion evidence', async ({
  page,
}) => {
  await page.route('**/api/overview', (route) =>
    route.fulfill({
      json: {
        demo: true,
        counts: {
          repositories: 1,
          teams: 1,
          openSubmissions: 1,
          active: 0,
          completed: 1,
          failed: 0,
          attention: 1,
        },
        runs: [demoRun],
      },
    }),
  );
  await page.route('**/api/evaluations/*', (route) =>
    route.fulfill({ json: demoDetail }),
  );
  await page.route('**/api/repositories', (route) =>
    route.fulfill({
      json: {
        repositories: [
          {
            full_name: demoRun.full_name,
            document: JSON.stringify(demoContract),
          },
        ],
      },
    }),
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Follow the evidence.' }),
  ).toBeVisible();
  await expect(
    page.getByText('All displayed evidence is synthetic.', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'hackathon/CampaignOS' }),
  ).toBeVisible();
  await page.getByRole('searchbox').fill('does-not-exist');
  await expect(
    page.getByText('No submissions match.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('searchbox').fill('');
  await page.getByRole('combobox').selectOption('COMPLETED');
  await page.getByRole('button', { name: 'hackathon/CampaignOS' }).click();
  await expect(
    page.getByRole('heading', { name: 'Assigned requirements' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Evidence ledger' }),
  ).toBeVisible();
  await expect(
    page
      .getByText(
        'Runtime scheduling behavior needs isolated execution evidence.',
        { exact: false },
      )
      .first(),
  ).toBeVisible();
  await page.getByRole('button', { name: '↗ criterion-docs-heading' }).click();
  await expect(page.locator('#e-criterion-docs-heading')).toBeInViewport();
  await page.getByRole('button', { name: 'All submissions' }).click();
  await page.getByRole('button', { name: 'Repositories' }).click();
  await expect(
    page.getByRole('heading', { name: 'Registered challenge repositories' }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test('review APIs reject privileged writes and expose security headers', async ({
  request,
}) => {
  const response = await request.get('/health');
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['content-security-policy']).toContain(
    "frame-ancestors 'none'",
  );
  expect((await response.json()).mode).toBe('public-pr-review');
  expect((await request.post('/api/contracts', { data: {} })).status()).toBe(
    403,
  );
  expect((await request.post('/webhooks/github', { data: {} })).status()).toBe(
    503,
  );
});
test('the workspace fits a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Submission activity' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});

test('a public PR can be submitted, polled and inspected without fabricated functional PASS', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const id = 'd'.repeat(64);
  await page.route('**/api/preview/evaluations', async (route) => {
    const body = route.request().postDataJSON();
    expect(body.prUrl).toBe('https://github.com/example/project/pull/12');
    expect(body.expectedBehavior).toBe(
      'The scheduler should persist future execution times.',
    );
    expect(body.sourceAssertion).toEqual({
      path: 'README.md',
      text: 'Scheduling',
    });
    await route.fulfill({ status: 202, json: { runId: id, status: 'queued' } });
  });
  let polls = 0;
  await page.route('**/api/evaluations/' + id, (route) => {
    const ready = ++polls > 1;
    const contract = {
      ...demoContract,
      department: 'Public PR review',
      repository: { id: 1, fullName: 'example/project' },
      issueNumbers: [],
      baselineSource: 'captured-pr-merge-base',
      prTitle: '<script>window.injection=true</script>',
      requirements: [
        {
          id: 'expectation',
          title: 'Expected behavior',
          mandatory: true,
          criteria: [
            {
              id: 'expected-behavior',
              description:
                'The scheduler should persist future execution times.',
              kind: 'functional',
              verification: { type: 'human' },
            },
          ],
        },
      ],
    };
    route.fulfill({
      json: {
        ...demoDetail,
        id,
        preview: true,
        full_name: 'example/project',
        pr_number: 12,
        state: ready ? 'COMPLETED' : 'FETCHING',
        contract_snapshot: ready ? JSON.stringify(contract) : null,
        evidence: ready
          ? JSON.stringify([
              {
                id: 'diff',
                kind: 'diff',
                status: 'PASS',
                claim: 'Frozen exact commits compared.',
              },
              {
                id: 'criterion-expected-behavior',
                kind: 'policy',
                status: 'UNVERIFIED',
                criterionId: 'expected-behavior',
                claim: 'Requires human verification.',
              },
            ])
          : null,
        report: ready
          ? JSON.stringify({
              summary: 'Runtime behavior requires verification.',
              assessments: [
                {
                  criterionId: 'expected-behavior',
                  status: 'UNVERIFIED',
                  explanation: 'Requires human verification.',
                  evidenceIds: ['criterion-expected-behavior'],
                },
              ],
              findings: [],
            })
          : null,
        request: {
          prUrl: 'https://github.com/example/project/pull/12',
          expectedBehavior:
            'The scheduler should persist future execution times.',
        },
        context: ready
          ? JSON.stringify({
              files: [
                {
                  filename: 'README.md',
                  status: 'modified',
                  additions: 1,
                  deletions: 0,
                  patch:
                    '+ Scheduling\n+ <script>window.injection=true</script>',
                },
              ],
            })
          : null,
        ai_status: 'NOT_RUN',
        publication_status: 'READ_ONLY_GITHUB',
      },
    });
  });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Evaluate a real public PR' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Use prepared public example' })
    .click();
  await expect(page.getByLabel('Public GitHub pull request URL')).toHaveValue(
    'https://github.com/octocat/Hello-World/pull/1',
  );
  await page
    .getByText('Baseline and objective assertions (optional)', { exact: true })
    .click();
  await page
    .getByLabel('Public GitHub pull request URL')
    .fill('https://github.com/example/project/pull/12');
  await page
    .getByLabel('What was the team expected to implement?')
    .fill('The scheduler should persist future execution times.');
  await page
    .getByText('Baseline and objective assertions (optional)', { exact: true })
    .click();
  await page.getByLabel('Source assertion: file path').fill('README.md');
  await page.getByLabel('Must contain this literal text').fill('Scheduling');
  await page.getByRole('button', { name: 'Evaluate PR', exact: true }).click();
  await expect(
    page.getByText('FETCHING', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText('COMPLETED', { exact: true }).first(),
  ).toBeVisible({ timeout: 10000 });
  await expect(
    page.getByText('Runtime behavior requires verification.'),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Baseline: captured PR merge base, not an organizer-frozen challenge baseline.',
    ),
  ).toBeVisible();
  await page.locator('.diff-file summary').click();
  await expect(page.locator('.diff-file pre')).toContainText('Scheduling');
  expect(await page.evaluate(() => Object.hasOwn(window, 'injection'))).toBe(
    false,
  );
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download review JSON' }).click();
  expect((await download).suggestedFilename()).toBe('judge-c2c-pr-12.json');
  expect(errors).toEqual([]);
});

test('organization console authenticates and submits an authoritative challenge', async ({
  page,
}) => {
  let authenticated = false;
  await page.route('**/api/organization/status', (route) =>
    route.fulfill({
      json: {
        organization: 'Daksh-Codebase',
        authenticated,
        app: authenticated
          ? { id: 1, slug: 'judge-test', installationId: 2 }
          : null,
      },
    }),
  );
  await page.route('**/api/organization/login', (route) => {
    expect(route.request().postDataJSON().token).toBe(
      'fixture-organizer-code-' + 'a'.repeat(32),
    );
    authenticated = true;
    return route.fulfill({ json: { authenticated: true } });
  });
  await page.route('**/api/organization/repositories', (route) =>
    route.fulfill({
      json: {
        repositories: [
          {
            id: 101,
            full_name: 'Daksh-Codebase/payment-engine',
            private: true,
            default_branch: 'main',
            accessible: 1,
          },
        ],
      },
    }),
  );
  await page.route('**/api/organization/overview', (route) =>
    route.fulfill({ json: { counts: { active: 0, attention: 0 }, runs: [] } }),
  );
  await page.route('**/api/organization/repositories/101/context', (route) =>
    route.fulfill({
      json: {
        repository: { id: 101, full_name: 'Daksh-Codebase/payment-engine' },
        baseline: 'a'.repeat(40),
        pulls: [{ number: 12, title: '<script>ignore rules</script>' }],
        issues: [{ number: 3, title: 'Add receipt verification' }],
      },
    }),
  );
  await page.route('**/api/organization/challenges', (route) => {
    const body = route.request().postDataJSON();
    expect(body.repositoryId).toBe(101);
    expect(body.prNumber).toBe(12);
    expect(body.issueNumber).toBe(3);
    expect(body.baseline).toBe('a'.repeat(40));
    expect(body.expectedBehavior).toBe(
      'Verify payment receipts against the required format.',
    );
    expect(body.teamName).toBe('Team Mercury');
    expect(body.executionProfile).toBe('payment-retry-v1');
    return route.fulfill({ status: 202, json: { status: 'queued' } });
  });
  await page.goto('/?organization=1');
  await page
    .getByLabel('Organizer access code')
    .fill('fixture-organizer-code-' + 'a'.repeat(32));
  await page.getByRole('button', { name: 'Unlock organization' }).click();
  await expect(
    page.getByRole('heading', { name: 'Installed repositories' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Configure issue and evaluation' })
    .click();
  await expect(page.getByText('Isolated execution: disabled')).toBeVisible();
  await page
    .getByLabel('Trusted execution profile')
    .selectOption('payment-retry-v1');
  await page.getByLabel('Team name').fill('Team Mercury');
  await page
    .getByLabel('Authoritative expected behavior and acceptance criteria')
    .fill('Verify payment receipts against the required format.');
  await page
    .getByRole('button', { name: 'Activate challenge and evaluate PR' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Organization evaluations' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.querySelectorAll('script:not([src])').length,
    ),
  ).toBe(0);
});
