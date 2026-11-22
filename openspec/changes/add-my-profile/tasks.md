## 1. Migration 057: columns and the clearance answer

- [x] 1.1 Write `supabase/migrations/057_my_profile.sql` §1 (design D3, D5):
  - the four reviewed-time and reason columns on `roster_entries`, with checks keeping each pair both set or both null and each reason 1–120 characters;
  - `volunteer_profiles.usual_days text[] not null default '{}'`, with a check for the seven values, no repeats.
- [x] 1.2 §2 `vitally_my_clearance()`, copied from 053 (design D4):
  - add `reviewedAt` and `reviewReason` to the `form13615` and `photoId` items;
  - make `uploadUrl` null while `siteCheck` is true.
- [x] 1.3 §3 `vitally_mark_upload_sent`, copied from 053: clear the sent document's reviewed time and reason (design D3).
- [x] 1.4 Database tests (new `tests/database-my-profile.mjs`, or extending `tests/database-clearance-uploads.mjs`) for the volunteer-clearance deltas:
  - the review fields in the answer;
  - no `uploadUrl` before the site check, and the link after it;
  - sending again clears the reason.

## 2. Migration 057: Mark reviewed and the admin save

- [x] 2.1 §5 drop `vitally_mark_upload_reviewed(uuid,uuid,bigint,text)` and create the five-argument version with `p_reason` (design D6):
  - trim the reason and require 1–120 characters, checked after the admin check;
  - include the reason in the digest;
  - set the reviewed time and reason only when a sent date is cleared;
  - grants as in 053.
- [x] 2.2 §4 `vitally_save_volunteer`, copied from 053:
  - accept the ten keys, or the ten plus `usualDays`, validating them and storing them in week order;
  - leave the days unchanged without the key;
  - clear each document's reviewed time and reason under the conditions that clear its sent date (design D3, D5).
- [x] 2.3 Update `tests/database-clearance-uploads.mjs` callers of Mark reviewed to pass a reason. Add tests for:
  - the reason stored;
  - a missing, blank or 121-character reason refused;
  - nothing waiting leaves the first reason;
  - the four-argument call gone.
- [x] 2.4 Database tests for the save:
  - usual days set, kept without the key, refused when unknown or repeated;
  - the reason cleared by a role or certificate change, and by Photo ID checked;
  - the reason kept by a phone-only edit;
  - usual days not readable by a non-admin.

## 3. Migration 057: the caller's own profile RPCs

- [x] 3.1 §6 `vitally_my_profile()` (design D1), granted to `authenticated` only.
- [x] 3.2 §7 `vitally_save_my_profile(p_action_id, p_expected_revision, p_profile)` (design D2):
  - the exact six-key payload, under the volunteer form's rules;
  - the revision with `CONFLICT`, and a `SAVE_MY_PROFILE` receipt;
  - writes `people.name` and the caller's profile only.
- [x] 3.3 Database tests in `tests/database-my-profile.mjs` for every `my-profile` RPC scenario:
  - the read for a cleared Preparer and for a came-back 13615;
  - a client refused;
  - the save writes only the caller and refuses other keys and a long name;
  - a stale save both ways (volunteer and admin);
  - a repeated action id; a client refused with no receipt.
- [x] 3.4 Run the database files through `database-quick.yml` on the pushed branch until green (no local Docker).

## 4. Store, clearance and controller

- [ ] 4.1 `src/supabase-store.mjs`:
  - `markUploadReviewed` sends `p_reason`;
  - add `getMyProfile()` and `saveMyProfile(request)`;
  - `listVolunteers` and `src/volunteer-roster.mjs` carry `usualDays` and the four review fields;
  - `saveVolunteer` sends `usualDays`.
- [ ] 4.2 `src/clearance.mjs`: `uploadItems` carries `reviewedAt` and `reviewReason`. Add a shared helper that gives the D8 line for an item: the already-on-file line only for a 13615 whose reason is exactly "Already on file"; every photo ID reason gets the generic line. Unit tests.
- [ ] 4.3 `src/controller.mjs`:
  - `markUploadReviewed(document, reason)`;
  - a `my-profile` screen with its read state;
  - `openMyProfile`, `saveMyProfile` (pending request, same action id on retry, `CONFLICT` re-read, a name re-read after a save);
  - `markUploadSent` re-reads the profile when called from My profile;
  - losing clearance leaves My profile for the setup screen.
  Unit tests in `tests/controller.test.mjs`.

## 5. Screens

- [ ] 5.1 `src/setup-views.mjs`: the reason line under a returned item (design D8). Unit tests in `tests/setup-views.test.mjs`.
- [ ] 5.2 `src/volunteer-views.mjs`:
  - the reason row for Mark reviewed (quick picks per document: for a 13615 "Not signed", "Can't read it", "Wrong form" and "Missing a certification", plus "Already on file" only with a role this season; for a photo ID "Can't read it", "Expired" and "Not a photo ID"; a note with maxlength 120; Send back disabled until one is given; Cancel);
  - "Last returned: <reason> · <date>" in a document's place when a review reason is stored;
  - the Usual days checkboxes in the drawer.
  `src/app.mjs` wiring keeps the unsaved drawer edits. Unit tests.
- [ ] 5.3 New `src/profile-views.mjs`: the My profile screen (design D9).
  - Your details (editable, with a locked email and the read-only account status);
  - This season (read-only, "Managed by the office" and the site coordinator);
  - the 13615 section (Upload or the ask text, I've uploaded it or "Waiting for review · sent <date>", the D8 line).
  English only. Unit tests.
- [ ] 5.4 `src/views.mjs`: the account row becomes a link reading "My profile", with the signed-in name as a smaller second line, for a cleared staff window only; route the `my-profile` screen. `src/app.mjs` handles the open, save and send actions. `src/styles.css` for the new screen and reason row. Unit tests.

## 6. Browser test and docs

- [ ] 6.1 `tests/browser.mjs`: a new block, "A volunteer edits My profile and re-sends a Form 13615", with its own workspace. It covers:
  - editing details and usual days, and the sidebar name updating;
  - sending a 13615;
  - an admin sending it back with "Wrong form" in the drawer;
  - the reason on My profile;
  - sending again, which clears it.
- [ ] 6.2 Extend "A volunteer says their uploads were sent, and an admin reviews them": Mark reviewed gives a reason, and the setup screen shows the reason line.
- [ ] 6.3 Docs: the developer guide's migration and RPC counts and its RPC list; the roadmap entries for #242 and #246; the database notes for the new columns.
- [ ] 6.4 Run `npm test`. Push, and get the PR's full CI run green (`checks`, `database`, `sign-in`, both `story` legs). Record per-phase story timings, and review the story screenshots from the run's artifacts.
