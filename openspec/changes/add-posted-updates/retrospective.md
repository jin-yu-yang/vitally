# Retrospective: add-posted-updates

Issue #150. The design was agreed in conversation on Nov 13, 2026. After that, the user told me to run the whole lifecycle on my own and to stop only for agreed behaviour, scope, hard-to-undo actions, or a check that still failed after three attempts. None of those happened.

## 0. Evidence

| Measure | Value |
|---|---|
| Commits (`06ebee6..b7a1a62`) | 19: 1 planning, 9 implementation, 1 spec amendment, 7 task ticks, 1 verify |
| Diff outside `openspec/` | 30 files, +5034 / −63 |
| Tasks | 16/16 (`tasks.md`) |
| Plan tasks / subagent dispatches | 6 tasks. 21 dispatches: 1 explore, 6 implementers (1 resumed for a fix round), 6 task reviewers, 1 scoped re-review, 1 whole-branch review, 1 fix wave, 1 fix-wave re-review, plus the fix-round resume |
| Fix rounds | Task 2: 1 round (irs.gov parity). Final review: 1 fix wave (2 Important + 5 minor) |
| CI runs | 43539737021 (red: test assumption), 43540446753 (green), 43547959317 (green), 43549139004 (green), 43553004881 (green on implementation head `3242f76`) |
| Unit tests | 1627 → 1717 (+90). The one local failure is Windows-only and pre-existing. |
| Database tests | 573 in the `database` job on `a435b2a`; `tests/database-posted-updates.mjs` is new |
| Browser | top-level tests in `tests/browser.mjs`: 7 → 8. The main story is unchanged: no phase or assertion was added, merged or removed. Story orders took 582 s and 525 s (limit 900 s); the new test about 24 s. |
| New external dependencies | none |
| OpenSpec validate | 15/15 valid at verify |
| Post-merge bugs | n/a (not merged) |
| Commit chain | plan → migration+DB tests → test fix → spec wording → rules → irs.gov fix → store → controller → views → browser test+docs → screenshot fix → final fixes → verify |

## 1. Wins

- **The catalogue tests caught the surface exactly.** Policies, RPCs, `vitally_policy`, published tables and the 21-policy gate are each pinned by a test. Task 1 updated them deliberately (commit `7951336`), and the reviewer could check "exactly 13 RPCs" mechanically.
- **The test failure was fixed in the test, not the migration.** The first CI database run failed because the tests assumed a new staff member has no roster entry, but `add_staff_member` creates one. The fix went into the tests (`a435b2a`).
- **The SQL/browser mismatch was caught at the task gate.** The Task 2 reviewer ran the browser validator against an equivalent of the SQL regex and found 9 links the browser accepted and the database refused. The fix (`e6537ed`) uses the same regex.
- **The whole-branch review found what per-task reviews couldn't:**
  - the unread highlight disappeared one round trip after the panel opened;
  - a stale `notificationsOpen` could keep marking items read with no panel shown.
  Both span controller and view. Both were fixed with tests (`3242f76`).
- **CI-only database and browser testing worked:**
  - Implementers ran CI themselves in bounded waits, as the no-hang rules require. Nothing hung.
  - Every story leg passed on the first attempt after each push.

## 2. Misses

- 🟡 **Spec vs plan wording drift on two refusals.**
  - The spec said "naming the audience" while the plan named the field `roles`.
  - The spec said FORBIDDEN for anonymous callers, though anonymous callers have no execute grant.
  - Both were caught by the Task 1 implementer, ruled, and the spec amended (`56f1f25`).
  - Writing the plan's field names and error rules into the spec text in the first place would have avoided this.
- 🟡 **The first screenshot was taken with the sidebar overlay covering the page** (`53dded2`). It cost one extra CI run.
- 📌 **One finding in the final review came from a misread.** It said a CSS rule was empty; it isn't. The rule was parked with a ruling.
- 📌 **The plan had a muddled step 9 in Task 6.** I caught it during self-review and rewrote it before commit.

## 3. Plan deviations

| Task | Deviation | Why |
|---|---|---|
| 1 | Also touched `tests/database-actions.mjs` and `tests/store.test.mjs` | The generic RPC test needed a draft id, and the exact `STAFF_TABLES` list lives in the unit test |
| 1 | `RPC_SIGNATURES` authorizes `vitally_posted_updates` as the site coordinator, not "staff" | The RPC is admin-only; the plan's wording was loose |
| 2 | Extra `keepTopUntil` shape check ("Enter a valid date.") | Not in the copy list; accepted by ruling |
| 4 | `saveUpdate` / `updateAction` return a receipt or null, not a boolean | So the view can pick the toast; the dispatch preferred this |
| 4 | `navigate` also redirects a non-admin away from `office-updates` | Defence in depth; tested |
| 5 | The `shell.test.mjs` sidebar test changed from forbidding Notifications to expecting it | Roadmap part 1 kept Notifications out of the sidebar until it existed; this change builds it |
| Final | Browser refuses a past keep-at-top date unless it is the unchanged saved date | The spec says "cannot be before today"; the form was `novalidate` |
| Final | NOT_FOUND maps to "This update is no longer in the table." | Another admin's deleted draft gave a generic error |

## 4. Skill / workflow compliance

| Skill | Used? |
|---|---|
| `superpowers:using-git-worktrees` | ✓ (already in the linked worktree `D:/dev/vitally-updates`; none created) |
| `superpowers:subagent-driven-development` | ✓ (ledger, pre-flight scan, per-task reviews, fix loop, final review, fix wave, re-review) |
| `superpowers:test-driven-development` (transitive) | ✓ (RED/GREEN in every implementer report. For the database task, RED was CI run 43539737021.) |
| `superpowers:requesting-code-review` (transitive) | ✓ (code-reviewer template for the final review) |
| `superpowers:finishing-a-development-branch` | ✓ (lifecycle step 9) |
| `superpowers:brainstorming` / `writing-plans` (planning) | ✓ (output redirected into the change folder) |

### Deliberately Skipped Skills
- **The brainstorming skill's builder check** (a subagent reading the written design before hand-off) was not run.
  - **Why this cycle:** the user had already ruled on the four open decisions and told me to proceed without approval gates. The design was a write-up of agreed decisions plus a "Decided without the user" list for their review.
  - **How to prevent recurrence:** one-off, schema boundary case. When the user explicitly removes the approval gates mid-brainstorm, the builder check's only output (questions for the user) has no recipient. The decided-without-user list goes to the user for review instead.

## 5. Surprises

- **`add_staff_member` gives every new staff member a current-season roster entry.** The database tests assumed otherwise (CI 43539737021).
- **Realtime checks RLS against the new row.** If an unpublished row became unreadable, open windows would never hear about the unpublish. This was known at design time (decision 6), and story step 8 confirms the live removal.
- **`new URL()` normalises far more than expected:** backslashes, percent-encoded hosts, userinfo. Matching a SQL regex means using the same regex, not a URL parser.
- **One unit test fails on Windows only** (`tests/write-test-env.test.mjs`, temp paths with backslashes). It isn't related to this change. It's worth a separate issue.

### Ledger summary (every ruling, parked and deferred finding)

**Rulings**
1. The pre-flight scan was clean. Task 1 adds `posted_updates` to `STAFF_TABLES`; Task 3 doesn't add it again.
2. Tasks 1 and 6 run CI themselves, because database and browser tests are CI-only (user's instruction).
3. A roles audience with no roles gives VALIDATION detail `roles`, and the spec scenario was reworded to match. Cost if wrong: one string.
4. Anonymous callers are refused by the missing execute grant (42501), not FORBIDDEN, as in every existing RPC. The spec was amended. Cost if wrong: a test assertion.
5. Task 1's edits to `tests/database-actions.mjs` and `tests/store.test.mjs` were accepted.
6. `toUpdateRequest` always sends exactly ten keys. The database refuses any other set (VT007 `update`).
7. The malformed `keepTopUntil` message is "Enter a valid date.". Cost if wrong: one string.
8. A failed feed read stays local (`lists.updates = failed`) and never blocks the board or setup screen.
9. While the panel is open, later feed re-reads mark only newly shown unread items.
10. The CONFLICT message is "Someone changed this update. Check the table and try again."; the INVALID_TRANSITION message is "This update can no longer be changed.".
11. `saveUpdate` / `updateAction` resolve to a receipt or null.
12. Toasts for an action come from the requested type. A save says "Changes saved." for an edit of a posted update, "Update posted." when posted, otherwise "Draft saved.".
13. Accepted copy beyond the list: "FROM THE OFFICE", "Unpublish this update?", "Delete this draft?", "Read the IRS source", "—" for draft counts. When editing an older pin, the date `min` is the saved date.
14. The `shell.test.mjs` sidebar test flipped from forbidding Notifications to expecting it. The feature now exists.
15. The browser-only check refuses a past keep-at-top date ("Choose today or a later date.") unless it is the unchanged saved date. The database keeps no past-date check (brainstorm decision 5).

**Parked**
- Final review finding 7, "empty CSS rule": the rule isn't empty (it sets `margin:0; min-height` on the radios and checkboxes). It was a misread. Cost if wrong: none.

**Deferred minors** (left after the whole-branch triage, with its reasons)
- **Fixture:** `STATE_TABLES` lacks the new tables for the anonymous nothing-changes check. Anonymous has no grant, and the catalogue pins the grants.
- **Clearance test:** the exclusion in `tests/database-clearance.mjs:772` is redundant. Asserting that the `posted_updates` policies never contain `access='staff'` would pin decision D2.
- **Migration:** `v_status` is reused as a loop variable in `vitally_save_update`. Cosmetic.
- **Scale:** `vitally_posted_updates` calls `audience_member` once per person and update. Fine at classroom scale; relevant to #165.
- **Refusal tests:** they don't pin 42501.
- **Browser date check:** it covers shape only. The date input and the SQL exception handler refuse bad dates.
- **`isPinned`:** a string-compare comment.
- **Links:** no test for exactly 500 characters. JS `\S` vs Postgres `[:space:]` on NBSP: the browser is the stricter side.
- **`markUpdates`:** no guard on ids.
- **Controller:**
  - the `updateAction` fallback status vocabulary;
  - feed reads aren't sequenced (marks are idempotent);
  - on the setup screen, a confirm or list failure can take over Check again's Try again;
  - the sign-out test doesn't cover pending requests;
  - a failed mark is silent.
- **Views:**
  - the client-sidebar test is weak;
  - the preview accepts any https link;
  - the admin table's Confirmed column scrolls inside the table at 720 px.
- **Browser test:** the step-3 assertion message wording.
- **Review-only items:**
  - a draft save wakes every admin window's feed read (classroom scale);
  - people who leave a narrowed audience keep the item until their next read (now documented in `docs/developer/frontend.md`).

**Fixed from the ledger in the fix wave:** the highlight snapshot, the panel-flag guard, the link/button gap, the `docs/setup.md` migration count, the past-date check, the NOT_FOUND message, and the narrowed-audience docs line.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **When a plan names exact field names or error codes, the spec scenarios must use the same words.**
  → **Promote to** memory (feedback)
  > **Why**: in add-posted-updates, the spec said "naming the audience" and "FORBIDDEN for anonymous" while the plan and database used `roles` and no-grant 42501. The drift needed a ruling and a spec amendment mid-apply.
  > **How to apply**: when writing delta specs after the plan's Global Constraints are known, cross-check every VALIDATION detail and every refusal code in scenarios against them.
- [ ] 🟡 **A browser check that mirrors a SQL regex must use the same regex, not `new URL()`.**
  → **Promote to** memory (feedback)
  > **Why**: `new URL()` accepted 9 links the database refused, which would give confusing save failures (Task 2 review).
  > **How to apply**: any browser validator that mirrors a database CHECK.
- [ ] 📌 **File an issue for the Windows-only `write-test-env` unit failure.**
  → **Promote to** one-off (issue)
  > **Why**: it makes local `npm test` red on Windows for every change.
  > **How to apply**: before the next change's baseline.
