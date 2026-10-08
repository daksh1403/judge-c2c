-- Queue admission and actual execution have independent deadlines. Frozen
-- attempt inputs and original expiry remain immutable. Claims are fenced.
ALTER TABLE actions_runner_jobs ADD COLUMN claimed_at INTEGER;
ALTER TABLE actions_runner_jobs ADD COLUMN dispatch_error TEXT;
CREATE INDEX actions_runner_jobs_request ON actions_runner_jobs(run_id,request_hash,synthetic);
