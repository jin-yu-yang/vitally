# Verification Report

**Change**: `add-returning-volunteers-and-roster-csv`
**Verified at**: `2026-11-22 06:45` (New York)
**Verifier**: Claude (controller of the subagent-driven apply), in worktree `D:/dev/vitally-returning-volunteers`

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`

**Result**:

```text
24 items; invalid: none
(the CLI also prints "requirement text is very long" warnings, as it does for the existing specs; none is an error)
```

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (18 of 18)

**Incomplete tasks**: none.

| Task | Why incomplete | Blocks archive? |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

| Capability | Sync state | Notes |
|---|---|---|
| `volunteer-roster` | ✗ Needs sync | Six ADDED requirements; archive merges them. |
| `local-seed-data` | ✗ Needs sync | One MODIFIED ("The local seed command adds fictional volunteers", text kept plus the stated exception) and two ADDED; archive merges them. |

Expected at this step: CLAUDE.md step 8 merges `main` into the branch and then archives, which syncs both.

---

## 4. Design / Specs Coherence Spot Check

| Sample | Design | Spec | Gap |
|---|---|---|---|
| D1 Edit path | A pick saves through the existing `vitally_save_volunteer` Edit call | "Saving a volunteer who is not on the current roster adds them to it", plus "Picking ... Saving SHALL send `vitally_save_volunteer` with the picked person ... and their profile revision" | none |
| D2 who is offered | Last season's people not on this roster; full-email match on any other profile, "Earlier volunteer" | "Add a volunteer offers last season's people" | none |
| D3 fill and lock | Person fields + usual days; not new; no roles or certificates; email locked; "Not this person" | "Picking a returning volunteer fills their person fields only" | none |
| D6/D7 CSV | Columns, labels, NY dates, filename, BOM, quoting, guard | the three CSV requirements | none |
| D8 seed | Three past-only people + one of the 8; direct SQL; re-run delete | `local-seed-data` MODIFIED + two ADDED | none |

**Drift warnings** (non-blocking):

- **The search box is hidden when nobody can be offered.** With no earlier volunteers at all (`state.earlierVolunteers` empty, e.g. a workspace's first season), the Add drawer shows no search box. The spec says the drawer "SHALL start with a search box". With nobody to find, the box could only come up empty. Ruling recorded during apply; flagged here as a literal deviation.
- **The plan's Review Focus 4 was wrong.** It said a full-email match still works with no current season. `listEarlierVolunteers()` returns `[]` when the workspace has no current season, so nothing is offered then, as design D5 states. The design and specs are right; only the plan's wording was off.
- **Two design details were settled during apply.** A volunteer with no languages gets an empty Languages cell, not the table's "—". A pick whose person has since left the earlier list shows the existing "This volunteer could not be opened" drawer.

---

## 5. Implementation Signal

- [x] No unstaged files in the worktree (only git-ignored `.superpowers/` scratch).
- [x] All commits pushed. The CI run below is on the pushed head.

**Commit range**: `fb04dbc..edf3223` (27 commits, including the merge of `main` at `edf3223`; this file and the 8.2 tick follow).

**Checks run, and why** (CLAUDE.md, Verification):

- **Unit, local:** `npm test`, 2352 / 2352 pass on `edf3223`.
- **Chinese text, local:** `npm run build:hant -- --check` passes. No client text changed; run because CI's `checks` job includes it.
- **Specs, local:** `npx openspec validate --all`, 24 passed.
- **Full CI on `edf3223`:** https://github.com/jin-yu-yang/vitally/actions/runs/45016989378. Every job passed on its first run:
  - `checks`;
  - `database`: 911 / 911, including "Edit adds a past-season volunteer to the current season" and "the previous season's roster is added, and replaced on a re-run";
  - `sign-in`: 28 / 28;
  - `story (chrome-client)`: 54 / 54;
  - `story (firefox-client)`: 54 / 54.

  The new browser block, "An admin re-adds a returning volunteer and exports the Roster", passed in both legs. This run stands in for the local database, sign-in and story runs: it ran on the verified commit, and every covering job passed. There is no local Docker on this machine.
- **Quick runs while iterating** (they don't stand in for the full run):
  - `database-quick.yml`: 45012950646, 45013235950 (`tests/database-volunteer-roster.mjs`) and 45014357752 (`tests/database-seed.mjs`). Earlier quick runs that failed on test setup are listed in `retrospective.md`.
- **Screenshots reviewed** from the run's `story-screenshots-chrome-client` artifact: `roster-returning-picker-720.png` and `roster-returning-picker-390.png`. The search label, the "ker" match and the candidate card are correct, and there is no sideways scroll at 390px.
- **CI starts from an empty database.** No migration in this change, so no local run on a stack holding `main`'s data is needed.

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md 2>/dev/null   # 8 files
```

- [x] Files exist, and they are legitimate files from before the schema was installed. The folder was last changed 2026-10-05; this change wrote nothing there, and CLAUDE.md freezes it.

| File | Captured in the change? | Action |
|---|---|---|
| 8 historical design docs (parts 1–4d) | not from this change | none: historical, frozen |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no `[~]` rows, so this section is empty and passes.

---

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS: the three items in §4 (a hidden search box when nobody can be offered; the plan's Review Focus 4 wording; two details settled during apply), none blocking
- [ ] ❌ FAIL

**Next**: `retrospective.md` (CLAUDE.md step 7), then merge `main`, archive (step 8) and open the PR (step 9).
