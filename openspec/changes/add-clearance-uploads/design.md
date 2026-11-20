## Context

- **The problem.** Volunteers send PCDC a signed Form 13615 and, if new, a photo ID through a OneDrive upload link. ViTally's setup screen (`src/setup-views.mjs`, its lines from `src/clearance.mjs` `missingLines`) names the 13615 and the photo ID check. It doesn't offer the link or any way to say a file was sent, and admins can't see who is waiting.
- **Season settings.** Migration 052 added `season_settings.certificate_upload_url`, which is set on hosted. Only the admin-only `vitally_season_settings()` reads it.
- **What the Roster reads.** `store.listVolunteers` reads `roster_entries`, `volunteer_profiles`, `certificates`, `people` and `accounts` directly. Their select policies are admin-only (044 `admin_roster_entries`), and the grant is a table-level `select`. A new `roster_entries` column therefore reaches workspace admins and nobody else, with no policy change. `roster_entries` is not in `STAFF_TABLES`, so it is not live. The controller reads the Roster when the Volunteers screen opens, after saves and on refresh while on that screen (`readVolunteers`).
- **`vitally_save_volunteer` (052).** It takes `(p_action_id, p_volunteer_id, p_expected_revision, p_volunteer)` and refuses a caller who isn't a workspace admin with `FORBIDDEN` before anything else. It reserves a receipt with an operation name and a sha256 digest of the call, and checks the revision on `volunteer_profiles.revision` (`CONFLICT`). It returns `{actionId, personId, revision}`.
- **Refreshing the clearance.** An uncleared window re-reads only its clearance (and the screen it is on) on focus, `online` and Check again (`runRefresh`). A cleared window re-reads its clearance on wake events first.
- **Dates and badges.** Staff dates use a New York "Nov 20" format (`src/update-views.mjs` `DAY`). The sidebar's Notifications badge is drawn `aria-hidden`, and the name goes in an `aria-label`.
- **Constraints:**
  - migrations 045 and 052 are applied and final, so the change goes in a new 053;
  - staff screens are English only;
  - fictional data;
  - the story is at about 590 s of its 900 s budget and must not grow;
  - the machine has about 1 GB free, so there are no full local browser runs.
- **Stakeholders:**
  - volunteers on the setup screen;
  - workspace admins (site coordinators and Admin-role holders) on the Roster;
  - My profile (#242), the next change, which reuses this one's column, RPC and `uploadUrl`.

## Goals / Non-Goals

**Goals:**
- A rostered volunteer can open the upload link and say their Form 13615 or photo ID was sent. They then see that it is waiting for review.
- A workspace admin sees who has something to review, filters to them, and clears it by acting on it or with Mark reviewed.
- The sent dates are stored, so a cleared volunteer can later send a new 13615 (My profile) with no change to this design.
- `vitally_my_clearance()` returns empty capabilities whenever the caller is not cleared (#193 item 7).

**Non-Goals:**
- storing or previewing files;
- any Microsoft or OneDrive API;
- a reviewer folder link;
- notifications or emails;
- per-certificate uploads;
- the client documents link (#157);
- re-sending a 13615 from the UI once cleared (My profile, #242);
- the unused `certificates.status = 'uploaded'` value, which is left as is;
- live (realtime) updates of the Roster or the count.

## Decisions

### D1: One sent date per document on the current-season roster entry
- **Choice:** in 053, `alter table public.roster_entries add column form_13615_sent_at timestamptz, add column photo_id_sent_at timestamptz`. Null means nothing is waiting, and a set value means "to review".
- **Why:**
  - one 13615 lists every certificate, so the volunteer sends one document, not one per certificate;
  - the roster entry is already per person and season, and admin-only to read;
  - a stored date, rather than one derived from "still missing", lets My profile send a new 13615 while the volunteer is cleared.
- **Alternatives considered:**
  - per-certificate `uploaded` rows: they don't match one document, and they mix the volunteer's claim with the admin's confirmation;
  - deriving "to review" from the missing items: it can't express a cleared volunteer's new 13615;
  - a separate uploads table with history: the history is not needed.

### D2: The volunteer marks their own document: `vitally_mark_upload_sent(p_action_id uuid, p_document text)`
- **Choice:**
  - **Caller and refusals:**
    - The caller is resolved with `require_membership`. A client or anonymous caller, or a staff caller with no person row, is refused `FORBIDDEN`. There is no clearance gate.
    - `p_document` must be `form13615` or `photoId`, and `p_action_id` must be given. Otherwise the call is refused `VALIDATION`.
    - A caller with no current-season entry is refused `VALIDATION` with detail `NO_ROSTER_ENTRY`.
    - A `photoId` call on an entry that is not new, or is already checked, is refused `VALIDATION` with detail `PHOTO_ID_NOT_NEEDED`.
    - Every refusal comes before the receipt is reserved, so it writes nothing and stores no receipt.
  - **Receipt:** it reserves `MARK_UPLOAD_SENT`, with a digest over the operation, document and person. The same action id returns the stored result.
  - **Writes:**
    - It sets the document's column to `now()`. Sending again under a new action id updates the date.
    - It raises `volunteer_profiles.revision` (and `updated_at`).
  - **Returns** `{actionId, document, sentAt}`. Execute is granted to `authenticated`.
- **Why:**
  - It acts only on the caller, so there is no way to name another person, and "marks only their own documents" holds by construction.
  - The 13615 is not refused for a cleared caller, so My profile can call it unchanged.
  - Raising the revision means an admin whose drawer was opened before the send gets the existing `CONFLICT` ("Someone else changed this volunteer") on Save. Without it, their Save would silently clear a sent date they never saw.
- **Alternatives considered:**
  - Taking a person id and checking it against the caller is a needless surface.
  - Not raising the revision leaves the silent-clear race above.
  - A clearance gate would block the very people who need the call.

### D3: Mark reviewed follows `vitally_save_volunteer`: `vitally_mark_upload_reviewed(p_action_id uuid, p_volunteer_id uuid, p_expected_revision bigint, p_document text)`
- **Choice:**
  - **Caller:** it uses the same opening as Save. `require_membership`, `acting_person` and `is_workspace_admin` must pass, cleared or not; otherwise it is refused `FORBIDDEN` before any other check.
  - **Malformed calls:** a missing argument or an unknown document is refused `VALIDATION`.
  - **Receipt and revision:**
    - It reserves the receipt `MARK_UPLOAD_REVIEWED`, with a digest over the operation, volunteer, expected revision, document and person.
    - It locks the profile `for update`. An unknown volunteer is refused `NOT_FOUND`, and a stale revision is refused `CONFLICT`.
  - **Writes:**
    - If the current-season entry's column is set, it clears it and raises the revision.
    - If nothing is waiting, it writes nothing and returns the current revision.
  - **Returns** `{actionId, personId, revision}`. Execute is granted to `authenticated`.
- **Why:**
  - The same argument order, refusals and result as Save, so the drawer's store and conflict handling are reused.
  - An idempotent no-op means a second admin who presses it a moment later isn't shown an error for something already done.
- **Alternatives considered:**
  - A `markReviewed` key in Save's payload would change Save's exact-keys contract and tie Mark reviewed to an unsaved form.
  - Refusing when nothing is waiting would show an error for a harmless double press.

### D4: Save clears the sent dates when it acts on them
- **Choice:** in 053's `vitally_save_volunteer`, nothing changes except the roster entry write.
  - It sets `form_13615_sent_at = null` when the saved roles differ from the stored current-season roles (as sets), or when the confirmed certificate set changes. That includes a ticked `uploaded` row becoming confirmed, and an unticked confirmed row being deleted.
  - It sets `photo_id_sent_at = null` when the stored `photo_id_checked_at` was null and the save sets it, or when the stored entry was new and the save unticks New (someone who isn't new needs no photo ID).
  - A new volunteer's insert has nothing to clear.
  - The payload keys, validation, `OPEN_WORK`, `ADMIN_ROLE` and the receipt are unchanged.
- **Why:** this is the agreed rule ("saving that person's certificates or roles, any change"). It is read as "a change to them": a save that only fixes a phone number shouldn't drop a pending 13615.
- **Alternatives considered:** clearing on every save would lose pending reviews on unrelated edits.

### D5: The clearance answer carries the link, the dates, and empty capabilities when uncleared
- **Choice:** in 053's `vitally_my_clearance()`:
  - The `form13615` and `photoId` missing items gain `sentAt`: the entry's column, or null.
  - A new top-level `uploadUrl` holds the workspace's `season_settings.certificate_upload_url` when the caller has a current-season entry, and null otherwise (no entry, or no link set).
  - `capabilities` is `[]` whenever `cleared` is false, and otherwise `effective_capabilities` as before (#193 item 7).
  - Every other key is unchanged.
- **Why:**
  - The setup screen needs the link and the dates, and the caller may not read `season_settings` or `roster_entries`.
  - Returning the link to any rostered caller, not only while an item is missing, serves My profile. The link is upload-only.
  - Empty capabilities for an uncleared caller remove a misleading answer. The app already decides from `cleared`, and the only reader of `clearance.capabilities` is `withOwnCapabilities`, which matters only on case screens an uncleared window never reaches. The plan re-checks this by grep before changing the answer.
- **Alternatives considered:**
  - Opening the Season settings read to all staff would expose the SIDN state and the client documents link.
  - A separate "my uploads" RPC would add one more call on every clearance check.

### D6: The setup screen's two items
- **Choice:** the `form13615` and `photoId` items each render their line plus actions.
  - **Before sending:**
    - With a link, they show an **Upload** link (`target="_blank" rel="noopener"`).
    - With no link, they show "Ask your site coordinator how to send it." instead of Upload.
    - In both cases they show an **I've uploaded it** button (`data-action`, carrying the document).
  - **After sending:** Upload, or the ask line, stays. The button is replaced by "Waiting for review · sent Nov 20", in the New York short format.
  - **Pressing the button:**
    - it calls the store's `markUploadSent(actionId, document)`, with a fresh action id per press and the same id on a retry after a lost answer;
    - then it re-reads the clearance as Check again does;
    - a refusal or a failure shows in the setup screen's notice area.
  - Role and SC items are unchanged, and the text stays English.
- **Why:**
  - Upload stays after sending, so a volunteer can send a corrected file.
  - The UI offers no re-send in this change (scope), but the RPC allows one.
- **Alternatives considered:** hiding Upload after sending would leave no way to send a corrected file.

### D7: The Roster: row text, the Show filter, and the drawer
- **Choice:**
  - **Row text:** `combineVolunteers` carries `form13615SentAt` and `photoIdSentAt` from the entry. The row's status adds "Form 13615 to review" and/or "Photo ID to review" next to the existing missing or cleared text.
  - **Show filter:**
    - A new **Show** dropdown (`data-volunteer-filter="show"`) sits next to Role. Its options come from one exported list (`SHOW_VIEWS`): `all` "Everyone" and `uploads` "Uploads to review". Each view is a keyed predicate in `filterVolunteers`, ANDed with Role and search.
    - `setVolunteerFilter` accepts `show`.
    - The empty state stays "nobody matches".
    - Adding a view later means adding one entry to the list.
  - **Drawer:**
    - When editing, the drawer shows "Form 13615 sent <date>" above the certificates and "Photo ID sent <date>" by the Photo ID tick. Each has a secondary **Mark reviewed** (`data-action`, carrying the document).
    - Mark reviewed calls the store with the drawer's revision, adopts the returned revision, and keeps the admin's unsaved edits, because Mark reviewed touched nothing that Save sends.
    - It then re-reads the Roster and the count.
    - A `CONFLICT` uses the drawer's existing conflict message and re-read.
- **Why:**
  - These are the user's choices for the Show dropdown and the drawer.
  - A list-plus-predicate filter keeps "easy to add more views later" literal.
- **Alternatives considered:** this decision is settled (brainstorm Q7). An option in the Role dropdown or a chip was rejected.

### D8: The sidebar count for workspace admins
- **Choice:**
  - **The read:** a store call `countUploadsToReview()` counts the current-season `roster_entries` rows with either date set, using a `head` count under the admin policy.
  - **When it runs:** the controller reads it only for a workspace-admin staff window (`ceilingAdmin`), cleared or not:
    - with the data load;
    - with every clearance check, which covers an uncleared admin's focus, `online` and Check again;
    - on a cleared window's wake refresh;
    - after the admin's own Save or Mark reviewed;
    - whenever the Roster list is read.
  - **A failed read** keeps the last count and never fails anything else.
  - **Rendering:**
    - The Volunteers nav link reads "Volunteers" plus `<span class="nav-count" aria-hidden="true"> · 3</span>`, with `aria-label="Volunteers, 3 uploads to review"` (singular at 1: "Volunteers, 1 upload to review"). The badge follows the Notifications pattern.
    - At 0 it is plain "Volunteers".
    - It counts people, not documents.
- **Why:**
  - `roster_entries` isn't live, and adding it to the realtime publication would be a contract change this feature doesn't need.
  - The re-read points match how the clearance and the Roster already refresh.
- **Alternatives considered:**
  - Realtime on `roster_entries` would add publication and channel work and more traffic for every staff window.
  - Deriving the count from `state.volunteers` would be empty until the Roster is opened.

### D9: Tests
- **Choice:**
  - **New `tests/database-clearance-uploads.mjs`**, using the existing fixtures (`f.staff`, `f.sql`) and staying in its own workspace. It covers:
    - own-only marking;
    - the photo ID refusals (not new, already checked);
    - no current-season entry;
    - a client refused;
    - a receipt replay;
    - Save clearing the 13615 date on a role or certificate change, and not on a phone-only edit;
    - the Photo ID tick clearing its date;
    - Mark reviewed clearing either date, the no-op, `CONFLICT`, and `FORBIDDEN` for a non-admin;
    - the send raising the revision so a stale admin Save gets `CONFLICT`;
    - `sentAt` and `uploadUrl` in `vitally_my_clearance()` (null with no link, null with no entry);
    - a non-admin reading `roster_entries` sees no rows, so no one else's sent dates.
  - **The converted #193 test** in `tests/database-clearance.mjs`: the `unchecked` half asserts `capabilities` `[]`, and the comment is rewritten. It is not deleted.
  - **Unit tests:** setup items in all four states, `SHOW_VIEWS` and `filterVolunteers` with `show`, row text, drawer lines, and the sidebar label and aria-label.
  - **A browser test:** a separate top-level `test(...)` in `tests/browser.mjs` beside "A site coordinator changes Season settings", with the flow in brainstorm C8. The story is not touched.
- **Why:** this is the agreed acceptance. A separate browser test keeps the story's 900 s budget safe.

## Risks / Trade-offs

- [Risk] The count goes stale: an admin sitting on another screen won't see a new send until focus, a wake event or their next action. → Mitigation: it re-reads on the same events as the clearance, and the Roster re-reads on open. This is accepted because the work isn't time-critical and the count is a hint.
- [Risk] Raising the revision on a volunteer's send turns an admin's in-flight Save into `CONFLICT`. → Mitigation: that is the intended, existing message and re-read. The admin then sees the sent line and decides.
- [Trade-off] "Any change" is read as a change to roles or certificates, not any save (D4). → Accepted by the user at plan review.
- [Risk] Returning empty capabilities when uncleared could hide a button that some uncleared path relies on. → Mitigation: a grep for `clearance.capabilities` and `withOwnCapabilities` shows only case-screen use. The plan re-checks this, and the unit and browser tests run the uncleared admin's Roster, Post an update and Season settings.
- [Risk] The new accessible name "Volunteers, N upload(s) to review" could break a test that looks the link up by exact name. → Mitigation: today's tests open it by `data-action`, and the count is 0 in the story. The plan greps the browser tests for the name.

## Migration Plan

1. **053** (`supabase/migrations/053_clearance_uploads.sql`), hand-written:
   - the two columns;
   - `vitally_mark_upload_sent`;
   - `vitally_mark_upload_reviewed`;
   - the new bodies of `vitally_my_clearance()` and `vitally_save_volunteer(...)`, each marked `-- 053` on changed lines;
   - the revokes and grants.

   It has no data backfill: existing rows start with null, meaning nothing waiting.
2. **Locally:** `npm run db:migrate:test` on a stack that already has `main`'s migrations, then `npm run test:database` at concurrency 1 (memory).
3. **CI:** the PR's run covers `checks`, `database`, `sign-in` and both story legs. Its browser screenshots are reviewed.
4. **Hosted:** after merge, the same day, run 053 on classroom with `node --env-file=.env.admin tools/admin/migrate.mjs --target classroom` and `NODE_EXTRA_CA_CERTS` set. This step goes in the PR body.
5. **Rollback:** a follow-up migration drops the two RPCs and the columns and restores 052's two function bodies. The app degrades only if it is rolled back without the code.

## Open Questions

None. The reading of "any change" in D4 was accepted at plan review, and unticking New was added to D4 there.
