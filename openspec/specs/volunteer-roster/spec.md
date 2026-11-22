# volunteer-roster Specification

## Purpose
The admin-only Roster under Volunteers: the season's list of volunteers with their contact details, ways of working, languages, roles, confirmed certificates and whether each is cleared, its search and role filter, and the drawer that adds and edits a volunteer. It covers who can open the screen and read its records (admins of the workspace only, through a caller-only admin check), the one RPC that writes them, the people a volunteer with no sign-in is hidden from, the backfill of existing staff, and the rule that a save cannot take away what a person's open work needs. Which roles a person may hold, and what they then may do, is the `volunteer-clearance` capability.

## Requirements

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

### Requirement: An admin can search and filter the Roster
The Roster SHALL have:
- a search box matching name, email and phone without regard to case;
- a role filter offering All roles and each of Greeter, Intaker, Preparer, Reviewer and Admin;
- a Show filter offering "Everyone" and "Uploads to review". Uploads to review keeps the volunteers who have a Form 13615 or photo ID sent date set. The Show filter's views SHALL be one list, so a later view is one more entry.

A row SHALL be shown only if it passes all three. When nothing passes, the table SHALL say so.

#### Scenario: Search by phone
- **WHEN** an admin types part of a volunteer's phone number
- **THEN** only volunteers whose name, email or phone contains it are shown

#### Scenario: Filter by role
- **WHEN** an admin chooses Reviewer
- **THEN** only volunteers with the Reviewer role are shown

#### Scenario: Search and filter together
- **WHEN** an admin chooses Reviewer and types a name that matches only a Preparer
- **THEN** no rows are shown, and the table says nobody matches

#### Scenario: Uploads to review
- **WHEN** an admin chooses Show: Uploads to review
- **THEN** only volunteers with a Form 13615 or photo ID sent date set are shown

#### Scenario: Show and role together
- **WHEN** an admin chooses Uploads to review and Preparer
- **THEN** only Preparers with a sent date set are shown

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
- A save that changes the volunteer's current-season roles or confirmed certificates SHALL clear their Form 13615 sent date. A save that records the photo ID check where none was recorded, or that unticks New volunteer for a volunteer who was new, SHALL clear their photo ID sent date. A save that changes neither SHALL leave the sent dates as they are.
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

#### Scenario: Reviewing a sent Form 13615
- **WHEN** a volunteer has sent their Form 13615, and an admin ticks VSC and IT&QR and the Intaker role and saves
- **THEN** the Form 13615 sent date is cleared

#### Scenario: Ticking Photo ID checked clears its sent date
- **WHEN** a new volunteer has sent their photo ID, and an admin ticks "Photo ID checked" and saves
- **THEN** the photo ID sent date is cleared

#### Scenario: Unticking New volunteer clears the photo ID sent date
- **WHEN** a new volunteer has sent their photo ID, and an admin unticks "New volunteer" and saves
- **THEN** the photo ID sent date is cleared, and nothing is left to review for the photo ID

#### Scenario: An unrelated edit keeps the sent date
- **WHEN** a volunteer has sent their Form 13615, and an admin changes only their phone and saves
- **THEN** the Form 13615 sent date stays

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
- a name of 1 to 80 characters, after trimming spaces, tabs and line breaks;
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
  - "SC certificate missing" when they are a site coordinator without SC confirmed;
  - "No account yet" when they have no account, "Hasn't signed in yet" when it is invited, or "Account deactivated" when it is deactivated;
- "Form 13615 to review" when their Form 13615 sent date is set, and "Photo ID to review" when their photo ID sent date is set, whether or not they are cleared;
- an Edit button.

A volunteer with no roles SHALL show "No roles recorded", and one with no certificates SHALL show "None recorded". The page SHALL say that a volunteer works on cases only once they are cleared. The page SHALL show no season label. Roster records, including the sent dates, SHALL stay readable only by workspace admins.

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

#### Scenario: Waiting for review
- **WHEN** a volunteer with no roles has marked their Form 13615 as sent
- **THEN** their row shows their Form 13615 missing and "Form 13615 to review"

#### Scenario: Others' sent dates stay hidden
- **WHEN** a staff member who is not a workspace admin reads the roster entries
- **THEN** they get no rows, so no sent date of anyone

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
- preparer of a current-season case that is not closed: `prepare`;
- reviewer of a current-season case that is not closed: `review`;
- assignee of an open follow-up: `followup`;
- the workspace's default follow-up person: `followup`, unless they are a site coordinator, who meets this need whatever their roles or clearance;
- assignee of a claimed help request: `assist`.

The drawer SHALL say "<name> still has open work: <list>. Finish it or hand it over first.", listing that work. A current-season case SHALL be one whose season is the workspace's current season or is not yet set; a case from an earlier season SHALL NOT count, whatever its stage. A save that keeps every needed capability, and keeps the person cleared, SHALL be allowed.

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

#### Scenario: A returning volunteer with a past-season case
- **WHEN** a volunteer was the preparer of an Accepted 2026 case, the season is now 2027, and an admin removes Preparer from their 2027 roster entry
- **THEN** the save succeeds, and the 2026 case still names them as its preparer

#### Scenario: A current-season Accepted case still counts
- **WHEN** an admin removes Preparer from a volunteer who prepared an Accepted case of the current season
- **THEN** the save is refused, and the drawer lists that case

### Requirement: Only a site coordinator changes the Admin role
`vitally_save_volunteer` SHALL refuse with `FORBIDDEN` (`ADMIN_ROLE`), writing nothing and storing no receipt, a save by a caller who is not a site coordinator (capability `site-coordinators`) that adds the Admin role to a volunteer, removes it, or adds a new volunteer with it. Any workspace admin SHALL keep changing every other role. In the volunteer form, a caller who is not a site coordinator SHALL see the Admin tick disabled, showing its saved state, with "Only site coordinators change the Admin role."

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

### Requirement: An admin marks a sent document reviewed
`vitally_mark_upload_reviewed(p_action_id, p_volunteer_id, p_expected_revision, p_document, p_reason)` SHALL clear the Form 13615 (`form13615`) or photo ID (`photoId`) sent date on the volunteer's current-season roster entry, and SHALL record on that entry the time of the call and the reason, trimmed of spaces, tabs and line breaks, as that document's reviewed time and review reason. It SHALL be allowed for a workspace admin, cleared or not. Clearing a set date SHALL raise the volunteer's revision. When nothing is waiting, the call SHALL succeed and change nothing, the reason included. A repeated action id SHALL return the stored result. There SHALL be no form of the function without a reason.

#### Scenario: Mark reviewed on a Form 13615
- **WHEN** a volunteer has marked their Form 13615 as sent, and an admin marks it reviewed with the reason "Not signed"
- **THEN** the Form 13615 sent date is cleared, its reviewed time is now and its reason is "Not signed", and the volunteer's roles and certificates are unchanged

#### Scenario: Nothing waiting
- **WHEN** a second admin presses Mark reviewed for a document another admin already marked reviewed, after re-reading, with a different reason
- **THEN** it succeeds, and nothing changes: the first reason stays

#### Scenario: The four-argument call
- **WHEN** a caller calls `vitally_mark_upload_reviewed` with four arguments
- **THEN** no such function exists, and nothing changes

### Requirement: Mark reviewed is refused when it does not apply
`vitally_mark_upload_reviewed` SHALL refuse anyone who is not a workspace admin with `FORBIDDEN` before any other check. It SHALL refuse a malformed call with `VALIDATION`, including a missing reason, a reason that is empty after trimming, and a reason longer than 120 characters. It SHALL refuse an unknown volunteer with `NOT_FOUND` and a stale revision with `CONFLICT`. A refusal SHALL write nothing and store no receipt.

#### Scenario: A non-admin
- **WHEN** a staff member who is not a workspace admin calls it
- **THEN** it is refused with `FORBIDDEN`, nothing changes, and no receipt is stored

#### Scenario: No reason
- **WHEN** an admin calls it with a null reason, or one of only spaces
- **THEN** it is refused with `VALIDATION`, the sent date stays, and no receipt is stored

#### Scenario: A reason too long
- **WHEN** an admin calls it with a 121-character reason
- **THEN** it is refused with `VALIDATION`, and nothing changes

#### Scenario: A stale revision
- **WHEN** an admin calls it with a revision someone else's save has since raised
- **THEN** it is refused with `CONFLICT`, and the sent date stays

### Requirement: The Edit drawer shows what was sent, with Mark reviewed
While editing a volunteer, the Edit drawer SHALL show "Form 13615 sent <date>" and "Photo ID sent <date>" for each document that is waiting, each with a Mark reviewed button. Mark reviewed SHALL open a reason row in the drawer, with quick picks, a note of at most 120 characters, Send back and Cancel:
- for a Form 13615: "Not signed", "Can't read it", "Wrong form" and "Missing a certification", and also "Already on file" when the volunteer has a role this season;
- for a photo ID: "Can't read it", "Expired" and "Not a photo ID".

Send back SHALL be unavailable until a quick pick is chosen or a note is typed. A note SHALL be sent in place of the quick pick. Send back SHALL mark the document reviewed with that reason; Cancel SHALL close the row and send nothing. After Send back lands, the drawer SHALL keep the admin's unsaved edits and the new revision, and the sent line SHALL go.

When a document has a stored review reason, the drawer SHALL show "Last returned: <reason> · <date>" in that document's place, where its sent line goes. `<date>` is the New York day it was sent back.

#### Scenario: Mark reviewed on a photo ID
- **WHEN** a new volunteer has marked their photo ID as sent, and an admin opens Edit, presses Mark reviewed beside "Photo ID sent <date>", picks "Expired" and presses Send back
- **THEN** the photo ID sent date is cleared with the reason "Expired", the sent line goes, and the volunteer is no longer listed under Uploads to review

#### Scenario: Photo ID quick picks
- **WHEN** an admin presses Mark reviewed beside "Photo ID sent <date>"
- **THEN** the quick picks are "Can't read it", "Expired" and "Not a photo ID", with the note; "Not signed", "Wrong form", "Missing a certification" and "Already on file" are not offered

#### Scenario: The last reason
- **WHEN** an admin sent a volunteer's Form 13615 back with "Not signed" on Nov 20, and another admin opens that volunteer's Edit drawer
- **THEN** the drawer shows "Last returned: Not signed · Nov 20" where the Form 13615 line goes; once the volunteer sends it again, the drawer shows "Form 13615 sent <date>" instead

#### Scenario: Send back needs a reason
- **WHEN** an admin presses Mark reviewed and neither picks a reason nor types a note
- **THEN** Send back is unavailable, and nothing is sent

#### Scenario: Already on file for a re-send
- **WHEN** a cleared Preparer sent a new Form 13615, and an admin presses Mark reviewed beside it
- **THEN** the quick picks include "Already on file"; for a volunteer with no roles they do not

#### Scenario: Cancel
- **WHEN** an admin presses Mark reviewed and then Cancel
- **THEN** the reason row closes, and the sent date stays

#### Scenario: Unsaved edits survive
- **WHEN** an admin changes a volunteer's phone in the drawer, sends a document back with a reason, and then saves
- **THEN** the save lands with the new phone, with no conflict

### Requirement: A workspace admin's sidebar counts uploads to review
For a workspace admin, cleared or not, the Volunteers link SHALL show how many volunteers on the current season's roster have a Form 13615 or photo ID sent date set. It SHALL read "Volunteers · <n>", with the accessible name "Volunteers, <n> uploads to review" ("Volunteers, 1 upload to review" for one), and "Volunteers" when there are none. It SHALL count people, not documents. No one who is not a workspace admin SHALL be shown it or read it.

#### Scenario: Two volunteers waiting
- **WHEN** one volunteer has sent a Form 13615 and another has sent both documents, and a site coordinator's window loads
- **THEN** the sidebar shows "Volunteers · 2"

#### Scenario: One volunteer waiting
- **WHEN** exactly one volunteer has a sent date set
- **THEN** the sidebar shows "Volunteers · 1", named "Volunteers, 1 upload to review"

#### Scenario: Nothing waiting
- **WHEN** no volunteer has a sent date set
- **THEN** the sidebar shows "Volunteers"

### Requirement: The uploads count is re-read with the clearance and the Roster
The count SHALL be re-read:
- when the window loads its data;
- when the clearance is checked;
- on a cleared window's wake refresh;
- after the admin's own save or Mark reviewed;
- whenever the Roster's list is read.

A failed count read SHALL keep the last count and SHALL NOT fail anything else.

#### Scenario: The count follows a review
- **WHEN** a site coordinator's sidebar shows "Volunteers · 2", and they tick one of those volunteers' certificates and a role and save
- **THEN** the sidebar shows "Volunteers · 1"

#### Scenario: Focus re-reads it
- **WHEN** a volunteer sends a Form 13615 while an admin's window is in the background, and the admin's window regains focus
- **THEN** the count includes that volunteer

### Requirement: A save clears the review it acts on
A `vitally_save_volunteer` save that would clear the volunteer's Form 13615 sent date (it changes their current-season roles or confirmed certificates) SHALL also clear that document's reviewed time and review reason. A save that would clear the photo ID sent date (it records the photo ID check where none was recorded, or unticks New volunteer for a volunteer who was new) SHALL also clear the photo ID's. Both SHALL hold whether or not a sent date was set. A save that does neither SHALL leave them as they are.

#### Scenario: Recording the certificate after a send-back
- **WHEN** an admin sent a volunteer's Form 13615 back with "Missing a certification", and later ticks Advanced for them and saves
- **THEN** the Form 13615 reviewed time and reason are cleared

#### Scenario: Ticking Photo ID checked
- **WHEN** a new volunteer's photo ID was sent back with "Can't read it", and an admin ticks "Photo ID checked" and saves
- **THEN** the photo ID reviewed time and reason are cleared

#### Scenario: An unrelated edit keeps the reason
- **WHEN** a volunteer's Form 13615 was sent back with "Not signed", and an admin changes only their phone and saves
- **THEN** the reason stays

### Requirement: An admin edits a volunteer's usual days
The Edit and Add drawer SHALL offer Usual days as seven checkboxes, Monday to Sunday, filled in from the volunteer's stored days. `vitally_save_volunteer` SHALL accept the payload's ten keys with or without a `usualDays` array:
- with it, the stored days SHALL be replaced by its values, stored in week order;
- without it, the stored days SHALL stay as they are, and a new volunteer SHALL have none.

The values SHALL come from `mon`, `tue`, `wed`, `thu`, `fri`, `sat` and `sun`, with no repeats. Anything else SHALL be refused with `VALIDATION`. Usual days SHALL be readable only by workspace admins and by the volunteer themselves (capability `my-profile`).

#### Scenario: Setting usual days
- **WHEN** an admin ticks Saturday and Tuesday for a volunteer and saves
- **THEN** the volunteer's usual days are `tue` and `sat`, and the drawer shows them ticked when opened again

#### Scenario: A save without usual days
- **WHEN** a call to `vitally_save_volunteer` for a volunteer whose usual days are `mon` sends the ten keys without `usualDays`
- **THEN** the save lands, and the usual days are still `mon`

#### Scenario: An unknown day
- **WHEN** a call sends `usualDays` of `["monday"]`, or `["mon","mon"]`
- **THEN** it is refused with `VALIDATION`, and nothing changes

#### Scenario: Not readable by other staff
- **WHEN** a cleared Preparer who is not an admin reads `volunteer_profiles`
- **THEN** they see no other volunteer's usual days

### Requirement: Add a volunteer offers last season's people
The Add a volunteer drawer SHALL start with a search box, "Returning volunteer? Search last season's roster".

Under the box it SHALL list each person with a roster entry for the season before the current one and none for the current season, sorted by name. Typing SHALL keep those whose name or email contains the text, without regard to case.

When the box holds an email equal, ignoring case, to the profile email of anyone in the workspace with no current-season roster entry, that person SHALL also be offered. They SHALL be labelled "Earlier volunteer" when they were not on last season's roster.

Nobody on the current roster SHALL be offered.

#### Scenario: Last season's people are offered
- **WHEN** the season is 2026, Nadia Kerr and Owen Pratt were on the 2025 roster, and Owen Pratt is already on the 2026 roster, and an admin opens Add a volunteer
- **THEN** the search list offers Nadia Kerr and not Owen Pratt

#### Scenario: Searching by name
- **WHEN** an admin types "ker" into the search box
- **THEN** only last season's people not on this roster whose name or email contains "ker" are listed

#### Scenario: An earlier volunteer found by email
- **WHEN** a person with a profile was on the 2024 roster only, and an admin types their full email into the search box in 2026
- **THEN** they are offered, labelled "Earlier volunteer"

### Requirement: Picking a returning volunteer fills their person fields only
Picking a person SHALL fill the form from their profile: name, email, phone, works, languages with the other language, and usual days.

"New volunteer" and "Photo ID checked" SHALL be unticked. Roles and certificates SHALL start empty, and no certificate SHALL be copied from an earlier season. They SHALL stay editable under the rule that a role needs its certificates ticked.

While a person is picked, the email SHALL be read-only. "Not this person" SHALL return the drawer to a blank Add, with "New volunteer" ticked.

Saving SHALL send `vitally_save_volunteer` with the picked person as the volunteer and their profile revision as the expected revision. A conflict SHALL be handled as for Edit.

#### Scenario: Picking fills the person's fields, not the season's
- **WHEN** an admin picks Nadia Kerr, who was a Preparer with VSC, IT&QR and Basic in 2025 and has stored usual days Tue and Thu
- **THEN** the form shows her name, email (read-only), phone, works, languages and usual days Tue and Thu; New volunteer and Photo ID checked are unticked; no role and no certificate is ticked

#### Scenario: Saving a picked volunteer
- **WHEN** an admin picks Nadia Kerr and saves without other changes
- **THEN** she appears on the Roster with "No roles recorded", not new, and not cleared, and her usual days are still Tue and Thu

#### Scenario: Confirming this season's Form 13615 in the same save
- **WHEN** an admin picks Nadia Kerr, ticks VSC, IT&QR, Basic and Preparer, and saves
- **THEN** she appears on the Roster as a Preparer with those certificates, confirmed by that admin now

#### Scenario: Not this person
- **WHEN** an admin picks Nadia Kerr and then presses "Not this person"
- **THEN** the form is empty, the email is editable, and New volunteer is ticked

### Requirement: Saving a volunteer who is not on the current roster adds them to it
`vitally_save_volunteer` for a volunteer with a profile in the caller's workspace but no current-season roster entry SHALL save as for Edit:
- it SHALL update their name and profile and raise the profile's revision;
- it SHALL create their current-season roster entry, with the caller as who added them;
- it SHALL confirm each ticked certificate.

Earlier seasons' entries and certificates SHALL be unchanged. Refusals SHALL be as for Edit: `CONFLICT`, `ROLE_NEEDS` and `ADMIN_ROLE`. A repeated action id SHALL return the stored result.

#### Scenario: A past volunteer is added
- **WHEN** the season is 2026, a person has a profile and a 2025 roster entry with Preparer and confirmed certificates, and an admin saves them with no roles, not new, and the same profile fields
- **THEN** they have a 2026 roster entry with no roles, not new, added by that admin; their profile revision is one higher; and their 2025 roster entry and certificates are unchanged

#### Scenario: Usual days are kept
- **WHEN** that past volunteer has stored usual days Tue and Thu, and the save sends usual days Tue and Thu
- **THEN** their usual days are still Tue and Thu

#### Scenario: A stale revision
- **WHEN** two admins pick the same past volunteer, and the second saves after the first
- **THEN** the second is refused with `CONFLICT`, and the volunteer has one 2026 roster entry

#### Scenario: Retrying the same save
- **WHEN** the same save of a past volunteer is sent twice with the same action id
- **THEN** both calls return the same result, and one 2026 roster entry exists

### Requirement: An earlier volunteer's email points to the search
When an admin types an email into the Add form's email field without picking, and it equals, ignoring case, the profile email of a person with no current-season roster entry, the drawer SHALL say "That email belongs to an earlier volunteer. Pick them above." It SHALL NOT send the save.

An email already on the current Roster SHALL keep the message "That email is already on the Roster."

#### Scenario: Typing a returning volunteer's email
- **WHEN** an admin fills in Add a volunteer with Nadia Kerr's email, without picking her, and saves
- **THEN** the drawer says "That email belongs to an earlier volunteer. Pick them above.", and nothing is saved

#### Scenario: An email on this Roster
- **WHEN** an admin enters an email already on the current Roster
- **THEN** the drawer says "That email is already on the Roster.", and nothing is saved

### Requirement: An admin can export the Roster as a CSV
The Roster SHALL have an "Export CSV" button. It SHALL download a CSV of exactly the rows the table shows under the current search, role and Show filters, in the table's order. It SHALL be disabled when no row is shown.

The file SHALL be named `roster-<season>-<YYYY-MM-DD>.csv`, with the current season and the New York date. Only workspace admins SHALL have the button, as only they open the Roster.

#### Scenario: Exporting a filtered Roster
- **WHEN** the season is 2026, it is 2026-11-23 in New York, and an admin chooses Reviewer and presses Export CSV
- **THEN** a file `roster-2026-2026-11-23.csv` downloads with the header row and one row per Reviewer shown, and no other volunteers

#### Scenario: Nothing to export
- **WHEN** the search matches nobody
- **THEN** Export CSV is disabled

### Requirement: The Roster CSV has the table's columns
The CSV SHALL have these columns, in this order:
- Name, Email and Phone;
- Roles, as the table names them, joined with "; ";
- Certificates, as the table names them, each followed by its confirmation date (`YYYY-MM-DD`, New York time) in brackets, joined with "; ";
- Languages, as the table names them, with the other language written out;
- Account: "Not created", "Invited", "Active" or "Deactivated";
- Cleared: "Yes" or "No".

No roles or no certificates SHALL give an empty cell.

#### Scenario: Certificates with their dates
- **WHEN** a volunteer has IT&QR and Basic confirmed on 2026-11-03 New York time
- **THEN** their Certificates cell is "IT&QR (2026-11-03); Basic (2026-11-03)"

#### Scenario: A volunteer waiting for their form
- **WHEN** a volunteer has no roles and no certificates, and no account
- **THEN** their Roles and Certificates cells are empty, Account is "Not created", and Cleared is "No"

### Requirement: The Roster CSV opens safely in a spreadsheet
The CSV SHALL be UTF-8 with a byte-order mark, and its lines SHALL end with CR LF.

A field SHALL be quoted when it contains a double quote, comma, carriage return or line feed, and each double quote in it SHALL be doubled.

A cell whose text starts with `=`, `+`, `-`, `@`, a tab or a carriage return SHALL start with an apostrophe in the file. Phones are included.

#### Scenario: A Chinese name
- **WHEN** a volunteer is named 李小明 and the file is opened in Excel
- **THEN** the name shows as 李小明, because the file starts with a UTF-8 byte-order mark

#### Scenario: A cell that would be a formula
- **WHEN** a volunteer's name is "=HYPERLINK(1)" and their phone is "+1 555 0100"
- **THEN** the file holds "'=HYPERLINK(1)" and "'+1 555 0100"

#### Scenario: A comma and a quote
- **WHEN** a volunteer's other language is written `Tagalog, "Filipino"`
- **THEN** the Languages cell is quoted, and its quotes are doubled
