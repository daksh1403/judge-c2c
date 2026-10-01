export interface Env {
  DB: D1Database;
  ARTIFACTS?: R2Bucket;
  ASSETS: Fetcher;
  EVALUATOR: Workflow<{ runId: string }>;
  AI?: Ai;
  ENVIRONMENT: 'local' | 'review' | 'production';
  DEMO_MODE?: string;
  ADMIN_TOKEN?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  PUBLIC_ORIGIN?: string;
  AI_MODEL?: string;
}
