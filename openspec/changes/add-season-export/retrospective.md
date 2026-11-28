# Retrospective: add-season-export

> Written: 2026-11-27 (after verify passed with warnings)
> Commit range: `7d60112..b38988b`
> Worktree: `.claude/worktrees/add-season-export` (branch `add-season-export`, not yet pushed)

---

## 0. Evidence

- **Commit range:** `7d60112..b38988b` (15 commits). That is 1 planning, 10 implementation and fix, 3 tick, and 1 verify. The archive commit comes next (lifecycle step 8).
- **Diff size:** +2604 / −13 lines across 29 files.
  - Code, migration and tests: +1524 / −13 across 20 files.
  - The rest is the change folder.
- **Tasks done:** 18/18 (`grep -cE '^\s*- \[x\]' tasks.md` gives 18).
- **Active hours:** about 5. Brainstorm and planning took about 1.5 h before `d4fd5de`. Implementation commits span 16:02–19:30, and two full browser runs (27 and 34 min) followed.
- **Subagent dispatches:**
  - 16 dispatches: 6 implementer or fixer, and 10 reviewer or re-reviewer, one of which was the final whole-branch review on Opus.
  - 4 resumes of an existing implementer: Task 1 after the stack reset, the Task 3 and Task 4 fix rounds, and final fix round 2.
- **New external dependencies:** none. The ZIP writer is hand-written (`src/zip.mjs`), and CSV encoding reuses `src/csv.mjs`.
- **Bugs encountered post-merge:** none so far (not merged).
- **OpenSpec validate state at archive:** pass at verify (27/27). The archive itself is pending.
- **Test coverage signal:**
  - `npm test`: 2604 at baseline, 2639 at the end (+35).
  - `test:database`: 1037/1038. The one failure is environmental, see §2.
  - `test:browser`: 100/100 on `738660a`.
  - Change-specific database files: 64/64.

Commit chain, in time order:

```
d4fd5de OpenSpec change add-season-export: planning artifacts (#256)
1f3c980 Season export: a stored ZIP writer with CRC-32 (#256)
5d15874 Season export: the eight CSVs, README and file name (#256)
3088791 Season export: the sensitive-field guard catches snake_case ids (#256)
bc107fc Season export: the export RPC, its record and Last export in the read (#256)
79d8a40 add-season-export: tick tasks 1.1-2.4
5a49eed Season export: the Season export card, dialog and download (#256)
ed47fd2 Season export: controller tests for the export (#256)
4233b65 add-season-export: tick tasks 3.1-3.4
b74fada Season export: browser test of the export and the Last export line (#256)
c9b42c1 add-season-export: tick task 3.5
976a173 Season export: ignore an export answer after sign-out; disable × while exporting (#256)
3633e0d Season export: register the export RPC in the API inventory tests (#256)
738660a Season export: keep an export across a wake refresh (#256)
b38988b add-season-export: verify (PASS WITH WARNINGS)
<archive commit — step 8>
```

---

## 1. Wins

- **The brainstorm's recon found the #161 conflict before any code.** The issue assumed "current season only", but #161 deletes *last* season's data only after an export taken after its last change. The user kept current-only, and the consequence went into design.md as an open question that #161 owns. #161 inherits a stated trade-off instead of a hidden one.
- **Planning self-review caught a spec/design mismatch before apply.** The row counts were promised "per CSV", but the database can't count the browser-derived intake and household files. The fix went into spec and design before `d4fd5de`.
- **Database-independent work went ahead while the stack was blocked (R5).** Tasks 2 and 3 (`1f3c980`, `5d15874`, `3088791`) were implemented and reviewed while Task 1 waited for the user's stack reset. No commit picked up another task's files, because each implementer staged by explicit path.
- **Per-task reviews caught two real defects that the tests passed:**
  - The sensitive-field check couldn't match snake_case ids. `\b` never fires inside `routing_number`, so the spec's own scenario would have passed silently. Fixed in `3088791`.
  - The controller export path had no unit tests. Added in `ed47fd2`.
- **The final whole-branch review (Opus) found a client-data boundary bug.** An export answered after sign-out still downloaded every client's data and left a fake Season settings view. No per-task review could see it: it took the controller, sign-out and dialog together. Fixed in `976a173`.
- **The scoped re-review caught a regression in that fix.** The stale check compared `state.principal` by object identity, and a routine wake refresh replaces that object, so a tab switch would have dropped the export. Fixed in `738660a`.
- **The RPC contract held across tasks.** The final review checked every field name in 062's answer against `src/season-export.mjs` and the controller. Pinning the shape in plan.md's Task 1 Interfaces block worked.
- **The specs needed no code-driven rewrite.** Verify §4 found only two non-blocking notes.

## 2. Misses

- 🟡 **[painful | evidence: Task 1 BLOCKED, ledger]** The shared local test stack was migrated from an older revision of `060_volunteer_check_in.sql` (digest `e3663aeb…`, while main's is `3adbe6db…`). `db:migrate:test` refused with `MIGRATION_CHANGED`, and Task 1 waited on a manual stack reset by the user. Nothing in session start or apply checks the stack before Task 1 is sent.
- 🟡 **[painful | evidence: full `test:database` after Task 5]** The change's own contract tests weren't in the plan:
  - `tests/support/rpc-signatures.mjs` (the public RPC inventory);
  - `tests/database-catalog.mjs` ("exactly forty-six RPCs").

  Six failures surfaced only in the full suite run after all tasks were done, and were fixed in `3633e0d`. A plan that adds an RPC should name these files.
- 🟡 **[painful | evidence: `976a173` re-review]** The first fix for the post-await state bug brought in a worse bug: the object-identity stale check dropped the export on a tab switch. It needed a second, out-of-protocol fix round (R13). The skill allows one fix wave.
- 📌 **[nit | evidence: `.env.test`]** The `.env.test` copied from the main checkout has no `VITALLY_TEST_MAIL_URL`. As a result, `tests/database-accounts-function.mjs` fails on this machine regardless of the change (R12), and the local full database run can't be fully green.
- 📌 **[nit | evidence: plan.md Task 3]** plan.md named household columns `^household1…`, which are PDF field keys, not catalogue questions (R6). The implementer had to work out the real data shape (the `hh` group) from the code.
- 📌 **[nit | evidence: Task 2/4/final subagent notices]** Three subagents kept background processes running after their hand-back. One reply was lost (final fix round 2), and the controller had to read git and the report file directly.

### Ledger summary

These are every ruling, parked finding and deferred minor finding the ledger recorded, before the workspace was deleted.

**Rulings (controller):**

| # | Ruling | Cost if wrong |
|---|---|---|
| R1 | `readZip` lives in `tests/support/read-zip.mjs`, shared by the unit and browser tests | a file move |
| R2/R6 | Household rows come from the catalogue group `hh` (`answers.hh`), and the row count from `householdRows()`; the plan's `household1` keys were PDF field keys | a column rename |
| R3 | `exportSeason` calls the store directly and handles its own errors; `settingsWrite` needs an action id, and the export has none (D2) | some duplicated error handling |
| R4 | Cancel is covered by a browser assertion in Task 5 | about 1 s of test time |
| R5 | Tasks 2–3 ran while the stack was blocked; each implementer staged only its own files | commits in a different order |
| R7 | Follow-up and help-request status and outcome, and status-history Action, are raw codes where no light staff label exists (D5) | a later labelling pass for PCDC readability |
| R8 | A group answer in `intake-answers.csv` is one row, with members joined by "; " | a format change if PCDC wants one row per member |
| R9 | Added the controller tests for `exportSeason`, which the plan didn't list (a gap, not a mandate) | one fix round |
| R10 | Full `test:database` and `test:browser` run once by the controller, not by each implementer | a late fix round if the story breaks |
| R11 | One fix wave for the final review's Important finding and minors, plus the RPC inventory and catalog test failures | one fix wave |
| R12 | The `accounts` Edge Function failure is environmental (no `VITALLY_TEST_MAIL_URL` in the local `.env.test`) and not fixed here; CI's `database` job is the authority | a missed regression, if CI also skips it |
| R13 | The tab-switch regression from the fix wave was fixed in one extra small round instead of being reported unfixed | one round beyond the skill's single fix wave |

**Parked findings (with rulings):**
- If user A signs out and user B signs in and starts an export before A's answer arrives, A's `finally` clears B's `exportBusy`, so one duplicate export request can be sent. The window is narrow, and the worst case is two export records, which is harmless under D2.
- The error path (`FORBIDDEN` or another error) in `exportSeason` doesn't check `stale()`. This is unchanged behaviour: in a signed-out window it only re-reads or notes the failure, so the cost is a stray re-read.

**Deferred minor findings (not fixed; the final review ruled each one need not block merge):**
- **Task 2 (ZIP):**
  - no DOS date clamp after 2107 (`src/zip.mjs:41`);
  - no zip64 or 65535-entry guard comment (`src/zip.mjs:50`);
  - the tests don't pin the DOS date and time fields;
  - `readZip` assumes there is no archive comment;
  - Windows bsdtar shows the CJK entry name as unreadable (Expand-Archive reads it fine; every real entry name is ASCII).
- **Task 3 (CSVs):**
  - `byTime` gives a NaN comparator, and `nyTime` a `RangeError`, on invalid timestamps (the source columns are not null);
  - the `ALLOWED` set in the sensitive-field test is empty and only commented;
  - the household format (", " within a member, "; " between members) isn't documented in the README.
- **Task 1 (RPC):**
  - the `submittedAt` test checks presence, not equality with the first `SUBMIT` time;
  - the case-set test is a subset check, not an exact match;
  - **no test with another workspace**, recommended by the final review as a follow-up backfill (§6);
  - the row-counts test compares the record with the answer, not known values;
  - the CTE `c` uses `select *` internally, which is never projected.
- **Task 4 (page):** `downloadSeasonZip` duplicates the Roster's blob, anchor and revoke code.
- **Task 5 (browser test):**
  - no assertion that the dialog is gone after a successful export (the controller test covers it);
  - the download-counter listener covers the whole test;
  - the Last export time regex is loose (the view unit test pins the exact format);
  - `toastSince` is duplicated, as elsewhere in the file.
- **Final review:** the ZIP's DOS time uses the browser's local clock, while the README and file name use New York time. No action.

**Deferred minor findings fixed in the final fix wave:**
- the × button enabled while busy;
- `settingsWrite` clearing `exportBusy`;
- the `lastExport` read tested only as a site coordinator;
- the comment that lost its `\b`;
- no busy-dialog assertion for Cancel;
- the README saying nothing about internal codes.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| Task order 1→5 | Ran as 2, 3, then 1, 4, 5 | Task 1 was blocked on the shared test stack (R5) |
| Task 2 | `readZip` moved to `tests/support/read-zip.mjs` | Shared with Task 5 (R1) |
| Task 3 | Household columns come from the catalogue group `hh`, not `^household1` keys; some codes are written raw | Plan defect (R6); no light label helper exists (R7) |
| Task 4 | `exportSeason` doesn't use `settingsWrite`; controller tests were added | No action id (R3); review finding (R9) |
| Task 5 | Cancel covered; only the focused browser test run by the implementer | R4, R10 |
| Not in plan | `tests/support/rpc-signatures.mjs` and `tests/database-catalog.mjs` updated for the new RPC (`3633e0d`) | The full database suite showed them (§2) |
| Not in plan | Stale-answer guard, × disabled while busy, `exportBusy` kept across re-renders (`976a173`, `738660a`) | Final whole-branch review and its re-review |
| Not in plan | One README line about internal codes | Final review, Minor 5 |

## 4. Skill / workflow compliance

| Skill                                            | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming                        | ✓ (method in conversation; the skill invoked at propose for `brainstorm.md`) |
| superpowers:writing-plans                        | ✓ |
| superpowers:using-git-worktrees                  | ✓ (found the existing worktree; no new one created) |
| superpowers:subagent-driven-development          | ✓ |
| (transitive) superpowers:test-driven-development | ✓ (RED/GREEN evidence in each implementer report) |
| (transitive) superpowers:requesting-code-review  | ✓ (per-task reviews, the final whole-branch review on Opus, scoped re-reviews) |
| superpowers:finishing-a-development-branch       | pending (lifecycle step 9, after archive) |

### Deliberately Skipped Skills

None skipped. Two deviations inside subagent-driven development are recorded here for the feedback loop:
- **The builder check in brainstorming.**
  - **What was skipped:** the builder-check subagent; the controller read the design as the builder instead.
  - **Why this cycle:** the session's agent policy says not to spawn agents unless asked, and the skill allows a self-read "without a subagent tool".
  - **How to prevent recurrence:** one-off, a schema boundary case. The design had been confirmed point by point over four questions, and the self-read found three small gaps that were settled as the controller's calls.
- **A second final-review fix round (R13).**
  - **What happened:** the skill says one fix wave after the final review and no second. A second, targeted round was run.
  - **Why this cycle:** the re-review of the first wave found a new Important regression in it (`976a173`, the object-identity stale check). Parking it would have shipped a feature that drops the download on a tab switch.
  - **How to prevent recurrence:** a scope-judgment rule. When a fix-wave re-review finds new Important breakage *in the fix itself*, one targeted round on the same fixer, plus a scoped re-review, is allowed. Ledger it as a ruling.

## 5. Surprises

- The local test stack is shared across worktrees, and its migration digests reflect whichever branch migrated it last. A pre-merge revision of `060` from another worktree was enough to block every database task here.
- The household data isn't stored as `household1…4*` keys, as the brainstorm recon assumed from the 050 migration's PDF mapping. It is a catalogue group, `hh`, an array in `answers`. Those keys exist only in the PDF and shaded-field layer.
- `\b` word boundaries don't match inside snake_case identifiers. The first version of the sensitive-field check looked correct and passed against today's catalogue, but couldn't fire on the very id the spec names.
- `controller.getState()` returns a copy, and `state.principal` is rebuilt on every wake refresh. Identity comparisons on state objects are unsafe in this controller, so compare stable ids (`principal.userId`).
- The public RPC count is pinned in two test files (`rpc-signatures.mjs` and `database-catalog.mjs`). Any new RPC breaks them, by design.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **Check the shared test stack's migration digests before sending database tasks.** → **Promote to** project CLAUDE.md (Local test stack)
  > **Why:** in this cycle, Task 1 was blocked when `db:migrate:test` refused with `MIGRATION_CHANGED` (an older `060` from another worktree), and the fix needed a manual stack reset by the user.
  > **How to apply:** at apply start, before the first task that runs `db:migrate:test`, run `npm run db:migrate:test` once (or compare `vitally_private.schema_migrations` with `main`'s files) and report a mismatch to the user before sending.

- [ ] 🟡 **A change that adds or removes a public RPC must update `tests/support/rpc-signatures.mjs` and `tests/database-catalog.mjs`.** → **Promote to** docs/developer guide (or project CLAUDE.md, Database)
  > **Why:** six database failures surfaced only in the full suite after every task was done (`3633e0d`), because the plan didn't name these inventory tests.
  > **How to apply:** in writing-plans, for any migration that creates, drops or changes the signature of a `public.vitally_*` function, add a step to the migration task that updates both inventories and runs `tests/database-actions.mjs` and `tests/database-catalog.mjs`.

- [ ] 🟡 **In this controller, guard post-await state by comparing stable ids, never object identity.** → **Promote to** memory (type: feedback)
  > **Why:** the first stale-answer guard compared `state.principal` by identity. A wake refresh rebuilds it for the same user, so the guard dropped the export on a tab switch (`976a173`, fixed in `738660a`).
  > **How to apply:** whenever controller code checks after an `await` whether "the world changed", compare `state.session` and `state.principal?.userId`, and only close a dialog when `state.dialog` is still the one this action opened.

- [ ] 📌 **When a fix-wave re-review finds new Important breakage in the fix itself, allow one targeted round.** → **Promote to** schema (superpowers-bridge apply guidance) or a skill feedback note
  > **Why:** R13. Following "no second fix wave" literally would have shipped a regression introduced by the fix.
  > **How to apply:** after the final fix wave's re-review, if a finding is in the fix diff and Important, send one targeted round to the same fixer plus a scoped re-review, and ledger it as a ruling.

- [ ] 📌 **Backfill a cross-workspace test for `vitally_export_season`.** → **One-off** (a follow-up direct PR: test backfill)
  > **Why:** the final review checked every subquery's `v_workspace` scope by hand. A regression there would leak another workspace's clients, and no test pins it.
  > **How to apply:** add a sub-test to `tests/database-season-export.mjs` that puts a numbered case and a no-case help request in `f.foreignWorkspaceId` and asserts neither appears.

- [ ] 📌 **This machine's `.env.test` lacks `VITALLY_TEST_MAIL_URL`.** → **One-off** (local setup)
  > **Why:** `tests/database-accounts-function.mjs` fails before any database call (R12), so the local full database run can never be fully green.
  > **How to apply:** regenerate `.env.test` with `tools/admin/write-test-env.mjs` in the main checkout. Not part of this change.
