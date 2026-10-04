import { contractSchema, type Evidence } from './domain';
import { deterministicReport } from './evaluate';
export const demoContract = contractSchema.parse({
  schemaVersion: 1,
  evaluationVersion: 'review-v1',
  challengeVersion: 'scheduling-v1',
  repository: { id: 1, fullName: 'hackathon/CampaignOS', installationId: 1 },
  department: 'Marketing',
  category: 'Feature',
  baseline: 'a'.repeat(40),
  issueNumbers: [12],
  requirements: [
    {
      id: 'schedule',
      title: 'Schedule a campaign',
      mandatory: true,
      criteria: [
        {
          id: 'future-time',
          description:
            'Accept a future execution time and persist the scheduled state.',
          kind: 'functional',
          verification: { type: 'runner', checkId: 'scheduling-tests' },
        },
        {
          id: 'past-time',
          description: 'Reject invalid and past dates.',
          kind: 'functional',
          verification: { type: 'runner', checkId: 'date-validation' },
        },
      ],
    },
    {
      id: 'docs',
      title: 'Document scheduling',
      mandatory: true,
      criteria: [
        {
          id: 'docs-heading',
          description:
            'Contributor documentation includes the scheduling section.',
          kind: 'documentation',
          verification: {
            type: 'file_contains',
            path: 'README.md',
            text: '## Scheduling',
          },
        },
      ],
    },
  ],
  constraints: [
    'Preserve immediate campaign execution.',
    'Do not commit credentials.',
  ],
  forbiddenPaths: ['.github/workflows'],
  additionalCategories: ['testing', 'documentation'],
  execution: {
    environment: 'node22-v1',
    network: 'deny',
    timeoutSeconds: 60,
    memoryMiB: 512,
    maxFiles: 50,
    maxFileBytes: 50000,
  },
});
const evidence: Evidence[] = [
  {
    id: 'diff',
    kind: 'diff',
    status: 'PASS',
    claim:
      'Synthetic fixture: baseline-to-head comparison includes 4 changed files.',
  },
  {
    id: 'policy-ci',
    kind: 'policy',
    status: 'PASS',
    path: '.github/workflows',
    claim: 'Synthetic fixture: protected CI configuration unchanged.',
  },
  {
    id: 'criterion-future-time',
    kind: 'policy',
    status: 'UNVERIFIED',
    criterionId: 'future-time',
    claim: 'Runtime scheduling behavior needs isolated execution evidence.',
  },
  {
    id: 'criterion-past-time',
    kind: 'policy',
    status: 'UNVERIFIED',
    criterionId: 'past-time',
    claim: 'Invalid-date behavior needs isolated execution evidence.',
  },
  {
    id: 'criterion-docs-heading',
    kind: 'source',
    status: 'PASS',
    baselineStatus: 'FAIL',
    criterionId: 'docs-heading',
    path: 'README.md',
    claim:
      'Synthetic fixture: required scheduling heading is present in the submission and absent in the baseline. This verifies the heading only.',
  },
];
export const demoRun = {
  id: 'demo-scheduling',
  repository_id: 1,
  pr_number: 24,
  head_sha: 'b'.repeat(40),
  baseline_sha: demoContract.baseline,
  contract_hash: 'c'.repeat(64),
  contract_snapshot: JSON.stringify(demoContract),
  assignment_snapshot: JSON.stringify({
    team_id: 'northstar',
    team_name: 'Northstar',
    issue_numbers: [12],
  }),
  state: 'COMPLETED',
  evidence: JSON.stringify(evidence),
  report: JSON.stringify(deterministicReport(demoContract, evidence)),
  ai_status: 'NOT_CONFIGURED',
  publication_status: 'NOT_PUBLISHED',
  failure_code: null,
  created_at: '2026-10-01 12:00:00',
  updated_at: '2026-10-01 12:01:20',
  full_name: 'hackathon/CampaignOS',
};
export const demoDetail = {
  ...demoRun,
  timeline: [
    {
      state: 'QUEUED',
      detail: 'Synthetic GitHub submission',
      created_at: '2026-10-01 12:00:00',
    },
    {
      state: 'FETCHING',
      detail: 'Frozen baseline and exact head resolved',
      created_at: '2026-10-01 12:00:05',
    },
    {
      state: 'CHECKING',
      detail: 'Source assertions and policy checks',
      created_at: '2026-10-01 12:00:20',
    },
    {
      state: 'COMPLETED',
      detail: 'Human review required for runtime criteria',
      created_at: '2026-10-01 12:01:20',
    },
  ],
  artifacts: [],
};
