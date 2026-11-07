# Retrospective: add-local-seed-script

> Written: 2026-11-06 (after verify passed with warnings)
> Commit range: `a170833..d4e7907`, before archive
> Worktree: `.claude/worktrees/add-local-seed-script`

---

## 0. Evidence

- **Commit range:** `a170833..d4e7907`, 9 commits after `main` (with #142) was merged in:
  - 5 task commits;
  - 1 commit ticking the tasks;
  - 1 final-review fix wave;
  - 1 spec rewording;
  - 2 doc fixes by the controller.

  The 2 planning commits came before the merge.
- **Diff size:** +1250 / −43 lines across 15 files, after the merge.
- **Tasks done:** 20 of 20 in `tasks.md`.
- **Active hours:** about 3, over two sittings. The second sitting started after a session restart that also stopped Docker Desktop.
- **Subagent dispatches:** 13:
  - 5 implementers and 5 task reviews;
  - 1 final whole-branch review;
  - 1 fix wave;
  - 1 scoped re-review.
- **New external dependencies:** none.
- **Bugs found after merge:** none yet; not merged.
- **OpenSpec validate state:** `openspec validate --all` 11 of 11 before archive.
- **Test signal:**
  - `npm test` went from 1489 to 1499;
  - `test:database` is at 480 of 480, including 16 new `database-seed` tests;
  - the seed was run for real on the rehearsal workspace three times.

Commit chain:

```
bd00e51 Seed: act as an account through the public RPCs
9c4e104 Seed: local-only guard, opt-in flag and command
c54c0bc Seed: find the role accounts and replace the previous run
3f6d430 Seed: build the client case, ten scenarios and the help request
012491f Seed: role-named rehearsal roster and docs
09d03ab Seed: tasks done
4a0b8a3 Seed: final-review fixes (Docker on PATH, one config for guard and connection, spec items asserted, docs)
dcb4a80 add-local-seed-script: the corrections case names the Reviewer on its correction round
53f0588 Setup: the database count's verification date and change
d4e7907 Setup: the database count was verified with migration 039
```

---

## 1. Wins

- **The riskiest assumption held on the first try.** Design D1's acting technique, `set local role` plus JWT claims in one transaction, worked in Task 1 (bd00e51). The Auth-admin fallback was never needed. The test also proves the session role is restored afterwards.
- **The safety properties are each pinned by a test or by construction:**
  - the flag is checked before any file read (`tests/seed.test.mjs`);
  - a hosted target is refused;
  - deletes are limited to the run file's ids in the target workspace, including when the file names a foreign workspace;
  - no address appears in output, errors or the run file.
- **Reviews caught three real problems before merge:**
  - the documented command lacked Docker on `PATH`, which would have given an unexplained `TARGET_REJECTED` on the Mac;
  - the guard and the connection could read different configurations;
  - the spec contradicted the product on the corrections case.
- **Every seeded stage comes from the real RPCs.** A rule change will make the seed fail loudly, naming the scenario and step, not drift silently.

## 2. Misses

- 🟡 **The spec was written against an assumed product behaviour.** It said the corrections case keeps the Reviewer as its reviewer, but `REQUEST_CORRECTIONS` clears it (migration 006). This was found in Task 4 and reworded with the user's approval (dcb4a80).
- 🟡 **Docker Desktop stopped with the session restart.** The final database re-run had to wait for the user to restart it. That part of the delay is the restart's.
- 📌 **The plan's sign-in check by hand (Task 6 step 5) was done at the database level, not in a browser** (verify §7).
- 📌 **The fix-wave implementer's report has no command output for its test runs.** The controller re-ran the suites itself.

## 3. Plan deviations

| Plan task | What changed | Why |
|---|---|---|
| 1 | The receipts check asserts that every receipt for the case and actor names the Preparer, not just "the newest". | `action_receipts` has no timestamp or `case_id` column to order by. |
| 3 | The "old follow-up default" test sets `workspaces.default_followup_person_id` to Sam directly, then restores it. | `set_default_followup` now refuses a person with no account (VT007). This reproduces an old-roster stack. Ruling below. |
| 4 | `seedCases` deletes with the target's workspace id, and `readRun` normalises its lists. | Ruling from the Task 3 review: the workspace belongs to the caller, not to the file. |
| 4 | The corrections case is checked by its review round, and `reviewer_id` is null. | The product clears the reviewer. The spec was reworded to match. |
| 4 | `SAVE_PREPARER_FIELDS` isn't sent. | `SUBMIT_REVIEW` didn't need it. |
| (final review) | Docker on `PATH` in setup.md; `openDatabase({ kind: "test", env })`; three more spec checks; `refused()` keeps the original error as `cause`; a one-line note in `docs/demo-script.md`; setup.md wording and counts. | Whole-branch review findings. |

### Rulings made during apply

1. **Accept the direct update in the "old follow-up default" test.** It reproduces the state an old-roster stack really has, and it is test setup, not seed behaviour. Cost if wrong: one test's setup reaches below the private function. The final review agreed.
2. **Deletes use the target workspace, never the run file's, and `readRun` normalises its lists.** The spec says "limited to that workspace". Cost if wrong: a two-line change. The final review agreed.
3. **The corrections case is checked by its review round.** The spec's own rule forbids writing a case's holder directly. Cost if wrong: one assertion and one spec sentence. The spec wording was then changed with the user's approval.
4. **One fix wave for the final review's findings,** with `docs/demo-script.md` getting a note only. The rewrite stays #128 step 8. Cost if wrong: a few doc lines.
5. **The spec wording goes to the user before archive,** because CLAUDE.md says `/opsx:update` runs only on the user's request. The user chose "Reword it".

### Minor findings left as they are

The final review triaged these "leave":
- **The acting helpers:**
  - no error-path test for `actAs`'s rollback;
  - `applyAction` doesn't guard against a bad case id;
  - `callRpc` doesn't allowlist its name argument.
- **The command:**
  - the branch where reading the roster file fails is untested;
  - `seed.mjs` imports `seed-cases.mjs` both statically and dynamically;
  - a small duplicated error helper.
- **Account lookup and the run file:**
  - an implicit camelCase regex in the account lookup;
  - `runFilePath` built by string concatenation, as the brief required;
  - no tests for `readRun`'s non-ENOENT rethrow, or for an inactive membership.
- **The cases:**
  - a failed help-request insert isn't wrapped as `SEED_STEP_FAILED`;
  - the escalation's `requestId` lookup can send `undefined`;
  - `TODAY()` in `seed-values.mjs` uses the UTC date, which is cosmetic;
  - a workspace id that isn't a UUID gives a raw database error.
- **Tests:** the seed's database tests assume a local test stack.
- **Docs:** one long line in setup.md after the step 5 rewrap.

The final review marked the rest "fix", and the fix wave fixed them:
- the three spec checks the tests didn't assert;
- `refused()`'s `cause`;
- the demo-script note;
- the setup.md wording and count.

The setup.md "last verified" line was fixed afterwards in 53f0588 and d4e7907.

## 4. Skill / workflow compliance

| Skill | Used |
|---|---|
| superpowers:brainstorming | ✓ (brainstorm.md) |
| superpowers:writing-plans | ✓ (plan.md) |
| superpowers:using-git-worktrees | ✓ (`.claude/worktrees/add-local-seed-script`) |
| superpowers:subagent-driven-development | ✓ (ledger, task reviews, final review, fix wave, re-review) |
| (transitive) superpowers:test-driven-development | ✓ (each task wrote failing tests first; Task 5's RED failed on the placeholder workspace id before the intended failure) |
| (transitive) superpowers:requesting-code-review | ✓ |
| superpowers:finishing-a-development-branch | ✓ (push and PR, after archive) |

### Deliberately Skipped Skills

(none)

## 5. Surprises

- `set_default_followup` refuses a persona with no account (VT007). Old-roster stacks reached that state before the rule existed.
- `REQUEST_CORRECTIONS` clears the case's reviewer. The design had assumed the Reviewer stays named.
- `assertTestTarget` in local mode runs `docker inspect`. Without Docker on `PATH`, or with Docker stopped, every guarded command refuses with a deliberately vague `TARGET_REJECTED`.
- A session restart stopped Docker Desktop. The stack's containers came back on their own once Docker started.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **When a spec describes what a product action leaves behind, check the RPC that does it before writing the requirement.** → **Promote to memory** (type: feedback)
  > **Why:** the corrections case's reviewer was specified from an assumption, and migration 006 clears it. That cost a spec rewording, a ruling and a question to the user.
  > **How to apply:** during propose, for each "after action X the case has Y" line in a delta spec, grep the latest definition of that action's function.
- [ ] 🟡 **After a session restart, check Docker and the stack before any database or browser suite.** → **Promote to memory** (type: feedback; extend `browser-story-run-gap-clue`)
  > **Why:** `TARGET_REJECTED` from a stopped Docker looks like a configuration error.
  > **How to apply:** before `test:database` or `test:browser`, run `docker ps`, and `supabase status` from the stack's own directory.
- [ ] 📌 **Follow-up: the browser sign-in check on seeded data belongs to #132** (the browser story signs in as role accounts and uses the seed). → **One-off**
  > **Why:** this change's manual check was done at the database level only.
  > **How to apply:** #132's story should assert the Preparer's board and the Site Coordinator's Follow-ups on seeded cases.
