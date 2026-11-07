# Local seed script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local-only `npm run seed:local` command, and an importable module, that fill a workspace on the local test stack with client A's just-submitted case, ten office-entered scenario cases and one help request. Every case is built through the public RPCs as role-named accounts, and a re-run replaces the previous set.

**Architecture:**
- **`tools/admin/seed-cases.mjs`** is the module. It:
  - checks the target is the local test stack;
  - opens the privileged database connection;
  - acts as an account by setting the role and JWT claims inside one transaction per RPC call;
  - resolves the role accounts from the workspace;
  - deletes the previous run's rows listed in `.vitally-runs/`;
  - builds the eleven cases.
- **`tools/admin/seed.mjs`** is the command. It checks the opt-in flag, reads the roster file and prints counts.
- **No product code, SQL or migration changes.**

**Tech Stack:**
- Node 24 ES modules, `node:test`;
- `pg`, through `tools/admin/database.mjs`;
- the existing target guard `tools/admin/test-target.mjs`;
- the local Supabase test stack.

**Spec:**
- `openspec/changes/add-local-seed-script/specs/local-seed-data/spec.md`
- design: `openspec/changes/add-local-seed-script/design.md`, decisions D1 to D7
- decision log: `openspec/changes/add-local-seed-script/brainstorm.md`

## Global Constraints

- **Hosted projects can't be reached.** The module refuses any target whose approved `mode` isn't `"local"`, as `TARGET_REJECTED`. The command also requires `VITALLY_ALLOW_LOCAL_SEED=1`, checked before any file read or connection.
- **No addresses in output.** No email address appears in output, error messages or the run file.
- **Stage changes only through the RPCs.** Every case stage change goes through `public.vitally_create_case` / `public.vitally_apply_action`. The only direct insert is the help request.
- **Data:** fictional only.
- **Nothing outside this change is touched:** no migration, and no change under `supabase/`, `src/` (read-only import of `src/sample-data.mjs` is fine) or `server.mjs`.
- **Imports:** tools never import from `tests/`.
- **Line endings:** LF only. CI fails on CRLF.
- **Person keys:**
  - `site_coordinator`: `admin`, `followup`, `assist`, `receive_documents`;
  - `preparer`: `prepare`;
  - `reviewer`: `review`;
  - `intaker`: `receive_documents`, `assist`.
- **Run file:** `.vitally-runs/seed-<workspaceId>.json`, holding `{ "workspaceId", "caseIds": [], "assistanceIds": [] }`.
- **The CLI default roster:** `.vitally-roster.local.json`. Client A is `applicants[0]`.
- **Commits:** each ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A run that failed partway.** The next run must delete the partial set listed in the run file and seed a full one. Test in Task 4: a run file that lists one hand-made case id is cleaned.
2. **A run file naming ids from another workspace,** or ids that no longer exist. The seed deletes nothing outside its workspace, and missing ids aren't an error. Test in Task 3.
3. **An existing local roster with `client-b` second and the default follow-up still Sam.** Client A is still found. The seed refuses with the re-run-roster message and creates nothing. Test in Task 3.
4. **A workspace that also has presenter sample cases or app-made cases.** A re-seed leaves them untouched. Test in Task 4.
5. **A seeding step refused by the rules.** The error names the scenario and step, and the run file already lists what was created. Test in Task 4, by forcing one step to fail with a stubbed payload.

---

### Task 1: Prove the acting technique and build the RPC helpers

**Files:**
- Create: `tools/admin/seed-cases.mjs`
- Test: `tests/database-seed.mjs` (new suite; this task adds its first test)

**Interfaces:**
- Consumes:
  - `openDatabase(target)` and `databaseError(error)` from `tools/admin/database.mjs`;
  - the database fixture from `tests/support/database-fixture.mjs`, with the role-named accounts from the step-1 PR (`f.siteCoordinator`, `f.preparer`, `f.reviewer`, `f.applicantA`, `f.siteCoordinatorId`, `f.preparerId`, `f.reviewerId`, `f.applicantAEmail`, user ids as that PR names them).
- Produces:
  - `actAs(client: pg.Client, userId: string, fn: (client) => Promise<T>): Promise<T>`. It begins, runs `set local role authenticated`, runs `select set_config('request.jwt.claims', $1, true)` with `JSON.stringify({ sub: userId, role: "authenticated" })`, runs `fn`, and commits. On error it rolls back and rethrows the error mapped by `databaseError`.
  - `callRpc(client, userId, name: "vitally_create_case" | "vitally_apply_action", args: object): Promise<object>`. It calls `select public.<name>(<p_* => $n ...>) as result` inside `actAs` and returns `result`.
  - `applyAction(client, userId, caseId, type, payload = {}): Promise<object>`. It reads the case's current `revision` with the privileged connection, then calls `vitally_apply_action` with `p_action_id` set to a random UUID, `p_person_id: null` and the rest of the arguments.

- [ ] **Step 1: Confirm the prerequisite.** Run `git log origin/main --oneline -20` and confirm the step-1 fixture PR ("DB tests act as role-named staff accounts…") is merged. Run `git merge origin/main`. If it isn't merged, stop and report.
- [ ] **Step 2: Write the failing test** `"acting as a staff account goes through the RPC as that person"` in `tests/database-seed.mjs`. Use the fixture to build a ready case (`f.readyCase()`), call `applyAction(client, <preparer user id>, caseId, "CLAIM_PREPARATION")` with a client from `openDatabase()`, and assert:
  - the case's `preparer_id` equals `f.preparerId`;
  - its `stage` is `"preparing"`;
  - the newest `action_receipts` row for that case has `actor_person_id` equal to `f.preparerId`;
  - after the call, `select current_user` on the same client is the tooling's own role again (not `authenticated`).
- [ ] **Step 3: Run it to see it fail.** Run `node --env-file=.env.test --test tests/database-seed.mjs`. Expected: FAIL, `applyAction` is not exported.
- [ ] **Step 4: Implement `actAs`, `callRpc` and `applyAction`** as in the Interfaces block.
- [ ] **Step 5: Run it to see it pass.** Expected: PASS. **If it fails because the technique doesn't work** (for example `auth.uid()` is null, or `set role` is refused), switch to the design D1 fallback:
  - `actAs` gets a session for `userId` with the Auth admin API: `generateLink({ type: "magiclink" })`, then `verifyOtp` with the returned hashed token, on a publishable-key client;
  - the RPC is called with supabase-js.

  Record the switch in the ledger. Don't change any requirement.
- [ ] **Step 6: Commit.** `git add tools/admin/seed-cases.mjs tests/database-seed.mjs`, then `git commit` with message "Seed: act as an account through the public RPCs".

### Task 2: Local-only guard and the command

**Files:**
- Modify: `tools/admin/seed-cases.mjs`
- Create: `tools/admin/seed.mjs`
- Modify: `package.json` (`scripts`)
- Test: `tests/seed.test.mjs` (unit, no database)

**Interfaces:**
- Consumes: `assertTestTarget({ env, manifest })` from `tools/admin/test-target.mjs`. It returns the approved target with `mode`, `"local"` or `"hosted"`, and `databaseUrl`.
- Produces:
  - `assertLocalSeedTarget({ env, manifest, assert = assertTestTarget } = {}): Promise<approved>`. It throws `{ code: "TARGET_REJECTED" }`, using `rejected()` from `target-common.mjs`, unless `approved.mode === "local"`.
  - `requireSeedFlag(env): void`. It throws `{ code: "SEED_NOT_ALLOWED", message: "Set VITALLY_ALLOW_LOCAL_SEED=1 to seed the local test stack." }` unless `env.VITALLY_ALLOW_LOCAL_SEED === "1"`.
  - `parseSeedArgs(argv: string[]): { rosterPath: string }`. It accepts only `--roster <path>`, defaulting to `.vitally-roster.local.json`. Anything else throws `{ code: "SEED_USAGE" }` with the usage line `Usage: seed.mjs [--roster <file.json>]`.
  - `formatSeedResult({ casesRemoved, casesCreated }): string`. It returns `Seeded ${casesCreated} cases (removed ${casesRemoved} from the previous run).`
  - `package.json` gets the script `"seed:local": "node --env-file=.env.test tools/admin/seed.mjs"`.

- [ ] **Step 1: Write the failing unit tests** in `tests/seed.test.mjs`:
  - `requireSeedFlag({})` throws `SEED_NOT_ALLOWED`, and `requireSeedFlag({ VITALLY_ALLOW_LOCAL_SEED: "1" })` doesn't throw.
  - `assertLocalSeedTarget({ assert: async () => ({ mode: "hosted" }) })` rejects with `TARGET_REJECTED`.
  - `assertLocalSeedTarget({ assert: async () => { throw Object.assign(new Error(), { code: "TARGET_REJECTED" }); } })` rejects with `TARGET_REJECTED`.
  - With `{ mode: "local", databaseUrl: "postgres://x" }` it resolves to that object.
  - `parseSeedArgs([])` returns `{ rosterPath: ".vitally-roster.local.json" }`.
  - `parseSeedArgs(["--roster", "a.json"])` returns `{ rosterPath: "a.json" }`.
  - `parseSeedArgs(["--target", "x"])` and `parseSeedArgs(["--roster"])` throw `SEED_USAGE`.
  - `formatSeedResult({ casesRemoved: 11, casesCreated: 11 })` contains no `@`.
  - The command's ordering: importing `seed.mjs` and calling its exported `runSeed({ argv: [], env: {}, readFile: () => { throw new Error("read") }, seed: () => { throw new Error("seed") } })` rejects with `SEED_NOT_ALLOWED`, never "read" or "seed".
- [ ] **Step 2: Run them to see them fail.** Run `node --test tests/seed.test.mjs`. Expected: FAIL, missing exports.
- [ ] **Step 3: Implement the module exports, and `seed.mjs`.** `seed.mjs` exports `runSeed({ argv, env, readFile, seed })` and runs it when invoked directly. `runSeed`:
  1. calls `requireSeedFlag(env)`;
  2. parses the arguments;
  3. reads and JSON-parses the roster file (an unreadable file gives `SEED_ROSTER_UNREADABLE`);
  4. calls `seed({ workspaceId: roster.workspaceId, clientAEmail: roster.applicants?.[0] })`;
  5. prints `formatSeedResult`.

  On error it prints `${code}: ${message}` and exits non-zero. Add the npm script.
- [ ] **Step 4: Run them to see them pass.** Expected: PASS. Then run `npm test`; expected: all pass.
- [ ] **Step 5: Commit.** "Seed: local-only guard, opt-in flag and command".

### Task 3: Resolve the accounts and handle the run file

**Files:**
- Modify: `tools/admin/seed-cases.mjs`
- Test: `tests/database-seed.mjs`

**Interfaces:**
- Produces:
  - `resolveSeedTargets(client, { workspaceId, clientAEmail }): Promise<{ workspaceId, siteCoordinator: { userId, personId }, preparer: { userId, personId }, reviewer: { userId, personId }, clientA: { userId } }>`.
    - **Role accounts:** found as people with these keys in the workspace that have a non-null `user_id` and an active `staff` membership.
    - **Client A:** `auth.users` matched by lower-cased email, with an active `applicant` membership in the workspace.
    - **The follow-up default:** `workspaces.default_followup_person_id` must equal `siteCoordinator.personId`.
    - **Refusals:** `{ code: "SEED_SETUP" }` with one of these messages:
      - `The workspace has no staff account with the person key "<key>".`
      - `The roster's first applicant has no client account in this workspace.`
      - `The default follow-up person must be the "site_coordinator" account. Re-run the roster command with the current example roster.`
      - a missing `workspaceId` or `clientAEmail` is `SEED_SETUP` too.
  - `runFilePath(workspaceId, runDir = ".vitally-runs"): string`, giving `${runDir}/seed-${workspaceId}.json`.
  - `readRun(workspaceId, runDir): Promise<{ workspaceId, caseIds: string[], assistanceIds: string[] }>`. A missing file gives empty lists.
  - `deletePreviousRun(client, run): Promise<{ casesRemoved: number }>`:
    - `delete from public.assistance_items where workspace_id=$1 and id = any($2::uuid[])`;
    - then `delete from public.cases where workspace_id=$1 and id = any($2::uuid[]) returning id`;
    - `casesRemoved` is the number of rows returned.
  - `recordRun(run, runDir): Promise<void>`. It writes the file with `mkdir(..., { recursive: true, mode: 0o700 })`.

- [ ] **Step 1: Write the failing tests** in `tests/database-seed.mjs`:
  - **The happy path:** `"resolves the role accounts and client A"`. On the fixture workspace with the default follow-up set to the Site Coordinator (as the step-1 fixture does), the result's person ids equal `f.siteCoordinatorId`, `f.preparerId` and `f.reviewerId`.
  - **Missing role key:** `"refuses a missing role key"`. Use `f.initializeOwned` for a second workspace with only a preparer staff account, and expect `SEED_SETUP` with a message containing `site_coordinator`.
  - **Old follow-up default:** `"refuses when the default follow-up person is not the site coordinator"`. Set the default back to the Sam persona with `vitally_private.set_default_followup`. Expect `SEED_SETUP`, and assert the message doesn't contain `@`.
  - **No client account:** `"refuses when the first applicant has no account"`. Pass `clientAEmail: "nobody@example.org"`. Expect `SEED_SETUP`, and the message doesn't contain `nobody`.
  - **Other workspaces and missing ids:** `"deletePreviousRun deletes only listed rows in its own workspace"`. Make a case in the fixture workspace and one in the foreign workspace. The run lists both ids plus a random UUID. After the delete, the fixture case is gone, the foreign case remains, and `casesRemoved` is 1.
  - **Run file round trip:** `"readRun returns empty lists when there is no file"` and `"recordRun then readRun round-trips"`, using a temp `runDir` from `mkdtemp`.
- [ ] **Step 2: Run them to see them fail.** Run `node --env-file=.env.test --test tests/database-seed.mjs`. Expected: FAIL, missing exports.
- [ ] **Step 3: Implement the five exports** as in the Interfaces block.
- [ ] **Step 4: Run them to see them pass.** Expected: PASS.
- [ ] **Step 5: Commit.** "Seed: find the role accounts and replace the previous run".

### Task 4: Build the eleven cases and the help request

**Files:**
- Modify: `tools/admin/seed-cases.mjs`
- Create: `tools/admin/seed-values.mjs` (fictional answers, questionnaires and filing values)
- Test: `tests/database-seed.mjs`

**Interfaces:**
- Consumes: `actAs`, `callRpc`, `applyAction` (Task 1), `assertLocalSeedTarget` (Task 2), and `resolveSeedTargets`, `readRun`, `deletePreviousRun`, `recordRun` (Task 3). Also `makeSampleAnswers()` from `src/sample-data.mjs`.
- Produces:
  - `SEED_SCENARIOS`, a frozen array: `["client_received", "preparation_ready", "waiting_documents", "admin_followup", "review_ready", "corrections_required", "review_approved", "rejected", "accepted", "on_hold", "withdrawn"]`.
  - `seedCases(client, targets, { runDir }): Promise<{ casesRemoved, casesCreated, caseIdsByScenario: Record<string,string>, assistanceId: string }>`. It reads and deletes the previous run, then builds each scenario in order, appending each new id to the run and calling `recordRun` straight after the create. A refused step throws `{ code: "SEED_STEP_FAILED", message: "<scenario>: <ACTION_TYPE> was refused (<original code>)." }`.
  - `seedWorkspace({ workspaceId, clientAEmail, runDir = ".vitally-runs", env = process.env }): Promise<{ casesRemoved, casesCreated }>`. It calls `assertLocalSeedTarget({ env })`, then `openDatabase()`, `resolveSeedTargets` and `seedCases`, and closes the client in `finally`. This is what `seed.mjs` passes as `seed`.
  - `seed-values.mjs` exports:
    - `caseAnswers(index)`: `makeSampleAnswers()` with a distinct fictional first and last name per index;
    - `PREPARER_QUESTIONNAIRE` and `REVIEWER_QUESTIONNAIRE`: the same shapes and values as `PREPARER` / `REVIEWER` in `tests/support/database-fixture.mjs`, copied, not imported;
    - `DOCUMENT_REQUEST`: `{ title: "Mileage record", message: "Please send the fictional mileage log." }`;
    - `FILING_METHODS` and the result payloads. Copy the payload shapes from `tests/database-filing.mjs`, and use the reject code `"IND-031-04"` for the rejected state return;
    - `INTAKE_REQUESTS` and the hold payload. Copy the shapes from `tests/database-hold.mjs`.

**How each scenario is built:**
- `client_received`: as client A, `vitally_create_case` (`p_mode: "client"`), `SAVE_ANSWERS`, then `SUBMIT { confirmed: true }`.
- Office base, as the Site Coordinator: `vitally_create_case` (`p_mode: "assisted"`), `SAVE_ANSWERS`, then `SUBMIT`, which lands at `screening`, then `VERIFY_INTAKE` with the checks for the answers' service. The `preparation_ready` and `withdrawn` scenarios start from this.
- `waiting_documents`: the office base, then `CLAIM_PREPARATION` and `REQUEST_DOCUMENT` as the Preparer.
- `admin_followup`: the same, then `ESCALATE_CONTACT { requestId }` as the Preparer.
- `review_ready`: the office base, then `CLAIM_PREPARATION` and `SUBMIT_REVIEW { questionnaire }` as the Preparer. If `SUBMIT_REVIEW` refuses because the shaded section is missing, first run `SAVE_PREPARER_FIELDS`, with the shape from `tests/database-shaded.mjs`, as the Preparer.
- `corrections_required`: `review_ready`, then `CLAIM_REVIEW` and `REQUEST_CORRECTIONS` as the Reviewer.
- `review_approved`: `review_ready`, then `CLAIM_REVIEW` and `APPROVE_REVIEW { questionnaire }` as the Reviewer.
- `rejected`: `review_approved`, then, as the Site Coordinator, `MARK_READY_TO_EFILE { confirmed: true }`, `MARK_EFILED` with both returns e-filed, and `RECORD_FILING_RESULT` with federal accepted and state rejected.
- `accepted`: the same, except both returns are accepted.
- `on_hold`: a Site Coordinator walk-in up to `screening`, then `REQUEST_DOCUMENTS_AT_INTAKE`, which lands at `awaiting_documents`, then `PUT_ON_HOLD { confirmed: true }`.
- `withdrawn`: the office base, then `CLOSE_CASE { reason: "withdrawn" }` as the Site Coordinator.
- **The help request:** a privileged insert, as `seedAssistance` does in `tests/support/database-fixture.mjs`: status `open`, revision 1, no assignee, linked to client A's case, title "Client needs help completing intake forms", language "Mandarin". Its id goes in `assistanceIds`.

- [ ] **Step 1: Write the failing tests** in `tests/database-seed.mjs`:
  - `"seeds client A's case, ten office scenarios and one help request"`. Call `seedWorkspace({ workspaceId: f.workspaceId, clientAEmail: f.applicantAEmail, runDir })` once. Read the cases by `caseIdsByScenario` (via `seedCases`) with the privileged connection, and assert:
    - stages, in order: `received`, `preparation_ready`, `preparing`, `preparing`, `review_ready`, `corrections_required`, `review_approved`, `rejected`, `accepted`, `on_hold`, `closed`;
    - `owner_user_id` is client A only on `client_received`, and null elsewhere;
    - `preparer_id` is `f.preparerId` on `waiting_documents` through `accepted`, and null on `preparation_ready`;
    - `reviewer_id` is `f.reviewerId` on `review_approved` through `accepted`; on `corrections_required` it is null and the case's `corrections_requested` review names `f.reviewerId`;
    - `closing_reason` is `"withdrawn"` on `withdrawn`;
    - `admin_followup` has one open `admin_followups` row with `assignee_person_id` equal to `f.siteCoordinatorId`;
    - `waiting_documents` has one open `document_requests` row;
    - `rejected` has a `filing_returns` row with `return_kind` `"state"` and `result` `"rejected"`;
    - there's one open, unassigned help request on client A's case;
    - `casesCreated` is 11.
  - `"the receipts name the acting people"`. For `review_approved`, the receipts' `actor_person_id` values include `f.siteCoordinatorId`, `f.preparerId` and `f.reviewerId`.
  - `"a second run replaces the first and leaves other cases alone"`:
    1. before seeding, create one app case with `f.readyCase()`, and run `f.seedFixtures()` (presenter sample cases still exist at this step);
    2. seed twice;
    3. assert none of the first run's case ids exist, the run file lists only the second run's 11 ids, `casesRemoved` is 11, and the app case and sample cases still exist with unchanged `revision`.
  - `"a partial earlier run is cleaned up"`. Write a run file listing one case made with `f.readyCase()`, seed, and assert that case is gone and `casesCreated` is 11.
  - `"a refused step names the scenario and keeps the run file"`. Call `seedCases` with a values override that sends `REQUEST_DOCUMENT` with an empty title. Expect `SEED_STEP_FAILED` with a message starting `"waiting_documents: REQUEST_DOCUMENT"`, and check the run file lists the cases created before the failure. `seedCases` accepts an optional third-argument field `values` (default: the `seed-values.mjs` exports) for exactly this test.
- [ ] **Step 2: Run them to see them fail.** Run `node --env-file=.env.test --test tests/database-seed.mjs`. Expected: FAIL, `seedWorkspace` is not exported.
- [ ] **Step 3: Implement `seed-values.mjs`, `SEED_SCENARIOS`, `seedCases` and `seedWorkspace`,** as above.
- [ ] **Step 4: Run them to see them pass.** Expected: PASS for the whole file.
- [ ] **Step 5: Commit.** "Seed: build the client case, ten scenarios and the help request".

### Task 5: Example roster and docs

**Files:**
- Modify: `tools/admin/roster.example.json`
- Modify: `docs/setup.md` (section "Signing in locally", lines about the rehearsal roster and "Reset sample cases")
- Modify: `docs/developer/backend.md` (the "Privileged tooling" table and "The roster" example)
- Test: `tests/roster.test.mjs` (existing; add one test)

**Interfaces:**
- Consumes: `parseRoster` from `tools/admin/roster.mjs`, unchanged.

- [ ] **Step 1: Write the failing test** `"the example roster parses and names the role accounts"` in `tests/roster.test.mjs`. `parseRoster(JSON.parse(readFileSync("tools/admin/roster.example.json")))` succeeds, and:
  - its staff `personKey`s are exactly `["site_coordinator", "preparer", "reviewer", "intaker"]`, with the capabilities from Global Constraints;
  - `defaultFollowup` is `"site_coordinator"`;
  - `applicants` is `["client-a@example.org"]`;
  - `presenters` is `["presenter@example.org"]`.
- [ ] **Step 2: Run it to see it fail.** Run `node --test tests/roster.test.mjs`. Expected: FAIL on the person keys.
- [ ] **Step 3: Rewrite the example roster.** The staff addresses are `site-coordinator@example.org`, `preparer@example.org`, `reviewer@example.org` and `intaker@example.org`. The names are fictional and role-like: "Sky Chen (site coordinator)", "Rowan Diaz (preparer)", "Ari Novak (reviewer)", "Kai Mensah (intaker)". Keep `sampleCaseOwners` as `{ "preparation_ready": "client-a@example.org" }`.
- [ ] **Step 4: Run it to see it pass.** Expected: PASS. Then run `npm test`; expected: all pass.
- [ ] **Step 5: Update `docs/setup.md`:**
  - the rehearsal accounts list;
  - that the Intaker lands on the Work board until the roster change;
  - re-running the roster command after pulling;
  - "Seed the rehearsal cases" with `VITALLY_ALLOW_LOCAL_SEED=1 npm run seed:local`;
  - that a re-seed replaces the previous set;
  - seeding before opening the app, or reloading open windows afterwards;
  - "Reset sample cases" stays described as the presenter's tool until it's removed.
- [ ] **Step 6: Update `docs/developer/backend.md`.** Add `seed.mjs` and `seed-cases.mjs` rows to the Privileged tooling table: local test stack only, the opt-in flag, the run file under `.vitally-runs/`. Update the roster JSON example to the role accounts.
- [ ] **Step 7: Commit.** "Seed: role-named rehearsal roster and docs".

### Task 6: Verification

**Files:** none new.

- [ ] **Step 1:** `npm test`. Expected: all pass, including `tests/seed.test.mjs`.
- [ ] **Step 2:** `npm run db:migrate:test`, then `npm run test:database`. Expected: all pass. The total test count is the count before this change plus the new `database-seed` tests.
- [ ] **Step 3:** Re-run the roster command against the rehearsal workspace with the new example roster, as in `docs/setup.md`. Then run `VITALLY_ALLOW_LOCAL_SEED=1 npm run seed:local` twice. Expected output: `Seeded 11 cases (removed 0 from the previous run).`, then `Seeded 11 cases (removed 11 from the previous run).`, with no address.
- [ ] **Step 4:** Run `npm run seed:local` without the flag. Expected: `SEED_NOT_ALLOWED: …` and a non-zero exit.
- [ ] **Step 5:** `npm start`. Sign in as `preparer@example.org` (code from Mailpit), and confirm the Work board shows the Preparer's cases first. Sign in as `site-coordinator@example.org` and confirm the escalated follow-up and help request appear in Follow-ups.
- [ ] **Step 6:** `npx openspec validate --all`. Expected: all valid.
- [ ] **Step 7:** Tick every box in `openspec/changes/add-local-seed-script/tasks.md` that this run completed, and commit "Seed: tasks done".
