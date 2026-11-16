# Verification Report

## service_role grants (PR #197 comment), 2026-11-14

**Verified at** `01bc2c5`. 047 had given `service_role` everything on `public.accounts`, which was left over from the brainstorm's `service_role` RPCs. That grant is revoked. Nothing uses it: the Edge Function calls the database with the admin's JWT and uses the service key only for `auth.admin.createUser`; `tools/admin/roster.mjs` uses the service key only for Auth's user list; `workspace-setup` and the tests' SQL connect as `postgres`; and no seed or test touches `accounts` with the service key. Every function this change adds already revoked execute from `service_role`. The new database test, "service_role holds nothing on accounts or the account functions", checks the table's privileges, a refused update, insert, delete and select through the service key, and execute on the account functions.

- **Local:** `npm test` (1795 tests; the only failure is the Windows-only "mode 600" test, which also fails on `main`), `npx openspec validate --all` (16 valid).
- **CI:** run [43631663372](https://github.com/jin-yu-yang/vitally/actions/runs/43631663372) on `01bc2c5` passed every job on its first run: `checks`, `database` (628/628), `sign-in`, `story (chrome-client)`, `story (firefox-client)`.
- **Not run locally:** the populated-stack run. Only a grant changed, and no existing rows did.

## Review round (PR #197), 2026-11-14

**Verified at**: `2026-11-14` on `9bda122`, after merging `main` (#195) and renumbering the migration to `047_accounts.sql`.

What changed in this round is in design.md, "Review round" (D10 to D14), with the calls made without the user in brainstorm.md (16 to 30). The sections below the line are the original verification of apply, kept as it was.

Checks run, and why:
- **Local:** `npm test` (1794 pass; the one failure is the Windows-only "mode 600" test in `tests/write-test-env.test.mjs`, which fails on `main` too and passes on CI), `npm run build:hant -- --check` (no client text changed), `npx openspec validate --all` (16 items, all valid).
- **Local, on a stack that already has main's migrations and data** (CLAUDE.md, for a migration that changes existing rows): the user's stack held 001 to 045 with 61 memberships (46 staff, 15 clients), 75 people and 28 cases. A `pg_dump` backup was taken first (kept outside the repository), and the stack was restarted with the edge runtime and the `accounts` function, without `--no-backup`, so its data was kept. Then:
  - `npm run db:migrate:test` applied `046_volunteer_workload.sql` and `047_accounts.sql`;
  - the backfill gave all 61 memberships an `active` account: every staff account names its person, every client account names none, and no membership was left without one;
  - `npm run test:database`: **627 tests, 627 pass, 0 fail, 0 skipped**, on `5750312`. The commits after it change only `tests/auth-browser.mjs`.
- **CI, in place of the local sign-in and browser runs:** run [43584019381](https://github.com/jin-yu-yang/vitally/actions/runs/43584019381) on `9bda122` passed every job: `checks`, `database`, `sign-in`, `story (chrome-client)`, `story (firefox-client)`.
  - Story screenshots reviewed from that run's artifacts: the office screen's Invite a client panel (`office-resolve-help-720`, both browser orders) is unchanged in layout; the story has no invited client, so no Cancel button shows, and no Roster screenshot.
  - Earlier runs of this round failed and were fixed, not re-run: [43580682778](https://github.com/jin-yu-yang/vitally/actions/runs/43580682778) (`database`: the catalog's no-digest list and `vitally_my_clearance`'s key lists did not know the new RPCs and `siteCheck`), [43581880873](https://github.com/jin-yu-yang/vitally/actions/runs/43581880873) and [43582942189](https://github.com/jin-yu-yang/vitally/actions/runs/43582942189) (`sign-in`: the new volunteer test waited for the office heading after a reload, then its cleanup unlinked the person and dropped the membership in two statements). Every new database test passed on the first run.

What the new tests cover (item 7 of the user's instructions):
- `tests/database-accounts.mjs`:
  - Cancel invitation: allowed while invited, which unlinks the person, resets the ceiling and makes the email savable again, with the auth user left reusable; by email for a client; refused once active, when deactivated, for an active client, when stale and for a preparer; a cancelled invitee's sign-in reaches no membership, case data or RPC.
  - Expiry: the sweep; Create account, the office list and a client's or volunteer's sign-in each cancel first; Resend restarts the seven days and refuses an expired invitation.
  - The site check: the right SIDN activates, stores the name (not on `people`) and clears; a wrong one stays invited with the attempts left, and the fifth cancels; a missing name, a blank SIDN and an unset site number count as no attempt; it is only the invited volunteer's; the number is unreadable by any API role.
  - An invited volunteer who has not passed the check reads no cases, documents, document requests or client events, and gets `NOT_CLEARED` for a case action.
- `tests/database-accounts-function.mjs`: the emailed code signs the volunteer in still `invited`, and the site check makes the account active.
- `tests/auth-browser.mjs`, in both browsers:
  - Create account is off while the drawer has unsaved changes, and the Send question names the saved email;
  - the emailed code leads to "Confirm your site": a wrong SIDN is said, and the right one moves on to the setup screen;
  - the Roster shows "Signed in as";
  - Cancel invitation from the drawer makes the email editable;
  - the client invite answers the Send question.
- Unit tests cover the controller, views and store for each flow, including the replay and `ALREADY_INVITED` wording.

The round's own review (a fresh reviewer, whole round) found 0 Critical, 4 Important and 8 Minor. All four Important and M1, M4, M7 and M8 were fixed in `5750312`:
- I1: the site check screen dead-ended on a cancelled invitation or a lost answer;
- I2: the sign-in trigger cancelled expired invitations without the workspace lock;
- I3: the expiry wording for a refusing call and a client's Resend;
- I4: no end-to-end test of the new flows.

Parked as minor, recorded here for the next change:
- M2: the Send question shows the email the drawer read, while the server sends to the email saved at that moment; another admin's save in between would go unconfirmed.
- M3: a retry after a timeout keeps its action id. If the invitation is cancelled and Create account is pressed again in the same drawer, the server can replay the old answer.
- M5: an older clearance read can bring the form back after a pass.
- M6: Send pressed while another request runs closes the question silently.

Follow-ups opened, not fixed here: #198 (cross-workspace email probing through `vitally_prepare_account`) and #199 (a reactivated user with an existing session stays Invited until they sign in again).

**Decision for this round:** ✅ PASS. Every check covering the change passed, including the populated-stack run that the original verification left open.

---

**Change**: `add-account-invitations`
**Verified at**: `2026-11-14 05:10` (UTC)
**Verifier**: Claude (controller of subagent-driven development), from CI and local runs

Checks run, and why:
- **Local:** `npm test`, `npm run build:hant -- --check`, `npx openspec validate --all`.
- **CI, in place of the local database, sign-in and browser runs:** the stack is shared with other sessions, and the user ruled out local stack runs for this change. CI run [43557916685](https://github.com/jin-yu-yang/vitally/actions/runs/43557916685) on `89438dc`, the head of apply, passed every job on its first attempt with no re-runs: `checks`, `database`, `sign-in`, `story (chrome-client)`, `story (firefox-client)`.
- **CI starts from an empty database.** Migration 046 also changes existing data (the backfill), so CLAUDE.md asks for a local `db:migrate:test` plus `test:database` on a stack that already has main's migrations. That has not been done, because local stack runs were ruled out. See section 7.

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item `"valid": true`

**Result**:

```text
15 items, all valid (14 canonical specs + change add-account-invitations), 0 failed.
Info only: one requirement longer than 500 characters (non-blocking).
```

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] Every task 1.1-5.2 is `- [x]`; 6.1 and 6.2 are checked by this report.

**Unfinished tasks**: none.
- 6.1, local checks: `npm test` 1686 of 1687 pass. The one failure is the baseline Windows-only `write-test-env` "mode 600" test, which fails on main as well; the baseline was 1626 of 1627. `build:hant -- --check` passes, and `openspec validate --all` passes 15 of 15.
- 6.2, CI: run 43557916685 passes every job (above).

| Task | Reason unfinished | Blocks archive |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

| Capability | Sync state | Notes |
|---|---|---|
| sign-in-accounts | ✗ needs sync | new capability; archive creates `openspec/specs/sign-in-accounts/spec.md` |
| volunteer-clearance | ✗ needs sync | MODIFIED "A staff member is cleared only with a role and, if new, a photo ID check" |
| volunteer-roster | ✗ needs sync | MODIFIED "The Roster lists the current season's volunteers and whether each is cleared" |
| sign-in | ✗ needs sync | MODIFIED "A staff account acts as its own person with no person parameter" (thirteen RPCs, new prepare signature) |
| local-seed-data | ✗ needs sync | MODIFIED "The local seed command adds fictional volunteers" |

Sync is archive's job (CLAUDE.md step 8). `/opsx:sync` was not used.

---

## 4. Design / Specs Coherence Spot Check

| Sample | design says | specs say | Gap |
|---|---|---|---|
| D1 one row per membership, admin-only read | table keyed (workspace_id, user_id), RLS admin select | "Each membership has at most one account..." | none |
| D2 first sign-in activation | trigger on `auth.users.last_sign_in_at` | "An account becomes active when its person first signs in" | none |
| D3 prepare replay | `vitally_prepare_account(p_action_id, p_op, p_target)` returns `{replay}` | sign-in delta lists the same signature; Create account "repeated request" scenario | none (updated during apply) |
| D5 refusal table | six reasons, order | "Create account and Invite refuse emails that belong to someone else" | none |
| D6 cleared needs an active account | `cleared()` + Roster missing reasons | volunteer-clearance and volunteer-roster deltas | none |
| D8 office panel lists invited/active | list leaves out deactivated | "panel shows Invited or Active" | none |

**Drift warnings** (non-blocking):
- During apply, D3 was brought in line with the code: the check takes no actor, returns `volunteerId`, and uses the key `accountRevision`. brainstorm.md's "Decided without the user" items 13-15 record the apply-time rulings.

---

## 5. Implementation Signal

- [x] No unstaged files in the worktree before this report was written.
- [x] Every commit is pushed (`origin/add-account-invitations` at `89438dc` when CI ran).

**Commit range**: `06ebee6..89438dc` (main..apply head), 21 commits.

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md 2>/dev/null
```

- [x] The 8 files there predate this schema (historical parts 1-4d, which CLAUDE.md says to keep untouched). This change wrote nothing under `docs/superpowers/`.

| File | Captured in the change | Action |
|---|---|---|
| (historical design docs) | n/a | leave as CLAUDE.md requires |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

plan.md has no `[~]` rows. One project check was not run:

| Not run | Equivalent automated test | Coverage assessment | Real gap |
|---|---|---|---|
| Local `db:migrate:test` + `test:database` on a stack that already has main's migrations (CLAUDE.md, for migrations that change existing rows) | CI `database` job (empty database, then 001-046), plus `tests/database-accounts.mjs` "backfill" (inserts an account-less active and an inactive membership, runs `vitally_private.backfill_accounts()`, checks active/deactivated) | proves the backfill SQL and its constraints on fresh rows; does not prove 046 on a populated developer or classroom stack | ✅ gap: record in the retrospective; run it on the user's stack (045 applied, backup exists) before merge |

**Story screenshots** (from run 43556500437, then 43557916685 after the CSS fix): both client/staff browser orders reviewed for the office screens the story captures. The "Invite a client" panel first lacked the office card's padding; `89438dc` fixed it, and the re-run's `office-resolve-help-720` shows it as a matching card. The story has no Roster screenshot, so the Roster Account column is covered by unit view tests and the story's Roster assertions (td index 4).

---

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS — every check covering the change passed on CI run 43557916685. Not yet done: 046 on a populated local stack (section 7), which is for the user to run on their own stack before merge.
- [ ] ❌ FAIL

**Next step**: retrospective, then merge main, archive, and open the PR.

(Superseded by the review round at the top: the populated-stack run is done.)
