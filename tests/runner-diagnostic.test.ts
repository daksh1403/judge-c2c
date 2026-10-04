import { describe, it, expect, vi } from 'vitest';
import { runnerDiagnostic } from '../src/runner-diagnostic';
import { canonical, digest } from '../src/domain';
import { runnerSignature, responseMessage } from '../src/runner-tunnel';
import type { Env } from '../src/env';
import { RUNNER_VERSION } from '../src/runner-policy';
const key = 'e'.repeat(64),
  image = 'docker-local@sha256:' + 'f'.repeat(64);
describe('protected synthetic runner diagnostic', () => {
  it('verifies baseline absence then a trusted canary with signed results', async () => {
    const requests: unknown[] = [];
    const transport = vi.fn(async (_url: unknown, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      requests.push(request);
      const headers = new Headers(init.headers),
        hash = await digest(String(init.body));
      const result = {
        requestHash: hash,
        commit: request.commit,
        contractHash: request.contractHash,
        version: RUNNER_VERSION,
        image,
        runtime: 'test',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        checks: [
          {
            id: 'ready',
            kind: 'acceptance',
            status: request.files.length ? 'PASS' : 'FAIL',
            exitCode: null,
            durationMs: 1,
            stdout: '',
            stderr: '',
            detail: 'Synthetic canary',
          },
        ],
      };
      const text = canonical(result);
      return new Response(text, {
        headers: {
          'x-runner-signature': await runnerSignature(
            key,
            responseMessage(
              headers.get('x-runner-nonce')!,
              hash,
              await digest(text),
            ),
          ),
        },
      });
    });
    vi.stubGlobal('fetch', transport);
    try {
      const result = await runnerDiagnostic({
        RUNNER_ENABLED: 'true',
        RUNNER_ENDPOINT: 'https://bridge.trycloudflare.com',
        RUNNER_IMAGE_URI: image,
        RUNNER_TUNNEL_KEY: key,
      } as Env);
      expect(result).toMatchObject({ synthetic: true, status: 'COMPLETED' });
      expect(requests).toHaveLength(2);
      expect(requests[0]).toMatchObject({ files: [], commit: '0'.repeat(40) });
      expect(JSON.stringify(requests)).not.toContain(key);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('does not execute when disconnected', async () => {
    const transport = vi.fn();
    vi.stubGlobal('fetch', transport);
    try {
      expect(
        await runnerDiagnostic({ RUNNER_ENABLED: 'false' } as Env),
      ).toMatchObject({ synthetic: true, status: 'NOT_CONFIGURED' });
      expect(transport).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
