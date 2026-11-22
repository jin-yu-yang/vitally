# Brainstorm: add-my-profile

Part of #138. Does #242 (My profile) and #246 (why an upload came back;
`uploadUrl` only after the site check). Migration 057.

The design was agreed with the user on Nov 21, in the explore conversation
before propose. All five promotion criteria held when propose started. This
file records those decisions, the defaults the user confirmed, and the calls
made while reading the code, each marked **(my call)**. Settled items are not
to be reopened.

## Background

- **No page of their own.** A staff member can't see which roles and
  certificates the office recorded for them this season. Someone who passes a
  higher certification mid-season can't tell the office they sent a new
  Form 13615. PCDC does this in Slack today (#242).
- **053 (`add-clearance-uploads`) added:**
  - `roster_entries.form_13615_sent_at` and `photo_id_sent_at`;
  - `vitally_mark_upload_sent` (caller-only; the 13615 is not refused for a
    cleared caller);
  - `vitally_mark_upload_reviewed` (admin; clears the sent date, raises the
    revision);
  - `uploadUrl` on `vitally_my_clearance()`.
  Its design said My profile would reuse the field, the RPC, `uploadUrl` and
  the admin review unchanged.
- **What `vitally_my_clearance()` answers today:**
  - The `form13615` item is in `missing` only while the entry has no roles
    (053 §2). A cleared volunteer's re-sent 13615 is not in the answer at all.
  - It returns no roles, certificates, profile fields or revision. The
    volunteer-clearance spec says it "SHALL return no email, phone or other
    profile data".
  - It is re-read on every wake event and refusal, and drives the clearance
    gate.
- **When Mark reviewed is pressed on a document that is still missing,** the
  setup screen goes from "Waiting for review" back to "I've uploaded it" with
  no reason given. People think the app lost the file and press again (#246,
  from Zeye's review of #243).
- **`uploadUrl` is returned to an invited account still on the first-sign-in
  site check** (`siteCheck` true). The screen hides it, but the answer
  carries it (#246).
- **The sidebar** (`src/views.mjs` `sidebar`) has one flat nav list and a
  bottom account block: account row, Need help?, Sign out. There is no "You"
  section, whatever #242's wording says.
- **The admin save `vitally_save_volunteer`:**
  - It requires exactly ten payload keys and validates name, phone, works,
    languages and other language.
  - It uses `volunteer_profiles.revision`, with `CONFLICT` on a stale
    revision.
  - It clears `form_13615_sent_at` when the roles or confirmed certificates
    change (`v_clear_13615`), and `photo_id_sent_at` when Photo ID checked is
    ticked or New is unticked.
- **The Roster reads the tables directly** (`listVolunteers` in
  `src/supabase-store.mjs`, admin-only policies from 044). A new column on
  `roster_entries` or `volunteer_profiles` reaches admins and no one else.
- **Browser tests:** the separate screen tests live in `tests/browser.mjs` as
  their own `test(...)` blocks, each with its own workspace, run by the
  existing story job:
  - "An admin adds, finds and edits a volunteer on the Roster";
  - "A site coordinator changes Season settings";
  - "A site coordinator starts the next season";
  - "A volunteer says their uploads were sent, and an admin reviews them".

## Scope

**In:**
- My profile for cleared staff (admins included), opened from the sidebar's
  account row.
- The volunteer's own edits: name, phone, works, languages (with other
  language), and usual days (new).
- This season's roles and certificates, read-only.
- Email locked and account status read-only.
- "Passed a higher certification? Send your new Form 13615", reusing 053.
- Usual days on `volunteer_profiles`, editable by the volunteer on My profile
  and by admins in the Roster drawer.
- Mark reviewed requires a reason (quick picks or a short note). The
  volunteer sees it on the setup screen and, for a re-sent 13615, on My
  profile.
- `vitally_my_clearance()` returns `uploadUrl` null while `siteCheck` is true.

**Out:**
- This week's shifts (#140).
- The volunteer summary and "Ask <name> about" topics (Before the pilot).
- Phone sharing and gender (Before the pilot).
- My profile for uncleared people.
- Notifications about a sent-back document.
- A Roster column for usual days.

## Decisions (agreed)

**Q1. One change or two?** One change for #242 and #246. Both touch
the clearance answer and the 13615 flow.

**Q2. What the volunteer edits on My profile.** Name, phone, works,
languages and usual days (new, for #140's hint). Phone sharing and gender
move to Before the pilot.

**Q3. Mark reviewed requires a reason.**
- **Quick picks:** "Not signed", "Can't read it", "Wrong form", "Missing a
  certification" and "Already on file".
- **Or a short note** of up to 120 characters.
- **Where the volunteer sees it:** on the setup screen, and on My profile for
  a re-sent 13615.
- **When it goes:** when they send again.

**Q4. "Already on file" (fifth quick pick, added after the code check).**
It is for a re-sent 13615 that adds nothing. The volunteer sees that it is
already recorded and doesn't need sending again, not "Wrong form".

**Q5. Which quick picks go with which document.** "Already on file" and
"Missing a certification" are offered for the 13615 only. A photo ID that is
already on file gets Photo ID checked ticked instead.

**Q6. How the reason is stored.** As plain text. The screen shows the
"Already on file" line when the stored reason is exactly "Already on file".
Staff screens are English only, so nothing needs translating.

**Q7. `uploadUrl` and the site check.** `vitally_my_clearance()`
returns `uploadUrl` null while `siteCheck` is true.

**Q8. Who gets My profile.**
- **Cleared staff, admins included.** It opens from the sidebar's account
  row, which becomes the My profile link. There is no new "You" section.
- **No My profile for anyone uncleared, admins included.** They keep the
  setup screen, which already handles the 13615 and photo ID. An uncleared
  admin can edit their own row on the Roster.

**Q9. What My profile shows that the volunteer can't change.**
- Roles and certificates, read-only, marked "Managed by the office" with
  the site coordinator's name.
- Email locked; account status read-only.

**Q10. Sending a new 13615 from My profile.** "Send your new Form 13615"
reuses 053's field (`form_13615_sent_at`), its RPC
(`vitally_mark_upload_sent`), `uploadUrl` and the admin review, unchanged.

**Q11. A separate read for My profile.** It is a new
`vitally_my_profile()`, not a bigger `vitally_my_clearance()`.
- `vitally_my_clearance()` stays lean. #246 changes only its two items there:
  the reason on the missing document items, and `uploadUrl` null under the
  site check.
- **Why:** the clearance answer is re-read on every wake and refusal, and
  drives the gate. My profile needs the revision, the profile fields and the
  13615 state, which the clearance answer leaves out.

**Q12. Usual days (default confirmed).**
- A multi-select of the seven weekdays, on `volunteer_profiles`.
- Visible to the volunteer and admins only.
- Admins can also edit them in the Roster drawer.
- In the admin save, the `usualDays` key is optional: a save without it
  leaves the stored days as they are, so a save changes only what it sends.

**Q13. The volunteer's save (default confirmed).**
- A caller-only save RPC with the revision and receipt pattern.
- It shares `volunteer_profiles.revision` with the admin's save, so either
  side's stale save is refused with `CONFLICT`.
- It validates the same way as the admin's save.
- It never touches email, roles or certificates.
- It is not gated by clearance. Only the screen is limited to cleared staff.

**Q14. The reviewed time and reason (default confirmed).**
- A reviewed time and a reason per document, on this season's roster entry.
  A new season means a new entry, so they reset with it.
- They are cleared, with no reason needed, when:
  - the volunteer sends that document again;
  - an admin's save meets the same conditions 053 uses to clear the sent
    date: the roles or confirmed certificates change (13615), or Photo ID
    checked is ticked or New is unticked (photo ID).
- Mark reviewed refuses a missing reason, or one longer than 120 characters,
  with `VALIDATION`, before anything else is checked, even when nothing is
  waiting. When nothing is waiting it still writes nothing.

**Q15. Migration number.** 057; 056 is taken by #245 (OneDrive client
documents). If 056 hasn't merged when this change is ready, wait for it
rather than merging first, so hosted never runs 057 before 056.

**Q16. Verification.**
- **No local Docker:** iterate with `database-quick.yml`, and verify with the
  PR's full CI run.
- **Browser test:** a new test block in `tests/browser.mjs`, "A volunteer
  edits My profile and re-sends a Form 13615", with its own workspace, run by
  the existing story job. The reason line goes into the uploads test or the
  new one.
- **No new CI job.** Only `checks` stays required on `main`.

## Approaches considered

**Where My profile gets its data**
- **Grow `vitally_my_clearance()` (rejected).** One read for everything, but
  it would add profile data to an answer the spec says carries none, and make
  every wake-event re-read heavier.
- **A separate `vitally_my_profile()` read (chosen).** One more RPC with its
  grants and tests, but the clearance answer keeps its job.

**Where the link goes in the sidebar**
- **A new "You" section (rejected).**
- **Turn the account row into the link (chosen).** Nothing new in the
  sidebar.

**The browser test**
- **A new CI job (rejected).** It would start one more stack per run.
- **A new test block in `tests/browser.mjs` (chosen).** It follows the
  existing screen tests.

## Calls made while reading the code

- **(my call) Mark reviewed's signature.** `vitally_mark_upload_reviewed`
  gains `p_reason text` as its fifth argument. The four-argument function is
  dropped, so nothing can still mark reviewed without a reason. An open
  admin tab from before the deploy gets a refusal until it reloads.
- **(my call) The reason in the drawer.** Mark reviewed opens a small reason
  row inside the Roster drawer, not a second dialog:
  - the quick picks for that document;
  - a short note field (120 characters);
  - "Send back" and Cancel.
  The admin's unsaved drawer edits survive it, as they already do.
  - **"Already on file"** is offered only for a 13615 when the volunteer
    already has a role this season, which is the re-send case. On the setup
    screen a person with no roles needs roles recorded, not "already on file".
  - The database does not enforce which quick picks go with which document. A
    note is free text.
- **(my call) Columns.** `roster_entries` gains `form_13615_reviewed_at`,
  `form_13615_review_reason`, `photo_id_reviewed_at` and
  `photo_id_review_reason`. Each pair is both set or both null.
  `volunteer_profiles` gains `usual_days text[]`, default `{}`, with values
  `mon`, `tue`, `wed`, `thu`, `fri`, `sat` and `sun`. They are stored in week
  order with no repeats; the RPCs normalise the order.
- **(my call) The answer's fields.** The `form13615` and `photoId` items in
  `vitally_my_clearance()` gain `reviewedAt` and `reviewReason`. Nothing else
  in that answer changes.
- **(my call) What `vitally_my_profile()` returns.** It answers for the
  signed-in staff caller with:
  - name, email, phone, works, languages, other language and usual days;
  - the revision;
  - the account status;
  - this season's roles and confirmed certificates;
  - the 13615's sent date, reviewed time and review reason;
  - `uploadUrl`, under the same rule as the clearance answer (null while
    `siteCheck`);
  - the site coordinator's name (the default follow-up person, as the
    clearance answer names it).
  It is refused with `FORBIDDEN` for a client, an anonymous caller, or a
  staff caller with no person or profile row.
- **(my call) The volunteer's save RPC.**
  `vitally_save_my_profile(p_action_id, p_expected_revision, p_profile)`.
  - The payload has exactly the keys name, phone, works, languages,
    otherLanguage and usualDays, under the admin save's rules for the shared
    fields.
  - The result is `{actionId, personId, revision}`.
- **(my call, narrowed by R5) What the volunteer sees on a sent-back document.**
  - **Any reason except a 13615's "Already on file":** "Your site coordinator looked at
    this: <reason>. Please send it again or ask them." Upload and "I've
    uploaded it" are offered again.
  - **"Already on file":** "Your site coordinator says this is already on
    file. You don't need to send it again." Upload and "I've uploaded it"
    stay offered on My profile, for a later certification.
- **(my call, replaced by R2) What the admin sees.** ~~The drawer does not
  show the last reason.~~ The Roster shows only what is waiting, as today.
- **(my call) After the volunteer saves their name,** the window re-reads
  what it shows for the signed-in person, so the account row and the board
  show the new name.
- **(my call) Docs.**
  - The developer guide's migration and RPC counts are updated.
  - The roadmap marks #242 and #246.
  - Hosted runs 057 right after the merge, after 056 (R4).

## Revisions from the user's review of 833eb6a (Nov 21)

These override anything above that disagrees.

- **R1. Photo ID quick picks.** "Can't read it", "Expired" and "Not a photo
  ID", plus the note. "Not signed" and "Wrong form" are no longer offered for
  a photo ID. The 13615 picks are unchanged.
- **R2. Admins see the last reason.** In the Edit drawer, in the document's
  place, "Last returned: <reason> · <date>" when a review reason is stored.
  It is no longer a non-goal.
- **R3. The sidebar link** reads "My profile", with the signed-in name as a
  smaller second line.
- **R4. Deploy order.** Hosted runs 057 right after the merge (and after
  056), because the front end goes live from `main` and calls the new
  functions. Not "a quiet day".
- **R5. The already-on-file line is for the Form 13615 only.** For a photo
  ID, any reason, a typed "Already on file" included, shows "Your site
  coordinator looked at this: <reason>. Please send it again or ask them."
