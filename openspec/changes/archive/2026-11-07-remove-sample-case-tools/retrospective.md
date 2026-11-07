# Retrospective: remove-sample-case-tools

> Written: 2026-11-07 (after verify passed with warnings)
> Commit range: `dc9d5e0..7efb166` before archive (`main` still at `a724def`)
> Worktree: `.claude/worktrees/remove-sample-case-tools`

---

## 0. Evidence

- **Commit range:** `dc9d5e0..7efb166`, 13 commits after the plan commit. There were no merges, because `main` didn't move.
- **Diff size:** +1031 / −2461 lines across 52 files, from `dc9d5e0` to `7efb166`.
- **Tasks done:** 23 of 23 in `tasks.md`.
- **Active time:** two days, 2026-11-06 and 2026-11-07. This included one stop for the backup and the user's approval before 040 was applied.
- **Subagent dispatches:** about 25.
  - 13 implementer runs, counting the resumes for fix rounds.
  - 11 independent reviews and scoped re-reviews.
  - 1 final whole-branch review.
- **New external dependencies:** none.
- **Bugs after merge:** none yet, because it isn't merged.
- **OpenSpec validate:** 13 of 13 before archive.
- **Test signal:**
  - `npm test`: 1498 before, 1496 after, all passing.
  - `test:database`: 480 before, 440 after, all passing, run alone.
  - `test:browser`: 83/83 plain, at 804.8 s and 681.0 s.
  - `test:auth-browser`: 20/20.
  - `build:hant -- --check`: clean.
- **Data safety:** 24 row-count lines before and after 040 are identical, and the backup was verified by a restore.

Commit chain:

```
27dc19a Database: migration 040 removes the sample-case tools (#135)
85ca7b7 Database tests: the sample-case tests go with their code, the rest move to the seed (#135)
9dd7983 Database tests: keep the live workspace-broadcast checks (#135)
bec61ab Database tests: the version-2-only rule without disabling a trigger (#135)
58bff30 Roster: sampleCaseOwners is ignored with a note (#135)
324197d Roster: test that the command prints the note (#135)
10b647e Browser: the reset notice and the sample fields go (#135)
5097ed9 Browser: fix-ups from the Task 4 review (#135)
963e732 Browser story and docs: no sample cases (#135)
fb71af5 Docs: the last stale sample-case claims (#135)
66e4cec Fix wave: pin the seed's screening checks, last stale minors (#135)
f0c8e42 Docs: current test counts in the developer guide (#135)
7efb166 Online screening test: no simulated key in the stored detail; tick tasks (#135)
```

---

## 1. Wins

- **040 applied on the first try with no CASCADE.**
  - Design D1 had listed every dependency, so each policy, constraint, index and function was dropped or rewritten by name, in order (27dc19a).
  - The catalog test (`tests/database-catalog.mjs`) checks three things: no function source, name, constraint or view mentions a fixture; the 24 per-table policies are intact; and the origin and version-2 checks are as defined.
- **No data was lost, and that was proven, not assumed.** A full backup was taken and verified by a restore. 24 read-only counts were taken before the apply and were identical after it.
- **Every removed test was traced to dropped code.** The Task 2 review reconciled the counts:
  - `database-fixtures.mjs` had 34 tests (7 top-level and 27 subtests).
  - 21 other tests were removed, each tied to its drop line in 040.
  - Two removals turned out to have live checks and were converted instead.
- **The seed took over every property that still holds.** Replacement tests cover receipts outliving deleted cases, no deletion reaching an applicant, client numbers never reused, field checks on seeded answers, and screening checks by service.
- **Independent review on every task from Task 4 on caught real gaps:**
  - the roster note's print was untested;
  - four stale doc claims;
  - two canonical requirements that would have been false after archive;
  - an online identity scenario no test pinned.

## 2. Misses

- 🟡 **The brainstorm's spec sweep (Q10) missed two canonical requirements:** case-lifecycle "The online sample" and sign-in's presenter-only sentence. The final review found them, and the user had them revised (66e4cec). The sweep searched for requirements *about* samples, but not for sentences that mention samples inside other requirements.
- 🟡 **The brainstorm's test count was wrong:** 27 database-fixtures tests, against 34 real ones. It counted only `t.test(` subtests. The user asked for a reconciliation, which the Task 2 review did.
- 🟡 **A realtime test with live checks went out with its subject** ("the shared generation signal reaches every member"). Its two live checks (staff get the workspace update, and the payload carries nothing private) were restored as a conversion (9dd7983).
- 🟡 **The first version-1 conversion disabled a trigger inside a test.** The user ruled that out. Two tests replaced it: a stored-as-version-2 check and a catalog check of `cases_intake_version_range` (bec61ab).
- 📌 **The roster's printed note was first tested only through `rosterNotes`.** A CLI child-process test was added (324197d).
- 📌 **Test counts in docs went stale in four places outside the plan's file list** (`docs/setup.md` and three developer docs). They were fixed in 66e4cec and f0c8e42.
- 📌 **Task 5's report said the per-order browser times weren't available.** They were in `browser.log`, and the controller read them from there.

## 3. Plan deviations

| Plan task | What changed | Why |
|---|---|---|
| 1 | 040 explicitly revokes the new `initialize_workspace(uuid,uuid[],uuid[])`, and does the same for any function it creates rather than replaces. A catalog test checks that workspace setup can run it and no client can. | The user's grant rule, given during Part A. |
| 1 | Part B (the apply) waited for the backup, the before counts and the user's go-ahead. | The user's stop rule. |
| 2 | The realtime generation test was converted, not removed. | It had live checks (the user's rule). |
| 2 | "no version-1 application blocks…" was converted into two tests, without disabling a trigger. | User decision. |
| 2 | The `database-store` "adapter resets fixtures" test went one task before its store wrapper. | Ruling 3 below. The wrapper went in Task 4, and the final review confirmed it is gone. |
| 3 | The CLI print got a child-process test. | Task 3's review. |
| 4 | The unused `--vt-notice*` CSS tokens and their two shell-test entries were removed. | User decision. |
| 4 | The `*_NOTICE` guard became `*_MESSAGE` and was made non-vacuous. The quiet-forget check was folded into "a workspace update refetches the lists, the workspace and the open case". | Task 4's review. |
| 5 | Added `docs/developer/database.md` (~731), `DESIGN.md`, the "forty" count and the current-definition table. | Task 3 and Task 5 reviews. |
| (final) | MODIFIED deltas for case-lifecycle "The office records the screening checks" and sign-in "A workspace can have staff and no presenter". "in the same season" added to local-seed-data. | User decisions after the final review. |
| (final) | A seed screening-checks test, plus the database-actions test "an online case records the identity check with the other three". | The user's rule: the online scenario must not go untested. No seeded case is online. |
| (final) | `simulated`-key assert in the online test; doc counts. | User decision; fix-wave review. |

### Rulings made during apply (from the ledger)

1. **Accept the database suite being red between Task 1 and Task 2.** The plan named this. Cost if wrong: one commit that isn't green. The final review agreed.
2. **Leave 040 unedited after its local apply, including the comment it dropped from 038.** Applied migrations are final. Cost if wrong: one lost comment, recoverable from 038.
3. **Remove the `database-store` reset test in Task 2, before its wrapper went in Task 4.** The rule is per change, and the test couldn't run once the RPCs were dropped. The final review confirmed the wrapper is gone.
4. **Convert the realtime generation test, not remove it.** Its two checks describe live behaviour.
5. **Task 2 fix round 2 and Task 3 fix round 1 were accepted on the controller's own check.** Round 2 was a diff read, round 1 a mutation check. That was before the user's rule that every round gets an independent reviewer. The final whole-branch review covered both.
6. **Keep `docs/setup.md` at 440/440, not the brief's 438.** It matches the run after the two new tests. The fix-wave review agreed.

### User decisions recorded

- **No CASCADE** on any DROP in 040, with every dependency handled by name.
- **The grant rule:** explicit revokes on every function 040 creates, and the blanket `vitally_private` revoke at the end. `vitally_create_case` keeps its authenticated grant.
- **The data-safety stop:** a full backup and the before counts first, then ask, then the after counts. Stop on any difference.
- **Test removal:** a test goes only with its code, named and proven by grep. Lists and counts before and after go in the PR.
- **No test disables a trigger.**
- **From Task 4 on, every task and every fix round gets an independent reviewer.**
- **The CSS tokens are removed.**
- **The final review's two Important findings:**
  - reword "The online sample" under its name;
  - drop the presenter-only sentence;
  - fix all minors in this PR.
- **The online identity scenario must be tested:** name an existing test, or add one through the client flow. One was added.
- **Add the `simulated`-key assert.** Leave the seed mutation that fails before the assertion.

### Minor findings left as they are

- **040 drops 038's comment above `initialize_workspace`** (ruling 2).
- **The filing test's `caseId` can be undefined if setup throws.** That's harmless: the test fails either way.
- **The field-checks test no longer has the fixture generator's shape asserts.** The generator is gone.
- **Some line references in the Task 2 report are approximate.**
- **Fix-wave mutation A fails at the seed step**, before the new assertion runs, because the database refuses the bad set. Mutation B shows the assertion itself can fail.
- **The scenario name "The online sample" is kept** by the user's choice, though no sample exists.

### Out-of-scope notes for #136 and #137

- **#136 (presenter access) is next.** This change left presenter access alone; the brainstorm deferred it to #136.
- **#137 rewrites the demo script.** This change didn't touch `docs/demo-script.md`.

## 4. Skill / workflow compliance

| Skill | Used |
|---|---|
| superpowers:brainstorming | ✓ (brainstorm.md, with the builder check) |
| superpowers:writing-plans | ✓ (plan.md) |
| superpowers:using-git-worktrees | ✓ (`.claude/worktrees/remove-sample-case-tools`) |
| superpowers:subagent-driven-development | ✓ (ledger, task reviews, fix rounds, final review, fix wave) |
| (transitive) superpowers:test-driven-development | ✓ (Catalog and filing tests RED on 039, GREEN on 040. Mutation checks on every new test.) |
| (transitive) superpowers:requesting-code-review | ✓ |
| superpowers:finishing-a-development-branch | ✓ (push and PR, after archive) |

### Deliberately Skipped Skills

(none)

## 5. Surprises

- **A plain version-1 insert isn't refused.** 023's `cases_intake_version_insert` trigger stamps it to version 2, so the version-2 check can't be reached through normal statements. That's why a catalog check pins its definition.
- **The seed has no online case.** `src/sample-data.mjs:36` hard-codes `drop_off`, so the seed never takes the identity branch.
- **Removing a column broke two kinds of test:** tests of the column itself, and fixture builders and payload shapes that still carried the field (`fixture: false`) without failing. Those leftovers were found only by review.
- **Requirements can mention a removed feature in passing.** A spec sweep by requirement title misses those sentences.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **When a change removes a feature, grep every canonical spec's full text for it, not just the requirement titles.** → **Promote to memory** (type: feedback)
  > **Why:** "The online sample" and sign-in's presenter-only sentence would have been false after archive, and only the final review caught them.
  > **How to apply:** in the brainstorm's spec question for any removal change, including #136.
- [ ] 🟡 **Count tests from the runner's output, not by counting `t.test(` in the source.** → **One-off** (record only)
  > **Why:** the brainstorm said 27 database-fixtures tests, and the real number was 34.
  > **How to apply:** whenever a brainstorm or PR states a removed-test count.
- [x] 🔴 **A test goes only with its code; name the code and grep.** → **Already in memory** (`test-removal-needs-removed-code`)
  > **Why:** it caught the realtime test and the version-1 test in this change.
  > **How to apply:** #136.
- [ ] 📌 **Before applying an irreversible migration to the local stack, take a verified backup and before/after row counts.** → **Promote to memory** (type: feedback)
  > **Why:** the user asked for this here, and it made the apply safe to approve.
  > **How to apply:** any change whose migration deletes rows.
