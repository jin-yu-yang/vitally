# Verification Report

**Change**: `fix-contact-line-after-return-to-signing`
**Verified at**: `2026-11-21`
**Verifier**: Claude Code (controller session). The `openspec-verify-change` skill is not installed, so these checks were run directly, as CLAUDE.md says.

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item returns `"valid": true`.

**Result:** 21 items, 0 invalid. The plain-text run prints warnings that some requirement texts are longer than 500 characters. They are warnings only, and they include the requirement this change modifies, which was already long before it.

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (8 of 8).

| Task | Why it isn't complete | Blocks archive? |
|---|---|---|
| — | — | — |

- Task 3.1's follow-up issue was drafted for the user to file, and it was not filed.
- Task 2.2 ran locally (§5).

---

## 3. Delta Spec Sync State

| Capability | Sync state | Notes |
|---|---|---|
| `review-and-corrections` | ✗ Needs sync | One MODIFIED requirement, "An approval with a questionnaire settles the review-contact step". The final reviewer compared the delta with the canonical spec: the existing text and all five scenarios are kept verbatim, plus two paragraphs and three scenarios. Archive (CLAUDE.md step 8) merges it. |

---

## 4. Design / Specs Coherence Spot Check

| Item checked | Design | Spec | Gap |
|---|---|---|---|
| D1: the flag is passed only by "Your next step" | `contactStepLine(…, { returned })`; the `reviewAttempts` call is unchanged | The history row SHALL keep describing each attempt as before; scenario "The review history is unchanged after a Return to signing" | None |
| D2: wording for "yes" | "At the first signing, the reviewer went over the return with the client on <date>. It isn't gone over again." | The same sentence, with the questionnaire's date | None |
| D3: wording for "no" | "…was passed to the office. It isn't gone over again." | The same, and it SHALL NOT say the office will go over it; there is no new go-over follow-up | None |
| D4: no questionnaire | The fallback is kept | "An approval without a questionnaire SHALL keep its existing line." | None |

The code matches: `src/staff-views.mjs` has `contactStepLine(attempt, questionnaire, { returned = false } = {})`, and only `nextStep`'s `review_approved` branch passes `returnedToSigning(record)`.

**Drift warnings (non-blocking):** the plan, not the design, drifted.
- **Story placement:** plan Task 2 placed the story checks on the `staff` window at the Return to signing step. That window is the Site Coordinator's office case page, which has no "Your next step". Two fix rounds moved the checks into the Reviewer's window (`use("reviewer", classReference)`). The plan text was not updated afterwards.
- **Apostrophe:** plan Task 1's regexes used a literal `isn't`, but `esc()` renders it as `&#39;`. The tests use `isn(?:'|&#39;)t`.

---

## 5. Implementation Signal

- [x] The worktree has no uncommitted files.
- [ ] Commits pushed: not yet. Pushing happens at finish (CLAUDE.md step 9).

**Commit range:** `e83978f..ddcdbae`. The branch starts from main at e83978f.
- `ef003a9`: the change artifacts.
- `896baa0`: Task 1, the code and unit tests.
- `1648aec`, then fix rounds `3b3fd50` and `328b8e4`: Task 2, the story.
- `ddcdbae`: the task checkboxes.

**Checks run:**

| Check | Result |
|---|---|
| `npm test` | 2220 pass, 0 fail, after Task 1. The baseline at ef003a9 was 2216. Task 2 changes only `tests/browser.mjs`, and its implementer re-ran the unit suite: 2220 pass. |
| `npm run test:browser` | **Run 3, at 328b8e4: 93 pass, 0 fail, both browser orders.** Runs 1 and 2 (1648aec, 3b3fd50) failed only on this change's new checks, which were on the wrong window, and were fixed as described in §4. |
| Local stack | It was reset first (`supabase stop --no-backup`, start, `npm run db:migrate:test`), with the user's approval. It had #203's pre-merge 054 and lacked 053, so the runner refused with `MIGRATION_CHANGED`. All migrations through 054 are now applied. |
| `npx openspec validate --all` | 21 valid. |
| `npm run build:intake` | Nothing to commit. |
| Not needed | `npm run test:database`: no database, SQL or migration change. `npm run test:auth-browser`: sign-in untouched. `npm run build:hant -- --check`: no client text changed; staff screens only. |

**Screenshots:** the story's screenshots aren't taken at the Return to signing step, so none shows the new line. The story's text assertions cover it.

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

- [x] The 8 files in `docs/superpowers/specs/` are historical design documents from parts 1–4d. CLAUDE.md says to keep them where they are. This change wrote nothing there; its brainstorm is in `brainstorm.md`.

| File | Captured in the change? | Action |
|---|---|---|
| — | — | — |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no `[~]` rows, so this section is empty by rule.

---

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS: the plan drift in §4 (the story's window, and the apostrophe), which the retrospective records. The delta spec is still to be synced at archive.
- [ ] ❌ FAIL

**Next step:** write the retrospective (CLAUDE.md step 7), merge `main`, then run `/opsx:archive`.
