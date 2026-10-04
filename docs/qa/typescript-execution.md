The separate `runner/Dockerfile.typescript` image adds TypeScript 7.0.2, the
repository's existing pinned version, using a dedicated immutable lock catalogue.
Its base is the original prepared image digest. The original tag, package
catalogue, payment contracts, and prior evidence are preserved.

Reproduce from the repository root:

```sh
docker build -f runner/Dockerfile.typescript -t judge-c2c-runner-typescript runner
node scripts/typescript-docker-rehearsal.mjs
```

The actual guest records in `typescript-docker-evidence.json` show compiler
version 7.0.2, successful strict no-emit compilation of a number assignment, and
exit failure with TS2322 for a string assigned to a number. Both guest services
also pass the health contract. Participant comments asking to bypass compilation
remain data. Execution uses the existing network-disabled, unprivileged,
resource-bounded Docker boundary. No participant dependency install occurs.

This is local synthetic compiler validation for checklist 20.07. It does not
retroactively satisfy a frozen contract using the original image: that image's
missing compiler remains UNVERIFIED infrastructure in the earlier profile
evidence. This optional image has not been deployed to the review or production
runner. No live vulnerability-provider claim is made.
