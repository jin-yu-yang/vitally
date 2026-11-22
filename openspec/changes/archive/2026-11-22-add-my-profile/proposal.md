## Why

A staff member has no page of their own. They can't see which roles and certificates the office recorded for them this season. Someone who passes a higher certification mid-season can't tell the office they sent a new Form 13615; PCDC does this in Slack (#242). When an admin presses Mark reviewed on a document that is still missing, the volunteer's setup screen just goes back to "I've uploaded it" with no reason, so people press it again without uploading anything new. The clearance answer also hands the upload link to an invited account that hasn't passed the site check yet (#246). Both build on 053's upload flow, and both should land before the pilot.

## What Changes

- **My profile**, a new screen for cleared staff (admins included), opened from the sidebar's account row.
  - **The volunteer edits:** name, phone, works, languages (with other language) and usual days.
  - **Read-only:** this season's roles and certificates, marked "Managed by the office" with the site coordinator's name, and the account status. Email is locked.
  - **"Passed a higher certification? Send your new Form 13615":** reuses 053's sent date, `vitally_mark_upload_sent`, `uploadUrl` and the admin review.
  - Uncleared staff keep the setup screen instead.
- **Usual days:** a new field of seven weekdays on the volunteer record. The volunteer edits it on My profile; admins edit it in the Roster drawer. It is visible to the volunteer and admins only.
- **New RPCs:** `vitally_my_profile()` (the caller's own read) and `vitally_save_my_profile()` (the caller's own save, using the revision and receipt pattern).
- **Mark reviewed**
  - From: Mark reviewed clears the sent date with no reason, and the volunteer is told nothing.
  - To:
    - It requires a reason: a quick pick or a note of up to 120 characters. The quick picks for a Form 13615 are "Not signed", "Can't read it", "Wrong form", "Missing a certification" and "Already on file". For a photo ID they are "Can't read it", "Expired" and "Not a photo ID".
    - The reason and time are stored per document on this season's roster entry.
    - The volunteer sees the reason on the setup screen and on My profile. A 13615 sent back as "Already on file" gets its own line saying nothing needs sending.
    - Admins see "Last returned: <reason> · <date>" in the Edit drawer.
    - The reason clears when the volunteer sends again, or when an admin's save acts on that document.
  - Reason: volunteers read a silent reset as the app losing their file.
  - Impact: breaking for the RPC. `vitally_mark_upload_reviewed` gains a required `p_reason`, and the four-argument form is dropped. Admin tabs opened before the deploy must reload.
- **`uploadUrl` under the site check**
  - From: `vitally_my_clearance()` returns `uploadUrl` to any caller with a current-season entry.
  - To: it returns null while `siteCheck` is true.
  - Reason: the link should not reach an account that hasn't confirmed its site.
  - Impact: non-breaking; the screen already hid it.
- **The admin's save** `vitally_save_volunteer` accepts an optional `usualDays`, which is left unchanged when absent. It also clears the review reason under the same conditions that clear the sent date.
- **Migration 057.** If 056 (#245) hasn't merged first, this change waits for it.

## Capabilities

### New Capabilities
- `my-profile`: the My profile screen, the caller's own profile read and save, and re-sending a Form 13615 from it.

### Modified Capabilities
- `volunteer-clearance`:
  - the clearance answer carries the review reason on the document items, and withholds `uploadUrl` during the site check;
  - marking a document sent clears its review reason;
  - the setup screen says why a document came back.
- `volunteer-roster`:
  - Mark reviewed requires a reason, which is stored, in a reason row in the drawer, and the drawer shows the last reason;
  - the admin save carries usual days and clears the review reason when it acts on a document.

## Impact

- **Database:** migration `supabase/migrations/057_my_profile.sql`, which:
  - adds columns on `roster_entries` and `volunteer_profiles`;
  - replaces `vitally_my_clearance`, `vitally_mark_upload_sent`, `vitally_save_volunteer` and `vitally_mark_upload_reviewed` (new signature; old one dropped);
  - adds `vitally_my_profile` and `vitally_save_my_profile`.
- **Browser code:**
  - `src/supabase-store.mjs`, `src/controller.mjs` and `src/app.mjs`;
  - `src/views.mjs` (sidebar account row, the new screen);
  - a new `src/profile-views.mjs`;
  - `src/setup-views.mjs` and `src/clearance.mjs` (reason line);
  - `src/volunteer-views.mjs` and `src/volunteer-roster.mjs` (reason row, usual days);
  - `src/styles.css`.
- **Tests:**
  - unit tests (views, controller, clearance);
  - a new `tests/database-my-profile.mjs`, plus updates to `tests/database-clearance-uploads.mjs` for the new Mark reviewed argument;
  - a new test block in `tests/browser.mjs`, "A volunteer edits My profile and re-sends a Form 13615".
- **Docs:** developer guide migration and RPC counts; the roadmap for #242 and #246.
- **Deploy:** hosted runs 057 right after the merge, after 056. The front end goes live from `main` and calls the new functions.
