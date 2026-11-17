# Verification Report

**Change**: `fix-closed-lines-after-filing`
**Verified at**: `2026-11-14 10:10 (UTC)`
**Verifier**: Claude Code (main session). The checks below were run directly, because the `openspec-verify-change` skill is not installed.

**PRECHECK:** 9 commits on top of `main` (`6add349..f428a0c`). `tasks.md` has 13 `- [x]` and 0 `- [ ]`.

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`

**Result:**

```text
16 items, 0 invalid (Totals: 16 passed, 0 failed)
INFO only: two requirements in the case-lifecycle spec are longer than 500 characters (pre-existing style note, not an error)
```

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (13/13)

**Unfinished tasks:**

| Task | Why unfinished | Blocks archive? |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

| Capability | Sync state | Notes |
|---|---|---|
| `case-lifecycle` | ✗ Needs sync | Archive (lifecycle step 8) merges it: 1 ADDED requirement ("A close after a filing says what was filed") and 3 MODIFIED ("The lists and the case page show every stage", "Clients are told at each new step", "A client may withdraw their own application"). `main` hasn't changed since the branch started (`6add349`), so the merge should apply cleanly. |

---

## 4. Design / Specs Coherence Spot Check

| Sample | design | specs | Gap |
|---|---|---|---|
| D1 per-return outcome | 4 outcomes from method + result | ADDED requirement's outcome table | None. `returnOutcome` (JS) and `vitally_private.return_outcome` (SQL) implement the same table. |
| D2 composition | reason half + federal + Pennsylvania; space in en, nothing in 简体 | the same sentence in the ADDED requirement | None |
| D3 / D4 one rule, two places | `closedLine` in JS, five-argument `closed_line` in SQL | "the status panel and the history line SHALL give the same text" (narrowed to the five reasons by the pre-flight ruling) | None. Subtest 13 checks 119 combinations. |
| D5 staff notice | after-filing text for a non-withdrawn close before filing on a filed case | MODIFIED "A client may withdraw…" and the Follow-ups row | None. Subtests 10–12 cover it. |
| D7 migration number | provisional 047, renamed at merge time | — | Still open (owner: the user). The migration uses `drop function if exists`, so the rename stays a pure rename. |

**Drift warnings** (non-blocking):

- The ADDED requirement first said the panel and history give the same text "for the same case". That is false for reason `other` and no reason: the history line "Your application was closed by the office… Contact PCDC if you have questions." already differed from the panel before this change. The pre-flight ruling narrowed the sentence to `dismissed`, `withdrawn`, `out_of_scope`, `no_need_to_file` and `duplicate` (commit `fa1a351`).

---

## 5. Implementation Signal

- [x] The worktree has no unstaged files
- [x] Every commit is pushed (`origin/fix-closed-lines-after-filing` = `f428a0c` before this report)

**Commit range:** `6add349..f428a0c`

**Checks run** (project rules, Verification):

| Check | Why | Result |
|---|---|---|
| `npm test` (local, Windows) | always | 1705 tests, 1704 pass, 1 fail: `tests/write-test-env.test.mjs:157`. That test fails the same way on `main` on Windows (a temp path with a character `.env` can't hold unquoted) and passes on Linux CI. It is unrelated to this change. |
| `npm run build:hant -- --check` (local) | 简体 text changed | clean |
| CI run [43582394381](https://github.com/jin-yu-yang/vitally/actions/runs/43582394381) on `f428a0c` | stands in for `db:migrate:test` + `test:database` and `test:browser`. Running them locally is not allowed: another session (#197) shares the local stack. | `checks` ✅, `database` ✅ (595 pass, 0 fail; `database-closed-after-filing.mjs` subtests 1–13 pass), `sign-in` ✅, `story (chrome-client)` ✅, `story (firefox-client)` ✅. All passed on the first run. |
| Story screenshots (run 43582394381 artifacts, 102 files) | CI stands in for the story | The story captures no closed screen, so no screenshot shows the changed text. Spot-checked `progress-efiled-720` (en), `zh-progress-720` (简体) and `office-case-followup-720` (staff): they render normally. |
| `npm run test:auth-browser` | sign-in untouched | covered by CI `sign-in` anyway (✅) |

**Populated-stack run:** not needed. Migration 047 only replaces, creates and drops functions. It changes no rows, tables, RLS or RPC signatures, so CI's fresh stack covers it (project rule: "CI starts from an empty database").

**Earlier CI runs on this branch:**
- 43567350441 (`16e2b06`): the reproduction; the expected failures only.
- 43579513755 (`e3127fa`): database failed. `tests/database-hold.mjs:317` still called the dropped one-argument `closed_line`. It was fixed in `f663f21` after reading the recorded error.
- 43580517916 (`f663f21`): all green.
- 43582394381 (`f428a0c`, the head verified here): all green.

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
- [x] ⚠️ PASS WITH WARNINGS: the migration number 047 is provisional and must be renamed to the next free number when it's this PR's turn (#196 and #197 may take 047/048). The local Windows-only `write-test-env` failure is pre-existing and unrelated.
- [ ] ❌ FAIL

**Next step:** retrospective (lifecycle step 7), then merge `main` and archive (step 8), then open the PR (step 9).
