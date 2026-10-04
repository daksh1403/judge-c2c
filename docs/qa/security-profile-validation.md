`security-profile-evidence.json` records real Docker positive and negative
execution of the organizer-configured ESLint `no-eval` security rule using the
existing prepared image. The JSON.parse fixture passes; the eval fixture fails
with exit 1 and the rule diagnostic. Hostile participant comments do not bypass
the check. Reproduce with `node scripts/security-profile-rehearsal.mjs`.

The same rehearsal executes the existing secret comparison and dependency audit
functions on controlled inputs. Secret observations distinguish introduced,
inherited, and missing-baseline cases without returning secret values. Advisory
comparison distinguishes pre-existing, removed, and introduced package/advisory
identities; a controlled HTTP 503 remains UNVERIFIED. No live OSV request was
made. Previous live timeout evidence is retained verbatim in the record.

49 focused tests passed across secret-scanner, dependency-audit, source-security,
and additional-contributions suites. The record includes test names and source
hashes. Contribution tests use SQLite and seeded execution evidence: they verify
immutable diff paths, optional criterion binding, baseline FAIL to submission
PASS, manual recognition, and rejection of source-only, missing baseline,
already-passing baseline, stale-head, policy/regression, closed, and identical
baseline/head cases. They do not establish a real participant contribution's
usefulness or award any credit.

The configured-profile conditions of 17.13 and 20.10 are positively and negatively
proved. 18.08 and 18.09 have bounded metadata/secret attribution evidence; actual
exploitability remains UNVERIFIED. 20.11 has controlled provider semantics but
live OSV remains UNVERIFIED after the previously recorded timeout. 18.12 has
controlled attribution and review guards; a live functional contribution and
organizer attribution decision remain unproved. No universal vulnerability,
secret-free-code, live scanner, or automatic-credit claim is made.
