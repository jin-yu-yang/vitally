# volunteer-clearance Specification

## Purpose
Who may work on cases this season. A role exists only once its certificates are confirmed, and a staff member is cleared only with at least one current-season role (and, if new, a photo ID check). It covers the certificates each role needs, the effective capabilities that come from a person's roles within the `people.capabilities` ceiling, the database gate that keeps an uncleared staff member from reading case data or using the case RPCs (`NOT_CLEARED`), the caller's own clearance answer, the setup screen an uncleared staff member sees, buttons that follow effective capabilities, the rule that staff assign work only to a cleared person, and the migration that removed unsupported roles.

## Requirements

### Requirement: A role exists only once its certificates are confirmed
The database SHALL refuse, at commit, any state in which a roster entry has a role whose certificates are not confirmed for the same person and season. The certificates each role needs SHALL be:
- Greeter: VSC;
- Intaker: VSC and IT&QR;
- Admin: VSC and IT&QR;
- Preparer: VSC, IT&QR, and Basic or Advanced;
- Reviewer: VSC, IT&QR, and Basic or Advanced.

The check SHALL apply to every writer: `vitally_save_volunteer`, the seed, the roster command and direct SQL. It SHALL be deferred to commit, so one transaction MAY write certificates and roles in either order. The refusal SHALL be `VALIDATION` and SHALL name the role and the missing certificates.

#### Scenario: A role without its certificates
- **WHEN** a transaction gives a person the Preparer role for the current season with only VSC confirmed
- **THEN** the commit is refused with `VALIDATION` naming Preparer, IT&QR and Basic or Advanced, and nothing is stored

#### Scenario: Certificates and role in one transaction
- **WHEN** one transaction first writes the Intaker role and then confirms VSC and IT&QR for the same person and season
- **THEN** it commits

#### Scenario: Deleting a needed certificate directly
- **WHEN** direct SQL deletes the IT&QR certificate of a person who has the Intaker role
- **THEN** the commit is refused, and the certificate is still there

#### Scenario: An uploaded certificate does not count
- **WHEN** a person's VSC certificate has status `uploaded`, not `confirmed`, and a transaction gives them the Greeter role
- **THEN** the commit is refused

#### Scenario: Another season's certificates do not count
- **WHEN** a person has VSC confirmed for an earlier season only, and a transaction gives them Greeter for the current season
- **THEN** the commit is refused

### Requirement: A staff member is cleared only with a role and, if new, a photo ID check
A person SHALL be cleared for a workspace when:
- their roster entry for the workspace's current season has at least one role;
- either the entry is not marked new or its photo ID check is recorded;
- their account in that workspace is `active`;
- they are not a site coordinator (capability `site-coordinators`), or the SC certificate is confirmed for them this season.

A person SHALL NOT be cleared if they have no roster entry for the current season, no roles, or no account, or if their account is `invited` or `deactivated`, or if they are a site coordinator without SC confirmed this season. A cleared person's roles are in effect, because a role exists only once its certificates are confirmed. Clearance SHALL NOT decide who reaches the Roster or Season settings (capability `volunteer-roster`).

#### Scenario: Roles and an old hand
- **WHEN** a staff member with an active account has a current-season entry with Preparer, is not marked new, and has their certificates confirmed
- **THEN** they are cleared

#### Scenario: No roles
- **WHEN** a staff member's current-season entry has no roles
- **THEN** they are not cleared

#### Scenario: New without photo ID
- **WHEN** a staff member with an active account has an entry with Greeter that is marked new with no photo ID check
- **THEN** they are not cleared, and once the photo ID check is recorded they are

#### Scenario: Last season only
- **WHEN** a staff member has roles only on an earlier season's entry
- **THEN** they are not cleared

#### Scenario: No account
- **WHEN** a volunteer with no sign-in has Preparer with its certificates and is not marked new
- **THEN** they are not cleared

#### Scenario: Invited but not through the site check
- **WHEN** a volunteer with Preparer and its certificates has an `invited` account, signs in for the first time, and then passes the site check
- **THEN** they are not cleared before the site check, including after the sign-in, and are cleared after it

#### Scenario: Deactivated
- **WHEN** a cleared staff member's account is deactivated
- **THEN** they are not cleared, and work cannot be assigned to them

#### Scenario: A site coordinator without SC
- **WHEN** a site coordinator with an active account has the Admin role with VSC and IT&QR confirmed, is not marked new, and has no SC confirmed
- **THEN** they are not cleared, and they still open the Roster and Season settings

#### Scenario: A site coordinator with SC
- **WHEN** that site coordinator's SC certificate is then confirmed
- **THEN** they are cleared

### Requirement: The caller's capabilities come from their roles
For a `staff` caller, every public RPC SHALL use effective capabilities: the union of the capabilities of the caller's current-season roles. A caller with no roles SHALL have no effective capabilities. There SHALL be no ceiling: `people.capabilities` is the mirror of the same roles (requirement "A person's capabilities mirror this season's roles while they have a sign-in"). The role capabilities SHALL be:
- Greeter: none;
- Intaker: `receive_documents`, `assist`;
- Preparer: `prepare`;
- Reviewer: `prepare`, `review`;
- Admin: `admin`, `followup`, `assist`, `receive_documents`.

Checks of another person's capability, for example that a follow-up assignee has `followup`, SHALL read that person's `people.capabilities`. The default follow-up person SHALL instead be accepted when they are a site coordinator or hold `followup` (capability `sign-in`). The person an admin assigns as a case's preparer or reviewer (`ASSIGN_CASE`, capability `volunteer-workload`) SHALL have their `prepare` or `review` read from their effective capabilities. The Roster's admin check SHALL be the workspace admin check (capability `volunteer-roster`). Independent review SHALL be unchanged: a preparation participant SHALL still be refused the review with `SELF_REVIEW`.

#### Scenario: A role narrower than the ceiling
- **WHEN** a cleared staff member whose only role is Preparer has `prepare` and `review` written directly into `people.capabilities`, and claims a review
- **THEN** the stored capabilities stay `prepare`, and the claim is refused with `INELIGIBLE`

#### Scenario: A role wider than the ceiling
- **WHEN** a cleared staff member whose only role is Reviewer has only `review` written directly into `people.capabilities`, and claims preparation
- **THEN** the stored capabilities stay `prepare` and `review`, and the claim succeeds

#### Scenario: Creating an assisted case
- **WHEN** a cleared site coordinator whose only role is Intaker creates an assisted case
- **THEN** it is refused with `FORBIDDEN`

#### Scenario: The self-review rule still holds
- **WHEN** a cleared Reviewer prepares a case and then tries to claim its review
- **THEN** the claim is refused with `SELF_REVIEW`

#### Scenario: Assigning a reviewer whose role is narrower than the ceiling
- **WHEN** an admin assigns, as a case's reviewer, a cleared person whose only role is Preparer
- **THEN** it is refused with `INELIGIBLE`

### Requirement: Only a cleared staff member reads case data
Every SELECT policy that gives a `staff` member access to case data SHALL require the caller to be cleared. These policies are on:
- admin_followups, assistance_items, case_contacts, case_document_cards, case_events, case_label_links, case_labels, case_materials, cases;
- client_events, contact_attempts, contact_log, contact_log_versions, document_requests, documents;
- filing_attempts, filing_notes, filing_returns;
- preparation_participants, preparer_questionnaires, preparer_shaded_fields, reviewer_questionnaires, reviews.

The check SHALL be the no-argument `vitally_policy.cleared_workspace_id()`, used as an uncorrelated subquery so it is evaluated once per statement. A client's access through the same policies SHALL NOT change. `people` SHALL NOT be gated, so an uncleared staff member still reads their own row and the other staff names. `posted_updates` holds no case data and SHALL NOT be gated by clearance: its audience policy (capability `posted-updates`) lets an uncleared staff member read the updates addressed to them.

#### Scenario: An uncleared staff member reads nothing
- **WHEN** a staff member who is not cleared reads each of the 23 tables
- **THEN** they get no rows

#### Scenario: They still read people
- **WHEN** a staff member who is not cleared reads `people`
- **THEN** they get their own row and the default follow-up person's row

#### Scenario: A cleared staff member reads as before
- **WHEN** a cleared staff member reads each of the 23 tables
- **THEN** they get the same rows a staff member got before this change, and the label tables' rows of their workspace on cases they can see

#### Scenario: Clients are unchanged
- **WHEN** a client reads their own case, documents and requests
- **THEN** they get the same rows as before this change

#### Scenario: Live updates stop
- **WHEN** an uncleared staff member is subscribed to changes on `cases`, and a case changes
- **THEN** they receive no change

#### Scenario: Every case-data policy is gated
- **WHEN** the database catalog is read
- **THEN** every policy with a staff branch, except on `people` and `posted_updates`, calls `vitally_policy.cleared_workspace_id()`

#### Scenario: Evaluated once per statement
- **WHEN** a cleared staff member reads many rows of `cases` in one statement
- **THEN** the plan evaluates `vitally_policy.cleared_workspace_id()` once, as an InitPlan, not per row

### Requirement: The case RPCs refuse an uncleared staff member first
`vitally_apply_action`, `vitally_assistance_action`, `vitally_close_unsigned`, `vitally_create_case`, `vitally_log_contact`, `vitally_edit_contact`, `vitally_set_case_label` and `vitally_save_label` SHALL refuse a `staff` caller who is not cleared with `NOT_CLEARED` (SQLSTATE VT009). The refusal SHALL come after the caller is resolved and before any case, item, contact, label or receipt is read. Nothing SHALL be written, and no receipt SHALL be stored. A client caller SHALL NOT be checked. `vitally_save_volunteer` SHALL NOT be checked.

#### Scenario: Each case RPC
- **WHEN** an uncleared staff member calls each of the eight RPCs
- **THEN** each is refused with `NOT_CLEARED`, and nothing changes

#### Scenario: An unknown id
- **WHEN** an uncleared staff member calls `vitally_apply_action` with a case id that does not exist
- **THEN** it is refused with `NOT_CLEARED`, not `NOT_FOUND`

#### Scenario: A replay
- **WHEN** a staff member who lost clearance repeats an action id that succeeded while they were cleared
- **THEN** it is refused with `NOT_CLEARED`

#### Scenario: A client is not checked
- **WHEN** a client submits their application
- **THEN** it succeeds as before

#### Scenario: An uncleared admin can still save a volunteer
- **WHEN** an admin with no roles saves their own certificates and Admin role through `vitally_save_volunteer`
- **THEN** the save succeeds, and they are cleared

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

### Requirement: A signed-in staff member's buttons follow their effective capabilities
The staff screens SHALL decide which of the signed-in staff member's own buttons, links and screens to offer from their effective capabilities, except the Volunteers, Post an update and Season settings links, which follow the workspace admin answer (`isAdmin`). Lists of other people, for example filters and follow-up holders, SHALL keep using those people's `people.capabilities`. The Workload's rows and its Assign/Reassign picker (capability `volunteer-workload`) SHALL use those people's effective capabilities, as the database does.

#### Scenario: A Preparer under a wider ceiling
- **WHEN** a cleared staff member whose only role is Preparer, and whose `people.capabilities` were written directly as `prepare` and `review`, opens a case waiting for review
- **THEN** no claim-review button is offered

#### Scenario: The picker follows effective capabilities
- **WHEN** an admin opens Assign for a case's reviewer, and a cleared volunteer's only role is Preparer
- **THEN** that volunteer is not offered

### Requirement: Staff assign work only to a cleared person
When a staff member's action puts another person on a case, a follow-up or a help request that the system did not choose, the database SHALL refuse the action with `INELIGIBLE` if that person is not cleared. Nothing SHALL be written, and no receipt SHALL be stored. Any picker that offers people for such an assignment SHALL list only cleared people.

Work the system assigns to the workspace's default follow-up person SHALL never be refused because that person is not cleared, whether a staff member's action or a client's triggers it. This covers escalating a document request, approving a review, closing a case and a client's withdrawal. Claiming preparation, a review or a help request puts the caller on the work, and the caller is already checked.

Filters SHALL keep listing people by `people.capabilities`. An admin's assignment of a case's preparer or reviewer SHALL also require the assignee's effective capabilities to include `prepare` or `review` respectively, and its picker SHALL apply the same rule.

The functions that write a case's preparer or reviewer, a follow-up's or help request's assignee, or the default follow-up person SHALL be exactly these:
- `act_claim_preparation`, `act_claim_review` and `act_assistance_claim`: the caller;
- `act_assign_case`: the person an admin chose, checked with `require_cleared_assignee`;
- `act_escalate_contact`, `act_approve_review`, `act_close_case` and `act_withdraw`: the default follow-up person;
- `set_default_followup`: the roster command;
- `hand_to_review` and `act_request_corrections`, which clear the reviewer.

A new function that assigns work SHALL be added to that list together with this check.

#### Scenario: Today's assignments
- **WHEN** the database catalog is read for functions that write those columns or insert follow-ups, help requests, reviews or preparation participants
- **THEN** exactly the functions listed above do, so a new assignment path fails the test until it is classified

#### Scenario: Claims assign only the caller
- **WHEN** a cleared preparer claims preparation, a cleared reviewer claims a review, and a cleared intaker claims a help request
- **THEN** each piece of work is assigned to the caller

#### Scenario: An uncleared default follow-up person
- **WHEN** the default follow-up person is not cleared, and a cleared staff member escalates a document request
- **THEN** the follow-up is created and assigned to the default follow-up person

#### Scenario: A client's withdrawal
- **WHEN** the default follow-up person is not cleared, and a client withdraws their application
- **THEN** the withdrawal succeeds, and its notice is assigned to the default follow-up person

#### Scenario: A staff assignment to someone uncleared
- **WHEN** an admin assigns or reassigns a case's preparer to a person who has the Preparer role but is not cleared
- **THEN** it is refused with `INELIGIBLE`, nothing is written, no receipt is stored, and the picker offered no such person

### Requirement: The migration removes unsupported roles from people with no sign-in, and refuses otherwise
Before adding the role check, the migration SHALL find every current-season roster entry with a role that its confirmed certificates do not support. If any such entry belongs to a person with a linked account, the migration SHALL stop with SQLSTATE VT008 and the count, and change nothing. Otherwise it SHALL remove the unsupported roles from those entries, and keep their certificates and every other field. It SHALL NOT unassign any case, follow-up or help request. It SHALL give every existing roster entry `is_new` false and no photo ID check.

#### Scenario: Seeded volunteers with unsupported roles
- **WHEN** the migration runs on a stack where a volunteer with no sign-in has Preparer with only VSC, and another has Intaker and Greeter with no certificates
- **THEN** both lose those roles, keep their certificates, and the migration completes

#### Scenario: A signed-in person would lose a role
- **WHEN** the migration runs where a staff member with a sign-in has Preparer with no certificates
- **THEN** it stops with VT008 and the count, and nothing is changed

#### Scenario: Supported roles are kept
- **WHEN** a volunteer has Reviewer with VSC, IT&QR and Advanced confirmed
- **THEN** the migration keeps Reviewer

### Requirement: A cleared window re-reads its clearance on wake events
A cleared staff window SHALL re-read `vitally_my_clearance()`, before its lists, on each wake event: focus, the tab becoming visible, `online`, and a realtime reconnect. An answer that is not cleared SHALL show the setup screen without reading the lists. The refresh after a successful action SHALL NOT re-read it. Role changes SHALL NOT come through realtime.

#### Scenario: An added role shows on focus
- **WHEN** a cleared Preparer's window is in the background, an admin adds the Reviewer role to them, and the window regains focus
- **THEN** a case waiting for review offers the claim-review button without a reload

#### Scenario: A tab that becomes visible re-reads
- **WHEN** a cleared staff member's tab is hidden, an admin adds a role to them, and the tab becomes visible again
- **THEN** the window shows that role's buttons without a reload

#### Scenario: Every role removed, noticed on focus
- **WHEN** an admin removes every role from a cleared staff member while their window is in the background, and the window regains focus
- **THEN** the window shows the setup screen, and no case list is read

#### Scenario: The refresh after an action does not re-read
- **WHEN** a cleared staff member's action succeeds and the window refreshes its lists
- **THEN** no clearance request is sent

### Requirement: A refusal makes a cleared window re-read its clearance
When an action in a cleared staff window is refused with `FORBIDDEN` or `INELIGIBLE`, the window SHALL re-read `vitally_my_clearance()`. The refusal SHALL stay on screen while the buttons follow the answer. An `INELIGIBLE` refusal for assigning someone who is not cleared SHALL also cause the re-read.

#### Scenario: A narrowed role is noticed on the refusal
- **WHEN** a cleared staff member whose roles were Preparer and Reviewer loses Reviewer while their window is open, and they press Claim review on a case
- **THEN** the claim is refused with `INELIGIBLE`, the refusal stays on screen, and no claim-review button is offered any more

#### Scenario: Assigning someone uncleared
- **WHEN** a cleared admin assigns a case's preparer to a person who is not cleared, and the assignment is refused with `INELIGIBLE`
- **THEN** the window re-reads its clearance once, the refusal stays on screen, and the admin's buttons are unchanged

### Requirement: Saving one's own Roster row re-reads the clearance
After the signed-in admin saves their own Roster row, the window SHALL wait for any clearance request already out, then re-read `vitally_my_clearance()` once more, whether or not they were cleared.

#### Scenario: Saving one's own row while cleared
- **WHEN** a cleared admin who is also a Preparer removes Preparer from their own Roster row and saves
- **THEN** no preparation button is offered any more

#### Scenario: Saving one's own row removes every role
- **WHEN** a cleared admin removes every role from their own Roster row and saves
- **THEN** the window shows the setup screen, and they stay on the Roster

### Requirement: Clearance re-reads are one at a time and quiet when nothing changed
A window SHALL have at most one clearance request and one wake refresh out; a wake event during a wake refresh SHALL join it. A refusal during a clearance request SHALL wait for its answer, then re-read once more. A failure of the clearance read itself SHALL NOT start another re-read. An answer with the same effective capabilities and `isAdmin` as before SHALL NOT redraw the window.

#### Scenario: One request at a time
- **WHEN** a cleared window's clearance request is still out, and the window regains focus, becomes visible, and has an action refused with `FORBIDDEN`
- **THEN** no second clearance request is sent until the first is answered

#### Scenario: Focus and visibility together
- **WHEN** a cleared window's tab comes back and fires both focus and `visibilitychange`
- **THEN** one clearance request is sent and each list is read once

#### Scenario: A refusal during an older check
- **WHEN** a cleared window's clearance request, sent before an admin narrowed their roles, is still out, and an action is refused with `INELIGIBLE`
- **THEN** once that answer arrives, one more clearance request is sent, and the buttons follow the newer answer

#### Scenario: The clearance read itself is refused
- **WHEN** a cleared window's clearance read is answered with `FORBIDDEN`
- **THEN** no further clearance request is sent

#### Scenario: Nothing changed
- **WHEN** a cleared window regains focus and the answer has the same effective capabilities and `isAdmin`
- **THEN** the window is not redrawn for the clearance answer

### Requirement: Losing or gaining effective Admin keeps the person in place
When a re-read changes whether a cleared staff member has effective `admin`, the window SHALL switch between the office frame and the work board:
- **Follow-ups** SHALL stay on the same screen, which becomes the Work board.
- **All cases** SHALL move to the Work board.
- **An office case page** SHALL stay on the same case, shown as the volunteer case page.
- **The Roster and Post an update** SHALL NOT move.

Gaining effective `admin` SHALL work in reverse.

#### Scenario: Losing Admin on Follow-ups
- **WHEN** a cleared admin who is also a Preparer is on Follow-ups, loses the Admin role, and the window re-reads its clearance
- **THEN** the same screen shows the Work board, without the All cases link

#### Scenario: Losing Admin on All cases
- **WHEN** a cleared admin who is also a Preparer is on All cases, loses the Admin role, and the window re-reads its clearance
- **THEN** the window shows the Work board, and a later gain of Admin does not return them to All cases by itself

#### Scenario: Losing Admin on an office case page
- **WHEN** a cleared admin who is also a Preparer has a case open, loses the Admin role, and the window re-reads its clearance
- **THEN** the same case shows as the volunteer case page, with no office actions

### Requirement: A form whose capability is gone keeps its text and drops its submit
A drawer, dialog or Add a case page whose action needs an effective capability the staff member lacks SHALL keep its typed text and error. Its submit SHALL be replaced by "Your roles changed, so you can't send this any more." A case page form SHALL show its explanation line and keep its draft.

#### Scenario: Losing Admin on Add a case
- **WHEN** a cleared admin who is also a Preparer has typed answers on Add a case, loses the Admin role, and the window re-reads its clearance
- **THEN** the page and the typed answers stay, and its Save draft and Send to the office buttons are replaced by "Your roles changed, so you can't send this any more."

#### Scenario: A drawer that needs a lost capability
- **WHEN** a cleared admin has typed a note in the Log call drawer, loses the Admin role, and the window re-reads its clearance
- **THEN** the drawer stays open with the note, and its submit buttons are replaced by "Your roles changed, so you can't send this any more."

#### Scenario: Gaining a role with a form in view
- **WHEN** a cleared Intaker who is not a Preparer has a case in preparation open, an admin adds the Preparer role and assigns them as the case's preparer, and the window regains focus
- **THEN** the case page offers the preparation form

### Requirement: Dialogs on the roster ceiling keep their submit
A dialog whose RPC checks only the workspace admin answer (a site coordinator, or the Admin role this season), or only that the caller is staff (Notifications), SHALL NOT be replaced when effective capabilities change. These are the volunteer drawer, Send invitation, Cancel invitation, Deactivate account, Who has read it, Unpublish, Delete draft, Change the SIDN and Notifications.

#### Scenario: A ceiling drawer is not replaced
- **WHEN** a cleared site coordinator has the volunteer drawer open, loses the Admin role, and the window re-reads its clearance
- **THEN** the volunteer drawer keeps its Save button

### Requirement: Each staff form follows the capability its RPC checks
The submit of each staff form below SHALL depend on the effective capability its RPC checks:
- `admin`: Add a case, Assign, Close unsigned, Close case, Put on hold, Resume from hold, Mark ready to e-file, Mark e-filed, Record filing result, Return to signing, Request documents;
- `followup`: Log call;
- `assist`: Resolve help;
- `review`: Ask for corrections.

#### Scenario: Resolve help without assist
- **WHEN** a cleared Intaker has the Resolve help drawer open, loses the Intaker role while keeping Greeter, and the window re-reads its clearance
- **THEN** the drawer's submit is replaced by "Your roles changed, so you can't send this any more."

### Requirement: Every dialog is classified by the capability it needs
Every dialog SHALL be in exactly one category: an effective capability (`admin`, `followup`, `assist` or `review`), the roster-ceiling dialogs, or the dialogs that need no capability. The last are the client dialogs Help, Regenerate, Print and Withdraw, and Leave without saving, which calls no RPC. A dialog that needs no capability SHALL never be replaced.

#### Scenario: Every dialog is classified
- **WHEN** the dialog keys are listed
- **THEN** each is in exactly one category, and a new key in none of them fails the check

### Requirement: A person's capabilities mirror this season's roles while they have a sign-in
`people.capabilities` SHALL equal the capabilities of the person's roles on their roster entry for the workspace's current season while the person has a sign-in (`user_id` set), and SHALL be empty otherwise. The database SHALL keep it so whoever writes `people` or `roster_entries`: a direct write of a different value SHALL be replaced by the mirror. Neither the roster command, workspace setup, account creation nor the site check SHALL choose a person's capabilities. A person with no current-season entry SHALL have none. Changes SHALL reach open staff windows through the existing `people` realtime messages, under the existing `people` read policy.

Start next season (capability `season-rollover`) SHALL recompute every person's mirror in the same transaction that changes `current_season`. Any other change of `current_season` SHALL NOT be relied on to update it.

#### Scenario: The mirror follows a role change
- **WHEN** an admin adds the Reviewer role to a signed-in Preparer and saves
- **THEN** that person's `people.capabilities` become `prepare` and `review`, and a staff window subscribed to `people` receives the change

#### Scenario: Removing every role
- **WHEN** an admin removes every role from a signed-in volunteer who holds no open work
- **THEN** their `people.capabilities` are empty

#### Scenario: A direct write is replaced
- **WHEN** a person's `people.capabilities` are written directly as `prepare` while their only role is Greeter
- **THEN** the stored capabilities stay empty

#### Scenario: Roles with no sign-in stay hidden until sign-in
- **WHEN** a Roster volunteer with no sign-in has the Preparer role and its certificates, and a staff member without `admin` reads `people`
- **THEN** that volunteer is not returned; and once the volunteer's account is created and they pass the site check, the staff member reads them with `prepare`

#### Scenario: An invited volunteer given the Admin role
- **WHEN** an invited volunteer passes the site check, and a site coordinator then gives them VSC, IT&QR and the Admin role
- **THEN** their `people.capabilities` are `admin`, `assist`, `followup` and `receive_documents`, and they open the Roster

#### Scenario: The season starts
- **WHEN** a site coordinator who is a cleared Admin and Reviewer in 2026 starts 2027
- **THEN** their `people.capabilities` are empty until 2027 roles are saved for them, and every other person's capabilities equal the mirror of their 2027 roles

### Requirement: Migration 052 refuses when someone with a sign-in would lose admin
Before changing anything, migration 052 SHALL count the people with an active `staff` membership whose `people.capabilities` include `admin` but whose current-season roster entry has no Admin role, and SHALL refuse with `VT008`, the count in its message, changing nothing, if there are any. People with no sign-in SHALL NOT be counted. Otherwise it SHALL keep a private copy of every person's capabilities from before the migration, and then recompute every person's capabilities as the mirror.

#### Scenario: An admin without the Admin role
- **WHEN** a workspace has an active staff member with `admin` in `people.capabilities` and no Admin role this season, and migration 052 runs
- **THEN** it refuses with `VT008`, naming the count, and nothing changes

#### Scenario: Every admin has the Admin role
- **WHEN** every active staff member with `admin` has the Admin role this season, and migration 052 runs
- **THEN** it succeeds, and every person's `people.capabilities` equal the mirror

### Requirement: A staff member marks their own Form 13615 or photo ID as sent
`vitally_mark_upload_sent(p_action_id, p_document)` SHALL record, on the signed-in `staff` caller's own roster entry for the workspace's current season, that their Form 13615 (`form13615`) or photo ID (`photoId`) was sent now. It SHALL take no person argument and SHALL never write another person's entry. It SHALL NOT be gated by clearance, and SHALL NOT refuse `form13615` for a cleared caller.

#### Scenario: Sending the Form 13615
- **WHEN** an uncleared staff member with a current-season entry and no roles marks their Form 13615 as sent
- **THEN** their entry's Form 13615 sent date is now, and no other entry changes

#### Scenario: A cleared caller may still send a 13615
- **WHEN** a cleared Preparer marks their Form 13615 as sent
- **THEN** it succeeds, and their entry's Form 13615 sent date is now

### Requirement: Marking a document sent is refused when it does not apply
Execute on `vitally_mark_upload_sent` SHALL be granted to `authenticated` only. It SHALL refuse a client, an anonymous caller, or a staff caller with no person row with `FORBIDDEN`. It SHALL refuse with `VALIDATION`:
- a call with no action id, or with a document other than `form13615` or `photoId`;
- a caller with no current-season roster entry;
- `photoId` when the entry is not marked new, or when its photo ID check is already recorded.

A refusal SHALL write nothing and store no receipt.

#### Scenario: A client
- **WHEN** a client calls it
- **THEN** it is refused with `FORBIDDEN`

#### Scenario: A photo ID that isn't needed
- **WHEN** a staff member whose entry is not marked new, or whose photo ID check is recorded, marks their photo ID as sent
- **THEN** it is refused with `VALIDATION`, nothing changes, and no receipt is stored

#### Scenario: No roster entry this season
- **WHEN** a staff member with no current-season roster entry marks their Form 13615 as sent
- **THEN** it is refused with `VALIDATION`, and nothing changes

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

### Requirement: The setup screen says why a document came back
When the Form 13615 or photo ID item on the setup screen has no sent date and has a review reason, the item SHALL show a line under it:
- "Your site coordinator says this is already on file. You don't need to send it again." for a Form 13615 whose reason is exactly "Already on file";
- otherwise, for any other 13615 reason and for every photo ID reason (a typed "Already on file" included): "Your site coordinator looked at this: <reason>. Please send it again or ask them."

Upload, or the text in its place, and I've uploaded it SHALL be offered as before. Once the item has a sent date again, the line SHALL go and "Waiting for review · sent <date>" SHALL show. The text SHALL be English only, and the reason SHALL be shown as stored, escaped.

#### Scenario: A photo ID came back
- **WHEN** a new staff member sent their photo ID, an admin marked it reviewed with the quick pick "Can't read it", and the staff member's setup screen re-checks
- **THEN** the photo ID item shows "Your site coordinator looked at this: Can't read it. Please send it again or ask them.", with Upload and I've uploaded it

#### Scenario: Sending again hides the reason
- **WHEN** that staff member presses I've uploaded it
- **THEN** the reason line goes, and the item shows "Waiting for review · sent <today>"

#### Scenario: "Already on file" typed for a photo ID
- **WHEN** an admin sent a new staff member's photo ID back with the typed note "Already on file", and the setup screen re-checks
- **THEN** the photo ID item shows "Your site coordinator looked at this: Already on file. Please send it again or ask them.", not the already-on-file line

#### Scenario: A note
- **WHEN** the admin's reason was the note "Please upload page 2 as well"
- **THEN** the line reads "Your site coordinator looked at this: Please upload page 2 as well. Please send it again or ask them."

### Requirement: Removing a person from the roster empties their capabilities and their clearance
When a person's current-season roster entry is removed (capability `volunteer-roster`), their `people.capabilities` SHALL be recomputed as the mirror, which is empty with no current-season entry, whether or not they keep a sign-in. They SHALL NOT be cleared. Case RPCs SHALL refuse them as an uncleared staff member if their membership is still active (a site coordinator), and as having no membership otherwise.

A removed person's open window SHALL learn of it on its next clearance re-read, on the wake events that already trigger one (focus, the tab becoming visible, `online`, or a realtime reconnect):
- a person whose account was deactivated SHALL see "This account has no access";
- a site coordinator, whose account stays active, SHALL see the setup screen.

#### Scenario: Capabilities after removal
- **WHEN** a Reviewer with an active account is removed from the current roster
- **THEN** their `people.capabilities` is empty

#### Scenario: A site coordinator's capabilities after removal
- **WHEN** a site coordinator holding the Admin role is removed by another site coordinator
- **THEN** their `people.capabilities` is empty, they are not cleared, and they are still a workspace admin through the site coordinator mark

#### Scenario: A removed site coordinator's window
- **WHEN** a site coordinator with the work board open is removed from the roster, and their window then regains focus
- **THEN** the window shows "Finish your setup", without a reload
