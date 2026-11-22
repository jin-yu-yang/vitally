# my-profile Specification

## Purpose
A cleared staff member's own page. My profile opens from the sidebar's account row and shows this season's roles and certificates read-only ("Managed by the office"), with the email locked and the account status read-only. The volunteer edits their own name, phone, works, languages and usual days, and can send a new Form 13615 after passing a higher certification, seeing why it came back if the office sends it back. It also covers the two caller-only RPCs behind it, `vitally_my_profile()` and `vitally_save_my_profile()`: they answer only for the signed-in caller, refuse an invited account before the site check, and use the volunteer record's revision and an action receipt.

## Requirements

### Requirement: A staff member reads their own profile
`vitally_my_profile()` SHALL take no arguments and SHALL answer only for the signed-in `staff` caller with:
- their person id, name, email, phone, works, languages, other language and usual days;
- their volunteer record's revision;
- their account status;
- this season's roles and confirmed certificates;
- their Form 13615 state on this season's roster entry: `sentAt`, `reviewedAt` and `reviewReason`, each null when not set, or null as a whole with no current-season entry;
- `uploadUrl`, under the same rule as the clearance answer (capability `volunteer-clearance`);
- the display name of the workspace's default follow-up person.

It SHALL NOT be gated by clearance. It SHALL return nothing about any other person. A client, an anonymous caller, a staff caller with no person row or no volunteer record, or a caller whose account is `invited` (it has not passed the first-sign-in site check) SHALL be refused with `FORBIDDEN`, before any other check. Execute SHALL be granted to `authenticated` only.

#### Scenario: A cleared Preparer
- **WHEN** a cleared Preparer with VSC, IT&QR and Basic calls it
- **THEN** it returns their own name, email, phone, works, languages, usual days and revision, the role Preparer, those three certificates, an active account status, and a Form 13615 state with no sent date

#### Scenario: A re-sent 13615 that came back
- **WHEN** a cleared Preparer sent a new Form 13615, and an admin marked it reviewed with "Already on file"
- **THEN** the Form 13615 state has no sent date, a reviewed time, and the reason "Already on file"

#### Scenario: A client
- **WHEN** a client calls it
- **THEN** it is refused with `FORBIDDEN`

#### Scenario: An invited account before the site check
- **WHEN** a staff member whose account is `invited` calls it
- **THEN** it is refused with `FORBIDDEN`

### Requirement: A staff member saves their own details
`vitally_save_my_profile(p_action_id, p_expected_revision, p_profile)` SHALL replace the signed-in `staff` caller's own name, phone, works, languages, other language and usual days. The payload SHALL have exactly the keys `name`, `phone`, `works`, `languages`, `otherLanguage` and `usualDays`, under the volunteer form's rules (capability `volunteer-roster`):
- a name of 1 to 80 characters, after trimming spaces, tabs and line breaks;
- a phone of at most 30 characters, or none;
- works of On site, Remote, or On site and remote;
- languages from English, Mandarin, Cantonese and Other, with Other named in at most 40 characters and a named language refused without Other;
- usual days from `mon` to `sun`, with no repeats, stored in week order.

It SHALL NOT change the caller's email, roles, certificates, roster entry or account, or anything of any other person. It SHALL NOT be gated by clearance.

#### Scenario: Saving details
- **WHEN** a cleared Preparer changes their phone, adds Cantonese, ticks Saturday and Monday, and saves
- **THEN** their profile has the new phone, the languages with Cantonese, and the usual days `mon` and `sat`, and their roles and certificates are unchanged

#### Scenario: Another key
- **WHEN** a call's payload includes `email` or `roles`
- **THEN** it is refused with `VALIDATION`, and nothing changes

#### Scenario: A name too long
- **WHEN** a call sends an 81-character name
- **THEN** it is refused with `VALIDATION`, and nothing changes

### Requirement: Saving one's own details uses the revision and a receipt
`vitally_save_my_profile` SHALL compare `p_expected_revision` with the caller's volunteer record, refuse a mismatch with `CONFLICT`, and raise the revision by one when it saves. It SHALL refuse a client, an anonymous caller, a staff caller with no person row or volunteer record, or a caller whose account is `invited` (it has not passed the site check) with `FORBIDDEN` before any other check. It SHALL refuse a call with no action id or no revision with `VALIDATION`. A repeated action id SHALL return the stored result `{actionId, personId, revision}` and write nothing more. A refusal SHALL write nothing and store no receipt.

#### Scenario: A volunteer's stale save
- **WHEN** a volunteer opens My profile, an admin then saves an edit of them, and the volunteer saves
- **THEN** the volunteer's save is refused with `CONFLICT`, and the admin's edit stands

#### Scenario: An admin's stale save
- **WHEN** an admin opens a volunteer's Edit drawer, the volunteer then saves My profile, and the admin saves
- **THEN** the admin's save is refused with `CONFLICT`, and the volunteer's save stands

#### Scenario: A repeated request
- **WHEN** the same save is sent twice with the same action id
- **THEN** both answers are the same, and the revision rose once

#### Scenario: A client
- **WHEN** a client calls it
- **THEN** it is refused with `FORBIDDEN`, and no receipt is stored

#### Scenario: An invited account before the site check
- **WHEN** a staff member whose account is `invited` calls it
- **THEN** it is refused with `FORBIDDEN`, nothing changes, and no receipt is stored

### Requirement: A cleared staff member opens My profile from the sidebar
For a cleared `staff` window, the account row in the sidebar's bottom block SHALL be a link that opens the My profile screen. Its first line SHALL read "My profile", with the signed-in name as a smaller second line. This SHALL hold for admins as well. A window that is not cleared, admins included, SHALL keep the account row as plain text and SHALL NOT offer My profile; it keeps the setup screen. When a window loses clearance while My profile is open, it SHALL switch to the setup screen.

#### Scenario: A cleared Preparer
- **WHEN** a cleared Preparer looks at the sidebar and presses My profile
- **THEN** the link reads "My profile" with their name as a smaller second line, and the My profile screen opens, showing their details

#### Scenario: An uncleared admin
- **WHEN** a site coordinator with no roles signs in
- **THEN** the sidebar offers no My profile, and the account row is the plain "Signed in as <name>" text

### Requirement: My profile shows the office's records read-only
My profile SHALL show:
- this season's roles and confirmed certificates, read-only, under "Managed by the office";
- the email, read-only, saying it is the sign-in and only a site coordinator changes it;
- the account status, read-only.

The screen SHALL offer no way to change these. The text SHALL be English only.

#### Scenario: Roles and certificates
- **WHEN** a cleared Reviewer opens My profile
- **THEN** they see Reviewer and their confirmed certificates and "Managed by the office", with no line naming the site coordinator, and no control that changes them

#### Scenario: Email locked
- **WHEN** a cleared Preparer opens My profile
- **THEN** the email is shown and cannot be edited

### Requirement: My profile edits the volunteer's own details
My profile SHALL offer name, phone, works, languages (with the other language's name) and usual days (Monday to Sunday checkboxes), filled in from the profile read, and a Save button that sends them with the revision the form was drawn from: the read when the screen opened, the answer of the last landed save, or the re-read after a `CONFLICT`. A refresh on focus, or the re-read after I've uploaded it, SHALL NOT change the revision Save sends. After a save lands, the screen SHALL read the profile again, and the window SHALL show the new name wherever it shows the signed-in person. A refused save SHALL keep the typed values and say why. A `CONFLICT` SHALL say someone else changed these details and re-read them. A save whose answer never came SHALL be sent again with the same action id when Save is pressed again with the same values.

#### Scenario: Changing the name
- **WHEN** a cleared Preparer changes their name on My profile and saves
- **THEN** My profile and the sidebar's account row show the new name

#### Scenario: A conflict
- **WHEN** an admin saves an edit of a volunteer while the volunteer has My profile open, and the volunteer then saves
- **THEN** My profile says someone else changed these details, and shows the admin's values

#### Scenario: A conflict after a refresh
- **WHEN** My profile is drawn at revision 6, an admin saves an edit of the volunteer (7), the page refreshes on focus, and the volunteer then saves
- **THEN** the save is sent with revision 6 and refused with `CONFLICT`, the admin's edit stands, and My profile says someone else changed these details

### Requirement: My profile sends a new Form 13615
My profile SHALL have a section "Passed a higher certification? Send your new Form 13615" that offers:
- **Upload**, which opens `uploadUrl` in a new tab, and nothing in its place when there is no link;
- **I've uploaded it**, which marks the Form 13615 sent through `vitally_mark_upload_sent` (capability `volunteer-clearance`) and then reads the profile again.

Once the Form 13615 has a sent date, I've uploaded it SHALL be replaced by "Waiting for review · sent <date>", and Upload, when there is a link, SHALL stay. When the Form 13615 has no sent date and has a review reason, the section SHALL show the setup screen's line for it:
- "Your site coordinator says this is already on file. You don't need to send it again." for exactly "Already on file";
- otherwise, "Your site coordinator looked at this: <reason>. Please send it again or ask them."

Upload and I've uploaded it SHALL still be offered. A refused or failed send SHALL be said on the screen.

#### Scenario: Sending a new 13615
- **WHEN** a cleared Preparer opens My profile, presses Upload, and then presses I've uploaded it
- **THEN** Upload opened the upload link in a new tab, the section shows "Waiting for review · sent <today>", and the Volunteers link of an admin counts one upload to review

#### Scenario: Sent back
- **WHEN** an admin then sends it back with "Wrong form", and the Preparer opens My profile
- **THEN** the section shows "Your site coordinator looked at this: Wrong form. Please send it again or ask them." with Upload and I've uploaded it

#### Scenario: Already on file
- **WHEN** an admin sends the Preparer's new 13615 back with "Already on file"
- **THEN** the section shows "Your site coordinator says this is already on file. You don't need to send it again.", with Upload and I've uploaded it still offered

#### Scenario: Recorded by the office
- **WHEN** an admin ticks the new certificate for the Preparer and saves, and the Preparer opens My profile
- **THEN** the section shows no sent date and no reason, and the new certificate is listed under "Managed by the office"
