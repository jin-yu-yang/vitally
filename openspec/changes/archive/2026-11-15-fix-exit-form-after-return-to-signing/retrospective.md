# Retrospective: fix-exit-form-after-return-to-signing

> Written: 2026-11-15 (after verify passed with warnings)
> Commit range: `6add349..c8aa36b`, plus the verify, retrospective and archive commits that follow
> Worktree: D:/dev/vitally-173

---

## 0. Evidence

- **Commit range:** `6add349..c8aa36b` (7 commits before verify and archive).
- **Diff size:** +1027 / −23 lines across 17 files. Most of it is planning artifacts and tests; the product
  code is `src/exit-form-source.mjs` (new), `src/staff-views.mjs` and `src/app.mjs`.
- **Tasks done:** 17 of 17.
- **Active hours:** about 3, from the investigation to green CI.
- **Subagent dispatches:** 11:
  - 3 implementers;
  - 3 task reviewers;
  - 1 fix round, resuming the Task 3 implementer;
  - 1 re-review;
  - 1 final reviewer (Opus);
  - 1 final fix wave;
  - 1 re-review of that wave.
- **New external dependencies:** none.
- **Bugs encountered post-merge:** none yet (not merged).
- **OpenSpec validate state at archive:** pass (16 of 16 before archive).
- **Test coverage signal:** unit tests went from 1712 to 1716 on this machine, with 1 known Windows-only
  failure that predates this change. CI run [43686417511](https://github.com/jin-yu-yang/vitally/actions/runs/43686417511)
  passed every job on the first try.

Commit chain:

```
141ae8a OpenSpec change fix-exit-form-after-return-to-signing: planning artifacts (#173)
4a47986 Exit Form source: after Return to signing, only settled methods (#173)
6fb4426 Exit Form: panel, button and PDF follow the latest approval, no fallback (#173)
da38e34 Docs: the Exit Form after Return to signing (#173)
c4f7e82 Docs: Exit Form note is shown beside the button, not on the PDF; decidedAt rule (#173)
ce54afc tasks.md: tick tasks 1-4 of fix-exit-form-after-return-to-signing (#173)
c8aa36b Exit Form: guard that the PDF uses the source; follow-ups wording (#173)
(verify + retrospective, archive)
```

---

## 1. Wins

- **Reading the migrations corrected the bug report before any code was written.** The brief assumed a second
  approval that might lack a questionnaire. `act_return_to_signing` (035 §8b) and the approval stage rules showed
  that a case has one approval, and that Return to signing writes no review. Fixing the imagined fallback alone
  would have left the bug in place. The real cause is in brainstorm.md.
- **The user's check sharpened the rule.** They asked whether an empty result could mean "not filed yet". The
  answer, from 035's refusal and 037's refile, made the ticking rule provably tick only filed returns (design D3).
- **One pure rule for every path** (`src/exit-form-source.mjs`). The final reviewer confirmed that the button,
  the panel and the PDF can't drift apart. `tests/shell.test.mjs` now guards that `exitFormMarks` receives
  `source.questionnaire` (`c8aa36b`).
- **The fail-safes are pinned on purpose.** The user asked for both of them to be tested. They are named
  "fail-safe … keep" in `tests/exit-form-source.test.mjs` and `tests/staff-views.test.mjs`, so nobody removes
  them as unreachable.
- **CI passed first time** on every job, including both story legs, with no reruns.

## 2. Misses

- 🟡 [painful | evidence: `c4f7e82`] The first docs pass said "the panel and the download carry" the note, but
  the PDF never carries it. The task review caught it. The docs implementer had not opened `viewExitForm`.
- 🟡 [painful | evidence: `ce54afc`] tasks.md check-offs sat uncommitted until the final reviewer flagged them.
  The controller ticked boxes in the working tree but committed only at the end.
- 📌 [nit | evidence: Task 1 commit before amend] The first implementer wrote a "Claude Sonnet 5.5" trailer.
  The controller amended it to the session's attribution before the review.
- 📌 [nit | evidence: verify §4] The missing-`decidedAt` fail-safe is in the design, the code, a test and the
  docs, but in no spec scenario.

**Deferred minor findings from the ledger (not fixed; none judged necessary before merge by the final review):**
- **Task 1:**
  - an unparsable non-null `decidedAt` and a missing `createdAt` are untested;
  - there is no case where only the state return is rejected, with its note text checked;
  - nothing checks that `exitFormNote(null) === ""`.
- **Task 2:**
  - no test pins the kept "filled from the reviewer's answers for version N" sentence on the uncorrected panel
    path, though the existing panel test renders that path;
  - `viewExitForm` checks `!record` after calling `exitFormSource`, which is harmless.
- **Task 3:** long unwrapped lines in the new `frontend.md` text, and the panel-intro change after a correction
  is not described. The "#173 as a follow-up" wording was fixed in `c8aa36b`.
- **Final review:** the volunteer's "Reviewer's answers" block still shows the amounts from before the
  correction, just above the fill-by-hand note. This was accepted under D7 (it's a record, not the hand-out).
  A possible follow-up is to label it "as recorded at approval" after a Return to signing.

**Rulings made during apply:**
- **R1:** follow the plan's order (the module first, then the views) rather than tasks.md's. Cost if wrong:
  ordering only.
- **R2:** the no-history view test also asserts the review panel rendered, so it fails before the change. It
  did. Cost if wrong: one weak test.
- **R3:** the controller ran the sync, push and CI, not an implementer, because a push is a side effect outside
  the worktree.
- **Controller fix:** `tasks.md` was committed by the controller after the final review.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| tasks.md 1.1 | Done in Task 2, not first | R1: the plan built the module first, and both orders reach the same failing tests |
| Task 3 | One fix round | The review found the "download carries the note" error and the missing `decidedAt` rule |
| Task 4 | Run by the controller | R3; `main` had not moved, so there was nothing to merge |
| (final) | One extra fix wave | The final review: a shell assertion and the follow-ups wording |

## 4. Skill / workflow compliance

| Skill                                            | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming                        | ✓ (method in the conversation; the skill recorded brainstorm.md) |
| superpowers:writing-plans                        | ✓ |
| superpowers:using-git-worktrees                  | ✓ (existing worktree D:/dev/vitally-173 detected) |
| superpowers:subagent-driven-development          | ✓ |
| (transitive) superpowers:test-driven-development | ✓ (RED/GREEN evidence in each task report) |
| (transitive) superpowers:requesting-code-review  | ✓ (task reviews and a final Opus review) |
| superpowers:finishing-a-development-branch       | ✓ (step 9, after archive) |

### Deliberately Skipped Skills

None. `openspec-verify-change` is not installed; its checks were run directly, as CLAUDE.md says.

## 5. Surprises

- **There was no second approval.** The brief and the issue title implied "approved again". The data model
  allows one approval per case.
- **The panel's fallback was unreachable but asserted.** An existing unit test asserted the fallback as
  intended behaviour, and real data can never reach it.
- **The CI watcher was stopped for low memory.** The background `gh run watch` was stopped while the session was
  idle. The run was unaffected, and it was checked again once the user asked.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **Check a bug report's mechanism against the migrations before planning the fix.** →
  **Promote to memory** (type: feedback)
  > **Why**: #173's brief described a second approval that the database can't produce. Fixing the named
  > fallback alone would have shipped no fix.
  > **How to apply**: at the start of a bug fix whose report names a flow (approve again, refile, reopen), trace
  > the flow's RPCs in the newest migration that defines them before accepting the report's model.

- [ ] 📌 **The controller commits tasks.md ticks with each task's completion.** → **One-off** (CLAUDE.md
  already says apply checks off tasks.md)
  > **Why**: the ticks sat uncommitted until the final review.
  > **How to apply**: when appending "Task N: complete" to the ledger, commit the tasks.md tick in the same
  > step.

- [ ] 📌 **Docs implementers read every function they describe.** → **One-off**
  > **Why**: the first docs pass described the PDF from the views alone.
  > **How to apply**: docs task briefs name each function the doc describes, as files to read.
