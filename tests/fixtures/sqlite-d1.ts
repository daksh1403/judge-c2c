import { DatabaseSync } from 'node:sqlite';

// Fast workload simulation using the same SQLite SQL, constraints and triggers.
// Separate Miniflare tests prove the Worker/D1 isolate concurrency boundary.
export function sqliteD1() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  const db = {
    prepare(query: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...args: unknown[]) {
          values = args;
          return statement;
        },
        execute() {
          const result = sql.prepare(query).run(...(values as never[]));
          return {
            success: true,
            meta: { changes: Number(result.changes) },
            results: [],
          };
        },
        async run() {
          return statement.execute();
        },
        async first(column?: string) {
          const row = sql.prepare(query).get(...(values as never[]));
          return row ? (column ? row[column] : row) : null;
        },
        async all() {
          return {
            success: true,
            results: sql.prepare(query).all(...(values as never[])),
            meta: {},
          };
        },
      };
      return statement;
    },
    async batch(statements: { execute(): unknown }[]) {
      sql.exec('BEGIN');
      try {
        const results = statements.map((statement) => statement.execute());
        sql.exec('COMMIT');
        return results;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { db: db as unknown as D1Database, close: () => sql.close() };
}
