import type { Evidence } from './domain';
import type { Context } from './evaluate';
const rules = [
  {
    id: 'dynamic-eval',
    pattern: /\b(?:eval|Function)\s*\(/g,
    description: 'dynamic JavaScript evaluation',
  },
  {
    id: 'shell-execution',
    pattern: /\b(?:exec|execSync)\s*\(/g,
    description: 'shell execution call',
  },
  {
    id: 'metadata-address',
    pattern: /169\.254\.169\.254|metadata\.google\.internal/g,
    description: 'cloud metadata destination',
  },
  {
    id: 'private-key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    description: 'private-key marker',
  },
];
export function sourceSecurity(context: Context): Evidence[] {
  const evidence: Evidence[] = [];
  for (const [path, source] of Object.entries(context.sources))
    for (const rule of rules) {
      const old = [...(source.baseline ?? '').matchAll(rule.pattern)],
        current = [...(source.head ?? '').matchAll(rule.pattern)];
      if (!old.length && !current.length) continue;
      const lines = current
        .slice(0, 10)
        .map((m) => source.head!.slice(0, m.index).split('\n').length);
      evidence.push({
        id: `security-pattern-${evidence.length}`,
        kind: 'source',
        status: 'UNVERIFIED',
        baselineStatus: old.length ? 'UNVERIFIED' : 'PASS',
        path,
        claim: `Source-security-patterns-v1 observed ${rule.description}: baseline ${old.length} occurrences, submission ${current.length}, submission lines ${lines.join(',') || 'none'}. This is a bounded source pattern, not a confirmed vulnerability or proof of exploitability. Inspect code context; removed patterns alone do not prove a security fix. Secret values are omitted.`,
      });
    }
  return evidence;
}
