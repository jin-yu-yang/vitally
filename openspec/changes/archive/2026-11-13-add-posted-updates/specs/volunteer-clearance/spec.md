## MODIFIED Requirements

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
