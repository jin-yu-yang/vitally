# Verification Report

**Change**: `add-posted-updates`
**Verified at**: `2026-11-13 23:00`
**Verifier**: Claude Opus 5.5 (controller session). The `openspec-verify-change` skill is not installed, so the checks below were run directly (CLAUDE.md lifecycle step 6).

## Checks run, and why

| Check | Where | Result |
|---|---|---|
| `npm test` (unit) | local | 1716 of 1717 pass. The 1 failure is `tests/write-test-env.test.mjs` "both files are written with mode 600…", which is Windows-only and fails the same way on `main` (06ebee6). On Windows, the temp path has backslashes, which `formatEnv` rightly refuses. CI's `checks` job (Linux) passes. |
| `npm run build:hant -- --check` | local | Passes. No client text changed. |
| `npx openspec validate --all` | local | 15/15 valid. |
| Database: migrations + `npm run test:database` | CI run [43553004881](https://github.com/jin-yu-yang/vitally/actions/runs/43553004881) `database` | Passed. Not run locally: the local Supabase stack is shared with other sessions, so the user asked for CI only. |
| Sign-in: `npm run test:auth-browser` | CI run 43553004881 `sign-in` | Passed. The sidebar changed for every staff window. |
| Browser: `npm run test:browser` (story + new top-level test) | CI run 43553004881 `story (chrome-client)`, `story (firefox-client)` | Both passed. |

- CI run 43553004881 ran on `3242f76`, the head of the implementation. No job was skipped or cancelled, and none passed only on a re-run.
- Earlier green runs on intermediate commits: 43540446753 (`a435b2a`, migration) and 43549139004 (`53dded2`, browser test).
- **Migration data:** 046 only creates objects and adds one table to the publication. It changes no existing rows, so the CLAUDE.md rule about running a local migration against a stack with `main`'s data does not apply.

**Screenshots reviewed** (artifacts of runs 43549139004 and 43553004881):
- `posted-updates-admin-720`: the form, the preview ("Shown to: All volunteers") and the Posted updates table with the read bar.
- `posted-updates-panel-720` and `-390`: the IRS update marked Pinned and Edited, with "Read the IRS source" and "I've read this" in one row with a gap, wrapping at 390 px, and the footer.
- `posted-updates-setup-390`: the uncleared window's panel shows only the All-volunteers office notice.
- No horizontal page scroll at 390 px (asserted by `shoot()`).

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`.

```text
{"totals":{"items":15,"passed":15,"failed":0},"byType":{"change":{"items":1,"passed":1,"failed":0},"spec":{"items":14,"passed":14,"failed":0}}}
```

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (16/16).

| Task | Why not done | Blocks archive? |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

| Capability | Sync state | Notes |
|---|---|---|
| `posted-updates` | ✗ Needs sync | New capability. Archive creates `openspec/specs/posted-updates/spec.md`. |
| `volunteer-clearance` | ✗ Needs sync | MODIFIED: "Only a cleared staff member reads case data" (`posted_updates` excluded) and "An uncleared staff member sees the setup screen" (Notifications; Post an update for a ceiling admin). |
| `sign-in` | ✗ Needs sync | MODIFIED: "A staff account acts as its own person with no person parameter" (13 RPCs; receipt-less RPCs). |

Syncing is archive's job (lifecycle step 8). Nothing was synced early.

---

## 4. Design / Specs Coherence Spot Check

| Sample | design | specs | Gap |
|---|---|---|---|
| D1 RPC-only `update_reads` | no grant, no policy | "Read state is reachable only through the RPCs" | none |
| D2 live audience | membership + current-season entry + role overlap | "An update's audience is resolved live…" | none |
| D3 feed contract | 13 item fields, badge = unread or unconfirmed | "The feed returns the caller's posted updates in one item shape" | none |
| D4 realtime | `posted_updates` published, `update_reads` not; unpublished rows readable | "Posted-update changes reach open staff windows…", "Staff read posted-update rows only as admins or as their audience" | none |
| Lifecycle | draft → posted → unpublished; delete drafts only; askAgain | the lifecycle and edit requirements | none |

**Drift warnings** (non-blocking):
- design.md D3 says the anonymous refusal is FORBIDDEN. The implementation refuses an anonymous caller with no execute grant (42501), as every existing RPC does. The spec was amended to match (commit 56f1f25). design.md still has the older wording in the RPC table's general line ("refuses a non-staff caller… with FORBIDDEN"), which remains true for signed-in non-staff callers.
- After the final review, the browser `validateUpdate` refuses a keep-at-top date before today unless it is the unchanged saved date. This matches the spec ("a date that cannot be before today"). The database still has no past-date check (brainstorm decision 5), and design.md D5 records the date `min` only.

---

## 5. Implementation Signal

- [x] No unstaged files in the worktree (`git status --short` is empty apart from the ignored `.superpowers/`).
- [x] All implementation commits are pushed (`origin/add-posted-updates` at `3242f76` before this verify commit).

**Commit range**: `06ebee6..3242f76` (18 commits, planning artifacts included).

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

- [x] Either no files exist, or the existing files are legitimate leftovers from before the schema was installed.

`docs/superpowers/specs/` holds 8 files, all present at the branch base `06ebee6`. They are the historical design documents that CLAUDE.md says to keep. This change added nothing there.

| File | Captured in change? | Action |
|---|---|---|
| — | — | — |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no `[~]` rows. Every check ran as an automated test, locally or in CI.

---

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS: the two non-blocking drift notes in §4, and one local unit failure that is Windows-only and pre-existing.
- [ ] ❌ FAIL

**Next**: retrospective (lifecycle step 7), then merge `main`, archive and open the PR.
