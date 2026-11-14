# volunteer-clearance Specification

## Purpose
TBD - created by archiving change add-volunteer-clearance. Update Purpose after archive.

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
A person SHALL be cleared for a workspace when their roster entry for the workspace's current season has at least one role, and either the entry is not marked new or its photo ID check is recorded. A person with no roster entry for the current season, or with no roles, SHALL NOT be cleared. A cleared person's roles are in effect, because a role exists only once its certificates are confirmed.

#### Scenario: Roles and an old hand
- **WHEN** a staff member's current-season entry has Preparer, is not marked new, and their certificates are confirmed
- **THEN** they are cleared

#### Scenario: No roles
- **WHEN** a staff member's current-season entry has no roles
- **THEN** they are not cleared

#### Scenario: New without photo ID
- **WHEN** a staff member's entry has Greeter and is marked new with no photo ID check
- **THEN** they are not cleared, and once the photo ID check is recorded they are

#### Scenario: Last season only
- **WHEN** a staff member has roles only on an earlier season's entry
- **THEN** they are not cleared

### Requirement: The caller's capabilities come from their roles, within the roster ceiling
For a `staff` caller, every public RPC SHALL use effective capabilities: the union of the capabilities of the caller's current-season roles, intersected with the person's `people.capabilities`. A caller with no roles SHALL have no effective capabilities. The role capabilities SHALL be:
- Greeter: none;
- Intaker: `receive_documents`, `assist`;
- Preparer: `prepare`;
- Reviewer: `prepare`, `review`;
- Admin: `admin`, `followup`, `assist`, `receive_documents`.

Checks of another person's capability, for example that a follow-up assignee or the default follow-up person has `followup`, SHALL keep reading that person's `people.capabilities`. The Roster's admin check SHALL keep reading the caller's `people.capabilities`. Independent review SHALL be unchanged: a preparation participant SHALL still be refused the review with `SELF_REVIEW`.

#### Scenario: A role narrower than the ceiling
- **WHEN** a cleared staff member whose `people.capabilities` are `prepare` and `review` has only the Preparer role, and claims a review
- **THEN** the claim is refused with `INELIGIBLE`

#### Scenario: A role wider than the ceiling
- **WHEN** a cleared staff member whose `people.capabilities` are only `review` has the Reviewer role, and claims preparation
- **THEN** the claim is refused with `INELIGIBLE`

#### Scenario: Creating an assisted case
- **WHEN** a cleared staff member whose ceiling includes `admin` but whose only role is Intaker creates an assisted case
- **THEN** it is refused with `FORBIDDEN`

#### Scenario: The self-review rule still holds
- **WHEN** a cleared Reviewer prepares a case and then tries to claim its review
- **THEN** the claim is refused with `SELF_REVIEW`

### Requirement: Only a cleared staff member reads case data
Every SELECT policy that gives a `staff` member access to case data SHALL require the caller to be cleared. These policies are on:
- admin_followups, assistance_items, case_contacts, case_document_cards, case_events, case_materials, cases;
- client_events, contact_attempts, contact_log, contact_log_versions, document_requests, documents;
- filing_attempts, filing_notes, filing_returns;
- preparation_participants, preparer_questionnaires, preparer_shaded_fields, reviewer_questionnaires, reviews.

The check SHALL be the no-argument `vitally_policy.cleared_workspace_id()`, used as an uncorrelated subquery so it is evaluated once per statement. A client's access through the same policies SHALL NOT change. `people` SHALL NOT be gated, so an uncleared staff member still reads their own row and the other staff names. `posted_updates` holds no case data and SHALL NOT be gated by clearance: its audience policy (capability `posted-updates`) lets an uncleared staff member read the updates addressed to them.

#### Scenario: An uncleared staff member reads nothing
- **WHEN** a staff member who is not cleared reads each of the 21 tables
- **THEN** they get no rows

#### Scenario: They still read people
- **WHEN** a staff member who is not cleared reads `people`
- **THEN** they get their own row and the default follow-up person's row

#### Scenario: A cleared staff member reads as before
- **WHEN** a cleared staff member reads each of the 21 tables
- **THEN** they get the same rows a staff member got before this change

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
`vitally_apply_action`, `vitally_assistance_action`, `vitally_close_unsigned`, `vitally_create_case`, `vitally_log_contact` and `vitally_edit_contact` SHALL refuse a `staff` caller who is not cleared with `NOT_CLEARED` (SQLSTATE VT009). The refusal SHALL come after the caller is resolved and before any case, item, contact or receipt is read. Nothing SHALL be written, and no receipt SHALL be stored. A client caller SHALL NOT be checked. `vitally_save_volunteer` SHALL NOT be checked.

#### Scenario: Each case RPC
- **WHEN** an uncleared staff member calls each of the six RPCs
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
- what is missing: no roles (their Form 13615), the photo ID check if they are new and unchecked, and the certificates any role lacks;
- their effective capabilities;
- whether their `people.capabilities` include `admin`;
- the display name of the workspace's default follow-up person.

It SHALL return no email, phone or other profile data. A client or an anonymous caller SHALL be refused with `FORBIDDEN`. Execute SHALL be granted to `authenticated` only.

#### Scenario: Not cleared
- **WHEN** a staff member with no roles calls it
- **THEN** it says they are not cleared, that their Form 13615 is missing, that their effective capabilities are empty, and names the default follow-up person

#### Scenario: Cleared
- **WHEN** a cleared Preparer calls it
- **THEN** it says they are cleared, with nothing missing, and effective capabilities `prepare`

#### Scenario: A client
- **WHEN** a client calls it
- **THEN** it is refused with `FORBIDDEN`

### Requirement: An uncleared staff member sees the setup screen
After sign-in, a `staff` member who is not cleared SHALL see only the setup screen, titled "Finish your setup for this season", and the Notifications panel. The setup screen SHALL list:
- upload your signed Form 13615, when they have no roles;
- photo ID, when they are new and unchecked;
- "Ask <name>, your site coordinator", naming the default follow-up person.

It SHALL have a "Check again" button. The screen SHALL re-check when Check again is pressed and when the window regains focus, and SHALL show the normal staff screens once the person is cleared. The setup screen's sidebar SHALL offer Notifications, with its unread badge, and the panel SHALL show the updates addressed to them (capability `posted-updates`). The feed and badge SHALL re-read together with the clearance check. An uncleared staff member whose `people.capabilities` include `admin` SHALL also have the Volunteers link and the Roster, and the Post an update link and screen, and no client data. When any action returns `NOT_CLEARED`, the window SHALL switch to the setup screen.

#### Scenario: Signing in uncleared
- **WHEN** a staff member with no roles signs in
- **THEN** they see "Finish your setup for this season", the Form 13615 item and the site coordinator's name, and no work board

#### Scenario: Becoming cleared
- **WHEN** an admin records a role for that staff member, and the staff member presses Check again
- **THEN** the work board opens

#### Scenario: Focus re-checks
- **WHEN** the staff member is cleared while their window is in the background, and the window regains focus
- **THEN** the work board opens without pressing anything

#### Scenario: An uncleared admin
- **WHEN** an admin with no roles signs in
- **THEN** they see the setup screen, the Volunteers and Post an update links, can open the Roster and Post an update, and see no case

#### Scenario: Clearance lost mid-session
- **WHEN** a staff member's roles are removed while their window is open, and they press an action
- **THEN** the window shows the setup screen

#### Scenario: An uncleared volunteer reads an update
- **WHEN** a staff member with a current-season roster entry and no roles signs in, and an update to All volunteers is posted
- **THEN** the setup screen's sidebar shows Notifications with a badge of 1, and the panel shows the update and no case data

### Requirement: A signed-in staff member's buttons follow their effective capabilities
The staff screens SHALL decide which of the signed-in staff member's own buttons, links and screens to offer from their effective capabilities. Lists of other people, for example filters and follow-up holders, SHALL keep using those people's `people.capabilities`.

#### Scenario: A Preparer under a wider ceiling
- **WHEN** a cleared staff member whose ceiling is `prepare` and `review`, and whose only role is Preparer, opens a case waiting for review
- **THEN** no claim-review button is offered

### Requirement: Staff assign work only to a cleared person
When a staff member's action puts another person on a case, a follow-up or a help request that the system did not choose, the database SHALL refuse the action with `INELIGIBLE` if that person is not cleared. Nothing SHALL be written, and no receipt SHALL be stored. Any picker that offers people for such an assignment SHALL list only cleared people.

Work the system assigns to the workspace's default follow-up person SHALL never be refused because that person is not cleared, whether a staff member's action or a client's triggers it. This covers escalating a document request, approving a review, closing a case and a client's withdrawal. Claiming preparation, a review or a help request puts the caller on the work, and the caller is already checked.

Filters SHALL keep listing people by `people.capabilities`.

The functions that write a case's preparer or reviewer, a follow-up's or help request's assignee, or the default follow-up person SHALL be exactly these:
- `act_claim_preparation`, `act_claim_review` and `act_assistance_claim`: the caller;
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
- **WHEN** a staff member's action assigns work to a person who is not cleared (the first such action is #139's Reassign)
- **THEN** it is refused with `INELIGIBLE`, and the picker offered no such person

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
