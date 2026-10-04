import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  buildRepositoryIntelligence,
  repositoryIndex,
} from '../src/repository-intelligence';

const sources = {
  'src/api.ts': {
    baseline:
      'export function before(x: string): number { return 1; }\nexport function gone(): void {}',
    head: 'export function before(x: number): number { return 1; }\nexport const added = 2;\n/*\nexport function fabricated() {}\n*/',
  },
};
it('inventories changes and flags potential exported signature breaks without claiming compatibility proof', () => {
  const index = buildRepositoryIntelligence({ sources });
  expect(index.status).toBe('UNVERIFIED');
  expect(index.scope).toBe('retrieved-source-only');
  expect(index.files[0]).toMatchObject({
    component: 'src',
    added: ['added'],
    removed: ['gone'],
    potentialApiChanges: [
      { name: 'before', kind: 'SIGNATURE_CHANGED' },
      { name: 'gone', kind: 'REMOVED' },
    ],
  });
  expect(index.files[0]!.symbols.map((s) => s.name)).not.toContain(
    'fabricated',
  );
  expect(index.limitations.join(' ')).toContain('not a symbol graph');
});

it('reuses immutable source-hash keyed indexes and isolates repository, commit and source changes', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(
    readFileSync('migrations/0016_repository_context_indexes.sql', 'utf8'),
  );
  const db = {
    prepare(query: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...args: unknown[]) {
          values = args;
          return statement;
        },
        async first() {
          return sql.prepare(query).get(...(values as never[])) ?? null;
        },
        async run() {
          return sql.prepare(query).run(...(values as never[]));
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  const first = await repositoryIndex(db, 1, 'a'.repeat(40), 'b'.repeat(40), {
    sources,
  });
  expect(first.cache.hit).toBe(false);
  const second = await repositoryIndex(db, 1, 'a'.repeat(40), 'b'.repeat(40), {
    sources,
  });
  expect(second.cache.hit).toBe(true);
  expect(second.index).toEqual(first.index);
  for (const [repo, head, text] of [
    [2, 'b'.repeat(40), sources],
    [1, 'c'.repeat(40), sources],
    [
      1,
      'b'.repeat(40),
      { 'src/api.ts': { baseline: '', head: 'export function changed() {}' } },
    ],
  ] as const) {
    const result = await repositoryIndex(db, repo, 'a'.repeat(40), head, {
      sources: text,
    });
    expect(result.cache.hit).toBe(false);
    expect(result.cache.key).not.toBe(first.cache.key);
  }
  expect(() =>
    sql.prepare("UPDATE repository_context_indexes SET payload='{}'").run(),
  ).toThrow(/immutable/);
  expect(() =>
    sql.prepare('DELETE FROM repository_context_indexes').run(),
  ).toThrow(/immutable/);
  sql.close();
});

it('tracks realistic exported class methods and named re-exports without treating private members as public API', () => {
  const context = {
    sources: {
      'api.ts': {
        baseline:
          'export class Client {\n  send(id: string): void {\n  }\n  private secret(): void {\n  }\n}\nexport { Client as PublicClient } from "./client";',
        head: 'export class Client {\n  send(id: number): void {\n  }\n  private secret(changed: number): void {\n  }\n}\nexport { Client as NewClient } from "./client";',
      },
    },
  };
  const file = buildRepositoryIntelligence(context).files[0]!;
  expect(file.symbols.map((s) => s.name)).toContain('Client.send');
  expect(file.symbols.map((s) => s.name)).toContain('NewClient');
  expect(file.potentialApiChanges).toContainEqual({
    name: 'Client.send',
    kind: 'SIGNATURE_CHANGED',
  });
  expect(file.potentialApiChanges).toContainEqual({
    name: 'PublicClient',
    kind: 'REMOVED',
  });
  expect(file.potentialApiChanges.map((c) => c.name)).not.toContain(
    'Client.secret',
  );
});
