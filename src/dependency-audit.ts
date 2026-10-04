import { z } from 'zod';
import { canonical, digest, type Evidence } from './domain';
import { boundedBody } from './security';
const npmName = z
  .string()
  .regex(/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/)
  .max(200);
const version = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/)
  .max(100);
const object = z.record(z.string(), z.unknown());
export function npmInventory(
  manifestText: string | null,
  lockText: string | null,
) {
  if (manifestText === null) throw new Error('NPM_MANIFEST_UNAVAILABLE');
  const manifest = object.parse(JSON.parse(manifestText));
  const dependencies = [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ].flatMap((k) => Object.entries(object.parse(manifest[k] ?? {})));
  if (!lockText) {
    if (dependencies.length) throw new Error('NPM_LOCK_REQUIRED');
    return [];
  }
  const lock = z
    .object({
      lockfileVersion: z.union([z.literal(2), z.literal(3)]),
      packages: z.record(
        z.string(),
        z.object({
          version: z.string().optional(),
          name: z.string().optional(),
          link: z.boolean().optional(),
        }),
      ),
    })
    .parse(JSON.parse(lockText));
  const entries = Object.entries(lock.packages).filter(([path]) => path !== '');
  if (entries.length > 100) throw new Error('NPM_INVENTORY_LIMIT');
  const packages = entries.map(([path, p]) => {
    if (p.link || !path.includes('node_modules/'))
      throw new Error('NPM_UNRESOLVED_PACKAGE');
    const name = npmName.parse(
      p.name ?? path.slice(path.lastIndexOf('node_modules/') + 13),
    );
    return { name, version: version.parse(p.version) };
  });
  // Resolve direct dependencies at the root, never a similarly named nested copy.
  // Only exact versions are currently supported; ranges/aliases need a real
  // reproducible resolution before they can be treated as matching metadata.
  for (const [name, requested] of dependencies) {
    const exact = version.safeParse(requested);
    if (
      !exact.success ||
      lock.packages['node_modules/' + name]?.version !== exact.data
    )
      throw new Error('NPM_MANIFEST_LOCK_MISMATCH_OR_UNSUPPORTED_RANGE');
  }
  return [
    ...new Map(packages.map((p) => [p.name + '@' + p.version, p])).values(),
  ].sort((a, b) => canonical(a).localeCompare(canonical(b)));
}
const responseSchema = z.object({
  results: z
    .array(
      z.object({
        vulns: z
          .array(
            z.object({
              id: z.string().regex(/^[a-zA-Z0-9_.-]{1,100}$/),
              modified: z.string().max(100).optional(),
            }),
          )
          .max(100)
          .optional(),
        next_page_token: z.string().optional(),
      }),
    )
    .max(100),
});
export async function dependencyAudit(
  baseline: { manifest: string | null; lock: string | null },
  head: { manifest: string | null; lock: string | null },
  fetcher: typeof fetch = fetch,
): Promise<Evidence[]> {
  const at = new Date().toISOString();
  const unavailable = (reason: string): Evidence[] => [
    {
      id: 'dependency-audit',
      kind: 'source',
      status: 'UNVERIFIED',
      claim: `Declared npm dependency audit unavailable: ${reason}. No package installation or scripts were executed.`,
    },
  ];
  try {
    const before = npmInventory(baseline.manifest, baseline.lock),
      after = npmInventory(head.manifest, head.lock);
    const inventory = [
      ...new Map(
        [...before, ...after].map((p) => [p.name + '@' + p.version, p]),
      ).values(),
    ];
    if (inventory.length > 100) return unavailable('COMPARISON_LIMIT');
    if (!inventory.length)
      return [
        {
          id: 'dependency-audit',
          kind: 'source',
          status: 'PASS',
          baselineStatus: 'PASS',
          claim: `Both manifests declare zero npm packages; no OSV request was necessary. This does not verify runtime/OS or source security. Audit npm-osv-v1 at ${at}.`,
        },
      ];
    const res = await fetcher('https://api.osv.dev/v1/querybatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: canonical({
        queries: inventory.map((p) => ({
          package: { name: p.name, ecosystem: 'npm' },
          version: p.version,
        })),
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return unavailable('OSV_HTTP_' + res.status);
    const bytes = await boundedBody(
      new Request('https://internal/', {
        method: 'POST',
        body: res.body,
        duplex: 'half',
      } as RequestInit),
      200000,
    );
    const result = responseSchema.parse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    if (
      result.results.length !== inventory.length ||
      result.results.some((r) => r.next_page_token)
    )
      return unavailable('INCOMPLETE_RESPONSE');
    const findings = (packages: typeof inventory) =>
      packages.flatMap((p) => {
        const i = inventory.findIndex(
          (x) => x.name === p.name && x.version === p.version,
        );
        return (result.results[i]!.vulns ?? []).map((v) => ({
          name: p.name,
          id: v.id,
          version: p.version,
          modified: v.modified,
        }));
      });
    const old = findings(before),
      current = findings(after);
    const identities = [
      ...new Set([...old, ...current].map((f) => f.name + ':' + f.id)),
    ].sort();
    const evidence: Evidence[] = [];
    for (const identity of identities) {
      const b = old.filter((f) => f.name + ':' + f.id === identity),
        h = current.filter((f) => f.name + ':' + f.id === identity);
      evidence.push({
        id: 'dependency-' + (await digest(identity)).slice(0, 24),
        kind: 'source',
        status: h.length ? 'FAIL' : 'PASS',
        baselineStatus: b.length ? 'FAIL' : 'PASS',
        path: 'package-lock.json',
        claim: `OSV npm advisory ${identity}; baseline versions ${b.map((f) => f.version).join(',') || 'none'}, submission versions ${h.map((f) => f.version).join(',') || 'none'}. ${b.length ? (h.length ? 'Pre-existing advisory remains.' : 'Baseline advisory removed from declared inventory.') : 'New advisory in declared inventory.'} Matching package metadata is confirmed; exploitability and actual installed artifacts require separate verification. npm-osv-v1 queried ${at}; response SHA-256 ${await digest(canonical(result))}.`,
      });
    }
    evidence.push({
      id: 'dependency-audit',
      kind: 'source',
      status: 'PASS',
      baselineStatus: 'PASS',
      claim: `OSV query completed for ${inventory.length} exact declared npm package/version pairs at ${at}; ${identities.length} advisory identities compared. No advisory match is not proof of vulnerability-free code. Inventory SHA-256 ${await digest(canonical({ before, after }))}; response SHA-256 ${await digest(canonical(result))}.`,
    });
    return evidence;
  } catch {
    return unavailable('INVALID_OR_UNAVAILABLE_INPUT');
  }
}
