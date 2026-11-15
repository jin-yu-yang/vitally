# Retrospective: add-case-labels

> Written: 2026-11-15 (after verify passed with warnings)
> Commit range: `6add349..2bc9e0c` (plus this file and the archive commit)
> Worktree: `.claude/worktrees/add-case-labels` (branch `add-case-labels`, pushed)

---

## 0. Evidence

- **Commit range**: `6add349..2bc9e0c` (31 commits). 11 of them only tick `tasks.md`, and 3 are planning or verify documents.
- **Diff size**: +4150 / −61 lines across 47 files. That includes the change's own planning artifacts and the regenerated golden `tests/fixtures/empty-states.json`.
- **Tasks done**: 25/25 (`grep -c '^- \[x\]' tasks.md` → 25)
- **Active hours**: about 5.2 h of apply time (11:58–17:08 by commit times). Before that came an explore, brainstorm and propose session the same morning, and two usage-limit pauses happened during apply.
- **Subagent dispatches**: 30 fresh agents and 5 resumes.
  - **Implementers:** 10 tasks, 2 fresh fix-round implementers, 1 bug-fix implementer, 1 Task 10 completion implementer, 1 final fix wave.
  - **Task reviewers:** 10, plus 1 for the bug fix.
  - **Scoped re-reviewers:** 4.
  - **Final whole-branch reviewer:** 1 (opus).
  - **The 5 resumes:** fix rounds and diagnosis, via SendMessage.
- **New external dependencies**: none. A helper installed Playwright's own Firefox into the user's cache (`npx playwright install firefox`); the repo's dependencies are unchanged.
- **Bugs encountered post-merge**: none yet (not merged).
- **OpenSpec validate state at archive**: pass (16/16 before archive; re-run at archive).
- **Test coverage signal**:
  - **Unit:** `npm test` 1738 tests; 1737 pass and 1 known Windows-only failure.
  - **Database:** 599 tests, including the new `tests/database-labels.mjs`. CI green; locally 596/599, with 3 Realtime timeouts under the parallel load.
  - **Browser story:** 90/90 locally and in CI, with a new label phase.
  - **CI run:** https://github.com/jin-yu-yang/vitally/actions/runs/43766090390 (all 5 jobs green on `8a1b4ed`).

Commit chain (in time order, tick-only commits omitted):

```
ffea994 Plan OpenSpec change add-case-labels (#148)
31b692a Case labels: tables, starter labels, staff-only visibility (051)
71a9fc3 Case labels: vitally_save_label
2134812 Case labels: vitally_set_case_label
c766f22 Case labels: test the assigned reviewer's label path
908b67c Case labels: RPC signatures and clearance lists
51a7580 Case labels: service_role grants; links policy in the visibility-rule copies test
8f76f7a Case labels: store calls and eligibility
dd3b787 Case labels: controller and menu state
0c7d514 Case labels: kebab-case label menu field names
7ed3947 Case labels: keep the label form's typed values across redraws
7220a9d Case labels: chips, colors and the case header menu
5d85f61 Case labels: work board, case pool filter, history
e925845 Case labels: seed rehearsal cases
36acacf Case labels: developer docs
f4749bd Case labels: story phase (fails until the case page and live refresh carry labels)
80d5729 Case labels: the case page and live refresh carry labels
95fdf64 Case labels: database test count
bb0965a Case labels: final review fixes
2bc9e0c add-case-labels: verify (pass with warnings; CI run 43766090390 green)
<archive commit>
```

---

## 1. Wins

- **[evidence: f4749bd → 80d5729] The browser story caught two real product bugs that unit tests and five task reviews had missed.**
  - The staff case page read its case through `getCase`, which never attached labels.
  - Label-table changes did not refresh other windows.
  - Writing the end-to-end story before calling the change done paid for itself.
- **[evidence: 2134812, `tests/database-labels.mjs`] The database contract held up under adversarial review.**
  - Check order matches D4.
  - The idempotent upsert writes exactly one history line under concurrent adds.
  - `cases.revision` and `updated_at` are untouched; a test proves that `SUBMIT_REVIEW` at the pre-label revision still succeeds.
  - The final opus review found no correctness defect.
- **[evidence: 31b692a, design D7] The trigger kept us clear of a known merge collision.** Seeding the starter labels from a trigger on `workspaces` avoided redefining `initialize_workspace`, which `add-account-invitations` (047) also replaces.
- **[evidence: R1, R3, R6 in the ledger] The pre-flight scan caught two plan gaps before any code.**
  - `STAFF_TABLES` and the publication have to change in the same task.
  - `src/views.mjs` was missing from Task 7.
  - The R6 markup contract (kebab-case field names written into Task 6's report) let Task 7 hit the controller's selectors first time.
- **[evidence: Task 3 and Task 6 fix rounds] Per-task review found real gaps quickly.**
  - The assigned reviewer's success path was untested.
  - The label form lost typed text on a Realtime redraw.
- **[evidence: CI run 43766090390] CI on the exact head commit settled the "is it us?" question** about the Realtime timeouts without a local main-baseline run.
- **[evidence: 7220a9d report] Contrast was measured, not assumed.** All six `-ink` on `-bg` pairs are ≥ 6.37:1, against the 4.5:1 required.

## 2. Misses

- 🟡 **[painful | evidence: ledger lines 104–106, 80d5729] Task 5's plan named only `listCases`, not the single-case read `getCase`.** So the staff case page never had labels until the story ran in Task 10. This was a plan defect: the plan author (Claude, at propose) didn't map which store read feeds which screen. It cost one extra fix round and a second 20-minute story run.
- 🟡 **[painful | evidence: ledger lines 49–51, 124–125] Three long-run incidents on the shared local stack.**
  - **A stalled helper.** The Task 4 helper stalled for about 50 minutes on a Realtime rerun; the user had to stop it.
  - **Overlapping database suites.** The Task 10 completion helper was assumed "cut off" but kept running, so two full database suites ran against one stack at once (10 Realtime timeouts instead of 3).
  - **A hung test runner.** The final fix wave's test runner hung after printing 90/90, and three node processes had to be ended by hand.

  All three came from background runs that no one was clearly watching.
- 🟡 **[painful | evidence: db-solo.log] The local full database suite is not green on this Windows machine.** Three Realtime timeouts recur under the parallel run and pass alone. CI is green, so task 2.6 and verify relied on CI, which CLAUDE.md allows. The root cause of the local timeouts was not investigated.
- 🟡 **[painful | evidence: ledger line 116, bb0965a] The first label screenshots were unusable.** The sidebar peek overlaid the header and filters. The story already had `shootWithoutSidebar`, and the Task 10 brief didn't name it. This cost a final-review round and another story run.
- 📌 **[nit | evidence: Task 4 fix round 1, 51a7580] 051 first shipped without `service_role` grants.** Every other workflow table has them, and the shared privilege test only caught it when the links table joined the visibility-copies test (ruling R4).
- 📌 **[nit | evidence: Task 6 fix round, B1/B2 fix] Two fix rounds wrote their tests after the code**, so they have no clean RED. Reviewers checked that the tests would fail without the fix.
- 📌 **[nit | evidence: 0c7d514, R7] The two halves of a UI contract were guessed separately.** Task 6 guessed field names and Task 7's plan text had others, so R6 had to reconcile them.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| 1 (store list) | Task 1 also added both tables to `STAFF_TABLES` (R1) | `tests/database-store.mjs` asserts the publication equals the subscribed list. The plan had split them across tasks 1 and 5. |
| 4 | 051 amended with `service_role` grants (R4); `case_label_links` added to the visibility-rule copies test | Brief and docs rule; the shared privilege test required the grants |
| 5 + 6 | Extra fix (`80d5729`): `getCase` carries labels; label-table events re-read the list and the open case | The plan named only `listCases`; the story exposed both gaps (R8) |
| 6 | Field names reconciled to kebab-case (R6); `setLabelDraft` keeps typed form values across redraws | Plan T7 fixed `label-color`; a review found the redraw data loss |
| 7 | The search filters the label rows (R7); an admin "New label" button with an empty search | A search box should filter. The button is an addition the final reviewer judged harmless; it is recorded as spec drift in verify §4. |
| 10 | Screenshots moved to `shootWithoutSidebar`; Escape/focus and work-board-rename steps added; busy-disabling, `aria-haspopup` removal, stale counts, setup-doc note (`bb0965a`) | Final whole-branch review findings |
| 2.6 / verify | Closed on the green CI `database` job instead of a green local run (R5) | Local parallel-load Realtime timeouts on Windows. CLAUDE.md allows CI to stand in. |

## 4. Skill / workflow compliance

| Skill                                            | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming                        | ✓ (the design was agreed in `/opsx:explore`; the skill captured it into `brainstorm.md` at propose, per CLAUDE.md step 2) |
| superpowers:writing-plans                        | ✓ (`plan.md`) |
| superpowers:using-git-worktrees                  | ✓ (`.claude/worktrees/add-case-labels` on the existing branch, entered with EnterWorktree) |
| superpowers:subagent-driven-development          | ✓ (ledger, pre-flight scan, per-task reviews, fix loops, final review, one fix wave) |
| (transitive) superpowers:test-driven-development | ✓ (RED/GREEN in each implementer report; two fix rounds were test-after, see §2) |
| (transitive) superpowers:requesting-code-review  | ✓ (a task reviewer per task, scoped re-reviews, a final opus review with code-reviewer.md) |
| superpowers:finishing-a-development-branch       | ✓ (CLAUDE.md step 9, after archive) |

### Deliberately Skipped Skills

(none). The superpowers:brainstorming builder check was done by the controller itself rather than by a dispatched subagent, because the Agent tool says not to spawn agents unasked at that stage. That is a sub-step variation, not a skipped skill.

## 5. Surprises

- **Realtime-heavy database tests are load-sensitive on this machine.** The same three tests time out under the full parallel suite and pass alone. More concurrent load (two suites, or a story run just before) raises the count.
- **An agent reported as cut off can still be running.** It may leave background processes and keep writing logs and commits, so its process tree and log timestamps need checking before anyone else starts a run on the shared stack.
- **Playwright's Firefox wasn't installed on the machine** even though the story is a CI requirement.
- **The worktree guard refuses compound shell commands** that mention git (including the `GitHub CLI` path), which forced simple one-command calls and a script file for CI polling.
- **`main` didn't move during the whole cycle**, so the merge before archive was a no-op and migration 051 stayed free.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **When a plan adds data to a list read, name every read path that feeds a screen (list *and* single-record).** → **Promote to memory** (type: feedback)
  > **Why**: Task 5 named only `listCases`; the staff case page uses `getCase`, so labels never reached the case header until the browser story ran (B1, `80d5729`).
  > **How to apply**: At writing-plans, for any new field shown on a screen, grep the store for every read that builds that screen's record and list each in the task's Files.

- [ ] 🟡 **One long-running suite per shared local stack at a time, and confirm the previous runner is really gone before starting another.** → **Promote to project CLAUDE.md** (Project rules → Local test stack)
  > **Why**: Overlapping database suites tripled the Realtime timeouts (3 → 10) and nearly sent a false regression into verify. A helper reported as cut off was still running.
  > **How to apply**: Before `test:database` or `test:browser`, check for running `node … --test` processes, and never dispatch two agents that may run suites concurrently.

- [ ] 🟡 **Name the story's screenshot helper (`shootWithoutSidebar`) and the pointer position in any task that adds staff screenshots.** → **Promote to memory** (type: project)
  > **Why**: Plain `shoot` at narrow widths captured the sidebar peek over the UI under test, which cost a final-review round.
  > **How to apply**: Whenever a plan task adds a `shoot(...)` of a staff page in `tests/browser.mjs`.

- [ ] 📌 **Long background runs dispatched to helpers need an explicit time limit and a "no runs left behind" rule in the brief.** → **Promote to memory** (type: feedback)
  > **Why**: Without one, the Task 4 helper stalled for about 50 minutes. With the 45-minute rule, later runs reported on time; one runner still hung on exit.
  > **How to apply**: Every dispatch that runs `test:browser` or `test:database`.

- [ ] 📌 **Follow-up: align `check_label`'s trimming with the browser (R9).** → **One-off** (a follow-up change or issue)
  > **Why**: `btrim` strips spaces only, so a direct RPC call can store a name with a leading tab or newline. The UI is unaffected.
  > **How to apply**: The next migration that touches labels: `btrim(x, E' \t\r\n')` or a regex check.

- [ ] 📌 **Follow-up issue: deleting a label** (the user asked for it to be filed; the draft text was given in the session). → **One-off**
  > **Why**: Out of scope by decision Q3; what happens to cases carrying the label is undecided.
  > **How to apply**: The user files the drafted issue.

- [ ] 📌 **Follow-up: canonical spec wording for the menu's search filtering and the admin "New label" button** (verify §4 drift). → **One-off**
  > **Why**: The behaviour is reasonable and recorded, but the spec sentence "one toggle per workspace label" doesn't mention filtering.
  > **How to apply**: The next change that touches `case-labels`.

---

## Appendix: SDD ledger summary (rulings, parked and deferred findings)

The ledger (`.superpowers/sdd/plan/progress.md`) is deleted after this retrospective, as CLAUDE.md step 7 requires. This is its complete summary.

### Rulings (controller decisions, with cost if wrong)

1. **R1.** Task 1 also adds `case_labels` and `case_label_links` to `STAFF_TABLES`, because the database-store test requires the publication and the subscribed list to match. *Cost:* a trivial move.
2. **R2.** `canLabelCase` and `canManageLabels` read `person.capabilities` of the same person object that `isAdmin(person)` uses in the views. *Cost:* buttons shown or hidden wrongly; the database still refuses.
3. **R3.** Task 7 may edit `src/views.mjs` to pass `labels` and `labelMenu` to the case page. *Cost:* none.
4. **R4.** Amend 051 itself (a branch-only migration) with `service_role` grants matching the other staff-only workflow tables, and re-apply locally. No new migration. *Cost:* one grant line.
5. **R5.** Task 2.6 stays open until a full database run is green; it was closed on the CI `database` job. *Cost:* none.
6. **R6.** The label form's field names are kebab-case (`label-name`, `label-color`, `label-search`), and toggles carry `data-on`. Escape closes the whole menu. *Cost:* renames.
7. **R7.** The menu's search filters the label rows. *Cost:* the search would show everything.
8. **R8.** Fix B1 and B2 (`getCase` labels; live refresh) in a focused, reviewed round, and keep the story commit as the end-to-end check. *Cost:* one extra commit.
9. **R9.** Parked: the `btrim` and whitespace mismatch in `check_label`. It is harmless through the UI and listed as a follow-up in §6. *Cost:* a label name with a leading tab via a direct RPC call.

### Parked findings

- **R9** (above) is the only parked finding. No fix loop reached its cap.

### Deferred minor findings (all triaged "can stay" by the final reviewer unless noted)

- **T1 (tables, starter labels, visibility)**
  - `case_label_links.changed_by_person_id` is NOT NULL; both RPCs always pass a person.
  - The `label_id` index is single-column.
  - One `assert.rejects` and the no-write-grants test are not pinned to a specific error.
  - Docs: done in Task 10.
- **T2 (`vitally_save_label`)**
  - Refusal tests don't snapshot `case_labels`.
  - No order test for "client plus bad label".
  - The `unique_violation` race branch is untested.
  - The digest is taken over the raw `p_label`.
- **T3 (`vitally_set_case_label`)**
  - The foreign-workspace refusal test originally didn't check receipts (fixed in its round).
  - A variable was named `mfs` (fixed).
  - The Realtime test picks a label with `limit 1` and no order.
  - The concurrent-adds test doesn't assert which person changed the link.
- **T4 (shared contracts)**
  - Possible stale counts: the doc ones were fixed in `36acacf` and `bb0965a`; the remaining hits are historical migration rows.
  - A label-id lookup query is repeated.
  - A `revoke … service_role` is redundant.
- **T5 (store, eligibility)**
  - `Number(revision)` has no comment.
  - `listCases` reads all labels (RLS-scoped).
  - No test for action-id reuse on retry.
  - No test for `canLabelCase` when `person.id` is undefined.
- **T6 (controller)**
  - Stale `labelMenu` on navigation: resolved in the fix round.
  - A `listLabels` failure is coupled to the case-list load.
  - Label deleted elsewhere: impossible, since labels can't be deleted.
  - CONFLICT shows two messages.
  - Test gaps: a refusal getting a new action id, create-then-add failing, pending-key reuse.
  - Focus handling for cancel and close.
  - `setLabelDraft` doesn't validate the color.
  - The `app.mjs` wiring was only syntax-checked; the Escape and focus path was then covered by a story step in `bb0965a`.
- **T7 (chips, colors, header menu)**
  - The "New label" button with an empty search (an addition, untested).
  - "No label matches." appears beside an empty list.
  - `maxlength="24"` is hard-coded.
  - A raw `999px` border radius.
  - One loose test regex.
- **T8 (board, pool, history)**
  - A long line, and `labels.some` runs per `poolFilters` call.
  - The `historySentence` ternary chain keeps growing.
  - No test for `ui.labels` omitted while `poolLabel` is set.
- **T9 (seed)**
  - The label lookup runs per scenario and label pair.
  - The unit test hard-codes the closed scenario names.
- **B1/B2 fix**
  - The `getCase` wrapper is not re-indented.
  - A rename re-reads the open case even when nothing visible changes.
- **Final fix wave**
  - Busy-disabling a focused toggle may drop keyboard focus, consistent with other busy buttons.
- **Final review minors**
  - **Fixed** in `bb0965a`: `dataset.caseId`, busy-disable, `aria-haspopup`, stale RPC counts, the setup-doc line, and the work-board rename assertion.
  - **Parked:** `btrim` (R9).
