## 1. Migration 052: guard, snapshot and the capabilities mirror

- [x] 1.1 Write the 052 guard (design D8): count active `staff` memberships whose person has `admin` in `people.capabilities` and no current-season Admin role, and raise `VT008` with the count, changing nothing. Add a database test that the guard refuses (run its SQL against a fixture shaped that way).
- [x] 1.2 Snapshot every person's capabilities into `vitally_private.capabilities_before_052`. It must not be reachable by any client role.
- [x] 1.3 Add the mirror (design D1): a `BEFORE INSERT OR UPDATE` trigger on `people` computing role capabilities for a person with a sign-in, `{}` otherwise; an `AFTER` trigger on `roster_entries` (roles, season, person, delete) that touches the current-season person; then recompute everyone. Rewrite `effective_capabilities` to role capabilities only.
- [x] 1.4 Database tests: the mirror follows role changes, including the `people` realtime message; a direct write is replaced; no sign-in means `{}`; a Roster volunteer with roles and no sign-in stays hidden from non-admin staff and becomes visible with their role capabilities once they sign in.

## 2. Site coordinators and clearance in the database

- [x] 2.1 Add `accounts.is_site_coordinator` and `public.site_coordinator_changes`, with no client grants, plus a private `is_site_coordinator(ws, person)` helper (active account with the flag).
- [x] 2.2 Rewrite `vitally_policy.is_workspace_admin` (site coordinator, or `admin` in the mirror; active staff membership; no clearance).
- [x] 2.3 Rewrite `cleared()` with the SC rule, and `vitally_my_clearance()` with `isAdmin` = workspace admin, `isSiteCoordinator`, and the `siteCoordinator` missing item.
- [x] 2.4 Add `vitally_set_site_coordinator` (receipt, revision, refusals FORBIDDEN / NO_ACTIVE_ACCOUNT / INVALID_TRANSITION / LAST_SITE_COORDINATOR / DEFAULT_FOLLOWUP / CONFLICT, audit row) and the private `grant_site_coordinator(ws, user)` for the roster command.
- [x] 2.5 Rewrite `deactivate_account`: refuse the last site coordinator with LAST_SITE_COORDINATOR, after the existing OPEN_WORK check; otherwise clear the flag with an audit row. Reactivation does not restore it.
- [x] 2.6 Database tests: the site coordinator grant and removal rules and history; the last site coordinator can't be removed or deactivated; the default follow-up person can't lose site coordinator; a site coordinator without SC is not cleared but reaches the Roster and Season settings; `is_workspace_admin` and `vitally_my_clearance` answers; an invited volunteer given the Admin role (with VSC + IT&QR) has admin.

## 3. Season settings in the database

- [x] 3.1 Add `public.season_settings`, one row per workspace (kept across seasons), with no client grants and not in realtime. The SIDN stays in `vitally_private.site_numbers`.
- [x] 3.2 Add `vitally_season_settings()` (workspace admin; never the SIDN), `vitally_save_season_settings` (site coordinator; `https://` validation; revision; receipt) and `vitally_set_site_number` (site coordinator; SIDN format; answers set/updatedAt only).
- [x] 3.3 Database tests: only site coordinators write; admins read; FORBIDDEN for others; link validation; CONFLICT; receipt replay; no public RPC, table or policy returns the SIDN.

## 4. The default follow-up person may be a site coordinator

- [x] 4.1 Add `vitally_private.can_be_default_followup(ws, person)`, and use it in `set_default_followup` and `initialize_workspace`'s re-run check.
- [x] 4.2 Replace the `followup` assignee test in `act_escalate_contact`, `act_approve_review`, `act_withdraw` and `act_close_case`, each copied verbatim from its latest definition with the changed line marked `-- 052`. Record a `pg_get_functiondef` diff for review.
- [x] 4.3 Database tests: a site coordinator with no roles as default receives an escalation, a go-over follow-up, a close-before-filing notice and a withdrawal notice; a default with the Admin role and no site coordinator still does.

## 5. vitally_save_volunteer (replaces both 045 copies)

- [x] 5.1 Rewrite `vitally_save_volunteer`: `is_workspace_admin` admin check; Admin-role changes need a site coordinator (FORBIDDEN, ADMIN_ROLE); the open-work rule on role capabilities with no ceiling; the default follow-up row met by a site coordinator. The header comment says it replaces Part 3's and Part 6's definitions in 045 (#193 item 3).
- [x] 5.2 Database tests: a non-site-coordinator adding or removing the Admin role is refused; other roles still work; an uncleared site coordinator ticks their own certificates; the open-work scenarios for a site coordinator default.

## 6. Account functions and tools

- [x] 6.1 Replace `add_staff_member` with `(ws, user, key, name)` (drop the 5-argument form, link via the mirror), and make `vitally_record_account` stop writing capabilities.
- [x] 6.2 Update `tools/admin/workspace-setup.mjs`: a `siteCoordinator` flag per staff entry, granted before `set_default_followup`; `siteNumber` kept for tests and the seed only.
- [x] 6.3 Update `tools/admin/roster.mjs`: `siteCoordinator` validation; `capabilities` and `siteNumber` ignored with a notice; `defaultFollowup` must name a `siteCoordinator: true` entry. Update its unit tests and `tools/admin/roster.example.json`.
- [x] 6.4 Update `seed:local`: require `site_coordinator` to be a site coordinator; set `S00000000` when no SIDN is set; tests.

## 7. Tests that relied on the ceiling

- [x] 7.1 Update `tests/support/database-fixture.mjs`: `site_coordinator` is a site coordinator; `clearStaff` confirms `sc` for site coordinators; staff setup without capabilities.
- [x] 7.2 Convert every test that writes `people.capabilities` directly or calls the 5-argument `add_staff_member` (database-actions, -assistance, -documents, -staff-identity, -accounts, -clearance, -posted-updates, database.mjs) to roles. Convert each test rather than delete it, and for any test removed, name the removed code it covered.
- [x] 7.3 Update the catalog tests (`vitally_policy` functions, assignment functions list, grants) for the new functions and tables.

## 8. Front end

- [x] 8.1 `src/supabase-store.mjs`: season settings read and writes, the site coordinator write, `is_site_coordinator` in the accounts select. `src/clearance.mjs`: `siteCoordinator()`, and the SC line in `missingLines`.
- [x] 8.2 `src/volunteer-roster.mjs` / `src/volunteer-views.mjs`: the SC rule in "Ready for the season" ("SC certificate missing"); the Admin tick disabled for non-site-coordinators with its hint; the refusal sentences for ADMIN_ROLE and LAST_SITE_COORDINATOR.
- [x] 8.3 New `src/season-settings-views.mjs`, with unit tests: the season card, the SIDN row and Change dialog, the Site coordinators card with picker and history, and the read-only variant.
- [x] 8.4 Wire `office-settings` into `src/views.mjs` (sidebar link, `CEILING_SCREENS`) and `src/controller.mjs` (screen list, `ADMIN_SETUP_SCREENS`, `screenAllowed`, actions, read on open, error sentences). Add CSS in the existing staff stylesheet.

## 9. Browser story

- [x] 9.1 Add a short Season settings walk to the story: the Site Coordinator persona opens Season settings, saves the upload link, sets the SIDN, and a screenshot is taken. Record the leg times before and after.

## 10. Docs and checks

- [x] 10.1 Update `docs/developer/` (database notes on the mirror, site coordinators and season settings; roster file format) and `docs/setup.md` where the roster file is described.
- [x] 10.2 Run `npm test`, `npm run build:hant -- --check`, `npx openspec validate --all`, `npm run db:migrate:test` + `npm run test:database`, `npm run test:auth-browser` and `npm run test:browser` (or the PR's CI run). Also run a local `db:migrate:test` on a stack that already has main's migrations.
