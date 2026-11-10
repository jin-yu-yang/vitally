# volunteer-roster Specification

## Purpose
The admin-only Roster under Volunteers: the season's list of volunteers with their contact details, ways of working, languages, recorded roles and certificate ticks, its search and role filter, and the drawer that adds and edits a volunteer. It covers who can open the screen and read its records (admins of the workspace only, through a caller-only admin check), the one RPC that writes them, the people a volunteer with no sign-in is hidden from, the backfill of existing staff, and the rule that roles and certificates are records only and grant no capability.

## Requirements

### Requirement: Only an admin can open the Roster
The staff sidebar SHALL show a "Volunteers" link after All cases only to a staff member whose person has `admin`. The link SHALL open the Roster. A staff member without `admin` whose window was left on the Roster SHALL get the work board.

#### Scenario: An admin sees the link
- **WHEN** a staff member with `admin` signs in
- **THEN** the sidebar has a "Volunteers" link after All cases, and it opens the Roster

#### Scenario: A preparer sees no link
- **WHEN** a staff member with only `prepare` signs in
- **THEN** the sidebar has no "Volunteers" link

#### Scenario: A window left on the Roster
- **WHEN** a staff member without `admin` restores a window whose saved screen is the Roster
- **THEN** they get the work board and no Roster data

### Requirement: Roster records are readable and writable only by admins
The database SHALL let a signed-in staff member read `volunteer_profiles`, `roster_entries` and `certificates` only when their active `staff` membership is in that workspace and their linked person has `admin`. A non-admin, a client and an anonymous caller SHALL read no rows. These tables SHALL be read-only for signed-in users; every write SHALL go through `vitally_save_volunteer`. These tables SHALL NOT be in the realtime publication.

#### Scenario: An admin reads the records
- **WHEN** an admin reads the three tables
- **THEN** they get the rows of their own workspace

#### Scenario: A non-admin reads nothing
- **WHEN** a staff member without `admin` reads any of the three tables
- **THEN** they get no rows

#### Scenario: A client reads nothing
- **WHEN** a client reads any of the three tables
- **THEN** they get no rows

#### Scenario: Another workspace
- **WHEN** an admin of one workspace reads the three tables
- **THEN** they get no rows of another workspace

#### Scenario: A direct write is refused
- **WHEN** an admin tries to insert, update or delete a row in any of the three tables directly
- **THEN** the database refuses it

#### Scenario: Table privileges
- **WHEN** the table privileges are read
- **THEN** `authenticated` holds only `select` on the three tables, and `anon` and `service_role` hold nothing

### Requirement: The admin check answers only for the caller
The schema `vitally_policy` SHALL hold exactly one function, `is_workspace_admin(p_workspace_id uuid)`. It SHALL take no user id and SHALL answer only for the signed-in caller in the given workspace. It SHALL be `security definer` and `stable` with `search_path=''`. Execute on it SHALL be granted to `authenticated` only, and SHALL NOT be held by `public`, `anon` or `service_role`. No function in `vitally_policy` SHALL take a user id.

#### Scenario: The catalog
- **WHEN** the database catalog is read
- **THEN** `vitally_policy` holds only `is_workspace_admin(uuid)`, with those properties and grants, and no argument of any function in the schema names a user

#### Scenario: A non-admin asks
- **WHEN** a staff member without `admin` calls the function for their own workspace
- **THEN** it returns false

#### Scenario: An admin asks about another workspace
- **WHEN** an admin of one workspace calls the function for another workspace
- **THEN** it returns false

### Requirement: A volunteer with no sign-in is visible only to admins
A person with no linked account and no capabilities SHALL be readable only by an admin of the workspace. A person with a linked account, or with any capability, SHALL stay readable by every staff member of the workspace. The All cases "Prepared by" and "Reviewed by" filters SHALL NOT offer a person with no capabilities.

#### Scenario: A non-admin and a volunteer with no sign-in
- **WHEN** a staff member without `admin` reads `people` in a workspace that has a volunteer with no sign-in
- **THEN** that volunteer is not returned, and every staff member with a sign-in is

#### Scenario: An admin and a volunteer with no sign-in
- **WHEN** an admin reads `people` in the same workspace
- **THEN** that volunteer is returned

#### Scenario: Live updates
- **WHEN** an admin adds a volunteer with no sign-in while an admin and a staff member without `admin` are subscribed to changes on `people`
- **THEN** the admin receives the change, and the staff member without `admin` does not

#### Scenario: A kept persona stays visible
- **WHEN** a staff member without `admin` reads `people` in a workspace with an unlinked person who has capabilities
- **THEN** that person is returned

#### Scenario: The All cases filters
- **WHEN** an admin opens All cases in a workspace that has a volunteer with no sign-in
- **THEN** that volunteer is not offered in the "Prepared by" or "Reviewed by" filter

### Requirement: The Roster lists the current season's volunteers
The Roster SHALL list every volunteer with a roster entry for the workspace's current season, one row each, showing the name, a Remote badge when they work remotely or both, email and phone, their roles, their ticked certificates as neutral labels, their languages, and an Edit button. A volunteer with no roles SHALL show "No roles recorded", and one with no certificates SHALL show "None recorded". The page SHALL say "Roles and certificates are recorded here. They don't change what anyone can do in ViTally yet." The page SHALL show no season label, and no indication that a role is inactive or a certificate is missing.

#### Scenario: The list
- **WHEN** an admin opens the Roster
- **THEN** every volunteer on the current season's roster has one row with those columns

#### Scenario: A staff member nobody has recorded yet
- **WHEN** a staff member created before this change appears on the Roster
- **THEN** their row shows the email from their account and "No roles recorded"

#### Scenario: Nothing suggests clearance
- **WHEN** a volunteer has the Preparer role and no certificates
- **THEN** the row shows Preparer as a plain label, "None recorded" for certificates, and no missing or inactive marker

### Requirement: An admin can search and filter the Roster
The Roster SHALL have a search box matching name, email and phone without regard to case, and a role filter offering All roles and each of Greeter, Intaker, Preparer, Reviewer and Admin. A row SHALL be shown only if it passes both. When nothing passes, the table SHALL say so.

#### Scenario: Search by phone
- **WHEN** an admin types part of a volunteer's phone number
- **THEN** only volunteers whose name, email or phone contains it are shown

#### Scenario: Filter by role
- **WHEN** an admin chooses Reviewer
- **THEN** only volunteers with the Reviewer role are shown

#### Scenario: Search and filter together
- **WHEN** an admin chooses Reviewer and types a name that matches only a Preparer
- **THEN** no rows are shown, and the table says nobody matches

### Requirement: An admin can add a volunteer
Add a volunteer SHALL open a drawer with name, email, phone (optional), works, languages, roles and certificates. Saving SHALL create a person with no sign-in and no capabilities, their profile, a roster entry for the current season recording who added them, and a certificate row for each tick. The new volunteer SHALL appear in the list after saving. Saving SHALL NOT create an Auth account or a membership.

#### Scenario: A new volunteer
- **WHEN** an admin fills in the form and saves
- **THEN** the volunteer appears on the Roster, and they have no account, no membership and no capabilities

#### Scenario: Retrying the same save
- **WHEN** the same save is sent twice with the same action id
- **THEN** one volunteer exists and both calls return the same result

#### Scenario: Save again after a lost answer
- **WHEN** an admin's save lands but its answer never reaches the window, and the admin presses Save again without changing the form
- **THEN** the window re-reads the list after the failure, sends the same action id again, the stored result answers, and the drawer closes with one volunteer and one receipt

### Requirement: An admin can edit a volunteer
Edit SHALL open the same drawer filled in with the volunteer's values, and saving SHALL replace them. A certificate that stays ticked SHALL keep its original confirmation date and confirmer. A certificate that is unticked SHALL be deleted. The email of a volunteer who has a sign-in SHALL be read-only in the drawer and SHALL be refused by the database if changed. A save based on values someone else has since changed SHALL be refused with a conflict, and the drawer SHALL say so.

#### Scenario: Editing fields
- **WHEN** an admin changes a volunteer's name, phone and roles and saves
- **THEN** the Roster shows the new values

#### Scenario: A certificate stays ticked
- **WHEN** an admin saves an edit that leaves VSC ticked and adds Basic
- **THEN** VSC keeps its original date and confirmer, and Basic is confirmed now by that admin

#### Scenario: A certificate is unticked
- **WHEN** an admin unticks Basic and saves
- **THEN** the Basic row no longer exists

#### Scenario: A volunteer with a sign-in
- **WHEN** an admin opens Edit for a volunteer who has a sign-in
- **THEN** the email field is read-only

#### Scenario: Changing a locked email anyway
- **WHEN** a call changes the email of a volunteer who has a sign-in
- **THEN** it is refused with `VALIDATION` and nothing changes

#### Scenario: Two admins
- **WHEN** two admins open the same volunteer, and the second saves after the first
- **THEN** the second save is refused with `CONFLICT`, the drawer says someone else changed this volunteer, and the first save stands

### Requirement: The volunteer form is validated
A save SHALL require a name of 1 to 80 characters, a valid email of at most 254 characters, stored in lower case and unique in the workspace ignoring case, one of On site, Remote or On site and remote, and at least one of Greeter, Intaker, Preparer, Reviewer or Admin. Phone, when given, SHALL be at most 30 characters. Languages SHALL come from English, Mandarin, Cantonese and Other. Other SHALL require the language to be named, in at most 40 characters, and a named language SHALL be refused without Other. Certificates SHALL come from VSC, IT&QR, SC, Basic and Advanced, each independent of the others and of the roles. The database SHALL refuse anything else with `VALIDATION`. Works SHALL default to On site.

#### Scenario: No role
- **WHEN** an admin saves with no role ticked
- **THEN** the save is refused and the drawer says a role is needed

#### Scenario: A duplicate email
- **WHEN** an admin enters an email already on the Roster, in a different case
- **THEN** the drawer says that email is already on the Roster, and nothing is saved

#### Scenario: Other without a language
- **WHEN** an admin ticks Other and names no language
- **THEN** the save is refused

#### Scenario: An unknown certificate
- **WHEN** a call sends a certificate outside the list
- **THEN** it is refused with `VALIDATION` and nothing changes

### Requirement: Only an admin can save a volunteer
`vitally_save_volunteer` SHALL refuse with `FORBIDDEN` any caller who is not an active staff member whose person has `admin`, before any other check of the call, and before anything is written or a receipt is reserved. An edit of a person in another workspace, or of an id that has no profile, SHALL be refused with `NOT_FOUND`.

#### Scenario: A non-admin
- **WHEN** a staff member without `admin` calls `vitally_save_volunteer`
- **THEN** it is refused with `FORBIDDEN`, nothing changes, and no receipt is stored

#### Scenario: A client
- **WHEN** a client calls `vitally_save_volunteer`
- **THEN** it is refused with `FORBIDDEN`, nothing changes, and no receipt is stored

#### Scenario: A malformed call from a non-admin
- **WHEN** a staff member without `admin` calls `vitally_save_volunteer` with a null action id
- **THEN** it is refused with `FORBIDDEN`, not `VALIDATION`

#### Scenario: Another workspace
- **WHEN** an admin edits a volunteer of another workspace
- **THEN** it is refused with `NOT_FOUND`

### Requirement: Roles and certificates grant nothing
Saving a volunteer SHALL NOT change any person's capabilities or any membership. What a staff member can do SHALL depend only on the capabilities the roster command gave them.

#### Scenario: Recording a role
- **WHEN** an admin records the Reviewer role and every certificate for a staff member with only `prepare`
- **THEN** that staff member's capabilities are still `prepare`, and claiming a review is refused

#### Scenario: Removing every certificate
- **WHEN** an admin unticks every certificate of a staff member with `prepare`
- **THEN** that staff member can still claim preparation

### Requirement: Existing staff are on the Roster after the migration
The migration SHALL give each person linked to a `staff` membership a profile with their account's email in lower case, works On site, no phone and no languages, and a roster entry for the workspace's current season with no roles. It SHALL change no existing person, membership or case.

#### Scenario: Migrating a workspace with staff
- **WHEN** the migration runs on a workspace with staff members and clients
- **THEN** each staff member has one profile and one roster entry, and no client has either
