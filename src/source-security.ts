import type { Evidence } from './domain';
import type { Context } from './evaluate';
import { compareSecretObservations } from './secret-scanner';
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
  for (const [path, source] of Object.entries(context.sources))
    for (const finding of compareSecretObservations(
      source.baseline,
      source.head,
    )) {
      if (finding.baselineCount === 0 && finding.headCount === 0) continue;
      const complete = finding.comparisonComplete;
      const comparison = complete
        ? `comparison complete; ${finding.inheritedCount} inherited and ${finding.introducedCount} new observations`
        : 'comparison incomplete because baseline or submission content was unavailable, truncated, or contained an unterminated private-key marker; introduction and removal cannot be attributed';
      evidence.push({
        id: `security-secret-${evidence.length}`,
        kind: 'source',
        status: 'UNVERIFIED',
        baselineStatus:
          source.baseline !== null && finding.baselineCount === 0 && complete
            ? 'PASS'
            : 'UNVERIFIED',
        path,
        claim: `Source-secret-scan-v1 found ${finding.ruleId}: baseline ${finding.baselineCount} observations, submission ${finding.headCount}, submission lines ${finding.headLines.join(',') || 'none'}; ${comparison}. These bounded format heuristics are unverified observations, not proof of an exposed or exploitable credential. Secret values, snippets, and fingerprints are omitted.`,
      });
    }
  return evidence;
}
