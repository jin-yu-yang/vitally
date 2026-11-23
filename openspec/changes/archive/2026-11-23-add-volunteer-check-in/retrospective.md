# Retrospective: add-volunteer-check-in

> Written: 2026-11-23 (after verify passed with warnings)
> Commit range: `42c000e..efdfbea`. That is `main` before #273, through the verify commit. The archive commit follows.
> Worktree: `.claude/worktrees/add-volunteer-check-in`, pushed as `origin/add-volunteer-check-in-cc`.

---

## 0. Evidence

- **Commit range:** `42c000e..efdfbea`. 26 non-merge commits are this change's, all tagged `#257`. 3 more are merges: #271's squash recorded with `-s ours`, #272, and #273.
- **Diff size:** +9438 / −226 lines across 68 files. Outside `openspec/changes/` and `docs/`, that is +6081 / −201 across 38 files.
- **Tasks done:** 26/26, including group 7, which the final review added.
- **Active hours:**
  - about 5.5 h of implementation and review, 2026-11-22 20:05 to 2026-11-23 01:42;
  - about 0.5 h on the final-review fixes and the renumber, 06:47 to 07:16;
  - about 3 h of verify, mostly waiting on story runs and CI.
- **Subagent dispatches:** 25.
  - 11 implementers: 9 tasks, the final fix wave, and the merge plus renumber.
  - 14 reviewers: 9 task reviews, 4 scoped re-reviews, and 1 final whole-branch review.
  - About 44% of implementers went to sonnet, the rest to opus. Most reviews used sonnet; Tasks 3 and 6 and the final review used opus.
- **New external dependencies:** none. OpenSpec CLI 1.14.0 → 1.17.0 came in through the `main` merge, not this change.
- **Bugs encountered post-merge:** none yet, since the change isn't merged. One cross-change interaction was found at merge: removal from the roster leaves an open check-in. That is #277.
- **OpenSpec validate state at archive:** `validate --all` gives 25/25. `--strict` gives requirement-length warnings only.
- **Test coverage signal:**
  - `npm test`: 2457 → 2536 tests (+79).
  - `tests/database-check-in.mjs`: 58 cases.
  - `test:database`: 1026 pass, 4 fail locally. The 4 are the known edge-runtime gap.
  - CI [run 45203758327](https://github.com/jin-yu-yang/vitally/actions/runs/45203758327): every job passed.

Commit chain, in time order:

```
9cae9d3 Propose: brainstorm, proposal, design, specs, tasks, plan
ffc6d18 table, counted span, RLS and realtime          (Task 1)
fa19517 self check in and out RPCs                      (Task 2)
49befd3 admin corrections, day read, hours this week    (Task 3)
4430173 store calls and pure helpers                    (Task 4)
df5822b bar placement from the instants                 (Task 4 fix round 1)
ebe7b90 the check-in strip                              (Task 5)
a1846f4 bars, Add check-in and the drawer               (Task 6)
53d08d9 Workload hours from check-ins                   (Task 7)
b8c11dc seed: fictional check-ins                       (Task 8)
20fef39 seed: check-ins on their volunteers' own shifts (Task 8 fix round 1)
1af5b25 seed tests: pin the current week again          (Task 8 fix round 2)
01c927d merge main (#271 squash -s ours, #272)
d81a4cf browser walk and docs                           (Task 9)
64eaa09 /opsx:update: open check-in blocks overlapping corrections
bc62edb final-review fix wave                           (Task 10)
2b5b85b merge main (#273)
f63661b migration 059 → 060
efdfbea verify
```

---

## 1. Wins

- **[evidence: `df5822b`, the Task 4 re-review]** The task reviews caught a real visual bug that the tests didn't. A check-in whose end fell in the same minute as its start drew a full-width bar, because `barPlacement` wrapped by minute of day. It was fixed by measuring from the instants.
- **[evidence: `20fef39`, `1af5b25`]** The seed review traced the seed rules for every weekday and showed that only 0 to 2 of the 4 check-ins matched a shift, against the spec's "Most SHALL match". The old test had a check that always passed. The fix made "today" injectable and covers Mon, Sat and Sun plus the real day.
- **[evidence: `64eaa09`, `bc62edb`]** The final whole-branch review found the one real data bug: an admin-added row next to an open one later overlapped it and double-counted hours. It went to the user, through `/opsx:update`, and was fixed in one wave. That wave also fixed three minors (M14, m6, m7).
- **[evidence: design D2, `ffc6d18`]** Putting the counted end in a single SQL function, `check_in_span`, used by the day read, the hours read and the overlap check, kept the forgotten-check-out rule in one place. It also gave #141 something to reuse.
- **[evidence: `01c927d`]** #271 was squash-merged with a tree identical to this branch's base. I spotted that and recorded it with `-s ours`, which avoided a large false conflict.
- **[evidence: CI run 45203758327]** CI on a pushed branch settled within one run a local story failure that two local runs couldn't explain.

## 2. Misses

- 🔴 **[blocking | evidence: the push rejection on 2026-11-23, `origin/add-volunteer-check-in` at `b15260d`]** A teammate had a second implementation of #257 on a branch with the same name. Neither side found out until my push was rejected at verify. The #257 comment "Almost done" (08:22 UTC) was never read during this change. A CI dispatch then ran on the teammate's branch by mistake (run 45200401045). Resolved: the user and Hailey settled on #257 that this change carries it, and this branch went up as `-cc`.
- 🟡 **[painful | evidence: `f63661b`]** Migration 059 was taken by `main` (#273) mid-change. At propose time 059 was free, and plan Task 1 checked it again then, but nothing checked it before verify. The user caught it. The renumber cost a merge, a stack reset and a full database re-run.
- 🟡 **[painful | evidence: `tests/database-store.mjs`, ruling R3]** Task 1 added `check_ins` to the Realtime publication but ran only its own database file. Two realtime-adapter tests stayed red until Task 4, and the gap was only found at Task 3's full-suite run.
- 🟡 **[painful | evidence: browser runs 1 and 2 on `f63661b`]** The local browser story failed twice at the seed step, because the board kept reloading. Run 1 overlapped with `npm test` and `build:intake`, which was my scheduling mistake. Run 2 ran alone and still failed. CI passed the same commit. The likeliest cause is the two same-day resets that dropped `check_ins` from the publication and added it back, but this is not proven. About 1 h was lost.
- 🟡 **[painful | evidence: Task 2, 3 and 10 reports]** Every edit to 059 after it was applied locally needed a hand-written reset script. The CRLF→LF normalisation after a merge also left a stale digest (MIGRATION_CHANGED at Task 9). That is expected friction for a migration still being written, but it was repeated four times.
- 📌 **[nit | evidence: 5-hour usage limit during Task 5]** One implementer was cut off by the session's usage limit. Resuming it with SendMessage worked cleanly, because the tree was still clean.
- 📌 **[nit | evidence: Task 2 report]** One implementer dispatched a stray subagent while it waited. It had no effect.

## 3. Plan deviations

| Plan task | What changed | Why |
|---|---|---|
| 1 | Added `vitally_policy.is_own_person(ws, person)`, which only answers for the caller | The RLS own-row path needed it. Task 2's review approved the catalog exemption. |
| 2 | Added tests that `vitally_my_check_in` refuses a client and an invited account (R1) | A spec scenario required them and the plan had omitted them. |
| 3 | Absorbed M1 (DST and day-end-24 span tests), M3 (replay after check-out; no receipt for ALREADY_CHECKED_IN) and M4 (one clock, `now()`) | These were carried-over minors from the Task 1 and 2 reviews. |
| 4 | Refusal messages went into `CHECK_IN_REFUSALS` in `src/volunteer-check-in.mjs`; the tests are in `tests/store.test.mjs`; `weekShifts` was kept (R2) | That is the existing pattern (`SHIFT_REFUSALS`). The plan guessed the wrong test file name. |
| 5 | The store's realtime announce adds `personId` for `check_ins` changes only. A `workspaces` change re-reads the strip. The two quiet codes left the message map (M7). | The changes didn't carry `person_id` where the strip needed it. |
| 6 | `role-gates.mjs` `CEILING_DIALOGS` gained the check-in dialogs | A source-scan test requires every dialog to be classified. |
| 7 | `store.weekShifts` was deleted | R2 |
| 8 | The seed adds past-day shifts so the check-ins match (R4). "Today" is injectable. | The spec requires that most check-ins match a shift. See §1. |
| 10 (new) | The OVERLAP rule for an open row today; the "12:00 am (midnight)" option; comment and doc fixes | Final-review finding I1, decided by the user via `/opsx:update` |
| — | The migration was renumbered 059 → 060 | `main` took 059 with #273 |

## 4. Skill / workflow compliance

| Skill | Used |
|---|---|
| superpowers:brainstorming | ✓. The design was settled in conversation (Q1–Q6), and the skill recorded it into brainstorm.md. |
| superpowers:writing-plans | ✓, into plan.md |
| superpowers:using-git-worktrees | ✓. It detected the existing worktree. |
| superpowers:subagent-driven-development | ✓. Ledger, pre-flight scan, 9 tasks, fix loops, final review. |
| (transitive) superpowers:test-driven-development | ✓. Every implementer report carries RED and GREEN evidence. The Task 9 story walk passed the first time, which is noted in its report. |
| (transitive) superpowers:requesting-code-review | ✓. Task reviews, scoped re-reviews, and the final review on the most capable model. |
| superpowers:finishing-a-development-branch | Pending (lifecycle step 9, after archive) |

### Deliberately Skipped Skills

- **`superpowers:brainstorming`, builder-check sub-step**
  - **What was skipped:** the builder-check subagent on the written design.
  - **Why this cycle:** the user had already confirmed every design decision, one at a time, in the conversation (Q1–Q6), before propose. CLAUDE.md §2 step 3 says not to re-ask settled decisions. The check's only output, a "theirs" pile of questions, had nothing left to hold.
  - **How to prevent recurrence:** *scope-judgment rule.* When CLAUDE.md's verbal brainstorm has met all 5 promotion criteria, the builder check is redundant. Still, three of the gaps the reviewers later found came from scenarios the design never enumerated (seed matching by weekday, overlap with an open row, roster removal mid-shift). A builder check might have caught the first two. Next cycle, run it on design.md and send its questions to the user in one batch.

## 5. Surprises

- **That the issue's assignee owns the work.** #257 was assigned to the user, but a teammate was implementing it in parallel under the same branch name.
- **That a migration number checked at propose and at Task 1 stays free.** It didn't: #273 merged the same morning.
- **That a squash merge of the base branch would conflict.** The squash tree was identical, so `-s ours` was exact.
- **That `check_in_span`'s capped end is good enough for overlap.** It isn't. An open row's end is an estimate, and comparing against it let later rows in (I1).
- **That realtime changes carry the row's `person_id`.** Task 5 found that the announce omits it.
- **That a passing local story means the stack is healthy.** After the same-day publication resets, the local story failed on a commit that CI passes.

## 6. Promote candidates → long-term learning

- [ ] 🔴 **Before proposing a change for an issue, read the issue's comments and look for a remote branch with the change's name.** → **Promote to** project CLAUDE.md (§2 lifecycle, step 1 or 2)
  > **Why:** #257 was implemented twice in parallel (`origin/add-volunteer-check-in` at `b15260d`). It was found only when the push at verify was rejected.
  > **How to apply:** at explore or brainstorm, run `gh issue view <n> --comments` and `git ls-remote --heads origin <change-name>`. If someone else is working on it, ask the user before proposing.

- [ ] 🟡 **Re-check the migration number against `origin/main` and the open PRs at every merge of `main`, and before verify.** → **Promote to** project CLAUDE.md (Project rules, Database)
  > **Why:** 059 was taken by #273 between Task 1's check and verify, and the user caught it (`f63661b`).
  > **How to apply:** whenever `main` is merged into a change branch that adds a migration, and again before writing verify.md.

- [ ] 🟡 **An SQL task that adds a table to the Realtime publication runs the full `test:database`, not just its own file.** → **Promote to** memory (type: feedback)
  > **Why:** Task 1's publication change broke two `database-store.mjs` tests, unnoticed until Task 3 (R3).
  > **How to apply:** in SDD implementer dispatches for migration tasks that touch `supabase_realtime`, policies or grants.

- [ ] 🟡 **Never run other suites while the browser story is running, and after same-day migration resets prefer the CI story over a local run.** → **Promote to** memory (type: feedback)
  > **Why:** local runs 1 and 2 on `f63661b` failed at the seed step, one of them while `npm test` ran alongside, but CI passed the same commit.
  > **How to apply:** at verify, when the local stack has had a migration dropped and re-applied that day, or when a story run fails at the seed step with the board reloading.

- [ ] 📌 **Run the brainstorming builder check even when every decision was confirmed verbally.** → **Promote to** memory (type: feedback)
  > **Why:** three reviewer findings were scenarios the design never enumerated (§4).
  > **How to apply:** after writing design.md in propose, before tasks.md.

- [ ] 📌 **Tighten the two overlap database cases' time layout** (shift 0–1, check-ins at 00:00 and 01:00) so they skip only before about 01:31 New York time, not 04:30 (M22). → **One-off** follow-up in a later change
  > **Why:** a skipped test is not a passing one, and CI usually runs outside that window.
  > **How to apply:** the next time `tests/database-check-in.mjs` is touched.

---

## Ledger summary (rulings, parked and deferred findings)

From the subagent-driven-development ledger, which is not committed. Every ruling, parked finding and deferred minor is listed here.

**Rulings**
- **R1:** Task 2 also tests that `vitally_my_check_in` refuses a client and an invited account (spec scenario). If wrong, it costs one extra test.
- **R2:** `store.weekShifts` was kept until Task 7, then deleted. If wrong, it costs nothing.
- **R3:** two realtime-adapter tests were allowed to stay red between Tasks 1 and 4. They are green from `4430173` onward. If wrong, it costs a few red commits.
- **R4:** each seeded check-in uses its volunteer's real shift. Where none exists, a past-day shift is added, recorded and removed on a re-run. If wrong, it costs a few extra seeded shifts in last week.
- **R5:** a volunteer removed from the roster while checked in keeps an open check-in. Not fixed here; follow-up **#277**. If wrong, it costs one stray open row until an admin removes it.
- **#271's squash** was recorded with `-s ours` (identical tree). If wrong, it costs nothing.
- **User decisions:**
  - I1: an open check-in today blocks overlapping corrections (`64eaa09`).
  - The branch was pushed as `-cc` and this change carries #257.
  - #277 was opened.

**Parked**
- none. No finding reached the fix-loop cap.

**Deferred minors.** Fixed means in this change; Left means a follow-up or accepted as is.

| Id | Finding | Status |
|---|---|---|
| M1 | No DST or day-end-24 tests on the derived-end path | Fixed in Task 3 |
| M2 | `check_in_span` reports a future-dated row as missed | Left. The RPCs refuse future times. |
| M3 | No replay-after-check-out test; no test that ALREADY_CHECKED_IN stores no receipt | Fixed in Task 3 |
| M4 | Two clocks in `vitally_check_in` | Fixed in Task 3 |
| M5 | A second open row today could be added | Became final-review I1. Fixed in `bc62edb`. |
| M6 | An edit or removal by id has no current-season filter | Left. The UI can't reach it. |
| M7 | The quiet refusal codes were in the message map | Fixed in Task 5 |
| M8 | `timeOptions` keeps a saved 24:00 when `allow24` is false | Left. Harmless. |
| M9 | `barPlacement` edge tests | Partly fixed in `df5822b` |
| M10 | `barPlacement` NaN without `endsAt`; the start is floored to the minute | Left. Callers always pass `endsAt`, and the flooring is cosmetic. |
| M11 | A DELETE event carries no `personId` | Left. Check-ins are soft-removed only. |
| M12 | A strip press clears any unrelated error banner | Left. Harmless. |
| M13 | The view's today uses the real clock while the controller uses `clock()` | Left (final review). The two are the same in production. |
| M14 | "12:00 am" appears twice in Checked out | Fixed in `bc62edb` |
| M15 | Add's default in-time can be IN_FUTURE before opening | Left (final review). The refusal is clear. |
| M16 | No test that an UNKNOWN_OUTCOME retry reuses the action id on a check-in save | Left. It is the same path as shifts. |
| M17 | `state.weekHours` naming; no test that a failed read keeps the last value; a stale clock in a test | Comment fixed in `bc62edb`; the rest left |
| M18 | With one past open day, all three seeded check-ins share a day | Left. Harmless. |
| M19 | An added past shift can fall earlier in the current week | Left |
| M20 | On a Thursday run the in-week shift count reaches the test's upper bound of 8 | Left. Watch it if the seed grows. |
| M21 | The story's Hours regex also accepts "0"; the viewport is not restored on failure; the bar locator is strict | Left |
| M22 | The overlap database cases skip before about 04:30 New York time | Left. See §6. |
| m4 | An uncleared site coordinator's Schedule doesn't update live on check-ins | Left (final review). It follows D9. |
| m5 | A rare retry can show a stale strip briefly | Left. It self-corrects. |
| m8 | An open bar doesn't grow until the next re-read | Left. By design (D6). |
