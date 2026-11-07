## Context

Rehearsals and the browser story get known cases today from "Reset sample cases":
- **The function:** `vitally_reset_fixtures`, defined in migration 009 and last redefined in 039. It's presenter-only.
- **How it works:** it rebuilds ten sample cases and a sample help request through private SQL (`apply_fixture_scenario`), writing stages directly.
- **Why it has to go:** presenter mode is being removed in small steps, and step 6 removes this tool. The local stack needs a replacement before then.

Where things stand:
- **Staff accounts exist.** Real per-person accounts sign in and act as their own person (038).
- **The privileged tooling is ready to build on.** It lives in `tools/admin/`, is guard-first, and connects to the database with the test or classroom credentials.
- **The fixture is changing.** A preceding tests-only PR moves `tests/support/database-fixture.mjs` to role-named staff accounts.
- **There's no hosted project.** Everything here runs against the local Docker stack.

Constraints:
- No migration.
- No change to product behaviour, screens or RPCs.
- Fictional data only.
- Tools never import from `tests/`.
- An email address is never printed.

People affected:
- Developers rehearsing locally.
- The browser story (step 3), which will call the same module.
- The later analytics change, which may extend the seed with a full season.

## Goals / Non-Goals

**Goals:**
- One command puts a local rehearsal workspace into a known state: client A's just-submitted case, ten office-entered scenario cases and one open help request. Each case is held by the role account its stage needs.
- Every case is built through the public RPCs, so it obeys the same rules as a case made in the app.
- The command can't run against a hosted project, test or otherwise.
- A re-run replaces the previous set.
- A module that test fixtures can call on their own throwaway workspaces.

**Non-Goals:**
- Removing the sample-case tools or the roster's `sampleCaseOwners` (step 6).
- Changing the browser story (step 3).
- A full fictional season with backdated history (`add-office-analytics`).
- Removing presenter access or screens (steps 5 and 7).
- Telling open windows about a re-seed.

## Decisions

### D1: Build cases through the public RPCs, acting as each account inside a database transaction
- **Choice:** For each step, the seed opens a transaction on its privileged connection, then:
  1. switches to the `authenticated` role with `set local role authenticated`;
  2. sets the request's JWT claims to the acting account's user id (`set_config('request.jwt.claims', ..., true)`), which `auth.uid()` reads;
  3. calls the public RPC (`vitally_create_case`, `vitally_apply_action`) and commits.

  Each RPC runs exactly as it does for a signed-in browser: the same membership lookup, acting person, checks, receipt and history.
- **Why:** The product's rules apply to seeded cases, so a seeded case can't reach a state the app couldn't produce, and the seed keeps working as the rules change. It needs no passwords, no sign-in email and no Auth API calls per step.
- **Alternatives considered:**
  - Private SQL writing stages directly, like today's `apply_fixture_scenario`. Rejected: it duplicates the state machine, had to be redefined in ten migrations, and needs a migration of its own.
  - Signing in each account through the Auth API (a generated magic-link token verified server-side) and calling the RPCs with supabase-js. This is kept as the **fallback** if the transaction technique doesn't work on this stack. The plan's first task proves the technique, and switching to the fallback doesn't change any requirement.

### D2: Local stack only, with two checks in different places
- **Choice:**
  - **The module:** before it opens anything, it runs `assertTestTarget` and also requires the approved target to be the local mode. A hosted test project (`VITALLY_TEST_MODE=hosted`) is refused as `TARGET_REJECTED`.
  - **The command:** it also requires `VITALLY_ALLOW_LOCAL_SEED=1`, checked first, before any file or network access.
- **Why:**
  - `assertTestTarget` on its own also approves a hosted test project, which the user's rule ("refuses unless the target is the local test stack") excludes.
  - The flag makes a person opt in deliberately at the command line, without forcing every test run to set it.
  - `TARGET_REJECTED` without saying which check failed matches the other privileged tools.
- **Alternatives considered:**
  - Flag-only. Rejected: a mistyped `.env` could then point at a hosted project.
  - Gating the module on the flag as well. Rejected: `test:database` and `test:browser` would have to set it, which weakens it as a deliberate choice.

### D3: Replace the previous run, tracked in a local run file
- **Choice:**
  - Each run writes the ids of the cases and help request it creates to `.vitally-runs/seed-<workspaceId>.json`, updated as each case is created.
  - A run first deletes exactly those rows. The deletes use the privileged connection, are limited to that workspace, and touch nothing that isn't in the file. Then it seeds afresh.
  - Case children go with the case through `on delete cascade`. `filing_notes`' append-only trigger lets a note go with its whole case.
- **Why:** It keeps the "start from a known state" habit Reset gave, with no database change. Writing the file as it goes means a failed run is cleaned up by the next one.
- **Alternatives considered:**
  - A private marker table, which needs a migration for local-only tooling.
  - Add-only, where the board fills up and the only reset is deleting the workspace.
- **Accepted leftovers:**
  - `action_receipts` rows have no foreign key to the case, so they stay. That's harmless locally.
  - A lost run file leaves the old cases in place.

### D4: Find the workspace and accounts from the roster file, and check the follow-up default
- **Choice:**
  - `--roster <file>`, defaulting to `.vitally-roster.local.json`. The workspace is the file's `workspaceId`.
  - **Role accounts:** found by person key in that workspace (`site_coordinator`, `preparer`, `reviewer`), each linked to an active `staff` membership.
  - **Client A:** the file's first applicant, matched to an Auth user by address inside the database and never printed.
  - **The follow-up default:** the workspace's default follow-up person must be the `site_coordinator` person.
  - **Any miss:** the seed refuses with a message naming the role key or the setting, never an address.
- **Why:**
  - It reuses the file the operator already keeps.
  - Keys are stable and appear in nothing private.
  - The follow-up check stops the escalated follow-up silently landing with the old persona Sam on a stack set up before this change.
- **Alternative considered:** a `--workspace` id plus account flags. Rejected: more to type, and it duplicates the roster file.

### D5: The seeded set and who holds what
- **Choice:** eleven cases and one help request, as in brainstorm Q7:
  - client A's case at `received`;
  - office-entered cases at `preparation_ready`, `preparing` with an open document request, `preparing` with an escalated follow-up, `review_ready`, `corrections_required`, `review_approved`, `rejected`, `accepted`, `on_hold` (from Waiting for documents), and `closed` as an office withdrawal;
  - an open help request linked to client A's case, inserted directly, because help requests have no creating action.

  Who acts:
  - The Preparer claims, requests the document, escalates and submits.
  - The Reviewer claims, requests corrections and approves.
  - The Site Coordinator creates walk-ins, verifies intake, files, records results, holds and closes.
- **Why:** These are today's ten scenarios, reachable through the RPCs with this ownership, plus the client's own case the user asked for. Each login has work as soon as it signs in.
- **Alternative considered:** client-owned scenario cases. Rejected by the user: one rehearsal client only.

### D6: Code layout
- **Choice:**
  - `tools/admin/seed.mjs` is the command: argument parsing, the flag check, output.
  - `tools/admin/seed-cases.mjs` is the module: the target check, roles lookup, run file, delete and seed.
  - It has its own fictional answer and questionnaire values, built on `makeSampleAnswers()` from `src/sample-data.mjs`.
  - New `npm` script: `"seed:local": "node --env-file=.env.test tools/admin/seed.mjs"`.
- **Why:** It follows the existing privileged-tooling pattern (`roster.mjs` plus `workspace-setup.mjs`), and keeps the importable part separate for the fixtures.
- **Alternative considered:** a script under `tests/`. Rejected: rehearsal tooling isn't a test, and tests must not be a runtime dependency.

### D7: The example roster
- **Choice:** `tools/admin/roster.example.json`:
  - keeps the presenter, until step 7;
  - replaces the Riley Park staff entry with four role accounts (Site Coordinator, Preparer, Reviewer, Intaker), with capabilities as in brainstorm Q6;
  - sets `defaultFollowup` to `site_coordinator`;
  - drops client B, keeping client A and its `sampleCaseOwners` binding until step 6.
- **Why:** Role-named rehearsal accounts are what the seed acts as. The roster command's rules don't change, so the `sign-in` spec is untouched.

## Risks / Trade-offs

- **[Risk]** The transaction technique may not work. For example, the RPCs might read claims differently, or `set local role` might be blocked for the tooling's database role.
  → Mitigation: the first plan task proves it with one RPC call. If it fails, the D1 fallback, Auth admin sessions, is used without changing any requirement.
- **[Risk]** A seeded case reaches a state the app couldn't, because the seed forgot a step.
  → Mitigation: impossible by construction. Every stage change goes through the RPCs, and the database suite asserts each final stage and holder.
- **[Risk]** The seed deletes something it didn't create.
  → Mitigation: deletes are limited to ids in its own run file and to its workspace. The database suite checks that a case outside the file survives a re-seed.
- **[Risk]** A rehearsal stack still on the old example roster (default follow-up Sam).
  → Mitigation: the D4 check refuses, with a message to re-run the roster command.
- **[Trade-off]** Open windows don't notice a re-seed, because the Realtime publication sends no deletes.
  → Accepted. The rehearsal notes say to seed first or reload.
- **[Trade-off]** All timestamps are "now".
  → Accepted. Backdated history belongs to the analytics change.
- **[Trade-off]** This change's database suite depends on the step-1 fixture PR.
  → Accepted. Apply starts only after that PR is merged into `main` and `main` is merged into this branch.

## Migration Plan

Not applicable to deployment: there's no migration, product code or hosted change. For a developer:
1. Pull the change.
2. Re-run the roster command with the new example file to add the role accounts and move the default follow-up person.
3. Run `VITALLY_ALLOW_LOCAL_SEED=1 npm run seed:local`.

Rollback is reverting the PR. Seeded cases can be removed by running the seed once more, or by deleting the rehearsal workspace.

## Open Questions

None blocking. The D1 technique is proved in the first task, with the fallback named above. The interpretation recorded in brainstorm Q7 can be revisited at plan review if the user wants case 4 to be a claimed review: the Reviewer is named on cases 5 to 8, and case 4 waits on their board to claim.
