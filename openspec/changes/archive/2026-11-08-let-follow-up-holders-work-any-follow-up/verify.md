# Verification Report

**Change**: `let-follow-up-holders-work-any-follow-up`
**Verified at**: `2026-11-08 03:35`. Report claims re-checked at 04:00.
**Verifier**: Claude Code, the controller of the subagent-driven apply. The `openspec-verify-change` skill isn't installed, so I ran the checks directly.

The judgment checks (sections 4 and 8) used a read-only workflow of 40 agents:
- four checkers: design against specs, each scenario against its tests, each SHALL against the code, and docs that are now false;
- one to three skeptics per finding, each trying to refute it.

Two more agents then checked this report's claims against the logs and git, and their corrections are in.

PRECHECK:
- 11 commits on the branch since `main` (`3697f72`);
- 17 ticked tasks in the committed `tasks.md`, and 18 with the 6.1 tick that goes into the same commit as this report.

Both are positive.

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`

**Result** (run on `bd092ea`):

```text
13 items, 13 passed, 0 failed (1 change, 12 specs)
```

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (18 of 18). See the 6.1 row below for what its tick means.

How the checks were met. The fresh runs were on 2026-11-08, with the stack at 042.

**Unit and database suites:**
- **`npm test`:** 1500/1500 on `bd092ea`. The count is unchanged by verify's fixes, which added one assertion to an existing test.
- **`npm run test:database`:** 448/448, alone on the stack.
  - It ran on the tree that became `0bab775`, with the fixes written but not yet committed.
  - It was 446/446 on `8814483`.
  - The 2 new subtests come from verify's fixes (section 8).

**Generated files and specs:**
- **`npm run build:hant -- --check`:** clean.
- **`npm run build:intake`:** wrote nothing new ("the newest catalogue migration already records this catalogue").
- **`npx openspec validate --all`:** 13/13 on `bd092ea`.

**6.2:**
- `origin/main` is still `3697f72`, an ancestor of HEAD.
- There is exactly one `042_*.sql`.
- #136 is an open issue with no pull request, so nothing merged in between.

**`npm run test:auth-browser`:** not run. Sign-in itself doesn't change, only the roster command and the database's refusals, which the unit and database suites cover (`brainstorm.md`, Verification).

**6.1 `npm run test:browser`:** run four times on the branch and once on `main`'s code, never fully green.
- The attempts during apply all failed at Firefox launch (ledger, R5).
- The code each step works on that this change touches passed in every order that reached it.
- Step 16 failed once as a whole, in run 4, after its go-over part had passed.

See below.

### Browser story

**How it ran.** Playwright's Firefox can't launch from any process the Claude desktop app starts. That covers the agent's shell, with the sandbox on or off, and the app's Terminal panel.
- Firefox quits with "Could not find profile folder." because macOS refuses those processes access to the installed Firefox.app's data folder: `~/Library/Application Support/Firefox` gives "Operation not permitted".
- Firefox's profile service reads that folder at startup, even when it's given Playwright's temporary profile.
- Environment variables don't matter: even a minimal environment fails.
- Each run below therefore used a preload, outside the repository and passed as `NODE_OPTIONS=--import=…`. It adds `--override <ini>` to `firefox.launch`, with `[App] Profile=Playwright Firefox`. Firefox then keeps its data folder under that name, and still uses Playwright's own temporary profile.
- The story code is unchanged: no repository file was edited for this.
- The plain command worked on 2026-11-07, for `remove-sample-case-tools`.

| Run | Code | Alone on the stack | Chrome client, Firefox staff | Firefox client, Chrome staff |
|---|---|---|---|---|
| 1 | branch `8814483` | No: verify's 40-agent workflow was running throughout | Steps 1–22 pass. Step 23 (Save & exit) finds the client window already closed, after 3.5 ms ("Target page, context or browser has been closed") | Steps 1–17 pass. Step 18 fails (two simultaneous claims) |
| 2 | branch `8814483` | Yes. It started 13 s before that workflow ended | Steps 1–17 pass. Step 18 fails | **40/40**, 557 s |
| main | `origin/main` `3697f72`'s code, unpacked with `git archive`. It ran against the same stack, at 042, which doesn't touch claims | Yes | **40/40**, 570 s | Steps 1–17 pass. Step 18 fails, and neither window was told anything |
| 3 | branch `bd092ea`, Chrome-client order only | Yes | Steps 1–17 pass. Step 18 fails | not run |
| 4 | branch `bd092ea`, Chrome-client order only, also set to skip step 18 to reach steps 23–40 | Yes | Steps 1–15 pass. Step 16 (the office records signing and e-filing) times out after the click: the "Mark ready to e-file?" dialog never opens. The run stopped before step 18, so the skip had no effect and the run added nothing beyond run 3 | not run |

**Where the changed code is reached:**
- **Step 8**, "the Site Coordinator logs a contact on the task and resolves it": passed in all six branch orders.
- **Step 16** opens by resolving the go-over task:
  - That part passed in all six branch orders.
  - The step as a whole passed in five of the six. Run 4's failure came later, at the signing row's "Mark ready to e-file" dialog.
- **Step 37**, "a claimed case is withdrawn by the client, and the office is told": the office resolves the withdrawal notice from the Withdrawn row. On the branch it ran only in run 2's Firefox-client order, where it passed. On `main` it passed in the Chrome-client order.
- **The Firefox-client order of run 2:** passed all 40 steps on the branch.

**Why the failures aren't this change's:**
- **The story's viewers see the same page.** The Site Coordinator is the only follow-up holder the story uses, and the assignee of every task it works. For the story's viewers, `git diff origin/main..HEAD -- src/` changes text only: the Follow-up panel's note, the queue row's "assigned to" (was "waiting on"), and the volunteer page's "Assigned to", which the Preparer and the Reviewer see. The only code path the diff removes is `followupWork`'s assignee refusal, which can never trigger for the assignee.
- **Step 18 fails on `main` too, and the fault is in the story's check, not the app.** A read-only trace of the code and of `main`'s surviving run evidence found:
  - **The two claims never race.** The database locks the case row, so the second claim waits, fails the revision check, and always gets `CONFLICT` (`038_staff_identity.sql:760-768`, `039_preparer_shaded_fields.sql:527-531`). The same counts held every time: one event, one receipt, one participant.
  - **The app always shows the loser's refusal, and keeps it through realtime re-reads** (`src/controller.mjs:2086-2104`, `:921-923`).
  - **The story's recorder ignores repeats.** It records each distinct text once for the life of a window (`tests/support/story-pages.mjs:554-556`). The Preparer's role window recorded "This case is yours to prepare." in step 6. In `main`'s failing order it had also recorded the identical conflict banner, from an earlier `ESCALATE_CONTACT` retry under load (`retries` in that run's evidence). So whichever way step 18 went, that window could record nothing new.
  - **The step reads too early.** It reads as soon as both windows show the Preparer row (`tests/browser.mjs:3929-3934`). Each window's realtime re-read of the winner's change can draw that row before the window's own reply draws its toast or refusal. On `main`, the fresh second window recorded nothing, although anything it showed would have been new, so it was read before its notice was drawn.
  - **Load sets both up.** It causes the earlier retry that plants the repeated banner, and it widens the gap before each notice.

  The two flaws are proven possible from the code. Which one hit each branch run can't be settled, because those logs are gone. The step's comment that a re-read clears the refusal (`tests/browser.mjs:3901-3904`) is out of date.
- **Steps 16 and 23 each failed once, and their causes aren't established:**
  - Step 16 failed in run 4, the last run, after passing in runs 1–3 and in both of `main`'s orders. The dialog that didn't open belongs to the signing row, which this change doesn't alter.
  - Step 23, a client draft with Save & exit, failed in run 1, the run that wasn't alone. Its client window was already closed when the step began. On the branch it passed in run 2's Firefox-client order, and on `main` in the Chrome-client order.
  - The machine was busy during these runs: a load average of about 5.5, with the camera, audio and Discord in use.

**What isn't covered:** steps 23–40 in the Chrome-client order, on the branch. That range includes step 37's withdrawal-notice resolve. Each of those steps passed on the branch in the Firefox-client order (run 2), and on `main` in the Chrome-client order.

The run logs were in the git-ignored apply workspace, which is deleted after the retrospective (CLAUDE.md, "Where the output goes"). The table above keeps their results.

| Task | Not done because | Blocks archive |
|---|---|---|
| 6.1 is ticked, although `plan.md`'s expected result ("pass") wasn't met | The story ran, and its results are above. The failures that remain don't involve code this change alters, and the one that recurs (step 18) fails on `main` too. The pull request will say so, so a reviewer can ask for a green run first | No |

---

## 3. Delta Spec Sync State

| Capability | Sync state | Notes |
|---|---|---|
| `office-follow-up` | ✗ Needs sync (archive merges it) | ADDED "Anyone with follow-up access works any open office follow-up" and "The office works a go-over follow-up like any other task"; REMOVED "The office works a go-over follow-up like any other" (still at `openspec/specs/office-follow-up/spec.md:65`) |
| `staff-case-work` | ✗ Needs sync (archive merges it) | ADDED "Office follow-up contacts are logged in the contact log by anyone with follow-up access"; REMOVED "Office follow-up contacts are logged in the contact log" (still at `openspec/specs/staff-case-work/spec.md:316`) |
| `sign-in` | ✗ Needs sync (archive merges it) | ADDED "A staff member with follow-up access also has admin" |

None of the ADDED names is in `openspec/specs/` yet, and both REMOVED names are. That's the expected state before archive.

---

## 4. Design / Specs Coherence Spot Check

| Sample | Design | Specs | Gap |
|---|---|---|---|
| D1 | `lock_open_followup` checks only that the task is on this case (else `FORBIDDEN`) and open (else `INVALID_TRANSITION`) | office-follow-up "Anyone with follow-up access…" (other holder, Sam's task, another case, resolved task); staff-case-work (other holder logs; a resolved task takes no more contacts) | None. The one untested input, a task id that exists nowhere, now has a test (section 8). A cancelled task was already tested after closure (`tests/database-assistance.mjs`, "every case action after closure is an invalid transition"), and `0bab775` adds one on an open case |
| D2 | `followup` requires `admin`: the roster, `add_staff_member` and `people_followup_needs_admin` | sign-in, all four scenarios | None. 042's `add_staff_member` differs from 038's by the one `-- 042` line |
| D3 | Two people on one task: a stale resolve is `CONFLICT`; after a re-read it's `INVALID_TRANSITION`; both contacts are kept | office-follow-up "Two follow-up holders on one task" | None |
| D4 | The browser follows the database: no assignee refusal, "Assigned to" kept, the new note, "· assigned to" in the queue row, "Assigned to <name>" on the volunteer page | staff-case-work (four scenarios); office-follow-up "The row names the assignees as a label" | None |
| D5 | The rules go in a general office-follow-up requirement; REMOVED + ADDED under new names; a separate sign-in requirement | The three delta specs | None. `openspec validate --strict` passes |
| D6 | #136 coordination; 042 can be re-run | (process) | None |
| D7 | Tests for every purpose, done by a non-assignee | All scenarios | Closed by verify's fixes (section 8) |
| Rollback | A new migration undoes 042 | (process) | Fixed: the rollback now also names `add_staff_member` and the roster (`bd092ea`) |

**Drift warnings** (non-blocking):

- The canonical `office-follow-up` Purpose says the capability covers tasks "not tied to a document request". The general requirement it gains covers those too, and archive doesn't rewrite a Purpose. I'll reword the Purpose in the archive commit.
- The staff-case-work delta repeats a SHALL for the volunteer page's note, which this change doesn't alter ("Contacts for an office task are logged on the office screens…"). It's harmless: the text exists and is tested.
- The volunteer-page scenario names "Sky Chen (site coordinator)", from the example roster. The unit test renders the same template with "Sam".

---

## 5. Implementation Signal

- [x] No unstaged code. This report and the 6.1 tick in `tasks.md` go into the verify commit. Otherwise only the untracked `node_modules` link to the main checkout shows.
- [ ] Every related commit is pushed. Finish (step 9) pushes the branch.

**Commit range:** `3697f72..bd092ea`, 11 commits, from `798dd3e` to `bd092ea`.

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md 2>/dev/null
```

- [x] No files, or the files that exist predate the schema install

There are 8 files, all historical design documents from parts 1–4d. CLAUDE.md keeps them as history, and this branch adds none (`git diff --name-only origin/main..HEAD -- docs/superpowers` is empty).

| File | Captured in the change | Action |
|---|---|---|
| — | — | — |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no `[~]` rows, so this section is empty. The one check that didn't run in full is in section 2: steps 23–40 of the Chrome-client order. Each passed on the branch in the other order.

---

## 8. Findings from the verify pass, and what was done

22 findings survived the skeptics: 4 warnings, 18 notes. Some checkers found the same thing, so they merge into the 17 rows below. 2 more findings were refuted. None was blocking.

| Finding | Severity | What was done |
|---|---|---|
| The "keeps their earlier capabilities" check ran after the `finally` had restored Riley | warning | Fixed in `0bab775`: the check now runs straight after the refused write |
| "Review attempt unchanged" was never asserted for a resolved go-over (carried over from the canonical scenario) | warning | Fixed in `0bab775`, in both go-over subtests (`reviewAttempts`) |
| For an admin without follow-up access, nothing asserted that the Resolve button was absent | warning | Fixed in `0bab775` |
| The `office-follow-up` Purpose goes stale after archive | warning | To fix in the archive commit (section 4) |
| No test for a contact on a task id that exists nowhere. A cancelled task was already tested after closure | note | Fixed in `0bab775`: a new subtest, "a missing or cancelled task takes no contact or resolve", which also covers a cancelled task on an open case. Left as is: another workspace's task, which takes the same `not found` branch as another case's task |
| No database test refuses an admin-only person, or an assignee who has lost `followup` | note | Fixed in `0bab775`: a new subtest, "follow-up work needs the capability, not the assignment" |
| The non-assignee go-over test checked only the end state | note | Partly fixed in `0bab775`: it now checks that the plan is `go_over_first` before the resolve, and that the stage and review attempts are unchanged after it. Left as is: a `MARK_READY_TO_EFILE` refusal before the resolve |
| The Rollback didn't name `add_staff_member` or the roster | note | Fixed in `bd092ea` |
| The `RECORD_CONTACT` row gave a rule for an action that is always refused | note | Fixed in `bd092ea` |
| `frontend.md` didn't say who gets the task forms | note | Fixed in `bd092ea` |
| The decision log, the plan and 042's header say "still FORBIDDEN" without splitting contact from resolve | note | Left as is. The decision log and the plan are history. 042 is applied, and its line is true of `lock_open_followup` itself. The design, specs, docs and tests all say a resolve is `VALIDATION` |
| A SHALL for the volunteer page's unchanged note; the scenario's name differs from the test's | note | Left as is (section 4) |
| A go-over resolved by a non-assignee is checked only through the database action | note | Left as is: the offer reads `goOverOpen`, not who resolved. The story covers only the assignee's resolve |
| Unit fixtures still model follow-up-only people (`tests/staff-views.test.mjs:1690`, `tests/intake-catalogue.test.mjs:199`) | note | Left as is: they test rendering and contact visibility. To tidy if those tests are touched again |
| The roster test doesn't show that no account is created; parsing comes before any write | note | Left as is: true by structure (`roster.mjs:244` before `:250`) |
| The go-over queue and case-page checks are loose (older tests) | note | Left as is: they predate this change |
| `extendTestWorkspace` doesn't mirror the new rule | note | Left as is: the database check refuses such a write anyway, and no caller makes one |

---

## Overall Decision

- [ ] ✅ PASS — ready for finishing-a-development-branch and archive
- [x] ⚠️ PASS WITH WARNINGS — ready for the next steps, with these to note:
  - **The browser story isn't green in any single run.**
    - Step 18 (simultaneous claims) also fails on `main`. Its fault is in the story's check, not the app: the recorder ignores repeated notices, and the step reads too early.
    - Steps 16 and 23 each failed once, for causes that aren't established, in code this change doesn't alter.
  - **Steps 23–40 never ran in the Chrome-client order on the branch.** That includes step 37, the withdrawal-notice resolve. They passed on the branch in the Firefox-client order and on `main` in the Chrome-client order.
  - **Firefox needs a workaround inside the Claude app.** It only launches there with the `--override` preload.
  - **The `office-follow-up` Purpose** is to be reworded at archive.
- [ ] ❌ FAIL — return to the failing artifact, fix it, and verify again

**Next:**
1. Write `retrospective.md`, then delete the apply workspace.
2. Merge `main` (no new commits) and archive.
3. Reword the `office-follow-up` Purpose in the archive commit.
4. Push the branch and open the pull request. It notes the story results and that the shared stack runs 042.
