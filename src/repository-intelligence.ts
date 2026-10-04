import { z } from 'zod';
import { canonical, digest } from './domain';
import { redact } from './security';
import type { Context } from './evaluate';

export type RepositoryIntelligence = {
  version: 'repository-index-v2';
  scope: 'retrieved-source-only';
  status: 'UNVERIFIED';
  limitations: string[];
  files: {
    path: string;
    component: string;
    symbols: {
      name: string;
      line: number;
      exported: boolean;
      declaration: string;
    }[];
    added: string[];
    removed: string[];
    potentialApiChanges: {
      name: string;
      kind: 'REMOVED' | 'SIGNATURE_CHANGED';
    }[];
  }[];
};

function parseCache(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

const indexSchema = z
  .object({
    version: z.literal('repository-index-v2'),
    scope: z.literal('retrieved-source-only'),
    status: z.literal('UNVERIFIED'),
    limitations: z.array(z.string()).max(10),
    files: z
      .array(
        z
          .object({
            path: z.string(),
            component: z.string(),
            symbols: z
              .array(
                z
                  .object({
                    name: z.string(),
                    line: z.number().int().positive(),
                    exported: z.boolean(),
                    declaration: z.string().max(300),
                  })
                  .strict(),
              )
              .max(300),
            added: z.array(z.string()),
            removed: z.array(z.string()),
            potentialApiChanges: z.array(
              z
                .object({
                  name: z.string(),
                  kind: z.enum(['REMOVED', 'SIGNATURE_CHANGED']),
                })
                .strict(),
            ),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();

// This is a conservative declaration inventory, never a compiler/type/API verdict.
// No participant code, imports, package scripts or instructions are executed.
function declarations(path: string, source: string | null) {
  if (!source || !/\.(?:[cm]?[jt]sx?|py)$/.test(path)) return [];
  const symbols: RepositoryIntelligence['files'][number]['symbols'] = [];
  let inComment = false;
  let owner: { name: string; exported: boolean; depth: number } | undefined;
  let depth = 0;
  for (const [index, raw] of source.split('\n').entries()) {
    if (symbols.length >= 200) break;
    if (inComment) {
      if (raw.includes('*/')) inComment = false;
      continue;
    }
    if (raw.trimStart().startsWith('/*')) {
      inComment = !raw.includes('*/');
      continue;
    }
    const line = raw.trim();
    const match =
      /^(export\s+(?:default\s+)?)?(?:declare\s+)?(?:async\s+)?(function|class|interface|type|const|let|var|def)\s+([A-Za-z_$][\w$]*)/.exec(
        line,
      );
    const declaration = redact(line.split(/\s*(?:\{|=>|=\s*(?!>))/)[0]!).slice(
      0,
      300,
    );
    if (match) {
      const exported =
        !!match[1] || (path.endsWith('.py') && !match[3]!.startsWith('_'));
      symbols.push({ name: match[3]!, line: index + 1, exported, declaration });
      if (['class', 'interface'].includes(match[2]!) && line.includes('{'))
        owner = { name: match[3]!, exported, depth };
    } else if (owner && depth === owner.depth + 1) {
      const method =
        /^(?:(?:public|private|protected|static|async|abstract|readonly|override|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\(/.exec(
          line,
        );
      if (
        method &&
        !['if', 'for', 'while', 'switch', 'catch'].includes(method[1]!)
      )
        symbols.push({
          name: owner.name + '.' + method[1],
          line: index + 1,
          exported: owner.exported && !/^(?:private|protected)\s/.test(line),
          declaration,
        });
    }
    const exports = /^export\s*\{([^}]+)\}(?:\s*from\s*['"]([^'"]+)['"])?/.exec(
      line,
    );
    if (exports)
      for (const part of exports[1]!.split(',').slice(0, 100)) {
        const named =
          /^\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(
            part,
          );
        if (named)
          symbols.push({
            name: named[2] ?? named[1]!,
            line: index + 1,
            exported: true,
            declaration:
              'export ' +
              named[1] +
              ' as ' +
              (named[2] ?? named[1]) +
              (exports[2] ? ' from ' + redact(exports[2]) : ''),
          });
      }
    // Brace tracking is advisory; strings and complex syntax may limit inventory coverage.
    depth +=
      (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
    if (owner && depth <= owner.depth) owner = undefined;
  }
  return symbols;
}

export function buildRepositoryIntelligence(
  context: Pick<Context, 'sources'>,
): RepositoryIntelligence {
  return {
    version: 'repository-index-v2',
    scope: 'retrieved-source-only',
    status: 'UNVERIFIED',
    limitations: [
      'Bounded lexical declaration inventory; not a symbol graph, parser or compatibility proof.',
      'Only retrieved files are covered; re-exports, overloads, multiline declarations and inferred types may be missed.',
      'Potential API changes require trusted compatibility checks before any functional conclusion.',
    ],
    files: Object.entries(context.sources)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, source]) => {
        const old = declarations(path, source.baseline),
          symbols = declarations(path, source.head);
        return {
          path,
          component: path.includes('/')
            ? path.slice(0, path.lastIndexOf('/'))
            : '.',
          symbols,
          added: symbols
            .filter((s) => !old.some((o) => o.name === s.name))
            .map((s) => s.name),
          removed: old
            .filter((o) => !symbols.some((s) => s.name === o.name))
            .map((o) => o.name),
          potentialApiChanges: old
            .filter((o) => o.exported)
            .flatMap<
              RepositoryIntelligence['files'][number]['potentialApiChanges'][number]
            >((o) => {
              const next = symbols.find((s) => s.name === o.name && s.exported);
              return !next
                ? [{ name: o.name, kind: 'REMOVED' as const }]
                : next.declaration !== o.declaration
                  ? [{ name: o.name, kind: 'SIGNATURE_CHANGED' as const }]
                  : [];
            }),
        };
      }),
  };
}

export async function repositoryIndex(
  db: D1Database,
  repositoryId: number,
  baseline: string,
  head: string,
  context: Pick<Context, 'sources'>,
) {
  const key = await digest(
    canonical({
      version: 'repository-index-v2',
      repositoryId,
      baseline,
      head,
      sources: await Promise.all(
        Object.entries(context.sources)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(async ([path, s]) => ({
            path,
            baseline: s.baseline === null ? null : await digest(s.baseline),
            head: s.head === null ? null : await digest(s.head),
          })),
      ),
    }),
  );
  const stored = await db
    .prepare(
      'SELECT payload,payload_hash FROM repository_context_indexes WHERE cache_key=?',
    )
    .bind(key)
    .first<{ payload: string; payload_hash: string }>();
  const cached =
    stored && (await digest(stored.payload)) === stored.payload_hash
      ? indexSchema.safeParse(parseCache(stored.payload))
      : null;
  if (
    cached?.success &&
    cached.data.files.map((f) => f.path).join('\0') ===
      Object.keys(context.sources)
        .sort((a, b) => a.localeCompare(b))
        .join('\0')
  )
    return {
      index: cached.data,
      cache: { key, hit: true, version: cached.data.version },
    };
  const index = buildRepositoryIntelligence(context),
    payload = redact(canonical(index));
  await db
    .prepare(
      'INSERT OR IGNORE INTO repository_context_indexes(cache_key,repository_id,baseline_sha,head_sha,payload,payload_hash) VALUES(?,?,?,?,?,?)',
    )
    .bind(key, repositoryId, baseline, head, payload, await digest(payload))
    .run();
  return {
    index: JSON.parse(payload) as RepositoryIntelligence,
    cache: { key, hit: false, version: index.version },
  };
}
