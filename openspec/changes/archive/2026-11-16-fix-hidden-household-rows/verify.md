# Verification Report

**Change**: `fix-hidden-household-rows`
**Verified at**: `2026-11-16 (UTC)`
**Verifier**: Claude Code (main session). I ran the checks below directly, because the `openspec-verify-change` skill is not installed.

**PRECHECK:** 11 commits since the planning commit `4d3357f` (`6add349..8e45d0c` on top of `main`). `tasks.md` has 13 `- [x]` and 0 `- [ ]`.

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`

**Result:**

```text
16 items, 0 invalid (Totals: 16 passed, 0 failed)
```

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (13/13). Task 4.3 was ticked after CI run 43688186823 passed and its screenshots were reviewed.

**Unfinished tasks:**

| Task | Why unfinished | Blocks archive? |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

| Capability | Sync state | Notes |
|---|---|---|
| `shaded-section` | ✗ Needs sync | Archive (lifecycle step 8) merges it. Changes:<br>- ADDED "Household cells follow the household the client shows" and "The case page counts only the cells it can show".<br>- MODIFIED "A save replaces the section, and a stale save is refused" and "The editing copy keeps only the shaded fields fillable". |
| `draft-13614c` | ✗ Needs sync | Archive merges it. Changes:<br>- MODIFIED "The draft shows the preparer's shaded section" and "The draft's stamp says whether it holds preparer entries". |

---

## 4. Design / Specs Coherence Spot Check

| Sample | Design | Specs | Gap |
|---|---|---|---|
| D1: the rule follows the catalogue's visibility of `hh` | visible rows = min(members, 4) while the catalogue shows `hh`, else 0 | ADDED "Household cells follow the household the client shows" | None |
| D2: one function per language, plus a parity test | `householdRows` / `visibleShaded` (JS) and `vitally_private.household_rows` (SQL) | the same requirement's parity scenario | None. `database-shaded.mjs` "the browser and the database count the same household rows" passes on CI. |
| D3: the case's own catalogue version | SQL uses `p_case.intake_version` (NOT NULL); the browser uses `intakeVersion`, falling back to 2, which real cases never reach | — (implementation detail) | None. design.md records the nullability. |
| D4: stored cells on hidden rows are kept and carried | the save stores the sent fields plus stored household cells on hidden rows; they are never named in the history | MODIFIED "A save replaces the section…" ("replaces the visible section") | None. Covered by the database tests "hidden cells are kept, unnamed, and come back" and "only hidden cells stored: an empty save is accepted". |
| D5: payload rule unchanged | filled hidden cell → `VALIDATION`; the browser names the row with the existing sentence | the same MODIFIED requirement | None. No text changed, so Chinese is unaffected. |
| D6: migration 050, gap tolerated | `050_hidden_household_rows.sql`, `create or replace` | — | Still open (owner: the user). Renamed at merge time if the order changes. |

**Drift warnings** (non-blocking): none.

---

## 5. Implementation Signal

- [x] The worktree has no unstaged files, apart from this report and the 4.3 tick, which are committed with it.
- [x] Every implementation commit is pushed (`origin/fix-hidden-household-rows` = `8e45d0c`).

**Commit range:** `6add349..8e45d0c`

**Checks run** (Project rules, Verification):

| Check | Why | Result |
|---|---|---|
| `npm test` (local, Windows) | always | 1711 tests, 1710 pass, 1 fail. The failure is `tests/write-test-env.test.mjs`, which fails the same way on `main` on Windows: the temp path has a character a `.env` file can't hold unquoted. It passes on Linux CI and is unrelated. Before the change: 1700 tests, 1699 pass, with the same failure. |
| `npm run build:hant -- --check` (local) | the change edits no client text, so this only confirms nothing moved | clean |
| CI run [43688186823](https://github.com/jin-yu-yang/vitally/actions/runs/43688186823) on `8e45d0c` | stands in for `db:migrate:test` + `test:database`, `test:auth-browser` and `test:browser`. Running them locally is not allowed, because other sessions share the local stack. | `checks` ✅, `database` ✅ (578 tests, 578 pass, including the 050 tests and the parity test), `sign-in` ✅, `story (chrome-client)` ✅, `story (firefox-client)` ✅. All passed on the first run. |
| Story screenshots (run 43688186823 artifacts, 102 files) | CI stands in for the story | Spot-checked `staff-case-preparing-720` (chrome client, firefox staff) and `staff-case-review-approved-720` (firefox client, chrome staff). Both render normally. The story fills no hidden household cell, so no screenshot shows the changed behaviour. That behaviour is covered by the unit and database tests. |

**Reproduction first (red):** CI run [43686396016](https://github.com/jin-yu-yang/vitally/actions/runs/43686396016) on `72d7153` (tests only, before 050). The database job ran 575 tests: 573 passed and 2 failed, exactly the new ones.
- The parity test: `function vitally_private.household_rows(smallint, jsonb) does not exist`.
- The reproduction: "Missing expected rejection" (row 1 saved while the answer is No).

**Earlier green run:** [43687435576](https://github.com/jin-yu-yang/vitally/actions/runs/43687435576) on `f1abf0b`: `checks`, `database` and `sign-in` passed. I cancelled its story jobs because the final-review fix wave replaced that head.

**Populated-stack run:** not needed. Migration 050 only creates and replaces functions. It changes no rows, tables, RLS or RPC signatures, so CI's fresh stack covers it (project rule: "CI starts from an empty database").

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md   # 8 files
```

- [x] These files are legitimate historical documents from before the schema was installed (parts 1–4d). This change wrote nothing under `docs/superpowers/`.

| File | Captured in the change? | Suggested action |
|---|---|---|
| 8 historical design documents | not applicable (historical; CLAUDE.md forbids moving them) | none |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no `[~]` rows, so there is nothing to list.

| Deferred dogfood (plan §) | Equivalent automated test | Coverage assessment | Real gap? |
|---|---|---|---|
| — | — | — | — |

---

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS:
  - Migration 050 is numbered for the agreed order (047 #197, 048 #200, 049 #196) and is renamed at merge time if that order changes.
  - The local Windows-only `write-test-env` failure is pre-existing and unrelated.
- [ ] ❌ FAIL

**Next step:** retrospective (lifecycle step 7), then merge `main` and archive (step 8), then open the PR (step 9).
