## ADDED Requirements

### Requirement: A check-in closed by a roster removal is the remover's correction
When a volunteer is removed from the roster while checked in today (capability `volunteer-roster`), their check-in SHALL read as checked out at the removal time and corrected by the admin who removed them. Every read that shows corrections SHALL show it as one, with that admin's name. It SHALL count like any check-in that has a check-out: to its check-out, the removal time. Hours this week (capability `volunteer-workload`) SHALL count it the same way.

#### Scenario: Shown as corrected by the remover
- **WHEN** an admin removes Nadia Kerr from the roster while she is checked in today, and another admin opens the Schedule for today
- **THEN** her check-in shows as out at the removal time, tagged "Corrected", with the removing admin's name

#### Scenario: Hours this week counts to the removal time
- **WHEN** a volunteer checked in at 10:00 am today, is removed from the roster at 11:45 am, and an admin then reads Hours this week at 2:00 pm
- **THEN** that check-in counts 105 minutes

## MODIFIED Requirements

### Requirement: A check-in without a check-out counts to the day's end
A check-in's counted span SHALL run from its check-in time to its **end**, and its minutes SHALL be the whole minutes of that span, rounded down, never below 0. The **day's end** SHALL be the latest end hour of the person's live shifts on that date, of any role and whether tagged or not (capability `volunteer-schedule`). With no shift, it SHALL be that weekday's site close hour (capability `season-settings`). With neither, there SHALL be no day's end.

A check-in SHALL be in one of three states:
- **out**: it has a check-out. The end SHALL be the check-out.
- **open**: it has no check-out, and its date is today in New York. The end SHALL be the earlier of now and the day's end. With no day's end, it SHALL count 0 minutes.
- **missed**: it has no check-out, and its date is before today. The end SHALL be the day's end. With no day's end, it SHALL count 0 minutes.

An end before the check-in SHALL count 0 minutes. Only two things SHALL write a check-out on the volunteer's behalf:
- an admin's check-out (see below), which SHALL replace a derived end;
- removing the volunteer from the roster, which checks out their open check-in from today at the removal time (see "A check-in closed by a roster removal is the remover's correction"). It SHALL leave a missed check-in from an earlier date as it is.

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

#### Scenario: A missed check-in from an earlier date stays missed after a removal
- **WHEN** a volunteer checked in yesterday, never checked out, and is removed from the roster today
- **THEN** yesterday's check-in is still missed and still counts to yesterday's day's end
