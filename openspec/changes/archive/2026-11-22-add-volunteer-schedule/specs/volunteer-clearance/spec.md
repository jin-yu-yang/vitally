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
- `uploadUrl`: the workspace's certificate and photo ID upload link (capability `season-settings`) when they have a roster entry for the current season, the link is set, and `siteCheck` is false; null otherwise;
- `scheduleViewer`: whether they are a schedule viewer (capability `volunteer-schedule`), whether or not they are cleared.

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

#### Scenario: A schedule viewer
- **WHEN** a staff member with an active account and a current-season roster entry but no roles calls it
- **THEN** `scheduleViewer` is true, and they are not cleared

#### Scenario: Not a schedule viewer
- **WHEN** a staff member with an active account, no current-season roster entry and no site coordinator mark calls it
- **THEN** `scheduleViewer` is false

#### Scenario: A client
- **WHEN** a client calls it
- **THEN** it is refused with `FORBIDDEN`

### Requirement: An uncleared staff member sees the setup screen
After sign-in, a `staff` member who is not cleared SHALL see only the setup screen, titled "Finish your setup for this season", and the Notifications panel. The setup screen SHALL list:
- upload your signed Form 13615, when they have no roles;
- photo ID, when they are new and unchecked;
- "Site coordinators need the SC certificate.", when they are a site coordinator on this season's roster without it;
- "Ask <name>, your site coordinator", naming the default follow-up person.

The Form 13615 and photo ID items SHALL each offer:
- **Upload**, which opens the upload link from their clearance answer in a new tab; when there is no link, the text "Ask your site coordinator how to send it." in its place;
- **I've uploaded it**, which marks that document as sent and then re-checks the clearance, whether or not there is a link.

Once the item has a sent date, I've uploaded it SHALL be replaced by "Waiting for review · sent <date>", and Upload, or the text in its place, SHALL stay. A refused or failed send SHALL be said on the setup screen. The text SHALL be English only.

It SHALL have a "Check again" button. The screen SHALL re-check when Check again is pressed and when the window regains focus, and SHALL show the normal staff screens once the person is cleared. The setup screen's sidebar SHALL offer Notifications, with its unread badge, and the panel SHALL show the updates addressed to them (capability `posted-updates`). The feed and badge SHALL re-read together with the clearance check. An uncleared schedule viewer (capability `volunteer-schedule`) SHALL also have the Schedule link and the Schedule screen, read-only unless they are a workspace admin. An uncleared workspace admin SHALL also have the Volunteers link and the Roster, the Post an update link and screen, and the Season settings link and screen (capability `season-settings`), and no client data. When any action returns `NOT_CLEARED`, the window SHALL switch to the setup screen.

#### Scenario: Signing in uncleared
- **WHEN** a staff member with no roles signs in
- **THEN** they see "Finish your setup for this season", the Form 13615 item and the site coordinator's name, and no work board

#### Scenario: Upload and I've uploaded it
- **WHEN** a staff member with no roles opens the setup screen, and the certificate upload link is set
- **THEN** the Form 13615 item offers Upload, which opens that link in a new tab, and I've uploaded it

#### Scenario: Saying it was sent
- **WHEN** that staff member presses I've uploaded it
- **THEN** the item shows "Waiting for review · sent <today>" in place of the button, and Upload is still offered

#### Scenario: No upload link
- **WHEN** no certificate upload link is set, and a new staff member with no photo ID check opens the setup screen
- **THEN** the photo ID item says "Ask your site coordinator how to send it." instead of Upload, and I've uploaded it still marks it sent

#### Scenario: Becoming cleared
- **WHEN** an admin records a role for that staff member, and the staff member presses Check again
- **THEN** the work board opens

#### Scenario: Focus re-checks
- **WHEN** the staff member is cleared while their window is in the background, and the window regains focus
- **THEN** the work board opens without pressing anything

#### Scenario: An uncleared admin
- **WHEN** a site coordinator with no roles signs in
- **THEN** they see the setup screen, the Volunteers, Schedule, Post an update and Season settings links, can open the Roster, the Schedule with its editing controls, Post an update and Season settings, and see no case

#### Scenario: An uncleared volunteer on the roster
- **WHEN** a staff member with a current-season roster entry and no roles signs in
- **THEN** the setup screen's sidebar shows Schedule, and the Schedule opens read-only

#### Scenario: A site coordinator waiting for SC
- **WHEN** a site coordinator with the Admin role and its certificates, and no SC, signs in
- **THEN** the setup screen lists "Site coordinators need the SC certificate."

#### Scenario: Clearance lost mid-session
- **WHEN** a staff member's roles are removed while their window is open, and they press an action
- **THEN** the window shows the setup screen

#### Scenario: An uncleared volunteer reads an update
- **WHEN** a staff member with a current-season roster entry and no roles signs in, and an update to All volunteers is posted
- **THEN** the setup screen's sidebar shows Notifications with a badge of 1, and the panel shows the update and no case data
