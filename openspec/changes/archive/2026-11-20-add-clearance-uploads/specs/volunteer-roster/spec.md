## ADDED Requirements

### Requirement: An admin marks a sent document reviewed
`vitally_mark_upload_reviewed(p_action_id, p_volunteer_id, p_expected_revision, p_document)` SHALL clear the Form 13615 (`form13615`) or photo ID (`photoId`) sent date on the volunteer's current-season roster entry. It SHALL be allowed for a workspace admin, cleared or not. Clearing a set date SHALL raise the volunteer's revision. When nothing is waiting, the call SHALL succeed and change nothing. A repeated action id SHALL return the stored result.

#### Scenario: Mark reviewed on a Form 13615
- **WHEN** a volunteer has marked their Form 13615 as sent, and an admin marks it reviewed
- **THEN** the Form 13615 sent date is cleared, and the volunteer's roles and certificates are unchanged

#### Scenario: Nothing waiting
- **WHEN** a second admin presses Mark reviewed for a document another admin already marked reviewed, after re-reading
- **THEN** it succeeds, and nothing changes

### Requirement: Mark reviewed is refused when it does not apply
`vitally_mark_upload_reviewed` SHALL refuse anyone who is not a workspace admin with `FORBIDDEN` before any other check. It SHALL refuse a malformed call with `VALIDATION`, an unknown volunteer with `NOT_FOUND`, and a stale revision with `CONFLICT`. A refusal SHALL write nothing and store no receipt.

#### Scenario: A non-admin
- **WHEN** a staff member who is not a workspace admin calls it
- **THEN** it is refused with `FORBIDDEN`, nothing changes, and no receipt is stored

#### Scenario: A stale revision
- **WHEN** an admin calls it with a revision someone else's save has since raised
- **THEN** it is refused with `CONFLICT`, and the sent date stays

### Requirement: The Edit drawer shows what was sent, with Mark reviewed
While editing a volunteer, the Edit drawer SHALL show "Form 13615 sent <date>" and "Photo ID sent <date>" for each document that is waiting, each with a Mark reviewed button. The admin uses it when the file was wrong or adds nothing, and tells the volunteer why outside ViTally. After Mark reviewed, the drawer SHALL keep the admin's unsaved edits and the new revision, and the line SHALL go.

#### Scenario: Mark reviewed on a photo ID
- **WHEN** a new volunteer has marked their photo ID as sent, and an admin opens Edit and presses Mark reviewed beside "Photo ID sent <date>"
- **THEN** the photo ID sent date is cleared, the line goes, and the volunteer is no longer listed under Uploads to review

#### Scenario: Unsaved edits survive
- **WHEN** an admin changes a volunteer's phone in the drawer, presses Mark reviewed, and then saves
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

## MODIFIED Requirements

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
