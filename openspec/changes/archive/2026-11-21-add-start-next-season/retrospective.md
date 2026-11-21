# Retrospective: add-start-next-season

> Written: 2026-11-21 (after verify passed with warnings)
> Commit range: `7e06662..ee8fb5b`, plus the verify, retrospective and archive commits
> Worktree: `D:/dev/vitally-start-next-season` (branch `add-start-next-season`)

---

## 0. Evidence

- **Commit range**: `7e06662..ee8fb5b`, 27 commits:
  - 1 planning commit;
  - 8 migration/test commits;
  - 4 front-end commits;
  - 6 fix commits (Task 5's fix round, R9, R10, the released channel, the inventories, the final wave);
  - 1 test and docs commit;
  - 7 task ticks.
- **Diff size**: +3307 / −45 lines across 36 files. The largest new files are `supabase/migrations/055_start_next_season.sql` and `tests/database-start-next-season.mjs`.
- **Tasks done**: 26/26 (`grep -c '^- \[x\]' tasks.md` → 26).
- **Active hours**: apply took about 3.5 hours on 2026-11-21, from 02:07 to 05:31 New York time (commit timestamps). Explore, brainstorm and propose came earlier in the same session.
- **Subagent dispatches** (counted from the ledger): about 19 fresh dispatches and 4 resumed rounds.
  - Fresh: 7 implementers (opus for Tasks 1, 3, 5 and 7; sonnet for 2, 4 and 6), 7 task reviews, 1 scoped re-review (Task 5), 1 final whole-branch review (opus), 1 final fix wave and 1 re-review of the wave. A builder check ran at brainstorm.
  - Resumed: Task 1 after R4 and R5, Task 5 fix round 1, and Task 7 after R9 and after R10.
- **New external dependencies**: none.
- **Bugs encountered post-merge**: none yet. This is not merged.
- **OpenSpec validate state at archive**: pass (21/21 before archive; re-run after archive at step 8).
- **Test coverage signal** (CI run 44894866791, against main run 44878374227):
  - unit 2220 → 2253 (+33);
  - database 838 → 860 (+22);
  - browser 51 → 52 per story leg. The story took 590 s (chrome-client) and 595 s (firefox-client), against the 900 s limit.

Commit chain (in order):

```
6eaa1e8 Plan Start next season (OpenSpec change add-start-next-season) (#240)
78f8f7e Test: past-season cases are read-only
5c39c92 055: past-season cases are read-only
48499c5 Test: the shaded-fields season bound runs on a current-season case; a past-season save is refused
5be261d Test: open work ignores past-season cases; capabilities_before_052 is dropped
5859b42 055: open work counts only current-season cases; drop capabilities_before_052
6aeca25 Test: Start next season refusals, rollover, retry and kept default
dd1b62b Test: the older-season case moves the workspace season, not the case
8ffcdef 055: vitally_start_next_season
dc23e29 Test: the catalog lists vitally_start_next_season
3150668 Staff windows load only the current season's cases
3991181 Season settings: Start next season
235d55c Start next season: a start that landed unseen closes the dialog
f3d1950 Exit Form tax year is the season − 1
d49f6d7 Story assertion, Start next season browser test, docs
f74cc8a Database inventories name vitally_start_next_season
1d9a95c A deactivated window shows no access when it wakes
80dcc91 A deactivated window shows no access on its next wake
aee7513 A released channel's close is not a lost connection
ee8fb5b Final review fixes: no-key-update workspace lock, wake wording, season_starts grants, tests and docs
(task-tick commits omitted: 3643d99 9e13c89 1e7ac82 15de5c7 00db192 a1566d4 b20451e)
```

---

## 1. Wins

- **The builder check at brainstorm found two design holes before any code.**
  - Accepted cases in `open_work` would have made every returning volunteer undeactivatable. The fix was Q4: count only the current season, then set the season before deactivating.
  - The default follow-up person might not be a site coordinator. The fix was Q5: move them to the starter.

  Both became tested requirements (`tests/database-open-work-season.mjs`, `tests/database-start-next-season.mjs`) instead of mid-apply surprises.
- **A full database sweep in Task 1 (R5) found the only other test the past-season rule broke** (`database-shaded.mjs`) in one CI run (44880488628, 844/844 after R4), before any later task built on it.
- **The Task 5 review caught a season-skipping bug.** If the start landed but the answer was lost, the dialog came back live as "Start the <season+2> season" (fixed in 235d55c).
- **The final whole-branch review caught a deadlock window that no task review could see.** The workspace row's `for update` conflicted with the FOR KEY SHARE that the action-receipt foreign key takes. The fix was `for no key update` (ee8fb5b), made while 055 is still unapplied anywhere.
- **No local Docker, and nothing was lost by it.** `database-quick.yml` (#249) ran RED/GREEN for every database task: 44879728645 → 44880056885, 44881369750 → 44881518623 and 44882264126 → 44882564295. Every check ended on CI.
- **The story stayed untouched apart from one assertion.** The new walk is a separate 10 s test, and the story is at about 590 s.

## 2. Misses

- 🟡 [painful | evidence: ledger Task 7, 1d9a95c → 80dcc91] **The plan assumed an open deactivated window switches to no-access by itself.** A deactivated member gets no realtime (RLS), so nothing reaches an idle window. R9 settled on "on next wake". Then CI showed a second, pre-existing defect: a wake FORBIDDEN reached a generic error, not `showNoAccess`. That cost two extra full CI runs (44887076220, 44888415999) and two rulings. Reading the wake path at planning would have found both.
- 🟡 [painful | evidence: ledger R7] **Plan Task 7 step 6 could not work as written.** A second site coordinator is not on the new roster, so they are uncleared and see "Finish your setup", not the case pool. R7 changed the step so the starter records their own roles. The spec was right, and the plan step had not been traced against clearance.
- 📌 [nit | evidence: run 44889925760] An intermittent failure in the uploads test ("Mark reviewed dropped the typed phone") is off this branch's path. Filed as #254.
- 📌 [nit | evidence: ledger T5-M3] The toast and card wording are the implementer's, and the confirm is a plain primary button because the stylesheet has no danger style. Left for the user at the PR.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| 1 (past-season) | `database-shaded.mjs` converted (48499c5) | R4: with 055 a past-season case is never writable; the 039 bound is still exercised on a current-season case |
| 3 (RPC) | Exclusive table locks on cases, follow-ups and help requests after the advisory lock (8ffcdef) | R6 (from T1-M1): closes the race between a write reading the season and a start. Precedent: `relabel-season.mjs` |
| 3 (RPC) | The older-season test moves the workspace season, not the case (dd1b62b) | 010 forbids changing a numbered case's season |
| 7 (browser) | Step 6: the starter records their own roles, then sees "No cases yet this season." | R7: a second site coordinator is uncleared after the start |
| 7 (browser) | Step 5 regains focus before asserting no-access, plus the controller fix | R9 (wake contract, spec wording changed) and R10 (pre-existing FORBIDDEN path) |
| 7 (inventories) | `database-catalog` and the inventory tests name the new RPC (f74cc8a) | Outside the brief. Needed for the full database run, and accepted in review |
| Final review | One wave (ee8fb5b): `for no key update`, the wake wording in D8 and sign-in-accounts, `season_starts` revoked from service_role, marked `open_work` lines, the draft-numbering note, frontend.md, a Closed-excluded count test, a `lostMembership` comment | FR-I1, FR-I2 and six minors |

## 4. Skill / workflow compliance

| Skill                                            | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming                        | ✓ (brainstorm.md, with a builder check) |
| superpowers:writing-plans                        | ✓ (plan.md, 7 tasks) |
| superpowers:using-git-worktrees                  | ✓ (`D:/dev/vitally-start-next-season`) |
| superpowers:subagent-driven-development          | ✓ (ledger, 7 tasks, final review) |
| (transitive) superpowers:test-driven-development | ✓ (RED/GREEN CI runs recorded for Tasks 1–3; unit RED before GREEN for 4–7) |
| (transitive) superpowers:requesting-code-review  | ✓ (task reviews, final review, scoped re-reviews) |
| superpowers:finishing-a-development-branch       | ✓ (lifecycle step 9: push and PR) |

### Deliberately Skipped Skills

None.

## 5. Surprises

- **The wake FORBIDDEN path was already broken.** sign-in-accounts' existing Deactivate scenario was not met before this change. Only a browser test that deactivated an open window could show it.
- **A released realtime channel reported itself as a lost connection** after `showNoAccess` stopped realtime. That would have shown a reconnect banner on the no-access screen (aee7513).
- **`main` took 054** for #205's migration while this change was being planned, so this change became 055.
- **The fixture's season is 2025,** so the browser test starts 2026. The footer's hard-coded "Tax year 2025" shows in every screenshot. It is part of the user's Before-the-pilot 2025 issue.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **When a spec says an open window reacts to something, check at planning which signal reaches that window.** → **Promote to memory** (type: feedback)
  > **Why**: R9 and R10. The plan said a deactivated window shows no-access, but a deactivated user gets no realtime and the wake path had a FORBIDDEN bug. That cost two CI runs.
  > **How to apply**: for any spec line "every window …" or "the open window …", name the delivery path in design.md (realtime, wake event or reload), and make the browser test drive that path.

- [ ] 🟡 **Trace each browser-test step in a plan against clearance and roles after the action.** → **Promote to memory** (type: feedback)
  > **Why**: R7. Step 6 expected an uncleared site coordinator to see the case pool.
  > **How to apply**: when a plan step follows a role or roster change, write down who is cleared at that step before naming the screen they see.

- [ ] 📌 **Iterating on database tests through `database-quick.yml` works.** → **Already in memory** (`no-local-docker-ci-database-runs.md`); this cycle confirms it.
  > **Why**: RED/GREEN runs for Tasks 1–3, all on CI, with no local stack.
  > **How to apply**: as recorded.

---

## Ledger summary (rulings, parked and deferred findings)

The subagent-driven-development ledger (`.superpowers/sdd/plan/progress.md`) is deleted after this retrospective. It recorded the following.

**Rulings** (all accepted by the user at verify; R9 and R10 were flagged and approved explicitly):
- **R1:** the past-season test uses one staff action and one client action that the fixture already drives (`PUT_ON_HOLD`, `WITHDRAW`).
- **R2:** the rollover's `deactivated` count is read from the fixture before the start, and each named account is checked.
- **R3:** the dialog view test asserts the three statements the spec requires.
- **R4:** `database-shaded.mjs` is converted, not weakened. It adds an assertion that a save after the season moves is refused `PAST_SEASON`.
- **R5:** a full database sweep before Task 1's review.
- **R6:** exclusive table locks during a start. Case, follow-up and help-request writes pause briefly in every workspace (T3-M5), once a year.
- **R7:** in the browser test, the starter records their own new-season roles, then sees an empty case pool.
- **R8:** the browser test was iterated on full CI runs. Failures were reported, not hidden behind a reload.
- **R9:** a deactivated window shows "This account has no access" on its next wake. The spec and D8 were changed to match. At verify, the user added a design risk line: data access ends at once, and only the screen switch waits.
- **R10:** fixed the pre-existing wake FORBIDDEN path. The controller re-reads the principal, then calls `showNoAccess`.

**Parked findings**: none. Every Important finding was fixed (Task 5 I1; final review FR-I1, FR-I2).

**Deferred minor findings**:
- Task 1:
  - M2: the 055 header listed sections ahead of time. Checked at the final review.
  - M3: the help-request test covers CLAIM only. RESOLVE goes through the same check.
  - M4: the draft subtest re-saves the same answers.
- Task 2:
  - M1: there is no test for the reviewer branch, or for a null-season case with a preparer.
  - M3: the subtests share state in order. (M2, the docs, was done in Task 7.)
- Task 3:
  - M1: the null-argument VALIDATION runs before the lock and replay, as `vitally_set_site_coordinator` does. Recorded in verify.md.
  - M2: a leftover new-season roster entry would fail the starter insert with a raw 23505. Only reachable after a relabel.
  - M3: a null default follow-up person and a reused action id with other arguments are untested. The Closed-excluded count test was added in the final wave.
  - M4: a replay also takes the exclusive locks.
  - M5: the trade-off in R6.
- Task 4:
  - M1: the controller restore test covers only the NOT_FOUND path.
  - M2: each staff `listCases`/`getCase` makes an extra workspaces read.
  - M3: an empty workspaces result means all seasons.
- Task 5:
  - M2: a success on a non-staff window focuses a missing button.
  - M3: the toast and card wording, and the plain primary button, go to the user at the PR.
  - M4: `maxlength=4`.
  - FR1-M1: the controller imports `seasonRefusalLines` from a view module.
  - FR1-M2: an in-flight realtime move is seen only through `state.workspace` when the follow-up settings read also failed. A press then gets CONFLICT.
- Task 7:
  - M2: `lostMembership` treats an applicant principal as gone. It is unreachable, and the final wave added a comment.
  - M3: `regainFocusUntil` duplicates the uploads test's helper.
- Final review M3: a draft created before the start and submitted after it gets number 1 in the new season. This is intended, since a draft has no season yet. The final wave made it a test ("a draft from before the start submits as the new season's client 1").
