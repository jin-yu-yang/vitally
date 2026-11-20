## 1. Migration 053: columns and the clearance answer

- [x] 1.1 Write failing database tests in a new `tests/database-clearance-uploads.mjs`:
  - `vitally_my_clearance()` carries `sentAt` (null) on the `form13615` and `photoId` items;
  - `uploadUrl` is the certificate link for a rostered caller;
  - `uploadUrl` is null with no link, and null with no current-season entry;
  - `capabilities` is `[]` for a not-cleared caller who has roles.
- [x] 1.2 Convert the #193 test in `tests/database-clearance.mjs` ("a new volunteer without a photo ID check is not cleared"): the `unchecked` half asserts `capabilities` `[]`, and its comment is rewritten. Do not delete it.
- [x] 1.3 Create `supabase/migrations/053_clearance_uploads.sql` with:
  - the two `roster_entries` columns;
  - the new `vitally_my_clearance()` body, with `sentAt`, `uploadUrl` and empty capabilities when uncleared, and changed lines marked `-- 053`.

  Re-grep `clearance.capabilities` and `withOwnCapabilities` first, and confirm that no uncleared path depends on them.
- [x] 1.4 Run `npm run db:migrate:test` and the two database files. The 1.1–1.2 tests pass.

## 2. Migration 053: the volunteer's "sent" RPC

- [x] 2.1 Write failing tests for `vitally_mark_upload_sent`:
  - it marks only the caller's own entry;
  - sending again updates the date;
  - a repeated action id returns the same answer;
  - the photo ID is refused when the entry is not new or is already checked;
  - a call with no current-season entry is refused;
  - an unknown document is refused;
  - a client is refused `FORBIDDEN`;
  - a cleared caller may send a 13615;
  - `sentAt` then appears in `vitally_my_clearance()`;
  - the send raises the revision, so an admin's stale save gets `CONFLICT`.
- [x] 2.2 Add `vitally_mark_upload_sent(uuid,text)` to 053 (design D2), with its revoke and grant.
- [x] 2.3 Run the database file. 2.1 passes.

## 3. Migration 053: Save clears, and Mark reviewed

- [x] 3.1 Write failing tests:
  - Save clears `form_13615_sent_at` on a role change, and on a certificate change (including an `uploaded` row being confirmed);
  - a phone-only save keeps it;
  - ticking Photo ID checked clears `photo_id_sent_at`;
  - unticking New volunteer clears `photo_id_sent_at`;
  - Mark reviewed clears either date, keeps roles and certificates, and raises the revision;
  - Mark reviewed with nothing waiting succeeds and changes nothing;
  - Mark reviewed with a stale revision gets `CONFLICT`, an unknown volunteer gets `NOT_FOUND`, and a non-admin gets `FORBIDDEN` with no receipt;
  - a repeated action id returns the same answer;
  - a non-admin reading `roster_entries` gets no rows.
- [x] 3.2 Add the new `vitally_save_volunteer(...)` body to 053: 052's body, with only the clearing in the entry write (design D4), marked `-- 053`.
- [x] 3.3 Add `vitally_mark_upload_reviewed(uuid,uuid,bigint,text)` to 053 (design D3), with its revoke and grant.
- [x] 3.4 Run `npm run db:migrate:test` on a stack that already has main's migrations, then the full `npm run test:database` at concurrency 1. Everything passes.

## 4. Store and contracts

- [x] 4.1 Add `markUploadSent(actionId, document)`, `markUploadReviewed(actionId, volunteerId, revision, document)` and `countUploadsToReview()` to the store contract (`src/contracts.mjs`), the Supabase store (`src/supabase-store.mjs`) and any loopback or test store that implements the contract.
- [x] 4.2 Have `combineVolunteers` carry `form13615SentAt` and `photoIdSentAt`, and add unit tests for it.

## 5. The setup screen

- [x] 5.1 Write failing unit tests for the setup items in four states: link and not sent; link and sent; no link and not sent; no link and sent. Role and SC items stay unchanged.
- [x] 5.2 Render Upload, the ask line, I've uploaded it and the waiting state in `src/setup-views.mjs` and `src/clearance.mjs` (design D6), using the New York short date.
- [x] 5.3 Add a controller action that marks the document sent (fresh action id, and the same id on a retry), re-reads the clearance and shows a refusal or failure on the setup screen. Add a unit test for it.

## 6. The Roster

- [x] 6.1 Write failing unit tests for:
  - `SHOW_VIEWS` and `filterVolunteers` with `show`, alone and with Role and search;
  - the row's "to review" text;
  - the drawer's sent lines and Mark reviewed buttons.
- [x] 6.2 Add the Show dropdown to the toolbar, `show` to `setVolunteerFilter`, the row text, and the drawer lines (design D7).
- [x] 6.3 Add a controller action for Mark reviewed:
  - it calls the store with the drawer's revision and adopts the returned revision;
  - it keeps unsaved edits;
  - it re-reads the Roster and the count;
  - a `CONFLICT` uses the existing message.

  Add a unit test.

## 7. The sidebar count

- [x] 7.1 Write failing unit tests for the Volunteers link: "Volunteers · 3" with aria-label "Volunteers, 3 uploads to review", "Volunteers, 1 upload to review" at 1, plain at 0, and absent for a non-admin.
- [x] 7.2 Read the count for a workspace-admin window at each point in design D8. A failure keeps the last count. Render it in `src/views.mjs`.
- [x] 7.3 Grep `tests/browser.mjs` and `tests/auth-browser.mjs` for lookups of the Volunteers link by name, and fix any that the new name would break.

## 8. Browser test

- [x] 8.1 Add a separate top-level `test(...)` in `tests/browser.mjs` beside "A site coordinator changes Season settings" (not in the story). The flow:
  1. A not-new, uncleared volunteer sees Upload (the link is set first) and presses I've uploaded it, and sees "Waiting for review".
  2. The admin's sidebar shows "Volunteers · 1", and Show → Uploads to review lists the volunteer.
  3. The admin ticks certificates and a role and saves.
  4. The volunteer's setup screen clears to the work board.
  5. A new volunteer sends the photo ID, the admin presses Mark reviewed, and the row leaves the filter.

  Use fictional data.
- [x] 8.2 Run only this test locally if memory allows, with stacks stopped after. Otherwise rely on the PR's CI story legs and review their screenshots.

## 9. Checks and docs

- [x] 9.1 Run `npm test`, `npx openspec validate --all` and `npm run build:hant -- --check` (expected unchanged: staff text only). Run `npm run build:intake` and confirm it leaves nothing to commit.
- [x] 9.2 Update the developer docs that list RPCs or migrations (`docs/developer/`), if they name 052's functions. Add the hosted step to the PR body draft: `node --env-file=.env.admin tools/admin/migrate.mjs --target classroom` with `NODE_EXTRA_CA_CERTS`, the same day as the merge. Add "Refs #193 (item 7 done)".
