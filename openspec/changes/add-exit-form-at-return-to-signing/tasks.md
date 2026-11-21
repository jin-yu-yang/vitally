## 1. Database: migration 054

- [x] 1.1 Write database tests first (`tests/database-filing.mjs` or a new `tests/database-return-to-signing-exit-form.mjs` wired into `npm run test:database`): optional values, stored values, empty values store nothing, settled-method mismatch, group for a missing return, banking detail refused, remarks over 2000 refused, unknown key refused, refused action changes nothing
- [x] 1.2 Write database tests for access: an applicant reads no rows, a cleared staff member reads them, an uncleared one doesn't, a direct insert by staff is refused, and the realtime publication carries the table to staff only (`tests/database-realtime.mjs`)
- [x] 1.3 Create `supabase/migrations/054_return_to_signing_exit_forms.sql`: the `return_to_signing_exit_forms` table (D1), its `check_exit_form` and remarks constraints, row-level security copied from `staff_reviewer_questionnaires`, grants, and the realtime publication
- [x] 1.4 In 054, redefine `check_payload` from its latest copy, splitting `RETURN_TO_SIGNING` from `MARK_READY_TO_EFILE` and accepting optional `exitForm` and `remarks` (D3)
- [x] 1.5 In 054, redefine `act_return_to_signing`: the case-dependent method rules, the insert when any value is given, and `detail: {exitFormId}` (D2, D3)
- [x] 1.6 In 054, redefine `apply_fixture_scenario` from migration 039, clearing the new table (D7) — not needed: migration 040 dropped `apply_fixture_scenario`; rows go with their case (on delete cascade)
- [x] 1.7 Run `npm run db:migrate:test` and `npm run test:database`, all passing

## 2. Store and contracts

- [x] 2.1 Add `return_to_signing_exit_forms` to `STAFF_TABLES` and to the staff record loader in `src/supabase-store.mjs` as `returnToSigningExitForms`, with a unit test
- [x] 2.2 Document the `RETURN_TO_SIGNING` payload and the new record field in `src/contracts.mjs`

## 3. The Exit Form rule

- [x] 3.1 Extend `tests/exit-form-source.test.mjs` with the spec scenarios: stored values printed, the planned method until the refile, the case's method once refiled, the latest Return to signing decides, only gaps listed, nothing missing, and #173's cases unchanged
- [x] 3.2 Update `exitFormSource` and `exitFormNote` in `src/exit-form-source.mjs` (D5), adding `recordedAt`
- [x] 3.3 Check that `exitFormPanel`, `exitFormTool` and `viewExitForm` show the new note and PDF content, with unit tests in `tests/admin-views.test.mjs` and the staff views tests

## 4. The Return to signing dialog and payload

- [x] 4.1 Write unit tests for the payload builder (`tests/case-actions.test.mjs`): no values gives `{confirmed: true}`; filled groups give `exitForm`; a group with only its fixed method is not filled; remarks trimmed and omitted when blank
- [x] 4.2 Make `exitGroup` shareable from `src/staff-views.mjs`, with a scope parameter and a fixed-method variant, keeping the reviewer form's output unchanged (existing tests pass)
- [x] 4.3 Extend `returnToSigningDialogBody` in `src/admin-views.mjs` (D4): the lead, Federal and State groups only for returns with a method, the fixed method for a settled return, the Local groups and Remarks, with tests in `tests/admin-views.test.mjs` and `tests/confirm-dialogs.test.mjs`
- [x] 4.4 Update the `RETURN_TO_SIGNING` builder in `src/case-actions.mjs` to use `exitFormFrom`
- [x] 4.5 Wire the dialog in `src/app.mjs`: reopen typed-in groups after a refusal, and "Clear this section"; the demo-fill button fills one sensible group

## 5. Mark e-filed preselection

- [x] 5.1 Write unit tests for `efiledChoices`: the planned method is selected, nothing is selected without a row, and each rejected return with a planned method is preselected (per-return radios)
- [x] 5.2 Implement the preselection in `src/admin-views.mjs` (D6)

## 6. Browser story and docs

- [x] 6.1 Extend the browser story (`tests/browser.mjs`) on the Return to signing path: enter corrected values, confirm, download the Exit Form, check the note, and check Mark e-filed's preselection
- [x] 6.2 Update `docs/developer/backend.md`, `docs/developer/frontend.md`, `docs/demo-script.md` and `README.md` where they describe Return to signing or the Exit Form after it
- [x] 6.3 Run `npm test` and `npm run test:browser`, all passing; before the PR, check that migration 054 doesn't collide with whatever has merged to main (PR #243's 053)
