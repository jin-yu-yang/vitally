# Verification Report

> The `openspec-verify-change` skill is not installed in this repository, so the controller ran its PRECHECK and checks directly (CLAUDE.md, lifecycle step 6).

**Change**: `add-clearance-uploads`
**Verified at**: `2026-11-20` (America/New_York)
**Verifier**: Claude Opus 5.5 (subagent-driven-development controller)

PRECHECK:
- commits on the branch since `origin/main` (fdd64a2): 25 at 48412f4;
- ticked tasks in `tasks.md`: 26 (25 before 8.2 was ticked).

Both are positive.

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`.

**Result**:

```text
{"totals":{"items":21,"passed":21,"failed":0},"byType":{"change":{"items":1,"passed":1,"failed":0},"spec":{"items":20,"passed":20,"failed":0}}}
```

`npx openspec validate add-clearance-uploads --strict` also passes. Requirements that would have gone over 500 characters were split at planning.

| Item | Type | Issues |
|---|---|---|
| — | — | none |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (26/26).

How 8.2 was met: the new browser test was not run locally, because the machine had about 0.3–1 GB free (ruling R9). CI run [44748648528](https://github.com/jin-yu-yang/vitally/actions/runs/44748648528) ran it in both story legs: "A volunteer says their uploads were sent, and an admin reviews them" passed in 12.4 s (chrome-client) and 12.6 s (firefox-client). The story screenshots were reviewed (section 5).

| Task | Why not done | Blocks archive? |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

Archive merges the deltas (lifecycle step 8). Nothing is synced before then, by design.

| Capability | Sync state | Note |
|---|---|---|
| volunteer-clearance | ✗ needs sync | ADDED 3 (mark sent, refusals, repeat/revision); MODIFIED 2 (read own clearance: `sentAt`, `uploadUrl`, empty capabilities when uncleared; setup screen) |
| volunteer-roster | ✗ needs sync | ADDED 5 (Mark reviewed, its refusals, drawer lines, sidebar count, count re-read); MODIFIED 3 (search/filter with Show, edit clears sent dates, Roster row) |
| season-settings | ✗ needs sync | MODIFIED 1 (the upload-link sentence) |

---

## 4. Design / Specs Coherence Spot Check

| Sample | design | specs | Gap |
|---|---|---|---|
| D1 sent dates | `roster_entries.form_13615_sent_at` / `photo_id_sent_at`; null = nothing waiting; `certificates.status` untouched | volunteer-clearance "marks their own … as sent"; volunteer-roster Roster row | none |
| D2 send | caller only; `NO_ROSTER_ENTRY`, `PHOTO_ID_NOT_NEEDED`; 13615 not refused when cleared; raises revision | volunteer-clearance ADDED ×3 | wording fixed (see drift) |
| D3 Mark reviewed | `is_workspace_admin`, expected revision, receipt; no-op when nothing waits | volunteer-roster "An admin marks a sent document reviewed", "Mark reviewed is refused…" | none |
| D4 Save clears | 13615 on a roles/certificate change; photo on Photo ID checked or unticking New | volunteer-roster MODIFIED "An admin can edit a volunteer" | none |
| D5 clearance answer | `sentAt`, `uploadUrl` with a current-season entry, `capabilities: []` when uncleared (#193 item 7) | volunteer-clearance MODIFIED "can read their own clearance" | none |
| D8 sidebar count | workspace admins only; "Volunteers · n"; singular aria-label at 1 | volunteer-roster "sidebar counts uploads to review" | none |

**Drift warnings** (non-blocking, fixed in design.md at verify):
- D2 said every refusal comes before the receipt. During apply, ruling R5 moved `NO_ROSTER_ENTRY` / `PHOTO_ID_NOT_NEEDED` after the reservation, so a repeated request returns the stored result as the spec requires. A refusal still stores nothing, because the transaction rolls back. D2 now says this.
- The final review moved the send's profile lock before the entry lock (same order as Save). A staff caller with no profile row now gets `NOT_FOUND`. The spec gives no order for these refusals. D2 now records the lock order.

---

## 5. Implementation Signal

- [x] The worktree has no unstaged files after this report's commit.
- [ ] Every relevant commit is pushed. The commits after 48412f4 are verify-time artifacts (8.2 tick, design.md D2 wording, this report, the retrospective) plus the archive. They are pushed with the archive at lifecycle step 9.

**Commit range**: `fdd64a2..` the branch head. Migration: `supabase/migrations/053_clearance_uploads.sql` (adds two nullable columns; changes no existing rows).

**Checks run and why**:
- **`npm test`** (always): 2192/2192 locally at 427bf79 (baseline 2132). Two later runs died out of memory in four unrelated files. Those passed at `--test-concurrency=2`. CI `checks` also passed.
- **`build:hant -- --check`**: CI `checks`. No client text changed (staff screens are English only).
- **`openspec validate --all`**: locally (section 1) and in CI `checks`.
- **Database** (053, new RPCs): `npm run db:migrate:test` applied 053 on a throwaway stack that already had main's migrations 001–052. `tests/database-clearance-uploads.mjs` passed 46/46 there. **The local full `npm run test:database` was cut short by memory**: it hit its timeout with 100–450 MB free, and the files that failed under that pressure (actions, filing, staff-identity, volunteer-roster) passed when re-run alone. The clean full run is CI's `database` job: **814/814** (main fdd64a2: 768).
- **Sign-in**: CI `sign-in` job passed. Not touched by this change, run anyway as part of CI.
- **Browser** (views, controller, `app.mjs`, CSS): CI story legs, below. No full local run (memory).

**CI evidence**: run [44748648528](https://github.com/jin-yu-yang/vitally/actions/runs/44748648528) on `48412f4`.
- **Jobs:** `checks`, `database`, `sign-in`, `story (chrome-client)` and `story (firefox-client)` all succeeded on the first attempt.
- **Story legs vs main run 44700072367 (fdd64a2):**
  - chrome-client story: 643 s → 591 s;
  - firefox-client story: 589 s → 556 s;
  - browser tests per leg: 50 → 51 (one new test, separate from the story; none removed).
- **Screenshots** (from the run's artifacts, 63 per leg): the Season settings shots (720 and 390 px, both legs) show the new sentence: "Volunteers open this from "Finish your setup". Use a folder only site coordinators can see." The staff board, posted-updates and notifications shots show no regressions. The data is fictional, and there is no horizontal scroll. The new test takes no screenshots, so the setup-screen upload controls, the Show filter, the drawer's sent lines and the sidebar count are checked by its assertions, not by eye.
- **Commits after 48412f4** are artifacts only (no code). The pull request's CI run on the final head must pass before merge.

**Hosted step** (after merge, same day): `node --env-file=.env.admin tools/admin/migrate.mjs --target classroom` (with `NODE_EXTRA_CA_CERTS`) applies 053.

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md 2>/dev/null
```

- [x] The 8 files there are historical design documents (last changed 2026-10-05, before the schema). This change added none.

| File | Captured in the change? | Action |
|---|---|---|
| — | — | none |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no `[~]` rows, so this section is empty.

---

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS: the design.md D2 drift was fixed at verify; the local full database run was cut short by memory, and CI's clean `database` run (814/814) stands in for it; the new UI is not covered by a screenshot.
- [ ] ❌ FAIL

**Next step**: retrospective (lifecycle step 7), then merge main and archive.
