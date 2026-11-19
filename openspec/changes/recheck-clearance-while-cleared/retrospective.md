# Retrospective: recheck-clearance-while-cleared

> Written: 2026-11-19 (after verify passed with warnings)
> Commit range: `2a305a9..c72b0f9` (archive commit follows)
> Worktree: `D:/dev/vitally-190`, branch `recheck-clearance-while-cleared`

---

## 0. Evidence

- **Commit range:** `2a305a9..c72b0f9` (12 commits after the planning commit)
- **Diff size:**
  - +989 / −83 lines across 17 files in total;
  - of which code, tests and docs: +849 / −65 across 15 files (`src/controller.mjs`, `src/role-gates.mjs` (new), `src/app.mjs`, `src/views.mjs`, `src/admin-views.mjs`, `src/office-views.mjs`, `src/staff-views.mjs`, `src/workload-views.mjs`, 5 test files, 2 developer docs).
- **Tasks done:** 18/18.
- **Active hours:** about 4.5. Planning was written and committed at 2a305a9; the CI run finished at 09:22 UTC.
- **Subagent dispatches:** 15.
  - 4 implementers (Tasks 1–4), plus 2 resumes for fix rounds;
  - 4 task reviewers and 2 scoped re-reviews;
  - 1 final whole-branch review (opus), 1 fix wave and 1 re-review.
  - Task 5 (checks only) had no seat (ruling R6).
- **New external dependencies:** none.
- **Bugs encountered post-merge:** none yet (not merged).
- **OpenSpec validate state at archive:** pass (19/19; this change is valid under `--strict`).
- **Test coverage signal:**
  - `npm test`: 2019 → 2071 tests, 0 fail. +52 tests; no test removed.
  - Four existing tests were changed on purpose, each tied to a spec contract (§3).
  - CI run [44491893984](https://github.com/jin-yu-yang/vitally/actions/runs/44491893984): all 5 jobs green on the first attempt. Story: 49/49 per leg, in 550 s and 572 s.

Commit chain:

```
2a305a9 OpenSpec change recheck-clearance-while-cleared: planning artifacts (#190)
380ac80 Clearance: a cleared window re-reads it on focus, visibility, online and reconnect (#190)
d762367 Clearance: a wake refresh stops if the user left while its check was out (#190)
b345c82 tasks 1.x done
df372cc Clearance: FORBIDDEN/INELIGIBLE and one's own Roster save re-read it while cleared (#190)
2c006a4 tasks 2.x done
e3f96ef Clearance: a cleared re-check redraws only on a change, and All cases falls back to the work board (#190)
1f309af tasks 3.x and 4.1 done
eec9abd Clearance: dialogs and Add a case swap their submit when a role is gone (#190)
0c516fe Clearance: close-unsigned dialog receives the real state; test every capability dialog through dialog() (#190)
46c62e5 tasks 4.2-5.x, 6.1, 6.3 done
c1505df final review fixes
c72b0f9 verify (CI run 44491893984 green) and task 6.2
<archive commit>
```

---

## 1. Wins

- **Checking each dialog's RPC during the brainstorm paid off.**
  - The user asked that every drawer's RPC be confirmed against the migrations (ceiling vs effective) before propose.
  - The table that came out of that check (brainstorm Q3; design D5) became `src/role-gates.mjs` unchanged. No task review found a dialog in the wrong category.
- **One table plus a test that reads the source kept the swap honest.**
  - The "every dialog is classified" test reads `src/views.mjs`.
  - The 13 tests that drive `dialog()` (0c516fe) caught `close-unsigned`, which had never been gated because its body received a stripped state object.
  - Without that test, the task's own unit tests passed while one of the thirteen dialogs was never swapped.
- **The pre-flight scan found a real cross-task conflict before any code was written.**
  - Task 2's test would have asserted "no redraw", which is Task 3's quiet path (ruling R1).
  - Without the scan, Task 2 could only have passed by doing part of Task 3.
- **The reviewer's sign-out race was real, and a stronger test caught it.**
  - d762367: the original test asserted only `principal === null`, which held even with the bug. The strengthened test failed with `2 !== 1` before the fix.
- **The CI story stood in cleanly for the local stack** (the user's call): every job passed on the first attempt, on the exact commit being verified.

## 2. Misses

- 🟡 **[painful | evidence: eec9abd → 0c516fe]** Task 4's first pass shipped one gated dialog that never locked.
  - The brief listed swap sites per body, but did not require a test through `dialog()`.
  - The per-task review caught it. The plan should have specified the `dialog()`-level test from the start, since that is where `state` is built.
- 🟡 **[painful | evidence: verify.md §7]** The locked line's layout has never been seen on screen.
  - The story never revokes a role mid-session, so no screenshot shows the line inside a drawer form or Add a case's bar.
  - Follow-up: look at a locked Log call drawer and a locked Add a case page in a local browser, or add a story phase that narrows a role.
- 📌 **[nit | evidence: 380ac80]** Task 1 loosened an exact feed-count assertion (`> reads`) to absorb a temporary double read. Task 3 restored it (e3f96ef), but only because the controller carried a note forward.
- 📌 **[nit | evidence: final review minor 4]** A failed wake check still reads the feed twice, once in the catch path and once in the refresh. Left as is: it happens only on failure and is cheap.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| 1 | Added a same-user guard after the wake check (d762367). | Task review: a sign-out during the check let the refresh read lists for a signed-out window. |
| 1 | Two existing tests changed: a posted-updates reconnect count (loosened, then restored in Task 3), and a focus test renamed to expect 2 calls. | A cleared window now asks on focus. Spec: "A cleared window re-reads its clearance on wake events". |
| 2 | One more existing test changed: "an early check that already finds them cleared needs no second one" now expects +1 (ruling R5). | Spec: own-row save re-reads "whether or not they were cleared". |
| 2 | The planned test split was done as written (someone else's row still asks for none; one's own row while cleared asks once). | Spec contract change. Nothing removed. |
| 4 | `followupForms`, `resolveHelpDrawerBody` and `renderAddCaseV2` skip their early `explain()` when locked. The final review then narrowed this to "only when the capability alone blocks it" (c1505df). | Keep typed text without hiding a real refusal reason such as "This task is already resolved." |
| 4 | `close-unsigned` now receives the full state (0c516fe). | It was never gated (§2). |
| 4 | "Log contact" is a plain button, not a `caseSubmit`; it is swapped too. | Found while implementing. |
| Final | Fix wave c1505df: non-office Add a case label ("ADD A CASE", "Back to the work board"); hidden confirm step on a locked Add a case; malformed clearance answer → SERVER_ERROR (never rejects); `frontend.md` and README module list; two guard tests. | Final whole-branch review minors 1, 2, 3, 5, 6, 7 (ruling R7). |
| 5 | Checks run by the controller, not a subagent; story via CI at verify. | Rulings R4 and R6. |

## 4. Skill / workflow compliance

| Skill | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming | ✓ (method in the conversation; the skill was invoked in propose to record brainstorm.md) |
| superpowers:writing-plans | ✓ |
| superpowers:using-git-worktrees | ✓ (sibling worktree `D:/dev/vitally-190`, the project's convention) |
| superpowers:subagent-driven-development | ✓ |
| (transitive) superpowers:test-driven-development | ✓ (RED/GREEN evidence in every task report) |
| (transitive) superpowers:requesting-code-review | ✓ (per-task reviews and a final opus review) |
| superpowers:finishing-a-development-branch | ✓ (lifecycle step 9, after archive) |

### Deliberately Skipped Skills

(none)

### Ledger summary (rulings, deferred minors, parked findings)

The SDD ledger is not committed and is deleted after this retrospective. Everything it recorded:

**Rulings**
- **R1:** Task 2's assign test doesn't assert "no redraw"; Task 3 owns quietness.
- **R2:** A FORBIDDEN answer to the clearance read itself shares the pending check, with no second request; a test pins it.
- **R3:** The controller ticks tasks.md per task after a clean review; 6.2 waited for CI.
- **R4:** The CI story runs at verify. The controller pushes the branch and runs `gh workflow run ci.yml --ref …`.
- **R5:** The "early check already cleared" test now expects one more check (spec-mandated).
- **R6:** Task 5 (checks only) has no implementer or reviewer seat.
- **R7:** One final fix wave for minors 1, 2, 3, 5, 6, 7. Minor 4 is left; the roadmap line goes to its own docs PR.

**Parked findings:** none. No fix loop reached the cap; Task 1 and Task 4 each needed one round.

**Deferred minors, fixed later in the cycle**
- Task 1's loosened feed count was restored in Task 3.
- The no-FORBIDDEN-action test and the `isAdmin`-only flip test were added in c1505df.
- The layout check is now a follow-up (§2).

**Deferred minors left as they are** (the final review triaged each as fine to leave)
- long name of the renamed focus test;
- the `onVisible` ternary;
- the `staffWindow() !== wasStaff` guard (looks unreachable but is harmless);
- the catch path's `readFeed` without `same()` (`readFeed` guards itself);
- the uncleared-FORBIDDEN test doesn't assert the refusal reached `noteFailure`;
- the opaque `release(unchanged ?? …)` in the assign test;
- the Follow-ups, single-flight and "added Preparer role" tests are regression guards;
- "Fill fictional details" stays on a locked Add a case;
- a staff person who never had admin, restoring a session onto Add a case, now sees the form and the line instead of a fallback (fits the spec; say so in the PR);
- `state.unticked` is dead state (out of scope);
- double feed read on a failed wake check.

**Set aside by the final review as outside the spec**
- losing the ceiling `isAdmin` while on the Roster or Post an update leaves `state.screen` stale;
- the Workload tab stays selected after losing Admin;
- a network "Try again" resends the same envelope after a lock (needed for receipt safety; the server refuses);
- Enter-key submission of a locked form (handlers need the submit button; the server refuses anyway);
- wake latency from the serial clearance read (D1);
- two wake refreshes from focus plus visibility.

## 5. Surprises

- `checkClearance()` was already single-flight, and `recheckClearance` already handled cleared → uncleared. Most of the controller work was choosing *when* to call it and making the cleared → cleared path quiet.
- `noteLocalFailure` reaches `noteFailure`, so a FORBIDDEN on the clearance read itself re-enters `checkClearance()`. It is safe only because the pending promise is still set (R2). Without that, the code would loop.
- Add a case has no button called "Create": "Save draft" and "Send to the office" both start with `vitally_create_case`. The agreed design said "Create" until propose.
- The fake roster store overrides `saveVolunteer`, so Roster failures use `store.failSave`, not `store.failNext` (Task 2 report).
- The story never reaches any locked state, so CI evidence says nothing about the new line's layout.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **When a view gate reads `state`, test it through the function that builds that state** → **Promote to memory** (type: feedback)
  > **Why**: Task 4's body-level tests passed while `close-unsigned` received a stripped state object and was never locked (eec9abd → 0c516fe).
  > **How to apply**: when a plan adds a gate inside view bodies that `dialog()`/`staffScreen()` call, the plan names a test that drives the outer function for every gated case.

- [ ] 🟡 **The story can't show states that need a mid-session role change** → **One-off**, revisit if more role-driven UI lands
  > **Why**: the locked line's layout is unchecked (verify §7). Adding a story phase costs story time, which already runs near half the 900 s limit.
  > **How to apply**: the next change that adds role-driven UI either adds one story phase that narrows a role, or states in verify that its layout was checked by hand.

- [ ] 📌 **Pre-flight scans should look for assertions owned by a later task** → **One-off** (the SDD pre-flight already covers it; it worked here)
  > **Why**: R1 avoided Task 2 implementing part of Task 3.
  > **How to apply**: no change needed.
