# Retrospective: fix-hidden-household-rows

> Written: 2026-11-16 (after verify passed)
> Commit range: `6add349..889f290`
> Worktree: `D:/dev/vitally-175`

---

## 0. Evidence

- **Commit range:** `6add349..889f290` (13 commits, including the planning commit and verify)
- **Diff size:** +1066 / −34 lines across 21 files
- **Tasks done:** 13/13
- **Active hours:** about 3 to 4, spread over 2026-11-15 and 2026-11-16 (CI waits not counted)
- **Subagent dispatches:** about 16:
  - one implementer and one reviewer for each of Tasks 1–6;
  - one fix round and one scoped re-review for Task 5;
  - the final whole-branch review (opus);
  - one fix-wave implementer and one scoped re-review.
- **New external dependencies:** none
- **Bugs found after merge:** none yet (not merged)
- **OpenSpec validate at archive:** pass (16/16)
- **Test coverage signal:**
  - `npm test`: 1700 → 1711 tests. The one Windows-only `write-test-env` failure is there before and after.
  - CI `database`: 575 tests at the red commit, 578 at the head, all passing.

Commit chain:

```
4d3357f Propose fix-hidden-household-rows (#175)
b6be8e3 Shaded section: one rule for visible household rows
0e8a86e Draft 13614-C: print and stamp only visible household cells
f4e019b Case page: count only visible shaded cells
72d7153 Database tests: reproduce hidden household rows counting   ← red on CI 43686396016
0f93252 Migration 050: household_rows and the save keeps hidden cells
94f324e Database tests: hidden household cells
3168a4e Database tests: hidden cells are still stored on Yes; empty save names nothing
7c4605d Docs: hidden household rows and migration 050
f1abf0b tick completed tasks                                        ← green (db) on CI 43687435576
fbfbab1 Final review follow-ups
8e45d0c draftFields comment                                         ← all green on CI 43688186823
889f290 verify.md; tasks 4.3 done
```

---

## 1. Wins

- **The reproduction ran on a real stack before the fix.** `72d7153` was pushed alone, and CI run 43686396016 failed exactly the 2 new database tests out of 575. One failure was the missing function; the other was "Missing expected rejection". This shows the tests catch #175 and nothing else, even though the database suite can't run locally.
- **One rule, in two languages, kept equal by a test.** `householdRows` (src/shaded-fields.mjs) and `vitally_private.household_rows` (050) both rely on catalogue visibility, and "the browser and the database count the same household rows" checks them on one table. That table includes old-data edge cases: members with no answer, and a non-list `hh`.
- **The reader survey found a fifth reader.** Before any code was written, the grep of shaded-field readers found the case page's "N fields filled" (src/staff-views.mjs) on top of the four places named in the request. Task 3 covers it.
- **No data is lost and no save gets stuck.** Hidden cells are carried by the save (design D4), and two database tests pin it down:
  - "hidden cells are kept, unnamed, and come back";
  - "only hidden cells stored: an empty save is accepted".
- **The final review caught two kinds of drift this change caused,** and both were fixed in `fbfbab1`:
  - the names and the cells used different catalogue versions in `draftFields`;
  - the editing copy filtered on draft answers while the Save check used the saved answers.

## 2. Misses

- 🟡 **The CI waits were the slow part, and one wait died.** Each full run takes about 25 minutes. The background waiter was killed for low memory, so the last check was a one-shot.
- 📌 **The Task 3 implementer used the wrong attribution trailer** (`3c1e306`). I amended the message only, giving `f4e019b`.
- 📌 **The Task 1 implementer wrote CRLF line endings,** which broke `shell.test.mjs`. They were converted to LF before the commit.
- 📌 **The plan assumed 039 revokes `act_save_preparer_fields`.** It doesn't, and the plan step was corrected before Task 4.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| 3.2 / 3.3 (Task 4) | The database tests were committed before migration 050 and run on CI first (ruling R1) | The database suite can't run locally, so red/green was only visible on CI |
| 2.3 (Task 2) | The existing draft-pdf round-trip test moved from `BASE` to `WITH_CHILD` | `BASE` has no household member, so its row cells are now hidden. All the test's assertions were kept, and the reviewer agreed. |
| 2.3 | `draftFields` uses the case's version for names too, not only cells (ruling R6, superseding R3) | So the names and the cells next to them can't use different versions |
| 2.4 | The editing copy filters on `savedCase.answers`, not the draft answers (R6) | The same source as the Save check |
| 4.1 | Also updated `docs/developer/frontend.md`, and corrected the `database.md` function table for 046's redefinitions | Final-review minors. The table drift predates this change, but this branch touched the same table. |

## 4. Skill / workflow compliance

| Skill | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming | ✓ (method in conversation; skill for brainstorm.md) |
| superpowers:writing-plans | ✓ |
| superpowers:using-git-worktrees | ✓ (worktree `D:/dev/vitally-175`) |
| superpowers:subagent-driven-development | ✓ |
| (transitive) superpowers:test-driven-development | ✓ (unit tests red first; database red on CI) |
| (transitive) superpowers:requesting-code-review | ✓ (a review per task plus the final review) |
| superpowers:finishing-a-development-branch | ✓ (step 9) |

### Deliberately Skipped Skills

None.

## 5. Surprises

- **`intake_version` can't be null.** It is `smallint not null` (011) and checked `= 2` (023), so the browser's fallback to 2 never runs for real cases. It stays only for hand-built test records (design D3).
- **The migration runner doesn't care about gaps.** `tools/admin/migrate.mjs` applies files in name order with no contiguity check, so 050 works while 049 is still unmerged.
- **The story never fills a hidden household cell,** so none of its screenshots shows this change. The unit and database tests carry the evidence.

## 6. Promote candidates → long-term learning

- [ ] 🟡 When a suite can only run in CI, commit the failing tests on their own and run CI on that commit before the fix.
  → **Promote to** memory (feedback)
  > **Why**: it was the only way to show red for the database reproduction without the shared local stack, and it cost one extra CI run.
  > **How to apply**: a bug fix whose reproduction is a database, sign-in or story test, while local runs are restricted.
- [ ] 📌 Before changing who reads a stored value, grep every reader. The request's list may be incomplete.
  → **Promote to** one-off (already the habit; this cycle found a fifth reader)
  > **Why**: the case-page count would have kept counting hidden cells.
  > **How to apply**: any change to which stored fields count or show.

---

## Ledger summary (SDD rulings, parked findings, deferred minors)

**Rulings** (each with what it costs if wrong):
- **R1:** the database tests were committed before 050 and run on CI to show red. Cost: one extra CI run.
- **R2:** tasks.md 1.1 maps to Task 4 and 1.2 to Task 2. The editing-copy evidence is the `visibleShaded` unit tests plus the app.mjs wiring, with no `buildEditingCopy` test of its own. Cost: one test, if a reviewer asks for it.
- **R3:** kept `visibleAnswers(2, …)` in `draftFields`. R6 later superseded this for `draftFields`; the other hard-coded 2s stay out of scope. Cost: a one-line follow-up when version 3 lands.
- **R4:** folded Task 4's two minors into Task 5: the parity cases "no answer" and "non-array `hh`", and the wording of 050's header comment. Cost: none.
- **R5:** added the assertions "still stored after Yes" and "`changed == []` on an empty save". Cost: one commit.
- **R6:** took all five final-review minors in one fix wave: the version in `draftFields`, one answers source for the editing copy, frontend.md, the database.md function table, and two small tests. Cost: one extra CI run.
- **R7:** I fixed the stale `draftFields` doc comment myself, since it was comment-only. Cost: none.

**Parked:**
- `docs/developer/frontend.md` has one long line near line 380 (cosmetic).
- The pre-existing database.md function-table drift for `check_payload`, `check_operation_authority` and `vitally_apply_action` (046) was fixed in `fbfbab1`, so it is no longer open.

**Deferred minors** (none blocks):
- Task 1: no test of the `shadedCaseRules` fallback and cap. It was added later in `fbfbab1` (R6).
- Task 2: app.mjs reads `state.savedCase?.intakeVersion` rather than `record.intakeVersion` (cosmetic).
- Task 2: no unit test of the editing-copy wiring in app.mjs. Covered by R2 and the story.
- Task 3: no "Yes still counts" case in the staff-views tests. It was added in `fbfbab1` (R6).
- Task 5 note: once rows are visible again, a payload that omits a visible stored cell drops it. This is by design: the save replaces the visible section, and the editor prefills visible cells, so they are sent again.

**Out of scope, tracked:** issue #202. Cells follow row numbers, not members, so removing one member and adding another puts the old cells next to the new member.
