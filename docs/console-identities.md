# Named console access and participant isolation

Apply migration `0021_console_identities.sql` to ORG_DB. An organizer can create a
named credential using **Named console access** in the organization console. Select
organizer, judge, security or participant. Participant access additionally requires
an active team ID. The credential is generated randomly, returned once, and stored
only as a SHA-256 hash. Share it privately with the intended person. Identity names,
roles and team scopes are immutable; changes require revoking the old credential and
issuing a new identity. Revocation deletes linked sessions and denies future logins.
Disqualified, inactive or archived teams cannot use participant credentials or existing
sessions.

The existing organization setup, judge and security secrets continue working for
bootstrap and compatibility. Named credentials provide individually revocable access
without giving participants an organizer secret. These are organizer-issued identities,
not verified GitHub OAuth accounts; the existing GitHub callbacks configure the App
and do not authenticate individual GitHub users.

The participant console reads only that team's submissions and evaluation history.
Evaluation reads require both the current submission team and the frozen evaluation
assignment team to match the authenticated scope. Request query parameters cannot
change that scope. It returns deterministic criterion outcomes; functional criteria
without trusted execution stay UNVERIFIED. Participants cannot access raw source,
reviewer traces, full reports, raw evidence, stored artifacts, private vulnerability
reports, other teams, organizer management or mutation APIs. The server checks these
permissions independently of the UI.

Organizer actions using named credentials are audited with the stable identity ID;
credential hashes and raw credentials are omitted from identity lists and audit entries.
Every credential/session response is uncached. Same-origin mutation guards, bounded
request bodies and the existing login rate limit also apply to named access. UI names
are escaped and participant controls remain read-only.

Local D1 tests exercise authentication, revocation, role denial and cross-team access.
Browser fixtures exercise escaped identity display, scoped outcomes and one-time
credential issuance/revocation UI. They are synthetic tests, not independent live
participant identities or a production authentication attestation.
