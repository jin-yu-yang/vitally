# Verification Report

**Change**: `add-volunteer-schedule`
**Verified at**: `2026-11-22 20:34` (America/New_York), at `a763639`
**Verifier**: Claude (controller session), after round 2 (tasks.md group 8, plan Tasks 13–17) and a clean final whole-branch review

> This run replaces the earlier report of 2026-11-22 07:16, which predated the reconciliation with main's My profile (#262). That report is in git history at 2c79549.

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`

**Result**:

```text
24 items, 0 invalid (npx openspec validate --all --json, OpenSpec 1.17.0)
```

Non-strict validation passes. `--strict` would fail only on OpenSpec 1.17's "Requirement text is very long" warnings. The canonical specs on main carry the same warning, and CI runs the non-strict form (ruling R4).

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (38 of 38, groups 1–8)

**Unfinished tasks**: none. Group 8 notes that it supersedes tasks 2.5, 2.6, 4.5 and 4.7, and the My profile half of 7.1. Those stay ticked because they were done and then reconciled.

| Task | Why unfinished | Blocks archive? |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

Compared with `openspec/specs/<capability>/spec.md` at HEAD, which now includes main's merged changes through #262. Archive merges the deltas in step 8.

| Capability | Sync state | Notes |
|---|---|---|
| `volunteer-schedule` | ✗ Needs sync | New capability, 12 ADDED requirements, none in canonical yet. Usual days are main's (`volunteer-roster`). "Your shifts this week" sits on main's page (`my-profile`). |
| `season-settings` | ✗ Needs sync | 2 ADDED requirements, absent from canonical. |
| `volunteer-workload` | ✗ Needs sync | 1 ADDED requirement, absent. 1 MODIFIED requirement ("The Workload can be sorted and searched"): the only canonical line it rewrites is the column list, which gains "Hours this week", plus one new scenario. That canonical requirement is unchanged since the branch started. |
| `volunteer-clearance` | ✗ Needs sync | 2 MODIFIED requirements, re-based on main's current text after #262. A line-by-line check shows main's lines kept verbatim. The only rewrites are the `uploadUrl` bullet's ending, the setup-screen paragraph that gains the Schedule sentence, and the "uncleared admin" scenario. The additions are `scheduleViewer` and its scenarios, and the Schedule link. |
| `local-seed-data` | ✗ Needs sync | 1 ADDED requirement, absent. |
| ~~`volunteer-roster`~~ | N/A | Delta removed in the 2026-11-22 update. Main's "An admin edits a volunteer's usual days" covers it. |

---

## 4. Design / Specs Coherence Spot Check

| Sample | Design says | Specs say | Gap |
|---|---|---|---|
| D1/D5 usual days | Main's `text[]` `mon`…`sun`. Candidates carry the strings. No column of ours. | "Add shift offers…, usual days first" reads the profile's `mon`…`sun` days (capability `volunteer-roster`) | None |
| D5/D8 `vitally_my_shifts` | Caller-only, current season, live shifts, New York week. Refused for client, anonymous, no person row and invited (ruling R19). | "My profile lists the volunteer's shifts this week" lists the same four refusals | None. Main's `vitally_my_profile` also refuses a caller with no volunteer profile row; `vitally_my_shifts` returns an empty week instead (R19). |
| D10 live re-reads | Either table re-reads the Schedule. `shifts` re-reads My profile's shifts and the Workload. | "Schedule screens follow changes live and on focus", narrowed by the user on 2026-11-22 | None. The drift the final review found was resolved by narrowing the spec. |
| D11 sidebar | Schedule after Volunteers or the Work board. My profile is main's account row, cleared windows only. | "Rostered staff open the Schedule"; volunteer-clearance setup screen | None |
| D3 no-sign-in | Non-admins never get a no-sign-in volunteer's shifts | "Non-admins see names, roles and hours only" | None |

**Drift warnings** (non-blocking):

1. **Uncleared admins get Season settings changes on focus, not live** (ruling R11). Design D10's live re-read applies to cleared windows. The spec's live-update requirement does not cover Season settings.
2. **A re-created fictional seed volunteer's already-removed seeded shift rows are hard-deleted by the cascade** (ruling R16). The seed tool only, fixed for live and admin-added shifts in c3bd2eb.

---

## 5. Implementation Signal

- [x] No unstaged files in the worktree (`git status --short` is empty)
- [ ] Not all commits are pushed. The branch has no remote yet; per the user, nothing is pushed until the PR step.

**Commit range**: `086c473..a763639` (merge base with origin/main is 086c473; 52 commits). Migration: `supabase/migrations/058_volunteer_schedule.sql`.

**Checks run** (project rules: Verification), all at `a763639`:

| Check | Why it applies | Result |
|---|---|---|
| `npm test` | Always | 2430 / 2430 pass |
| `npm run db:migrate:test` then `npm run test:database` | Migration 058, RPCs, RLS, realtime, the replaced `vitally_my_clearance` | Migrations applied (057_my_profile, then 058). 924 / 925 pass. The single failure is `tests/database-accounts-function.mjs` ("VITALLY_TEST_MAIL_URL is required"): the worktree's `.env.test` was copied from the main checkout and predates that variable. It is env-only and unrelated. |
| `npm run test:browser` | The Schedule, My profile section, Season settings card, Workload column, sidebar, CSS | **96 / 96 pass** (1989 s). Both story legs pass. The Chrome-client/Firefox-staff failures seen earlier on this local stack did not recur. "A site coordinator schedules a volunteer, and the volunteer sees it" passes (30.8 s), as do "A site coordinator changes Season settings" (24.9 s) and main's "A volunteer edits My profile and re-sends a Form 13615" (32.5 s). |
| `npm run build:hant -- --check` | Shared text files came in through the merges | Clean, exit 0 |
| `npx openspec validate --all` | Change artifacts | 24 / 24 |
| `npm run test:auth-browser` | Not run: sign-in is untouched | — |

**Coverage note.** The browser walk puts its shift on this week's Saturday, or on today on a Sunday. This run was on a Sunday, so the walk exercised the Sunday path with the exact line "Sun, Nov 22 · 10 am – 2 pm · Preparer". A review read the Saturday path, which any Monday-to-Saturday run takes, including CI on a weekday, and found it correct. It has not executed yet.

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md   # the historical documents only
```

- [x] The files there predate the schema install, and CLAUDE.md names them as historical documents not to be moved. This change wrote nothing there.

| File | Content captured in the change? | Suggested action |
|---|---|---|
| — | — | — |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

plan.md has no `[~]` deferred rows, so this section is empty and counts as a pass.

**Accepted behaviour, for the record:**
- Dragging the start edge of a shift already tagged "Outside site hours" does nothing and shows no message (round-1 ruling R15).
- A site that closes at midnight reads "… – 12 am" (`hourLabel(24)`).
- **Copy the spec did not fix, chosen during implementation; the user should review it:** "Choose a volunteer.", "Shifts" (the grid's region label), "The shift must end after it starts.", "No shifts on this day.", "Keep shift", "Coverage", "VOLUNTEERS · SCHEDULE", "On site needed (greeters or intakers)", "Every week · New York time", "Loading your shifts…", "Your shifts couldn't load.", plus the Schedule's loading and failed lines.

---

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS. Every required check passes. Two non-blocking warnings remain:
  1. Uncleared admins get Season settings changes on focus, not live (R11).
  2. The seed's own removed rows cascade away when a fictional volunteer is re-created (R16).

  Also noted: the walk's Saturday path has not executed yet, and a weekday run or CI covers it.
- [ ] ❌ FAIL

**Next step**: add the round-2 follow-up to the retrospective (lifecycle step 7), summarising this round's ledger (R17–R20, deferred minors). Then merge main and archive (step 8), and push and open the PR with the CI run linked (step 9).
