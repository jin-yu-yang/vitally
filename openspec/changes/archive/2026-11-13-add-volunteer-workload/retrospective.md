# Retrospective: add-volunteer-workload

> Written: 2026-11-13 (after verify passed)
> Commit range: `06ebee6..319037c` (before archive)
> Worktree: `D:/dev/vitally-workload`, branch `add-volunteer-workload`

---

## 0. Evidence

- **Commit range**: `06ebee6..319037c` (21 commits before the archive commit)
- **Diff size**: +4591 / -47 lines across 39 files
- **Tasks done**: 17/17
- **Active hours**: about 1.7 h of apply, from 20:16 to 21:56 −05:00 on 2026-11-13. Exploration and brainstorm came before that, in the same session.
- **Subagent dispatches**: 22
  - 7 implementers and 2 fix-round resumes;
  - 8 task reviews and 3 scoped re-reviews;
  - 1 final whole-branch review, 1 final fixer.
- **New external dependencies**: none
- **Bugs encountered post-merge**: none yet (not merged)
- **OpenSpec validate state at archive**: pass (15/15 before archive)
- **Test coverage signal**:
  - unit tests (`npm test`): 1627 → 1695, +68, no test removed;
  - database tests (CI): 569 → 572 across runs, including 2 new `ASSIGN_CASE` suites;
  - CI run 43547716921 all green on `de1a4a0`.

Commit chain (in order):

```
cf087ac Plan OpenSpec change add-volunteer-workload (#139)
37afea3 Workload: ASSIGN_CASE wiring and refusals
3fa69e7 Workload: the After-approval refusal reaches the stage rule
ab5bf45 Workload: ASSIGN_CASE assigns like a claim and hands over work in progress
de763a9 Workload: latest contact time per case and the ASSIGN_CASE contract
e6f66f0 Workload artifacts: the contact log's logged time is logged_at
15e209f Workload: counts, Stalled and drawer ordering
cf49fb0 Workload: tab, table, drawer and history sentence
b3bd27e Workload: controller, wiring and styles
855e8c5 / 23ddd1c Workload: developer docs (+ review fixes)
668847e / 99c415f / 83e5d0a / de1a4a0 final-review fix wave
319037c Workload: verify.md
(+ tasks.md tick commits 710fbcf, 67d3019, ac64b46, 36e6810, a342d05; archive commit follows)
```

---

## 1. Wins

- **One action inside the existing pipeline paid off.** `act_assign_case` came with receipts, the case lock,
  the revision check, `NOT_CLEARED` first, the case event and the client line, all from `vitally_apply_action`.
  The final review diffed every re-created function against its latest definition and found only the `-- 046`
  lines changed (`ab5bf45`). Replay worked without new code; it is pinned by "replay returns the stored receipt" (`83e5d0a`).
- **The database tests passed on their first CI run.** They were written and reviewed without a local run, because
  the local stack is shared. CI 43541714846 passed the database job 569/569 on its first attempt (Ruling 1). Careful
  review of the fixture use paid off: the Task 1 review caught that the "After approval" test was refused as
  "same holder" before it ever reached the stage rule (fixed in `3fa69e7`).
- **The brainstorm's code reading prevented two spec mistakes before any code.** One was effective versus ceiling
  capabilities for an assignee (Q4). The other was that the roster's open-work rule counts filed cases, which would
  have inflated Open (Q5).
- **The final whole-branch review found a real, user-visible bug** that every task review missed: a logged contact
  did not clear Stalled until the window regained focus (`668847e`). The three gating layers (views, controller,
  database) were checked to agree.

## 2. Misses

- 🟡 [painful | evidence: `de763a9`, `e6f66f0`] **The planning artifacts named a column that doesn't exist**:
  `contact_log.created_at`. The table has `logged_at` and `contacted_at` (031). I wrote design D3 and the plan from
  the brainstorm without opening 031. The implementer caught it; the artifacts were corrected (Ruling 3).
- 🟡 [painful | evidence: `668847e`] **Neither the design nor the plan traced the Realtime path for `contact_log`.**
  Design D3 said "Realtime keeps it live", but only `cases`/`workspaces` changes re-read the list. No task-level
  reviewer could see it; only the whole-branch review could.
- 🔴 [painful | evidence: PR #195 review, `f965184`] **Assign could silently become a Reassign.** `assignCase`
  read `expectedRevision` from the live case list when Choose was pressed, and that list is re-read on every
  Realtime change, so the revision was always current and could not catch a case claimed while the drawer was
  open; the claimant lost the case. Ruling R2 described it as sending "the listed revision", and my summary to
  the user said Assign sent "the revision the Workload showed": both were wrong. No task review or the final
  review caught it; two human reviewers did. Fixed both ways: the drawer captures the revision and holder when
  it opens, and `ASSIGN_CASE` carries `expectedHolderId`, refused with `CONFLICT` on a mismatch.
- 🟡 [painful | evidence: PR #195 review, `f965184`] **Rows hid cases held without the role.** Rows were only for
  people with effective `prepare`/`review`, so unticking a role by mistake made that person's cases vanish from
  the Workload. Now such a holder keeps a tagged row. The proposal's "Why" also cited a preparer leaving
  mid-season, which doesn't happen in practice; reworded to illness, schedule conflicts and uneven load.
- 📌 [nit | evidence: `855e8c5` → `23ddd1c`] **The docs task had to be redone once.** The first pass said
  `NOT_CLEARED` for an uncleared assignee (it is `INELIGIBLE`) and left three stale roadmap lines.
- 📌 [nit | evidence: ledger] **Session confusion.** A message meant for another session (the accounts change) arrived
  twice. It was declined both times, and the one side effect (a change scaffold and an empty branch) was undone
  before planning resumed.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| 1 / 2 (database) | No local RED/GREEN; first run in CI right after Task 2 | Shared local stack; the user asked for CI only (Ruling 1) |
| 3 | `logged_at` instead of `created_at`; added a placeholder `EVENT_SENTENCES.ASSIGN_CASE` | The column doesn't exist; an existing per-action test needs a sentence for every action |
| 5 | Preparer-slot hidden note: "1 person who is reviewing this case isn't shown." | The spec only gave the reviewer-slot sentence, as an example (Ruling 4) |
| 6 | Changed `src/ui.mjs` focus matching; added `setAssignSearch` | Keep keyboard focus across redraws of the new buttons; the drawer's search box |
| 7 | The controller ran CI instead of the implementer | Implementers don't push |
| Final fix wave (not in plan) | `contact_log` Realtime re-reads the list; contact read newest-first; replay and preparer-reassign tests; `if not found` in 046; docs | Final review findings |

## 4. Skill / workflow compliance

| Skill                                            | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming                        | ✓ (method in conversation; skill invoked at propose to capture brainstorm.md) |
| superpowers:writing-plans                        | ✓ |
| superpowers:using-git-worktrees                  | ✓ (detected the existing linked worktree) |
| superpowers:subagent-driven-development          | ✓ |
| (transitive) superpowers:test-driven-development | ✓ for unit tests. Database tests ran in CI only (see below) |
| (transitive) superpowers:requesting-code-review  | ✓ (per-task reviews and the final review) |
| superpowers:finishing-a-development-branch       | ✓ (step 9, after archive) |

### Deliberately Skipped Skills

- **`superpowers:test-driven-development`: local RED for database tests**
  - **What was skipped**: the RED/GREEN local runs for `tests/database-workload.mjs` in Tasks 1, 2 and the final wave.
  - **Why this cycle**: the user said database suites run in CI only, because two other sessions share the local Supabase stack, and a local 046 could collide with their migrations.
  - **How to prevent recurrence**: `scope-judgment rule`. When local database runs are off-limits, plan one CI database run right after the first database task and treat it as the RED/GREEN gate. This cycle did that (CI 43541714846).

## 5. Surprises

- `contact_log` has no `created_at`. It has `logged_at` (when it was recorded) and `contacted_at` (when it happened).
- Logging a contact never touches the `cases` row, so the case list's Realtime refresh never fires for it.
- The role accounts in the database fixture have narrow ceilings: the reviewer has only `review`. So every
  `SELF_REVIEW` test needs a person with both `prepare` and `review`, or an earlier `INELIGIBLE` hides the rule.
- PostgREST's `max_rows` truncates from the end of the ordered result. An ascending "newest per case" read would
  silently drop the newest rows (`99c415f`).

### Rulings, parked findings and deferred minors (from the ledger)

**Rulings:**
- **R1.** Database tests are written without a local run; the first CI run comes right after Task 2. Cost if wrong: one CI cycle.
- **R2.** `assignCase` sends through `dispatch` with the listed revision and no open case. Cost if wrong: a review round. *Wrong as built: "the listed revision" was read live at press time. Corrected after the PR #195 review (see Misses).*
- **R3.** `logged_at` is the contact time; the artifacts were corrected. Cost if wrong: none.
- **R4.** The preparer-slot hidden-note wording. Cost if wrong: a wording change.
- **R5.** Inline width styles on the bar (there is no CSP). Cost if wrong: restyle.
- **R6.** No UI path to reassign a preparer at Pending review or Review in progress: rows list Open cases only, which is spec-consistent, and the database allows it. Cost if wrong: a follow-up issue.

**Parked at the final review:**
- If `loadList` throws after a contact is logged, the open case's re-read is skipped (the screen says it is stale, never that the write failed).
- The store test's contact rows are all on one case.
- Every `contact_log` event re-reads `listCases` in every staff window.

**Deferred minors (the final review triaged them all as "can stay"):**
- **Task 1:** the guard-list comment wording.
- **Task 2:**
  - the mid-review version check can't tell the column from a literal 1;
  - other review rows' statuses are not asserted.
- **Task 3:**
  - no id tie-break (later fixed in `99c415f`);
  - the test fed rows in order (later fixed).
- **Task 4:**
  - an inconsistent fixture;
  - no tests pinning the hidden count for uncleared participants, or the current holder listed when uncleared.
- **Task 5:**
  - `toggle(name)` takes pre-escaped HTML;
  - `slot` is interpolated unescaped (an internal value).
- **Task 6:**
  - a retry after a lost answer doesn't close the drawer;
  - Review segment contrast is about 2.3:1 (the numbers are also in text);
  - the drawer stays open if effective admin is lost;
  - a `border-color` with no border;
  - patch key names differ from the brief.
- **Task 7:** `docs/m4-tradeoffs.md` still calls reassignment a February pilot item (historical doc, left alone).

## 6. Promote candidates → long-term learning

- [ ] 🟡 **Open the migration that defines a table before naming its columns in a design.** → **Promote to memory** (type: feedback)
  > **Why**: add-volunteer-workload's design and plan named `contact_log.created_at`, which doesn't exist (031 has `logged_at`/`contacted_at`). An implementer caught it mid-apply.
  > **How to apply**: when writing design.md or plan.md, run a `grep -n "create table public.<t>"` for every table whose columns the design names.

- [ ] 🟡 **Any "live" claim in a design must name the Realtime table that triggers the refresh.** → **Promote to memory** (type: feedback)
  > **Why**: Design D3 said the counts stay live, but a logged contact changes `contact_log`, not `cases`. Only the final whole-branch review caught it (`668847e`).
  > **How to apply**: for each derived value on a staff screen, list its source tables and check `handleChange`'s `touchesList`/`touchesOpen` for each one.

- [ ] 🔴 **An optimistic-concurrency token must be captured when the user sees the state, never read at press time from a live list.** → **Promote to memory** (type: feedback)
  > **Why**: add-volunteer-workload's drawer read `expectedRevision` from the Realtime-refreshed case list at Choose, so the CONFLICT check could never fire; PR #195's reviewers caught it.
  > **How to apply**: for any action sent from a dialog over live data, store the revision (and the state the action depends on) in the dialog context when it opens, and test "changed while the dialog is open".

- [ ] 📌 **When local database runs are off-limits, the first CI database run is the RED/GREEN gate.** → **One-off** (recorded here)
  > **Why**: this cycle worked: the database tests passed their first CI run, after careful reviews of fixture use.
  > **How to apply**: if the shared-stack constraint recurs, put "push and run CI after the first database task" in the plan's pre-flight rulings.
