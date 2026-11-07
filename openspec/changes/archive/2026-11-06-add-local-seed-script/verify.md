# Verification Report

**Change**: `add-local-seed-script`
**Verified at**: `2026-11-06 15:59`
**Verifier**: Claude Code, the controller of the subagent-driven apply. The `openspec-verify-change` skill is not installed, so the checks were run directly.

PRECHECK passed:
- the branch has 13 commits since `main`;
- `tasks.md` has 20 of 20 tasks ticked.

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`

**Result:**

```text
Totals: 11 passed, 0 failed (11 items)
```

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (20 of 20)

How the verification tasks were met:
- **6.1** `npm test`: 1499 of 1499 pass on the final tree.
- **6.2** `npm run db:migrate:test`, then `npm run test:database`: 480 of 480 pass on the final tree.
  - The suite includes `tests/database-seed.mjs` (16 tests), with the three checks added after the final review.
  - The run was the only suite on the local stack. No other test process was running, and the only other connection was a browser tab.
  - The count before this change wasn't measured separately. This change only adds tests.
- **6.3 The roster command:** run against the rehearsal workspace with the new example roster.
  - It used a scratch copy that carries that workspace's id, so the developer's own `.vitally-roster.local.json` was untouched.
  - It created the 4 role accounts.
- **6.3 The seed:** `VITALLY_ALLOW_LOCAL_SEED=1 npm run seed:local` was run three times:
  - `Seeded 11 cases (removed 0 from the previous run).`;
  - then `… (removed 11 …)`;
  - and once more after the final-review fixes, `… (removed 11 …)`.
- **6.3 The run file:** it contains no `@`.
- **6.3 The sign-in check, done in the database instead of a browser:**
  - The Preparer holds 7 seeded cases.
  - The Reviewer is the named reviewer on 3.
  - The escalated follow-up is open and assigned to the Site Coordinator.
  - The help request is open and unassigned.
- **6.3 not done:** nobody signed in as the Preparer in a browser.
- **Without the flag:** `SEED_NOT_ALLOWED: Set VITALLY_ALLOW_LOCAL_SEED=1 to seed the local test stack.`, exit 1.
- **6.4** `npx openspec validate --all`: 11 of 11.
- **Also:** `npm run build:hant -- --check` exits 0. The change makes no edit under `supabase/`, `src/` or `server.mjs`, so the browser story and `test:auth-browser` weren't needed: nothing a browser shows, and nothing about sign-in, changed.

| Task | Not done because | Blocks archive |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

| Capability | Sync state | Notes |
|---|---|---|
| `local-seed-data` | ✗ Needs sync | A new capability with 6 ADDED requirements. Archive creates `openspec/specs/local-seed-data/spec.md`. |

That is expected before archive (CLAUDE.md lifecycle step 8).

---

## 4. Design / Specs Coherence Spot Check

| Item | Design | Spec | Gap |
|---|---|---|---|
| D1 acting technique | `set local role authenticated` plus JWT claims inside one transaction per call, with a fallback to Auth admin sessions | "Every seeded case is built through the public RPCs" | None. The technique worked, so the fallback wasn't used. |
| D2 local-only guard | `assertTestTarget` plus mode `local`; the flag is checked by the command only | "The seed runs only against the local test stack" | None. The guard and the connection now use the same configuration. |
| D3 role accounts | site_coordinator, preparer, reviewer; client A is the first applicant; the follow-up default must be site_coordinator | "The seed acts as role-named accounts found from the roster file" | None |
| D4 run file | `.vitally-runs/seed-<workspaceId>.json`, written as each item is created | "Running the seed again replaces the previous set" | None. Deletes always use the target workspace, never the file's. |
| D5 scenarios | client A's case plus ten office scenarios plus a help request | "The seed creates one client case, ten office scenarios and one help request" | Reworded during apply, with the user's approval (below) |

**Drift warnings** (non-blocking):

- **The corrections case's reviewer.** `REQUEST_CORRECTIONS` clears `cases.reviewer_id` (migration 006).
  - The spec first said that case has "the Reviewer as reviewer".
  - With the user's approval (`/opsx:update`, dcb4a80), the spec, plan and brainstorm now say the Reviewer wrote that case's correction round, and the case has no current reviewer until it's resubmitted.
  - The code and test follow the product.

---

## 5. Implementation Signal

- [x] Nothing unstaged in the worktree. This report and the retrospective are committed next.
- [ ] Every commit pushed. Not yet: the branch is pushed at the finish step.

**Commit range:** `a170833..d4e7907`, after `main` with #142 was merged in.

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md   # 8 files
```

- [x] The 8 files are historical design documents from parts 1–4d, which CLAUDE.md says to keep. This change wrote nothing there.

| File | Captured in the change | Action |
|---|---|---|
| — | — | None |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no `[~]` rows.

Plan Task 6 step 5, signing in as the Preparer and the Site Coordinator with `npm start`, wasn't done in a browser:

| Manual check | Automated or database equivalent | Coverage | Real gap? |
|---|---|---|---|
| Preparer signs in and sees their cases first | `tests/database-seed.mjs` asserts `preparer_id` on the seeded cases. The rehearsal-workspace query showed the Preparer holding 7 seeded cases. | Data layer: who holds what. The Work board's ordering is existing app behaviour that this change doesn't touch. | Partly. Nobody looked at the screen. |
| Site Coordinator sees the follow-up and the help request | The database tests assert the open follow-up assigned to the Site Coordinator and the open, unassigned help request. Confirmed on the rehearsal workspace. | Data layer | Partly, as above |

These are recorded in the retrospective as a follow-up: the browser-story step (#132) signs in as these accounts on seeded data.

---

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS: the browser sign-in check was done at the database level (§7), and the spec was reworded during apply with the user's approval (§4).
- [ ] ❌ FAIL

**Next step:** write the retrospective, delete the SDD workspace, merge `main`, archive, then push and open the PR.
