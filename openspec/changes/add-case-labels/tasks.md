## 1. Database: tables, starter labels, visibility (migration 051)

- [x] 1.1 Check the open branches again for migration numbers. Then create `supabase/migrations/051_case_labels.sql` with a header comment that describes the change and names its merge points (design D7, Risks).
- [x] 1.2 Add `public.case_labels` and `public.case_label_links`, with their columns, checks, unique indexes and composite foreign keys (D1), RLS enabled, and `grant select` to `authenticated` only.
- [x] 1.3 Add the staff-only SELECT policies: labels by staff membership, and links by the inline case-visibility rule. Both are gated by `(select vitally_policy.cleared_workspace_id())`, and neither has an applicant branch (D6).
- [x] 1.4 Add the `after insert` trigger on `public.workspaces` for the three starter labels, and the one-time insert into existing workspaces (D7).
- [x] 1.5 Add both tables to the `supabase_realtime` publication.
- [x] 1.6 Write database tests (new `tests/database-labels.mjs`) for:
  - the tables' checks;
  - starter labels in new and existing workspaces;
  - client and other-workspace invisibility;
  - an uncleared staff member reading nothing;
  - no write grants.

## 2. Database: the two RPCs

- [x] 2.1 Add `public.vitally_save_label` with the check order, create and edit paths, the revision guard, the name-clash refusal and the receipt (D5). Finish with revoke/grant, and `revoke all on all functions in schema vitally_private …`.
- [x] 2.2 Add `public.vitally_set_case_label` with the check order of D4, the upsert of the link (status, never delete), the `ADD_CASE_LABEL` and `REMOVE_CASE_LABEL` events (only on an actual change), and no change to `cases.revision` or `updated_at`.
- [x] 2.3 Write database tests for `vitally_save_label`: success; every refusal in check order (`NOT_CLEARED`, `FORBIDDEN` for a volunteer and for a client, `VALIDATION` for shape, name and color, `NOT_FOUND`, `CONFLICT`); replay; and a refusal leaving nothing.
- [x] 2.4 Write database tests for `vitally_set_case_label`:
  - adding and removing labels as the preparer, the reviewer and the office;
  - every refusal in check order: `NOT_CLEARED`, `FORBIDDEN` (client), `NOT_FOUND` (draft, other workspace), `FORBIDDEN` (not on the case), `VALIDATION` (foreign label), `INVALID_TRANSITION` (closed);
  - an unchanged state that writes nothing;
  - concurrent adds;
  - unchanged `revision` and `updated_at`, including a case action at the old revision still succeeding;
  - replay, and a refusal leaving nothing.
- [ ] 2.5 Update the shared database tests:
  - `tests/support/rpc-signatures.mjs` gets the two new RPCs;
  - the clearance tests go from 21 tables to 23, and from six RPCs to eight;
  - the catalog and policy tests include the new staff-gated policies;
  - `tests/database-realtime.mjs` checks that staff get label changes (a removal included) and clients get none.
- [ ] 2.6 Run `npm run db:migrate:test` on a stack that already has `main`'s migrations, then `npm run test:database`. Fix until green.

## 3. Browser: data and actions

- [ ] 3.1 In `src/supabase-store.mjs`:
  - add `case_labels` and `case_label_links` to `STAFF_TABLES`;
  - read the labels and active links with the case list, and attach `labels` (sorted by name) to each case;
  - expose the workspace's labels;
  - add `saveLabel` and `setCaseLabel` with reusable action ids (D9).

  Cover these in `tests/store.test.mjs`.
- [ ] 3.2 Add the browser eligibility helpers `canLabelCase(record, person)` (mirrors `works_on_case`, not closed) and `canManageLabels(person)`, with unit tests (D9).
- [ ] 3.3 Wire the controller: open and close the label menu, the search text, toggling a label, the create and edit forms, and the duplicate-name check; handle refusals and `CONFLICT` by re-reading. Keep the menu state across live redraws. Cover these in `tests/controller.test.mjs`.

## 4. Browser: screens and styles

- [ ] 4.1 In `src/styles.css`:
  - rename the label tokens by color (sky, amber, pink);
  - add green, violet and slate, with all four shades and readable ink on bg;
  - style `.case-label[data-color=…]` chips, the remove button and the label menu (D8).
- [ ] 4.2 Add a shared chip renderer (`src/ui.mjs`) that maps a color name to `data-color` and never writes a style attribute. Unit test it.
- [ ] 4.3 Case header (`caseHeader`, `src/staff-views.mjs`): the chip row, remove buttons and `+ Add a label` when the person may label the case, the menu (search, toggles, the admin's create row and edit form), and the read-only chips otherwise (D10). Unit tests in `tests/staff-views.test.mjs`.
- [ ] 4.4 Work board: chips under the reference, read-only. Unit test.
- [ ] 4.5 Case pool (`src/pool-views.mjs`): chips under the reference; the `poolLabel` filter (`Any label`, each label, `No label`) in `DEFAULT_POOL_FILTERS`, `filterPool`, the counts and "Clear filters"; and the fallback for an unknown label (D11). Unit tests in `tests/pool-views.test.mjs`.
- [ ] 4.6 Staff history: lines for `ADD_CASE_LABEL` and `REMOVE_CASE_LABEL` ("<person> added label <name>"). Unit test.

## 5. Seed data, story and docs

- [ ] 5.1 `tools/admin/seed-cases.mjs`: label rehearsal cases through `vitally_set_case_label` as an admin. Each starter label goes on at least one case, and one case gets two. Update `tests/seed.test.mjs` and `tests/database-seed.mjs` as needed.
- [ ] 5.2 Browser story (`tests/browser.mjs`):
  - a volunteer adds and removes a label on their case, and a second window sees it live;
  - an admin creates and renames a label from the menu;
  - a read-only volunteer sees the chips without controls;
  - the case pool's Label filter narrows and clears.
- [ ] 5.3 Update `docs/developer/database.md`:
  - the migration row;
  - the tables;
  - who can see what;
  - the API table and "Who is acting";
  - the check order for the two RPCs;
  - Realtime;
  - the current-definition table;
  - the testing table.

  Update `docs/developer/frontend.md` for the label menu and the pool filter.
- [ ] 5.4 Run `npm test` and `npm run test:browser`, and review the story's screenshots for the chips and the menu. Record which checks ran, and why `build:hant` and `test:auth-browser` were not needed.
