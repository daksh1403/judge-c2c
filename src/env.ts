export interface Env {
  ORG_DB?: D1Database;
  ORG_SERVICE?: Fetcher;
  ORG_EVALUATOR?: Workflow<{ runId: string }>;
  ORG_NAME?: string;
  ORG_PUBLIC_ORIGIN?: string;
  ORG_ADMIN_TOKEN?: string;
  ORG_VAULT_KEY?: string;
  DB: D1Database;
  ARTIFACTS?: R2Bucket;
  ASSETS: Fetcher;
  EVALUATOR: Workflow<{ runId: string }>;
  PREVIEW_EVALUATOR?: Workflow<{ runId: string }>;
  PREVIEW_TESTING?: string;
  AI?: Ai;
  ENVIRONMENT: 'local' | 'review' | 'production';
  DEMO_MODE?: string;
  ADMIN_TOKEN?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  PUBLIC_ORIGIN?: string;
  EVALUATION_DETAILS_KIND?: 'organization';
  AI_MODEL?: string;
}
