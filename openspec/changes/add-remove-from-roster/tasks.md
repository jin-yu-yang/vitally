## 1. Database: migration 058

- [x] 1.1 Write `tests/database-remove-from-roster.mjs` (own workspaces) covering the removal and every refusal in the volunteer-roster, sign-in-accounts, site-coordinators and volunteer-clearance delta specs, including: stale Save after removal gets `CONFLICT` and creates no entry; Remove vs Deactivate never answers `INVALID_TRANSITION`; removing a site coordinator never calls `deactivate_account` (mark, history and account unchanged); capabilities become `{}`; certificates and sent/reviewed fields gone; earlier seasons and a Closed current-season case unchanged; a current-season Accepted case refused with `OPEN_WORK`; receipt replay before `CONFLICT`; `roster_removals` has no grant
- [x] 1.2 Write `supabase/migrations/058_remove_from_roster.sql`: the `roster_removals` table (RLS on, no policy, revoke all) and `public.vitally_remove_from_roster(uuid,uuid,bigint)` with the check and lock order of design D4, deactivation skipped per D6, grant to `authenticated`
- [x] 1.3 Add the RPC to `tests/database-catalog.mjs` and to any RPC list in `tests/store.test.mjs` that enumerates write RPCs
- [x] 1.4 Run the new database tests and the files they reach (`database-accounts.mjs`, `database-volunteer-roster.mjs`, `database-site-coordinators.mjs`, `database-capabilities-mirror.mjs`, `database-catalog.mjs`) through `gh workflow run database-quick.yml --ref <branch> -f files="…"` until green

## 2. Store

- [x] 2.1 Add `removeFromRoster({actionId, volunteerId, expectedRevision})` to `src/supabase-store.mjs`, mapping refusals as the other account actions do, with a unit test in `tests/store.test.mjs`

## 3. Views

- [x] 3.1 In `src/volunteer-views.mjs`, add the drawer's "Remove from this season's roster…" button, or the site coordinator / Admin role sentence in its place for a caller who isn't a site coordinator, with tests in `tests/volunteer-views.test.mjs`
- [x] 3.2 Add `removeFromRosterDialogBody` (title, the email line, the four account variants, the add-back line, [Remove from roster] [Cancel]) and register the dialog in `src/views.mjs`, with tests (including `tests/confirm-dialogs.test.mjs` if dialogs are enumerated there)
- [x] 3.3 Add the #269 note "Reactivate so they can sign in." under Reactivate for a current-roster volunteer with a deactivated account and no notice, with tests that the notice and note never show together

## 4. Controller and app

- [x] 4.1 In `src/controller.mjs`, add the remove action: send from the confirmation only, keep the action id on an unknown outcome, refusals in the dialog (`OPEN_WORK`, `ADMIN_ROLE`, `FORBIDDEN` for a site coordinator), `CONFLICT` and unreadable to the banner, re-read the list; on success close the dialog and drawer; tests in `tests/controller.test.mjs`
- [x] 4.2 In `saveVolunteer`, after a successful save of a picked earlier volunteer whose re-read account is `deactivated`, keep the drawer open on their Edit view with the #269 notice; other saves unchanged; controller tests
- [x] 4.3 Wire the button and the confirmation in `src/app.mjs`

## 5. Browser test

- [x] 5.1 Add a separate `test(...)` block in `tests/browser.mjs` with its own workspace (not the story): an admin removes a volunteer through the confirmation, the removed volunteer's window shows "This account has no access" on its next wake, the admin re-adds them by email and sees the Reactivate notice, then the note on reopening

## 6. Docs and checks

- [ ] 6.1 Update `docs/developer/database.md` (migration 058, the RPC, `roster_removals`) and `docs/developer/frontend.md` (the remove dialog, the #269 notice)
- [ ] 6.2 Run `npm test` and `npx openspec validate --all`; confirm `npm run build:intake` leaves nothing to commit
- [ ] 6.3 Push the branch and run the full CI (`gh workflow run ci.yml --ref <branch>`); every job covering the change passes, and the story's screenshots are reviewed
