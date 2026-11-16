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
The schema `vitally_policy` SHALL hold exactly two functions:
- `is_workspace_admin(p_workspace_id uuid)`, which answers whether the signed-in caller's person has `admin` in `people.capabilities` in the given workspace;
- `cleared_workspace_id()`, which returns the workspace of the caller's active `staff` membership when the caller is cleared for its current season, and null otherwise.

Each SHALL take no user id and SHALL answer only for the signed-in caller. Each SHALL be `security definer` and `stable` with `search_path=''`. Execute on each SHALL be granted to `authenticated` only, and SHALL NOT be held by `public`, `anon` or `service_role`. No function in `vitally_policy` SHALL take a user id.

#### Scenario: The catalog
- **WHEN** the database catalog is read
- **THEN** `vitally_policy` holds only `is_workspace_admin(uuid)` and `cleared_workspace_id()`, with those properties and grants, and no argument of any function in the schema names a user

#### Scenario: A non-admin asks
- **WHEN** a staff member without `admin` calls `is_workspace_admin` for their own workspace
- **THEN** it returns false

#### Scenario: An admin asks about another workspace
- **WHEN** an admin of one workspace calls `is_workspace_admin` for another workspace
- **THEN** it returns false

#### Scenario: An uncleared admin is still an admin
- **WHEN** a staff member whose `people.capabilities` include `admin` and who has no roles calls `is_workspace_admin` for their own workspace
- **THEN** it returns true, and `cleared_workspace_id()` returns null

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
Add a volunteer SHALL open a drawer with:
- name, email and phone (optional);
- works and languages;
- roles and certificates;
- "New volunteer", ticked by default, and "Photo ID checked".

Saving SHALL create a person with no sign-in and no capabilities, their profile, and a roster entry for the current season recording who added them, whether they are new, and when their photo ID was checked, if ticked. It SHALL also create a certificate row for each tick. The new volunteer SHALL appear in the list after saving. Saving SHALL NOT create an Auth account or a membership.

#### Scenario: A new volunteer
- **WHEN** an admin fills in the form and saves
- **THEN** the volunteer appears on the Roster, and they have no account, no membership and no capabilities

#### Scenario: New is the default
- **WHEN** an admin opens Add a volunteer
- **THEN** "New volunteer" is ticked and "Photo ID checked" is not

#### Scenario: Waiting for Form 13615
- **WHEN** an admin adds a volunteer with no roles and no certificates
- **THEN** the save succeeds, and the volunteer shows as not cleared

#### Scenario: Retrying the same save
- **WHEN** the same save is sent twice with the same action id
- **THEN** one volunteer exists and both calls return the same result

#### Scenario: Save again after a lost answer
- **WHEN** an admin's save lands but its answer never reaches the window, and the admin presses Save again without changing the form
- **THEN** the window re-reads the list after the failure, sends the same action id again, the stored result answers, and the drawer closes with one volunteer and one receipt

### Requirement: An admin can edit a volunteer
Edit SHALL open the same drawer filled in with the volunteer's values, and saving SHALL replace them.
- A certificate that stays ticked SHALL keep its original confirmation date and confirmer. A confirmed certificate that is unticked SHALL be deleted, together with every role that needs it, in the same save.
- The save SHALL change only the certificates the drawer manages. It SHALL NOT delete or change an `uploaded` certificate that it is not sent. Ticking a certificate whose row is `uploaded` SHALL confirm it, by that admin, now, and roles that need it MAY be granted in the same save.
- A photo ID check that stays ticked SHALL keep its original time.
- The email of a volunteer who has a sign-in SHALL be read-only in the drawer, and SHALL be refused by the database if changed.
- Cancel invitation (sign-in-accounts) SHALL remove the sign-in of a volunteer whose invitation was never completed, after which the email SHALL be editable again. An account that was ever active SHALL keep its email locked.
- A save based on values someone else has since changed SHALL be refused with a conflict, and the drawer SHALL say so.

#### Scenario: Editing fields
- **WHEN** an admin changes a volunteer's name, phone and roles and saves
- **THEN** the Roster shows the new values

#### Scenario: A certificate stays ticked
- **WHEN** an admin saves an edit that leaves VSC ticked and adds Basic
- **THEN** VSC keeps its original date and confirmer, and Basic is confirmed now by that admin

#### Scenario: A certificate is unticked
- **WHEN** an admin unticks Basic for a volunteer whose only qualifying certificate for Preparer is Basic, and saves
- **THEN** the Basic row no longer exists and the volunteer no longer has Preparer

#### Scenario: An uploaded certificate survives a save
- **WHEN** a volunteer has an `uploaded` VSC row and an admin saves an edit that doesn't send VSC
- **THEN** the VSC row still exists, still `uploaded` and otherwise unchanged

#### Scenario: Ticking an uploaded certificate confirms it
- **WHEN** a volunteer has an `uploaded` VSC row and an admin ticks VSC and Greeter and saves
- **THEN** the VSC row is `confirmed` by that admin now, and the volunteer has Greeter

#### Scenario: Recording the photo ID check
- **WHEN** an admin ticks "Photo ID checked" for a new volunteer with a role and saves
- **THEN** the check time is stored and the volunteer shows as cleared

#### Scenario: A volunteer with a sign-in
- **WHEN** an admin opens Edit for a volunteer who has a sign-in
- **THEN** the email field is read-only

#### Scenario: After Cancel invitation
- **WHEN** an admin cancels the invitation of a volunteer who never completed it, and opens Edit
- **THEN** the email field can be changed, and the save lands

#### Scenario: Changing a locked email anyway
- **WHEN** a call changes the email of a volunteer who has a sign-in
- **THEN** it is refused with `VALIDATION` and nothing changes

#### Scenario: Two admins
- **WHEN** two admins open the same volunteer, and the second saves after the first
- **THEN** the second save is refused with `CONFLICT`, the drawer says someone else changed this volunteer, and the first save stands

### Requirement: The volunteer form is validated
A save SHALL require:
- a name of 1 to 80 characters;
- a valid email of at most 254 characters, stored in lower case and unique in the workspace ignoring case;
- one of On site, Remote or On site and remote. Works SHALL default to On site.

Roles SHALL come from Greeter, Intaker, Preparer, Reviewer and Admin, and MAY be empty. Each role SHALL be refused unless its certificates are ticked (requirement "A role exists only once its certificates are confirmed"), and the drawer SHALL name the missing certificates.

Phone, when given, SHALL be at most 30 characters. Languages SHALL come from English, Mandarin, Cantonese and Other. Other SHALL require the language to be named, in at most 40 characters, and a named language SHALL be refused without Other. Certificates SHALL come from VSC, IT&QR, SC, Basic and Advanced. The database SHALL refuse anything else with `VALIDATION`.

#### Scenario: No role
- **WHEN** an admin saves with no role ticked
- **THEN** the save succeeds

#### Scenario: A role without its certificates
- **WHEN** an admin ticks Preparer with only VSC and saves
- **THEN** the save is refused, the drawer says Preparer needs IT&QR and Basic or Advanced, and nothing is saved

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

### Requirement: Existing staff are on the Roster after the migration
The migration SHALL give each person linked to a `staff` membership a profile with their account's email in lower case, works On site, no phone and no languages, and a roster entry for the workspace's current season with no roles. It SHALL change no existing person, membership or case.

#### Scenario: Migrating a workspace with staff
- **WHEN** the migration runs on a workspace with staff members and clients
- **THEN** each staff member has one profile and one roster entry, and no client has either

### Requirement: The Roster lists the current season's volunteers and whether each is cleared
The Roster SHALL list every volunteer with a roster entry for the workspace's current season, one row each. Each row SHALL show:
- the name, and a Remote badge when they work remotely or both;
- email and phone;
- their roles, and their confirmed certificates as neutral labels;
- their languages;
- their account: "Not created", "Invited", "Active" or "Deactivated";
- whether they are cleared, and if not, what is missing, in this order:
  - their Form 13615 when they have no roles;
  - the photo ID check when they are new and unchecked;
  - "No account yet" when they have no account, "Hasn't signed in yet" when it is invited, or "Account deactivated" when it is deactivated;
- an Edit button.

A volunteer with no roles SHALL show "No roles recorded", and one with no certificates SHALL show "None recorded". The page SHALL say that a volunteer works on cases only once they are cleared. The page SHALL show no season label.

#### Scenario: The list
- **WHEN** an admin opens the Roster
- **THEN** every volunteer on the current season's roster has one row with those columns

#### Scenario: A staff member nobody has recorded yet
- **WHEN** a staff member created by the roster command appears on the Roster before anyone has recorded them
- **THEN** their row shows the email from their account, "No roles recorded", "Active", and that they are not cleared because their Form 13615 is missing

#### Scenario: A cleared volunteer
- **WHEN** a volunteer with an active account has Preparer with VSC, IT&QR and Basic confirmed, and is not marked new
- **THEN** their row shows them as cleared

#### Scenario: New and not yet checked
- **WHEN** a volunteer with an active account has Greeter with VSC, and is marked new with no photo ID check
- **THEN** their row says the photo ID check is missing

#### Scenario: Roles but no account
- **WHEN** a volunteer with no sign-in has Preparer with its certificates and is not marked new
- **THEN** their row shows "Not created" and not cleared, with "No account yet"

#### Scenario: Invited
- **WHEN** a volunteer with roles has an invited account
- **THEN** their row shows "Invited" and not cleared, with "Hasn't signed in yet"

#### Scenario: Deactivated
- **WHEN** a volunteer with roles has a deactivated account
- **THEN** their row shows "Deactivated" and not cleared, with "Account deactivated"

### Requirement: A save cannot take away what a person's open work needs
`vitally_save_volunteer` SHALL refuse a save, with nothing written, when it would leave the person without a capability their open work needs, or uncleared while they hold any open work. Open work and the capability each needs SHALL be:
- preparer of a case that is not closed: `prepare`;
- reviewer of a case that is not closed: `review`;
- assignee of an open follow-up: `followup`;
- the workspace's default follow-up person: `followup`;
- assignee of a claimed help request: `assist`.

The drawer SHALL say "<name> still has open work: <list>. Finish it or hand it over first.", listing that work. A save that keeps every needed capability, and keeps the person cleared, SHALL be allowed.

#### Scenario: Removing Preparer while preparing
- **WHEN** an admin removes Preparer from a volunteer who is preparing an open case, and saves
- **THEN** the save is refused, the drawer lists that case, and the volunteer keeps Preparer

#### Scenario: Unticking a certificate the work needs
- **WHEN** an admin unticks IT&QR for the default follow-up person, which would remove their Admin role, and saves
- **THEN** the save is refused and the drawer lists being the default follow-up person

#### Scenario: A change the work doesn't need
- **WHEN** an admin removes Greeter from a volunteer who also has Preparer and is preparing an open case
- **THEN** the save succeeds

#### Scenario: Another certificate still covers the role
- **WHEN** an admin unticks Advanced for a Preparer who is preparing a case and also has Basic
- **THEN** the save succeeds, and they keep Preparer

#### Scenario: No open work
- **WHEN** an admin removes every role from a volunteer who holds no open work
- **THEN** the save succeeds, and the volunteer is no longer cleared
