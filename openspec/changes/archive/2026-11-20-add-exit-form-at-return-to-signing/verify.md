# Verification Report

**Change**: `add-exit-form-at-return-to-signing`
**Verified at**: `2026-11-20 21:45` (New York)
**Verifier**: Claude (controller session), on branch `add-exit-form-at-return-to-signing` at `bb4b7da`

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] All items `"valid": true`

**Result**:

```text
21 items, all valid: true. No failures.
One warning on this change: case-lifecycle "Return to signing can record the corrected Exit Form values" is over
500 characters (length warning only).
```

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (22 of 22)

**Unfinished tasks**: none.

1.6 is ticked with the note "not needed: migration 040 dropped `apply_fixture_scenario`; rows go with their case
(on delete cascade)". The design (D7), the proposal and the plan were reconciled to match, with `/opsx:update`
at the user's request (`f005f1d`, `bb4b7da`).

| Task | Reason not finished | Blocks archive |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

| Capability | Sync state | Note |
|---|---|---|
| `case-lifecycle` | ✗ Needs sync | ADDED "Return to signing can record the corrected Exit Form values", "The corrected Exit Form values stay with staff"; MODIFIED "A rejected case returns to signing". Archive merges it (lifecycle step 8). |
| `review-and-corrections` | ✗ Needs sync | MODIFIED "The Exit Form after a Return to signing prints only what ViTally holds" and "…says what to fill in by hand". Archive merges it. |

Not synced on purpose: CLAUDE.md step 8 merges `main` first and lets archive do the sync (`/opsx:sync` is not used).

---

## 4. Design / Specs Coherence Spot Check

| Sample | Design | Specs | Gap |
|---|---|---|---|
| Optional values, groups empty and closed | D4; brainstorm Q1, Q2 | case-lifecycle ADDED, scenarios "The values are optional", "The groups start empty and closed" | None |
| Settled method fixed, refused if different | D3, D4 | "A settled return's method is fixed", "A settled method can't be changed" | None |
| Staff-only storage, no banking details | D1 | "The corrected Exit Form values stay with staff", "Banking details are refused" | None |
| Exit Form prints the stored values; case method once settled; latest Return to signing decides | D5 | review-and-corrections MODIFIED, scenarios "Corrected values are printed", "The case's method wins once refiled", "The latest Return to signing decides" | None |
| Note lists only gaps; no date when the date is unknown | D5 | "Only the gaps are listed", "Nothing missing", "Stored values with no known date" | None |
| Mark e-filed preselects each rejected return's planned method | D6 (per-return radios) | MODIFIED "A rejected case returns to signing", "The planned method is preselected" | None |

**Drift warnings** (non-blocking): none after the `/opsx:update` reconciliation. `brainstorm.md` still mentions a
per-case reset in its "Left to the builder" list. It is kept unchanged as the record of the agreed design; D7
supersedes it.

---

## 5. Implementation Signal

- [x] No unstaged files in the worktree (`git status --short` is empty)
- [ ] All related commits pushed. Not yet: the branch is pushed at lifecycle step 9 (finish), after archive.

**Commit range**: `fdd64a2..bb4b7da` (15 commits: the plan commit `964d02b`, then the implementation, review fixes
and artifact reconciliation)

**Checks run** (CLAUDE.md Verification), all at the code of `9b8ed6b`/`bb4b7da` unless noted:

| Check | Why | Result |
|---|---|---|
| `npm test` | always | 2156 pass, 0 fail |
| `npm run db:migrate:test` | migration 054, SQL functions | applied (054 re-applied locally after the final-review edit; 054 is not on `main` or any shared database) |
| `npm run test:database` | migration, row-level security, realtime | 782 of 783 pass. The one failure is `accounts Edge Function`, which needs `VITALLY_TEST_MAIL_URL`, an environment variable this machine doesn't set. It is a pre-existing gap and unrelated to this change. |
| `npm run test:browser` | dialog, Exit Form panel, Mark e-filed, story | Both browser orders pass at `bb4b7da`. Firefox client / Chrome staff passed in full in two runs. Chrome client / Firefox staff passed 50/50 when run alone. In the two full-suite runs it failed at the seed step, before anything this change touches: the story's 20 s "page holds still" wait timed out while the Firefox staff board finished its usual per-case loads. More in the note below. Task 7's run at `9c03570` passed 92/92. |
| `npx openspec validate --all` | CI `checks` | pass |
| `npm run build:intake` leaves nothing to commit | CI `checks` | nothing to commit |
| `npm run build:hant -- --check` | not needed | no client text or 简体 changed; staff screens only |
| `npm run test:auth-browser` | not needed | sign-in untouched |

**Note on the seed-step timeout.** I investigated before calling it environmental:
- **Database size:** small (6 workspaces, 29 cases, 30 MB), so not accumulated test data.
- **Leftover browsers:** none. The 40 Firefox processes are the user's own Firefox, not Playwright.
- **Realtime:** no errors during the runs. It picked up the re-created table at 20:00 and logged only routine
  warnings after that.
- **Order run alone:** the same commit passed the same order 50/50.
- **Timing:** the seed step itself got slower through the evening. Chrome staff went from 8 s to 18 s; Firefox
  staff from 25 s to more than 32 s.
- **What was in flight:** only the board's existing contact-log and label loads, which this change doesn't touch.

CI's `story` job runs both orders on a fresh stack when the PR opens; its run will be linked in the PR.

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md
```

- [x] No files, or the files that exist are legitimate and predate the schema

Eight files exist, all dated 2026-09-14 to 2026-10-05. They are the historical design documents from before
superpowers-bridge, which CLAUDE.md keeps. This change wrote nothing there: its brainstorm is `brainstorm.md`.

| File | Captured in the change | Action |
|---|---|---|
| — | — | — |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no `[~]` rows, so this section is empty (PASS).

| Deferred dogfood (plan §) | Equivalent automated test | Coverage assessment | Real gap? |
|---|---|---|---|
| — | — | — | — |

---

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS. There are two:
  - `test:database` has one known, unrelated environment failure (`accounts Edge Function`).
  - The full local story run hit a timing-sensitive seed-step wait in the Chrome client / Firefox staff order. That
    order passes when run alone, and CI's `story` job on the PR is the confirming run.
- [ ] ❌ FAIL

**Next step**: write `retrospective.md` (lifecycle step 7), then merge `main` and archive (step 8), then push and
open the PR (step 9), and link its CI run.
