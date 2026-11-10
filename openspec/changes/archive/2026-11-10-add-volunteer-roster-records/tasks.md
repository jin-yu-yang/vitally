## 1. Database

- [x] 1.1 Migration 044: the `vitally_policy` schema and `is_workspace_admin` helper, and the three tables with admin-only read policies
- [x] 1.2 Migration 044: the tightened `staff_people` policy, and the backfill of existing staff
- [x] 1.3 Migration 044: `vitally_save_volunteer` for Add and Edit, with validation, receipts and revision checks
- [x] 1.4 Migration 044: the replaced `add_staff_member` (link by email, no name comparison, records for new staff), and the roster command reporting each link
- [x] 1.5 Database tests for access, the `people` policy, Add, Edit, validation, the backfill, linking and "roles grant nothing"; catalog checks on `vitally_policy` in `tests/database-catalog.mjs`; add the RPC to `tests/support/rpc-signatures.mjs`

## 2. Store and pure logic

- [x] 2.1 Volunteer view logic: constants, combining rows, search and role filter, form reading and validation, with unit tests
- [x] 2.2 Store: `listVolunteers` and `saveVolunteer`, with unit tests

## 3. Screen

- [x] 3.1 Controller: the screen, list state, loading on open and restore, and saving with conflict handling, with unit tests
- [x] 3.2 Views: the sidebar link, the Roster page and the drawer, with unit tests
- [x] 3.3 Wiring in `app.mjs`: navigation, search and filter, opening and closing the drawer, and submit
- [x] 3.4 `personOptions` skips people with no capabilities, with a unit test
- [x] 3.5 Styles for the table, toolbar and drawer

## 4. Rehearsal data and browser test

- [x] 4.1 `seed:local` adds the 8 fictional volunteers, with tests (first to cut; tell the user if cut)
- [x] 4.2 A separate top-level browser test: an admin adds, finds and edits a volunteer, and a non-admin has no link

## 5. Documentation and checks

- [x] 5.1 Update the migration list in `docs/setup.md` and the tables in `docs/developer/database.md`
- [ ] 5.2 Run `npm test`, `npm run db:migrate:test` onto a stack already at `main`'s migrations, `npm run test:database`, `npm run test:auth-browser` and `npm run test:browser`
