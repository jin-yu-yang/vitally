## Context

- **053 (`add-clearance-uploads`) added:**
  - the per-season sent dates `roster_entries.form_13615_sent_at` and `photo_id_sent_at`;
  - the caller-only `vitally_mark_upload_sent`;
  - the admin's `vitally_mark_upload_reviewed`;
  - `uploadUrl` on `vitally_my_clearance()`.
  It said a cleared volunteer could later re-send a 13615 from My profile with no change to that design.
- **What the clearance answer leaves out:**
  - `vitally_my_clearance()` carries the 13615 item only while the entry has no roles, so a cleared volunteer's re-send is invisible to it.
  - It carries no profile data, as the volunteer-clearance spec requires.
  - It is re-read on every wake event and refusal, and it drives the clearance gate.
- **The admin save `vitally_save_volunteer`:**
  - It validates name, phone, works, languages and other language against a fixed ten-key payload.
  - It shares `volunteer_profiles.revision` (with `CONFLICT` on a stale revision) with 053's RPCs.
  - It clears the sent dates when it acts on a document (053 D4).
- **Data the Roster already reads:** the Roster reads `roster_entries` and `volunteer_profiles` directly under admin-only policies, so new columns there reach admins only.
- **The sidebar** has one nav list and a bottom account block (account row, Need help?, Sign out).
- **Staff screens** are English only.
- **Constraints:**
  - migration 057, after 056 (#245);
  - no local Docker: database tests run through `database-quick.yml` while iterating, and the PR's full CI run verifies;
  - the browser test is a new block in `tests/browser.mjs`, run by the story job.

## Goals / Non-Goals

**Goals:**
- A cleared staff member can see this season's roles and certificates, edit their own name, phone, works, languages and usual days, and send a new Form 13615.
- A volunteer whose document came back is told why.
- The upload link never reaches an account that is still on the site check.

**Non-Goals:**
- Shifts (#140).
- The volunteer summary, phone sharing and gender (Before the pilot).
- My profile for uncleared staff.
- Notifying the volunteer outside the app.
- Showing the last reason to admins.
- A Roster column for usual days.
- Any change to how a document is uploaded.

## Decisions

### D1: A separate caller-only read, `vitally_my_profile()`
- **Choice:** a new RPC answering for the signed-in `staff` caller with:
  - `personId`, `name`, `email`, `phone`, `works`, `languages`, `otherLanguage` and `usualDays`;
  - `revision`;
  - `accountStatus` (the caller's `accounts.status`);
  - `roles` and `certificates`: this season's roles, and the confirmed certificates from `confirmed_certificates`;
  - `form13615`: `{sentAt, reviewedAt, reviewReason}` from this season's entry, or null with no entry;
  - `uploadUrl`, under the clearance answer's rule (D4);
  - `siteCoordinatorName`.
  It is refused with `FORBIDDEN` for a client, an anonymous caller, or a staff caller with no person or profile row. It is not gated by clearance; only the screen is.
- **Rationale:** the clearance answer stays lean and keeps its job. My profile needs the revision for its save.
- **Alternative considered:** adding these fields to `vitally_my_clearance()`. That would make every wake-event re-read heavier, and the clearance spec says that answer carries no profile data.

### D2: A caller-only save, `vitally_save_my_profile(p_action_id, p_expected_revision, p_profile)`
- **Choice:**
  - **Payload:** exactly `name`, `phone`, `works`, `languages`, `otherLanguage` and `usualDays`.
  - **Validation:** the admin save's rules for the shared fields, plus the usual-days rule (D5). Anything else is refused with `VALIDATION`.
  - **What it writes:** `people.name` and the caller's own `volunteer_profiles` row. It never writes email, roles, certificates, the roster entry or another person.
  - **Concurrency:** it locks the profile row and compares `revision`, refusing with `CONFLICT` and raising the revision by one.
  - **Receipt:** reserved through `reserve_receipt` with operation `SAVE_MY_PROFILE` and a digest of the call. A repeated action id returns the stored `{actionId, personId, revision}`.
  - **Refusals:** a client, an anonymous caller, or a staff caller with no person or profile row is refused with `FORBIDDEN` before anything is written. A refusal stores no receipt.
- **Rationale:** the revision is shared with the admin's save and 053's RPCs. An admin's drawer opened before the volunteer saved is refused, and the volunteer's stale screen is refused after an admin save.
- **Alternative considered:** letting the volunteer call `vitally_save_volunteer` on themselves. It is admin-gated, and it carries roles and email.

### D3: The reviewed time and reason live on this season's roster entry
- **Choice:**
  - **New columns:** `form_13615_reviewed_at timestamptz`, `form_13615_review_reason text`, `photo_id_reviewed_at timestamptz` and `photo_id_review_reason text`. A check keeps each time and reason both set or both null, and the reason 1 to 120 characters.
  - **Mark reviewed** sets the pair when it clears a waiting sent date. When nothing is waiting, it writes nothing, as today.
  - **`vitally_mark_upload_sent`** clears the pair for the document it sends.
  - **`vitally_save_volunteer`** clears the 13615 pair whenever it would clear `form_13615_sent_at` (`v_clear_13615`). It clears the photo ID pair whenever it would clear `photo_id_sent_at`. These hold whether or not a sent date was set at the time.
- **Rationale:**
  - It is per season, so it resets with Start next season (a new entry).
  - It sits next to the sent date it explains.
  - Admins already read the table, so no new policy is needed.
- **Alternative considered:** a history table of reviews. That is more than one line for the volunteer needs.

### D4: The clearance answer changes in two places only
- **Choice:**
  - The `form13615` and `photoId` items in `missing` gain `reviewedAt` and `reviewReason`.
  - `uploadUrl` is null while `siteCheck` is true (an `invited` account), and otherwise follows 053's rule.
  - Every other key stays as it is.
- **Rationale:** #246's two items, nothing more.

### D5: Usual days on `volunteer_profiles`
- **Choice:**
  - **Column:** `usual_days text[] not null default '{}'`. Values come from `mon`, `tue`, `wed`, `thu`, `fri`, `sat` and `sun`, with no repeats.
  - **Storage:** the RPCs store them in week order, whatever order they were sent in.
  - **Admin save:** `vitally_save_volunteer` accepts the ten keys it accepts today, or those ten plus `usualDays`. Without `usualDays` the stored days stay.
  - **Who sees them:** the Roster drawer shows and edits them. The volunteer reads them through D1. No one else reads them.
- **Rationale:** the volunteer and admins only, as agreed. A save changes only what it sends. Week order makes a later Schedule hint (#140) simple.
- **Alternative considered:** a per-season field. The hint is about habit, and the profile is not seasonal.

### D6: Mark reviewed requires a reason (new signature)
- **Choice:**
  - **Signature:** `vitally_mark_upload_reviewed(p_action_id, p_volunteer_id, p_expected_revision, p_document, p_reason)`.
  - **The reason** is trimmed, and must be 1 to 120 characters, or it is refused with `VALIDATION`. That check comes after the admin check and with the other argument checks, before the receipt.
  - **The digest** includes the reason.
  - **The old four-argument function is dropped**, and grants follow 053's pattern.
- **Rationale:** a function left behind would still mark reviewed silently. The admin check stays first, as the 053 spec requires.
- **Alternative considered:** an optional reason. That leaves the silent reset in place.

### D7: The reason row in the Roster drawer
- **Choice:** Mark reviewed beside "Form 13615 sent <date>" or "Photo ID sent <date>" opens a reason row inside the drawer. The row has:
  - the quick picks as radio buttons;
  - a note field (maxlength 120);
  - Send back and Cancel. Send back stays disabled until a pick or a note is given.
  **The quick picks:**
  - **For a 13615:** "Not signed", "Can't read it", "Wrong form" and "Missing a certification". "Already on file" is added when the volunteer has a role this season.
  - **For a photo ID:** "Not signed", "Can't read it" and "Wrong form". Only the two 13615-only picks are left out, as agreed.
  **What is sent:** a note replaces the pick's text. The reason sent is the pick's text or the note, as typed.
  **After it lands:** the admin's unsaved drawer edits survive, as 053 D7 requires.
- **Rationale:** a dialog inside the drawer dialog would trap focus twice. "Already on file" only makes sense for a re-send; someone with no roles needs roles recorded.
- **Alternative considered:** a separate dialog. Rejected as above.

### D8: What the volunteer sees on a returned document
- **Choice:** when an item has no sent date and has a review reason, its line is followed by one of:
  - **"Already on file" (exact match):** "Your site coordinator says this is already on file. You don't need to send it again."
  - **Any other reason:** "Your site coordinator looked at this: <reason>. Please send it again or ask them."
  Upload and I've uploaded it are offered as before. The line appears on the setup screen and in My profile's 13615 section. With a sent date, "Waiting for review · sent <date>" shows and no reason.
- **Rationale:** an exact match is enough, because the quick pick's text is what gets stored.

### D9: My profile screen and how it is reached
- **Choice:**
  - **Entry point:** for cleared staff, the sidebar's account row becomes a link button, "My profile", that opens the screen `my-profile`. While uncleared, the row stays plain text.
  - **Sections:**
    1. Your details: the editable name, phone, works, languages and usual days, with a locked email and the read-only account status. Save.
    2. This season: roles and certificates, read-only, with "Managed by the office" and "Ask <site coordinator>".
    3. "Passed a higher certification? Send your new Form 13615", with Upload (or "Ask your site coordinator how to send it.") and I've uploaded it, or "Waiting for review · sent <date>", plus the D8 line.
  - **Reads:** the screen reads `vitally_my_profile()` when it opens, after a save, and after a send. A `CONFLICT` re-reads and says someone else changed the details. A refusal keeps the typed values.
  - **After a save:** the window re-reads the clearance and the name it shows for the signed-in person.
  - **When the window loses clearance:** it goes to the setup screen as it does today.
- **Rationale:** it reuses 053's send flow and the controller's save pattern (pending request kept for an unknown outcome, same action id on retry).

### D10: The browser test lives in the story file
- **Choice:** a new `test(...)` block in `tests/browser.mjs` with its own workspace: "A volunteer edits My profile and re-sends a Form 13615". It covers:
  - editing details, including usual days;
  - sending a 13615;
  - an admin sending it back with a reason, in the drawer;
  - the reason on My profile;
  - sending again, which clears the reason.
  The uploads test, "A volunteer says their uploads were sent, and an admin reviews them", is extended so its Mark reviewed gives a reason, and the setup screen shows the line.
- **Rationale:** it follows the existing screen tests, and needs no new CI job.

## Risks / Trade-offs

- **[Risk] Dropping the four-argument Mark reviewed breaks admin tabs open across the deploy.**
  - Mitigation: the refusal is said in the drawer, and a reload fixes it. Deploy on a quiet day; note it in the PR.
- **[Risk] The story job gets longer.** The new block runs outside the story's own 20-minute limit, as the other screen tests do, but it still adds time to the job.
  - Mitigation: report the block's timing marks from the CI run in `verify.md`. If the job slows too much, stop and show the timings; never trim tests to fit.
- **[Risk] Two writers on one revision.** A volunteer saving My profile while an admin's drawer is open makes the admin's save fail with `CONFLICT`.
  - Mitigation: the existing conflict message and re-read. This is the same trade 053 made for Mark sent.
- **[Trade-off] An exact text match for "Already on file".**
  - Accepted: the quick pick's text is what is stored, and a note that says the same words gets the same line, which is fine.
- **[Trade-off] The volunteer can change their own name.**
  - Accepted, as agreed. Admins already can, and the name is not the sign-in.
- **[Risk] 056 lands with a migration that touches the same functions.**
  - Mitigation: #245 touches client documents, not these RPCs. Merge `main` before archive; if 056 replaced any function here, rebase this migration's copy onto it.

## Migration Plan

1. Migration `057_my_profile.sql`, hand-written:
   - §1 the columns and checks;
   - §2 `vitally_my_clearance`;
   - §3 `vitally_mark_upload_sent`;
   - §4 `vitally_save_volunteer`;
   - §5 drop the four-argument `vitally_mark_upload_reviewed`, and create the five-argument one;
   - §6 `vitally_my_profile`;
   - §7 `vitally_save_my_profile`.
   Each function is copied from its latest version, with this change's lines marked `-- 057`.
2. Existing rows get the defaults: no review reasons and no usual days. No backfill is needed.
3. Order: 056 merges and runs on hosted first. Then this PR merges, and hosted runs 057 the same day.
4. Rollback: a new migration that restores 053's functions and drops the new columns and RPCs. Applied migrations are never edited.

## Open Questions

None. The decisions are settled in `brainstorm.md`. The only external unknown is when 056 merges; it decides when this merges, not what it does.
