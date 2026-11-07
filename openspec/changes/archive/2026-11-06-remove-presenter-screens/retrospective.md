# Retrospective: remove-presenter-screens

> Written: 2026-11-06 (after verify passed with warnings)
> Commit range: `4ae1862..7ef3305` before archive (`main` merged at `efba8db`)
> Worktree: `.claude/worktrees/remove-presenter-screens`

---

## 0. Evidence

- **Commit range:** `4ae1862..7ef3305`, 17 commits after the plan commit. These include 1 merge of `main` (the limit raise, #168).
- **Diff size:** +1113 / −1994 lines across 46 files. The change removes more than it adds.
- **Tasks done:** 21 of 21 in `tasks.md`.
- **Active hours:** about 6, over one day. One of those hours was waiting for #168 to merge.
- **Subagent dispatches:** about 24.
  - 6 implementers, including resumes for fix rounds.
  - 7 task reviews or re-reviews per task.
  - 1 final whole-branch review, 1 fix wave and 1 re-review.
  - 1 builder check at propose.
  - Plus the scoped re-reviews.
- **New external dependencies:** none.
- **Bugs after merge:** none yet, because it isn't merged.
- **OpenSpec validate:** 13 of 13 before archive.
- **Test signal:**
  - `npm test`: 1509 before, 1498 after, all passing.
  - `test:browser`: 83/83 plain, at 785.1 s and 693.8 s.
  - `test:auth-browser`: 20/20.
  - `build:hant -- --check`: clean.

Commit chain:

```
bfaefb8 Presenter: a presenter gets the plain screen and is no longer a staff window
faf4f6f Presenter: one inert guard for every read, save of place and subscription
0c220ac Presenter: remove the presenter panel, its handlers and the inside-the-form note
47b8531 Presenter: a bare English frame for the plain screen; restore live-code tests
1ed52cd Presenter: remove the chosen persona from the controller and the window state
3ac5cae Browser story: replace the presenter steps (#134)
0350e5b Browser story: the in-window switch uses an account no other window holds (#134)
03eadab Docs: the presenter screens are gone (#134)
f128737 Docs: the presenter screens are gone, corrections (#134)
160cd3a Presenter: the no-linked-volunteer sentence and a staff-only case header
501eab7 Presenter: the inert test calls every data load
f740472 Docs and comments: presenter mode is gone from the screens
6d0aeec Tests: tidy-ups from the final review
ffbd9fe Tests: say why the loadWorkspace guard can't be pinned
efba8db Merge remote-tracking branch 'origin/main' into remove-presenter-screens
7ef3305 Presenter screens: tasks done
```

---

## 1. Wins

- **One switch took the presenter out of every staff screen.** `isStaffWindow` and `staffWindow()` became staff-only (bfaefb8). The removals in Tasks 2 and 3 then left nothing a presenter could reach.
- **The inert guard became one helper that every load, save and subscribe passes through** (faf4f6f, then 1ed52cd). The user directed this design. A task review found the first version was leaking reads on focus, back-online and Try again. One test now covers each of those triggers, and another checks the store sees no call at all.
- **No check was dropped silently in the browser story.** Every presenter step was replaced one for one, and the count stayed at 83, with 40 steps per order. Two reviews checked each old assertion against its replacement.
- **The user's test-removal rule caught three live-code tests** that a whole-file removal had swept away: the notice banner, a `describeFocus` check, and the error banner (47b8531). They were restored or converted.
- **Stopping at the time limit paid off.** The 900 s timeout stopped the work instead of trimming the story. That led to #168, and the plain run then passed with room to spare.

## 2. Misses

- 🟡 **The plain screen first shipped inside the client frame.** It had a language switch, Help, a second Sign out and a non-English footer (Task 1). Task 2's review caught it, and it was fixed in 47b8531. Task 1's tests checked the screen's own HTML, but not the page around it.
- 🟡 **The first inert guard sat in callers, not at the entry points** (Task 1). A review traced `refresh()` paths that still read cases. Then the user asked for one guard where every load starts.
- 🟡 **A whole-file test removal took out tests of code that still runs** (`tests/presenter.test.mjs`, Task 2). The user's standing rule followed: name the code a test covers, and prove by grep that it's gone.
- 🟡 **The contact log's sign-out ended another window's session.** Supabase signs out every session of an account. The first story change signed the Site Coordinator out while that account's main window still relied on its session. A fourth account, Quinn Harper, fixed it (0350e5b).
- 📌 **The plan missed docs outside Task 5's four files:** `README.md`, `docs/developer/README.md`, `architecture.md` and `production-roadmap.md`. The final review found them.
- 📌 **The `CHOOSE_PERSONA` sentence survived the design's grep rule, because the views still used it.** The user chose new wording, and a 10th test assertion only turned up in the final review.
- 📌 **The first browser run used a TAP reporter after the plain command stopped.** The plain run's result was redone after #168, as the user required.

## 3. Plan deviations

| Plan task | What changed | Why |
|---|---|---|
| 1 | The guard moved from callers to one `inert()` helper inside `loadData`, `loadSelected`, `persistSession` and `subscribe`, with tests per trigger. | Task 1's review, and the user's direction. |
| 2 | The presenter screen renders in a bare English frame: `page()` returns only the body, and `viewLang` returns "en". | Task 2's review found the client frame wrapped around it. That was Task 1's gap, folded into Task 2. |
| 2 | Three tests were restored or converted. | The user's standing rule: their code still runs. |
| 3 | T3-GUARD: `loadList`, `loadWorkspace` and `loadAssistance` also got the `inert()` return, and `inert()` replaced `presenter()`. | The user asked that no future reload path could miss the guard. |
| 3 | `views.mjs` and `app.mjs` changed, to read `principal.personId`. | Needed so `selectedPersonId` could leave `src/`. |
| 4 | The in-window switch uses a fourth account, Quinn Harper (`switch_admin`), not the Site Coordinator. | Supabase's sign-out is global. This was the user's option C. |
| 4 | `signInPresenter` was added. The presenter stores no window state, so it can't use `loginTestUser`'s check as is. It later became `loginTestUser(…, windowState: false)`. | The fix wave, for the 30 s wait. |
| (final) | The sentence becomes "This account isn't linked to a volunteer yet. Ask your site coordinator.", and the case header is staff-only. | User decision, plus the final review. |
| (final) | The T3-GUARD test calls the three loads directly. The `loadWorkspace` guard can't be pinned, so the user kept it with a test comment (option 1). | User decision. |
| (process) | The browser run waited for #168, the 1200 s limit, a separate tests-only PR. | The user's 900 s rule: stop and show the timings, trim nothing. |

### Rulings made during apply (from the ledger)

1. **Accept the intermediate red after Task 1.** The plan named it. The failures were listed, and the branch was green from Task 3 on. Cost if wrong: one red commit in history. The final review agreed.
2. **Put the three data loads behind `inert()` in Task 3.** This followed the user's "one guard" direction. Cost if wrong: three early returns. The final review agreed.
3. **Fold the presenter-frame fix into Task 2.** Those were Task 2's files. Cost if wrong: none. The final review agreed.
4. **Replace `CHOOSE_PERSONA` in the final fix wave.** The user then set the wording to "volunteer". The final review agreed, and added the 10th assertion and the dead case-header branch.
5. **Keep the `loadWorkspace` guard with a comment (option 1).** This was my stated default, after the user said "go ahead" without choosing. It was a comment-only commit, which I checked myself. Cost if wrong: switching to option 2 or 3 later.

### User decisions recorded

- **A standing rule for unit tests:** before removing a test, name the code it tested and confirm that code is gone. Otherwise rename or convert the test. It applies to #135 and #136 too.
- **The 900 s rule:** stop and show the per-step timings, and trim nothing. The limit went to 1200 s in #168.
- **Option C, then A:**
  - a fourth account for the in-window switch;
  - the limit PR first;
  - then the plain run, after merging `main`.
- **The new sentence:** "This account isn't linked to a volunteer yet. Ask your site coordinator."
- **Waiting for #135:** the stale "Presenter-only" comment (`src/controller.mjs:298`) and the orphaned `CHECKPOINTS` export.

### Minor findings left as they are (triaged "leave" by the final review)

- `presenterScreen` ignores its `state` argument.
- Task 2's first tests were written after the removal, so they had no RED step.
- The Add a case fill-pill test duplicates `office-views.test.mjs:1135`.
- Overlapping staff-start tests were kept.
- Task 4's report overstates the claim-phase check. The code checks the stage, which is enough.
- The screenshot name `staff-board-eight-cases` is inaccurate. The plan set it.
- There are two trailing-period style points in `frontend.md`.

### Out-of-scope notes for #135

- `docs/developer/README.md:162` says "the counter a reset moves".
- A comment at `tests/browser.mjs:8060` mentions "Acting as". It only asserts that the text is absent.
- `src/supabase-store.mjs:749-756` still wraps `vitally_reset_fixtures` and `vitally_load_checkpoint`, tested in `tests/store.test.mjs`.
- `tests/database-fixtures.mjs`, `database-contacts.mjs` and `database-client-numbers.mjs` call both functions through `f.presenter`.
- The client-facing "Sample cases were reset." notices are kept.

## 4. Skill / workflow compliance

| Skill | Used |
|---|---|
| superpowers:brainstorming | ✓ (brainstorm.md, with the builder check) |
| superpowers:writing-plans | ✓ (plan.md) |
| superpowers:using-git-worktrees | ✓ (`.claude/worktrees/remove-presenter-screens`) |
| superpowers:subagent-driven-development | ✓ (ledger, task reviews, fix rounds, final review, fix wave) |
| (transitive) superpowers:test-driven-development | ✓ (RED then GREEN in each task. Task 2's first absence tests were the one exception, noted above.) |
| (transitive) superpowers:requesting-code-review | ✓ |
| superpowers:finishing-a-development-branch | ✓ (push and PR, after archive) |

### Deliberately Skipped Skills

(none)

## 5. Surprises

- **Supabase's `signOut()` is global.** One window's sign-out ended every session of that account, in other windows too.
- **A screen can be right in its own HTML and wrong in its frame.** `page()` added a client header and a language-following footer around the presenter screen.
- **Speed depends on the staff engine.** The second seed run took 47.6 s with Firefox staff and 11.8 s with Chrome staff in one run, then 10.9 s and 12.1 s in the plain run. It's noted on #126.
- **Two guards can't both be tested when one sits in front of the other.** `loadWorkspace`'s `inert()` return is followed by a staff-only check that also returns for a presenter.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **Test a removed or changed screen through the full page render (`page()`), not only its own function.** → **Promote to memory** (type: feedback)
  > **Why:** the presenter's plain screen passed its own tests while the client frame around it broke the spec.
  > **How to apply:** whenever a change adds or replaces a whole screen, add a framed-output test with every language setting.
- [ ] 🟡 **In browser tests, a sign-out ends the account's sessions in every window.** → **Promote to memory** (type: feedback)
  > **Why:** the contact log's in-window switch ended the main Site Coordinator window's session.
  > **How to apply:** sign out only an account that no other open window uses.
- [x] 🔴 **Before removing a test, name the code it tested and prove by grep that the code is gone.** → **Promoted to memory** (`test-removal-needs-removed-code`)
  > **Why:** a test of live code went out with a whole-file removal.
  > **How to apply:** every removal change, including #135 and #136.
- [ ] 📌 **When a plan removes a named thing, grep the whole repo's docs for it, not only the files the plan lists.** → **One-off** (record only)
  > **Why:** four docs outside Task 5's list still described presenter mode.
  > **How to apply:** in writing-plans for removal changes.
