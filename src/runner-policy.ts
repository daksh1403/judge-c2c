import { z } from 'zod';
const safePath = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (p) =>
      !p.startsWith('/') &&
      !p.includes('..') &&
      !/[\x00-\x1f\\]/.test(p) &&
      !p.startsWith('.git/'),
  );
const key = z.string().regex(/^[a-zA-Z0-9][\w.-]{0,79}$/);
export const runnerPolicySchema = z
  .object({
    version: z.literal('node-http-v1'),
    image: z.union([
      z.literal('UNCONFIGURED'),
      z
        .string()
        .regex(
          /^registry\.cloudflare\.com\/[A-Za-z0-9/_-]+@sha256:[a-f0-9]{64}$/,
        ),
    ]),
    entrypoint: safePath,
    commands: z
      .array(
        z
          .object({
            id: key,
            kind: z.enum(['build', 'test', 'lint']),
            argv: z
              .array(
                z
                  .string()
                  .min(1)
                  .max(500)
                  .refine((v) => !/[\x00\r\n]/.test(v)),
              )
              .min(1)
              .max(20),
          })
          .strict(),
      )
      .max(8),
    cases: z
      .array(
        z
          .object({
            id: key,
            path: z
              .string()
              .regex(/^\/[a-zA-Z0-9/_-]*$/)
              .max(200),
            method: z.enum(['GET', 'POST']),
            body: z.json().optional(),
            expectedStatus: z.number().int().min(100).max(599),
            expectedBody: z.json(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict()
  .superRefine((p, ctx) => {
    const ids = [...p.commands, ...p.cases].map((c) => c.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Runner check IDs must be unique',
      });
  });
export type RunnerPolicy = z.infer<typeof runnerPolicySchema>;
// Explicit organizer opt-in: this profile is not inferred from an issue title.
export const paymentRetryPolicy: RunnerPolicy = {
  version: 'node-http-v1',
  image: 'UNCONFIGURED',
  entrypoint: 'server.mjs',
  commands: [
    { id: 'build', kind: 'build', argv: ['node', '--check', 'server.mjs'] },
    { id: 'repository-tests', kind: 'test', argv: ['node', '--test'] },
    {
      id: 'lint',
      kind: 'lint',
      argv: [
        '/opt/judge/node_modules/.bin/eslint',
        '--no-config-lookup',
        '--no-inline-config',
        '--rule',
        'no-unreachable:error',
        '--rule',
        'no-constant-condition:error',
        'server.mjs',
      ],
    },
  ],
  cases: [
    {
      id: 'retry-transient',
      method: 'POST',
      path: '/payments/retry',
      body: { outcomes: ['temporary', 'success'], maxAttempts: 3 },
      expectedStatus: 200,
      expectedBody: { status: 'success', attempts: 2 },
    },
    {
      id: 'retry-bounded',
      method: 'POST',
      path: '/payments/retry',
      body: {
        outcomes: ['temporary', 'temporary', 'temporary'],
        maxAttempts: 2,
      },
      expectedStatus: 200,
      expectedBody: { status: 'failed', attempts: 2 },
    },
    {
      id: 'retry-permanent',
      method: 'POST',
      path: '/payments/retry',
      body: { outcomes: ['permanent', 'success'], maxAttempts: 3 },
      expectedStatus: 200,
      expectedBody: { status: 'failed', attempts: 1 },
    },
    {
      id: 'retry-invalid',
      method: 'POST',
      path: '/payments/retry',
      body: { outcomes: ['success'], maxAttempts: 0 },
      expectedStatus: 400,
      expectedBody: { error: 'INVALID_ATTEMPTS' },
    },
  ],
};
export const paymentRetryDescriptions: Record<string, string> = {
  'retry-transient':
    'Retry a temporary payment failure and stop after success.',
  'retry-bounded': 'Stop retrying at the configured maximum attempt count.',
  'retry-permanent': 'Do not retry a permanent payment failure.',
  'retry-invalid': 'Reject a non-positive maximum attempt count.',
};
export const RUNNER_VERSION = 'node-http-v1.0.0';
