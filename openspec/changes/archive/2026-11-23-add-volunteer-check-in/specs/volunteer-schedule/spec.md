## ADDED Requirements

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

## MODIFIED Requirements

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
