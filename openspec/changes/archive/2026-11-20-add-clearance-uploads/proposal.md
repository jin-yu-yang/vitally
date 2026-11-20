## Why

PCDC volunteers send a signed Form 13615 and, if they are new, a photo ID through PCDC's OneDrive upload link. The setup screen tells them to upload the 13615, but it offers no link and no way to say a file was sent. Admins cannot see who is waiting for review. Migration 052 put the upload link in Season settings, and the link is already filled on hosted. This change lets a volunteer say "I've uploaded it", shows admins what is waiting for review, and lets them clear it. It also does #193 item 7, because it rewrites the same clearance answer.

## What Changes

- **Sent dates on the roster entry.** `roster_entries` gets `form_13615_sent_at` and `photo_id_sent_at` (migration 053). Null means nothing is waiting. The dates are stored, not derived, so that My profile (#242) can reuse them.
- **The volunteer says it was sent.** `vitally_mark_upload_sent` lets a staff caller mark their own Form 13615 or photo ID as sent now. It is refused when the caller has no current-season entry, and for the photo ID when the entry isn't new or the photo ID is already checked.
- **The setup screen.** The 13615 and photo ID items get **Upload**, which opens the certificate upload link in a new tab, and **I've uploaded it**. After sending, the item shows "Waiting for review · sent <date>". With no link set, the screen says "Ask your site coordinator how to send it." instead of offering Upload.
- **The clearance answer** (`vitally_my_clearance()`):
  - From: it returns the role capabilities even when the caller is not cleared, and it never returns the upload link.
  - To: it returns empty `capabilities` whenever `cleared` is false (#193 item 7). It returns `uploadUrl` to any caller with a current-season roster entry, and `sentAt` on the matching missing items.
  - Reason: the setup screen needs the link and the dates, and an uncleared caller shouldn't be told they hold capabilities.
  - Impact: non-breaking for the app, which decides from `cleared`. One database test is converted.
- **What the admin sees.**
  - The Roster row shows "Form 13615 to review" or "Photo ID to review".
  - A new **Show** dropdown, "Everyone" or "Uploads to review", combines with Role and search.
  - The Edit drawer shows "Form 13615 sent <date>" and "Photo ID sent <date>", each with **Mark reviewed** (`vitally_mark_upload_reviewed`, for workspace admins).
  - For workspace admins, the sidebar shows the count next to Volunteers ("Volunteers · 3").
- **Saving clears the dates.** In `vitally_save_volunteer`:
  - From: a save never touches anything the volunteer sent.
  - To: a save that changes the person's roles or confirmed certificates clears `form_13615_sent_at`, and ticking Photo ID checked clears `photo_id_sent_at`.
  - Impact: the payload is unchanged.
- **Where the links are shown.**
  - From: the Season settings links are shown nowhere but Season settings.
  - To: the certificate upload link is also returned to rostered staff through their own clearance answer. The client documents link and the admin-only settings read are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `volunteer-clearance`:
  - the clearance answer adds `uploadUrl` and `sentAt`, and returns empty capabilities when the caller is not cleared;
  - the setup screen gains Upload, I've uploaded it and the waiting state;
  - a new requirement covers the volunteer's "sent" RPC.
- `volunteer-roster`:
  - the row shows what is waiting for review;
  - the search-and-filter requirement gains the Show filter;
  - edit gains the sent lines, Mark reviewed and the clearing rules;
  - new requirements cover Mark reviewed and the sidebar count.
- `season-settings`: the sentence about where the links are shown now lets the certificate link reach rostered staff.

## Impact

- **Database:** new migration `supabase/migrations/053_clearance_uploads.sql`:
  - two new columns on `roster_entries`;
  - new RPCs `vitally_mark_upload_sent(uuid,text)` and `vitally_mark_upload_reviewed(uuid,uuid,bigint,text)`;
  - new bodies for `vitally_my_clearance()` and `vitally_save_volunteer(...)`.
  - No new table, no new policy and no realtime publication change.
- **App:**
  - `src/clearance.mjs` and `src/setup-views.mjs`: the setup items;
  - `src/volunteer-roster.mjs` and `src/volunteer-views.mjs`: the Show filter, row text and drawer lines;
  - `src/views.mjs`: the sidebar count;
  - `src/controller.mjs`: the new actions, the count read and its re-reads;
  - `src/supabase-store.mjs` and `src/contracts.mjs`: the new store calls.
- **Tests:**
  - a new `tests/database-clearance-uploads.mjs`;
  - one converted test in `tests/database-clearance.mjs`;
  - unit tests for the views and filter;
  - a separate browser test in `tests/browser.mjs`, outside the story.
- **Hosted:** after merge, run 053 on classroom the same day (`node --env-file=.env.admin tools/admin/migrate.mjs --target classroom`, with `NODE_EXTRA_CA_CERTS`).
- **Issues:** part of #138. Refs #193 (item 7 done). My profile (#242) builds on this.
