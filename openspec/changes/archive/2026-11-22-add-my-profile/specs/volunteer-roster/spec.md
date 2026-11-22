## MODIFIED Requirements

### Requirement: An admin marks a sent document reviewed
`vitally_mark_upload_reviewed(p_action_id, p_volunteer_id, p_expected_revision, p_document, p_reason)` SHALL clear the Form 13615 (`form13615`) or photo ID (`photoId`) sent date on the volunteer's current-season roster entry, and SHALL record on that entry the time of the call and the reason, trimmed, as that document's reviewed time and review reason. It SHALL be allowed for a workspace admin, cleared or not. Clearing a set date SHALL raise the volunteer's revision. When nothing is waiting, the call SHALL succeed and change nothing, the reason included. A repeated action id SHALL return the stored result. There SHALL be no form of the function without a reason.

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

## ADDED Requirements

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
