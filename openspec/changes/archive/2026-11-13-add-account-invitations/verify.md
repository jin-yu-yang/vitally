# Verification Report

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
