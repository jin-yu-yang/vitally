# Retrospective: add-volunteer-clearance

> Written: 2026-11-13 (after verify passed with warnings)
> Commit range: `321fba0..64d582c`
> Worktree: `.claude/worktrees/add-volunteer-clearance` (branch `add-volunteer-clearance`)

---

## 0. Evidence

- **Commit range**: `321fba0..64d582c` (56 commits; archive adds one more)
- **Diff size**: +6687 / −198 lines across 58 files
- **Tasks done**: 24/24 (`tasks.md`, including 5.4, which `/opsx:update` added on 2026-11-12)
- **Active hours**: about 25 hours of wall clock over 2026-11-11 to 2026-11-13. Much of it was CI waiting. One implementer hung for more than 5 hours (Task 8, first attempt).
- **Subagent dispatches**: about 45 in total:
  - 14 implementer dispatches (one per plan task, plus the fresh Task 8 restart, the final fix wave, and the fragile-test conversion);
  - 9 fix-round resumes;
  - 12 task reviews;
  - 8 scoped re-reviews;
  - 1 final whole-branch review.
- **New external dependencies**: none
- **Bugs encountered post-merge**: none yet (not merged)
- **OpenSpec validate state at archive**: pass (`openspec validate --all`: 14/14 valid at verify)
- **Test coverage signal**, base `main` 321fba0 (CI 42913394361) → head (CI 43354542913):

  | Suite | Before | After |
  |---|---|---|
  | unit | 1575 | 1627 |
  | database | 479 | 550 |
  | sign-in | 20 | 24 |
  | story, per leg | 46 | 47 |

  The story legs ran in 622 s and 642 s, under the 900 s limit. The local `test:database` passed 550/550 on the user's stack, after 045 and the rehearsal seed.

Commit chain (oldest first, condensed; the full list is `git log --reverse --oneline 321fba0..64d582c`):

```
d14a0a9 Plan OpenSpec change add-volunteer-clearance
6df2fe7..4008584  Task 1  045 part 1: guard, strip, helpers, deferred trigger (+ row-lock fix)
16af491..52cf4c8  Task 2  fixture clears staff by default
f44d7c6..c26dc55  Task 3  read gate on 21 policies (+ story Roster expectation)
5cbf1cb..8f1694d  Task 4  action gate VT009, effective capabilities
16eb797..55e96a6  Task 5/5b vitally_my_clearance, require_cleared_assignee
a60ebdd..efbd36e  Task 6  Roster save rules, open-work rule (takes-away reading)
f1bf53a           Task 7  app error code, clearance in the store
6a8e0a3..2dee8fa  Task 8  Finish your setup screen
aebd62e..b1dde51  Task 9  Roster screen (+ untick fix)
0578d2b           /opsx:update  D14, task 5.4, plan Task 6b
1f3178c..586fcc5  Task 6b save leaves uploaded certificates alone
3bc78ad..58df253  Task 10 seed and docs (+ add-only clearing)
2c7085f           Task 11 browser checks
7745ac4..5052bda  final review fix wave
abb5b7d           fragile test converted
64d582c Verify add-volunteer-clearance; tick 7.2 and 8.3
```

---

## 1. Wins

- [evidence: CI 43354542913; final review] **The security core landed complete on the first design.** The final whole-branch review found no Critical issues:
  - all 21 case-data policies are gated;
  - all six case RPCs refuse an uncleared caller before any lookup (`045:200,277,327,405,473,534`);
  - effective capabilities reach every path that resolves the caller;
  - only `cleared_workspace_id()` and `vitally_my_clearance()` are granted, and only to `authenticated`.
- [evidence: d14a0a9 ledger pre-flight table] **The pre-flight scan caught two cross-task conflicts before any code.**
  - Task 4 would have locked uncleared admins out of the Roster.
  - Task 10's seed order would have hit VT009.
  - Both were ruled up front, and neither caused rework.
- [evidence: 9ad9617→b1dde51, 586fcc5, 58df253] **Per-task reviews caught three bugs that tests and CI didn't:**
  - ticking a certificate unticked the role just chosen;
  - the save deleted `uploaded` certificates;
  - the seed's clearing deleted role accounts' extra certificates.

  CI was green each time. The reviewer found them by reading against the spec.
- [evidence: user decisions 2026-11-12/13] **The user's data stayed safe.**
  - A read-only query and a `pg_dump` came before 045 touched the persistent stack.
  - The seed's clearing was made add-only before it ran there.
  - Result: `removed 11` cases, no duplicates, and the role accounts unchanged on a re-run.
- [evidence: run ids in verify.md] **CI-only verification worked while the local stack was frozen for the PCDC review.** Database, sign-in and story ran per task through `gh workflow run ci.yml --ref add-volunteer-clearance`, and progress never stalled on the freeze.

## 2. Misses

- 🟡 [painful | evidence: ledger "Task 8 … hung 5+ h"; restart at bc10195] **The first Task 8 implementer hung for more than 5 hours and never pushed.** It left only RED tests. The user had to stop it. The restart brief added hard rules: a timeout on every command, no foreground long-running process, bounded CI polling. The rest of the cycle had no hang.
- 🟡 [painful | evidence: ledger "Task 6: implementer stalled (watchdog 600s)"] **The Task 6 implementer stalled waiting on a background notification.** It resumed after the controller told it to poll in the foreground.
- 🟡 [painful | evidence: plan Task 6 brief line 20 vs design D7] **The plan contradicted the spec on the open-work rule.** The plan was state-based; the spec and design say "takes away". The contradiction surfaced only in review (fix round 95de402..efbd36e). The pre-flight scan checked task against task, not task against spec wording.
- 🟡 [painful | evidence: abb5b7d] **A test checked other workspaces' data** ("existing entries are not new"). Task 1's review flagged it as fragile, but it was deferred. It then failed on the first seeded stack, and fixing it took an extra fix after the final wave.
- 📌 [nit | evidence: f1bf53a, abb5b7d trailers] Two commits carry a "Claude Sonnet 5.5" co-author trailer, from the implementer's own attribution. They were left alone to avoid a force-push.
- 📌 [nit | evidence: verify.md §4] `plan.md` still says `vitally_my_clearance` is `stable`, and still describes the state-based open-work rule. Both are historical drift.

## 3. Plan deviations

| Plan task | What changed | Why |
|---|---|---|
| 3 | Fixed the story's Roster expectation (c26dc55) instead of waiting for Task 11 | A red story across tasks would hide regressions |
| 4 | Also switched `vitally_save_volunteer`'s admin check to the ceiling, and `contact_person` to effective capabilities | Spec: Roster access stays on the ceiling, and every public RPC uses effective capabilities |
| 5 + 5b | One batch, one review | The same files, and it saved a CI database cycle |
| 5 | `vitally_my_clearance` is `volatile`, not `stable` | `require_membership` takes a row lock, and read-only transactions refuse it (25006, CI 43094341618) |
| 6 | The open-work rule refuses only what a save takes away (D7), not the brief's state-based rule | Spec title and design D7; the state-based rule made people unsaveable |
| 6 | Minimal seed fix (9390384) instead of waiting for Task 10 | Keep the `database` job green |
| 6b (new) | The save leaves `uploaded` certificates alone and confirms one when ticked | User decision 2026-11-12, recorded with `/opsx:update` (D14, task 5.4) |
| 8 | Extra "Finish your setup" sidebar link; focus re-check whenever uncleared; `readVolunteers` on the ceiling | Without the link an uncleared admin's Roster is a dead end; the spec says re-check on focus; Roster access stays on the ceiling |
| 9 | "Previously held" roles are read at Save, not at drawer open | That list matches the server's check (user agreed) |
| 10 | Clearing adds to roles and certificates and never removes (58df253) | Spec: "Clearing SHALL change nothing else" |
| 10 Step 3 / 7.2 | Run by the controller on the user's stack after a backup, not by the implementer | The user held this step until 045 was stable |
| Final | Fix wave: docs, four effective-capability tests, focus on becoming cleared, sign-out resets the pending check | Final whole-branch review |

## 4. Skill / workflow compliance

| Skill | Used |
|---|---|
| superpowers:brainstorming | ✓ (in conversation, then `brainstorm.md` at propose) |
| superpowers:writing-plans | ✓ (`plan.md`) |
| superpowers:using-git-worktrees | ✓ (`.claude/worktrees/add-volunteer-clearance`) |
| superpowers:subagent-driven-development | ✓ (ledger, briefs, per-task review, fix loops, final review) |
| (transitive) superpowers:test-driven-development | ✓ (every implementation commit is preceded by a RED commit or a recorded RED run) |
| (transitive) superpowers:requesting-code-review | ✓ (the final whole-branch review used its code-reviewer template) |
| superpowers:finishing-a-development-branch | ✓ (step 9, after archive) |

### Deliberately Skipped Skills

(none)

## 5. Surprises

- **`stable` broke under PostgREST.** A `stable` SQL function that calls `require_membership` (`FOR SHARE`) fails under PostgREST's read-only transaction. Nothing in the plan anticipated it.
- **Green CI hid real defects.** CI was green while three real defects were present: the untick bug, the uploaded-certificate deletion, and the seed deleting extras. In each case the tests asserted only what the brief listed.
- **A CI flake (40001 in `extendTestWorkspace`) appeared once and never came back.** The final review traced the likely cause to the thin retry budget (`tools/admin/database.mjs:44`, 3 attempts at 25/50 ms), not to the branch.
- **The seed's run file belongs to a checkout.** Running `seed:local` from the worktree needed main's `.vitally-runs/seed-<ws>.json` and `.vitally-roster.local.json` copied in; otherwise it would have duplicated cases (`docs/setup.md`).
- **The harness blocks a foreground `sleep`.** Later implementers waited with bounded until-loops instead.

### Ledger summary (every ruling, parked and deferred finding)

**Rulings** (what was decided, and the cost if wrong):

1. Task 4 also moves `vitally_save_volunteer`'s admin check to the ceiling. If wrong: an Intaker with an admin ceiling loses Roster writes.
2. Task 10 clears role accounts before `seedCases`. If wrong: nothing.
3. Database tasks verify through CI while the stack is frozen. If wrong: slower iterations only.
4. Fix the story expectation in Task 3. Cost: one extra story run.
5. `contact_person` uses effective capabilities. If wrong: a one-line revert.
6. Tasks 5 and 5b form one batch. If wrong: a larger review surface.
7. `vitally_my_clearance` is volatile. If wrong: none.
8. Its `capabilities` stay roles ∩ ceiling for a person who is uncleared only by photo ID, and the app keys off `cleared`. If wrong: a one-line change.
9. Minimal seed fix in Task 6. If wrong: Task 10 rewrites a few lines.
10. Open-work rule follows D7 ("takes away"). If wrong: held work could be left without a capability it already lacked.
11. NOT_CLEARED is staff-only English, excluded from the client-language test. If wrong: add a SENTENCES key and run build:hant.
12. Leave the wrong commit trailer. Cost: one inaccurate line.
13. Don't apply 045 locally while it changes (the user agreed). If wrong: slower checks.
14. Keep the "Finish your setup" link.
15. Re-check on focus whenever uncleared.
16. `readVolunteers` uses the ceiling.
17. "Previously held" is read at Save (the user agreed).
18. A 40001 is not dismissed: a repeat counts as a branch defect. If wrong: one fixture change.
19. The final fix wave's scope.
20. Leave as follow-ups: a cleared window doesn't re-read clearance; the own-entry save doesn't re-check.
21. Leave the dead Part 3 copy of `vitally_save_volunteer`, because 045 is already applied on the user's stack.
22. Carry into this retrospective: the Task 6 race, the past-season trigger note, the untick screen-reader announcement, and realtime DELETE events.
23. Convert "existing entries are not new" (the user's choice).

**Parked findings**: none. No fix loop reached the five-round breaker.

**Deferred minor findings** (the final review triaged them all as "leave"; the ones worth tracking are filed as follow-ups):
- **Task 1**:
  - the past-season trigger vs the current-season strip (no past-season rows with roles exist);
  - `missing_certificates(NULL)`;
  - a fragile test (fixed in abb5b7d);
  - a residual race between a new entry and a certificate delete (unreachable in practice);
  - a 100×100 ms lock wait in a concurrency test.
- **Task 2**: staff created with `initializeOwned` are not cleared; `clearStaff` only upserts.
- **Task 3**:
  - the "uncleared reads nothing" list covers 13 of 21 tables (the policy-shape test covers all);
  - the EXPLAIN format;
  - a hard-coded "Rowan Price";
  - a substring role check.
- **Task 4**:
  - per-family effective-capability tests (fixed in a38fb6a);
  - leftover certificates after restores;
  - the replay test doesn't assert the receipt;
  - a test person is left a Greeter;
  - `require_cleared` re-reads `people`.
- **Task 5/5b**:
  - untested edges (past-season-only, null coordinator name, role items for other roles);
  - the `isAdmin` null case (the column is not null);
  - comment wrapping;
  - a digest skip by name.
- **Task 6**:
  - a race between the open-work check and a concurrent claim or assignment;
  - the `jsonb_agg` order;
  - ROLE_NEEDS names only the first role;
  - the dead Part 3 copy;
  - untested photo-ID re-tick and past-season edges;
  - report wording;
  - an open follow-up left on the coordinator in one test;
  - the RED run showed one shared failure.
- **Task 6b**: no test for an uploaded certificate that is sent and needed by a held role.
- **Task 7**:
  - `data: null` gives no clearance (it fails safe);
  - `[...capabilities]` hardening;
  - no `start()` error test.
- **Task 8**:
  - START_SCREENING doesn't route NOT_CLEARED;
  - a save for an older opening drops NOT_CLEARED;
  - a late read after `dropWork` (RLS returns nothing);
  - `forgetUser` reset (fixed in 5052bda);
  - duplicate reads on becoming cleared;
  - no busy state on Check again;
  - an unreachable branch.
- **Task 9**:
  - a season test's name;
  - the parity test covers needs, not labels;
  - the auto-untick is not announced to screen readers;
  - the open-work sentence uses the typed name;
  - an impossible controller fixture.
- **Task 10**:
  - M1: a role account with no profile is skipped silently;
  - M2: the seed output doesn't report clearing;
  - M3: no `finally` in the un-clear test;
  - M4: no-entry insert path untested;
  - M5: the stricter needs map in a unit test;
  - M6: the demo-script wording for Priya.
- **Task 11**:
  - a timing-dependent focus diagnostic;
  - `td.nth(3)` selectors;
  - a duplicated `SETUP_HEADING`;
  - the auto-untick asserts Admin only.
- **Final review, declined to judge**:
  - realtime DELETE events are not RLS-filtered (pre-existing);
  - the roster command bypasses the open-work rule;
  - an Intaker with an admin ceiling opens the Roster;
  - pickers list uncleared people (#139);
  - an uncleared admin reads volunteer contact details (intended bootstrap).

**Follow-ups to file** (as GitHub sub-issues of #138 at PR time, at the user's request):
- A cleared window never re-reads its clearance, so role changes mid-session show only after a reload.
- An uncleared admin who saves their own entry stays on the setup screen until Check again or focus.
- The auto-untick of roles is not announced to screen readers.
- Small items, in one issue:
  - the open-work check vs a concurrent claim race;
  - the past-season trigger note;
  - the dead Part 3 copy of `vitally_save_volunteer` in 045;
  - START_SCREENING not routing NOT_CLEARED;
  - the thin retry budget in `tools/admin/database.mjs` behind the one 40001.

## 6. Promote candidates → long-term learning

- [ ] 🔴 **Every implementer brief carries the hang rules** (a timeout on every command, no foreground server or watch, bounded CI polling, stop and ask for approvals) → **Promote to** schema (the superpowers-bridge apply instruction) or the project CLAUDE.md
  > **Why**: Task 8's first implementer hung for more than 5 hours, and Task 6's stalled on a background wait. Neither happened again once the rules were in every brief.
  > **How to apply**: whenever an apply dispatches an implementer that runs tests or waits on CI.

- [ ] 🟡 **The pre-flight scan checks each task's rule text against the spec's wording, not only task against task** → **Promote to** skill (subagent-driven-development pre-flight)
  > **Why**: Task 6's brief contradicted the spec's "cannot take away", and the contradiction surfaced only in review, which cost a fix round.
  > **How to apply**: during the pre-flight, for every task that states a business rule, quote the spec requirement beside it.

- [ ] 🟡 **A test may not assert on rows outside its own workspace** → **Promote to** memory (type: feedback) and the developer guide's testing notes
  > **Why**: "existing entries are not new" scanned other workspaces, and it broke on the first seeded stack (abb5b7d).
  > **How to apply**: when writing or reviewing a database test, any `workspace_id <> $1` or unscoped scan is a review finding.

- [ ] 🟡 **Seed and migration code that runs against a user's data must be add-only unless the spec says otherwise, and must be checked with a read-only query and a backup first** → **Promote to** memory (type: feedback)
  > **Why**: two review findings (uploaded certificates, the seed deleting extras) were silent data loss that green CI didn't catch, and the user asked for a backup before 045.
  > **How to apply**: whenever a change writes to existing rows (a save, seed or migration), and before running anything on the user's persistent stack.

- [ ] 📌 **Running `seed:local` from a worktree needs main's run file and roster file copied in** → **Promote to** the project docs (`docs/setup.md`, worktree note)
  > **Why**: without them the seed fails (`SEED_ROSTER_UNREADABLE`) or duplicates cases.
  > **How to apply**: on any populated-stack check run from a change worktree.
