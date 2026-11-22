## MODIFIED Requirements

### Requirement: A staff member can read their own clearance
`vitally_my_clearance()` SHALL take no arguments and SHALL answer only for the signed-in `staff` caller with:
- whether they are cleared;
- what is missing:
  - no roles (their Form 13615), with `sentAt`: when they marked it sent, or null; and `reviewedAt` and `reviewReason`: when an admin last sent it back and why, or null;
  - the photo ID check if they are new and unchecked, with `sentAt`, `reviewedAt` and `reviewReason` likewise;
  - the certificates any role lacks;
  - the SC certificate if they are a site coordinator on this season's roster without it;
- their effective capabilities, which SHALL be empty whenever they are not cleared;
- whether they are a workspace admin (`isAdmin`: a site coordinator, or holding the Admin role this season);
- whether they are a site coordinator (`isSiteCoordinator`);
- the display name of the workspace's default follow-up person;
- whether they still owe the first-sign-in site check (`siteCheck`: their account is `invited`);
- `uploadUrl`: the workspace's certificate and photo ID upload link (capability `season-settings`) when they have a roster entry for the current season, the link is set, and `siteCheck` is false; null otherwise.

It SHALL return no email, phone or other profile data. A client or an anonymous caller SHALL be refused with `FORBIDDEN`. Execute SHALL be granted to `authenticated` only.

#### Scenario: Not cleared
- **WHEN** a staff member with no roles calls it
- **THEN** it says they are not cleared, that their Form 13615 is missing with no sent date and no review, that their effective capabilities are empty, that they are not an admin, and names the default follow-up person

#### Scenario: Cleared
- **WHEN** a cleared Preparer calls it
- **THEN** it says they are cleared, with nothing missing, effective capabilities `prepare`, and not an admin or site coordinator

#### Scenario: Roles but not cleared
- **WHEN** a staff member with the Preparer role and its certificates, marked new with no photo ID check, calls it
- **THEN** it says they are not cleared, that the photo ID check is missing, and that their effective capabilities are empty; once the check is recorded it says `prepare`

#### Scenario: A sent Form 13615
- **WHEN** a staff member with no roles has marked their Form 13615 as sent, and calls it
- **THEN** the Form 13615 item carries that sent date

#### Scenario: A document sent back
- **WHEN** a new staff member has sent their photo ID, and an admin marks it reviewed with the reason "Can't read it"
- **THEN** the photo ID item has no sent date, the reviewed time of that call, and the reason "Can't read it"

#### Scenario: The upload link
- **WHEN** a staff member with a current-season entry and an active account calls it, and a site coordinator has set the certificate upload link
- **THEN** `uploadUrl` is that link, whether or not they are cleared

#### Scenario: No link before the site check
- **WHEN** an invited staff member with a current-season entry, who has not passed the first-sign-in site check, calls it while the link is set
- **THEN** `siteCheck` is true and `uploadUrl` is null; after they pass the site check, `uploadUrl` is the link

#### Scenario: No link, or no entry
- **WHEN** the link is not set, or the caller has no current-season roster entry
- **THEN** `uploadUrl` is null

#### Scenario: A site coordinator missing SC
- **WHEN** a site coordinator with the Admin role and VSC and IT&QR, and no SC, calls it
- **THEN** it says they are not cleared, that the SC certificate is missing, that they are an admin and a site coordinator

#### Scenario: A site coordinator with no roles
- **WHEN** a site coordinator with no current-season roles calls it
- **THEN** it says they are an admin and a site coordinator, with empty effective capabilities

#### Scenario: A client
- **WHEN** a client calls it
- **THEN** it is refused with `FORBIDDEN`

### Requirement: Marking a document sent can be repeated and raises the revision
A repeated `vitally_mark_upload_sent` request with the same action id SHALL return the stored result and write nothing more. A new action id SHALL set the date again. Each recorded send SHALL clear that document's reviewed time and review reason, and SHALL raise the revision of the caller's volunteer record, so that an admin's save based on the earlier revision is refused with `CONFLICT`.

#### Scenario: Sending again
- **WHEN** a staff member who sent their Form 13615 marks it as sent again the next day, with a new action id
- **THEN** the sent date is the new time

#### Scenario: Sending again after it came back
- **WHEN** an admin marked a staff member's Form 13615 reviewed with the reason "Not signed", and the staff member marks it as sent again
- **THEN** the sent date is now, and the reviewed time and the reason are cleared

#### Scenario: A repeated request
- **WHEN** the same call is sent twice with the same action id
- **THEN** both answers are the same, and the date was written once

#### Scenario: An admin's stale save
- **WHEN** an admin opens a volunteer's Edit drawer, the volunteer then marks their Form 13615 as sent, and the admin saves
- **THEN** the save is refused with `CONFLICT`, and the sent date stays

## ADDED Requirements

### Requirement: The setup screen says why a document came back
When the Form 13615 or photo ID item on the setup screen has no sent date and has a review reason, the item SHALL show a line under it:
- "Your site coordinator says this is already on file. You don't need to send it again." when the reason is exactly "Already on file";
- otherwise, "Your site coordinator looked at this: <reason>. Please send it again or ask them."

Upload, or the text in its place, and I've uploaded it SHALL be offered as before. Once the item has a sent date again, the line SHALL go and "Waiting for review · sent <date>" SHALL show. The text SHALL be English only, and the reason SHALL be shown as stored, escaped.

#### Scenario: A photo ID came back
- **WHEN** a new staff member sent their photo ID, an admin marked it reviewed with the reason "Can't read it", and the staff member's setup screen re-checks
- **THEN** the photo ID item shows "Your site coordinator looked at this: Can't read it. Please send it again or ask them.", with Upload and I've uploaded it

#### Scenario: Sending again hides the reason
- **WHEN** that staff member presses I've uploaded it
- **THEN** the reason line goes, and the item shows "Waiting for review · sent <today>"

#### Scenario: A note
- **WHEN** the admin's reason was the note "Please upload page 2 as well"
- **THEN** the line reads "Your site coordinator looked at this: Please upload page 2 as well. Please send it again or ask them."
