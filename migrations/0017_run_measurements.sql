CREATE TABLE run_measurements (
  run_id TEXT NOT NULL REFERENCES evaluations(id),
  metric TEXT NOT NULL CHECK(metric IN ('evaluation.durationMs','evaluation.failure','evaluation.superseded','runner.durationMs','runner.failure','check.install.durationMs','check.scan.durationMs','check.test.durationMs','check.build.durationMs','check.lint.durationMs','check.typecheck.durationMs','check.benchmark.durationMs','ai.durationMs','ai.inputTokens','ai.outputTokens','ai.toolCalls','ai.retries','cache.hit','cache.miss','cache.bypass')),
  value REAL NOT NULL CHECK(value>=0 AND value<=1000000000),
  bucketUtcMinute INTEGER NOT NULL,
  PRIMARY KEY(run_id,metric)
);
CREATE INDEX run_measurements_window ON run_measurements(bucketUtcMinute);
