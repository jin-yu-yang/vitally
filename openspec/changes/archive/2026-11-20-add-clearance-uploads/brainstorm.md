# Brainstorm: add-clearance-uploads

Part of #138. Migration 053. Also does #193 item 7.

The design was agreed with the user in an earlier session; all five promotion
criteria held when propose started. This file records those decisions, two
answers the user gave during propose (after a check of the code), and the
calls made while reading the code, each marked **(my call)**. Settled items
are not to be reopened.

## Background

- PCDC volunteers send one signed Form 13615 and, if they are new, a photo ID,
  through PCDC's OneDrive upload link. The 13615 lists the certifications the
  volunteer passed; signing it is the VSC.
- Today the setup screen ("Finish your setup for this season",
  `src/setup-views.mjs`) says "Upload your signed Form 13615." and "Have your
  photo ID checked." (`src/clearance.mjs` `missingLines`). It offers no way to
  open the link or to say the file was sent. Admins cannot see who is waiting
  for review.
- 052 added `season_settings.certificate_upload_url`, which is already filled
  on hosted. Only `vitally_season_settings()` reads it, and only for a
  workspace admin. The season-settings spec says the links "SHALL NOT be shown
  anywhere else in this change; the uploads change and #157 will use them."
- The Roster reads `roster_entries`, `volunteer_profiles`, `certificates`,
  `people` and `accounts` directly (`store.listVolunteers`). The policy
  `admin_roster_entries` from 044 limits them to workspace admins, and the
  grant is a table-level `select`, so any new column reaches admins and nobody
  else. `roster_entries` is not in the staff realtime list. The Roster
  re-reads when it opens and after saves.
- The revision for `vitally_save_volunteer` lives on
  `volunteer_profiles.revision` (`p_expected_revision`, `CONFLICT` on a
  mismatch). A receipt is reserved through `reserve_receipt` with an operation
  name and a digest of the call, and the result is `{actionId, personId,
  revision}`.

## Scope

**In:**
- "I've uploaded it" for the Form 13615, and for the photo ID (new volunteers
  only), on the setup screen;
- "to review" on the admin side;
- Mark reviewed;
- the upload link on the setup screen;
- #193 item 7.

**Out:**
- storing files;
- a folder link for reviewers (site coordinators open OneDrive themselves);
- any Microsoft API;
- notifications;
- per-certificate uploads;
- #157 (client documents link);
- a cleared volunteer re-sending a 13615 after a higher certification. That is
  the next change, My profile (#242), which will reuse this change's field,
  RPC, admin review and `uploadUrl` unchanged.

## Decisions (agreed)

**Q1. Where is "sent" stored?** On this season's roster entry, one column per
document: `roster_entries.form_13615_sent_at` and `photo_id_sent_at`
(timestamptz; null means nothing is waiting). It is not stored per
certificate, because one 13615 lists every certificate. The unused
`certificates.status = 'uploaded'` value is left alone.

**Q2. What does "to review" mean?** A sent date is set. It is stored, not
derived from "still missing", so that My profile can later let a cleared
volunteer send a new 13615 with no change here.
- `form_13615_sent_at` is cleared when an admin saves that person's
  certificates or roles (any change), or presses **Mark reviewed** in the Edit
  drawer. Mark reviewed is for when the file was wrong or adds nothing; the
  admin tells the volunteer why outside ViTally.
- `photo_id_sent_at` is cleared when Photo ID checked is ticked, when
  "New volunteer" is unticked (added at plan review: someone who isn't new
  needs no photo ID, so nothing should wait), or by Mark
  reviewed.

**Q3. The volunteer RPC.** The caller marks their own Form 13615 or photo ID
as sent now.
- It is refused when the caller has no current-season roster entry.
- For the photo ID, it is also refused when the entry isn't new or the photo
  ID is already checked.
- Sending again updates the date.
- The database does not refuse the 13615 for a cleared caller, because My
  profile will use it. This change's UI offers it only on the setup screen.

**Q4. The admin RPC for Mark reviewed.** It runs under `is_workspace_admin`,
with the usual revision and receipt pattern, in the shape that fits
`vitally_save_volunteer`'s conventions (chosen below).

**Q5. The setup screen.** The 13615 and photo ID items each show **Upload**
(it opens the Season settings link in a new tab) and **I've uploaded it**.
After sending, the item shows "Waiting for review · sent <date>". With no link
set, Upload is replaced by "Ask your site coordinator how to send it.", and
I've uploaded it still works. `vitally_my_clearance()` adds `sentAt` to the
matching missing items. Staff text, English only.

**Q6. The admin side.**
- The Roster row shows "to review" for either document.
- A filter gains "Uploads to review" (see Q7).
- The Edit drawer shows "Form 13615 sent <date>" and "Photo ID sent <date>",
  each with Mark reviewed.
- For workspace admins only, the staff sidebar shows the count next to
  Volunteers ("Volunteers · 3").

## Decisions taken during propose (user's answers)

**Q7. Where does "Uploads to review" go?** The Roster has no "Show" filter
today, only Role and search (`src/volunteer-views.mjs` `toolbar`). The user
chose to add a **"Show"** dropdown next to Role with "Everyone" and "Uploads
to review". It combines with Role and search the way those two combine. It
should be easy to add more views later, so the options are a list and the
filter is a keyed predicate, not an if/else on one value.

Rejected:
- an "Uploads to review" option inside the Role dropdown (it mixes a status
  into roles and cannot combine with a role);
- a separate chip or toggle.

**Q8. How does a volunteer get the link?** `vitally_my_clearance()` returns
`uploadUrl`: the workspace's `certificate_upload_url`, or null. The user
widened this from "only while an item is missing" to **whenever the caller has
a current-season roster entry**, because My profile (#242) will need the same
link for a cleared volunteer, and the link is upload-only. A caller with no
current-season entry gets `uploadUrl: null`. The admin-only
`vitally_season_settings()` read and the SIDN stay unchanged. The delta spec
modifies the season-settings sentence "The links SHALL NOT be shown anywhere
else in this change": the certificate link is now also returned to rostered
staff through their own clearance answer, and the client documents link is
still shown nowhere else (#157).

**Q9. #193 item 7, folded in.** 053 rewrites `vitally_my_clearance()`, so it
also returns an empty `capabilities` list whenever `cleared` is false.
- The spec gains a scenario for an uncleared staff member who has roles (a new
  volunteer whose photo ID isn't checked): `capabilities` is empty.
- The test "a new volunteer without a photo ID check is not cleared"
  (`tests/database-clearance.mjs` ~1035) is the one commit 775d323 changed to
  assert `["prepare"]` ("an unchecked new volunteer keeps the capabilities of
  their roles"). It is converted to assert `[]`, not deleted. The `checked`
  half still asserts `["prepare"]`.
- The PR body says "Refs #193 (item 7 done)", never "Closes".
- Only `vitally_my_clearance()`'s answer changes.
  `vitally_private.effective_capabilities` and the RPC gates are unchanged:
  uncleared staff are already refused by `NOT_CLEARED` and the read gate.
- Code check: the app reads `clearance.capabilities` only in
  `withOwnCapabilities` (it overwrites the caller's own `people` entry). The
  places that depend on capabilities are case forms, which an uncleared window
  never reaches. The Roster, Post an update and Season settings follow
  `isAdmin`. The plan must re-grep and confirm this before changing the
  answer.

## Calls made while reading the code (my call)

**C1. The volunteer RPC's shape** **(my call)**:
`vitally_mark_upload_sent(p_action_id uuid, p_document text)`.
- `p_document` is `'form13615'` or `'photoId'`, the same kinds as the
  clearance items.
- The caller is resolved by `require_membership`. A client or anonymous caller
  is refused `FORBIDDEN`. The call is not gated by clearance, because an
  uncleared volunteer is the one who uses it.
- Refusals: `VALIDATION` for an unknown document; `VALIDATION`
  `NO_ROSTER_ENTRY` when the caller has no current-season entry; `VALIDATION`
  `PHOTO_ID_NOT_NEEDED` when the entry is not new or is already checked. A
  refusal writes nothing and stores no receipt.
- It reserves a receipt (`MARK_UPLOAD_SENT`), so the same action id returns
  the same answer, and returns `{actionId, document, sentAt}`. A new action id
  sends again and updates the date.
- It raises `volunteer_profiles.revision`. An admin with that volunteer's
  drawer open then gets the existing `CONFLICT` ("someone else changed this
  volunteer") instead of a save that silently clears a sent date they never
  saw.

**C2. Mark reviewed's shape** **(my call)**, following `vitally_save_volunteer`:
`vitally_mark_upload_reviewed(p_action_id uuid, p_volunteer_id uuid,
p_expected_revision bigint, p_document text)`.
- It runs under `is_workspace_admin`, cleared or not, like Save. Anyone else
  is refused `FORBIDDEN` before any other check, with no receipt.
- Refusals: `VALIDATION` for a malformed call, `NOT_FOUND` for an unknown
  volunteer, `CONFLICT` when `p_expected_revision` is stale. The receipt's
  operation is `MARK_UPLOAD_REVIEWED`.
- It clears that document's sent date on the current-season entry, raises
  `volunteer_profiles.revision`, and returns `{actionId, personId, revision}`.
- When nothing is waiting for that document, it succeeds and changes nothing
  (no revision bump). That way, two admins pressing it are never both told it
  failed.

**C3. "Any change" in Q2** **(my call, interpretation)**: `vitally_save_volunteer`
clears `form_13615_sent_at` when the save changes the current-season roles or
the confirmed certificate set. That includes an `uploaded` row becoming
`confirmed`. A save that only edits name, phone, works, languages or New does
not clear it. It clears `photo_id_sent_at` when the save takes
`photo_id_checked_at` from null to set, or `is_new` from true to false (C4). Payload keys are unchanged, so
existing callers need nothing new.

**C4. Unticking New** **(user, at plan review; replaces my earlier call)**: a
save that takes `is_new` from true to false also clears `photo_id_sent_at`. A
volunteer who isn't new needs no photo ID, so nothing should wait for review.

**C5. The setup screen's states** **(my call)**:
- Before sending, the item shows its line, Upload (a link,
  `target="_blank" rel="noopener"`) and the I've uploaded it button.
- After sending, Upload stays, in case a corrected file is needed, and the
  button is replaced by "Waiting for review · sent <date>", so this change's
  UI offers no re-send. The RPC allows it for My profile.
- The date is a short day ("Nov 20") in the app's existing staff date format.
- Pressing the button calls the RPC, then re-reads the clearance the same way
  Check again does. A failure says so in the screen's existing notice style.

**C6. The sidebar count's source** **(my call)**: the Roster list is read only
on the Volunteers screen, and `roster_entries` is not live.
- For a workspace admin's window, a small count read
  (`roster_entries` for the current season with either date set; the admin
  policy limits it) runs with the data load, on the same wake events and focus
  re-reads the clearance already uses, and after the admin's own Save or Mark
  reviewed.
- No table is added to the realtime publication.
- The count is of people, not documents. It is hidden at 0 ("Volunteers").
- The screen-reader label is singular at 1 ("Volunteers, 1 upload to review")
  and plural otherwise (user, at plan review).

**C7. The Roster row and the drawer** **(my call)**:
- The row's status shows "Form 13615 to review" and/or "Photo ID to review"
  next to the existing missing text. This also works for a cleared volunteer
  later (My profile).
- The Show filter's "Uploads to review" keeps rows with either date set.
- In the drawer, each sent line sits above the certificates or the Photo ID
  tick it relates to, with a secondary "Mark reviewed" button.
- After Mark reviewed, the drawer takes the returned revision and keeps the
  admin's unsaved edits, because Mark reviewed touched nothing the Save
  sends. The Roster list and the count re-read.

**C8. Tests** **(my call, within the agreed acceptance)**:
- The database tests go in a new `tests/database-clearance-uploads.mjs`. They
  cover the acceptance list, plus Q8's `uploadUrl` (null with no link, null
  with no entry), the C1 revision bump causing an admin `CONFLICT`, and the
  converted #193 test in `tests/database-clearance.mjs`.
- The browser test is a separate top-level `test(...)` in `tests/browser.mjs`
  beside "A site coordinator changes Season settings", not inside the story:
  1. An uncleared, not-new volunteer sees Upload, then presses I've uploaded
     it.
  2. The admin's sidebar shows "Volunteers · 1", Show → Uploads to review
     lists them, and the admin ticks certificates and a role and saves.
  3. The volunteer's setup screen clears to the work board.
  4. A new volunteer sends the photo ID, the admin presses Mark reviewed, and
     the row leaves the filter.
- Unit tests cover the views (setup items, toolbar, row text, drawer lines)
  and `filterVolunteers` with `show`.

## Acceptance (agreed)

- Database tests:
  - a volunteer marks only their own documents;
  - the photo ID is refused when the entry is not new or is already checked;
  - a call is refused with no current-season entry;
  - saving certificates or roles clears `form_13615_sent_at`;
  - ticking Photo ID checked clears `photo_id_sent_at`;
  - unticking New volunteer clears `photo_id_sent_at`;
  - Mark reviewed clears either date and is refused for non-admins;
  - `sentAt` appears in `vitally_my_clearance()`;
  - volunteers can't read other people's sent dates.

  Plus Q8 and Q9 above.
- A separate browser test, as in C8. The story is at about 590 s of its 900 s
  budget and is not touched.
- Checks: `npm test`; `npm run db:migrate:test` and `npm run test:database`;
  `npm run test:browser`, or the PR's CI; `npx openspec validate --all`. This
  machine has about 1 GB free, so there are no full local browser runs, and
  stacks are stopped when done.

## Dependencies

- Migration 052 and `season_settings`: **ready** (merged as fdd64a2, deployed
  to hosted).
- The OneDrive upload link: **ready** (already set on hosted). The app only
  opens it, so it is mockable locally with any `https://` value.
- My profile (#242): **downstream**. It reuses this change's field, RPC and
  `uploadUrl`; nothing here waits on it.
- Hosted: after merge, the same day, run 053 with
  `node --env-file=.env.admin tools/admin/migrate.mjs --target classroom`
  (with `NODE_EXTRA_CA_CERTS`). This goes in the PR body.

## Capabilities touched

- `volunteer-clearance`: the clearance answer (`sentAt`, `uploadUrl`, empty
  capabilities when uncleared), the setup screen, and the volunteer RPC.
- `volunteer-roster`: the to-review row text, the Show filter, the drawer's
  sent lines and Mark reviewed, the save clearing rules, and the sidebar
  count.
- `season-settings`: the one modified sentence about where the links are
  shown.
