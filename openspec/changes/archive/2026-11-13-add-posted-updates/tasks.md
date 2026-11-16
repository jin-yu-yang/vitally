## 1. Migration 049: tables, audience, policies, publication

- [x] 1.1 Write failing database tests (`tests/database-posted-updates.mjs`, own fixture workspace only):
  - the audience rules: live, roles, uncleared with an entry, no current-season entry, inactive membership;
  - the two SELECT policies: draft hidden, another role hidden, clients none, unpublished still readable to the audience;
  - `update_reads` refused directly;
  - no direct insert into either table.
- [x] 1.2 Write `supabase/migrations/049_posted_updates.sql`, part 1:
  - the tables, checks and foreign keys from design D1;
  - row security, revokes and the select grant on `posted_updates` only;
  - `vitally_private.audience_member` and `vitally_policy.in_update_audience`, with their grants;
  - the two policies;
  - the guarded publication block for `posted_updates`.

## 2. Migration 049: the five RPCs

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

- [x] 5.1 Sidebar (`src/views.mjs`):
  - Notifications, with a bell and a badge, in every staff window, setup screen included;
  - Post an update for a ceiling admin;
  - routing for `office-updates`;
  - tests.
- [x] 5.2 `src/update-views.mjs`, with tests:
  - the Notifications panel (items, highlight, Edited, pinned, I've read this, confirmed date, footer, empty state);
  - the Post an update page (form, conditional link and roles, the "ask again" checkbox when editing posted, preview, table with bars and actions);
  - the who-has-read dialog;
  - the Unpublish and Delete confirm bodies (golden file `tests/fixtures/confirm-dialogs.json`).
- [x] 5.3 `src/app.mjs` actions and form submit, the preview re-rendering on input, toasts. `src/styles.css` for the bell badge, the panel, the form, the preview and the count bars. Check for horizontal overflow at phone width.

## 6. Browser test and docs

- [x] 6.1 A new top-level test in `tests/browser.mjs`: "An admin posts an update and volunteers read and confirm it".
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
- [x] 6.2 Docs:
  - `docs/developer/database.md`: migrations, tables, RPC list and count, visibility, the realtime section;
  - `README.md`, `architecture.md`, `backend.md`, `frontend.md`: wherever they count or list RPCs or watched tables.

## 7. Verification

- [x] 7.1 Locally: `npm test`, `npm run build:hant -- --check` and `npx openspec validate --all`.
- [x] 7.2 Push, and run `gh workflow run ci.yml --ref add-posted-updates`. Iterate until the `checks`, `database`, `sign-in` and `story` jobs pass. Review the story screenshots from the artifacts.

## 8. Review round 1 (jin-yu-yang's review; design D7)

- [x] 8.1 Rebase onto `main` (the Workload, #195, took 046) and renumber the migration to `049_posted_updates.sql`, with every reference (agreed order: #197 = 047, #200 = 048, #196 = 049). The migrator has no gap check.
- [x] 8.2 The audience policy reads an unpublished update only within `vitally_policy.unpublished_read_window()` (10 minutes) of `unpublished_at`; admins always.
- [x] 8.3 `vitally_save_update` edits an unpublished update: it stays unpublished with its reads; `post` changes nothing; `askAgain` is refused with `VALIDATION`.
- [x] 8.4 UI: Edit on unpublished rows; the form's note, Save changes and no ask-again box; the Unpublish confirmation's new text.
- [x] 8.5 Tests:
  - database: inside and after the window (moving `unpublished_at` back), admins, posted rows, the RPCs; an unpublished edit and its refusals (`FORBIDDEN`, `CONFLICT`, `askAgain`) and replay; the catalogue's `vitally_policy` list;
  - unit: the view, the toast and the controller's request;
  - browser: the Unpublish confirmation's text, and an edit after Unpublish brings nothing back to the open panel.
- [x] 8.6 Docs: design D7, the spec, `docs/developer/database.md`.
- [x] 8.7 Verification: `npm test`, `npm run build:hant -- --check`, `npx openspec validate --all` locally; CI `checks`, `database`, `sign-in` and `story` on the pushed head.

## 9. Review round 2 (after #197 = 047 and #200 = 048 merged)

- [x] 9.1 Rebase onto `main` again; the migration stays 049. Canonical spec conflicts resolved in `openspec/specs/sign-in/spec.md` (the RPC list now has main's account RPCs and these five: twenty-two in all).
- [x] 9.2 `audience_member`: "has a sign-in" is an active account (047's `accounts`, `status = 'active'`), on an active staff membership (design D2).
- [x] 9.3 Spec, design and database tests: an invitation not yet used and a deactivated account are in no audience and no count.
- [x] 9.4 Verification: `npm test`, `npm run build:hant -- --check`, `npx openspec validate --all` locally; CI on the pushed head.

## 10. Review round 3 (Zeye approved; small fixes)

- [x] 10.1 `vitally_save_update` and the table check trim spaces, tabs and line breaks from both ends (`btrim` with that character set), so a title or message of only whitespace is refused. Database test.
- [x] 10.2 The admin table's footer says what Read means and points to "Ask to confirm read" and Confirmed.
- [x] 10.3 Follow-up issue: the feed shows only the current season's updates, built with Start next season.
