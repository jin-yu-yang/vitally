# Retrospective: add-volunteer-schedule

> Written: 2026-11-22 (after verify passed with warnings; before archive and PR)
> Commit range: `7e06662..2c79549`, the branch start through the verify update (merge base with origin/main is 4ab301e)
> Worktree: `.claude/worktrees/add-volunteer-schedule` (branch `add-volunteer-schedule`, not pushed)

> **Update 2026-11-22**: at archive time, main had merged a separate My profile change (#262), which overlapped this change's usual days, `vitally_my_profile` and My profile page. The user chose to adopt main's version (brainstorm.md "Update 2026-11-22"; tasks.md group 8). That supersedes §0's state (tasks 30/30, migration 057) and the parts of §1–§3 about this change's own My profile and usual days. A follow-up section is appended after group 8 is applied. §2 gains a miss: overlapping work with a parallel change went unnoticed until archive.

---

## 0. Evidence

- **Commit range**: `7e06662..2c79549`, 37 first-parent commits: 35 of this change's own and 2 merges of main.
- **Diff size**: +8932 / −94 lines across 61 files, against the merge base 4ab301e. Of that, `src/`, `tests/`, `tools/` and `supabase/` hold +7095 / −65 across 41 files. The rest is docs and change artifacts.
- **Tasks done**: 30/30 (`grep -cE '^\s*- \[x\]' tasks.md` → 30).
- **Active hours**: about 15 hours of wall clock (2026-11-21 14:20 to 2026-11-22 04:53). Two interruptions are included:
  - a session end during Task 6;
  - a usage-limit stop during Task 9, which reset at 23:30 New York time.
- **Subagent dispatches**: 38 fresh dispatches, plus about 12 resumes of existing agents for fix rounds and interruptions.
  - Fresh dispatches: 15 implementers (12 tasks, the main merge, the final fix wave, the seed fix) and 23 reviewers (12 task reviews, 9 scoped re-reviews, 1 final whole-branch review, 1 final re-review).
- **New external dependencies**: none.
- **Bugs encountered post-merge**: none yet; the change is not merged.
- **OpenSpec validate state**: pass at verify (`openspec validate --all`, 23 of 23). Archive is still to come. `--strict` fails only on OpenSpec 1.17's "very long requirement" warnings (ruling R4).
- **Test coverage signal**:
  - `npm test`: 2390/2390, up from 2257 at the start.
  - `test:database`: 880/881, from 835 at the start. The one failure is env-only: `database-accounts-function.mjs` needs `VITALLY_TEST_MAIL_URL`.
  - `test:browser`: 55/57. The new schedule walk passes (39.4 s) and Season settings passes (22.0 s). The 2 failures are in the Chrome-client/Firefox-staff story leg and reproduce on untouched main locally.
  - New test files: `tests/database-schedule.mjs`, `tests/volunteer-schedule.test.mjs`, `tests/schedule-views.test.mjs`, `tests/schedule-drag.test.mjs`, `tests/profile-views.test.mjs`.

Commit chain (in order):

```
2c72775 Change artifacts (brainstorm, proposal, design, specs, tasks, plan)
18248fa Migration 056, since main took 055 (#255)
d56e8b3 Merge main (055 start next season)
6dfcc30 T1  shifts, schedule settings and usual days storage
b09f13e T2  site hours and coverage targets on Season settings
ba8580a T3  save and remove shifts
0fdef51 T3  fix: validators are security definer; registry tidy-up
6951fc1 T4  schedule day read with coverage counts for admins
f413e40 T5  usual days, My profile, scheduleViewer in the clearance
ffa6380 T6  store calls and pure helpers
f798da7 T7  Schedule screen, shift drawer and sidebar link
b4168f9 T7  fix: live updates for uncleared viewers
ffcbeb7 T8  drag to create and resize
1490e76 T8  fix: admin-only touch-action, cancel on a detached row, reuse dragRole
09fbea0 T9  My profile, usual days on the Roster, site hours card
bbeb1df T9  fix: drafts keep their base revision
1dc2601 T10 Workload Hours this week
3d55cdc T10 fix: re-read the week on wake and on open
84f32b0 T11 seed: site hours, usual days, a week of shifts
b1c67af T12 schedule walk in the browser tests, docs
ec16353 T12 fix: docs Realtime and RPC counts
74350e8 Merge main (#245 OneDrive took 056)
ffd1cc8 Renumber the migration to 057
72751db Final review fixes: grid width, drag tied to its day, polish
5814c3c Verify: pass with warnings
c3bd2eb seed: remove seeded shifts before re-creating volunteers
2c79549 Verify: seed warning resolved
(tasks.md tick commits are omitted: 7d8a215, da09865, 2b9f14c, 84787d5, cba5e86, 4dde4b7, aa47258, 3d2241c, c07f159, dd5c7ab)
```

---

## 1. Wins

- **[evidence: 6dfcc30, 6951fc1, tests/database-schedule.mjs]** The privacy boundary was designed once, in the database, and held all the way through.
  - `viewer_shifts` hides no-sign-in volunteers' shifts from non-admins for both direct reads and realtime.
  - `shift_counts` decides coverage in SQL, so the browser never re-derives anyone's clearance.
  - The Task 4, Task 5 and final reviews each checked this boundary independently and found no leak.
- **[evidence: f413e40, the Task 5 review]** The three replaced functions are verbatim copies of their latest bodies, plus lines marked `-- 057`. The reviewer confirmed this with a mechanical diff, and the merge with 055 and 056 needed no re-basing.
- **[evidence: b4168f9, bbeb1df, 3d55cdc]** The task reviews caught three spec-level gaps the implementers' own tests missed:
  - uncleared viewers got no live updates;
  - a re-read moved the save revision under an unsent draft, so a stale edit silently overwrote a concurrent one;
  - the Workload hours didn't re-read on wake.

  Each was fixed in one round.
- **[evidence: 72751db]** The final whole-branch review found the over-wide grid (about 280 px hour cells). The browser test had been working around it with `scrollLeft = 480`, and no per-task review could see it. The fix also removed that workaround.
- **[evidence: the ledger, rulings R1–R16]** Every place where the plan's text and the code disagreed got a ruling before or during the work. No task stalled for lack of a decision: R10 sequenced the My profile link and screen; R14 handled the migration renumber; R13 decided the conflict semantics.
- **[evidence: 2c72775, brainstorm.md OQ1]** Writing the brainstorm surfaced the no-sign-in visibility conflict with the volunteer-roster spec. The user ruled on it before any code was written.

## 2. Misses

- 🟡 **[painful | evidence: 18248fa, ffd1cc8]** Main took two migration numbers while this change was open: 055 (#255) and then 056 (#245). That meant two renumbers, two merges, and a local database reset each time. The collision risk was in design.md from the start, but nobody re-checked main between tasks.
- 🟡 **[painful | evidence: 0fdef51, and Task 5's report of the database-store failure]** Task 1 ran only the test files it named. It missed two suites that enforce project rules: `database-actions`, which requires private helpers to be security definer, and `database-store`, which checks that the publication matches what the adapter watches. Both broke silently and surfaced two and four tasks later.
- 🟡 **[painful | evidence: the Task 6 and Task 9 interruptions]** A session end and a usage limit each stopped an implementer mid-task. Both left uncommitted work, and in both cases the RED evidence was lost (Task 9's report says so). Resuming the same agent recovered the code, but not the TDD trail.
- 🟡 **[painful | evidence: c3bd2eb, verify.md warning 1]** The seed's ordering bug survived Task 11's review and the final review. A seed re-run deleted the fictional volunteers before removing their shifts, so the delete cascade hard-deleted admin-added shifts. Only verify's design-versus-spec spot check (D2 against the seed spec) caught it.
- 📌 **[nit | evidence: the Task 10 and Task 5 ledger lines]** Several implementers kept re-sending their final report while "waiting on background work". Task 10's implementer had to be stopped with TaskStop.
- 📌 **[nit | evidence: verify.md §5]** The worktree's `.env.test` was copied from the main checkout and lacks `VITALLY_TEST_MAIL_URL`. One database suite failed for env reasons on every run.
- 📌 **[nit | evidence: verify.md warning 4]** The browser story's Chrome-client/Firefox-staff leg fails locally on this branch and on untouched main alike. A CI run has not yet confirmed it on a fresh stack; that waits for the PR, at the user's request.

## 3. Plan deviations

| Plan task | What changed | Why |
|---|---|---|
| All (migration number) | 055 → 056 → 057 | Main took 055 (#255) and then 056 (#245) during the work (rulings R14 and earlier). |
| 6 | Refusal messages went into `src/volunteer-schedule.mjs` (`SHIFT_REFUSALS`), not `src/errors.mjs` | errors.mjs is keyed by domain code. Detail-specific messages live with their domain module (R1). |
| 7 / 9 | The My profile link and route moved from Task 7 to Task 9 | So there was never a link to a screen that didn't exist yet (R10). |
| 7 | Added a live channel for uncleared viewers while on the Schedule, and in Task 9 on My profile | The spec requires live updates for every schedule viewer; the review found it missing. |
| 9 | Drafts keep their base revision | The review found a stale edit could overwrite a concurrent change without CONFLICT (R13). |
| 10 | The Workload hours re-read on wake, focus, and when the tab opens | The review found the column could stay stale. |
| 12 | The schedule walk became its own browser test, not part of the main story | It follows the existing Season settings test pattern and keeps the story's duration down. |
| (after 12) | Merged main again and renumbered to 057; final fix wave for grid width and the drag date | Main moved (#245). The final review found the two Important issues (R15). |
| 11 (after verify) | The seed removes its shifts before re-creating volunteers, and keeps volunteers who hold admin-added shifts | Verify found the seed contradicting its spec. The user chose to fix the seed (R16 covers the remainder). |

## 4. Skill / workflow compliance

| Skill | Used |
|---|---|
| superpowers:brainstorming | ✓ (conversation in step 2; the skill wrote `brainstorm.md` in step 3) |
| superpowers:writing-plans | ✓ (`plan.md`) |
| superpowers:using-git-worktrees | ✓ (confirmed the existing worktree) |
| superpowers:subagent-driven-development | ✓ (12 tasks, fix loops, final review, one fix wave) |
| (transitive) superpowers:test-driven-development | ✓ (red-first tests reported per task; RED evidence lost twice to interruptions, see §2) |
| (transitive) superpowers:requesting-code-review | ✓ (code-reviewer template for the final review; task-reviewer per task) |
| superpowers:finishing-a-development-branch | Not yet. CLAUDE.md runs it last (step 9), after archive; this retro is written before. |

### Deliberately Skipped Skills

(none) Finishing is still to come, not skipped. Per CLAUDE.md, subagent-driven development's own finish (delete the workspace, start finishing) was deferred, so the ledger survives until this retrospective.

## 5. Surprises

- Main moved twice in a day: Start next season (#255) and then OneDrive (#245). Each took the migration number this change had planned.
- OpenSpec went from 1.14 (the copy outside the worktree, used during propose) to the pinned 1.17 inside the worktree after `npm ci`. 1.17's `--strict` rejected the deltas for long requirements, which 1.14 had accepted.
- Realtime here carries INSERT and UPDATE only ("a deleted row is never announced"). That forced shift removal to be a soft delete (design D2).
- `season_settings` is unreadable from the browser by design, so site hours needed their own published table (design D1).
- The task reviews never noticed the grid width. Each looked at its own task's code, and the effect only showed in a real browser at desktop width (Task 12).
- The delete cascade on `shifts.person_id` turned an old seed behaviour, re-creating fictional volunteers, into data loss for a new table.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **Re-check main's migration numbers between tasks, not just at propose and archive.** → **Promote to** project CLAUDE.md (§2, step 5, Apply)
  > **Why**: this change was renumbered twice (055 → 056 → 057) because #255 and #245 merged while it was open.
  > **How to apply**: before each database task in apply, and before the final review, run `git fetch` and list `origin/main:supabase/migrations/`.

- [ ] 🟡 **A task that adds SQL functions, RPCs or published tables runs the rule-enforcing suites, not just its own tests.** → **Promote to** project CLAUDE.md (Verification)
  > **Why**: `tests/database-actions.mjs` (private helpers must be security definer) and `tests/database-store.mjs` (the publication matches the adapter) broke silently in Task 1 and surfaced two and four tasks later.
  > **How to apply**: name those two files in the pre-commit set of every database task brief.

- [ ] 🟡 **A new table with `on delete cascade` to `people` needs a check of every existing code path that deletes people.** → **Promote to** memory (type: feedback)
  > **Why**: the seed's long-standing delete-and-recreate of fictional volunteers silently hard-deleted shifts once `shifts` cascaded from `people` (fixed in c3bd2eb).
  > **How to apply**: when a migration adds a foreign key to `people` with a cascade, grep `tools/` and `supabase/` for `delete from public.people` and decide each path.

- [ ] 🟡 **Look at new UI at desktop width before the final review.** → **Promote to** schema (or the apply instruction)
  > **Why**: the 280 px hour cells were invisible to per-task code review, and only a browser test's `scrollLeft` workaround hinted at them.
  > **How to apply**: for a task that adds a screen, the reviewer or implementer takes one desktop-width screenshot and states what fits without scrolling.

- [ ] 📌 **Copy `.env.test` by re-running `tools/admin/write-test-env.mjs` in a new worktree, not by copying the main checkout's file.** → **One-off**
  > **Why**: the copied file lacked `VITALLY_TEST_MAIL_URL`, so one suite failed on every run.
  > **How to apply**: during worktree setup.

- [ ] 📌 **Tell implementers to commit WIP before long test runs.** → **Promote to** skill (implementer prompt)
  > **Why**: the Task 6 and Task 9 interruptions left uncommitted work and lost the RED evidence.
  > **How to apply**: in the dispatch, before `npm run test:browser` or the full database suite.

---

## 7. Ledger summary (CLAUDE.md §7: rulings, parked and deferred findings)

The ledger (`.superpowers/sdd/plan/progress.md`) is deleted after this retrospective. It recorded the following.

**Rulings**:

| Ruling | Decision |
|---|---|
| R1 | Shift refusal messages go in `SHIFT_REFUSALS` in `src/volunteer-schedule.mjs`; errors.mjs is unchanged. |
| R2 | A schedule viewer is a workspace admin (site coordinator, or the Admin role this season, with an active account), or someone with an active account and a current-season roster entry, cleared or not. `is_schedule_viewer` answers for the caller only. |
| R3 | A viewer with no profile row gets `usualDays: []` and `profileRevision: null`. Saving usual days is then refused with NOT_FOUND. |
| R4 | OpenSpec 1.17's `--strict` long-requirement warnings are accepted. CI runs non-strict. |
| R5 | Minor findings ride with the task that owns the code, not a separate fix round. |
| R6 | The schedule settings save validates the input before the lock, as 052 does. A stale revision with invalid input gets VT007, not VT003. |
| R7 | The two validators are `security definer set search_path=''` (the project rule). |
| R8 | Task 6 owned the database-store publication mismatch (STAFF_TABLES). |
| R9 | A null `p_days` is refused VT007 with no detail. |
| R10 | The My profile link and route ship with the My profile screen in Task 9. |
| R11 | An uncleared admin on Season settings updates on focus, not live. |
| R12 | A cleared My profile also re-reads on a `workspaces` change (a new season). |
| R13 | Drafts of the site-hours card and of the usual days keep their base revision, so a concurrent change gets CONFLICT. |
| R14 | Main was merged before the final review, and the migration renumbered to 057. |
| R15 | One final fix wave covered the grid width, the drag date and the cheap polish. The start-edge drag gap is documented, not fixed. |
| R16 | When a fictional volunteer is re-created, the cascade still deletes that volunteer's own already-removed seeded shift rows. Accepted (seed tool only). |

**Parked findings** (left open at a fix-loop cap): none. Every Important finding was fixed within one round.

**Deferred minor findings, closed later**:
- Task 1's five findings were carried into Tasks 2–4 and closed there:
  - the huge-hour overflow;
  - extra keys inside a day;
  - removed-row readability;
  - the R2 (a) branch;
  - the uncleared viewer read.
- Task 2's "send the whole object" was closed by Task 9's card.
- The Task 7 local "Choose a volunteer." check, the two landmarks sharing a label, and the revision comment were fixed in 72751db.
- The Task 8 drag date was fixed in 72751db (final finding F2). The Task 8 cancel wiring is covered by the Task 12 story.
- The Task 9 toggle-group accessibility was fixed in 72751db. The post-CONFLICT draft worry was resolved by the final review: `clearFormDrafts` runs on CONFLICT.
- The Task 10 week-read failure skipping `loadSelected` was fixed in 3d55cdc.
- Task 12's two missing helpers in database.md, the MOBILE_WIDTH message and the scrollLeft screenshot were fixed in 72751db.
- The grid-width flag was fixed in 72751db (final finding F1).

**Deferred minor findings still open** (the final review triaged all of these as fine to leave):
- **Database tests**:
  - no precedence test for the domain refusal reasons;
  - no test for a shift id from another workspace;
  - no coverage-exclusion test for a cleared volunteer with a flagged shift, or for a shift from another season or date;
  - the registry cleanup leaves `updated_at`;
  - the flags are computed twice per shift;
  - a setup save in the usual-days test doesn't check its error;
  - the My profile week test can flake at New York midnight;
  - a VT001 test for a preparer on the settings save, and a replay-after-later-save test;
  - an over-long comment line, and an unmarked `create or replace` line.
- **Browser and unit tests**:
  - `weekShifts` has no unit test, and the shiftLine and coverage cases are narrow;
  - the controller tests use no clock that falls on a different date in New York than in UTC;
  - no test for losing viewer status while cleared;
  - the privacy view test strips flags before rendering;
  - the `app.mjs` pointer wiring has no unit test, and click suppression uses a 100 ms timeout;
  - no test for the site-hours lost-answer resend, or for an uncleared viewer on My profile signing out;
  - the Task 9 RED evidence was lost to the interruption.
- **Behaviour**:
  - `dropWork` leaves `schedule.drawer` behind;
  - the Roster drawer's toggles are not disabled while busy;
  - a `schedule_settings` change triggers an unneeded My profile re-read;
  - a failed week read shows as a page-level Volunteers error;
  - `vitally_save_shift` doesn't check the season on an edit (no harm: the row stays invisible);
  - dragging the start edge of a shift already outside site hours does nothing and shows no message;
  - `hourLabel(24)` reads "12 am".
- **Seed**: a skipped shift is silent; no Saturday gap when Saturday has one or no open hours; no tests for a missing run-file id or the OVERLAP skip; the Saturday-only test asserts only that there is at least one shift.
- **Docs**: the `weekHours` week argument has no doc comment; the 40 s browser budget isn't enforced.
- **Pre-existing, outside this change**: the Season settings links card can overwrite a concurrent change after a focus re-read.
