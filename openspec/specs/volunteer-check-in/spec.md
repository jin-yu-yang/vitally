# volunteer-check-in Specification

## Purpose
When volunteers actually worked. This spec covers:
- the check-in record: one person, one New York date, an exact check-in time and an optional check-out;
- who checks themselves in and out: cleared staff on this season's roster, from a strip at the top of every staff screen;
- how a check-in with no check-out is counted: to the latest end of that day's shifts, otherwise to the site's close hour, worked out when it is read and never written;
- how workspace admins correct check-ins, and the refusals that keep two check-ins of a person from overlapping;
- who reads check-ins (workspace admins, and each person their own), and how changes reach open windows.

The Schedule's bars and the correction drawer are in `volunteer-schedule`. Hours this week is in `volunteer-workload`.

## Requirements

### Requirement: A check-in records when a volunteer arrived and left
A check-in SHALL belong to one person, the workspace's current season and one date in America/New_York. That date SHALL be the New York date of its check-in time. It SHALL have a check-in time and MAY have a check-out time, both exact to the minute or finer. A check-out SHALL be after its check-in, on the same New York date, at the latest the following midnight. A person MAY have more than one check-in on a date. Two live check-ins of a person SHALL NOT overlap, although they MAY meet.

Removing a check-in SHALL mark it removed and raise its revision. A removed check-in SHALL appear in no read, no count and no hours, and SHALL NOT be changed again. Signed-in users SHALL have no direct write grant on check-ins.

#### Scenario: Two visits in a day
- **WHEN** a volunteer checks in at 10:02 am, checks out at 12:00 pm, and checks in again at 2:15 pm
- **THEN** they have two check-ins that day, and the second is open

#### Scenario: No direct write
- **WHEN** a signed-in workspace admin inserts, updates or deletes a row of the check-ins table directly
- **THEN** it is refused

### Requirement: Only a cleared staff member checks themselves in and out
`vitally_my_check_in()` SHALL take no arguments and answer only for the signed-in `staff` caller with:
- `today`: the New York date;
- `canCheckIn`: true when the caller is cleared (capability `volunteer-clearance`) and has a current-season roster entry;
- `open`: the caller's live check-in dated today with no check-out, as `checkInId` and `checkedInAt`, or null.

It SHALL NOT be gated by clearance.

`vitally_check_in(p_action_id)` SHALL add a check-in for the caller at the current time. `vitally_check_out(p_action_id)` SHALL set the current time as the check-out of the caller's open check-in today. Both SHALL refuse:
- with `FORBIDDEN`: a client, an anonymous caller, a staff caller with no person row, or a caller whose account is `invited`;
- with `NOT_CLEARED`: a staff caller who is not cleared, or who has no current-season roster entry.

Either refusal SHALL be given before any other check, SHALL write nothing and SHALL store no receipt.

Check in SHALL be refused with `VALIDATION` `ALREADY_CHECKED_IN` when the caller has an open check-in today. Check out SHALL be refused with `VALIDATION` `NOT_CHECKED_IN` when they have none. A repeated request with the same action id SHALL return the stored answer and write nothing more. Execute on all three SHALL be granted to `authenticated` only.

#### Scenario: Checking in
- **WHEN** a cleared preparer calls `vitally_check_in` at 9:52 am
- **THEN** a check-in at 9:52 am is saved, and `vitally_my_check_in` answers `open` with that time

#### Scenario: Not cleared
- **WHEN** a staff member on this season's roster with no roles calls `vitally_check_in`
- **THEN** it is refused with `NOT_CLEARED`, nothing is written, and no receipt is stored

#### Scenario: A double tap
- **WHEN** a volunteer's check-in is sent twice with the same action id
- **THEN** both answers are the same, and only one check-in exists

#### Scenario: Already checked in from another device
- **WHEN** a volunteer checked in on their phone, and then presses Check in on a laptop screen that was already open
- **THEN** it is refused with `VALIDATION` `ALREADY_CHECKED_IN`, and they still have one open check-in

#### Scenario: Checking out with nothing open
- **WHEN** a volunteer with no open check-in today calls `vitally_check_out`
- **THEN** it is refused with `VALIDATION` `NOT_CHECKED_IN`

#### Scenario: Yesterday's open check-in
- **WHEN** a volunteer checked in yesterday and never checked out, and calls `vitally_my_check_in` today
- **THEN** `open` is null, and `vitally_check_in` adds a new check-in for today

### Requirement: A check-in without a check-out counts to the day's end
A check-in's counted span SHALL run from its check-in time to its **end**, and its minutes SHALL be the whole minutes of that span, rounded down, never below 0. The **day's end** SHALL be the latest end hour of the person's live shifts on that date, of any role and whether tagged or not (capability `volunteer-schedule`). With no shift, it SHALL be that weekday's site close hour (capability `season-settings`). With neither, there SHALL be no day's end.

A check-in SHALL be in one of three states:
- **out**: it has a check-out. The end SHALL be the check-out.
- **open**: it has no check-out, and its date is today in New York. The end SHALL be the earlier of now and the day's end. With no day's end, it SHALL count 0 minutes.
- **missed**: it has no check-out, and its date is before today. The end SHALL be the day's end. With no day's end, it SHALL count 0 minutes.

An end before the check-in SHALL count 0 minutes. Nothing SHALL write a check-out on the volunteer's behalf. An admin's check-out (see below) SHALL replace a derived end.

#### Scenario: A missed check-out with a shift
- **WHEN** a volunteer with a Preparer shift from 10 to 1 on Saturday checked in at 9:55 am that Saturday and never checked out, and it is now Sunday
- **THEN** the check-in is missed, ends at 1 pm, and counts 185 minutes

#### Scenario: A missed check-out with no shift
- **WHEN** Tuesday's site hours are 5 pm to 8 pm, and a volunteer with no shift that Tuesday checked in at 5:30 pm and never checked out, and it is now Wednesday
- **THEN** the check-in ends at 8 pm and counts 150 minutes

#### Scenario: Checking in after the shift ended
- **WHEN** a volunteer's only shift that day ended at 1 pm, they checked in at 2:10 pm, never checked out, and the day has passed
- **THEN** the check-in counts 0 minutes and is still a missed check-out

#### Scenario: A closed day with no shift
- **WHEN** Mondays are closed, and a volunteer with no Monday shift checked in on a Monday and never checked out
- **THEN** the check-in counts 0 minutes

#### Scenario: Open today, capped
- **WHEN** a volunteer whose shift today ends at 8 pm checked in at 5 pm, has not checked out, and it is now 9:30 pm
- **THEN** the check-in counts 180 minutes

#### Scenario: Staying late and checking out
- **WHEN** that volunteer checks out at 8:40 pm
- **THEN** the check-in counts 220 minutes

### Requirement: Workspace admins correct check-ins
`vitally_save_check_in(p_action_id, p_check_in_id, p_expected_revision, p_check_in)` SHALL add a check-in when both ids are null and edit one when both are given. `vitally_remove_check_in(p_action_id, p_check_in_id, p_expected_revision)` SHALL remove one. Both SHALL be allowed for a workspace admin (capability `volunteer-roster`), cleared or not. Anyone else SHALL be refused with `FORBIDDEN` before any other check, and that refusal SHALL write nothing and store no receipt.

Each save and removal SHALL take an action id. A repeated request with the same action id SHALL return the stored answer and write nothing more. Each SHALL be sent at the revision the screen read, and a stale revision SHALL be refused with `CONFLICT`.

`p_check_in` SHALL hold `checkedIn` and `checkedOut` as New York `HH:MM` times on the check-in's date. `checkedOut` MAY be null, and MAY be `24:00`. An add SHALL also hold `volunteerId` and `date`. An edit SHALL keep the check-in's person and date. Every save SHALL mark the check-in corrected by the admin who saved it. A volunteer's own check-in and check-out SHALL NOT mark it corrected. The original times SHALL NOT be kept.

A save SHALL be refused with `VALIDATION` and one of these reasons:
- `NOT_ON_ROSTER`: the person has no roster entry for the current season;
- `DEACTIVATED`: the person's account is deactivated;
- `OUT_BEFORE_IN`: the check-out is not after the check-in;
- `IN_FUTURE`: the check-in, or a given check-out, is later than now;
- `OVERLAP`: its span overlaps another live check-in of the person that day. Each span runs from its check-in to its end, as counted above, except that for this check a check-in dated today with no check-out runs on with no end, the one being saved included. Spans MAY meet.

A check-in outside site hours, on a closed day, with no shift, or for a person who is not cleared or has no sign-in SHALL be allowed.

#### Scenario: Fixing a missed check-out
- **WHEN** an admin edits yesterday's missed check-out of a volunteer and sets its check-out to 12:30 pm
- **THEN** it is saved as out at 12:30 pm, it is marked corrected by that admin, and it counts to 12:30 pm

#### Scenario: Reopening a check-in
- **WHEN** an admin clears the check-out of a check-in dated today
- **THEN** it is open again, and the volunteer's strip shows Check out

#### Scenario: Adding a forgotten check-in
- **WHEN** an admin adds a check-in for a volunteer for yesterday from 10:00 to 13:00
- **THEN** it is saved, counts 180 minutes, and is marked corrected

#### Scenario: Out before in
- **WHEN** an admin saves a check-in from 14:00 to 13:30
- **THEN** it is refused with `VALIDATION` `OUT_BEFORE_IN`, and nothing changes

#### Scenario: Future times
- **WHEN** at 11:00 am an admin adds a check-in for today from 10:00 to 12:00
- **THEN** it is refused with `VALIDATION` `IN_FUTURE`

#### Scenario: Overlap
- **WHEN** a volunteer has a check-in from 10:00 to 12:00 on a date, and an admin adds one from 11:30 to 13:00 and then one from 12:00 to 13:00 for them on that date
- **THEN** the first is refused with `VALIDATION` `OVERLAP`, and the second is saved

#### Scenario: Adding beside an open check-in
- **WHEN** at 3:00 pm a volunteer has been checked in since 10:00 am today with a shift that ended at 1 pm, and an admin adds a check-in for them today from 2:00 pm to 2:30 pm
- **THEN** it is refused with `VALIDATION` `OVERLAP`, and the volunteer still has one open check-in

#### Scenario: Reopening before a later check-in
- **WHEN** a volunteer has check-ins today from 10:00 to 12:00 and from 1:00 pm to 2:00 pm, and an admin clears the check-out of the 10:00 one
- **THEN** it is refused with `VALIDATION` `OVERLAP`, and nothing changes

#### Scenario: A preparer
- **WHEN** a cleared staff member whose only role is Preparer calls `vitally_save_check_in`
- **THEN** it is refused with `FORBIDDEN`, nothing is written, and no receipt is stored

#### Scenario: Two admins
- **WHEN** two admins open the same check-in at revision 2, the first changes its check-out, and the second then sends a change at revision 2
- **THEN** the second is refused with `CONFLICT`, and the check-in keeps the first admin's change

#### Scenario: Removing
- **WHEN** an admin removes a check-in at its current revision
- **THEN** it no longer appears on the Schedule or in the hours, and a later change to it is refused

### Requirement: Only admins and the person read check-ins
A workspace admin SHALL be able to read every check-in of the workspace. A staff member SHALL be able to read only their own check-ins. No one else SHALL read any check-in, by any read or realtime message. Check-ins SHALL be delivered by realtime under these rules.

#### Scenario: A preparer reads the table
- **WHEN** a cleared preparer reads the check-ins table directly in a workspace where several volunteers checked in today
- **THEN** only the preparer's own check-ins are returned

#### Scenario: A client
- **WHEN** a client calls `vitally_my_check_in` or reads the check-ins table
- **THEN** the call is refused with `FORBIDDEN`, and the read returns nothing

### Requirement: Cleared staff windows show a check-in strip
Every staff screen in a cleared window SHALL show a strip at the top of the main area, above the page title, when `canCheckIn` is true. The strip SHALL be outside the sidebar, so collapsing the sidebar does not hide it. It SHALL read:
- with no open check-in today, a "Check in" button;
- with one, "Checked in since <time>" (for example "Checked in since 9:52 am", New York time) and a "Check out" button.

Pressing either button SHALL send its request at once, without asking first. The button SHALL be busy until the answer. A refusal with `ALREADY_CHECKED_IN` or `NOT_CHECKED_IN` SHALL re-read the caller's check-in state and redraw, with no error message.

The strip SHALL re-read:
- on sign-in and window restore;
- when the window regains focus;
- when one of the caller's own check-ins changes in another window or device;
- when a clearance re-read changes whether the caller is cleared.

An uncleared window, the setup screen and client screens SHALL have no strip. At 390 px wide the strip SHALL cause no sideways scroll, and its button SHALL be at least 44 px tall. Staff screens SHALL be English only.

#### Scenario: Checking in from a phone
- **WHEN** a cleared preparer opens ViTally on a 390 px screen with the sidebar collapsed, and presses Check in at 9:52 am
- **THEN** the strip reads "Checked in since 9:52 am" with a Check out button, and the page has no sideways scroll

#### Scenario: Another device
- **WHEN** a volunteer has ViTally open on a laptop and checks in on their phone
- **THEN** the laptop's strip shows "Checked in since …" and Check out without a reload

#### Scenario: Checking out
- **WHEN** a checked-in volunteer presses Check out
- **THEN** no confirmation is asked, and the strip shows Check in again

#### Scenario: An uncleared volunteer
- **WHEN** a staff member who is not cleared signs in and sees the setup screen
- **THEN** there is no check-in strip
