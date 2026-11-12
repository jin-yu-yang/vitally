## 1. Migration 045: role rules, clearance and effective capabilities

- [x] 1.1 Write failing database tests for the migration's guard and strip: a signed-in person with an unsupported role makes it refuse with VT008 and counts. A person with no sign-in loses only the unsupported roles. Supported roles and all certificates are kept. Existing entries get `is_new=false`.
- [x] 1.2 Write `supabase/migrations/045_volunteer_clearance.sql`, part 1:
  - the guard and the strip;
  - the `roster_entries.is_new` and `photo_id_checked_at` columns;
  - `vitally_private.role_needs`, `role_capabilities`, `effective_capabilities` and `cleared`;
  - the deferred constraint trigger on `roster_entries` and `certificates`.
- [x] 1.3 Write failing tests for the trigger: missing certificates, either write order in one transaction, a direct delete, `uploaded` status, and another season. Make them pass.

## 2. Test fixtures

- [x] 2.1 Add the fixture's clear-staff helper: minimal roles from capabilities, plus confirmed certificates, in one transaction. Use it in `f.staff(...)` and in the initializer's role accounts, with a `cleared: false` opt-out. Run the whole `npm run test:database` suite green before any gate lands.

## 3. The read gate

- [x] 3.1 Write failing tests:
  - an uncleared staff member reads 0 rows from each of the 21 tables but still reads `people`;
  - a cleared one reads as before;
  - clients are unchanged;
  - Realtime sends no change to an uncleared subscriber;
  - the catalog test that every policy with a staff branch except `people` calls the helper;
  - the InitPlan test.
- [x] 3.2 Add `vitally_policy.cleared_workspace_id()` with its grants, and re-state the 21 policies with the clearance check in their staff branch only. Update the `vitally_policy` catalog test to expect two functions.

## 4. The action gate and effective capabilities

- [x] 4.1 Write failing tests:
  - each of the six case RPCs refuses an uncleared staff member with VT009 before any lookup (unknown id, replay);
  - clients are not checked;
  - the effective-capability cases (role narrower or wider than the ceiling, an assisted case, self-review still VT005).
- [x] 4.2 Add `vitally_private.require_cleared`. Make `acting_person` return effective capabilities. Switch `check_operation_authority` and `vitally_create_case` to them. Call `require_cleared` first in the six case RPCs. Leave the checks of other people's capabilities on the ceiling.
- [x] 4.3 Add `vitally_my_clearance()` with its grants and tests (not cleared, cleared, client refused, no profile data). Update the public RPC catalog test and `tests/support/rpc-signatures.mjs` to list eight RPCs.
- [x] 4.4 Add `vitally_private.require_cleared_assignee`, refusing an uncleared person with INELIGIBLE, and test it directly. Add the catalog test that pins today's assigning functions. Test that an uncleared default follow-up person still receives escalations and a client's withdrawal notice.

## 5. The Roster save

- [x] 5.1 Write failing tests for `vitally_save_volunteer`: no roles allowed; a role without its certificates refused with the missing certificates named; unticking a certificate removes its roles; `isNew` and `photoIdChecked` stored and kept; an uncleared admin saves their own Admin role and becomes cleared.
- [x] 5.2 Write failing tests for the open-work rule: each kind of open work with the capability it needs, the default follow-up person, leaving someone uncleared, and allowed saves (drop Greeter; untick Advanced while Basic covers).
- [x] 5.3 Implement the save changes and the open-work rule in migration 045.
- [x] 5.4 Make `vitally_save_volunteer` change only the certificates it manages: delete only unsent `confirmed` rows, confirm a sent `uploaded` row, and leave other rows alone. Database tests: an uploaded certificate survives a save that doesn't send it; ticking it confirms it and grants the dependent role.

## 6. The app

- [x] 6.1 Add VT009 `NOT_CLEARED` to `src/contracts.mjs`, with unit tests.
- [x] 6.2 Load `vitally_my_clearance()` for a staff sign-in in the store. The signed-in person's own capabilities become the effective ones. The Volunteers link keeps the ceiling admin flag. Write controller and unit tests.
- [x] 6.3 Build the setup screen: "Finish your setup for this season", the missing items, "Ask <name>, your site coordinator", Check again, a re-check on window focus, and Volunteers for an uncleared admin. A `NOT_CLEARED` result from any action switches to it. Write view unit tests.
- [x] 6.4 Update the Roster: the cleared or missing column and the new page sentence; "New volunteer" (ticked by default on Add) and "Photo ID checked" in the drawer; the role-needs-certificates message; the open-work alert. Write view unit tests.

## 7. Seed and docs

- [ ] 7.1 Update `tools/admin/seed-values.mjs` and `seed-cases.mjs`:
  - clear the four role accounts first, through `vitally_save_volunteer` as the Site Coordinator account;
  - back every volunteer's roles with certificates (Hana Moretti gets IT&QR and Basic);
  - make Lucy Fong the volunteer with no roles;
  - one new volunteer with photo ID checked and one without.
  - Update the seed's tests.
- [ ] 7.2 Run the migration and `seed:local` on a stack that has `main`'s migrations and an earlier seed run. Check that the role accounts are cleared and the Roster reads as specified.
- [ ] 7.3 Update `docs/demo-script.md` (Roster section and table) and the `docs/setup.md` checklist step that describes the Roster.

## 8. Browser checks and verification

- [ ] 8.1 Update `tests/auth-browser.mjs` for an uncleared staff sign-in, which lands on the setup screen, and a cleared one. Run `npm run test:auth-browser`.
- [ ] 8.2 Add a short browser story check: the setup screen for an uncleared account (fixture `cleared: false`), Check again after an admin clears them, and the Roster's new drawer fields. Run `npm run test:browser` and record the per-phase timings.
- [ ] 8.3 Run `npm test`, `npm run db:migrate:test` with `npm run test:database`, `npm run test:auth-browser`, `npm run test:browser` and `npx openspec validate --all`. Record the results and the test counts before and after.
