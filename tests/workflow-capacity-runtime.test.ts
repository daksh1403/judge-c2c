import { afterEach, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import { buildSync } from 'esbuild';
import { migrate } from './database';
import { canonical, digest } from '../src/domain';
import { demoContract } from '../src/demo';
import { EvaluationWorkflow } from '../src/workflow';
import { GitHub } from '../src/github';
import * as review from '../src/evaluate';
import { acquireReviewer, releaseReviewer } from '../src/reviewer-capacity';
import * as capacity from '../src/reviewer-capacity';
import * as store from '../src/store';
import type { Env } from '../src/env';
import type { WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
const id = 'c'.repeat(64),
  head = 'b'.repeat(40),
  ctx = {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext;
afterEach(() => vi.restoreAllMocks());

it.each(['renewal', 'transition'])(
  'does not start AI when retirement intervenes during reviewer %s',
  async (boundary) => {
    const mf = new Miniflare({
      modules: true,
      script: 'export default{}',
      d1Databases: ['DB'],
      compatibilityDate: '2026-08-01',
    });
    try {
      const db = (await mf.getD1Database('DB')) as unknown as D1Database;
      await seed(db);
      vi.spyOn(GitHub, 'installation').mockResolvedValue({
        compare: async () => [],
        file: async () => '## Scheduling',
        api: async (path: string) =>
          path.includes('/pulls/')
            ? { title: 'Fixture', body: '', head: { sha: head }, state: 'open' }
            : path.includes('check-runs?')
              ? { check_runs: [] }
              : path.includes('check-runs')
                ? { id: 7 }
                : { commits: [] },
      } as unknown as GitHub);
      const retire = async () => {
        await db.batch([
          db.prepare(
            "UPDATE organization_retirement SET state='RETIRING' WHERE id=1",
          ),
          db
            .prepare("UPDATE evaluations SET state='SUPERSEDED' WHERE id=?")
            .bind(id),
        ]);
      };
      if (boundary === 'renewal') {
        const original = capacity.renewReviewer;
        vi.spyOn(capacity, 'renewReviewer').mockImplementation(
          async (...args) => {
            await retire();
            return original(...args);
          },
        );
      } else {
        const original = store.transition;
        vi.spyOn(store, 'transition').mockImplementation(async (...args) => {
          if (args[2] === 'CHECKING' && args[3] === 'REVIEWING') await retire();
          return original(...args);
        });
      }
      const ai = vi.spyOn(review, 'aiReview');
      const env = {
        DB: db,
        ENVIRONMENT: 'local',
        EVALUATION_DETAILS_KIND: 'organization',
        AI_PROVIDER: 'callmissed',
        CALLMISSED_API_KEY: 'fixture-key',
      } as Env;
      const step = {
        do: async (
          _name: string,
          options: unknown,
          callback?: () => unknown,
        ) => (typeof options === 'function' ? options() : callback!()),
      } as unknown as WorkflowStep;
      await new EvaluationWorkflow(ctx, env).run(
        { payload: { runId: id } } as WorkflowEvent<{ runId: string }>,
        step,
      );
      expect(ai).not.toHaveBeenCalled();
      expect(
        await db
          .prepare('SELECT state,report FROM evaluations WHERE id=?')
          .bind(id)
          .first(),
      ).toEqual({ state: 'SUPERSEDED', report: null });
      expect(
        await db
          .prepare(
            "SELECT owner FROM reviewer_slots WHERE provider='callmissed'",
          )
          .first(),
      ).toBeNull();
      expect(
        await db
          .prepare(
            "SELECT count(*) n FROM timeline WHERE run_id=? AND state='REVIEWING'",
          )
          .bind(id)
          .first(),
      ).toEqual({ n: 0 });
    } finally {
      await mf.dispose();
    }
  },
);
async function seed(db: D1Database) {
  await migrate(db);
  const hash = await digest(canonical(demoContract));
  await db
    .prepare(
      'INSERT INTO repositories(id,full_name,installation_id,active_contract_hash) VALUES(1,?,1,?)',
    )
    .bind(demoContract.repository.fullName, hash)
    .run();
  await db
    .prepare('INSERT INTO contracts(hash,repository_id,document) VALUES(?,1,?)')
    .bind(hash, canonical(demoContract))
    .run();
  await db
    .prepare(
      "INSERT INTO teams(id,name,status) VALUES('team-runtime','Runtime fixture','ACTIVE')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO evaluations(id,repository_id,pr_number,head_sha,baseline_sha,contract_hash,contract_snapshot,assignment_snapshot,state) VALUES(?,1,24,?,?,?,?,?,'QUEUED')",
    )
    .bind(
      id,
      head,
      demoContract.baseline,
      hash,
      canonical(demoContract),
      canonical({ team_id: 'team-runtime' }),
    )
    .run();
  await db
    .prepare(
      'INSERT INTO submissions(repository_id,pr_number,head_sha,latest_run_id,github_updated_at,team_id,status) VALUES(1,24,?,?,?, ?,?)',
    )
    .bind(head, id, '2026-10-04T00:00:00Z', 'team-runtime', 'VALID')
    .run();
}
it('executes production prepare backoff and recovery in the real Miniflare Workflow engine', async () => {
  const script = buildSync({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
 import {EvaluationWorkflow} from './src/workflow.ts';
 import {GitHub} from './src/github.ts';
 export {EvaluationWorkflow};
 GitHub.installation=async(env)=>{
  const row=await env.DB.prepare('SELECT count(*) AS n FROM fixture_provider_attempts').first();
  await env.DB.prepare('INSERT INTO fixture_provider_attempts(at_ms) VALUES(?)').bind(Date.now()).run();
  if(row.n<2)throw Error('GITHUB_HTTP_503');
  return {compare:async()=>[],file:async()=> '## Scheduling',api:async(path)=>path.includes('/pulls/')?{title:'Fixture',body:'',head:{sha:'${head}'},state:'open'}:path.includes('check-runs?')?{check_runs:[]}:path.includes('check-runs')?{id:7}:{commits:[]}};
 };
 export default {async fetch(request,env){if(new URL(request.url).pathname==='/create'){const instance=await env.EVALUATOR.create({id:'${id}',params:{runId:'${id}'}});return Response.json(await instance.status());}return Response.json(await(await env.EVALUATOR.get('${id}')).status());}};
 `,
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    external: ['cloudflare:workers', 'node:*'],
  }).outputFiles[0]!.text;
  const runtime = new Miniflare({
    modules: true,
    script,
    compatibilityDate: '2026-08-01',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'],
    workflows: {
      EVALUATOR: { name: 'capacity-runtime', className: 'EvaluationWorkflow' },
    },
    bindings: { ENVIRONMENT: 'local' },
  });
  try {
    const db = (await runtime.getD1Database('DB')) as unknown as D1Database;
    await seed(db);
    await db
      .prepare('CREATE TABLE fixture_provider_attempts(at_ms INTEGER NOT NULL)')
      .run();
    await runtime.dispatchFetch('https://fixture.test/create');
    await vi.waitFor(
      async () => {
        const row = await db
          .prepare(
            'SELECT state,publication_status FROM evaluations WHERE id=?',
          )
          .bind(id)
          .first<{ state: string; publication_status: string }>();
        expect(row).toMatchObject({
          state: 'COMPLETED',
          publication_status: 'PUBLISHED',
        });
      },
      { timeout: 55000, interval: 250 },
    );
    const attempts = (
      await db
        .prepare('SELECT at_ms FROM fixture_provider_attempts ORDER BY rowid')
        .all<{ at_ms: number }>()
    ).results;
    expect(attempts.length).toBeGreaterThanOrEqual(3);
    // Real durable engine clocks: exponential delays are at least 10s then20s.
    expect(attempts[1]!.at_ms - attempts[0]!.at_ms).toBeGreaterThanOrEqual(
      9500,
    );
    expect(attempts[2]!.at_ms - attempts[1]!.at_ms).toBeGreaterThanOrEqual(
      19500,
    );
    const state = (await (
      await runtime.dispatchFetch('https://fixture.test/status')
    ).json()) as { status: string };
    expect(['running', 'complete']).toContain(state.status);
  } finally {
    await runtime.dispose();
  }
}, 65000);
it('releases an acquired AI lease when newer authoritative work supersedes the run before reasoning', async () => {
  const mf = new Miniflare({
    modules: true,
    script: 'export default{}',
    d1Databases: ['DB'],
    compatibilityDate: '2026-08-01',
  });
  try {
    const db = (await mf.getD1Database('DB')) as unknown as D1Database;
    await seed(db);
    const client = {
      compare: async () => [],
      file: async () => '## Scheduling',
      api: async (path: string) =>
        path.includes('/pulls/')
          ? { title: 'Fixture', body: '', head: { sha: head }, state: 'open' }
          : path.includes('check-runs?')
            ? { check_runs: [] }
            : path.includes('check-runs')
              ? { id: 7 }
              : { commits: [] },
    } as unknown as GitHub;
    vi.spyOn(GitHub, 'installation').mockResolvedValue(client);
    const ai = vi.spyOn(review, 'aiReview');
    const env = {
      DB: db,
      ENVIRONMENT: 'local',
      AI_PROVIDER: 'callmissed',
      CALLMISSED_API_KEY: 'fixture-key',
    } as Env;
    let observedLease = false;
    const step = {
      do: async (name: string, options: unknown, callback?: () => unknown) => {
        const value = await (typeof options === 'function'
          ? options()
          : callback!());
        if (name === 'reviewer-capacity') {
          observedLease = !!(await db
            .prepare(
              "SELECT owner FROM reviewer_slots WHERE provider='callmissed'",
            )
            .first());
          await db
            .prepare(
              'UPDATE submissions SET latest_run_id=?,head_sha=? WHERE repository_id=1 AND pr_number=24',
            )
            .bind('d'.repeat(64), 'e'.repeat(40))
            .run();
        }
        return value;
      },
    } as unknown as WorkflowStep;
    await new EvaluationWorkflow(ctx, env).run(
      { payload: { runId: id } } as WorkflowEvent<{ runId: string }>,
      step,
    );
    expect(observedLease).toBe(true);
    expect(ai).not.toHaveBeenCalled();
    expect(
      (await db
        .prepare('SELECT state FROM evaluations WHERE id=?')
        .bind(id)
        .first<{ state: string }>())!.state,
    ).toBe('SUPERSEDED');
    expect(
      await db
        .prepare("SELECT owner FROM reviewer_slots WHERE provider='callmissed'")
        .first(),
    ).toBeNull();
    const available = await acquireReviewer(db, 'callmissed');
    expect(available).not.toBeNull();
    await releaseReviewer(db, available!);
  } finally {
    await mf.dispose();
  }
});

it('fences obsolete active provider output and releases its lease after the active request returns', async () => {
  const mf = new Miniflare({
    modules: true,
    script: 'export default{}',
    d1Databases: ['DB'],
    compatibilityDate: '2026-08-01',
  });
  let release!: () => void;
  const active = new Promise<void>((resolve) => (release = resolve));
  try {
    const db = (await mf.getD1Database('DB')) as unknown as D1Database;
    await seed(db);
    const client = {
      compare: async () => [],
      file: async () => '## Scheduling',
      api: async (path: string) =>
        path.includes('/pulls/')
          ? { title: 'Fixture', body: '', head: { sha: head }, state: 'open' }
          : path.includes('check-runs?')
            ? { check_runs: [] }
            : path.includes('check-runs')
              ? { id: 7 }
              : { commits: [] },
    } as unknown as GitHub;
    vi.spyOn(GitHub, 'installation').mockResolvedValue(client);
    const original = review.aiReview;
    const ai = vi
      .spyOn(review, 'aiReview')
      .mockImplementation(async (env, contract, context, evidence) => {
        await active;
        return original(
          { ...env, CALLMISSED_API_KEY: undefined },
          contract,
          context,
          evidence,
        );
      });
    const env = {
      DB: db,
      ENVIRONMENT: 'local',
      AI_PROVIDER: 'callmissed',
      CALLMISSED_API_KEY: 'fixture-key',
    } as Env;
    const step = {
      do: async (_name: string, options: unknown, callback?: () => unknown) =>
        typeof options === 'function' ? options() : callback!(),
    } as unknown as WorkflowStep;
    const running = new EvaluationWorkflow(ctx, env).run(
      { payload: { runId: id } } as WorkflowEvent<{ runId: string }>,
      step,
    );
    await vi.waitFor(() => expect(ai).toHaveBeenCalledTimes(1));
    expect(await acquireReviewer(db, 'callmissed')).toBeNull();
    await db.batch([
      db
        .prepare(
          'UPDATE submissions SET latest_run_id=?,head_sha=? WHERE repository_id=1 AND pr_number=24',
        )
        .bind('d'.repeat(64), 'e'.repeat(40)),
      db
        .prepare("UPDATE evaluations SET state='SUPERSEDED' WHERE id=?")
        .bind(id),
    ]);
    // Cancellation is cooperative: in-flight external work holds its lease until return.
    expect(await acquireReviewer(db, 'callmissed')).toBeNull();
    release();
    await running;
    expect(
      await db
        .prepare("SELECT owner FROM reviewer_slots WHERE provider='callmissed'")
        .first(),
    ).toBeNull();
    const run = await db
      .prepare('SELECT state,report FROM evaluations WHERE id=?')
      .bind(id)
      .first<{ state: string; report: string | null }>();
    expect(run).toEqual({ state: 'SUPERSEDED', report: null });
    const next = await acquireReviewer(db, 'callmissed');
    expect(next).not.toBeNull();
    await releaseReviewer(db, next!);
  } finally {
    release?.();
    await mf.dispose();
  }
});

it('durably retries a transient mid-workflow D1 evidence write without losing prior evidence or inventing PASS', async () => {
  const script = buildSync({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
 import {EvaluationWorkflow as ProductionWorkflow} from './src/workflow.ts';
 import {GitHub} from './src/github.ts';
 GitHub.installation=async()=>({compare:async()=>[],file:async()=> '## Scheduling',api:async(path)=>path.includes('/pulls/')?{title:'Fixture',body:'',head:{sha:'${head}'},state:'open'}:path.includes('check-runs?')?{check_runs:[]}:path.includes('check-runs')?{id:7}:{commits:[]}});
 export class EvaluationWorkflow extends ProductionWorkflow {
  async run(event,step){
   const real=this.env.DB;
   this.env.DB={prepare(query){
    const wrap=(statement)=>new Proxy(statement,{get(target,key){
     if(key==='bind')return (...values)=>wrap(target.bind(...values));
     if(key==='run' && query.includes('UPDATE evaluations SET evidence=? WHERE id=? AND state='))return async()=>{
      const attempts=await real.prepare('SELECT count(*) n FROM fixture_d1_attempts').first();
      const prior=await real.prepare('SELECT state,evidence,report FROM evaluations WHERE id=?').bind('${id}').first();
      await real.prepare('INSERT INTO fixture_d1_attempts(at_ms,state,evidence,report) VALUES(?,?,?,?)').bind(Date.now(),prior.state,prior.evidence,prior.report).run();
      if(attempts.n===0)throw Error('D1_TRANSIENT_FIXTURE');
      return target.run();
     };
     const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
    }});return wrap(real.prepare(query));
   },batch(...args){return real.batch(...args);},exec(...args){return real.exec(...args);}};
   return super.run(event,step);
  }
 }
 export default {async fetch(request,env){if(new URL(request.url).pathname==='/create')return Response.json(await(await env.EVALUATOR.create({id:'${id}',params:{runId:'${id}'}})).status());return Response.json(await(await env.EVALUATOR.get('${id}')).status());}};
 `,
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    external: ['cloudflare:workers', 'node:*'],
  }).outputFiles[0]!.text;
  const runtime = new Miniflare({
    modules: true,
    script,
    compatibilityDate: '2026-08-01',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'],
    workflows: {
      EVALUATOR: {
        name: 'd1-recovery-runtime',
        className: 'EvaluationWorkflow',
      },
    },
    bindings: { ENVIRONMENT: 'local' },
  });
  try {
    const db = (await runtime.getD1Database('DB')) as unknown as D1Database;
    await seed(db);
    await db
      .prepare(
        'CREATE TABLE fixture_d1_attempts(at_ms INTEGER,state TEXT,evidence TEXT,report TEXT)',
      )
      .run();
    await runtime.dispatchFetch('https://fixture.test/create');
    await vi.waitFor(
      async () => {
        expect(
          await db
            .prepare('SELECT count(*) n FROM fixture_d1_attempts')
            .first(),
        ).toEqual({ n: 1 });
      },
      { timeout: 10000, interval: 100 },
    );
    const pending = await db
      .prepare('SELECT state,evidence,report FROM evaluations WHERE id=?')
      .bind(id)
      .first<{ state: string; evidence: string; report: string | null }>();
    expect(pending!.state).toBe('CHECKING');
    expect(pending!.report).toBeNull();
    const earlier = JSON.parse(pending!.evidence) as {
      id: string;
      kind: string;
      status: string;
    }[];
    expect(earlier.length).toBeGreaterThan(0);
    expect(
      earlier.some((e) => e.kind === 'execution' && e.status === 'PASS'),
    ).toBe(false);
    await vi.waitFor(
      async () => {
        expect(
          await db
            .prepare(
              'SELECT state,publication_status FROM evaluations WHERE id=?',
            )
            .bind(id)
            .first(),
        ).toEqual({ state: 'COMPLETED', publication_status: 'PUBLISHED' });
      },
      { timeout: 30000, interval: 200 },
    );
    const attempts = (
      await db.prepare('SELECT * FROM fixture_d1_attempts ORDER BY rowid').all<{
        at_ms: number;
        state: string;
        evidence: string;
        report: string | null;
      }>()
    ).results;
    expect(attempts).toHaveLength(2);
    expect(attempts[1]!.at_ms - attempts[0]!.at_ms).toBeGreaterThanOrEqual(
      14500,
    );
    expect(attempts[0]!.report).toBeNull();
    expect(attempts[1]!.evidence).toBe(attempts[0]!.evidence);
    const final = await db
      .prepare('SELECT evidence,failure_code FROM evaluations WHERE id=?')
      .bind(id)
      .first<{ evidence: string; failure_code: string | null }>();
    const recovered = JSON.parse(final!.evidence) as {
      id: string;
      kind: string;
      status: string;
    }[];
    for (const item of earlier) expect(recovered).toContainEqual(item);
    expect(new Set(recovered.map((e) => e.id)).size).toBe(recovered.length);
    expect(
      recovered.some((e) => e.kind === 'execution' && e.status === 'PASS'),
    ).toBe(false);
    expect(final!.failure_code).toBeNull();
    expect(
      await db
        .prepare(
          "SELECT count(*) n FROM timeline WHERE run_id=? AND state='COMPLETED'",
        )
        .bind(id)
        .first(),
    ).toEqual({ n: 1 });
  } finally {
    await runtime.dispose();
  }
}, 45000);
