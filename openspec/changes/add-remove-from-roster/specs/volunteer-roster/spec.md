## ADDED Requirements

### Requirement: An admin can remove a volunteer from this season's roster
`vitally_remove_from_roster` SHALL take an action id, the volunteer and the profile revision the drawer read. When nothing refuses it, it SHALL, in one transaction:
- delete the volunteer's current-season roster entry, and with it that season's certificates and the Form 13615 and photo ID sent and reviewed fields;
- keep the person, their profile (including usual days), their roster entries and certificates of earlier seasons, and every case, follow-up, contact and help request that names them;
- deactivate their account as Deactivate does (capability `sign-in-accounts`) when it is `invited` or `active` and not a site coordinator's; delete only the entry when there is no account or it is already `deactivated`;
- raise the profile's revision;
- record the removal (see the record requirement below);
- store the result as the action's receipt, with the volunteer, the new profile revision and whether the account was deactivated.

Earlier seasons' rosters SHALL be unchanged. Only the current season's entry SHALL be removed.

#### Scenario: Removing a volunteer with an active account
- **WHEN** the season is 2026, and an admin removes Nadia Kerr, a Preparer with confirmed VSC, IT&QR and Basic, an active account, a sent Form 13615 and no open work
- **THEN** Nadia Kerr has no 2026 roster entry and no 2026 certificates, her account is `deactivated`, her membership is inactive, her profile revision is one higher, and her person, profile and usual days remain

#### Scenario: Removing a volunteer with no account
- **WHEN** an admin removes a volunteer whose account was never created
- **THEN** their current-season roster entry is deleted, and no account or membership is created or changed

#### Scenario: Removing a volunteer whose account is already deactivated
- **WHEN** an admin removes a volunteer whose account is `deactivated`
- **THEN** their current-season roster entry is deleted and the account is unchanged

#### Scenario: Removing an invited volunteer
- **WHEN** an admin removes a volunteer whose account is `invited`
- **THEN** the account is `deactivated`, not cancelled, and the email stays linked to the person

#### Scenario: Earlier seasons are kept
- **WHEN** a volunteer has a 2025 roster entry with certificates and is removed from the 2026 roster
- **THEN** their 2025 entry and certificates are unchanged

#### Scenario: Case history is kept
- **WHEN** a volunteer who prepared a Closed case this season is removed
- **THEN** the case still names them as its preparer

#### Scenario: Retrying the same removal
- **WHEN** the same removal is sent twice with the same action id
- **THEN** both calls return the same result, and one removal is recorded

### Requirement: Removing a volunteer is refused when it does not apply
`vitally_remove_from_roster` SHALL refuse, changing nothing:
- with `FORBIDDEN` (VT001) a caller who is not a workspace admin, with no receipt stored;
- with `ADMIN_ROLE` (VT001) a caller who is not a site coordinator when the volunteer holds the Admin role this season, with no receipt stored;
- with `VALIDATION` (VT007) a missing argument, and with `VALIDATION` (`SELF`) the caller's own row;
- with `NOT_FOUND` (VT002) a volunteer with no profile in the caller's workspace or no current-season roster entry;
- with `CONFLICT` (VT003) a profile revision other than the stored one;
- with `FORBIDDEN` (VT001) a caller who is not a site coordinator when the volunteer is a site coordinator (capability `site-coordinators`);
- with `OPEN_WORK` (VT004), the open work as its detail, while the volunteer holds open work as listed for Deactivate: a current-season case (or one with no season) in any stage except closed, Accepted included, as preparer or reviewer; an open follow-up; a claimed help request; or being the default follow-up person.

A repeated action id SHALL return the stored result before the revision is compared, so a retry after a lost reply is not a `CONFLICT`.

#### Scenario: A volunteer with open work
- **WHEN** an admin removes a volunteer who is preparing an open case this season
- **THEN** it is refused with `OPEN_WORK` listing that case, and the roster entry, certificates and account are unchanged

#### Scenario: An Accepted case this season is open work
- **WHEN** an admin removes a volunteer who prepared a case this season that is now Accepted
- **THEN** it is refused with `OPEN_WORK` listing "preparing client <n>", and the roster entry, certificates and account are unchanged

#### Scenario: The default follow-up person
- **WHEN** an admin removes the default follow-up person
- **THEN** it is refused with `OPEN_WORK` listing being the default follow-up person

#### Scenario: A person with the Admin role
- **WHEN** an admin who is not a site coordinator removes a volunteer who holds the Admin role this season
- **THEN** it is refused with `ADMIN_ROLE`, and nothing is changed

#### Scenario: A site coordinator removes a person with the Admin role
- **WHEN** a site coordinator removes a volunteer who holds the Admin role this season and has no open work
- **THEN** the volunteer is removed and their account is deactivated

#### Scenario: Removing yourself
- **WHEN** an admin removes their own row
- **THEN** it is refused with `VALIDATION`

#### Scenario: Not an admin
- **WHEN** a preparer without the Admin role calls `vitally_remove_from_roster`
- **THEN** it is refused with `FORBIDDEN`

#### Scenario: A stale drawer
- **WHEN** two admins open the same volunteer, one saves an edit, and the other then removes with the revision it read
- **THEN** the removal is refused with `CONFLICT`

#### Scenario: Already removed
- **WHEN** an admin removes a volunteer who was removed from the current season in another window
- **THEN** it is refused with `CONFLICT` if the revision it sends is stale, and otherwise with `NOT_FOUND`

### Requirement: A save from a stale drawer does not put a removed volunteer back
Because removal raises the profile revision, a `vitally_save_volunteer` sent with the revision read before the removal SHALL be refused with `CONFLICT` and SHALL NOT create a current-season roster entry.

#### Scenario: A second admin's open drawer
- **WHEN** two admins open Nadia Kerr's drawer, one removes her, and the other then saves an edit
- **THEN** the save is refused with `CONFLICT`, and Nadia Kerr has no current-season roster entry

### Requirement: Removal and Deactivate in two windows never conflict on the account's state
When a removal and a Deactivate of the same volunteer are sent from two windows, the second SHALL either succeed or be refused with `CONFLICT`. Neither SHALL be refused with `INVALID_TRANSITION`.

#### Scenario: Deactivate first
- **WHEN** one admin deactivates a volunteer and another then removes them with the profile revision read before
- **THEN** the removal succeeds, the account stays `deactivated`, and the removal records that it did not deactivate the account

#### Scenario: Remove first
- **WHEN** one admin removes a volunteer and another then deactivates them with the account revision read before
- **THEN** the Deactivate is refused with `CONFLICT`

### Requirement: Every removal from the roster is recorded
Each removal SHALL record one row: the workspace, the season, the person removed, the person who removed them, when, whether the account was deactivated, and how many shifts it removed. Signed-in users SHALL have no direct read or write grant on these records, and no screen SHALL show them.

#### Scenario: A removal is recorded
- **WHEN** an admin removes a volunteer whose account is active
- **THEN** one record names the season, the volunteer, the admin and the time, with the account deactivated

#### Scenario: No direct access
- **WHEN** a signed-in admin selects from the removal records
- **THEN** the read is refused, and an insert, update or delete is refused too

### Requirement: Removing a volunteer removes their shifts from today on
A removal SHALL, in the same transaction, mark as removed each live current-season shift (capability `volunteer-schedule`) of the person dated today or later, today being the America/New_York date, as Remove shift does: revision raised, the remover and time recorded. Earlier shifts SHALL stay. Other people's shifts and shifts already removed SHALL NOT change. The answer SHALL say how many were removed.

#### Scenario: Today's and later shifts go
- **WHEN** an admin removes a volunteer with shifts yesterday, today and next week
- **THEN** today's and next week's shifts are removed with their revisions raised, yesterday's stays, and the answer says two shifts were removed

#### Scenario: Other shifts are untouched
- **WHEN** the removed volunteer also has a shift already removed, and another volunteer has a shift tomorrow
- **THEN** neither shift changes

#### Scenario: A refused removal keeps the shifts
- **WHEN** an admin tries to remove a volunteer who has a shift tomorrow and is preparing an open case
- **THEN** the removal is refused with `OPEN_WORK`, and the shift is unchanged

#### Scenario: A replay removes nothing more
- **WHEN** the same removal is sent again with the same action id, after a new shift was added for the person
- **THEN** the stored answer is returned and the new shift is not removed

#### Scenario: An open Schedule follows
- **WHEN** another admin has the Schedule open on a day the removed volunteer had a shift
- **THEN** the shift leaves that Schedule without a reload

### Requirement: The Edit drawer offers removal, after a confirmation
The Edit drawer of a saved volunteer SHALL offer "Remove from this season's roster…". On the caller's own drawer it SHALL say "You can't remove yourself from the roster." instead, whatever the caller's role. For a caller who is not a site coordinator, on someone else's drawer:
- on a site coordinator's drawer it SHALL say "Only site coordinators remove a site coordinator from the roster." instead;
- on the drawer of someone with the Admin role this season it SHALL say the Admin role sentence the drawer already uses instead.

The button SHALL open a confirmation titled "Remove <name> from this season's roster?". The confirmation SHALL say, in this order:
- "<name> (<email>) comes off this season's roster, with their roles, certificates and the record of what they sent this season."
- One account line, depending on the account:
  - for an `invited` or `active` account that is not a site coordinator's: "Their account is deactivated, so they can no longer sign in.";
  - for a site coordinator: "Their account stays active because they are a site coordinator, but they will have no roles this season.";
  - for a `deactivated` account: "Their account is already deactivated.";
  - with no account: no account line.
- When the Roster's read shows the volunteer has a live shift this season from today on: "Their shifts from today on are removed from the Schedule." With none, no shifts line.
- "Their cases and contact details are kept. To add them back, search for <email> in Add a volunteer."

Its buttons SHALL be "Remove from roster" and "Cancel". Nothing SHALL be sent until "Remove from roster" is pressed.

A refusal SHALL keep the confirmation open with its sentence: `OPEN_WORK` as "<name> still has open work: <list>. Finish it or hand it over first.", `ADMIN_ROLE` with the Admin role sentence, and `FORBIDDEN` for a site coordinator with the sentence above. A `CONFLICT` or an unreadable refusal SHALL be the banner's message, and the list SHALL be read again. On success the confirmation and the drawer SHALL close, and the Roster SHALL no longer list the volunteer. An answer that never came SHALL be kept, so pressing again sends the same action id.

#### Scenario: Your own drawer
- **WHEN** an admin opens their own drawer
- **THEN** it offers no removal and says "You can't remove yourself from the roster."

#### Scenario: The confirmation for an active account
- **WHEN** an admin opens Nadia Kerr's drawer, whose account is active, and presses "Remove from this season's roster…"
- **THEN** the confirmation names Nadia Kerr and her email, says her account is deactivated, says how to add her back by her email, and nothing has been sent

#### Scenario: Removing from the confirmation
- **WHEN** the admin presses "Remove from roster"
- **THEN** the confirmation and drawer close, and the Roster no longer lists Nadia Kerr

#### Scenario: Cancel
- **WHEN** the admin presses "Cancel" in the confirmation
- **THEN** nothing is sent, and the drawer is shown again

#### Scenario: Refused for open work
- **WHEN** the admin confirms the removal of a volunteer who is reviewing an open case
- **THEN** the confirmation stays open and says "<name> still has open work: reviewing client <n>. Finish it or hand it over first."

#### Scenario: A site coordinator's drawer, for an admin who isn't one
- **WHEN** an admin who is not a site coordinator opens a site coordinator's drawer
- **THEN** it offers no removal and says "Only site coordinators remove a site coordinator from the roster."

#### Scenario: The confirmation for a volunteer with shifts
- **WHEN** an admin opens the confirmation for a volunteer who has a shift tomorrow
- **THEN** it says "Their shifts from today on are removed from the Schedule." before the line about cases and contact details, and for a volunteer with no shifts from today on it says nothing about shifts

#### Scenario: The confirmation for a site coordinator
- **WHEN** a site coordinator opens another site coordinator's drawer and presses "Remove from this season's roster…"
- **THEN** the confirmation says their account stays active because they are a site coordinator, but they will have no roles this season

### Requirement: A removed volunteer can be added back through Add a volunteer
A removed volunteer SHALL be offered by Add a volunteer's returning-volunteer search as any person with a profile and no current-season roster entry is: in the list when they were on last season's roster, and otherwise when their full email is typed, labelled "Earlier volunteer". Saving them SHALL add them to the current roster as for any returning volunteer, with no roles or certificates carried over from before the removal. Their account SHALL stay as it was until an admin reactivates it.

#### Scenario: Adding back by email
- **WHEN** a volunteer added this season for the first time is removed, and an admin then types their full email into the search box
- **THEN** they are offered, labelled "Earlier volunteer", and saving them adds a current-season entry with no roles, while their account stays `deactivated`

### Requirement: After re-adding someone whose account is deactivated, the drawer points to Reactivate
When a save of a picked earlier volunteer succeeds and their account is `deactivated`, the drawer SHALL stay open on that volunteer's Edit view, and its Account section SHALL show the notice "<name> is back on this season's roster. Their account is deactivated. Reactivate it so they can sign in." Every other successful save SHALL close the drawer as before.

When the drawer of a volunteer on the current roster with a `deactivated` account is shown without that notice, the Account section SHALL show "Reactivate so they can sign in." under Reactivate. The notice and the note SHALL NOT be shown together. Nothing SHALL be reactivated automatically.

#### Scenario: Right after the re-add
- **WHEN** an admin picks Nadia Kerr, whose account is deactivated, in Add a volunteer and saves
- **THEN** the drawer stays open on Nadia Kerr with "Nadia Kerr is back on this season's roster. Their account is deactivated. Reactivate it so they can sign in.", the Reactivate button, and not the short note

#### Scenario: Opening the drawer later
- **WHEN** an admin later opens Nadia Kerr's drawer while her account is still deactivated
- **THEN** the Account section shows "Reactivate so they can sign in." under Reactivate, and not the notice

#### Scenario: A re-add whose account is not deactivated
- **WHEN** an admin picks an earlier volunteer with no account and saves
- **THEN** the drawer closes as for any save

### Requirement: Another admin's open Roster learns of a removal when it is read again
A removal SHALL NOT be pushed to other open Roster windows. Another admin's Roster SHALL show the removal the next time the Roster is opened or the page is loaded. An action that admin takes on the removed volunteer SHALL be refused (`CONFLICT` for a save, `CONFLICT` or `NOT_FOUND` for a removal) and SHALL read the list again.

#### Scenario: A stale Roster
- **WHEN** one admin removes a volunteer while another admin has the Roster open, and the second admin opens the Roster again
- **THEN** the second admin's Roster no longer lists the volunteer
