CREATE TABLE operational_metrics (
  bucketUtcMinute INTEGER NOT NULL CHECK(bucketUtcMinute >= 0 AND bucketUtcMinute % 60000 = 0),
  metric TEXT NOT NULL CHECK(metric IN ('github.request','github.error','github.rateLimited','github.latencyMs','webhook.request','webhook.error','webhook.latencyMs')),
  count INTEGER NOT NULL CHECK(count > 0),
  sum REAL NOT NULL CHECK(sum >= 0),
  max REAL NOT NULL CHECK(max >= 0),
  PRIMARY KEY(bucketUtcMinute, metric)
);
