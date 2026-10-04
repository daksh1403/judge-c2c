ALTER TABLE run_measurements RENAME TO old_run_measurements;
CREATE TABLE run_measurements (
 run_id TEXT NOT NULL REFERENCES evaluations(id),
 metric TEXT NOT NULL CHECK(metric IN ('evaluation.durationMs','evaluation.failure','evaluation.superseded','runner.durationMs','runner.startupMs','runner.cpuUsageUsec','runner.sampledMemoryBytes','runner.sampledPids','runner.failure','check.install.durationMs','check.scan.durationMs','check.test.durationMs','check.build.durationMs','check.lint.durationMs','check.typecheck.durationMs','check.benchmark.durationMs','ai.durationMs','ai.inputTokens','ai.outputTokens','ai.toolCalls','ai.retries','ai.finalResponseMicroUsd','cache.hit','cache.miss','cache.bypass','cache.context.hit','cache.context.miss')),
 value REAL NOT NULL CHECK(value>=0 AND value<=1000000000000),
 bucketUtcMinute INTEGER NOT NULL,
 PRIMARY KEY(run_id,metric)
);
INSERT INTO run_measurements SELECT * FROM old_run_measurements;
DROP TABLE old_run_measurements;
CREATE INDEX run_measurements_window ON run_measurements(bucketUtcMinute);
