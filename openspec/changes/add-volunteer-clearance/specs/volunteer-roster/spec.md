## MODIFIED Requirements

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
- A certificate that stays ticked SHALL keep its original confirmation date and confirmer. A certificate that is unticked SHALL be deleted, together with every role that needs it, in the same save.
- A photo ID check that stays ticked SHALL keep its original time.
- The email of a volunteer who has a sign-in SHALL be read-only in the drawer, and SHALL be refused by the database if changed.
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

#### Scenario: Recording the photo ID check
- **WHEN** an admin ticks "Photo ID checked" for a new volunteer with a role and saves
- **THEN** the check time is stored and the volunteer shows as cleared

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

## ADDED Requirements

### Requirement: The Roster lists the current season's volunteers and whether each is cleared
The Roster SHALL list every volunteer with a roster entry for the workspace's current season, one row each. Each row SHALL show:
- the name, and a Remote badge when they work remotely or both;
- email and phone;
- their roles, and their confirmed certificates as neutral labels;
- their languages;
- whether they are cleared, and if not, what is missing: their Form 13615 when they have no roles, or the photo ID check when they are new and unchecked;
- an Edit button.

A volunteer with no roles SHALL show "No roles recorded", and one with no certificates SHALL show "None recorded". The page SHALL say that a volunteer works on cases only once they are cleared. The page SHALL show no season label.

#### Scenario: The list
- **WHEN** an admin opens the Roster
- **THEN** every volunteer on the current season's roster has one row with those columns

#### Scenario: A staff member nobody has recorded yet
- **WHEN** a staff member created by the roster command appears on the Roster before anyone has recorded them
- **THEN** their row shows the email from their account, "No roles recorded", and that they are not cleared because their Form 13615 is missing

#### Scenario: A cleared volunteer
- **WHEN** a volunteer has Preparer with VSC, IT&QR and Basic confirmed, and is not marked new
- **THEN** their row shows them as cleared

#### Scenario: New and not yet checked
- **WHEN** a volunteer has Greeter with VSC, and is marked new with no photo ID check
- **THEN** their row says the photo ID check is missing

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

## REMOVED Requirements

### Requirement: The Roster lists the current season's volunteers

**Reason**: The Roster now shows whether each volunteer is cleared and what is missing, and no longer says roles change nothing; replaced by "The Roster lists the current season's volunteers and whether each is cleared".

**Migration**: None for callers; the page text and tests move to the new requirement.

### Requirement: Roles and certificates grant nothing

**Reason**: Roles now grant capabilities within the roster ceiling, and a staff member works on case data only when cleared (capability `volunteer-clearance`).

**Migration**: Fixtures and `seed:local` give staff accounts roles backed by confirmed certificates. Tests that relied on recording a role having no effect move to the `volunteer-clearance` requirements.
