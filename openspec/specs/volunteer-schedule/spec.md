# volunteer-schedule Specification

## Purpose
The hourly volunteer Schedule for a workspace. It covers:
- shifts: one volunteer, one date, whole hours inside site hours, and one role the volunteer holds this season;
- who changes shifts (workspace admins, by drag or by buttons) and who reads them (every rostered staff member with an active account, read-only for non-admins, with no-sign-in volunteers' shifts hidden from them);
- the one-day view and its coverage row, which counts cleared volunteers by role against the site's targets;
- the usual-days hint in Add shift, which reads the volunteer profile's usual days;
- "Your shifts this week" on My profile, through `vitally_my_shifts()`;
- how open screens follow changes live and on focus.

Site hours and targets live in Season settings (capability `season-settings`), and the Workload's hours in `volunteer-workload`.

## Requirements

### Requirement: A shift is one role over whole hours inside site hours
A shift SHALL belong to one volunteer, one date and the workspace's current season. It SHALL have a start hour and an end hour, whole hours with 0 ≤ start < end ≤ 24 in America/New_York time. It SHALL have one role from Greeter, Intaker, Preparer, Reviewer and Admin. A shift SHALL NOT cross midnight.

A new shift, or a change to a shift's hours or role, SHALL be refused with `VALIDATION` and one of these reasons:
- `NOT_ON_ROSTER`: the volunteer has no roster entry for the current season;
- `DEACTIVATED`: the volunteer's account is deactivated;
- `ROLE_NOT_HELD`: the role is not one of the volunteer's current-season roles;
- `SITE_CLOSED`: the date's weekday is closed in site hours (capability `season-settings`);
- `OUTSIDE_SITE_HOURS`: the start is before that weekday's open hour, or the end is after its close hour;
- `OVERLAP`: the volunteer already has a shift on that date whose hours overlap. Two shifts SHALL be allowed to meet, one ending at the hour the other starts.

A volunteer MAY have more than one shift on a date. An edit SHALL keep the shift's volunteer. A volunteer with no sign-in MAY be given a shift.

#### Scenario: A valid shift
- **WHEN** Saturday's site hours are 10 am to 4 pm, and an admin adds a Preparer shift from 10 to 1 for a volunteer who holds Preparer this season
- **THEN** the shift is saved with revision 1

#### Scenario: A role the volunteer doesn't hold
- **WHEN** an admin adds a Reviewer shift for a volunteer whose only role is Preparer
- **THEN** it is refused with `VALIDATION` `ROLE_NOT_HELD`, and nothing is saved

#### Scenario: Outside site hours
- **WHEN** Saturday's hours are 10 am to 4 pm, and an admin adds a shift from 9 to 12 on a Saturday
- **THEN** it is refused with `VALIDATION` `OUTSIDE_SITE_HOURS`

#### Scenario: A closed day
- **WHEN** Mondays are closed, and an admin adds a shift on a Monday
- **THEN** it is refused with `VALIDATION` `SITE_CLOSED`

#### Scenario: Overlap and adjacent shifts
- **WHEN** a volunteer has a shift from 10 to 1 on a date, and an admin adds one from 12 to 3 and then one from 1 to 3 for them on that date
- **THEN** the first is refused with `VALIDATION` `OVERLAP`, and the second is saved

#### Scenario: A deactivated volunteer
- **WHEN** an admin adds a shift for a volunteer whose account is deactivated
- **THEN** it is refused with `VALIDATION` `DEACTIVATED`

### Requirement: Only a workspace admin changes shifts
Saving and removing a shift SHALL be allowed for a workspace admin (capability `volunteer-roster`), cleared or not. Anyone else SHALL be refused with `FORBIDDEN` before any other check, and the refusal SHALL write nothing and store no receipt. Each save and removal SHALL take an action id. A repeated request with the same action id SHALL return the stored answer and write nothing more.

Each change SHALL be sent at the revision the screen read. A stale revision SHALL be refused with `CONFLICT`. Removing a shift SHALL mark it removed and raise its revision. A removed shift SHALL appear in no read and no count, and SHALL NOT be changed again. Signed-in users SHALL have no direct write grant on shifts.

#### Scenario: A preparer
- **WHEN** a cleared staff member whose only role is Preparer calls the shift save
- **THEN** it is refused with `FORBIDDEN`, nothing is written, and no receipt is stored

#### Scenario: An uncleared site coordinator
- **WHEN** a site coordinator with no current-season roles adds a shift
- **THEN** the shift is saved

#### Scenario: Two admins
- **WHEN** two admins open the same shift at revision 1, the first changes its end hour, and the second then sends a role change at revision 1
- **THEN** the second is refused with `CONFLICT`, and the shift keeps the first admin's change

#### Scenario: A repeated save
- **WHEN** an admin's shift save is sent twice with the same action id
- **THEN** both answers are the same, and only one shift exists

#### Scenario: Removing a shift
- **WHEN** an admin removes a shift at its current revision
- **THEN** it no longer appears on the Schedule, on My profile or in the Workload hours, and a later change to it is refused

#### Scenario: No direct write
- **WHEN** a signed-in workspace admin inserts, updates or deletes a row of the shifts table directly
- **THEN** it is refused

### Requirement: Rostered staff open the Schedule
A **schedule viewer** SHALL be either of these:
- a workspace admin;
- a staff member with an active account on an active staff membership and a roster entry for the current season, cleared or not, and whatever their roles.

`vitally_my_clearance` SHALL say whether the caller is a schedule viewer (capability `volunteer-clearance`). Every schedule viewer SHALL see a "Schedule" link in the staff sidebar, the setup screen's sidebar included. For workspace admins, Schedule SHALL follow Volunteers. For other staff, it SHALL follow the Work board. My profile is not part of this capability: it SHALL stay the sidebar account row's link for cleared windows only (capability `my-profile`).

The schedule day read SHALL be refused with `FORBIDDEN` for anyone who is not a schedule viewer. A window left on the Schedule by someone who is not a schedule viewer SHALL get their home screen and no schedule data.

#### Scenario: A cleared preparer
- **WHEN** a cleared preparer on this season's roster signs in
- **THEN** the sidebar shows Work board, Schedule and Notifications, and its account row is the My profile link

#### Scenario: An uncleared volunteer
- **WHEN** a staff member with a current-season roster entry and no roles signs in
- **THEN** the setup screen's sidebar shows Schedule, the Schedule opens read-only, and there is no My profile

#### Scenario: Not on the roster
- **WHEN** a staff member with an active account and no current-season roster entry, who is not a workspace admin, signs in or restores a window saved on the Schedule
- **THEN** there is no Schedule link, they get their home screen, and the schedule day read is refused with `FORBIDDEN`

#### Scenario: A client
- **WHEN** a client calls the schedule day read
- **THEN** it is refused with `FORBIDDEN`

### Requirement: Non-admins see names, roles and hours only
For a schedule viewer who is not a workspace admin, the schedule day read and the realtime feed of shifts SHALL give each shift only its volunteer's name, its role, its date, its hours and its revision. They SHALL NOT give another volunteer's usual days, Works, email, phone, clearance, flags or check-ins (capability `volunteer-check-in`).

Shifts of a volunteer with no sign-in SHALL NOT be returned or delivered to them at all, by any read or realtime message. The read-only Schedule SHALL have no coverage row, no Add shift, no Add check-in, no check-ins and no drag, and its shifts SHALL open no drawer.

#### Scenario: The read-only Schedule
- **WHEN** a cleared preparer opens the Schedule on a Saturday with four shifts by volunteers with sign-ins
- **THEN** each row shows the volunteer's name and each shift its role and hours, with no tags, no check-ins, no coverage row and no Add shift

#### Scenario: A volunteer with no sign-in
- **WHEN** an admin has given a Greeter shift to a volunteer with no sign-in, and a preparer opens that day or is subscribed to shift changes
- **THEN** the preparer sees no row for that volunteer and receives no change for that shift, and the admin sees the row tagged "No sign-in"

#### Scenario: Direct reads
- **WHEN** a non-admin schedule viewer reads the shifts table directly
- **THEN** only shifts of volunteers with a sign-in are returned

### Requirement: The Schedule shows one day at a time
The Schedule SHALL be titled "Schedule" with the overline "VOLUNTEERS". It SHALL open on today's date in America/New_York, whatever the viewer's time zone. It SHALL have ‹ Prev, the date written as weekday, month and day (for example "Saturday, February 7"), Next › and Today.

For an open weekday it SHALL show:
- one column per open hour, labelled as hours ("10 am", "12 pm", "5 pm");
- one row per volunteer with a shift that day, and, for a workspace admin, also per volunteer with a check-in that day, ordered by name;
- each shift spanning its hours and showing its role.

A closed weekday SHALL say "The site is closed on <weekday>s." with no grid. When no weekday is open, an admin SHALL read "Set site hours in Season settings first.", and a site coordinator SHALL also get a link to Season settings. Every time SHALL be in America/New_York. The grid SHALL scroll sideways inside its own box, and the page SHALL NOT scroll sideways. Past and future days SHALL both be shown and, for admins, editable.

#### Scenario: Opening the Schedule
- **WHEN** an admin in another time zone opens the Schedule late on Friday evening, New York time
- **THEN** it shows Friday in New York, not Saturday

#### Scenario: A closed day
- **WHEN** a viewer presses Next › onto a Monday, and Mondays are closed
- **THEN** the screen says "The site is closed on Mondays." with no grid

#### Scenario: No site hours yet
- **WHEN** a site coordinator opens the Schedule in a workspace whose site hours were never set
- **THEN** it says "Set site hours in Season settings first." with a link to Season settings

### Requirement: Admins edit by drag or by buttons
For a workspace admin, every drag on the Schedule SHALL have a button alternative.

Dragging:
- Dragging across empty cells of a row SHALL create a shift over those hours for that row's volunteer, with the role of their earliest shift that day, and SHALL save it at once.
- Dragging a shift's start or end edge SHALL change its hours and save at once.
- A refused save SHALL show the refusal and redraw the day from the database.

Buttons:
- **"+ Add shift"** SHALL open the shift drawer. It holds a volunteer picker, a role choice limited to the chosen volunteer's current-season roles, and a start and an end limited to the day's open hours.
- **Pressing a shift** SHALL open the same drawer with its role, start and end, Save and "Remove shift".
- **Remove shift** SHALL ask first, in the shared confirmation dialog, "Remove <name>'s shift?".

Every shift SHALL be a button that the keyboard reaches. No change SHALL need a pointer.

#### Scenario: Drag to create
- **WHEN** an admin drags across the 2 pm and 3 pm cells of the row of a volunteer whose only shift that day is Preparer 10 to 1
- **THEN** a Preparer shift from 2 to 4 is saved for them

#### Scenario: Drag to resize
- **WHEN** an admin drags the end edge of a 10-to-1 shift to the end of the 2 pm cell
- **THEN** the shift is saved from 10 to 3

#### Scenario: The keyboard path
- **WHEN** an admin tabs to a shift, presses Enter, changes the end to 3 pm and presses Save
- **THEN** the shift is saved from its start to 3, as the drag would save it

#### Scenario: A refused drag
- **WHEN** an admin drags a shift's end past the close hour
- **THEN** the refusal says the shift must stay inside site hours, and the shift is drawn at its saved hours

#### Scenario: Removing
- **WHEN** an admin presses a shift, then Remove shift, then confirms
- **THEN** the shift is removed and its row disappears if it was the volunteer's only shift that day

### Requirement: Add shift offers rostered volunteers, usual days first
The Add shift picker SHALL offer every volunteer with a current-season roster entry, at least one role, and an account that is not deactivated, including volunteers with no sign-in. A volunteer's usual days SHALL be the ones stored with their volunteer profile, `mon` to `sun` (capability `volunteer-roster`). Volunteers whose usual days include the day's weekday SHALL come first, each tagged "Usually here <weekday>s". Everyone else SHALL follow. Within each group the order SHALL be by name. The picker SHALL show each volunteer's roles. It SHALL show "Not cleared" for one who is not cleared, and "No sign-in" for one with no sign-in.

#### Scenario: Usual days first
- **WHEN** an admin opens Add shift on a Saturday, and Hana and Wen usually come on Saturdays and Ari does not
- **THEN** the picker lists Hana and Wen tagged "Usually here Saturdays", then Ari

#### Scenario: Who is not offered
- **WHEN** a volunteer has no roles this season, or their account is deactivated
- **THEN** they are not in the picker

### Requirement: Admins see why a shift doesn't count
On the admin's Schedule, a shift SHALL carry a tag for each of these that holds:
- "Not cleared": the volunteer is not cleared (capability `volunteer-clearance`);
- "No sign-in": the volunteer has no sign-in;
- "Role removed": its role is no longer one of the volunteer's current-season roles;
- "Outside site hours": its hours no longer fit inside its weekday's site hours, or its weekday is now closed.

A shift that becomes "Role removed" or "Outside site hours" SHALL be kept, not changed or removed. A tag SHALL clear when its cause does.

#### Scenario: A role taken away
- **WHEN** a volunteer has a Reviewer shift on Saturday, and an admin removes their Reviewer role
- **THEN** the shift stays, tagged "Role removed", and no longer counts toward coverage

#### Scenario: Hours shrink
- **WHEN** a shift runs 2 to 5 on a Saturday, and a site coordinator changes Saturday's hours to close at 4 pm
- **THEN** the shift stays from 2 to 5, tagged "Outside site hours", and counts toward nothing

### Requirement: Coverage counts cleared volunteers by role for each open hour
For each open hour of the day, an admin's Schedule SHALL count the shifts whose hours cover that hour:
- **preparers**: shifts with the Preparer role;
- **reviewers**: shifts with the Reviewer role;
- **on site**: shifts with the Greeter or Intaker role whose volunteer's Works is On site or On site and remote.

A shift SHALL count only when its volunteer is cleared and it is tagged neither "Role removed" nor "Outside site hours". An Admin shift SHALL count toward nothing. The database SHALL decide what each shift counts toward, and SHALL return it to workspace admins only.

An hour SHALL have a gap when any count is below its target (capability `season-settings`). A target of 0 SHALL never make a gap. The coverage row SHALL show "OK" for an hour with no gap. Otherwise it SHALL show what is missing, in the order preparers, reviewers, on site: for example "1 more preparer", "2 more preparers, 1 more reviewer" or "1 more on site". The day SHALL be headed "<N> of <M> hours have gaps", or "No gaps" when N is 0.

#### Scenario: The default targets
- **WHEN** at 11 am one cleared preparer, one cleared reviewer and one cleared on-site Greeter cover the hour, with targets 2 / 1 / 1
- **THEN** the 11 am cell reads "1 more preparer"

#### Scenario: Uncleared and remote people don't count
- **WHEN** an hour is covered by two preparers, one of them not cleared, a cleared reviewer, and a cleared Intaker whose Works is Remote
- **THEN** that hour reads "1 more preparer, 1 more on site"

#### Scenario: Admin shifts
- **WHEN** a cleared admin has an Admin shift over an hour that has no other shift
- **THEN** that hour reads "2 more preparers, 1 more reviewer, 1 more on site"

#### Scenario: A target of zero
- **WHEN** a site coordinator sets the on-site target to 0, and an hour has two cleared preparers and a cleared reviewer
- **THEN** that hour reads "OK"

#### Scenario: The day header
- **WHEN** Saturday is open 10 am to 4 pm, and two of its six hours have a gap
- **THEN** the day is headed "2 of 6 hours have gaps"

### Requirement: My profile lists the volunteer's shifts this week
The My profile screen (capability `my-profile`) SHALL have a section "Your shifts this week". It SHALL list every live shift of the signed-in volunteer dated from Monday to Sunday of the week that holds today in America/New_York, in date and start order. Each shift SHALL be written like "Tue, Feb 3 · 5 pm – 8 pm · Preparer". With none, the section SHALL say "No shifts this week."

The section SHALL be read through `vitally_my_shifts()`. That read SHALL take no arguments and SHALL answer only for the signed-in `staff` caller, with `weekStart`, `weekEnd` and `shifts` (each with `shiftId`, `date`, `startHour`, `endHour` and `role`). It SHALL cover only the current season and leave removed shifts out. It SHALL return nothing about any other person, and it SHALL NOT be gated by clearance. A client, an anonymous caller, a staff caller with no person row, or a caller whose account is `invited` SHALL be refused with `FORBIDDEN`. Execute SHALL be granted to `authenticated` only. Staff screens SHALL be English only.

#### Scenario: A week with shifts
- **WHEN** a cleared volunteer has a Preparer shift Tuesday 5 to 8 and a Preparer shift Saturday 10 to 2 this week, and one next Monday
- **THEN** My profile lists the two shifts of this week under "Your shifts this week", Tuesday first, and not next Monday's

#### Scenario: No shifts
- **WHEN** a cleared volunteer has no shift this week
- **THEN** My profile says "No shifts this week."

#### Scenario: A removed shift
- **WHEN** an admin removes one of a volunteer's shifts this week
- **THEN** My profile no longer lists it

#### Scenario: Only the caller's own shifts
- **WHEN** a preparer calls `vitally_my_shifts()` in a week where another volunteer also has shifts
- **THEN** the answer holds only the preparer's own shifts

#### Scenario: An invited account
- **WHEN** a staff member whose account is `invited` calls `vitally_my_shifts()`
- **THEN** it is refused with `FORBIDDEN`

### Requirement: Schedule screens follow changes live and on focus
Shifts and the schedule settings SHALL be delivered by realtime to schedule viewers, and check-ins to workspace admins and to their own person, under the reading rules above. A change to shifts, the schedule settings or, for a workspace admin, check-ins SHALL make an open Schedule re-read the day on screen. A change to shifts SHALL make an open My profile re-read its shifts this week. A change to shifts, the schedule settings or check-ins SHALL make an open Workload re-read its hours (capability `volunteer-workload`).

An uncleared window SHALL hold a realtime connection only while it is on the Schedule. It SHALL read nothing from it but the schedule day, and SHALL route no check-in change. The screens SHALL also re-read when the window regains focus. A change refused with `CONFLICT` SHALL re-read the day. For a shift it SHALL say "Someone changed this shift. The schedule has been refreshed.", and for a check-in "Someone changed this check-in. The schedule has been refreshed." Usual days SHALL NOT be published to realtime.

#### Scenario: Another admin adds a shift
- **WHEN** two admins have the same Saturday open, and one adds a shift
- **THEN** the other's Schedule shows it, with its coverage updated, without a reload

#### Scenario: A volunteer's own week
- **WHEN** a preparer has My profile open, and an admin gives them a shift on Thursday this week
- **THEN** My profile lists the Thursday shift without a reload

#### Scenario: Site hours change
- **WHEN** a viewer has a Saturday open, and a site coordinator changes Saturday to close at 3 pm
- **THEN** the viewer's grid ends at 3 pm without a reload

#### Scenario: A volunteer checks in
- **WHEN** an admin has today open on the Schedule, and a volunteer checks in from their phone
- **THEN** the admin's Schedule shows the new bar without a reload

#### Scenario: Two admins correct the same check-in
- **WHEN** two admins open the same check-in, the first saves a change, and the second then presses Save
- **THEN** the second is refused, the day is re-read, and it says "Someone changed this check-in. The schedule has been refreshed."

### Requirement: Admins see the day's check-ins on the Schedule
For a workspace admin, the schedule day read SHALL also return the day's live check-ins (capability `volunteer-check-in`). Each SHALL have:
- its id, revision, volunteer and name;
- its check-in and check-out times;
- its end, state (out, open or missed) and minutes;
- its tags;
- the name of the admin who last corrected it.

The read SHALL return no check-in to anyone else.

On an open weekday, each check-in SHALL be a bar under its volunteer's shifts. It SHALL run from its check-in to its end, placed by the minute across the hour columns and cut off at the grid's edges. Its label SHALL be:
- "9:52 am – 1:10 pm" when it is out;
- "9:52 am – now" when it is open;
- "9:52 am – no check-out" when it is missed.

A check-in SHALL carry a tag for each of these that holds:
- "No check-out": it is missed;
- "Not scheduled": its volunteer has no live shift that day;
- "Corrected": an admin saved it;
- "Outside site hours": part of it lies outside its weekday's site hours, or its weekday is closed.

On a closed weekday, or when no weekday is open, the admin SHALL see the day's check-ins listed below the message, with the same labels and tags. Every check-in SHALL be a button that the keyboard reaches. Coverage SHALL NOT count check-ins.

#### Scenario: A check-in next to its shift
- **WHEN** a volunteer has a Preparer shift 10 to 1 on Saturday, and checked in at 9:52 am and out at 1:10 pm
- **THEN** their row shows the shift and, under it, a bar labelled "9:52 am – 1:10 pm" with no tags

#### Scenario: An unscheduled volunteer
- **WHEN** a volunteer with no shift on Saturday checks in at 11:00 am
- **THEN** the admin's Schedule has a row for them with a bar "11:00 am – now" tagged "Not scheduled"

#### Scenario: A missed check-out
- **WHEN** an admin opens last Saturday, where a volunteer with a shift 10 to 1 checked in at 10:05 am and never checked out
- **THEN** the bar runs to 1 pm, is labelled "10:05 am – no check-out", and is tagged "No check-out"

#### Scenario: A closed day
- **WHEN** Mondays are closed, and an admin opens a Monday on which a volunteer checked in
- **THEN** the screen says "The site is closed on Mondays." and lists that check-in tagged "Not scheduled" and "Outside site hours"

#### Scenario: A non-admin viewer
- **WHEN** a cleared preparer opens the Schedule on a day with check-ins
- **THEN** no check-in, bar or row for an unscheduled volunteer is shown, and the day read returns none

### Requirement: Admins correct check-ins from the Schedule
For a workspace admin, the Schedule SHALL have "+ Add check-in" beside "+ Add shift" on today and past days, and not on future days. It SHALL open the check-in drawer with:
- the Add shift volunteer picker, with usual days first;
- "Checked in" and "Checked out" times in 5-minute steps;
- Save.

"Checked out" MAY be left empty. Pressing a check-in SHALL open the same drawer with its times, Save and "Remove check-in". A drawer for a corrected check-in SHALL say "Corrected by <name>". A drawer for a missed check-out SHALL say "No check-out. Counted to <end>.", for example "No check-out. Counted to 1 pm.". A saved time that is not on a 5-minute step SHALL stay as it is unless the admin changes it. Remove check-in SHALL ask first, in the shared confirmation dialog, "Remove <name>'s check-in?". A refused save SHALL show the refusal in the drawer. Check-ins SHALL NOT be dragged.

#### Scenario: Correcting a check-out
- **WHEN** an admin presses a bar labelled "10:05 am – no check-out", sets Checked out to 12:30 pm and presses Save
- **THEN** the bar reads "10:05 am – 12:30 pm" tagged "Corrected", and the drawer says "Corrected by <the admin's name>" when it is opened again

#### Scenario: Keeping an exact minute
- **WHEN** an admin opens a check-in from 9:52 am to 1:10 pm, changes only Checked out to 1:30 pm and presses Save
- **THEN** it is saved from 9:52 am to 1:30 pm

#### Scenario: Adding for someone who forgot
- **WHEN** an admin presses + Add check-in on yesterday, picks a volunteer, sets 10:00 am to 1:00 pm and presses Save
- **THEN** a bar "10:00 am – 1:00 pm" tagged "Corrected" appears in that volunteer's row

#### Scenario: A future day
- **WHEN** an admin moves the Schedule to next Saturday
- **THEN** there is + Add shift but no + Add check-in

#### Scenario: Removing
- **WHEN** an admin presses a check-in, then Remove check-in, then confirms
- **THEN** the check-in is removed, and its row disappears if the volunteer has no other shift or check-in that day
