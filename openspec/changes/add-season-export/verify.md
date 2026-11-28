# Verification Report

**Change**: `add-season-export` (#256)
**Verified at**: `2026-11-27`
**Verifier**: Claude Code (controller session), after apply via subagent-driven development

The `openspec-verify-change` skill is not installed, so these checks were run directly.

**PRECHECK:**
- 14 commits since `origin/main` (`7d60112..738660a`).
- 18 of 18 boxes in `tasks.md` are ticked. Before this verification, 14 were ticked and 4.1–4.4 were not.

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`.

**Result:**

```text
totals: items 27, passed 27, failed 0
  change: 1 / 1 passed (add-season-export)
  spec:   26 / 26 passed
```

The change has 4 non-blocking warnings: requirement text over 500 characters, as several existing specs also have.

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]`. Checks 4.1–4.4 were ticked during this verification, on this evidence:

| Task | Evidence |
|---|---|
| 4.1 `npm test` | 2639 / 2639 pass on `738660a` |
| 4.2 `npm run db:migrate:test`, `npm run test:database` | Migrations applied (062 is new). The full suite passes 1037 / 1038 on `3633e0d`. The only failure is `tests/database-accounts-function.mjs`, which stops at its first assertion: "VITALLY_TEST_MAIL_URL is required". This machine's `.env.test` has no such variable. The failure is environmental and comes before any database call, and this change doesn't touch that function. The commit after `3633e0d` (`738660a`) changes only browser controller code and its unit tests. This change's own database files (`database-season-export`, `-actions`, `-catalog`, `-season-settings`) pass 64 / 64 on `3633e0d`. The pull request's CI `database` job must pass as well. |
| 4.3 `npm run test:browser` | 100 / 100 pass on `738660a` (33.6 min), and on `3633e0d` (26.6 min). |
| 4.4 `npx openspec validate --all` | 27 / 27 (§1). |

**Unfinished tasks:**

| Task | Why unfinished | Blocks archive? |
|---|---|---|
| — | — | — |

**Checks not run, and why:**
- `npm run build:hant -- --check`: there is no client text. Staff screens stay English, and `src/client-text.mjs` is unchanged.
- `npm run test:auth-browser`: sign-in is not touched.

---

## 3. Delta Spec Sync State

| Capability | Sync state | Notes |
|---|---|---|
| `season-export` | ✗ Needs sync | A new capability. `openspec/specs/season-export/` does not exist yet, and its 6 requirements will be added at archive. |
| `season-settings` | ✗ Needs sync | 2 ADDED requirements (the Season export card, and `lastExport` in the read), not yet in `openspec/specs/season-settings/spec.md`. |

Both are synced by `/opsx:archive` (lifecycle step 8), after merging `main`. `origin/main` is still `7d60112`, this branch's base.

---

## 4. Design / Specs Coherence Spot Check

| Sample | Design says | Spec counterpart | Gap |
|---|---|---|---|
| D1 One RPC, one snapshot | `vitally_export_season()`, no arguments, `FORBIDDEN` first, one statement | season-export "Only a site coordinator exports…" and "The ZIP holds…" (one snapshot) | None |
| D2 No receipt | Every call records one export | "Each export is recorded, and every call records one" | None |
| D3 `season_exports.row_counts` | Six files built from database rows. Intake and household files counted in the README only | Same wording (aligned during planning self-review) | None |
| D4 `lastExport` | Latest export of the current season, or null | season-settings "The Season settings read carries…" | None |
| D5 Columns | Spec table; codes use staff labels where they exist, otherwise the raw code | "Each CSV has its columns" | None. R6 (household from catalogue group `hh`) and R7 (raw codes) are implementation rulings within the spec. |
| D6 Stored ZIP | Method 0, CRC-32, UTF-8 names | "A standard unzip tool SHALL open it with matching CRCs" | None |
| D7 Sensitive fields | Check fails on SSN / ITIN / routing / account ids or wording | "Bank numbers are never exported…" | None, after the snake_case fix (Task 3 fix round) |
| D8 Page | Download ZIP disabled while running | "While the export runs, Download ZIP SHALL be disabled" | Implementation also disables Cancel and × (final-review fix). This is stricter than the spec, not a contradiction. |

**Drift warnings** (non-blocking):
- `README.txt` has one line beyond the spec's list. It says coded columns use ViTally's internal codes where no staff label exists (final review, Minor 5). The spec lists what the README SHALL hold and does not exclude more. Left as is.
- `plan.md` named household columns `^household1…`, which are PDF field keys. The implementation follows the catalogue group `hh` (ruling R6). Spec and design were already correct, and only the plan text drifted. `plan.md` is a planning record and stays as written.

---

## 5. Implementation Signal

- [x] No unstaged or untracked files in the worktree (`git status --short` is empty, apart from this verification's own `tasks.md` and `verify.md`, committed with it).
- [ ] All related commits pushed. Not yet: the branch isn't on `origin`. Pushing is lifecycle step 9.

**Commit range:** `7d60112..738660a` (14 commits), plus this verification's commit.

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md   # 8 files
git log --oneline 7d60112..HEAD -- docs/superpowers   # 0 commits
```

- [x] Every file there is a historical design document from before this change (parts 1–4d, kept per CLAUDE.md). This branch added or changed nothing under `docs/superpowers/`.

**Leaks:**

| File | Captured in the change? | Action |
|---|---|---|
| — | — | — |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no `[~]` rows (`grep -c '\[~\]'` gives 0), so this section is empty.

| Deferred dogfood (plan §) | Equivalent automated test | Coverage assessment | Real gap? |
|---|---|---|---|
| — | — | — | — |

---

## Overall Decision

- [ ] ✅ PASS — ready for archive and finishing-a-development-branch
- [x] ⚠️ PASS WITH WARNINGS — ready for the next steps, with these noted:
  - Locally, `test:database` has one environmental failure (the `accounts` Edge Function test needs `VITALLY_TEST_MAIL_URL`). It is unrelated to this change, and the pull request's CI `database` job must confirm it.
  - Two non-blocking drift notes (§4).
- [ ] ❌ FAIL — fix the failing artifact and verify again

**Next:** the retrospective (lifecycle step 7, including the ledger summary). Then merge `main` and run `/opsx:archive add-season-export` (step 8). Then finish the branch with a PR (step 9), whose CI run must pass `database`, `sign-in` and `story`.
