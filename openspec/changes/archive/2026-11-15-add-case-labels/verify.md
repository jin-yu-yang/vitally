# Verification Report

> Produced after apply completed, by running the schema's verify checks
> directly (the `openspec-verify-change` skill is not installed; CLAUDE.md
> section 2, step 6).

**Change**: `add-case-labels`
**Verified at**: `2026-11-15 17:20` (America/New_York)
**Verifier**: Claude (controller session), on branch `add-case-labels` in worktree `.claude/worktrees/add-case-labels`

**Prechecks**
- **Commits since main:** 31 on `6add349..HEAD` (> 0).
- **Ticked tasks:** 25 of the 25 in `tasks.md` (> 0).

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`

**Result**:

```text
Totals: 16 passed, 0 failed (16 items)
```

The only output besides the totals was INFO notes ("Requirement text is very long") on
existing canonical specs; there were no errors and no warnings.

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (25 of 25)

**Open tasks**: none.

| Task | Why it is open | Blocks archive? |
|---|---|---|
| — | — | — |

Two tasks were ticked on evidence other than a clean local run. Both are recorded in the ledger:
- **5.4** was ticked only after the label screenshots were redone. The first ones were hidden by the sidebar overlay; the final-review fix wave (`bb0965a`) corrected them, and both the local and the CI screenshots were reviewed.
- **2.6** was ticked on the green CI `database` job (see section 5). CLAUDE.md allows a CI run to stand in for the local database run.

---

## 3. Delta Spec Sync State

| Capability | Sync state | Notes |
|---|---|---|
| `case-labels` | ✗ Needs sync | New capability. `openspec/specs/case-labels/` does not exist yet; archive creates it. |
| `volunteer-clearance` | ✗ Needs sync | Two MODIFIED requirements. Both headers match the canonical spec exactly ("Only a cleared staff member reads case data", "The case RPCs refuse an uncleared staff member first"), so archive can apply them. |
| `staff-case-work` | ✗ Needs sync | One MODIFIED requirement. Its header matches the canonical spec exactly ("Staff see every case except a client's private draft"). |

All three are expected to be pending until `/opsx:archive` (CLAUDE.md step 8). `main` has not moved since the branch point (`6add349`), so the canonical specs the deltas were written against are current.

---

## 4. Design / Specs Coherence Spot Check

| Sample | Design says | Spec counterpart | Gap |
|---|---|---|---|
| D2: removal is a status change | links are marked inactive, never deleted; Realtime reports it | "A removed label is recorded, never deleted" (live removal, re-adding reactivates the same row) | None |
| D3: separate RPCs | revision and `updated_at` untouched; no conflict for an open form | "A label change leaves the case row alone" (open form not interrupted; pool order unchanged) | None |
| D4: check order | NOT_CLEARED, FORBIDDEN (client), NOT_FOUND, FORBIDDEN (`works_on_case`), VALIDATION, INVALID_TRANSITION (closed) | "Staff who work on a case add and remove its labels" lists the same order | None |
| D6 and D7: visibility and starter labels | staff-only, cleared-gated RLS; a trigger plus a backfill | "Labels are staff-only"; "Every workspace starts with three labels"; volunteer-clearance now lists 23 tables and 8 RPCs | None. The service_role grants added under ruling R4 are infrastructure the spec doesn't describe. |
| D10 and D11: the label menu and pool filter | inline menu (search, toggles, admin create and edit); single-choice Label filter with `No label` | "The case header's label menu"; "The case pool filters by label" | Minor. See the drift warnings below. |

**Drift warnings** (non-blocking):
- **The search filters the label list (ruling R7).** The spec says the menu has "a search box" and "one toggle per workspace label". The implementation shows only the labels that match the search. That is how a search box normally behaves, and every label is listed when the search is empty, but the spec's sentence doesn't say so.
- **An extra "New label" button.** With an empty search, admins get a "New label" button, which the spec doesn't mention. The spec's `Create "<text>"` row still appears only when the search matches no label. The final reviewer judged it a harmless addition.
- **The design picture shows a "Labels" multi-select button.** The implementation uses a single-choice dropdown labelled "Label". The user decided this, and it is recorded in brainstorm Q6, design D11 and the spec.

---

## 5. Implementation Signal

- [x] No unstaged files in the worktree (`git status --short` is empty).
- [x] All implementation commits are pushed. `origin/add-case-labels` is at `8a1b4ed`. The later commits change only `openspec/changes/add-case-labels/` (the `tasks.md` tick and this file) and are pushed with the archive.

**Commit range**: `6add349..HEAD` (main at `6add349`).
- **Implementation:** `31b692a` … `8a1b4ed`.
- **The late fix:** `80d5729` carries labels to the case page and adds live refresh.
- **The final-review fix wave:** `bb0965a`.

**Checks run, and why**

| Check | Why it's needed | Where | Result |
|---|---|---|---|
| `npm test` | always | local (Windows) | 1737 / 1738. The one failure, `tests/write-test-env.test.mjs` "both files are written with mode 600…", is a known Windows-only failure that also fails on `main` (user-acknowledged). CI `checks` runs it on Linux: pass. |
| `npm run db:migrate:test` + `npm run test:database` | migration 051, SQL functions, RLS, Realtime | CI `database` job: **success**. Locally, on a stack that already had `main`'s migrations (needed because 051's backfill writes into existing workspaces): 051 applied cleanly; the full suite gave 596 / 599. | The 3 local failures are Realtime "control never arrived within 15000ms" timeouts in `tests/database-realtime.mjs` ("one applicant's rows…"). Run alone, that file and `database-staff-identity.mjs` pass 53 / 53. One local run showed 10 such timeouts while two suites overlapped on the stack; with nothing else running, it was back to 3. The final reviewer found nothing in the change that would make Realtime less reliable. |
| `npm run test:browser` | views, `app.mjs`, the controller, CSS, the story | local: 90 / 90 (both pairings) at `bb0965a`. CI `story (chrome-client)` and `story (firefox-client)`: **success**. | The label story phase passes in both pairings. |
| `npx openspec validate --all` | CI `checks` gate | local and CI | 16 / 16 |
| `npm run build:hant -- --check` | — | CI `checks` (part of the job) | Not needed for this change: no client text changed (staff screens only). |
| `npm run test:auth-browser` | — | CI `sign-in`: success | Not needed for this change: sign-in is untouched. It passed anyway in CI. |

**CI run**: https://github.com/jin-yu-yang/vitally/actions/runs/43766090390
- **Run details:** run on `8a1b4ed` with `gh workflow run ci.yml --ref add-case-labels`. All five jobs succeeded on the first attempt: `checks`, `database`, `sign-in`, `story (chrome-client)`, `story (firefox-client)`. No re-runs.
- **Commits since the CI run:** the commits after `8a1b4ed` change only planning documents, so the code verified by CI is the code being archived. The pull request's own CI run will re-check the final head.

**Story screenshots reviewed** (CI artifacts `story-screenshots-chrome-client` / `-firefox-client`, kept until 2026-11-22):
- `*--case-labels-created-green-720.png`: the case header shows the green "Amended" chip with its remove ×, "+ Add a label", and the open Labels menu (search "Amended", the row marked "On this case", Edit).
- `*--case-labels-pool-city-tax-720.png`: the case pool with the Label filter set to City Tax, "Showing 2 of 17 cases", and both rows carrying a City Tax chip (one also "Amended return").

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md 2>/dev/null
```

- [x] No files, or the files that exist are legitimate leftovers from before the schema was installed

The directory holds 8 files. All are historical design documents from parts 1–4d, which CLAUDE.md says to keep. `git log 6add349..HEAD -- docs/superpowers` is empty, so this change wrote nothing there. The design output is in `brainstorm.md` and `design.md`.

| File | Captured in the change? | Action |
|---|---|---|
| — | — | — |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no `[~]` (deferred) rows, so this section is empty by rule.

| Deferred dogfood (plan §) | Equivalent automated test | Coverage assessment | Real gap? |
|---|---|---|---|
| — | — | — | — |

---

## Overall Decision

- [ ] ✅ PASS — ready for finishing-a-development-branch and archive
- [x] ⚠️ PASS WITH WARNINGS — the later steps can go ahead, with these notes:
  - **Local full database run:** it is not fully green on this Windows machine. 3 Realtime timeouts recur under the parallel full run and pass in isolation. The CI `database` job is green on the same code.
  - **Drift between the spec text and the implementation (section 4):** the search filtering and the "New label" button. Both are behaviour the user would expect and both are recorded in the ledger. A later change could add one scenario sentence to the canonical spec.
- [ ] ❌ FAIL — go back to the failing artifact, fix it, and verify again

**Next**: CLAUDE.md step 7. Write `retrospective.md` (including the summary of the SDD ledger's rulings, parked findings and deferred minor findings), then delete the SDD workspace `.superpowers/sdd/plan/`. Then step 8 (merge `main`, `/opsx:archive add-case-labels`) and step 9 (finish the branch and open the PR).
