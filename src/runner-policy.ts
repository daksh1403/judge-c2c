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
const runWhen = z
  .enum([
    'ALWAYS',
    'SOURCE_CHANGE',
    'DEPENDENCY_CHANGE',
    'SECURITY_CHANGE',
    'PERFORMANCE_CHANGE',
  ])
  .optional();
const key = z.string().regex(/^[a-zA-Z0-9][\w.-]{0,79}$/);
export const commandKinds = [
  'build',
  'test',
  'lint',
  'integration',
  'typecheck',
  'format',
  'coverage',
  'security',
  'dependency',
] as const;
export const runnerPolicySchema = z
  .object({
    version: z.literal('node-http-v1'),
    cache: z.enum(['NONE', 'BASELINE', 'ALL']).optional(),
    image: z.union([
      z.literal('UNCONFIGURED'),
      z.string().regex(/^qemu-vm@sha256:[a-f0-9]{64}$/),
      z.string().regex(/^docker-local@sha256:[a-f0-9]{64}$/),
      z
        .string()
        .regex(
          /^registry\.cloudflare\.com\/[A-Za-z0-9/_-]+@sha256:[a-f0-9]{64}$/,
        ),
    ]),
    entrypoint: safePath,
    // Organizer opt-in; packages must already exist in the immutable image cache.
    dependencies: z
      .object({
        mode: z.literal('NPM_OFFLINE_V1'),
        npmVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
        lockHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .optional(),
    commands: z
      .array(
        z
          .object({
            id: key,
            kind: z.enum(commandKinds),
            runWhen,
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
    benchmarks: z
      .array(
        z
          .object({
            id: key,
            path: z
              .string()
              .regex(/^\/[a-zA-Z0-9/_-]*$/)
              .max(200),
            method: z.literal('GET'),
            expectedStatus: z.number().int().min(100).max(599),
            expectedBody: z.json(),
            samples: z.number().int().min(10).max(30),
            warmup: z.number().int().min(1).max(5),
            maxP95Ms: z.number().positive().max(5000),
            runWhen,
          })
          .strict(),
      )
      .max(3)
      .optional(),
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
    const ids = [...p.commands, ...p.cases, ...(p.benchmarks ?? [])].map(
      (c) => c.id,
    );
    if (p.dependencies) ids.push('dependency-preparation');
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
  cache: 'NONE',
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
export const RUNNER_VERSION = 'node-http-v1.3.0';
