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
  await page.route('**/api/organization/manage/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json: path.endsWith('/settings')
        ? {
            settings: {
              name: 'Fixture',
              status: 'ACTIVE',
              policy: {},
              taxonomy: [],
            },
            capabilities: { issuesWrite: false, events: [] },
          }
        : path.endsWith('/overview')
          ? { counts: { teams: 0, notSubmitted: 0 } }
          : { teams: [] },
    });
  });
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
  await page
    .getByLabel('Team name', { exact: true })
    .last()
    .fill('Team Mercury');
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

test('organizers see not-submitted teams, member identity and issue provenance together', async ({
  page,
}) => {
  await page.route('**/api/organization/status', (r) =>
    r.fulfill({
      json: {
        organization: 'Daksh-Codebase',
        authenticated: true,
        app: { slug: 'judge-fixture', installationId: 1 },
        runner: { enabled: false },
        ai: { enabled: false },
      },
    }),
  );
  await page.route('**/api/organization/repositories', (r) =>
    r.fulfill({
      json: {
        repositories: [
          {
            id: 101,
            full_name: 'fixture/challenge',
            accessible: 1,
            default_branch: 'main',
          },
        ],
      },
    }),
  );
  await page.route('**/api/organization/overview', (r) =>
    r.fulfill({ json: { counts: { active: 0, attention: 0 }, runs: [] } }),
  );
  const team = {
    id: 'team-stable',
    name: 'Alpha <script>alert(1)</script>',
    status: 'ACTIVE',
    github_members: 'alice, bob',
    submission_count: 0,
  };
  let issueQuery = new URLSearchParams();
  let issueReview: Record<string, string> = {};
  let holdTeam = false,
    releaseTeam: () => void = () => {},
    teamEntered: () => void = () => {};
  const teamGate = new Promise<void>((r) => (releaseTeam = r)),
    teamPending = new Promise<void>((r) => (teamEntered = r));
  await page.route('**/api/organization/manage/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.split('/manage/')[1];
    if (p === 'issues') issueQuery = url.searchParams;
    if (p === 'issues/101/12/review')
      issueReview = route.request().postDataJSON();
    if (p === 'issues/101/12')
      return route.fulfill({
        json: {
          issue: {
            repository_id: 101,
            number: 12,
            title: 'Missing validation',
            source: 'PARTICIPANT',
            author_login: 'alice',
            reporter_team_id: 'team-stable',
            github_state: 'open',
            review_status: 'NEEDS_TRIAGE',
            body: 'Expected validation, actual crash.',
            classification: { flags: [] },
          },
          definition: null,
          versions: [],
          assignments: [],
          submissions: [],
          decisions: [],
        },
      });
    if (p === 'teams' && holdTeam) {
      teamEntered();
      await teamGate;
    }
    const data =
      p === 'settings'
        ? {
            settings: {
              name: 'Fixture',
              status: 'ACTIVE',
              policy: { claimingEnabled: false },
              taxonomy: [],
            },
            capabilities: {
              issuesWrite: false,
              events: ['pull_request'],
              app: {
                name: 'Judge-C2C Daksh-Codebase',
                owner: 'Daksh-Codebase',
                settingsUrl:
                  'https://github.com/organizations/Daksh-Codebase/settings/apps/judge-c2c-daksh-codebase',
                installationUrl:
                  'https://github.com/organizations/Daksh-Codebase/settings/installations/167005353',
              },
            },
          }
        : p === 'overview'
          ? { counts: { teams: 1, notSubmitted: 1, needsTriage: 1 } }
          : p === 'teams/team-stable'
            ? {
                team,
                members: [
                  {
                    id: 'm1',
                    display_name: 'Alice',
                    github_login: 'alice',
                    github_id: 101,
                    active: 1,
                  },
                ],
                repositories: [
                  {
                    repository_id: 101,
                    full_name: 'fixture/challenge',
                    active: 1,
                  },
                ],
                assignments: [],
                submissions: [],
                raisedIssues: [
                  {
                    number: 12,
                    title: 'Missing validation',
                    review_status: 'NEEDS_TRIAGE',
                  },
                ],
                evaluations: [],
              }
            : p === 'issues'
              ? {
                  issues: [
                    {
                      repository_id: 101,
                      number: 12,
                      title: 'Missing validation',
                      full_name: 'fixture/challenge',
                      source: 'PARTICIPANT',
                      review_status: 'NEEDS_TRIAGE',
                      official: 0,
                    },
                  ],
                }
              : p === 'submissions'
                ? { teams: [team] }
                : { teams: [team] };
    return route.fulfill({ json: data });
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?organization=1');
  await expect(
    page.getByRole('heading', { name: 'Hackathon workflow' }),
  ).toBeVisible();
  await expect(
    page.getByText('Owner setup needed:', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Open App settings' }),
  ).toHaveAttribute(
    'href',
    'https://github.com/organizations/Daksh-Codebase/settings/apps/judge-c2c-daksh-codebase',
  );
  await expect(
    page.getByRole('link', { name: 'Open installation' }),
  ).toHaveAttribute(
    'href',
    'https://github.com/organizations/Daksh-Codebase/settings/installations/167005353',
  );
  await page
    .getByRole('button', {
      name: 'Alpha <script>alert(1)</script>',
      exact: false,
    })
    .click();
  await expect(
    page.getByText('Alice · @alice · GitHub ID 101', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('NOT SUBMITTED', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Issues', exact: true }).click();
  await expect(
    page.getByText('PARTICIPANT · NEEDS_TRIAGE · Not scored'),
  ).toBeVisible();
  await page.getByLabel('Priority filter').selectOption('high');
  await page.getByLabel('Difficulty filter').selectOption('hard');
  await page.getByLabel('Work progress').selectOption('assigned');
  await page.getByLabel('Label filter').fill('judge:type:bug');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect.poll(() => issueQuery.get('priority')).toBe('high');
  expect(issueQuery.get('difficulty')).toBe('hard');
  expect(issueQuery.get('workflow')).toBe('assigned');
  expect(issueQuery.get('label')).toBe('judge:type:bug');
  await page
    .getByRole('button', {
      name: 'fixture/challenge #12 · Missing validation',
      exact: false,
    })
    .click();
  await page.getByLabel('Priority override').selectOption('high');
  await page.getByLabel('Difficulty override').selectOption('hard');
  await page.getByLabel('Technical severity override').selectOption('medium');
  await page
    .getByLabel('Recognition rationale')
    .fill('Reproducible report independently reviewed by organizer.');
  await page
    .getByLabel('Decision reason', { exact: true })
    .fill('Organizer assessed impact separately from technical severity.');
  await page
    .getByRole('button', { name: 'Record review', exact: true })
    .click();
  await expect.poll(() => issueReview.priority).toBe('high');
  expect(issueReview.difficulty).toBe('hard');
  expect(issueReview.severity).toBe('medium');
  expect(issueReview.recognition).toBe(
    'Reproducible report independently reviewed by organizer.',
  );
  holdTeam = true;
  await page.getByRole('button', { name: 'Teams', exact: true }).click();
  await teamPending;
  await page.getByRole('button', { name: 'Issues', exact: true }).click();
  await expect(
    page.getByText('PARTICIPANT · NEEDS_TRIAGE · Not scored'),
  ).toBeVisible();
  releaseTeam();
  await page.getByRole('button', { name: 'Submissions', exact: true }).click();
  await page
    .getByLabel('Status', { exact: true })
    .selectOption('NOT_SUBMITTED');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(
    page.getByRole('button', {
      name: 'Alpha <script>alert(1)</script>',
      exact: false,
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('approach review exposes separate evidence-backed observations and uncertainty', async ({
  page,
}) => {
  await page.route('**/api/organization/status', (r) =>
    r.fulfill({
      json: {
        organization: 'Daksh-Codebase',
        authenticated: true,
        app: { slug: 'fixture', installationId: 1 },
      },
    }),
  );
  await page.route('**/api/organization/repositories', (r) =>
    r.fulfill({ json: { repositories: [] } }),
  );
  await page.route('**/api/organization/overview', (r) =>
    r.fulfill({ json: { counts: { active: 0, attention: 0 }, runs: [] } }),
  );
  await page.route('**/api/organization/manage/**', (r) =>
    r.fulfill({
      json: r.request().url().endsWith('settings')
        ? {
            settings: {
              name: 'Fixture',
              status: 'ACTIVE',
              policy: {},
              taxonomy: [],
            },
          }
        : r.request().url().endsWith('overview')
          ? { counts: {} }
          : { teams: [] },
    }),
  );
  const unavailable = {
    text: 'Repository-wide behavior remains unverified.',
    evidenceIds: [],
    verification: 'UNVERIFIED',
  };
  const approach = {
    problem_understanding: unavailable,
    approach_summary: {
      text: 'A scheduling path appears to have been added.',
      evidenceIds: ['diff'],
      verification: 'INFERENCE',
    },
    solution_design: unavailable,
    strengths: [],
    weaknesses: [],
    tradeoffs: [],
    correctness: unavailable,
    maintainability: unavailable,
    architecture_fit: unavailable,
    evidence: ['diff'],
    unverified_assumptions: [unavailable],
  };
  const detail = {
    ...demoDetail,
    report: JSON.stringify({
      ...JSON.parse(demoDetail.report),
      solution_approach: approach,
    }),
    execution: [],
    artifacts: [],
  };
  await page.route('**/api/organization/evaluations/*', (r) =>
    r.fulfill({ json: detail }),
  );
  await page.goto('/?organization=1&evaluation=' + demoRun.id);
  await expect(
    page.getByRole('heading', { name: 'Observable solution approach' }),
  ).toBeVisible();
  await expect(
    page.getByText('A scheduling path appears to have been added.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'unverified assumptions' }),
  ).toBeVisible();
  await expect(
    page.getByText('Private reasoning is unknown.', { exact: false }),
  ).toBeVisible();
});

test('read-only judges retain navigation and filters while administrative controls are disabled', async ({
  page,
}) => {
  await page.route('**/api/organization/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = path.endsWith('/status')
      ? {
          authenticated: true,
          role: 'judge',
          organization: 'Fixture',
          app: { slug: 'fixture', installationId: 1 },
        }
      : path.endsWith('/settings')
        ? {
            settings: {
              name: 'Fixture',
              status: 'ACTIVE',
              policy: {},
              taxonomy: [],
            },
            capabilities: { events: [] },
          }
        : path.endsWith('/overview')
          ? { counts: { teams: 0, notSubmitted: 0 }, runs: [] }
          : path.endsWith('/repositories')
            ? { repositories: [] }
            : { teams: [], submissions: [], issues: [] };
    return route.fulfill({ json });
  });
  await page.goto('/?organization=1');
  await expect(
    page.getByText('JUDGE · READ ONLY', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Sync installed repositories' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Test Docker runner' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Teams', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Submissions', exact: true }).click();
  await expect(page.locator('#workflow-search')).toBeEnabled();
  await page
    .getByRole('button', { name: 'Needs attention', exact: true })
    .click();
  await expect(page.getByLabel('Attention filter')).toHaveValue('1');
  await page
    .getByRole('button', { name: 'Failed evaluations', exact: true })
    .click();
  await expect(page.locator('[data-query="evaluationState"]')).toHaveValue(
    'FAILED',
  );
  await page
    .getByRole('button', { name: 'Missing team mapping', exact: true })
    .click();
  await expect(page.locator('#workflow-filter')).toHaveValue(
    'NEEDS_TEAM_MAPPING',
  );
  await page
    .getByRole('button', { name: 'Not submitted', exact: true })
    .click();
  await expect(page.locator('#workflow-filter')).toHaveValue('NOT_SUBMITTED');
  await page.getByRole('button', { name: 'Issue triage', exact: true }).click();
  await expect(page.locator('#workflow-filter')).toHaveValue('NEEDS_TRIAGE');

  await expect(
    page.getByRole('button', { name: 'Lock organization' }),
  ).toBeEnabled();
});
