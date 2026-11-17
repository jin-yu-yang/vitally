# Retrospective: hide-signing-row-during-go-over

> Written: 2026-11-16 (after verify passed with warnings)
> Commit range: `6add349..b969527` (plus verify/retro/archive commits)
> Worktree: `.claude/worktrees/hide-signing-row-during-go-over`

---

## 0. Evidence

- **Commit range**: `6add349..b969527`, 5 commits before verify:
  - 1 planning commit
  - 2 implementation commits
  - 2 commits ticking tasks
- **Diff size**:
  - whole branch: +581 / −26 lines across 12 files;
  - code, tests and docs only: +38 / −26 across 4 files (`src/office-views.mjs`, `tests/office-views.test.mjs`, `tests/browser.mjs`, `docs/developer/frontend.md`).
- **Tasks done**: 7/8 at verify. Task 3.4 (merge `main` and re-copy the requirement if needed) is the archive step itself.
- **Active hours**: about 2 h of session time from propose to verify. Most of the wall-clock went into two subagent stalls (about 10 min each before the watchdog) and Task 2's resumed `npm test` (about 45 min, background).
- **Subagent dispatches**: 5 initial dispatches plus 2 resumes:
  - 2 implementers (sonnet), each stalled once and resumed;
  - 2 task reviewers (sonnet);
  - 1 final whole-branch reviewer (opus).
- **New external dependencies**: none.
- **Bugs encountered post-merge**: none yet (not merged).
- **OpenSpec validate state at archive**: pass (16/16) at verify. To be re-run at archive.
- **Test coverage signal**:
  - unit: 1701 tests, 1700 pass, plus the pre-existing Windows-only `write-test-env` failure. One new unit test and a rewritten D13 block.
  - CI run 43898451416 green on b969527: `checks`, `database`, `sign-in`, and the story in both browser orders.

Commit chain:

```
6add349 (main) Volunteer workload and reassignment …
fc7279e hide-signing-row-during-go-over: planning artifacts (#177)
128e1b6 Follow-ups: no Signing row while the go-over is open (#177)
744c109 hide-signing-row-during-go-over: tick Task 1
c12e936 Browser story: no Signing row while the go-over is open (#177)
b969527 hide-signing-row-during-go-over: tick Task 2
```

---

## 1. Wins

- **Filtering at the single producer kept rows and counts consistent with a 5-line code change.** The filter sits in `followupQueue`, which both the rows and the counts read from. Evidence: 128e1b6; D2; the final review confirmed `renderFollowups` is the only consumer.
- **The case can't drop out of Follow-ups by accident.** `goOverOpen` and `openFollowups` come from the same `open` array, so an open go-over always gives the case a Call row. Evidence: `src/supabase-store.mjs:535-541`, cited by the final review.
- **Generating the MODIFIED delta specs by script kept the untouched requirement text byte-identical.** The script copied each canonical block, then applied exact-match substitutions that fail loudly. A `diff` against canonical showed only the intended lines, and the final review confirmed it.
- **Choosing the change on two grounds left one issue that could start now.** The other three issues each needed a migration, or touched lines an open PR rewrites, so the user's request ("don't affect anybody's work") narrowed cleanly to #177:
  - #202 and #203 need migrations;
  - #204 sits right next to PR #205's hunk in `staff-views.mjs`.
- **Running the story in CI instead of locally** (Docker was down) gave both browser orders, plus the database and sign-in jobs, on the exact head commit in about 25 min. The run is linked in `verify.md`.

## 2. Misses

- 🟡 **Both implementer subagents stalled** ("no progress for 600s", stream watchdog) with their edits complete but not committed. Each needed a manual inspection of the worktree and a SendMessage resume.
  - Evidence: the Task 1 and Task 2 notifications; the ledger lines "stalled once (watchdog), resumed".
  - Cost: about 20 min.
- 🟡 **The local unit baseline is not green on Windows.** `tests/write-test-env.test.mjs` refuses the backslashes in Windows temp paths, so every run here needs a "known failure" caveat. Evidence: the baseline in the ledger, and `verify.md` §5.
- 📌 **No story screenshot captures Follow-ups during a go-over.** The row behaviour rests on the story's assertion alone. Evidence: 51 screenshots per leg reviewed; none shows the Follow-ups queue.
- 📌 **Cosmetic:** the rewritten story section heading lost its trailing `-----` rule (`tests/browser.mjs:3480`). The final review deferred it as Minor.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| Task 2, Step 4 (`npm run test:browser`) | Ran as CI story legs (run 43898451416), not locally | Docker Desktop wasn't running. The user chose to push the branch and use CI, which CLAUDE.md allows. |
| Task 2, Step 1 (optional second `count()` after logging a contact) | Not added | The code after that comment asserts only the database task status. No Follow-ups render is guaranteed there, so a second snapshot could pass for the wrong reason. |
| tasks 3.1 | Done inside Task 1 | The plan folded the docs line into Task 1, Step 5. |

## 4. Skill / workflow compliance

| Skill | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming | ✓ (design agreed in conversation; the skill wrote `brainstorm.md` at propose) |
| superpowers:writing-plans | ✓ (`plan.md`) |
| superpowers:using-git-worktrees | ✓ (`.claude/worktrees/hide-signing-row-during-go-over`) |
| superpowers:subagent-driven-development | ✓ (ledger, briefs, per-task reviews, final review) |
| (transitive) superpowers:test-driven-development | ✓ (RED/GREEN evidence in the Task 1 report) |
| (transitive) superpowers:requesting-code-review | ✓ (two task reviews plus an opus whole-branch review) |
| superpowers:finishing-a-development-branch | Pending. It runs at CLAUDE.md step 9, after archive. |

### Deliberately Skipped Skills

None.

## 5. Surprises

- The issues the user asked for were filed by a teammate as follow-ups to that teammate's own unmerged work. Three of the four couldn't start without waiting or colliding:
  - #202 builds on the unmerged migration 050;
  - #203 and #204 build on PR #205.

  Only #177 was free.
- Open branches already claimed migration numbers 047–051. Any new migration would be 052, even though `main` stops at 046.
- `gh workflow run` printed the new run URL under the repository's current name (`jin-yu-yang/vitally`), while the push went to the old remote name (`VITA-Management-System-Demo`). GitHub redirects between them.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **Subagents can stall after finishing their edits but before committing. Check the worktree and resume them rather than re-dispatching.** → **Promote to memory** (type: feedback)
  > **Why**: both implementers in this cycle hit the 600 s watchdog with complete, uncommitted edits; a resume finished each quickly.
  > **How to apply**: on any implementer "stalled" notification, run `git status` / `git diff` in the worktree first; if the edits look complete, SendMessage-resume with "verify, commit, report" instead of a fresh dispatch.

- [ ] 🟡 **The Windows-only `write-test-env` unit failure should be fixed or skipped on win32.** → **One-off: open an issue or a direct PR** (test-only fix, no contract change)
  > **Why**: every local `npm test` on Windows reports one failure, which trains people to ignore red.
  > **How to apply**: a direct PR under CLAUDE.md "bug fix with no contract change / test backfill".

- [ ] 📌 **When choosing which issues to start, check the open branches' file and migration overlap (`git diff --name-only origin/main...origin/<branch>`).** → **One-off** (recorded here)
  > **Why**: it decided this cycle's scope in a few commands.
  > **How to apply**: at the start of a multi-issue request, when teammates have open PRs.

## Ledger summary (subagent-driven development rulings and findings)

The `.superpowers/sdd/plan/` ledger is deleted after this retrospective. It recorded:

- **Ruling (pre-flight):** the full browser story runs once after the final review, not per task, because it takes about 25 min and needs the local stack. Cost if wrong: a story failure found late and fixed in the final wave. Outcome: it ran in CI after the review, and it was green.
- **Ruling (final review):** the four Minor findings are kept unfixed, because each is cosmetic or deliberate. Cost if wrong: a follow-up tidy commit.
- **Deferred minor findings:**
  - **Task 1:** the unit test uses `goOverOpen: undefined` rather than an absent field. That is equivalent for the guard.
  - **Task 2:** the story's no-Signing-row check is a one-shot `count()`, which is sound because it uses the same render pass as the visible Call row.
  - **Final review:**
    - The story heading comment lost its trailing rule.
    - `rowAction` still renders the go-over refusal, which can no longer be reached from Follow-ups (the plan keeps it defensively).
- **Things the final reviewer set aside as out of scope:**
  - a Hold from Ready to exit with the go-over still open shows a Hold row and a Call row;
  - Close unsigned cases still lists go-over cases;
  - the pool's Waiting on client tab is unchanged;
  - the trade-off of losing "near signing" visibility (brainstorm Q3);
  - #204;
  - how quickly realtime refreshes `goOverOpen`;
  - the Windows-only test failure.
- **Parked findings:** none (no fix loop was triggered).
