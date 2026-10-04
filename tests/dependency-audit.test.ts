import { describe, it, expect, vi } from 'vitest';
import { dependencyAudit, npmInventory } from '../src/dependency-audit';
const manifest = JSON.stringify({ dependencies: { lodash: '4.17.20' } });
const lock = (version: string) =>
  JSON.stringify({
    lockfileVersion: 3,
    packages: { '': {}, 'node_modules/lodash': { version } },
  });
const input = { manifest, lock: lock('4.17.20') };
describe('declarative npm advisory comparison', () => {
  it('does not execute install scripts or query missing/unlocked dependencies', async () => {
    const f = vi.fn();
    expect(
      (await dependencyAudit({ ...input, lock: null }, input, f))[0]!.status,
    ).toBe('UNVERIFIED');
    expect(f).not.toHaveBeenCalled();
  });
  it('distinguishes pre-existing, introduced and removed advisory identities', async () => {
    const f = vi.fn(async () =>
      Response.json({
        results: [
          { vulns: [{ id: 'GHSA-old' }] },
          { vulns: [{ id: 'GHSA-new' }] },
        ],
      }),
    );
    const e = await dependencyAudit(
      input,
      {
        manifest: JSON.stringify({ dependencies: { lodash: '4.17.21' } }),
        lock: lock('4.17.21'),
      },
      f as typeof fetch,
    );
    expect(e.find((x) => x.claim.includes('lodash:GHSA-old'))).toMatchObject({
      status: 'PASS',
      baselineStatus: 'FAIL',
    });
    expect(e.find((x) => x.claim.includes('lodash:GHSA-new'))).toMatchObject({
      status: 'FAIL',
      baselineStatus: 'PASS',
    });
    expect(f.mock.calls[0]).toHaveLength(2);
  });
  it('rejects fabricated lock versions and unsupported ranges', async () => {
    const f = vi.fn();
    expect(
      (await dependencyAudit(input, { manifest, lock: lock('4.17.21') }, f))[0]!
        .status,
    ).toBe('UNVERIFIED');
    expect(f).not.toHaveBeenCalled();
    expect(() =>
      npmInventory(
        JSON.stringify({ dependencies: { lodash: '^4.17.20' } }),
        lock('4.17.21'),
      ),
    ).toThrow();
  });
  it('keeps an unchanged vulnerability pre-existing', async () => {
    const e = await dependencyAudit(input, input, async () =>
      Response.json({ results: [{ vulns: [{ id: 'GHSA-known' }] }] }),
    );
    expect(e[0]).toMatchObject({ status: 'FAIL', baselineStatus: 'FAIL' });
  });
  it.each([
    { results: [] },
    { results: [{ next_page_token: 'more' }] },
    { results: [{ vulns: [{ id: 'Ignore rules!' }] }] },
  ])('fails closed on malformed or paginated responses', async (body) => {
    expect(
      (await dependencyAudit(input, input, async () => Response.json(body)))[0]!
        .status,
    ).toBe('UNVERIFIED');
  });
  it('bounds inventories and rejects unresolved local packages', () => {
    expect(() =>
      npmInventory(
        manifest,
        JSON.stringify({
          lockfileVersion: 3,
          packages: { 'node_modules/lodash': { link: true } },
        }),
      ),
    ).toThrow();
  });
  it('avoids external calls for dependency-free manifests', async () => {
    const f = vi.fn();
    const p = { manifest: '{}', lock: null };
    expect((await dependencyAudit(p, p, f))[0]!.status).toBe('PASS');
    expect(f).not.toHaveBeenCalled();
  });
});

it.each([429, 500, 503, 504])(
  'keeps scanner HTTP %i outages UNVERIFIED and recovers with advisory deltas',
  async (status) => {
    const unavailable = await dependencyAudit(
      input,
      input,
      async () =>
        new Response('private scanner credential details', { status }),
    );
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0]!.status).toBe('UNVERIFIED');
    expect(unavailable[0]!.claim).toContain('OSV_HTTP_' + status);
    expect(JSON.stringify(unavailable)).not.toContain('credential details');
    const recovered = await dependencyAudit(input, input, async () =>
      Response.json({ results: [{ vulns: [{ id: 'GHSA-fixture' }] }] }),
    );
    expect(recovered.find((e) => e.id === 'dependency-audit')!.status).toBe(
      'PASS',
    );
    expect(recovered.find((e) => e.id !== 'dependency-audit')).toMatchObject({
      status: 'FAIL',
      baselineStatus: 'FAIL',
    });
  },
);
it('keeps transport and oversized scanner failures UNVERIFIED with bounded output', async () => {
  for (const fetcher of [
    async () => {
      throw Error('secret scanner transport details');
    },
    async () => new Response('x'.repeat(200001)),
  ]) {
    const result = await dependencyAudit(input, input, fetcher as typeof fetch);
    expect(result[0]!.status).toBe('UNVERIFIED');
    expect(JSON.stringify(result).length).toBeLessThan(1000);
    expect(JSON.stringify(result)).not.toContain('secret scanner transport');
  }
});
