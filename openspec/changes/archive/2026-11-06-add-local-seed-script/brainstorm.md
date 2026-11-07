# Brainstorm: add-local-seed-script

Decision log from the verbal brainstorm (2026-11-05), recorded at propose. The decisions were made in conversation with the user and are not reopened here. A **builder's call** marks a choice the conversation left to the builder.

## Background

The team is removing presenter mode: the presenter account, the persona picker (Alex, Morgan, Sam) and the sample-case tools. It is split into small steps so that each pull request keeps `main` green and can be reverted on its own:

1. Direct PR (tests only): the database test fixture acts as role-named staff accounts.
2. **This change, `add-local-seed-script`:** a local-only command that fills a workspace with fictional cases.
3. Direct PR (tests only): the browser story signs in as role accounts and uses the seed.
4. `gate-demo-tools`: Auto-fill and the client's "Fill fictional details" go behind `demoTools`.
5. `remove-presenter-screens`.
6. `remove-sample-case-tools`.
7. `remove-presenter-access`.
8. Direct PR (docs only): the demo script and setup's multi-window walkthrough.

Today a presenter presses **Reset sample cases** (`vitally_reset_fixtures`, migration 009, last redefined in 039). That rebuilds ten sample cases and one sample help request through private SQL that writes stages directly (`apply_fixture_scenario`). Step 6 removes it. Before that, rehearsals and the browser story need another way to get known cases. That is this change. It adds a command and nothing else: the sample-case tools stay until step 6.

## Decisions

**Q1. What the seed is.** A dev and test command, `npm run seed:local`, that fills a workspace on the **local test stack** with fictional cases at different stages. It replaces the rehearsal use of "Reset sample cases". The browser story's fixture (step 3) calls the same module on its own throwaway workspace.

**Q2. It can never run against a hosted project.** It runs only when both of these hold:
- the existing test-target guard passes (`assertTestTarget`: loopback endpoints, the manifest's exact container names and ports);
- `VITALLY_ALLOW_LOCAL_SEED=1` is set.

Otherwise it does nothing and exits with an error. A guard failure says only that the target was rejected, as the other privileged tools do.

**Q2a. Local stack only, never a hosted test project.**
- `assertTestTarget` also approves a **hosted** test project (`VITALLY_TEST_MODE=hosted`, checked by project ref only). The user's rule was "refuses unless the target is the local test stack (local URL and an explicit env flag)".
- So the seed additionally requires the approved target to be the local mode, and refuses a hosted test target as `TARGET_REJECTED`. The unit test covers both a hosted target and a missing flag.
- This settles a fact the first draft of this file got wrong. It applies the user's stated rule and isn't a new decision.

**Q2b. Where each check sits.** Builder's call, settled after the design check:
- `VITALLY_ALLOW_LOCAL_SEED=1` is checked by the **command** (`npm run seed:local`) only.
- The importable module always runs the local-only target check.
- So the database suite and the step-3 browser fixture can call the module without the flag, while a person typing a command must opt in.

**Q3. It builds cases through the real RPCs, as real accounts.** The seed doesn't write stages directly. It calls the public RPCs (`vitally_create_case`, `vitally_apply_action`) as the role accounts, so every state-machine rule, check and history line is the product's own. To act as an account without a password or a sign-in email, it sets the signed-in user for one database transaction (`set local role authenticated` plus the request's JWT claims, read by `auth.uid()`) and calls the RPC in that transaction. Proving this technique is the plan's first task.
- **Builder's call, if the technique fails:** get a session for each account with the Auth admin API (a generated magic-link token verified server-side, never emailed) and call the RPCs with supabase-js.

**Q4. Running it again replaces the previous set.** Each run writes the ids of the cases and help request it created to a file under `.vitally-runs/` (already ignored by version control). The next run first deletes exactly those rows, within that workspace, then seeds afresh.
- **Cascade, checked:** every table that hangs off a case has `on delete cascade` on `(workspace_id, case_id)`, 19 in all, including `assistance_items`. `filing_notes` is append-only, but its trigger allows a note to go with its whole case. Only `action_receipts` rows remain, because they have no foreign key to the case. That's harmless on a local stack, and the roadmap already notes that receipts grow forever.
- **If the file is lost,** the old seeded cases stay. That's acceptable, because the command only ever runs locally.
- **Builder's call:** the run file is written as each case is created, so a run that fails midway can still be cleaned up by the next run.

**Q5. Which workspace and which accounts.** `--roster <file>`, defaulting to `.vitally-roster.local.json`. The workspace is the roster file's `workspaceId`. The role accounts are found by their person keys in that workspace: `site_coordinator`, `preparer`, `reviewer`. Client A is found by its address in the roster file, looked up in the database and never printed. If a needed account is missing, the seed refuses and names the missing role key, not an address.

Builder's calls, settled after the design check:
- **Client A is the roster's first applicant** (`applicants[0]`). An older local roster that still lists `client-b` second keeps working, and the roster command never removes anyone.
- **The workspace's default follow-up person must be the `site_coordinator` person.** Otherwise the seed refuses and tells the operator to re-run the roster command with the new example. A rehearsal stack set up before this change still defaults to Sam, and the escalated follow-up would silently land with a persona.

**Q6. The role accounts and the rehearsal roster.** Test and rehearsal accounts are named by role, not by persona. The example roster (`tools/admin/roster.example.json`) gains four staff accounts:

| Address | Key | Capabilities |
|---|---|---|
| `site-coordinator@example.org` | `site_coordinator` | `admin`, `followup`, `assist`, `receive_documents` |
| `preparer@example.org` | `preparer` | `prepare` |
| `reviewer@example.org` | `reviewer` | `review` |
| `intaker@example.org` | `intaker` | `receive_documents`, `assist` |

- The Site Coordinator becomes `defaultFollowup`.
- **Client B is dropped. There is only one rehearsal client, client A.** The database tests keep creating their own clients through the fixture.
- **No Greeter account, in any change.** Greeters don't use ViTally.
- The presenter, and client A's `sampleCaseOwners` binding, stay until steps 6 and 7 remove them.
- The Riley Park example staff entry is replaced by the Preparer.
- The Intaker lands on the Work board until the roster change gives Intakers the office workspace (#104 widened). The rehearsal notes say so.

**Q7. What it seeds: one client case plus the ten scenarios, plus one help request.**
- **Client A owns exactly one case.** It's just submitted: the intake is in and it waits for the office's intake checks (stage `received`).
- **The ten scenarios** from today's sample set are all **office-entered walk-ins** (assisted mode, no client account), including "withdrawn", which is an office withdrawal.
- **Each case is held by the role account its stage needs,** so each login has work as soon as it signs in. The Preparer holds the cases in preparation, and later stages where a preparer is named. The Reviewer is the named reviewer on cases at or past review. The Site Coordinator gets the escalated follow-up and the office work.

| # | Case | Built by (in order) | Ends at | Held by |
|---|---|---|---|---|
| 0 | Client A's case | client A: create, save answers, submit | `received` | office (screening not started) |
| 1 | preparation_ready | SC: create (assisted), save answers, submit (→ `screening`), verify intake | `preparation_ready` | unclaimed, on the Preparer's board to claim |
| 2 | waiting_documents | as 1, then Preparer: claim, request a document | `preparing`, one open request | Preparer |
| 3 | admin_followup | as 2, then Preparer: escalate the request | `preparing`, open follow-up | Preparer; follow-up to SC |
| 4 | review_ready | as 1, then Preparer: claim, submit for review | `review_ready` | Preparer; on the Reviewer's board to claim |
| 5 | corrections_required | as 4, then Reviewer: claim review, request corrections | `corrections_required` | Preparer; Reviewer wrote the correction round |
| 6 | review_approved | as 4, then Reviewer: claim, approve (went over the return) | `review_approved` | Preparer and Reviewer named; office next |
| 7 | rejected | as 6, then SC: mark ready to e-file, mark e-filed (both e-file), record results with the state return rejected (fictional reject code) | `rejected` | SC |
| 8 | accepted | as 7 up to e-filed, then SC: record both returns accepted | `accepted` | none (finished) |
| 9 | on_hold | SC: create (assisted), save answers, submit, request documents at intake (→ `awaiting_documents`), put on hold | `on_hold` | SC |
| 10 | withdrawn | as 1, then SC: close with reason `withdrawn` | `closed` | none |

- **The help request:** one open request linked to client A's case, inserted directly as the test fixture's `seedAssistance` does today, because help requests have no creating action. It appears in the Site Coordinator's Follow-ups.
- **No scenario needed adjusting.** Each one can be reached through the real RPCs with this ownership. The escalation has no waiting-time rule, and it assigns the follow-up to the default follow-up person, the Site Coordinator.
- **Interpretation recorded, not a decision:** the user asked that the Reviewer "holds the ones waiting for or in review". The ten scenarios have no case sitting in `reviewing`. The Reviewer is the named reviewer on cases 5 to 8, and case 4 waits on their board to claim. Turning case 4 into a claimed review would change a scenario, so it isn't done.
- **Corrected during apply (2026-11-06):** asking for corrections clears the case's reviewer (migration 006), so the Reviewer is the named reviewer on cases 6 to 8 and wrote case 5's correction round.
- **Builder's call:**
  - Answers come from `makeSampleAnswers()` in `src/sample-data.mjs`, with a distinct fictional client name per case.
  - The questionnaires reuse the shapes the database tests already pass (`PREPARER`, `REVIEWER` in `tests/support/database-fixture.mjs`). The seed keeps its own copy, because tools must not import tests.
  - If submitting for review needs the 13614-C shaded section saved first, the seed saves fictional values for it.

**Q8. Timestamps.** Everything is dated "now", because the real RPCs write the current time. A full fictional season with backdated history for Office overview is a separate option in the later `add-office-analytics` change, not here.

**Q9. Output.** The command prints counts (cases created, cases replaced), and never an email address.

**Q10. Open windows after a re-seed.** Builder's call, settled after the design check:
- The Realtime publication sends inserts and updates, not deletes (migration 007). A window that's already open keeps showing the replaced cases until it reloads, and acting on one returns "not found".
- "Reset sample cases" got around this with `workspaces.fixture_generation`, but writing that from the seed would be a write outside the RPCs.
- So the seed doesn't try. The rehearsal notes say to seed before opening the app, or reload open windows afterwards.

**Q11. Order against step 1.** Builder's call:
- This change's database suite builds on the role-named accounts that step 1 adds to `tests/support/database-fixture.mjs`.
- Apply starts after step 1's PR has merged into `main` and `main` has been merged into this branch.
- If step 1 hasn't merged by then, apply waits rather than editing the same fixture in parallel.

## Goals, non-goals, anti-goals

**Goals:**
- A rehearsal stack can be put into a known state in one command.
- The browser story can get the same known cases on its own workspace.
- All of it goes through the product's own rules.

**Non-goals, each handled in another step:**
- Removing the sample-case tools or `sampleCaseOwners` (step 6).
- Changing the browser story (step 3).
- The full fictional season (`add-office-analytics`).
- Any presenter removal (steps 5 and 7).

**Anti-goals, which would make this a failure even if it works:**
- Any path that lets it run against a hosted project.
- Any write that skips the RPCs' rules for case state.
- Printing an email address.
- Real or real-looking personal data.
- A migration or any change to product behaviour.

## Constraints

- No migration, and no change under `supabase/`, or to what clients or staff see.
- Tools must not import from `tests/`.
- Fictional data only.
- LF line endings.
- The command lives with the other privileged tooling, `tools/admin/`, and follows its guard-first pattern. Builder's call: `tools/admin/seed.mjs` for the command, plus a module the browser fixture can import.

## Acceptance and checks

- **Unit (`npm test`):**
  - The argument parsing.
  - The refusal without `VITALLY_ALLOW_LOCAL_SEED=1`.
  - The refusal when the target guard rejects.
  - Output that never contains an address.
- **Database (`npm run db:migrate:test`, then `npm run test:database`):** a new suite that seeds a throwaway fixture workspace twice and checks:
  - the eleven cases with their stages, owners, holders, follow-up assignee and help request;
  - that the second run replaced the first, with no seeded case left over from run one;
  - that nothing outside the listed ids was deleted.
- **Not needed:**
  - `test:browser` and `test:auth-browser`: no screen or sign-in changes.
  - `build:hant`: no client text.
- **CI:** `npx openspec validate --all` passes with the new capability.
- **Docs this change makes wrong get updated:**
  - `docs/setup.md`: the rehearsal accounts and how to seed;
  - `docs/developer/backend.md`: the privileged tooling table and the roster example.
- **Spec:** a new capability, `local-seed-data`. It covers the guard, the replace behaviour, the seeded set, and never printing an address.
