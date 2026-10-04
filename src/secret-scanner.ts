export const MAX_SECRET_SCAN_BYTES = 100_000;
export const MAX_SECRET_FINDINGS_PER_SOURCE = 200;

export type SecretRuleId =
  | 'github-token'
  | 'aws-access-key-id'
  | 'private-key-block'
  | 'private-key-marker'
  | 'key-assignment';

export type SecretComparison = {
  ruleId: SecretRuleId;
  baselineCount: number;
  baselineLines: number[];
  headCount: number;
  headLines: number[];
  introducedCount: number | null;
  inheritedCount: number | null;
  comparisonComplete: boolean;
};

type Candidate = { ruleId: SecretRuleId; line: number; value: string };
type ScanResult = { candidates: Candidate[]; complete: boolean };

const rules: {
  id: SecretRuleId;
  pattern: RegExp;
}[] = [
  {
    id: 'github-token',
    pattern:
      /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  },
  { id: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  {
    id: 'key-assignment',
    pattern:
      /["']?\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|github[_-]?token|client[_-]?secret|secret[_-]?key|aws[_-]?secret[_-]?access[_-]?key|aws[_-]?access[_-]?key[_-]?id|password|passwd|private[_-]?key|credential|bearer[_-]?token)\b["']?\s*[:=]\s*(?:"([^"\r\n]{8,512})"|'([^'\r\n]{8,512})'|([A-Za-z0-9+/_=-]{8,512}))/gi,
  },
];

const privateBlock =
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----[ \t]*\r?\n[\s\S]{1,16384}?-----END (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g;
const privateMarker =
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g;
const placeholder =
  /^(?:\$\{[^}]+\}|\$[A-Z_][A-Z0-9_]*|<[^>]+>|your[_ -].*|replace[_ -].*|change[_ -]?me|example|sample|dummy|test|redacted|none|null|undefined)$/i;

function lineNumber(text: string, index: number) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function collect(text: string | null): ScanResult {
  if (text === null) return { candidates: [], complete: false };
  const prefix = text.slice(0, MAX_SECRET_SCAN_BYTES);
  const encoded = new TextEncoder().encode(prefix);
  const bounded = new TextDecoder('utf-8', {
    fatal: false,
    ignoreBOM: true,
  }).decode(encoded.slice(0, MAX_SECRET_SCAN_BYTES));
  let complete =
    prefix.length === text.length &&
    encoded.byteLength <= MAX_SECRET_SCAN_BYTES;
  const candidates: Candidate[] = [];
  const add = (ruleId: SecretRuleId, index: number, value: string) => {
    const secret = value.trim();
    if (!secret || placeholder.test(secret)) return;
    if (candidates.length >= MAX_SECRET_FINDINGS_PER_SOURCE) {
      complete = false;
      return;
    }
    candidates.push({
      ruleId,
      line: lineNumber(bounded, index),
      value: secret,
    });
  };

  const blockRanges: { start: number; end: number }[] = [];
  for (const match of bounded.matchAll(privateBlock)) {
    const index = match.index!;
    add('private-key-block', index, match[0]);
    blockRanges.push({ start: index, end: index + match[0].length });
  }
  for (const match of bounded.matchAll(privateMarker)) {
    const index = match.index!;
    if (blockRanges.some((range) => index >= range.start && index < range.end))
      continue;
    add('private-key-marker', index, match[0]);
    complete = false;
  }
  for (const rule of rules) {
    for (const match of bounded.matchAll(rule.pattern)) {
      const value =
        rule.id === 'key-assignment'
          ? (match[1] ?? match[2] ?? match[3] ?? '')
          : match[0];
      add(rule.id, match.index!, value);
    }
  }
  return { candidates, complete };
}

/**
 * Compares baseline and head observations in memory. Opaque fingerprints exist
 * only for this comparison and never leave the function.
 */
export function compareSecretObservations(
  baseline: string | null,
  head: string | null,
): SecretComparison[] {
  const oldScan = collect(baseline);
  const headScan = collect(head);
  const fingerprintSalt = crypto.randomUUID();
  let nextFingerprint = 0;
  const fingerprints = new Map<string, string>();
  const fingerprint = (value: string) => {
    let id = fingerprints.get(value);
    if (!id) {
      id = `${fingerprintSalt}:${++nextFingerprint}`;
      fingerprints.set(value, id);
    }
    return id;
  };
  const oldByRule = new Map<SecretRuleId, Map<string, number>>();
  for (const candidate of oldScan.candidates) {
    const values = oldByRule.get(candidate.ruleId) ?? new Map<string, number>();
    const id = fingerprint(candidate.value);
    values.set(id, (values.get(id) ?? 0) + 1);
    oldByRule.set(candidate.ruleId, values);
  }
  const headByRule = new Map<SecretRuleId, Candidate[]>();
  for (const candidate of headScan.candidates) {
    const values = headByRule.get(candidate.ruleId) ?? [];
    values.push(candidate);
    headByRule.set(candidate.ruleId, values);
  }
  const ruleIds = new Set<SecretRuleId>([
    ...oldByRule.keys(),
    ...headByRule.keys(),
  ]);
  return [...ruleIds].map((ruleId) => {
    const old = oldByRule.get(ruleId) ?? new Map<string, number>();
    const headItems = headByRule.get(ruleId) ?? [];
    let introduced = 0;
    let inherited = 0;
    for (const item of headItems) {
      const id = fingerprint(item.value);
      const count = old.get(id) ?? 0;
      if (count > 0) {
        inherited++;
        old.set(id, count - 1);
      } else introduced++;
    }
    const oldItems = oldScan.candidates.filter(
      (candidate) => candidate.ruleId === ruleId,
    );
    const complete = oldScan.complete && headScan.complete;
    return {
      ruleId,
      baselineCount: oldItems.length,
      baselineLines: oldItems.map((candidate) => candidate.line).slice(0, 20),
      headCount: headItems.length,
      headLines: headItems.map((candidate) => candidate.line).slice(0, 20),
      introducedCount: complete ? introduced : null,
      inheritedCount: complete ? inherited : null,
      comparisonComplete: complete,
    };
  });
}
