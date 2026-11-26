# Verification Report

**Change**: `add-volunteer-check-in`
**Verified at**: `2026-11-23 10:37` (America/New_York)
**Verifier**: Claude (controller session). The checks were run directly, because the `openspec-verify-change` skill is not installed (CLAUDE.md §2 step 6).

Verified commit: `f63661b` on branch `add-volunteer-check-in`, pushed as `origin/add-volunteer-check-in-cc`. The teammate's separate `add-volunteer-check-in` branch on origin is not this change's; see §5.

**PRECHECK:**
- 92 commits since `git merge-base HEAD origin/main`.
- 26 tasks ticked in tasks.md.

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item has `"valid": true`.

**Result:**

```text
items 25, invalid 0 (openspec 1.17.0)
```

With `--strict`, `add-volunteer-check-in` raises only "Requirement text is very long (>500 characters)" warnings. These are new in OpenSpec 1.17.0, which arrived with the `main` merge. They are not errors, and CI runs `validate --all` without `--strict`.

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (26 of 26).

Group 7 (final-review fixes) was added on 2026-11-23 by the user's decision, through `/opsx:update`. Task 6.3 was re-run after it (see §5).

| Task | Why not done | Blocks archive |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

| Capability | Sync state | Notes |
|---|---|---|
| `volunteer-check-in` | ✗ Needs sync | New capability. `openspec/specs/volunteer-check-in/` doesn't exist yet. Archive creates it. |
| `volunteer-schedule` | ✗ Needs sync | ADDED "Admins see the day's check-ins on the Schedule" and "Admins correct check-ins from the Schedule". MODIFIED "Non-admins see names, roles and hours only", "The Schedule shows one day at a time" and "Schedule screens follow changes live and on focus". |
| `volunteer-workload` | ✗ Needs sync | REMOVED "The Workload shows the hours scheduled this week". ADDED "The Workload shows the hours checked in this week". |
| `local-seed-data` | ✗ Needs sync | MODIFIED "The local seed fills a week of the schedule". |

All four sync at archive (lifecycle step 8), after `main` is merged again. None of the canonical files mention check-ins yet, as expected. The MODIFIED and REMOVED headers match the canonical requirement names, which `validate` confirms.

---

## 4. Design / Specs Coherence Spot Check

| Sample | Design | Spec | Gap |
|---|---|---|---|
| Who checks in | D3: cleared, plus a current-season roster entry, with `NOT_CLEARED` otherwise | volunteer-check-in "Only a cleared staff member checks themselves in and out" | None |
| The counted end | D2: shift end, else site close, else none; open is capped at now; missed counts to the end | "A check-in without a check-out counts to the day's end", with 6 scenarios | None |
| Overlap | D4, revised 2026-11-23: an open row today runs on for the OVERLAP check | "Workspace admins correct check-ins", OVERLAP plus the two new scenarios | None |
| Who reads | D5: admins see all rows, a person sees their own | "Only admins and the person read check-ins" | None |
| The strip | D6 | "Cleared staff windows show a check-in strip" | None |
| The Schedule | D7 | volunteer-schedule ADDED ×2 and MODIFIED ×3 | None |
| The hours | D8: `vitally_hours_this_week`, one decimal | volunteer-workload ADDED | None |
| The seed | D10 and ruling R4 (past-day shifts for matching check-ins) | local-seed-data MODIFIED: "Most SHALL match a seeded shift" | None. The spec still says about six shifts in the current week, and the tests pin that separately. |

**Drift warnings** (non-blocking):
- design.md's Migration Plan and Open Questions now say 060. `main` took 059 for #273, so the migration was renumbered on 2026-11-23 (commit `f63661b`).

---

## 5. Implementation Signal

- [x] Nothing in the worktree is unstaged. Only this report and the 6.3 tick are uncommitted, and they are committed with this file.
- [x] Every relevant commit is pushed to `origin/add-volunteer-check-in-cc`.

**Commit range:** `42c000e..f63661b`. The feature commits are on top of `main` (#271's squash `612d62c` is recorded with `-s ours`, and #273 is merged in `2b5b85b`).

**Checks run, and why** (CLAUDE.md, Verification):

| Check | Where | Result |
|---|---|---|
| `npm test` | local, `f63661b` | 2536 pass, 0 fail |
| `npm run build:hant -- --check` | local | clean. There is no client text, but it is run anyway. |
| `npm run build:intake` leaves nothing to commit | local | clean |
| `npx openspec validate --all` | local | 25/25 |
| `npm run db:migrate:test`, then `npm run test:database` | local, after the 060 reset on a stack with `main`'s migrations | migrate applied `059_remove_from_roster` and then `060_volunteer_check_in`. The suite gave 1026 pass and 4 fail. All 4 are `tests/database-accounts-function.mjs`, which needs the edge runtime that this local stack doesn't serve. That file is untouched by the change, and CI covers it. |
| CI `checks`, `database`, `sign-in`, `story (chrome-client)`, `story (firefox-client)` | [run 45203758327](https://github.com/jin-yu-yang/vitally/actions/runs/45203758327), `workflow_dispatch` on `add-volunteer-check-in-cc` at `f63661b` | every job passed on the first attempt |
| `npm run test:browser` | local | **Not counted.** Two local runs on `f63661b` failed at the story's seed step: the board kept reloading with about 40 list reads in flight. The same commit passed both story legs in CI on a fresh stack, and `main` passes there too. The local stack had been reset twice that day, and each reset dropped `check_ins` from the Realtime publication and added it back. The local failure is put down to the stack, not the code. Per CLAUDE.md, the CI run stands in for the local database, sign-in and story runs. |
| `npm run test:auth-browser` | — | Not run locally, because sign-in is unchanged. CI `sign-in` passed. |

**Story screenshots** reviewed from the run's artifacts (`story-screenshots-*`):
- `check-in-strip-390.png`: "Checked in since 10:34 am" with Check out. Nothing is cut off, and there is no sideways scroll.
- `check-in-bars-720.png` and `-390.png`: run on a closed Monday. The admin's Schedule shows "The site is closed on Mondays." and the closed-day list "Taylor Brooks 10:30 am – now", tagged Not scheduled, Corrected and Outside site hours, plus "+ Add check-in".
- The open-day grid bars weren't captured on this run day. The unit tests (`tests/schedule-views.test.mjs`) cover them.

**Earlier local story run:** 97/97 on both legs at `d81a4cf`, before the final fixes and the `main` merge.

**Branch note:** a teammate's separate implementation of #257 sits on `origin/add-volunteer-check-in`. On 2026-11-23 the user and the teammate settled (in a comment on #257) that this change carries #257, so this branch was pushed under `-cc`. An earlier CI dispatch, run 45200401045, landed on the teammate's branch by mistake and is not evidence for this change.

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md 2>/dev/null   # 8 files
```

- [x] The 8 files are historical design documents from parts 1–4d. The directory was last changed on 2026-10-05, before this change. CLAUDE.md says to keep them. This change wrote nothing there: its brainstorm and plan are in this change folder.

| File | Captured in the change? | Action |
|---|---|---|
| — | — | — |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

plan.md has no `[~]` rows, so this section is empty, which passes.

Recorded for the retrospective: the two new overlap database cases skip themselves before about 04:30 New York time (deferred minor M22). That is a timing gap in an automated test, not a deferred manual check.

---

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS. The local browser story could not pass on this stack. CI passed it on the same commit, and that run is the evidence. Requirement-length warnings appear only under `--strict`.
- [ ] ❌ FAIL

**Next:** the retrospective (lifecycle step 7), then archive (step 8, after merging `main` again), then the PR (step 9).
