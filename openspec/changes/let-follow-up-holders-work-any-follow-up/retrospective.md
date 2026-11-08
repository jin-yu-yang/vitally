# Retrospective: let-follow-up-holders-work-any-follow-up

> Written: 2026-11-08 (after verify passed with warnings)
> Commit range: `3697f72..` the archive commit (`798dd3e` is the first commit on the branch)
> Worktree: `.claude/worktrees/let-follow-up-holders-work-any-follow-up`

---

## 0. Evidence

- **Commit range:** `3697f72..bd092ea`, 11 commits before this retrospective. The tasks, verify and retrospective commit and the archive commit follow.
- **Diff size:** +1618 / −120 lines across 33 files at `bd092ea`, counting the change folder.
- **Tasks done:** 18/18 (`grep -cE '^\s*- \[x\]' tasks.md`).
- **Active hours:** about 5. That's brainstorm and proposal (about 1 h), the plan check (about 1 h) and apply (about 1 h) on 2026-11-07, then verify (about 2 h) on 2026-11-08, most of which was five browser-story runs.
- **Subagent dispatches:**
  - apply: 12, plus 1 resumed implementer for a fix round;
  - Workflows: 6 agents (looking at #172 and #177), 41 (plan check), 40 (verify), 2 (checking the verify report's claims).
- **New external dependencies:** none.
- **Bugs encountered post-merge:** none yet. Not merged.
- **OpenSpec validate state at archive:** 13/13 on `bd092ea`. It's re-run at archive.
- **Test coverage signal:**
  - unit tests: 1498 → 1500 (2 roster tests);
  - database suite: 441 → 448 (5 subtests in Task 1, 2 more from verify's fixes);
  - browser story: not green in any single run (`verify.md` section 2). Step 18 also fails on `main`.

Commit chain (in time order):

```
798dd3e Plan OpenSpec change let-follow-up-holders-work-any-follow-up (#172)
bc96fa0 Planning fixes for let-follow-up-holders-work-any-follow-up (#172)
19bc7d4 Database: anyone with follow-up access works any open follow-up; followup needs admin (#172)
f9edb9d Roster: follow-up access needs admin (#172)
09765ce Follow-up tasks: anyone with follow-up access works them; the assignee is a label (#172)
edf91c5 Docs: follow-up holders work any follow-up; migration 042 (#172)
e236cf8 Docs: current unit count in the front-end guide (#172)
906c13c Tasks: tick 1.1-5.2 and 6.2 for let-follow-up-holders-work-any-follow-up (#172)
8814483 Docs: the 042 row says which refusal applies (#172)
0bab775 Tests: missing, cancelled and capability-less follow-up work is refused; review attempts unchanged (#172)
bd092ea Docs: database count 448; who gets the task forms; RECORD_CONTACT row; full rollback (#172)
(next) verify, retrospective and the 6.1 tick; then the archive commit
```

---

## 1. Wins

- **[evidence: `task-1-red-041.txt`, ledger]** Every new database test failed first on 041, for the reason the plan gave: 13 failures, each a non-assignee's call refused `FORBIDDEN`, the follow-up-only hire accepted, or the stored write accepted. Then 042 turned them green: 151/151 in the five files, then 446/446.
- **[evidence: `dry-run-042.sql`]** 042 ran in a rolled-back transaction before it was applied. That showed:
  - no function was added or removed;
  - the lock no longer reads the assignee;
  - both functions are security definer and not executable by clients;
  - the check refuses the write, and `add_staff_member` refuses with VALIDATION;
  - an admin without follow-up access is still allowed;
  - the file applies again cleanly.
- **[evidence: `bc96fa0`; plan-check workflow, 41 agents]** The plan check confirmed 36 problems before apply. These included:
  - a resolve naming another case's task is `VALIDATION` (from `check_related`), not `FORBIDDEN`;
  - the pg constraint name is on `error.cause`;
  - a failing red run would cascade without `try/finally`.

  The four task reviews then found 0 critical code issues. The one "important" finding was a docs count.
- **[evidence: specs/sign-in/spec.md; design D5]** The "followup needs admin" rule went into a sign-in requirement of its own, so #136's rewrite of the two roster requirements can't collide with it, whichever archives first.
- **[evidence: `0bab775`]** Verify's 40-agent pass found test gaps that the task reviews and the final review had left:
  - a capabilities check that ran after the `finally` had restored the row;
  - no test for a task id that exists nowhere, or for an admin-only person (a cancelled task was tested only after closure);
  - a missing Resolve-button check;
  - "review attempt unchanged" never asserted.

  All were fixed before archive: database 446 → 448.
- **[evidence: `verify.md` section 2]** The Firefox launch failure was traced to its cause:
  - macOS denies processes the Claude app starts access to `~/Library/Application Support/Firefox`;
  - Firefox's profile service reads that folder at startup, even when it's given another profile.

  A preload outside the repo works around it with `--override` and `[App] Profile=…`. No repository file changed.
- **[evidence: `story-main.txt`]** For the story failure, `main`'s own code was run (unpacked with `git archive`) against the same stack. That proved step 18 fails without this branch too, instead of guessing.

## 2. Misses

- 🟡 **[painful | evidence: `verify.md` section 2; ledger R5]** No browser-story run was green.
  - For the whole of apply, Firefox couldn't launch inside the app, so the story was left open (R5).
  - Once the workaround existed, the runs failed in three different steps. One of them (step 18) also fails on `main`. The other two each failed once, for causes that weren't established.
  - Five runs took about 50 minutes, and steps 23–40 of the Chrome-client order never ran on the branch. That range includes step 37, the withdrawal-notice resolve, which passed in the other order.
- 🟡 **[painful | evidence: ledger "Task 1: minor (deferred)", `0bab775`]** A test that asserted nothing useful survived two reviews.
  - The capabilities check in "no follow-up-only person can be stored" ran after the `finally` had restored Riley.
  - Task 1's review deferred it as a "plan-mandated" minor, and the final review triaged it "leave".
  - It left a THEN clause of the sign-in scenario unasserted, so it was a spec gap, not a minor. Verify fixed it.
- 🟡 **[painful | evidence: `verify.md` section 2, run 1]** The first full story run wasn't alone: verify's 40-agent workflow ran alongside it. Its two failures couldn't be told apart from load, which cost a second run.
- 📌 **[nit | evidence: `edf91c5`, `bd092ea`]** Task 4 rewrote the `RECORD_CONTACT` row's rule as "any `followup` holder" for an action that has been refused since 031. Verify corrected it.
- 📌 **[nit | evidence: `openspec/specs/office-follow-up/spec.md:4`]** Archive merges requirements but never a Purpose. The office-follow-up Purpose ("not tied to a document request") would go stale, so it's reworded in the archive commit.
- 📌 **[nit | evidence: `038_staff_identity.sql:567-568`]** `vitally_log_contact` still says "the task's assignee" in a comment. The migration is applied, so it stays as is; #136's redefinition can reword it.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| 5 / 6.1 (story) | The story ran during Task 3's review (R3), then was left open through apply (R5). Verify ran it five times with a Firefox launch preload, plus once on `main` | Firefox couldn't launch from the app; the preload was found during verify |
| 4 | One fix round: `frontend.md`'s unit count (`e236cf8`) | The task review found the stale count |
| Final review | A fix wave of the false claim in the `database.md` 042 row and the people-row punctuation (`8814483`, R7) | A docs claim that wasn't true |
| (bookkeeping) | The controller ticked `tasks.md` (`906c13c`, R6) | The schema's apply makes the checkboxes the executor's bookkeeping |
| (verify) | Two new database subtests, three stronger assertions (`0bab775`), and four docs and design fixes (`bd092ea`), none of them in the plan | Verify's findings (section 8) |
| (not run) | `npm run test:auth-browser` | Planned as not needed: sign-in itself doesn't change (`brainstorm.md`, Verification) |

## 4. Skill / workflow compliance

| Skill                                            | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming                        | ✓ (the method in conversation; the skill wrote `brainstorm.md` at propose) |
| superpowers:writing-plans                        | ✓ (`plan.md`, `798dd3e`) |
| superpowers:using-git-worktrees                  | ✓ (the native worktree, cut from `bc96fa0`) |
| superpowers:subagent-driven-development          | ✓ (ledger: 4 tasks, the final review) |
| (transitive) superpowers:test-driven-development | ✓ (the red run on 041 in Task 1; red roster tests in Task 2) |
| (transitive) superpowers:requesting-code-review  | ✓ (four task reviews, the final whole-branch review, scoped re-reviews) |
| superpowers:finishing-a-development-branch       | ✓ (CLAUDE.md step 9, after archive) |

### Deliberately Skipped Skills

(none)

## 5. Surprises

- **Firefox was blocked inside the app.** Playwright's Firefox launched from the Claude app on 2026-11-07, for `remove-sample-case-tools`'s verify, then stopped launching there:
  - It quit at startup with "Could not find profile folder." even with Playwright's temporary profile.
  - Pointing `HOME` elsewhere doesn't help: macOS resolves Application Support from the account, not from `$HOME`.
  - Neither macOS nor the Claude app was updated in between, by the install history and the app's plist date.
- **The story isn't stable on this machine any more.** It ran 83/83 for #174 on 2026-11-07. A day later its two-window claim race (step 18) failed on `main` too, and two other steps each failed once, with the machine under load.
- **`check_related` comes first.** It refuses a `RESOLVE_FOLLOWUP` naming another case's task with `VALIDATION`, before any lock. Only the contact path reaches `FORBIDDEN`. The first plan had both as `FORBIDDEN`.
- **OpenSpec 1.14 is strict about MODIFIED.** A MODIFIED requirement can't drop a scenario, so the two rewritten requirements are REMOVED and then ADDED under new names, as `remove-presenter-screens` did.
- **`f.sql` wraps pg errors.** The check constraint's name is on `error.cause.constraint`, not `error.constraint`.

## 6. Promote candidates → long-term learning

- [x] 🟡 **Playwright's Firefox needs `--override` inside the Claude app.** A `NODE_OPTIONS=--import` preload that adds `--override <ini>` (with `[App] Profile=Playwright Firefox`) lets the story run there. → **Promote to memory** (type: reference)
  > **Why**: from 2026-11-08, macOS denied processes the app starts access to `~/Library/Application Support/Firefox`, and Firefox quits with "Could not find profile folder." Five story attempts failed before the cause was found.
  > **How to apply**: whenever `npm run test:browser` fails with that line, use the preload rather than asking the user to switch terminals.

- [x] 🟡 **A deferred minor that leaves a scenario's THEN unasserted is a spec gap.** Fix it in the task, even when the plan's text mandated it. → **Promote to memory** (type: feedback)
  > **Why**: the Riley check here ran after its own `finally` restored the row. It was deferred as "plan-mandated" and survived the final review, and only verify fixed it (`0bab775`). This report's own claims also needed a second check (two agents found 24 overstatements and errors before commit).
  > **How to apply**: when triaging review minors, ask whether the finding means a scenario clause has no assertion. If it does, it is not minor.

- [ ] 📌 **When a story step fails, run `main`'s story against the same stack before calling it.** Use `git archive origin/main` into the scratchpad, with links to `node_modules` and `.env.test`. → **Promote to memory** (type: feedback)
  > **Why**: it settled within one run that step 18's race was older than this change.
  > **How to apply**: whenever a browser-story failure sits outside the change's code.

- [ ] 📌 **Archive never rewrites a capability's Purpose.** When a change widens a capability, reword its Purpose in the archive commit. → **One-off** for now; promote if it happens again.
  > **Why**: the office-follow-up Purpose said "not tied to a document request" after this change gave it the general rule for every purpose.
  > **How to apply**: at archive, read each touched capability's Purpose against its new requirements.

- [ ] 📌 **The story's two-window claim race (step 18) is unreliable.** It fails on `main` too. → **Follow-up** (its own change or issue)
  > **Why**: the counts always hold (one event, one receipt, one participant), but the losing window sometimes shows no refusal. That depends on whether the winner's live update or the window's own refused reply arrives first.
  > **How to apply**: investigate whether the app drops a refusal that arrives after the live update, or whether the step needs to read differently.

---

## Ledger summary (rulings, parked and deferred findings)

**Rulings during apply:**
- **R1:** The controller runs the story right after Task 3's review, so Task 4 records real counts. Cost if wrong: one extra run.
- **R2:** Only the controller runs `db:migrate:test`, `test:database` and `test:browser`, as plain commands with a literal `PATH`.
- **R3:** The story ran during Task 3's review, not after it. Cost if wrong: one re-run if the review's fixes touched browser code. They didn't.
- **R4:** Task 4 (docs) was dispatched while the story re-ran, with unit 1500 and database 446. The story row would change only if its count changed.
- **R5:** Apply and the final review carried on without the story, which was left open for the user and recorded in `verify.md`. Verify later ran it with the preload (section 2).
- **R6:** The controller ticked `tasks.md` itself (`906c13c`).
- **R7:** The final fix wave covered the false claim in the `database.md` 042 row and the people-row punctuation (`8814483`). Every other minor was left as triaged.

**Decisions during verify:**
- Run the story with the Firefox launch preload, and change no repository file for it.
- Compare against `main`'s story before deciding whether a failure belongs to this change.
- Stop rerunning after run 4. Three different steps had failed, none in code this change alters, and one of them also fails on `main`.
- Tick 6.1, with every run recorded in `verify.md`, even though `plan.md`'s expected result ("pass") wasn't met. The pull request says so.
- Fix verify's warnings and its cheap notes on the branch (`0bab775`, `bd092ea`).
- Reword the office-follow-up Purpose at archive.

**Deferred minors from the task reviews, and where each ended:**
- **Task 1, the 042 header.** It says `act_resolve_followup` checks `followup` before the lock; the check is in `vitally_apply_action`, step 4. Left as is: 042 is applied to the local stack, and applied migrations are final.
- **Task 1, the Riley check after the `finally`.** Fixed in `0bab775`.
- **Task 1, no test for a contact on a task id that doesn't exist.** Fixed in `0bab775`.
- **Task 3, a re-wrap.** The comment above `followupForms` in `admin-views.mjs` has a first line of about 100 characters. Left: cosmetic.
- **Task 3, the queue row's count.** In `office-views.mjs`, the call row counts tasks while it de-duplicates names. That behaviour is unchanged. Left.
- **Task 4, the people-row punctuation in `database.md`.** Fixed in `8814483`.
- **Task 4, two long single lines.** `database.md:330` and `:624` are single lines in hard-wrapped paragraphs. Left: cosmetic.
- **The final review's other minors.** Triaged "leave": cosmetic wording.

**Parked findings:** none. No fix loop hit its round limit.
