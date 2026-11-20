## ADDED Requirements

### Requirement: A person's capabilities mirror this season's roles while they have a sign-in
`people.capabilities` SHALL equal the capabilities of the person's roles on their roster entry for the workspace's current season while the person has a sign-in (`user_id` set), and SHALL be empty otherwise. The database SHALL keep it so whoever writes `people` or `roster_entries`: a direct write of a different value SHALL be replaced by the mirror. Neither the roster command, workspace setup, account creation nor the site check SHALL choose a person's capabilities. A person with no current-season entry SHALL have none. Changes SHALL reach open staff windows through the existing `people` realtime messages, under the existing `people` read policy.

Start next season (a later change) SHALL recompute the mirror when `current_season` changes; until then, a change of `current_season` SHALL NOT be relied on to update it.

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

### Requirement: Migration 052 refuses when someone with a sign-in would lose admin
Before changing anything, migration 052 SHALL count the people with an active `staff` membership whose `people.capabilities` include `admin` but whose current-season roster entry has no Admin role, and SHALL refuse with `VT008`, the count in its message, changing nothing, if there are any. People with no sign-in SHALL NOT be counted. Otherwise it SHALL keep a private copy of every person's capabilities from before the migration, and then recompute every person's capabilities as the mirror.

#### Scenario: An admin without the Admin role
- **WHEN** a workspace has an active staff member with `admin` in `people.capabilities` and no Admin role this season, and migration 052 runs
- **THEN** it refuses with `VT008`, naming the count, and nothing changes

#### Scenario: Every admin has the Admin role
- **WHEN** every active staff member with `admin` has the Admin role this season, and migration 052 runs
- **THEN** it succeeds, and every person's `people.capabilities` equal the mirror

## MODIFIED Requirements

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

### Requirement: A staff member can read their own clearance
`vitally_my_clearance()` SHALL take no arguments and SHALL answer only for the signed-in `staff` caller with:
- whether they are cleared;
- what is missing: no roles (their Form 13615), the photo ID check if they are new and unchecked, the certificates any role lacks, and the SC certificate if they are a site coordinator on this season's roster without it;
- their effective capabilities;
- whether they are a workspace admin (`isAdmin`: a site coordinator, or holding the Admin role this season);
- whether they are a site coordinator (`isSiteCoordinator`);
- the display name of the workspace's default follow-up person.

It SHALL return no email, phone or other profile data. A client or an anonymous caller SHALL be refused with `FORBIDDEN`. Execute SHALL be granted to `authenticated` only.

#### Scenario: Not cleared
- **WHEN** a staff member with no roles calls it
- **THEN** it says they are not cleared, that their Form 13615 is missing, that their effective capabilities are empty, that they are not an admin, and names the default follow-up person

#### Scenario: Cleared
- **WHEN** a cleared Preparer calls it
- **THEN** it says they are cleared, with nothing missing, effective capabilities `prepare`, and not an admin or site coordinator

#### Scenario: A site coordinator missing SC
- **WHEN** a site coordinator with the Admin role and VSC and IT&QR, and no SC, calls it
- **THEN** it says they are not cleared, that the SC certificate is missing, that they are an admin and a site coordinator

#### Scenario: A site coordinator with no roles
- **WHEN** a site coordinator with no current-season roles calls it
- **THEN** it says they are an admin and a site coordinator, with empty effective capabilities

#### Scenario: A client
- **WHEN** a client calls it
- **THEN** it is refused with `FORBIDDEN`

### Requirement: An uncleared staff member sees the setup screen
After sign-in, a `staff` member who is not cleared SHALL see only the setup screen, titled "Finish your setup for this season", and the Notifications panel. The setup screen SHALL list:
- upload your signed Form 13615, when they have no roles;
- photo ID, when they are new and unchecked;
- "Site coordinators need the SC certificate.", when they are a site coordinator on this season's roster without it;
- "Ask <name>, your site coordinator", naming the default follow-up person.

It SHALL have a "Check again" button. The screen SHALL re-check when Check again is pressed and when the window regains focus, and SHALL show the normal staff screens once the person is cleared. The setup screen's sidebar SHALL offer Notifications, with its unread badge, and the panel SHALL show the updates addressed to them (capability `posted-updates`). The feed and badge SHALL re-read together with the clearance check. An uncleared workspace admin SHALL also have the Volunteers link and the Roster, the Post an update link and screen, and the Season settings link and screen (capability `season-settings`), and no client data. When any action returns `NOT_CLEARED`, the window SHALL switch to the setup screen.

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
- **WHEN** a site coordinator with no roles signs in
- **THEN** they see the setup screen, the Volunteers, Post an update and Season settings links, can open the Roster, Post an update and Season settings, and see no case

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

### Requirement: Dialogs on the roster ceiling keep their submit
A dialog whose RPC checks only the workspace admin answer (a site coordinator, or the Admin role this season), or only that the caller is staff (Notifications), SHALL NOT be replaced when effective capabilities change. These are the volunteer drawer, Send invitation, Cancel invitation, Deactivate account, Who has read it, Unpublish, Delete draft, Change the SIDN and Notifications.

#### Scenario: A ceiling drawer is not replaced
- **WHEN** a cleared site coordinator has the volunteer drawer open, loses the Admin role, and the window re-reads its clearance
- **THEN** the volunteer drawer keeps its Save button

## RENAMED Requirements

- FROM: `### Requirement: The caller's capabilities come from their roles, within the roster ceiling`
- TO: `### Requirement: The caller's capabilities come from their roles`
