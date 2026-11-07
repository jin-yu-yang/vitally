## 1. Prerequisites and proof of technique

- [x] 1.1 Confirm the step-1 fixture PR (role-named staff accounts in `tests/support/database-fixture.mjs`) is merged into `main`, and merge `main` into this branch. Stop if it isn't merged.
- [x] 1.2 Prove design D1: on the local test stack, call one public RPC inside a transaction acting as a staff account (`set local role authenticated` plus request JWT claims). Confirm `auth.uid()`, the acting person and the receipt are that account's. If it fails, switch to the D1 fallback (Auth admin sessions) and record that in the plan's ledger.

## 2. Guard and command

- [x] 2.1 The module's target check: `assertTestTarget`, plus a refusal of any non-local mode as `TARGET_REJECTED`. Unit tests for a hosted test target and a non-loopback target.
- [x] 2.2 `tools/admin/seed.mjs`:
  - parses `--roster`, with the default and unknown-flag refusal;
  - checks `VITALLY_ALLOW_LOCAL_SEED=1` before any file or network access;
  - prints counts only.

  Unit tests for the missing flag, the arguments, and output containing no address.
- [x] 2.3 Add the `seed:local` npm script.

## 3. Seed module

- [x] 3.1 Resolve the workspace and accounts from the roster file:
  - the three role keys, each with an active staff membership;
  - client A as the first applicant, looked up in the database;
  - the default follow-up person must be `site_coordinator`;
  - refusals name keys or settings, never addresses.
- [x] 3.2 The run file `.vitally-runs/seed-<workspaceId>.json`: read; delete the listed rows limited to the workspace; write as each item is created.
- [x] 3.3 Fictional values: case answers built on `makeSampleAnswers()` with a distinct fictional client per case; preparer and reviewer questionnaire values; filing values (methods, results, a fictional reject code). Save fictional 13614-C shaded fields first if submitting for review requires them.
- [x] 3.4 Build client A's `received` case and the ten office scenarios through the public RPCs, as listed in the spec and design D5. A refused step stops with the scenario and step named.
- [x] 3.5 Insert the one open help request linked to client A's case.

## 4. Database tests

- [x] 4.1 A new `tests/database-seed.mjs`. On a throwaway fixture workspace with the role accounts, seed once and assert:
  - the eleven stages, owners, preparers and reviewers;
  - the follow-up assigned to the Site Coordinator;
  - the open help request;
  - receipts naming the acting persons.
- [x] 4.2 Seed again and assert:
  - exactly one set remains;
  - the run file lists only the second run's ids;
  - a case created outside the seed is untouched.
- [x] 4.3 Assert the refusals:
  - a missing role key;
  - a default follow-up person that isn't `site_coordinator`;
  - a missing first applicant;
  - in each case, nothing is created or deleted.

## 5. Example roster and docs

- [x] 5.1 `tools/admin/roster.example.json`:
  - the four role accounts, with `defaultFollowup` set to `site_coordinator`;
  - client B dropped;
  - the presenter and `sampleCaseOwners` kept.

  Check that `tests/roster.test.mjs` and the roster command still accept it.
- [x] 5.2 `docs/setup.md`, the rehearsal section:
  - the new accounts, including that the Intaker lands on the Work board until the roster change;
  - re-running the roster command;
  - `VITALLY_ALLOW_LOCAL_SEED=1 npm run seed:local`;
  - seeding before opening the app, or reloading afterwards.
- [x] 5.3 `docs/developer/backend.md`: the privileged tooling table (`seed.mjs`, `seed-cases.mjs`) and the roster example.

## 6. Verification

- [x] 6.1 `npm test` passes.
- [x] 6.2 `npm run db:migrate:test`, then `npm run test:database`, passes with no drop in the test count.
- [x] 6.3 Run `VITALLY_ALLOW_LOCAL_SEED=1 npm run seed:local` twice against the rehearsal workspace. Confirm the counts and sign in as Preparer to see their cases.
- [x] 6.4 `npx openspec validate --all` passes.
