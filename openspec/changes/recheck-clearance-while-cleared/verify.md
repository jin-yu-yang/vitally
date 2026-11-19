# Verification Report

**Change**: `recheck-clearance-while-cleared`
**Verified at**: `2026-11-19 09:35` (UTC; CI finished 09:22)
**Verifier**: Claude (controller session), from the worktree `D:/dev/vitally-190`

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`

**Result:**

```text
totals: 19 items, 19 passed, 0 failed (1 change, 18 specs)
openspec validate recheck-clearance-while-cleared --strict  →  valid
```

The non-strict run prints "Requirement text is very long" warnings. They all belong to canonical specs that are already on `main` (132 such warnings on `main`); this change adds none.

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (6.2 is ticked with this report, on the evidence below)

**Open tasks:** none.

| Task | Reason open | Blocks archive? |
|---|---|---|
| — | — | — |

6.2 (the browser story) passed on the CI run linked in §5, on the commit being verified. The user chose the PR's CI over the local stack.

---

## 3. Delta Spec Sync State

| Capability | Sync state | Notes |
|---|---|---|
| `volunteer-clearance` | ✗ needs sync | 8 ADDED requirements, none yet in `openspec/specs/volunteer-clearance/spec.md`. Archive (lifecycle step 8) merges them after `main` is merged into the branch. |

---

## 4. Design / Specs Coherence Spot Check

| Sample | design.md | specs | Gap |
|---|---|---|---|
| Wake re-read before the lists | D1 | "A cleared window re-reads its clearance on wake events" | none |
| Refusal re-read, refusal kept, INELIGIBLE on assigning is expected | D2 | "A refusal makes a cleared window re-read its clearance" | none |
| Own-row save always re-checks | D3 | "Saving one's own Roster row re-reads the clearance" | none |
| Single-flight, quiet when unchanged | D4 | "Clearance re-reads are one at a time and quiet when nothing changed" | none |
| Screens on losing Admin; Add a case keeps page and draft | D5 | "Losing or gaining effective Admin keeps the person in place"; "A form whose capability is gone keeps its text and drops its submit" | none |
| Dialog table, three categories | D5 | "Each staff form follows the capability its RPC checks"; "Dialogs on the roster ceiling keep their submit"; "Every dialog is classified by the capability it needs" | none |
| No realtime | D6 | wake requirement: "Role changes SHALL NOT come through realtime." | none |

**Drift warnings** (non-blocking):

- The final review's fix wave added two behaviours the design doesn't spell out, both within the spec:
  - a locked drawer shows its real refusal sentence (for example "This task is already resolved.") when something other than the capability blocks it;
  - a locked Add a case page hides the "I have checked these answers" confirm step.

  The spec says the submit is replaced when "an effective capability the staff member lacks" blocks the action, so neither is a conflict.

---

## 5. Implementation Signal

- [x] No unstaged files in the worktree (`git status --short` is empty, apart from this report until it is committed)
- [x] All related commits are pushed (`origin/recheck-clearance-while-cleared` = c1505df when CI ran; this report and the tick come after)

**Commit range:** `2a305a9..c1505df` (planning commit, then 11 commits: 5 tasks, 2 task fix rounds, the final-review fix wave, and tasks.md ticks).

**Checks run, and why:**

| Check | Result | Why |
|---|---|---|
| `npm test` (local, worktree) | 2071 pass, 0 fail (baseline 2019) | always |
| `npx openspec validate --all` | 19/19 | spec delta |
| CI run [44491893984](https://github.com/jin-yu-yang/vitally/actions/runs/44491893984) on c1505df (`workflow_dispatch` on the pushed branch) | all 5 jobs passed on the first attempt: `checks`, `database`, `sign-in`, `story (firefox-client)`, `story (chrome-client)` | the views and the controller changed, so the story is needed. The user chose CI over the local stack. |
| Story timing (from the run's evidence lines) | firefox-client 550 s, chrome-client 572 s over 41 phases, under the 900 s limit; 49/49 tests per leg | no tests trimmed |
| Story screenshots (run artifacts, 122 PNGs) | reviewed the screens this change touches: Add a case (`staff--add-case-v2`), Resolve help (`staff--office-resolve-help`), the office case Follow-up tab (`staff--office-case-followup`). Submits render as before for a person who holds the capability. | the story never reaches a locked state, so the "Your roles changed" line and its layout are covered by unit tests, not screenshots |
| `npm run test:database`, `db:migrate:test` | not run locally; CI `database` passed | no SQL or migration changed |
| `npm run test:auth-browser` | not run locally; CI `sign-in` passed | sign-in unchanged |
| `npm run build:hant -- --check` | not run locally; CI `checks` passed | no client text changed (staff text is English only) |

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md   # 8 files
```

- [x] No new files. The 8 existing files are the historical design documents for parts 1–4d, which predate the schema and are kept on purpose (CLAUDE.md: "Do not remove, move or rewrite them"). This change wrote nothing under `docs/superpowers/`.

| File | Captured in the change? | Action |
|---|---|---|
| — | — | — |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

plan.md has no `[~]` deferred rows, so this section needs no table.

One visual check is not covered: what the locked line looks like inside a drawer form and in Add a case's action bar. Unit tests cover its presence, exact copy, escaping, and that typed text is kept. Its look on screen has not been checked, because the story never revokes a role mid-session. This is recorded as a follow-up in retrospective.md.

---

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS: the locked line's layout has not been checked visually (§7); two fix-wave behaviours are not spelled out in design.md (§4). Neither blocks.
- [ ] ❌ FAIL

**Next step:** retrospective (lifecycle step 7), then merge `main` and archive (step 8), then the PR (step 9).
