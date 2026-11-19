## ADDED Requirements

### Requirement: Only a site coordinator changes the Admin role
`vitally_save_volunteer` SHALL refuse with `FORBIDDEN` (detail `ADMIN_ROLE`), writing nothing and storing no receipt, a save by a caller who is not a site coordinator (capability `site-coordinators`) that adds the Admin role to a volunteer, removes it, or adds a new volunteer with it. Any workspace admin SHALL keep changing every other role. In the volunteer form, a caller who is not a site coordinator SHALL see the Admin tick disabled, showing its saved state, with "Only site coordinators change the Admin role."

#### Scenario: A site coordinator gives the Admin role
- **WHEN** a site coordinator ticks VSC, IT&QR and Admin for a volunteer and saves
- **THEN** the save succeeds, and the volunteer has the Admin role

#### Scenario: An admin who is not a site coordinator adds the Admin role
- **WHEN** a staff member with the Admin role who is not a site coordinator sends a save adding the Admin role to a volunteer
- **THEN** it is refused with `FORBIDDEN`, nothing changes, and no receipt is stored

#### Scenario: An admin who is not a site coordinator removes the Admin role
- **WHEN** a staff member with the Admin role who is not a site coordinator sends a save removing another volunteer's Admin role
- **THEN** it is refused with `FORBIDDEN`, and the volunteer keeps it

#### Scenario: Other roles stay with any admin
- **WHEN** a staff member with the Admin role who is not a site coordinator adds Reviewer to a volunteer who has the Admin role, keeping Admin
- **THEN** the save succeeds

#### Scenario: The disabled tick
- **WHEN** a staff member with the Admin role who is not a site coordinator opens a volunteer's form
- **THEN** the Admin tick is disabled and says "Only site coordinators change the Admin role."

### Requirement: A volunteer with no sign-in is visible only to admins, whatever their roles
A person with no linked account and no capabilities SHALL be readable only by an admin of the workspace. Because capabilities mirror roles only while a person has a sign-in (capability `volunteer-clearance`), a volunteer with no sign-in SHALL stay hidden from non-admin staff whatever roles they hold. A person with a linked account SHALL stay readable by every staff member of the workspace. The All cases "Prepared by" and "Reviewed by" filters SHALL NOT offer a person with no capabilities.

#### Scenario: A non-admin and a volunteer with no sign-in
- **WHEN** a staff member without `admin` reads `people` in a workspace that has a volunteer with no sign-in
- **THEN** that volunteer is not returned, and every staff member with a sign-in is

#### Scenario: A volunteer with roles and no sign-in
- **WHEN** a volunteer with no sign-in has the Preparer role and its certificates, and a staff member without `admin` reads `people`
- **THEN** that volunteer is not returned

#### Scenario: A kept persona stays hidden
- **WHEN** a staff member without `admin` reads `people` in a workspace with an unlinked person kept from before staff accounts
- **THEN** that person is not returned, because a person with no sign-in has no capabilities since migration 052

#### Scenario: An admin and a volunteer with no sign-in
- **WHEN** an admin reads `people` in the same workspace
- **THEN** that volunteer is returned

#### Scenario: Live updates
- **WHEN** an admin adds a volunteer with no sign-in while an admin and a staff member without `admin` are subscribed to changes on `people`
- **THEN** the admin receives the change, and the staff member without `admin` does not

#### Scenario: The All cases filters
- **WHEN** an admin opens All cases in a workspace that has a volunteer with no sign-in
- **THEN** that volunteer is not offered in the "Prepared by" or "Reviewed by" filter

## MODIFIED Requirements

### Requirement: Only an admin can open the Roster
The staff sidebar SHALL show a "Volunteers" link after All cases only to a workspace admin: a staff member who is a site coordinator (capability `site-coordinators`) or holds the Admin role this season, cleared or not. The link SHALL open the Roster. A staff member who is not a workspace admin whose window was left on the Roster SHALL get the work board.

#### Scenario: An admin sees the link
- **WHEN** a staff member with the Admin role signs in
- **THEN** the sidebar has a "Volunteers" link after All cases, and it opens the Roster

#### Scenario: A site coordinator with no roles sees the link
- **WHEN** a site coordinator with no current-season roles signs in
- **THEN** the sidebar has a "Volunteers" link, and it opens the Roster

#### Scenario: A preparer sees no link
- **WHEN** a staff member with only the Preparer role signs in
- **THEN** the sidebar has no "Volunteers" link

#### Scenario: A window left on the Roster
- **WHEN** a staff member who is not a workspace admin restores a window whose saved screen is the Roster
- **THEN** they get the work board and no Roster data

### Requirement: The admin check answers only for the caller
The schema `vitally_policy` SHALL hold exactly four functions:
- `is_workspace_admin(p_workspace_id uuid)`, which answers whether the signed-in caller has an active `staff` membership in the given workspace and either their person has `admin` in `people.capabilities` (the Admin role this season, capability `volunteer-clearance`) or their account there is an active site coordinator's (capability `site-coordinators`);
- `cleared_workspace_id()`, which returns the workspace of the caller's active `staff` membership when the caller is cleared for its current season, and null otherwise;
- `in_update_audience(p_workspace_id uuid, p_audience text, p_roles text[])`, which answers whether the signed-in caller's person is in a posted update's audience (capability `posted-updates`);
- `unpublished_read_window()`, which returns how long the audience still reads an unpublished update (capability `posted-updates`).

None SHALL take a user id, and each that answers about a person SHALL answer only for the signed-in caller. `is_workspace_admin`, `cleared_workspace_id` and `in_update_audience` SHALL be `security definer` and `stable` with `search_path=''`. `unpublished_read_window` reads nothing: it SHALL be `immutable`, not `security definer`, with `search_path=''`. Execute on each SHALL be granted to `authenticated` only, and SHALL NOT be held by `public`, `anon` or `service_role`.

#### Scenario: The catalog
- **WHEN** the database catalog is read
- **THEN** `vitally_policy` holds only `is_workspace_admin(uuid)`, `cleared_workspace_id()`, `in_update_audience(uuid, text, text[])` and `unpublished_read_window()`, with those properties and grants, and no argument of any function in the schema names a user

#### Scenario: A non-admin asks
- **WHEN** a staff member with only the Preparer role, who is not a site coordinator, calls `is_workspace_admin` for their own workspace
- **THEN** it returns false

#### Scenario: An admin asks about another workspace
- **WHEN** an admin of one workspace calls `is_workspace_admin` for another workspace
- **THEN** it returns false

#### Scenario: An uncleared admin is still an admin
- **WHEN** a site coordinator with no roles calls `is_workspace_admin` for their own workspace
- **THEN** it returns true, and `cleared_workspace_id()` returns null

#### Scenario: The Admin role makes an admin
- **WHEN** a staff member who is not a site coordinator holds the Admin role this season, and is not cleared
- **THEN** `is_workspace_admin` returns true

### Requirement: Only an admin can save a volunteer
`vitally_save_volunteer` SHALL refuse with `FORBIDDEN` any caller who is not a workspace admin (`is_workspace_admin`), before any other check of the call, and before anything is written or a receipt is reserved. An edit of a person in another workspace, or of an id that has no profile, SHALL be refused with `NOT_FOUND`. Changing the Admin role SHALL also need a site coordinator (requirement "Only a site coordinator changes the Admin role").

#### Scenario: A non-admin
- **WHEN** a staff member who is not a workspace admin calls `vitally_save_volunteer`
- **THEN** it is refused with `FORBIDDEN`, nothing changes, and no receipt is stored

#### Scenario: A client
- **WHEN** a client calls `vitally_save_volunteer`
- **THEN** it is refused with `FORBIDDEN`, nothing changes, and no receipt is stored

#### Scenario: A malformed call from a non-admin
- **WHEN** a staff member who is not a workspace admin calls `vitally_save_volunteer` with a null action id
- **THEN** it is refused with `FORBIDDEN`, not `VALIDATION`

#### Scenario: Another workspace
- **WHEN** an admin edits a volunteer of another workspace
- **THEN** it is refused with `NOT_FOUND`

#### Scenario: An uncleared site coordinator ticks their own certificates
- **WHEN** a site coordinator with no roles ticks their own VSC, IT&QR and SC and saves
- **THEN** the save succeeds

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
  - "SC certificate missing" when they are a site coordinator without SC confirmed;
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

#### Scenario: A site coordinator without SC
- **WHEN** a site coordinator with an active account has the Admin role with VSC and IT&QR, is not marked new, and has no SC
- **THEN** their row shows not cleared, with "SC certificate missing"

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
`vitally_save_volunteer` SHALL refuse a save, with nothing written, when it would leave the person without a capability their open work needs, or uncleared while they hold any open work. The capabilities before and after the save SHALL be the role capabilities of the stored and requested roles. Open work and the capability each needs SHALL be:
- preparer of a case that is not closed: `prepare`;
- reviewer of a case that is not closed: `review`;
- assignee of an open follow-up: `followup`;
- the workspace's default follow-up person: `followup`, unless they are a site coordinator, who meets this need whatever their roles or clearance;
- assignee of a claimed help request: `assist`.

The drawer SHALL say "<name> still has open work: <list>. Finish it or hand it over first.", listing that work. A save that keeps every needed capability, and keeps the person cleared, SHALL be allowed.

#### Scenario: Removing Preparer while preparing
- **WHEN** an admin removes Preparer from a volunteer who is preparing an open case
- **THEN** the save is refused, the drawer lists that case, and the volunteer keeps Preparer

#### Scenario: Unticking a certificate the work needs
- **WHEN** a site coordinator unticks IT&QR for a default follow-up person who is not a site coordinator, which would remove their Admin role, and saves
- **THEN** the save is refused and the drawer lists being the default follow-up person

#### Scenario: A site coordinator who is the default
- **WHEN** a site coordinator removes the Admin role from the default follow-up person, who is a site coordinator and holds no other open work
- **THEN** the save succeeds, and they stay the default follow-up person

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

### Requirement: A volunteer with no sign-in is visible only to admins

**Reason**: Replaced by "A volunteer with no sign-in is visible only to admins, whatever their roles". Since migration 052 a person with no sign-in has no capabilities, so the old scenario "A kept persona stays visible" (an unlinked person with capabilities) can no longer happen.

**Migration**: None for callers: the `staff_people` policy is unchanged. Tests that gave an unlinked person capabilities move to the new requirement's scenarios.
