# Verification Report

**Change**: `hide-signing-row-during-go-over`
**Verified at**: `2026-11-16 10:52`
**Verifier**: Claude (controller of the subagent-driven apply), checks run directly (the `openspec-verify-change` skill is not installed)

PRECHECK:
- Commit evidence: 5 commits on the branch since `main` (6add349..b969527).
- Task progress: 7 tasks ticked in `tasks.md`.

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`

**Result**: 16 items, 0 invalid. The only message is the existing INFO about a long requirement text in a canonical spec, which this change does not touch.

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [ ] Every `- [ ]` is now `- [x]`. One task remains, and it does not block.

**Unfinished tasks:**

| Task | Why it is unfinished | Blocks archive? |
|---|---|---|
| 3.4 Before archive: merge `main`, and re-copy the lists requirement if PR #200 has landed | It belongs to the archive step (CLAUDE.md step 8). It runs immediately before `/opsx:archive`, after this report. | No. It is part of archive itself. |

---

## 3. Delta Spec Sync State

| Capability | Sync state | Notes |
|---|---|---|
| `case-lifecycle` | ✗ Not synced yet | The two MODIFIED requirements ("Admins record signing and e-filing, with a confirmation" and "The lists and the case page show every stage") are merged at archive. The final review compared each against canonical: only the intended sentences and the two new scenarios differ. PR #200 (still open) edits the neighbouring Withdrawn bullet, so task 3.4 applies. |
| `office-follow-up` | ✗ Not synced yet | "The office works a go-over follow-up like any other task" is merged at archive. Only the intended sentence and two scenarios differ. |

---

## 4. Design / Specs Coherence Spot Check

| Item checked | Design | Specs | Gap |
|---|---|---|---|
| D1: hide the Signing row while the go-over is open | Choice of A; the Call row stands for the case | case-lifecycle Ready to exit bullet; office-follow-up requirement body | None |
| D3: the rule depends only on `goOverOpen` | Also when the reviewer's call is pending or the case was returned to signing | Bullet: "whatever its reviewer's call or a Return to signing" | None |
| D2: filter where the rows are built | Filtering in `followupQueue` keeps the counts consistent | Implementation detail. Unit test: `queueCounts` gives `signing: 0` | None |
| Non-goal: the case page and the database gate are unchanged | The locked step text and the refusal stay | The "Admins record…" paragraph keeps the case-page text and the database refusal | None |

**Drift warnings** (non-blocking): none.

---

## 5. Implementation Signal

- [x] No unstaged files in the worktree (`git status --short` is empty; the ignored `.superpowers/` scratch is not counted)
- [x] All relevant commits are pushed (`origin/hide-signing-row-during-go-over` at b969527 before this report)

**Commit range**: `6add349..b969527`
- 128e1b6 Follow-ups: no Signing row while the go-over is open (#177)
- c12e936 Browser story: no Signing row while the go-over is open (#177)
- plus the planning commit and two commits that tick tasks

**Checks run** (CLAUDE.md "Verification"):
- `npm test` (unit), in the worktree: 1701 tests, 1700 pass, 1 fail. The failure is `tests/write-test-env.test.mjs` ("both files are written with mode 600…"). It fails on the base commit too (Windows-only: the `.env` writer refuses the backslashes in the Windows temp path). CI's `checks` job (Linux) passes it.
- `npx openspec validate --all`: 16/16 valid.
- Browser story: CI run [43898451416](https://github.com/jin-yu-yang/vitally/actions/runs/43898451416), started with `gh workflow run ci.yml --ref hide-signing-row-during-go-over` on b969527, the commit under review.
  - Every job passed on its first attempt: `checks`, `database`, `sign-in`, `story (chrome-client)`, `story (firefox-client)`.
  - The story asserts that once the class case's Call the client row is visible, Follow-ups has no Signing row for it. After the go-over is resolved, the Signing row returns with "Waiting for the client to sign." and Mark ready to e-file….
- Story screenshots (artifacts `story-screenshots-chrome-client` and `story-screenshots-firefox-client`, 51 each) were reviewed.
  - The case page at Ready to exit still reads "The office will go over the return with the client." on both legs.
  - No screenshot captures Follow-ups during a go-over, so the story's assertion is the evidence for the row itself.
- Not needed:
  - `npm run test:database`: no SQL. CI `database` passed anyway.
  - `npm run test:auth-browser`: sign-in is untouched. CI `sign-in` passed anyway.
  - `npm run build:hant -- --check`: no client text. CI `checks` passed anyway.

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

- [x] No files, or the existing files predate the schema install

`docs/superpowers/specs/` holds 8 historical design documents from parts 1–4d. CLAUDE.md keeps them as history. This branch adds nothing under `docs/superpowers/` (`git diff --stat 6add349..HEAD -- docs/superpowers` is empty).

| File | Content captured in the change? | Suggested action |
|---|---|---|
| — | — | — |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no `[~]` rows. The only step run outside its task was the browser story (Task 2, Step 4, a ledger ruling to run it once after the final review). It ran as the CI story legs above, so nothing is deferred.

---

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS. Proceed to retrospective and archive, noting:
  - the local unit run has the pre-existing Windows-only `write-test-env` failure (green in CI);
  - task 3.4 (merge `main`, and re-copy the lists requirement if #200 has landed) runs at archive.
- [ ] ❌ FAIL

**Next step**: write `retrospective.md` (CLAUDE.md step 7), then merge `main` and archive (step 8).
