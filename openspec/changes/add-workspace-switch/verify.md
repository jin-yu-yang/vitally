# Verification Report

**Change**: `add-workspace-switch`
**Verified at**: `2026-11-25`
**Verifier**: Claude (controller session), on branch `add-workspace-switch`, worktree `D:/dev/vitally-workspace-switch`

Precheck:
- 11 commits on the branch since `origin/main` (87856e6).
- `tasks.md` has 15 of 15 ticked.

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item returns `"valid": true`

**Result**:

```text
25 items, 0 invalid (npx openspec validate --all --json, 2026-11-25).
The text output prints long-requirement warnings only, from existing canonical specs; this change validates clean with --strict.
```

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]`

**Unfinished tasks**: none.

| Task | Why unfinished | Blocks archive? |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

| Capability | Sync state | Notes |
|---|---|---|
| `staff-workspaces` | ✗ Needs sync | New capability. Archive creates `openspec/specs/staff-workspaces/spec.md` |
| `staff-case-work` | ✗ Needs sync | 3 ADDED requirements, not yet in the canonical spec |
| `case-lifecycle` | ✗ Needs sync | MODIFIED "Screening starts when an admin first opens a case". The header is present in the canonical spec; the body is still the old text |
| `volunteer-clearance` | ✗ Needs sync | MODIFIED "Losing or gaining effective Admin keeps the person in place" and "A form whose capability is gone keeps its text and drops its submit". Both headers are present; the bodies are still the old text |

All four are synced by `/opsx:archive` (lifecycle step 8). Nothing was synced early.

---

## 4. Design / Specs Coherence Spot Check

| Sample | Design says | Specs say | Gap |
|---|---|---|---|
| D1, side rule | office = admin/followup/assist/receive_documents; Cases = prepare/review | staff-workspaces "Effective capabilities decide a staff member's sides" | none |
| D2/D10, gaining a side | the side on screen is kept; storage is untouched | volunteer-clearance MODIFIED, "Gaining a side SHALL show the switch and SHALL NOT change the screen or the workspace", with the reload scenario | none |
| D3, remembering | localStorage per user id, survives sign-out, Office fallback | staff-workspaces "The side used last is remembered in this browser", "Blocked storage falls back to Office" | none |
| D7, hint | four lines in order, at most one, Switch to Cases | staff-case-work, three ADDED requirements | none |
| D8, Intaker queue | help rows that are open or assigned to them; documents rows on office-owned cases with `openRequests > 0` | staff-workspaces, the two Intaker requirements | Implementation adds an **Open** button on the Intaker's documents row (ruling R7), which falls under "rows open the office case page" |
| D9, screening | admin and Office side; switching to Office starts it | case-lifecycle MODIFIED | none |

**Drift warnings** (non-blocking): none.

---

## 5. Implementation Signal

- [x] No unstaged files in the worktree. `tasks.md`'s last tick and this report are committed with the archive.
- [x] All code commits are pushed. `10c372f` is on `origin/add-workspace-switch`.

**Commit range**: `90caabd..10c372f`
- `90caabd`: plan.
- `f6ff025` to `2a2326e`: tasks 1–6.
- `d661df4`: task 7.
- `2faee44`: final-review fix wave.
- `10c372f`: uploads walk expects an Intaker in the office.

### Checks run

| Check | Where | Result |
|---|---|---|
| `npm test` (unit) | local | 2527 pass, 0 fail at `10c372f` (baseline 2482 at `87856e6`; +45 tests, none removed) |
| `npx openspec validate --all` | local and CI `checks` | pass |
| `npm run build:hant -- --check`, the `build:intake` leaves-nothing check | CI `checks` | pass. No client text or catalogue changed |
| `npm run test:database` | CI `database` | pass. Nothing in the database changed; run as part of CI only |
| `npm run test:auth-browser` | CI `sign-in` | pass. Sign-in now lands on the remembered side |
| `npm run test:browser` (both browser orders, including the new standalone block "one person switches between Office and Cases") | CI `story (chrome-client)`, `story (firefox-client)` | pass |

**The CI run that stands in for the local database, sign-in and story runs:** run [45262535244](https://github.com/jin-yu-yang/vitally/actions/runs/45262535244) on `10c372f`. Every job passed: `checks`, `database`, `sign-in`, `story (chrome-client)` and `story (firefox-client)`. No local Docker or stack was started.

**Earlier run that failed:** run [45258881496](https://github.com/jin-yu-yang/vitally/actions/runs/45258881496) on `d661df4`.
- `checks`, `database` and `sign-in` passed. Both story legs failed on one existing test, the same way on both browsers: "A volunteer says their uploads were sent, and an admin reviews them" (`tests/browser.mjs`, step 4), with `the work board did not appear on focus within 20000ms`.
- Cause: in that test, Robin has no capabilities until the admin gives them the Intaker role. Under this change an Intaker works in the office (staff-workspaces, "An Intaker lands in the office"), so the test's wait for the Work board was the behaviour this change replaces. It was not flaky.
- Fixed in `10c372f`: the step now waits for the office queue heading. Robin appears in no later step.
- The new switch block passed in that run on both legs (about 11 s).

**Story screenshots reviewed** (artifact `story-screenshots-chrome-client` from run 45262535244): the office board, the work board, the volunteer case page and Post an update. The story's staff people each have one side only, so they show no switch, and their sidebars are as before. The new switch block takes no screenshots, so the switch's own look (its spacing under the brand, its hover tint, its place next to the fixed sidebar toggle) is not covered by a screenshot. That is noted for the PR reviewer.

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md 2>/dev/null
```

- [x] No files, or the files are legitimate ones from before the schema was installed

8 files exist. They are the historical design documents (parts 1–4d, last changed 2026-10-05), which CLAUDE.md keeps in place. This change wrote nothing under `docs/superpowers/`.

| File | Captured in the change? | Action |
|---|---|---|
| — | — | — |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no `[~]` rows, so this section is empty and passes.

---

## Overall Decision

- [ ] ✅ PASS — ready for finishing-a-development-branch and archive
- [x] ⚠️ PASS WITH WARNINGS — ready for the next steps, with one note: the switch's appearance has no screenshot coverage (see §5). The reviewer should look at it in the live test environment or a local run.
- [ ] ❌ FAIL — fix the failing artifact and re-run verify

**Next step**: write `retrospective.md` (with the ledger summary), then delete the SDD workspace. Check `main` and #278 (open, and `main` is unchanged at 87856e6, so there is nothing to merge). Then run `/opsx:archive add-workspace-switch` and open the PR.
