# Retrospective: add-workspace-switch

> Written: 2026-11-25 (after verify passed with one warning)
> Commit range: `90caabd..10c372f` (plus the archive commit)
> Worktree: `D:/dev/vitally-workspace-switch`

---

## 0. Evidence

- **Commit range**: `90caabd..10c372f`, 11 commits: 1 plan, 7 task commits plus 1 task fix round, 1 final-review fix wave, 1 CI fix.
- **Diff size**:
  - implementation, `90caabd..10c372f`: +1038 / −79 lines across 18 files;
  - including the planning artifacts, from `87856e6`: +1967 / −65 across 27 files.
- **Tasks done**: 15/15.
- **Active hours**:
  - about 1.3 h of apply (commit times, 14:26 to 15:44 on Nov 23);
  - about 1 h of explore, brainstorm and propose before that;
  - about 1 h of waiting for CI;
  - verify, retro and archive on Nov 25.
- **Subagent dispatches**: 21.
  - 7 implementers and 7 task reviewers;
  - 1 resumed fix round plus its re-review;
  - 1 final review (Opus), 1 fix wave plus its re-review;
  - 1 CI-fix implementer.
- **New external dependencies**: none.
- **Bugs encountered post-merge**: none yet (not merged).
- **OpenSpec validate state at archive**: pass (25 of 25; `--strict` clean for this change).
- **Test coverage signal**:
  - `npm test`: 2482 → 2527 (+45, none removed).
  - CI run [45262535244](https://github.com/jin-yu-yang/vitally/actions/runs/45262535244) on `10c372f`: every job green.
  - The new standalone browser block "one person switches between Office and Cases" takes about 11 s.

Commit chain:

```
90caabd Plan the workspace switch (OpenSpec change add-workspace-switch) (#104)
f6ff025 the side rule in contracts.mjs
128a7bd remember the side per user in localStorage
6ffbdc9 the sidebar switch and the staff frame follow the side
c645a15 the controller remembers, switches and lands
fcdfdd6 an Intaker's Follow-ups lists only what they can act on
3e739bc an Intaker's document-wait row opens the case        (task 5 fix round)
2a2326e the hint toward Cases and capability changes
d661df4 browser walk and docs
2faee44 pressed side is a no-op, office-only screens land through navigate, docs, hover   (final-review fix wave)
10c372f the uploads walk expects an Intaker in the office      (CI fix)
<archive commit>
```

---

## 1. Wins

- **[evidence: brainstorm.md Q1–Q5]** Checking the user's up-front answers against the code before proposing caught three conflicts that would otherwise have surfaced in review:
  - Q1: sessionStorage is cleared at sign-out, so it could not meet "sign-in returns to the side used last".
  - Q2: "work in reverse" would have moved a Preparer in the middle of a case.
  - Q3: a claim-only hint said nothing to an Intaker assigned a case.
- **[evidence: design D1, `src/contracts.mjs`]** One pure `workspaceSide()` used by the view, `actingAdmin()` and `recheckClearance`. The final review traced load, restore, recheck and switch, and found no disagreement between the view and the controller.
- **[evidence: design D8, `listCases` `openRequests`]** Confirming during propose that the list already carries `openRequests` and `ownerUserId` turned D8's "stop if a new read is needed" into a settled fact. No migration and no new read.
- **[evidence: 3e739bc]** The task review caught an Intaker's documents row showing "Needs office administrator access." as its only action, after the implementer had wrongly called the path unreachable. Fixed in one round.
- **[evidence: 2faee44]** The Opus final review found the one real behaviour bug no per-task review could see, because it spans `app.mjs` and the controller: pressing the already-pressed side cleared form drafts and opened a pointless leave dialog.

## 2. Misses

- 🟡 **[painful | evidence: CI 45258881496, 10c372f]** An existing browser test ("A volunteer says their uploads were sent…") encoded "a new Intaker lands on the work board". The pre-flight ruling R2 anticipated superseded tests, but nobody searched `tests/browser.mjs` for role grants, so it was only found by a full CI run, costing about 25 minutes of CI and a second run. A `grep -n "volunteer-role-intaker\|receive_documents" tests/browser.mjs` during planning would have found it.
- 🟡 **[painful | evidence: verify.md §5]** The switch itself has no screenshot. The story's people have one side each, and the new block captures nothing, so its spacing, hover and place next to the fixed toggle were never seen by anyone in this cycle.
- 📌 **[nit | evidence: ruling R6]** The sidebar `<aside>` was already `aria-label="Workspace"`, so the spec's group name duplicates it. It was found in Task 3, not during planning. A follow-up is proposed (relabel the `<aside>`).
- 📌 **[nit | evidence: Task 5 report]** One implementer's report was short and lacked full TDD evidence. The reviewer judged from the diff instead.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| 3 (views) | Also hides Follow-ups' Add a case for a non-admin; converted 2 controller tests | Pre-flight ruling R1: the button lives in `views.mjs`, not `office-views.mjs`. Ruling R2 covered the converted tests |
| 4 (controller) | `EXITS["set-workspace-side"]` takes `side` as an argument passed from `dialogContext.side` | Equivalent to the plan's "reads `state.dialogContext.side`", and simpler. The reviewer agreed |
| 5 (Intaker queue) | Added an **Open** button on an Intaker's documents row | Ruling R7, from the task review: without it, the row's only action was an admin refusal |
| 6 (hint, recheck) | Also moves `office-cases` home when the side is no longer Office | A defensive extension of D10, found by the reviewer, untested on its own (deferred minor) |
| 7 (browser, docs) | Step 1 skipped (#278 still open, `main` unchanged). Step 6 (push/CI) done by the controller. `production-roadmap.md` updated instead of `architecture.md` | Rulings R3 and R4. `architecture.md` had no R55 wording |
| — | Final fix wave `2faee44`: pressed-side no-op guard, Add a case → Cases test, `navigate("staff")` cleanup, docs, JSDoc, hover tint | Opus whole-branch review |
| — | `10c372f`: the uploads walk waits for the office queue | CI, ruling R9 |

## 4. Skill / workflow compliance

| Skill                                            | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming                        | ✓ (method in conversation; skill invoked in propose to record brainstorm.md) |
| superpowers:writing-plans                        | ✓ |
| superpowers:using-git-worktrees                  | ✓ (existing worktree detected; `npm ci`; baseline 2482 green) |
| superpowers:subagent-driven-development          | ✓ |
| (transitive) superpowers:test-driven-development | ✓ (RED/GREEN evidence in each task report, Task 5 partial) |
| (transitive) superpowers:requesting-code-review  | ✓ (7 task reviews, 2 re-reviews, 1 final Opus review) |
| superpowers:finishing-a-development-branch       | ✓ (step 9, after archive) |

### Deliberately Skipped Skills

None. One sub-step was narrowed: brainstorming's builder-check subagent was not run on `brainstorm.md`. Every decision in it had already been settled with the user one question at a time, and the user reviewed all the planning artifacts before apply (approved 90caabd). That review served as the builder check.

## 5. Surprises

- The sidebar `<aside>` was already named "Workspace" (`src/views.mjs:150`), so tests had to select the switch by `role="group"` as well.
- `openRequests` was already on every staff list record (`src/supabase-store.mjs:644`), so the Intaker's documents filter needed no new data.
- An implementer believed the non-admin reason branches in `rowAction` were unreachable. The documents row still reached one through `putOnHold`'s admin gate.
- `esc()` renders the apostrophe in "You're" as `&#39;`, so the view tests match the escaped form.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **When a change moves where a role lands, grep the browser suite for that role's grants before CI.** → **Promote to memory** (type: feedback)
  > **Why**: the uploads walk (`tests/browser.mjs`) granted Intaker and expected the work board. Unit tests could not see it, and it cost a full CI run (45258881496).
  > **How to apply**: during planning or pre-flight, for any change to a role's landing or frame, run `grep -n "<role checkbox id>\|<capability>" tests/browser.mjs tests/auth-browser.mjs` and list each hit in the plan's superseded-tests ruling.

- [ ] 🟡 **A new visible control needs a screenshot in its browser block.** → **Promote to memory** (type: feedback)
  > **Why**: the switch's look went unreviewed because no story person has both sides and the new block took no screenshot (verify.md §5).
  > **How to apply**: when a plan adds a control that only some people see, the browser task captures one screenshot of it at 720 and 390 into `artifacts/browser/`.

- [ ] 📌 **Relabel the pre-existing sidebar `<aside aria-label="Workspace">`** → **One-off** (follow-up issue)
  > **Why**: it duplicates the switch group's name for screen-reader users (ruling R6/R8). The spec binds the group's name, so the `<aside>` is what should change.

---

## Ledger summary (SDD workspace, deleted after this retro)

**Rulings:**
- **R1:** Task 3 owns hiding Add a case for a non-admin. Task 5 asserts no season-end close instead.
- **R2:** existing tests that encode the superseded "office-capable non-admin on the work board" are converted, not deleted.
- **R3:** the controller pushes and runs CI, never an implementer.
- **R4:** no subagent starts Docker or the stack, or runs the browser, sign-in or database suites locally.
- **R5:** commit trailers name the model that wrote each commit (Sonnet on the task commits). No amend.
- **R6:** the switch group keeps the spec name "Workspace", although the `<aside>` already has it. Tests select by `role="group"`.
- **R7:** an Intaker's documents row gets the **Open** button (`open-case`), not the admin's Put on hold.
- **R8:** the duplicate "Workspace" label is left for a follow-up (relabel the `<aside>`).
- **R9:** the uploads walk waits for the office queue after Robin gains Intaker (`10c372f`).

**Fix rounds:**
- Task 5, 1 round (the Intaker documents-row action).
- The final review's fix wave (`2faee44`): Important findings 1–2 and minors 3, 4, 5, 7 and 8, all re-reviewed as addressed.

**Parked findings:** none. No breaker was tripped.

**Deferred minors, triaged by the final review as able to stay:**
- Task 1: single-side roles not tested with `preferred = "cases"`; no direct `hasOfficeSide`/`hasCasesSide` or non-array capabilities test.
- Task 2: the `read/writeWorkspaceSide` options argument has no `= {}` default.
- Task 3: the test repeats the switch regex; no test of a non-switch admin's Add a case on the Cases frame.
- Task 4:
  - `forgetUser` leaves `workspaceSide` in memory (harmless, because `load()` resets it);
  - no explicit `awaitingClearance` guard in `setWorkspaceSide`.
- Task 5:
  - the queue-level non-admin reason branches are now unexercised (a shared `explain` path, so not removable);
  - the `holds()` helper is not used at the documents-row check;
  - the documents-row test uses a loose regex.
- Task 6: the extra `workspaceSide !== "office"` clause on the All cases move is untested on its own.
- Task 7: a redundant `openBoard` after pressing Cases; the hint selector relies on `#main`.

**Fixed in the wave:** the switch hover tint; the JSDoc placement; the Add a case → Cases test.

**Declined to judge** (final review):
- no screening start on an involuntary side flip;
- a stored `office-add-case` restored on the Cases side;
- `formDrafts.clear()` on a real switch from a case page;
- the Intaker's case-page wording.

All are outside the spec or follow existing behaviour.
