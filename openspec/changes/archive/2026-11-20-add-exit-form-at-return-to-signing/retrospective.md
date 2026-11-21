# Retrospective: add-exit-form-at-return-to-signing

> Written: 2026-11-20 (after verify passed with warnings)
> Commit range: `964d02b..` the verify commit (the archive commit follows)
> Worktree: `.claude/worktrees/add-exit-form-at-return-to-signing`

---

## 0. Evidence

- **Commit range**: `fdd64a2..` (main), then the plan commit `964d02b`, then 15 commits to verify.
- **Diff size**:
  - whole change: +1453 / -88 lines across 34 files, including the planning artifacts;
  - code, tests, migration and docs only: +1239 / -37 across 28 files.
- **Tasks done**: 22/22 in `tasks.md`.
- **Active hours**: about 5 hours, from apply start (about 16:45) to verify (21:45 New York). About 45 minutes of that were lost to one stalled agent and one session restart (§2).
- **Subagent dispatches**: 19, plus 2 resumes.
  - 9 implementers: Tasks 1–7, one Task 7 re-dispatch, and the final fix wave.
  - 10 reviewers: 7 task reviews, the Task 5 re-review, the final whole-branch review, and the fix-wave re-review.
- **New external dependencies**: none.
- **Bugs encountered post-merge**: none yet (not merged).
- **OpenSpec validate state at archive**: pass (21 items). One length warning on the case-lifecycle ADDED requirement.
- **Test coverage signal**:
  - unit `npm test`: 2156 tests, up from 2132 at the worktree baseline;
  - database: 782 of 783, with one known environment gap (`accounts Edge Function`, needs `VITALLY_TEST_MAIL_URL`);
  - story: both browser orders pass at `bb4b7da` (see `verify.md`).

Commit chain (in time order):

```
964d02b Plan OpenSpec change add-exit-form-at-return-to-signing (#203)
6c10412 Migration 054: return_to_signing_exit_forms table, staff-only access, realtime
b568067 Migration 054: RETURN_TO_SIGNING carries and stores corrected Exit Form values
7a8882a Tasks: migration 054 done
cf35c74 Staff record loads the corrected Exit Form values
e41cb0a Exit Form prints the corrected values stored at Return to signing
d035616 Return to signing dialog collects the corrected Exit Form values
6d805d0 Return to signing dialog: keep a chosen method, keep the fixed method on Clear
9e0a74c Tasks: record loader, Exit Form rule and dialog done
05b6a1a Mark e-filed preselects the method planned at Return to signing
9c03570 Story and docs: corrected Exit Form values at Return to signing
d082345 Tasks: Mark e-filed, story and docs done
f005f1d Update change artifacts to what was built (opsx:update)
9b8ed6b Final review fixes: per-return preselection, trimmed remarks, dateless note
bb4b7da Change artifacts: per-return preselection in plan Task 6, fromStored in design D5
(verify) Verify add-exit-form-at-return-to-signing: pass with warnings
```

---

## 1. Wins

- **Reusing the reviewer questionnaire's pieces made the risky parts easy.** `exitGroup`, `exitFormFrom` and `check_exit_form` were all reused (`d035616`, `b568067`). The "no banking detail" rule needed no new code. The Task 2 reviewer diffed the copied `check_payload` against 046 and found only the planned change.
- **Per-task reviews caught two real defects before the final review.** Task 5's review found that a chosen method alone was silently dropped, and that Clear erased the hidden fixed method. Both were fixed in one round (`6d805d0`).
- **The final whole-branch review caught a deviation from the spec that every task review missed.** Mark e-filed preselected only when every rejected return had a plan, against the spec's per-return "SHALL". It was fixed in `9b8ed6b`.
- **The seed-step failure was investigated before being labelled environmental.** I checked the database size, stray browsers, the realtime logs, the order run alone, and the timing trend (`verify.md` §5). The order run alone passed 50/50 at `bb4b7da`.
- **One `/opsx:update` pass reconciled the change's planning files with what was built before verify** (`f005f1d`, `bb4b7da`). `verify.md` §4 records no drift.

## 2. Misses

- 🟡 [painful | evidence: ledger "Task 1 … DONE_WITH_CONCERNS"; design D7 before `f005f1d`] **The plan named a database function that migration 040 had already dropped** (`apply_fixture_scenario`, dropped at 040:230). During planning I grepped for its latest definition but not for a `drop function`. Task 1 had to rule on it, and three planning files needed reconciling later.
- 🟡 [painful | evidence: ledger "Task 4: first run stalled"; "Task 7: first agent lost"] **Two implementer runs were lost:**
  - Task 4 stalled on the 600-second watchdog and had to be resumed.
  - Task 7's agent was lost in a session restart while the browser story ran in the background. Its work was left uncommitted, and about 45 minutes went before a fresh agent finished it.
  - Later dispatches added "run in the foreground, or log to a file and check it" and "leave no background processes".
- 🟡 [painful | evidence: ledger "keeps re-sending"] **Implementers that ended with background work still running re-sent the same report up to five times** (Tasks 1 and 2). They had to be stopped by hand.
- 🟡 [painful | evidence: `verify.md` §5] **The full local story failed the seed step twice in the Chrome client / Firefox staff order.** The cause was the story's 20-second "page holds still" wait on a machine that had slowed through the evening. That wait predates this change. The order passes when run alone, and CI on the PR is the confirming run.
- 📌 [nit | evidence: Task 5 report] **TDD order slip in Task 5.** The tests were written after the code, then shown to fail by reverting `src/`.
- 📌 [nit | evidence: story-verify.log] **The story takes no screenshot of the Return to signing dialog.** The dialog's behaviour is asserted, but nothing can be checked visually.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| 1 (tasks 1.6) | No `apply_fixture_scenario` copy and no reset test. An extra `workspace_id` foreign key with cascade. | Migration 040 dropped the function. Fixture cleanup needed the cascade. |
| 1 / 3 | `STAFF_TABLES` was added in Task 1, not Task 3. | `tests/database-store.mjs` asserts that the published tables equal the subscribed set. |
| 2 | `confirmed` is checked with `is distinct from 'true'`. Remarks are stored with `btrim` (final review). | A missing key must refuse rather than evaluate to null. Trimmed remarks match `act_approve_review`. |
| 4 | `recordedAt` is left off the uncorrected source. `fromStored` was added later (final review). | It keeps #173's pinned `deepEqual`. The note's branch must not depend on a date. |
| 5 | The hidden input became `<prefix>.fixedMethod`. Clear skips hidden inputs. A chosen method alone is refused. | Task 5 review findings. The spec says "same rules as the reviewer questionnaire". |
| 6 | Per-return radios, not combination radios. Each rejected return is preselected on its own (final review). | The dialog after a rejection was already per-return. The spec says per return. |
| 7 | The preselection is asserted on the main-story case, not the rejected sample. | Only the main-story case goes on to Mark e-filed. |

## 4. Skill / workflow compliance

| Skill                                            | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming                        | ✓ (decisions in conversation, captured in `brainstorm.md`) |
| superpowers:writing-plans                        | ✓ (`plan.md`) |
| superpowers:using-git-worktrees                  | ✓ (`git worktree add` on the existing branch, then EnterWorktree by path) |
| superpowers:subagent-driven-development          | ✓ (ledger, pre-flight scan, a review per task, final review, one fix wave) |
| (transitive) superpowers:test-driven-development | ✓ (red/green evidence in each report; Task 5 order slip noted in §2) |
| (transitive) superpowers:requesting-code-review  | ✓ (code-reviewer template for the final review) |
| superpowers:finishing-a-development-branch       | ✓ (lifecycle step 9, after archive) |

Also used: superpowers:systematic-debugging, for the story's seed-step failure during verify.

### Deliberately Skipped Skills

(None skipped.)

## 5. Surprises

- **Migration 040 had already dropped the demo reset function the plan expected to extend** (see §2).
- **A rejected case always has both filing methods**, because the filing constraint pairs them. So "a federal-only case" (Review Focus 5) and "a group for a return with no method" can't happen through actions. They're tested at the unit level or by direct SQL only.
- **After a rejection, Mark e-filed already used one choice per return.** The plan's "combination" assumption, and the all-or-nothing preselection that came from it, were wrong.
- **The story's seed-step timing depends heavily on the machine's state.** The same commit took 8 to 35 seconds across runs on one evening.
- **The Task 5 reviewer found that `app.mjs` needed no wiring:** draft reopening and Clear were already generic. That held only after `clearableFields` was added for hidden inputs.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **When a plan extends a database function, grep for `drop function <name>` as well as its latest `create or replace`** → **Promote to memory** (type: feedback)
  > **Why**: this change's plan copied `apply_fixture_scenario` from 039, but migration 040 had dropped it, so three artifacts had to be reconciled during apply.
  > **How to apply**: while writing the plan for any change that redefines or extends an SQL function in `supabase/migrations/`.

- [ ] 🟡 **Subagents must not leave the browser story running in the background when their turn ends** → **Promote to memory** (type: feedback)
  > **Why**: Task 7's first agent was lost in a session restart while its story ran in the background. Tasks 1 and 2 ended with background work and re-sent their reports repeatedly.
  > **How to apply**: in every implementer dispatch that runs `npm run test:browser` or `npm run test:database`: run in the foreground, or log to a file and keep checking it within the turn.

- [ ] 📌 **The story's 20-second "page holds still" wait at the seed step is timing-sensitive on a slow machine (Firefox staff order)** → **One-off** (record; consider an issue)
  > **Why**: it failed twice in full local runs at `bb4b7da` and passed alone. It is outside this change.
  > **How to apply**: if CI's `story` job hits the same timeout, open an issue for the seed step's wait.

### Ledger summary: rulings, parked findings and deferred minors

**Rulings:**
1. Task 4's `historySentence` guard test passes before the change. Kept as a regression pin (Review Focus 3).
2. No `apply_fixture_scenario` copy, because migration 040 dropped it. Rows go with their case through the cascade.
3. The extra `workspace_id` foreign key with cascade is accepted, because fixture cleanup needs it.
4. The `STAFF_TABLES` change landed in Task 1, because the database store test requires it.
5. The defensive "no group for a missing return" database guard is kept. It's unreachable through actions, but the spec requires it.
6. `recordedAt` is left off the uncorrected Exit Form source, to keep #173's pinned shape.
7. A stored group for a return with no case method is unreachable, because Task 2's act refuses it.
8. Task 5: the lone-method drop applies only to the fixed method. A chosen method alone is refused. This overrides the brief, because the spec governs.
9. Task 6: "matching combination" maps to the per-return radios.
10. Task 7: the preselection is asserted on the main-story case.
11. Final review #1: per-return preselection.
12. Final review #3: `btrim` remarks in 054 (not on any shared database).
13. Final review #4: the note branches on `fromStored`, with no date when unknown.
14. Final review #2: the planning artifacts were reconciled by `/opsx:update` at the user's request.

**Parked findings**, none load-bearing:
- the federal half of the missing-return guard is untested;
- the `nullif` on remarks was dead code (fixed by #12);
- a remarks-only row stores the empty form, which is handled;
- the note was keyed on `recordedAt` (fixed by #13);
- an unparsable date gave "recorded on ." (fixed by #13);
- `plannedMethod` ignores the review (correct: no approval can follow a Return to signing);
- `accounts Edge Function` environment gap.

**Deferred minors**, cosmetic or coverage-breadth:
- **Task 1 tests:** an applicant read with no positive control; the direct-insert error code is not asserted; no private-draft read case.
- **Task 5:**
  - three builder tests bundled into one;
  - the demo fill fills a closed group;
  - `returnToSigningDemoValues` is exported only for its test;
  - trailing blank lines in test files.
- **Task 6:** an extra blank line; no test of a single-return e-file plan.
- **Task 7:**
  - no screenshot of the dialog;
  - a long line in `frontend.md`;
  - only the paper preselection is asserted in the story;
  - the note assertion doesn't check that "Fill in by hand" is absent.
- **Final review #5:** demo-fill export and closed group.
