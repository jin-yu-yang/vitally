# Retrospective: add-my-profile

> Written: 2026-11-22 (after verify passed with warnings)
> Commit range: `601b650..2d5ce28` (plus the archive commit)
> Worktree: D:/dev/vitally-my-profile (branch add-my-profile)

---

## 0. Evidence

- **Commit range**: `601b650..2d5ce28`. That is 31 commits on the first-parent chain: 2 planning, 26 apply (implementation, fixes and tasks.md ticks), 1 merge of `main` (#245), 1 verify, and the archive to come.
- **Diff size**: +4719 / −80 lines across 43 files, this change's own diff against `origin/main`.
- **Tasks done**: 23/23 (`tasks.md`), across 9 plan tasks.
- **Active hours**: about 4.5. Apply started 2026-11-21 20:11 and the merge with verify finished 2026-11-22 00:37 (New York).
- **Subagent dispatches**: 25.
  - Implementers (11): 9 tasks, 1 debugger and 1 final fix wave.
  - Reviewers (14): 9 task reviews, 3 scoped re-reviews (Tasks 3, 6 and 7), the final whole-branch review and its re-review.
- **New external dependencies**: none.
- **Bugs encountered post-merge**: none yet (not merged).
- **OpenSpec validate state at archive**: pass (23/23 before archive).
- **Test coverage signal** (CI run 44989061530 on the merged commit, against main 4ab301e run 44984606706):
  - unit: 2322 (main 2270);
  - database: 907 (main 866);
  - browser: 53 per leg (main 52);
  - sign-in: 28.

Commit chain (first parent, in order):

```
833eb6a OpenSpec change add-my-profile: planning artifacts (#242, #246)
81b5112 add-my-profile: revise planning after review of 833eb6a
e82c1ed / 12272d7  Task 1: 057 §1–§3 (review columns, usual days, clearance answer, resend clears review)
297e1ed            Task 2: 057 §4–§5 (usual days on the admin save; Mark reviewed takes a reason)
200629e / c389eba / 5a24f88  Task 3: 057 §6–§7 (caller's own read and save) + receipt-scope fix
c831bb2            Task 4: store, Roster review fields, reviewLine
db97bac            Task 5: controller (my-profile screen, save, re-reads)
368b6d4 / 54e382e  Task 6: setup reason line, reason row, Last returned, usual days + Enter fix
40e44cb / 2ab4f07  Task 7: My profile screen and sidebar link + otherLanguage fix
a403f3f            Task 8: browser tests
1d77d77 / 308d9b6  Task 9: docs + test-timing fix for the firefox failure
9ddb2dd            Final review fixes (IME guard, punctuation, drawer sentences, deploy risk, docs, tests)
c54224e            User decision: invited accounts refused before the site check
4d8c26f            Merge main (#245, 056); counts thirty-four RPCs, fifty-seven migrations
2d5ce28            verify.md
```

---

## 1. Wins

- **[evidence: 057 diff vs 053, final review]** Every function migration 057 re-creates is a faithful copy of 053 plus lines marked `-- 057`. The final reviewer diffed all four with a script, and no unintended change surfaced.
- **[evidence: 12272d7]** The CI-only database loop caught a real bug on its first run. The pair check let a reviewed time through with a null reason (`btrim(null)` makes a CHECK pass). Writing database tests without a local fail-first step (R2) still found defects.
- **[evidence: 44980299716 → 308d9b6 → 44982172310 attempts 1 and 2]** The intermittent firefox failure was handled the way the user's rule asks. The evidence was read first, the acceptance rule was set before any rerun, and the fix went into the test without weakening its assertion. The diagnosis also gives a lead for #254.
- **[evidence: 2ab4f07]** The controller checked a review "minor" against the database function and found a real bug: a volunteer who unticked Other could never save. It was promoted to a fix round before the screen shipped.
- **[evidence: 54e382e, 9ddb2dd]** Reviews caught two keyboard paths that unit tests can't see: Enter in the reason note saved the whole drawer, and an IME commit Enter could send back a half-typed reason. Both were fixed and pinned (shell test plus the browser test's Enter step).
- **[evidence: c54224e]** The site-check gap found in the final review went to the user as a scope question, not a silent fix. The user decided to gate it in this change while 057 was still unmerged.

## 2. Misses

- 🟡 **[painful | evidence: Task 8 and Task 9 implementers, debugger]** `gh run watch` was killed for low memory three times (Task 8, Task 9, the debugger), and one subagent stopped mid-wait each time. Light polling (`gh run view` with `sleep 90`) worked every time. The briefs only asked for it from Task 9 on.
- 🟡 **[painful | evidence: 1d77d77, 44980299716]** The new browser test passed its first CI run (44978758079) but had a focus race. It typed into the drawer before the drawer's next-frame focus move. One full CI run (~25 min) went to finding that out.
- 🟡 **[painful | evidence: Task 7 report]** TDD slip in Task 7: the screen was written before its tests ran, so RED for `tests/profile-views.test.mjs` was never captured. The reviewer confirmed that the tests do fail against a wrong page.
- 📌 **[nit | evidence: brainstorm calls, R1 review]** The first draft offered "Not signed" and "Wrong form" for a photo ID, and showed the already-on-file line for any document. The user's review of 833eb6a corrected both (R1, R5) before apply.
- 📌 **[nit | evidence: Task 9 report]** The plan named `docs/developer/production-roadmap.md`, but the finished-items roadmap is `docs/roadmap.md`.
- 📌 **[nit | evidence: tests/database-catalog.mjs on main]** Main's read-only RPC list holds `vitally_client_documents_link` twice (once with `()`). It came in with #245. The merge left it alone.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| 1 | Updated exact item deepEquals in every `tests/database-*.mjs`, not one file (R1) | the clearance answer changed for every caller |
| 1–3 | No local RED for database tests; CI quick runs were the check (R2) | no local Docker (user rule) |
| 3 | Receipt count in the client-refusal test scoped to the fixture's workspace and caller | review: it counted receipts in every workspace |
| 6 | Added `controller.setReviewReasonFor` / `state.reviewReasonFor`; the drawer always sends `usualDays`; Enter in the note sends back | needed for the reason row; Enter would otherwise save the drawer |
| 7 | Save via the form's submit, not a `data-action` (R5); `otherLanguage` sent only with Other | Enter takes the same path; the RPC refuses a name without Other |
| 8 | Added an Enter-in-note step to the new browser test | carried from Task 6's review |
| 9 | `openDrawer` waits for focus inside the drawer; step 7 asserts both fields after typing | firefox failure was the test's focus race |
| final | IME guard; trailing punctuation dropped in the reason line; the drawer's sentences for My profile refusals; deploy-window risk; docs row; no-profile-row tests | final whole-branch review (R8) |
| final | `vitally_my_profile` / `vitally_save_my_profile` refuse an invited account before any other check | user decision, Nov 22 |
| merge | Counts became thirty-four RPCs and fifty-seven migrations | #245 merged as 056 with one RPC |

## 4. Skill / workflow compliance

| Skill                                            | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming                        | ✓ (design agreed in the explore conversation; recorded in brainstorm.md at propose) |
| superpowers:writing-plans                        | ✓ (plan.md) |
| superpowers:using-git-worktrees                  | ✓ (D:/dev/vitally-my-profile; sibling-worktree convention) |
| superpowers:subagent-driven-development          | ✓ (9 tasks, ledger, per-task reviews, final review and one fix wave) |
| (transitive) superpowers:test-driven-development | ✓ (unit tasks RED→GREEN; database tests RED skipped by ruling R2; Task 7 slip noted in §2) |
| (transitive) superpowers:requesting-code-review  | ✓ (per-task, re-reviews, final whole-branch on the most capable model) |
| superpowers:finishing-a-development-branch       | ✓ (lifecycle step 9, after archive) |

### Deliberately Skipped Skills

None skipped. Two partial sub-steps are recorded in §2 and §3: no local RED for database tests (R2, no local Docker by user rule), and Task 7's uncaptured RED.

## 5. Surprises

- `btrim(null)` makes a CHECK constraint NULL, which passes. A pair check needs an explicit `reason is not null`.
- A `hidden` input is still submitted by `FormData`; only `disabled` drops it. The stale other-language name reached the RPC.
- The Roster drawer moves focus on the next animation frame, so a fast Playwright fill right after opening can land in the wrong field. That timing is invisible to a person, but a fast test hits it intermittently.
- The drawer always sending `usualDays` widened the deploy window. Until 057 runs on hosted, every Roster Save and Add a volunteer fails, not only the new screens.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **Subagents that wait on CI poll with `gh run view` + sleep, never `gh run watch`** → **Promote to memory** (feedback; extend the no-local-Docker memory)
  > **Why**: `gh run watch` was killed for low memory three times in this change, and each time a subagent stopped mid-task.
  > **How to apply**: every implementer or debugger brief that runs CI, from the first task.
- [ ] 🟡 **Browser tests wait for a dialog to take focus before typing into it** → **One-off now; candidate for the browser test helpers**
  > **Why**: the drawer's next-frame focus move made "A volunteer edits My profile…" flake in firefox (44980299716). #254's uploads-test flake has the same symptom.
  > **How to apply**: when a test opens a dialog and types at once; consider moving `openDrawer`'s focus wait into the shared helpers when #254 is worked.
- [ ] 📌 **Check a "minor" against the database contract before deferring it** → **One-off**
  > **Why**: Task 7's "hidden input still submits" minor was a save-blocking bug once checked against `vitally_save_my_profile`'s rules.
  > **How to apply**: when a review minor touches what a form sends to an RPC with exact-key or paired-field rules.

---

## Ledger summary (subagent-driven development)

The ledger (`.superpowers/sdd/plan/progress.md`, never committed) is summarised here before the workspace is deleted.

**Rulings**
- **R1:** every exact clearance item deepEqual in `tests/database-*.mjs` gained the two new keys, not only the planned file. Cost if wrong: one extra file touched.
- **R2:** database tests had no local RED; database-quick CI runs were their check. Cost if wrong: a test that never fails goes unnoticed. Reviewers checked that the assertions bite.
- **R3:** final checks used `gh workflow run ci.yml` on the pushed branch, since the PR opens last.
- **R4:** the branch was pushed before each quick database run.
- **R5:** My profile saves from the form's submit, not a `data-action`.
- **R6:** docs describe the post-merge state (056 first); made true by merging #245 before verify.
- **R7:** no blind rerun after the firefox failure. A fresh debugger worked against an acceptance rule set in advance (one green run plus one green firefox rerun). It was met (44982172310, attempts 1 and 2).
- **R8:** one final fix wave (Important 1–2, Minors 3, 4, 6, 7). The site-check question went to the user, who decided to gate it (c54224e).

**Fix rounds**
- Task 3: 1 round. The receipt count was scoped to the caller.
- Task 6: 1 round. Enter in the note sends back.
- Task 7: 1 round. `otherLanguage` is sent only with Other.
- Final: 1 wave. All 7 findings were addressed, and the re-review found no new breakage.

No finding was parked at a cap.

**Deferred minor findings** (the final review triaged all of them as "leave" unless noted):
- **Task 1**
  - A form-side half-pair test was added in Task 2.
  - The CHECK bounds the trimmed length (both RPCs trim).
  - The `usual_days` default was asserted in Task 2.
- **Task 2**
  - A tab- or newline-only reason (the UI trims).
  - No replay test with a different reason (shared `reserve_receipt` behaviour).
  - No test for a non-array `usualDays`.
  - The RLS usual-days test would pass without the change.
  - The docs' four-argument signature was fixed in Task 9.
- **Task 3**
  - The client-refusal order isn't bitten by a test.
  - The certificate comparison could pass vacuously.
  - No missing-key or different-payload replay tests. The no-profile-row FORBIDDEN test was added in the final wave.
  - Two equivalent site-check derivations, later replaced by the invited refusal.
- **Task 4**
  - A whitespace-only reason in `reviewLine` (the database trims).
  - The test name says "quoted".
- **Task 5**
  - No test for the VALIDATION re-read on My profile.
  - A harmless `recheckAfterOwnSave` race.
  - `dropWork` keeps `myProfile` after losing clearance.
  - Duplicate redirect lines in `navigate`.
  - `saveMyProfile`'s silent null was resolved by the view hiding the form.
- **Task 6**
  - The pick and note drafts survive Cancel.
  - No `app.mjs` unit coverage (covered by the browser test).
  - An unrelated `&#39;` normalisation in a test.
  - Send back's busy state is set by the page script.
  - The IME guard was fixed in the final wave.
- **Task 7**
  - The readonly email field carries `name="email"`.
  - The save path is covered only by the browser test.
- **Task 8**
  - The step 4 assert message was a false positive: it is the failure text.
  - `today` is computed once.
- **Task 9**
  - README test counts (none exist).
  - The docs read 001–057 before 056: true after the merge.
  - `openDrawer` waits for focus anywhere in the modal.
- **Final review**
  - A reason that is only "." renders "looked at this: . Please…" (cosmetic).
