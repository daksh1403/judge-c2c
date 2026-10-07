import { actionsEvaluate } from './actions-runner';
import { canonical, digest } from './domain';
import { tunnelEvaluate } from './runner-tunnel';
import { validateRunnerResult, type RunnerRequest } from './runner';
import type { Env } from './env';
export async function runnerDiagnostic(env: Env) {
  if (
    env.RUNNER_ENABLED !== 'true' ||
    (!env.RUNNER_ENDPOINT && env.RUNNER_BACKEND !== 'actions-vm') ||
    !env.RUNNER_IMAGE_URI
  )
    return { synthetic: true, status: 'NOT_CONFIGURED' };
  const policy = {
    version: 'node-http-v1' as const,
    image: env.RUNNER_IMAGE_URI,
    entrypoint: 'server.mjs',
    commands: [],
    cases: [
      {
        id: 'ready',
        path: '/ready',
        method: 'GET' as const,
        expectedStatus: 200,
        expectedBody: { ready: true },
      },
    ],
  };
  // Organizer-authored transport canary; no participant source or credentials.
  const source =
    "import {createServer} from 'node:http';createServer((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ready:true}));}).listen(9000,'0.0.0.0');";
  const runId = await digest(crypto.randomUUID()),
    contractHash = await digest(canonical(policy)),
    results = [];
  for (const label of ['baseline', 'submission']) {
    const request: RunnerRequest = {
      runId,
      commit: (label === 'baseline' ? '0' : '1').repeat(40),
      contractHash,
      policy,
      timeoutSeconds: 15,
      memoryMiB: 256,
      files: label === 'baseline' ? [] : [{ path: 'server.mjs', text: source }],
    };
    const result = validateRunnerResult(
      env.RUNNER_BACKEND === 'actions-vm'
        ? await actionsEvaluate(
            { ...env, DB: env.ORG_DB ?? env.DB },
            request,
            true,
          )
        : await tunnelEvaluate(env, request),
      request,
      await digest(canonical(request)),
    );
    results.push({ label, result });
  }
  return {
    synthetic: true,
    status:
      results[0]?.result.checks[0]?.status === 'FAIL' &&
      results[1]?.result.checks[0]?.status === 'PASS'
        ? 'COMPLETED'
        : 'FAILED',
    results,
  };
}
