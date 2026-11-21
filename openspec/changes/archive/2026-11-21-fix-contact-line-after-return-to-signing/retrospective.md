# Retrospective: fix-contact-line-after-return-to-signing

> Written: 2026-11-21 (after verify passed with warnings)
> Commit range: `e83978f..ddcdbae`, plus the verify, retrospective and archive commits that follow
> Worktree: `.claude/worktrees/fix-contact-line-after-return-to-signing`

---

## 0. Evidence

- **Commit range:** `e83978f..ddcdbae` (6 commits before this file).
- **Diff size:**
  - code and tests: +76 / −3 lines across 3 files (`src/staff-views.mjs`, `tests/staff-views.test.mjs`, `tests/browser.mjs`);
  - including the change artifacts: +516 / −3 across 10 files.
- **Tasks done:** 8 of 8.
- **Active hours:** about 4, including three full story runs of about 11 minutes each and one stack reset.
- **Subagent dispatches:** 10 in all:
  - 2 implementers (Task 1; Task 2, resumed twice for fix rounds);
  - 2 task reviews and 2 scoped re-reviews;
  - 1 final whole-branch review (opus).
- **New external dependencies:** none.
- **Bugs encountered post-merge:** none yet. The PR is not open.
- **OpenSpec validate state at archive:** pass before archive (21 valid). It is re-checked after archive.
- **Test coverage signal:**
  - unit tests: 2216 → 2220, with 4 new #204 tests;
  - browser story: 93 of 93, both orders, at 328b8e4.

Commit chain:

```
ef003a9 Change artifacts (brainstorm, proposal, design, delta spec, tasks, plan)
896baa0 Task 1: contactStepLine { returned } + 4 unit tests
1648aec Task 2: three story checks after Return to signing
3b3fd50 Task 2 fix round 1: checks on the volunteer case page (still wrong window)
328b8e4 Task 2 fix round 2: checks in the Reviewer's window (story green)
ddcdbae tasks.md checked off
```

---

## 1. Wins

- **Small, contained code change.** It is one optional argument on `contactStepLine`, passed by one caller (896baa0). The final reviewer confirmed that no other view shows the stale line after a Return to signing:
  - the client view already uses `stage.review_approved.client.resign`;
  - the board row already reads "Waiting for the client to sign again.";
  - Mark ready to e-file already skips the go-over wait.
- **The existing spec answered half the issue.** `case-lifecycle` "A rejected case returns to signing" already ruled out a re-raised go-over. That kept #204 free of database work and inside the user's no-migration rule.
- **A finding during the design talk changed the wording before any code.** A resolved go-over can mean the client was not reached. So the "no" sentence says only that the go-over "was passed to the office" (design D3). The history-row tweak I had first offered was withdrawn (brainstorm Q3).
- **The story caught a real gap that the unit tests could not.** Runs 1 and 2 failed on the new checks, which showed that the plan's assumption about which window and page show "Your next step" was wrong (§2, §5).

## 2. Misses

- 🟡 **[painful | evidence: 1648aec, 3b3fd50, story runs 1 and 2] The plan put the story checks on the wrong window.** Plan Task 2 assumed the `staff` window at the Return to signing step shows "Your next step". It is the Site Coordinator's office case page (`renderAdminCase`).
  - Fix round 1 still assumed a single window and opened the Work board, but the Site Coordinator's account is office-only.
  - Only round 2 used the story's per-role windows (`use("reviewer", …)`).
  - The cost was two extra 11-minute story runs.
- 🟡 **[painful | evidence: `MIGRATION_CHANGED`] The local stack had drifted from main.** It held #203's pre-merge 054; at merge a teammate removed `service_role`'s grants, and 053 was missing. The runner refused to migrate, and with the user's approval the stack was reset to empty.
- 📌 **[nit | evidence: 896baa0] The plan's unit-test regexes used a literal `isn't`, but `esc()` renders `'` as `&#39;`.** The implementer caught it at RED. It's recorded as a ruling (§3).
- 📌 **[nit | evidence: final review] Deferred minor test-hardening:**
  - unescaped trailing `.` in two regexes;
  - `nextStepPanel` has no guard that the marker exists;
  - no `?.` on `.panel.next-step` in the story;
  - the count assertion has no message;
  - the "yes" test doesn't check that the first-signing sentence is absent.

  The final reviewer said none blocks merge.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| 1 (Step 1) | The test regexes match the apostrophe as `isn(?:'\|&#39;)t` | `esc()` escapes `'`. The plan's literal could never match (ruling at the Task 1 report) |
| 2 (Step 1) | The checks run in the Reviewer's window: `await use("reviewer", classReference)` before them and `await use("siteCoordinator", classReference)` after | The Site Coordinator's office page has no "Your next step" panel, and that account has no Work board (fix rounds 1–2) |
| 2 (Step 2) | The controller ran the story, not the implementer | Ruling: a 25-minute Playwright run inside a subagent is fragile. The controller ran it three times |
| 3.1 | The controller wrote the issue draft, with no review package | It is scratchpad text, not repository code |

**Rulings and deferred findings recorded in the ledger:**

1. **Pre-flight:** the scan was clean, so no rulings.
2. **Ruling (Task 1):** the tests match `&#39;` as well as `'`, because `esc()` renders the apostrophe that way. If wrong, only test regexes change.
3. **Deferred minor (Task 1 review):** an unescaped trailing `.` in two #204 regexes, and no direct `contactStepLine(returned: true, null questionnaire)` unit test, which `nextStep` covers.
4. **Ruling (Task 2):** the implementer syntax-checks only, and the controller runs the story, because a long Playwright run in a subagent is fragile. If wrong, a later fix round.
5. **Ruling (Task 3.1):** the controller writes the scratchpad issue draft, with no review package. If wrong, the user rewords the draft.
6. **Deferred minor (Task 2 review):** no `?.` on `.panel.next-step`, and the count assertion has no message.
7. **Fix rounds (Task 2):**
   - Round 1: checks on the volunteer case page via the Work board. It was reviewed clean, but story run 2 still failed.
   - Round 2: checks in the Reviewer's window via `use()`. Reviewed clean; story run 3 passed.
8. **Ruling (final review):** park the four minor test-hardening findings with no fix wave, because they are cosmetic and none blocks merge. If wrong, a one-line test edit later.

## 4. Skill / workflow compliance

| Skill                                            | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming                        | ✓ (the design was agreed in conversation; the skill recorded it in `brainstorm.md`) |
| superpowers:writing-plans                        | ✓ |
| superpowers:using-git-worktrees                  | ✓ (already in the change's worktree; baseline 2216 pass) |
| superpowers:subagent-driven-development          | ✓ |
| (transitive) superpowers:test-driven-development | ✓ (Task 1: RED, 3 failing, then GREEN) |
| (transitive) superpowers:requesting-code-review  | ✓ (task reviews, re-reviews, final review) |
| superpowers:finishing-a-development-branch       | ✓ (CLAUDE.md step 9, after archive) |

### Deliberately Skipped Skills

None.

## 5. Surprises

- **The office and volunteer workspaces render different case pages** (`renderAdminCase` and `renderStaffCase`, `src/views.mjs` ~470–482). Only the volunteer one has "Your next step".
- **The story keeps one window per role, signed in as role-named accounts.** The Site Coordinator's account has no Work board. `staff` is only an alias for the current role's window (`use()`, `tests/browser.mjs` ~1047).
- **Main had moved since my last fetch.** #243 and #244 merged during the session, and the merge changed 054's grants. That's why the local stack stopped matching.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **In a story step, read a staff screen in the window of the role that sees it. `staff` is whichever role's window ran last.** → **Promote to memory** (type: feedback)
  > **Why:** #204's story checks failed twice. The plan assumed the current `staff` window (the Site Coordinator's office page) showed the volunteer "Your next step".
  > **How to apply:** when planning a `tests/browser.mjs` assertion, find the last `use("<role>")` before the step, and switch with `use(role, reference)` if another role sees the screen.
- [ ] 📌 **Rendered HTML escapes apostrophes (`&#39;`), so unit-test regexes on staff text with `'` must allow for it.** → **One-off** (recorded here)
  > **Why:** it is a plan-writing slip, caught at RED.
  > **How to apply:** when writing plan test regexes for text containing `'`.
- [ ] 📌 **After teammates merge migrations, the local stack can refuse with `MIGRATION_CHANGED`. Check the digests before assuming a code problem.** → **Promote to memory** (the `local-test-stack` reference)
  > **Why:** it happened at the start of this change's story run.
  > **How to apply:** before a story or database run on a fresh branch from main.
