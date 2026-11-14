## 1. Migration 046: tables, audience, policies, publication

- [x] 1.1 Write failing database tests (`tests/database-posted-updates.mjs`, own fixture workspace only):
  - the audience rules: live, roles, uncleared with an entry, no current-season entry, inactive membership;
  - the two SELECT policies: draft hidden, another role hidden, clients none, unpublished still readable to the audience;
  - `update_reads` refused directly;
  - no direct insert into either table.
- [x] 1.2 Write `supabase/migrations/046_posted_updates.sql`, part 1:
  - the tables, checks and foreign keys from design D1;
  - row security, revokes and the select grant on `posted_updates` only;
  - `vitally_private.audience_member` and `vitally_policy.in_update_audience`, with their grants;
  - the two policies;
  - the guarded publication block for `posted_updates`.

## 2. Migration 046: the five RPCs

- [x] 2.1 Write failing tests for `vitally_save_update` and `vitally_update_action`:
  - ceiling admin only (an uncleared admin is allowed; preparer and client get FORBIDDEN);
  - validation per field;
  - draft, post, unpublish and delete-draft;
  - refusals with INVALID_TRANSITION, CONFLICT and NOT_FOUND;
  - receipts and replay;
  - edit keeps reads, `askAgain` clears them; `edited_at`.
  Make them pass.
- [x] 2.2 Write failing tests for `vitally_mark_updates`, `vitally_my_updates` and `vitally_posted_updates`:
  - feed contents and order, including pinned in New York time and a past pin;
  - item fields exactly;
  - badge count;
  - marking keeps the first time, confirm only where asked, others' ids ignored, more than 200 refused;
  - admin counts follow the live audience, the people list, and FORBIDDEN for non-admins.
  Make them pass.
- [x] 2.3 Update the catalogue tests:
  - `tests/database-catalog.mjs`: `POLICIES`, `RPCS` (13), the digest exemptions, the `vitally_policy` list;
  - `tests/support/rpc-signatures.mjs`;
  - `tests/database-store.mjs` (published tables);
  - `tests/database-staff-identity.mjs` (the subscribed-table read check);
  - `tests/database-clearance.mjs` (the 21-policy count still holds; add `posted_updates` to the exclusion wording).

## 3. Browser rules and store

- [x] 3.1 `src/posted-updates.mjs` with tests:
  - `validateUpdate`, with the same rules and messages as the database;
  - the labels;
  - `audienceLabel`, `badgeCount`, `isPinned`, `toUpdateRequest`.
- [x] 3.2 `src/supabase-store.mjs`:
  - add `posted_updates` to `STAFF_TABLES`;
  - add the store methods `getUpdates`, `markUpdates`, `listPostedUpdates`, `saveUpdate` and `updateAction` (action ids kept on the request for retry);
  - add tests in `tests/store.test.mjs`.

## 4. Controller

- [x] 4.1 The feed in `src/controller.mjs`, with tests:
  - state;
  - load with the work and on clearance checks;
  - `posted_updates` changes;
  - `openNotifications` marks the unread shown items;
  - `confirmUpdate`;
  - reset on sign-out.
- [x] 4.2 The admin side, with tests:
  - the `office-updates` screen for a ceiling admin, cleared or not;
  - `loadPostedUpdates` on open, refresh and after actions;
  - `saveUpdate` (draft or post, local validation, offline retry, CONFLICT);
  - `updateAction` (POST, UNPUBLISH, DELETE);
  - `editUpdate` and `cancelUpdateEdit`.

## 5. Views and wiring

- [ ] 5.1 Sidebar (`src/views.mjs`):
  - Notifications, with a bell and a badge, in every staff window, setup screen included;
  - Post an update for a ceiling admin;
  - routing for `office-updates`;
  - tests.
- [ ] 5.2 `src/update-views.mjs`, with tests:
  - the Notifications panel (items, highlight, Edited, pinned, I've read this, confirmed date, footer, empty state);
  - the Post an update page (form, conditional link and roles, the "ask again" checkbox when editing posted, preview, table with bars and actions);
  - the who-has-read dialog;
  - the Unpublish and Delete confirm bodies (golden file `tests/fixtures/confirm-dialogs.json`).
- [ ] 5.3 `src/app.mjs` actions and form submit, the preview re-rendering on input, toasts. `src/styles.css` for the bell badge, the panel, the form, the preview and the count bars. Check for horizontal overflow at phone width.

## 6. Browser test and docs

- [ ] 6.1 A new top-level test in `tests/browser.mjs`: "An admin posts an update and volunteers read and confirm it".
  - Chrome, its own fixture and timeout.
  - Flow:
    - the admin posts an IRS update to All volunteers asking for confirmation;
    - the cleared volunteer's badge appears live;
    - the panel opens; I've read this; the badge clears;
    - the admin table shows the counts and the who-list;
    - edit with "ask again" relights the badge;
    - an update to Reviewers doesn't reach the preparer;
    - unpublish with confirmation leaves the panel live;
    - an uncleared volunteer sees the update on the setup screen.
  - Screenshots of the page and the panel. The main story is untouched.
- [ ] 6.2 Docs:
  - `docs/developer/database.md`: migrations, tables, RPC list and count, visibility, the realtime section;
  - `README.md`, `architecture.md`, `backend.md`, `frontend.md`: wherever they count or list RPCs or watched tables.

## 7. Verification

- [ ] 7.1 Locally: `npm test`, `npm run build:hant -- --check` and `npx openspec validate --all`.
- [ ] 7.2 Push, and run `gh workflow run ci.yml --ref add-posted-updates`. Iterate until the `checks`, `database`, `sign-in` and `story` jobs pass. Review the story screenshots from the artifacts.
