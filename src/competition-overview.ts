// Counts are computed from the same authoritative tables used by detail views.
// Historical run totals and current submission totals are deliberately distinct.
export async function competitionOverview(db: D1Database) {
  return db
    .prepare(
      `SELECT
    (SELECT count(*) FROM github_repositories WHERE accessible=1) AS repositories,
    (SELECT count(*) FROM teams) AS teams,
    (SELECT count(*) FROM teams WHERE status='ACTIVE') AS activeTeams,
    (SELECT count(*) FROM teams WHERE status='WITHDRAWN') AS withdrawnTeams,
    (SELECT count(*) FROM teams WHERE status='DISQUALIFIED') AS disqualifiedTeams,
    (SELECT count(*) FROM teams t WHERE NOT EXISTS(SELECT 1 FROM submissions s WHERE s.team_id=t.id)) AS notSubmitted,
    (SELECT count(*) FROM teams t WHERE NOT EXISTS(SELECT 1 FROM issue_assignments a WHERE a.team_id=t.id AND a.status='ACTIVE')) AS noAssignedIssue,
    (SELECT count(*) FROM github_issues) AS issues,
    (SELECT count(*) FROM github_issues WHERE official=1) AS officialIssues,
    (SELECT count(*) FROM github_issues WHERE source='PARTICIPANT') AS participantRaisedIssues,
    (SELECT count(*) FROM github_issues WHERE review_status IN('NEEDS_TRIAGE','NEEDS_INFORMATION')) AS needsTriage,
    (SELECT count(*) FROM issue_assignments WHERE status='ACTIVE') AS activeAssignments,
    (SELECT count(*) FROM submissions WHERE closed=0) AS openSubmissions,
    (SELECT count(*) FROM submissions WHERE status NOT IN('VALID','CLOSED')) AS needsMapping,
    (SELECT count(*) FROM submissions) AS submissions,
    (SELECT count(*) FROM evaluations WHERE state='QUEUED') AS queuedRuns,
    (SELECT count(*) FROM evaluations WHERE state IN('FETCHING','CHECKING','REVIEWING','SYNTHESIZING')) AS runningRuns,
    (SELECT count(*) FROM evaluations WHERE state='COMPLETED') AS completedRuns,
    (SELECT count(*) FROM evaluations WHERE state='FAILED') AS failedRuns,
    (SELECT count(*) FROM evaluations WHERE state='SUPERSEDED') AS supersededRuns,
    (SELECT count(*) FROM submissions s JOIN evaluations e ON e.id=s.latest_run_id AND e.head_sha=s.head_sha WHERE e.state='COMPLETED') AS currentCompleted,
    (SELECT count(*) FROM submissions s LEFT JOIN evaluations e ON e.id=s.latest_run_id AND e.head_sha=s.head_sha WHERE s.closed=0 AND (s.status<>'VALID' OR e.state='FAILED' OR e.ai_status='FAILED' OR EXISTS(SELECT 1 FROM json_each(coalesce(e.evidence,'[]')) WHERE json_extract(value,'$.status') IN('FAIL','UNVERIFIED')))) AS needsAttention,
    (SELECT count(*) FROM management_inbox WHERE status IN('PENDING','PROCESSING')) AS pendingEvents,
    (SELECT count(*) FROM github_sync_actions WHERE status IN('BLOCKED','FAILED')) AS blockedSync`,
    )
    .first<Record<string, number>>();
}
