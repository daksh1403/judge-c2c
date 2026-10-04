# Confidential vulnerability reporting

Apply the organization database migrations before enabling this workflow. Organizers
can open **Confidential vulnerability reports** in the organization console. A dedicated
security reviewer may log in using the optional `ORG_SECURITY_TOKEN` Cloudflare secret;
that credential grants confidential report access only. It cannot configure GitHub,
modify competition state, or access normal judging/evaluation APIs. Keep the security
credential separate from organizer and judge credentials and share it only with the
security response team.

The private intake accepts a selected repository ID, title, impact/reproduction details
and up to five bounded text artifacts. Organizers and security reviewers can read the
reports/artifacts and append a reasoned review: TRIAGED, NEEDS_INFORMATION, CONFIRMED,
REJECTED or RESOLVED. The original report and all review history are immutable. An
unreviewed report is RECEIVED, which does not confirm exploitability.

Reports, private artifacts and review reasons use dedicated tables in ORG_DB. They are
never published as GitHub issues, normal evidence, general audit entries or AI inputs.
Every endpoint checks organizer/security authorization on the server; ordinary judges
and unauthenticated callers have no access. Mutations require the same origin, responses
are uncached, and artifact text is escaped before display rather than executed.

This is a restricted application intake, not GitHub private vulnerability-report
synchronization or anonymous participant intake. Participants should contact an organizer
privately to relay reports, or use GitHub private vulnerability reporting when enabled.
Never put sensitive reproduction details into public issues. Public issues already posted
on GitHub are outside this workflow's confidentiality guarantee. The synthetic tests do
not establish a live incident response process.
