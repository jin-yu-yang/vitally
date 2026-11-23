# Retrospective: add-remove-from-roster

> Written: 2026-11-23 (after verify passed)
> Commit range: `93ea623..bfc91a4` (main merged in at `3baf47d`; the archive commit follows)
> Worktree: `D:/dev/vitally-remove-from-roster`

---

## 0. Evidence

- **Commit range**: `93ea623..bfc91a4`, 18 commits of this change plus the merge of main (the two docs commits from main and `612d62c` came in through it).
- **Diff size**: +2896 / −24 lines across 31 files against main (`git diff --shortstat 612d62c...bfc91a4`).
- **Tasks done**: 20/20 (groups 1–6 by subagent-driven apply, group 7 after main merged the Schedule).
- **Active hours**: not measured; spread over Nov 22–23. Much of it was CI wall-clock: story legs run about 15 minutes each, and four full runs (45083491322, 45085652892, 45088122274, 45110230200) came before the final 45111772982.
- **Subagent dispatches**: 17 (6 implementers, 6 task reviewers, 2 fix-round re-reviews, 1 final whole-branch review, 1 final fix wave, 1 scoped re-review). Group 7 had none; it was done in the controller session.
- **New external dependencies**: none.
- **Bugs encountered post-merge**: none yet (not merged).
- **OpenSpec validate state at archive**: pass (`validate --all`, 25 items). `--strict` gives only the seven "very long requirement" warnings.
- **Test coverage signal**: unit 2352 at the start, 2374 at `7816d0c`, 2482 at `361a501` after main's Schedule came in. The database suite is 961 tests in CI, with `tests/database-remove-from-roster.mjs` new. The browser test is a new block of about 13–18 s outside the story.

Commit chain (in order):

```
93ea623 OpenSpec change add-remove-from-roster: planning artifacts (#232, #269)
eb8c223 add-remove-from-roster: Accepted cases are open work; browser test sign-in
82c9c86 Roster: database tests for removing a volunteer from the roster (058, RED)
89ae249 Roster: remove a volunteer from this season's roster (058)
378d230 Roster: refuse SELF before ADMIN_ROLE in remove from roster (058)
08e27fb Roster: store call for removal
0eab010 Roster: remove button, confirmation and Reactivate note
c09e513 Roster: remove action and Reactivate notice after a re-add
537f5af add-remove-from-roster: tick tasks 1-4
26a65a4 Roster: browser test for removal
369c979 Roster: list vitally_remove_from_roster in the RPC inventory (058)
bbc79e8 add-remove-from-roster: tick task 5
14c97c1 Docs: removing a volunteer from the roster (058)
074ce02 add-remove-from-roster: tick task 6
7816d0c Roster: no Remove on your own row; review fixes
3baf47d Merge main (Schedule, 058) and renumber ours to 059_remove_from_roster
b93e7d5 059: Remove from roster also removes the person's shifts from today on
361a501 Remove from roster: D12 for the Schedule, spec requirement, docs
bfc91a4 Test inventory: the remove-from-roster receipt carries shiftsRemoved
<archive commit>
```

---

## 1. Wins

- [evidence: `82c9c86` RED run 45079545684, `89ae249` GREEN run 45079728978] The database tests were written and seen failing in CI before the migration existed, with no local Docker. `database-quick.yml` made test-first database work possible on a machine with about 1 GB free.
- [evidence: ruling R5, `378d230`] The task review caught that D4's order would give a non-site-coordinator admin `ADMIN_ROLE` for their own row, where the spec says `VALIDATION`. It was fixed in an unapplied migration, so it cost one commit.
- [evidence: ruling R7, `7816d0c`] The final whole-branch review found the only user-facing dead end (Remove on your own drawer, ending in a generic banner), which no task review could see because it crossed Tasks 3, 4 and 6.
- [evidence: cloud review fixed in `eb8c223`] The review of the planning artifacts before apply caught that Accepted cases are open work, so the "Case history is kept" scenario would have been unreachable as written.
- [evidence: `b93e7d5`, quick run 45109798348] The Schedule follow-up went from request to green database tests in one pass. The refusal helper's `stateOf` now also checks that shifts don't change, so every refusal test covers that.

## 2. Misses

- 🟡 [painful | evidence: CI 45083491322, CI 45110230200] The `tests/support/rpc-signatures.mjs` inventory failed the full `database` job twice: once when the RPC was added (R6, fixed in `369c979`) and again when the receipt gained `shiftsRemoved` (fixed in `bfc91a4`). Neither the quick runs nor the plan named `tests/database-actions.mjs`, which reads that inventory, so each miss cost a full CI cycle of about 20 minutes.
- 🟡 [painful | evidence: `3baf47d`; reverted before `b93e7d5`] Renaming 058 to 059 with a blanket `sed` also changed two of main's Schedule comments in `src/supabase-store.mjs` that said "migration 058". They were caught by diffing against main before commit, but only because I looked.
- 📌 [nit | evidence: `tests/database-catalog.mjs`] Main's catalog comment and test name said "thirty-four" for a 39-entry list, so the merge had a wrong count on both sides. It now reads "forty".
- 📌 [nit | evidence: ledger] Deferred minors left open (carry to follow-ups if anyone wants them):
  - "Already removed" isn't tested as a double removal (new revision → `NOT_FOUND`, old → `CONFLICT`).
  - The re-add test asserts the roles it sent itself instead of empty certificates and capabilities.
  - The reviewer, follow-up and help-request `OPEN_WORK` categories aren't tested here (they share `open_work`).
  - The Accepted subtest leaves its case on the shared preparer, and the uploads-count test depends on subtest order.
  - No test of the store's action-id fallback (Deactivate has none either).
  - One loose escaping assertion (`volunteer-views.test.mjs`), a few loosely worded assertion messages in `browser.mjs`, and an unneeded regex-escape helper there.
  - The R2 Cancel test cancels after an `OPEN_WORK` press; there's no plain open → Cancel test. `shell.test.mjs` doesn't pin `closeDialog`'s order after its guard.
  - The `rpc-signatures.mjs` entry omits `cleared: false`, which the Deactivate entry sets (harmless).
  - `database.md`'s picker sentence could point to `returningCandidates`.

- 🔴 [blocking | evidence: PR #273 review, RED 45119153370, fix `df8275e`] 059's lock order covered admins' writes, which all take the workspace lock first, but not the person's own writes, which start from their membership and take no workspace lock. Remove could deadlock (40P01) with the volunteer saving My profile or marking a document sent. Neither the plan, the task reviews nor the final review checked lock order against the target's own calls; Zeye found it on a scratch database before deploy. Fixed as 055 did, with tests for both timings.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| 1 (migration) | SELF moved before the lock, `ADMIN_ROLE` and the receipt; D4 rewritten to match | Ruling R5: the spec is binding |
| 1 (inventory) | `rpc-signatures.mjs` entry added after Task 5's CI | Ruling R6: the plan's "any RPC list" missed that file |
| 4 | Cancel returns to the drawer, with a test | Ruling R2: the spec's Cancel scenario had no test |
| 3, 4, 6 | Own drawer shows "You can't remove yourself from the roster." instead of Remove; a new spec scenario and D8 line | Ruling R7, from the final review |
| (new) 7.1 | The migration renamed to 059 | Main merged the Schedule as 058 (#271) first |
| (new) 7.2–7.4 | 059 marks the person's shifts from today on removed; the Roster read flags `hasShiftsFromToday` for a new dialog line; D12 replaces the Schedule forward note; a new requirement with five scenarios | Hailey's request once shifts existed: removal would otherwise leave them on the Schedule, tagged Not cleared and Role removed, under the person's name |

## 4. Skill / workflow compliance

| Skill                                            | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming                        | ✓ (conversation, then `brainstorm.md` at propose) |
| superpowers:writing-plans                        | ✓ (`plan.md`) |
| superpowers:using-git-worktrees                  | ✓ (`D:/dev/vitally-remove-from-roster`) |
| superpowers:subagent-driven-development          | ✓ for tasks 1–6; group 7 inline, see below |
| (transitive) superpowers:test-driven-development | ✓ for Task 1 (RED run before GREEN); partial for group 7 |
| (transitive) superpowers:requesting-code-review  | ✓ per task and whole-branch; not for group 7 |
| superpowers:finishing-a-development-branch       | ✓ (step 9, push and PR) |

### Deliberately Skipped Skills

- **`superpowers:subagent-driven-development` and its task review, for group 7**
  - **What was skipped**: the Schedule follow-up (rename, the shifts step in 059, the Roster flag and dialog line, D12) was implemented in the controller session with no implementer subagent and no task reviewer. Its tests were written alongside the code rather than seen failing first.
  - **Why this cycle**: it arrived after SDD had finished at `7816d0c`, as a direct user request with exact behaviour and tests spelled out, and the machine was short of memory (the local CI watcher was killed for low memory during it). The full CI and the user's own review stood in for the reviewer, and Zeye reviews 059 before deploy.
  - **How to prevent recurrence**: `scope-judgment rule`: a post-apply request that changes a migration is new implementation work, so run it as an SDD round (one implementer, one task reviewer) even when the request is exact. The `rpc-signatures.mjs` miss in `361a501` is what a reviewer would likely have caught.

## 5. Surprises

- The Schedule (#140), planned as a forward note "not built", merged first and took 058, which made the rename and D12 part of this change.
- `shifts` refers to `people`, not to `roster_entries`, so deleting the entry would have left the shifts visible to every volunteer, under the removed person's name.
- Admins can already read `shifts` directly (058's `viewer_shifts`, used by Workload), so the dialog's shifts line cost one filtered read in the existing Roster load rather than a new RPC.

## 6. Promote candidates → long-term learning

- [ ] 🔴 **An RPC that changes another person's membership or account must check lock order against that person's own calls, not only admins'** → **Promote to memory** (type: feedback)
  > **Why**: 055 (Start next season) and 059 (Remove) both shipped a deadlock with calls that start from `require_membership`'s `FOR SHARE` and take no workspace lock; both were found in review.
  > **How to apply**: when a migration deactivates or edits someone's membership, list the target's own RPCs that write the same rows, lock the membership right after the workspace lock, and add a two-timing race test.

- [ ] 🟡 **When an RPC or its receipt changes, update `tests/support/rpc-signatures.mjs` and quick-run `tests/database-actions.mjs`** → **Promote to memory** (type: feedback)
  > **Why**: the inventory failed the full `database` job twice in this change (R6 and `bfc91a4`), each costing a full CI cycle.
  > **How to apply**: whenever a migration adds an RPC or changes what one returns, include `tests/database-actions.mjs` in the `database-quick.yml` files list.

- [ ] 🟡 **Renumber a migration with targeted edits, never a blanket replace of the number** → **Promote to memory** (type: feedback)
  > **Why**: after main takes the same number, the old number now names main's migration too, and a blanket `sed` changed two of main's comments.
  > **How to apply**: on a renumber, replace only the file name and lines that name this change, then diff against main for any other change to that number.

- [ ] 📌 **Post-apply requests that change a migration get an SDD round** → **One-off** for now; promote if it happens again
  > **Why**: group 7 skipped the task reviewer (§4).
  > **How to apply**: carry forward and re-check at the next change that has post-apply database work.
