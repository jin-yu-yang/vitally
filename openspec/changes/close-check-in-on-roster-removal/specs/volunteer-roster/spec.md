## ADDED Requirements

### Requirement: Removing a volunteer checks out their open check-in from today
A removal SHALL, in the same transaction, check out the person's live check-ins (capability `volunteer-check-in`) dated today (America/New_York) that have no check-out. The check-out SHALL be the removal time, or the earliest time after the check-in when both fall in the same instant. Each SHALL be marked corrected by the remover, with its revision, update time and updater set as for an admin's save. No other check-in SHALL change.

#### Scenario: Removed while checked in
- **WHEN** Nadia Kerr checked in at 10:02 am today and has not checked out, and an admin removes her at 11:30 am
- **THEN** her check-in has a check-out at 11:30 am, is marked corrected by that admin, has its revision raised by one, and she has no open check-in

#### Scenario: An earlier day's open check-in is untouched
- **WHEN** a volunteer checked in yesterday and never checked out, has not checked in today, and is removed
- **THEN** yesterday's check-in still has no check-out, keeps its revision, and is not marked corrected

#### Scenario: Not checked in
- **WHEN** a volunteer checked in and out earlier today and is then removed
- **THEN** that check-in keeps its check-out and revision, is not marked corrected, and the removal records that no check-in was closed

#### Scenario: Removed in the same instant as the check-in
- **WHEN** a removal runs at the same instant as the volunteer's check-in today
- **THEN** the removal succeeds, and the check-in's check-out is later than its check-in on the same date

#### Scenario: A refused removal keeps the check-in open
- **WHEN** an admin tries to remove a volunteer who is checked in and is preparing an open case
- **THEN** the removal is refused with `OPEN_WORK`, and the check-in is still open and unchanged

#### Scenario: Another volunteer's check-in is untouched
- **WHEN** another volunteer is checked in today while an admin removes Nadia Kerr
- **THEN** the other volunteer's check-in is still open and unchanged

## MODIFIED Requirements

### Requirement: Removing a volunteer is refused when it does not apply
`vitally_remove_from_roster` SHALL refuse, changing nothing:
- with `FORBIDDEN` (VT001) a caller who is not a workspace admin, with no receipt stored;
- with `ADMIN_ROLE` (VT001) a caller who is not a site coordinator when the volunteer holds the Admin role this season, with no receipt stored;
- with `VALIDATION` (VT007) a missing argument, and with `VALIDATION` (`SELF`) the caller's own row;
- with `NOT_FOUND` (VT002) a volunteer with no profile in the caller's workspace or no current-season roster entry;
- with `CONFLICT` (VT003) a profile revision other than the stored one;
- with `FORBIDDEN` (VT001) a caller who is not a site coordinator when the volunteer is a site coordinator (capability `site-coordinators`);
- with `OPEN_WORK` (VT004), the open work as its detail, while the volunteer holds open work as listed for Deactivate: a current-season case (or one with no season) in any stage except closed, Accepted included, as preparer or reviewer; an open follow-up; a claimed help request; or being the default follow-up person.

A repeated action id SHALL return the stored result before the Admin role is checked and before the revision is compared. A retry after a lost reply is then neither `ADMIN_ROLE` nor `CONFLICT`, even if the volunteer has gained the Admin role since.

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

#### Scenario: A replay after the volunteer gained the Admin role
- **WHEN** an admin who is not a site coordinator removes a volunteer with no Admin role, a site coordinator then adds the volunteer back to this season's roster with the Admin role, and the first admin repeats the removal with the same action id
- **THEN** the repeat returns the first removal's stored result, not `ADMIN_ROLE`, and the volunteer's new roster entry is unchanged

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

### Requirement: Every removal from the roster is recorded
Each removal SHALL record one row with these facts:
- the workspace and the season;
- the person removed, the person who removed them, and when;
- whether the account was deactivated;
- how many shifts it removed;
- whether it checked out a check-in.

Signed-in users SHALL have no direct read or write grant on these records, and no screen SHALL show them.

#### Scenario: A removal is recorded
- **WHEN** an admin removes a volunteer whose account is active
- **THEN** one record names the season, the volunteer, the admin and the time, with the account deactivated

#### Scenario: A removal that checked out a check-in is recorded
- **WHEN** an admin removes a volunteer who is checked in today
- **THEN** the record says a check-in was checked out, and for a volunteer who was not checked in it says none was

#### Scenario: No direct access
- **WHEN** a signed-in admin selects from the removal records
- **THEN** the read is refused, and an insert, update or delete is refused too

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
- Always: "If they are checked in now, they are checked out at this moment."
- "Their cases and contact details are kept. To add them back, search for <email> in Add a volunteer."

Its buttons SHALL be "Remove from roster" and "Cancel". Nothing SHALL be sent until "Remove from roster" is pressed.

A refusal SHALL keep the confirmation open with its sentence:
- `OPEN_WORK` as "<name> still has open work: <list>. Finish it or hand it over first.";
- `ADMIN_ROLE` with the Admin role sentence;
- `FORBIDDEN` for a site coordinator with the sentence above.

A `CONFLICT` or an unreadable refusal SHALL be the banner's message, and the list SHALL be read again. On success the confirmation and the drawer SHALL close, and the Roster SHALL no longer list the volunteer. An answer that never came SHALL be kept, so pressing again sends the same action id.

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
- **THEN** it says "Their shifts from today on are removed from the Schedule." before the check-in line, and for a volunteer with no shifts from today on it says nothing about shifts

#### Scenario: The check-in line is always shown
- **WHEN** an admin opens the confirmation for any volunteer, with or without shifts and whatever their account
- **THEN** it says "If they are checked in now, they are checked out at this moment." before the line about cases and contact details

#### Scenario: The confirmation for a site coordinator
- **WHEN** a site coordinator opens another site coordinator's drawer and presses "Remove from this season's roster…"
- **THEN** the confirmation says their account stays active because they are a site coordinator, but they will have no roles this season
