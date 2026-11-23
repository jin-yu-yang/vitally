## ADDED Requirements

### Requirement: Season settings holds the site hours and the coverage targets
Season settings SHALL have a "Site hours and coverage" card after the season card. The card SHALL be stored once per workspace and kept across seasons, with its own revision and its own Save.

**Site hours:**
- Seven weekday tiles, Monday to Sunday, each either closed or open.
- An open day has an open hour and a close hour, whole hours in America/New_York, with 0 ≤ open < close ≤ 24.
- The same week SHALL apply to every date. There are no one-off closures.
- A workspace whose site hours were never saved SHALL have every day closed.

**Coverage targets** (capability `volunteer-schedule`):
- preparers needed, reviewers needed, and greeters or intakers needed on site;
- each a whole number from 0 to 9;
- defaults 2, 1 and 1.

A site coordinator SHALL see the tiles, the hour pickers, the three number inputs and Save. Any other workspace admin SHALL see the same values as text, such as "Saturday · 10 am – 4 pm" and "Tuesday · Closed", with no inputs. The save SHALL be refused with `VALIDATION`, naming the field, for:
- an open day whose close hour is not after its open hour;
- an hour outside 0–24;
- a weekday key outside Monday to Sunday;
- a target outside 0–9 or not a whole number.

Changing site hours SHALL NOT change or remove any shift.

#### Scenario: Setting site hours
- **WHEN** a site coordinator opens Tuesday and Thursday from 5 pm to 8 pm and Saturday from 10 am to 4 pm, and presses Save
- **THEN** the card shows those hours with every other day closed, and the Schedule shows three columns on Tuesdays and six on Saturdays

#### Scenario: A close hour before the open hour
- **WHEN** a site coordinator sets Saturday to open at 4 pm and close at 10 am, and presses Save
- **THEN** the save is refused naming Saturday's hours, and nothing changes

#### Scenario: The defaults
- **WHEN** an admin opens Season settings in a workspace that never saved this card
- **THEN** every day reads Closed, and the targets read 2 preparers, 1 reviewer and 1 on site

#### Scenario: An admin who is not a site coordinator
- **WHEN** a staff member with the Admin role who is not a site coordinator opens Season settings
- **THEN** the site hours and targets are shown as text with no inputs and no Save for the card

### Requirement: Only site coordinators write the site hours and coverage targets
The Season settings read SHALL include the site hours, the targets and their revision for every workspace admin. The schedule settings save SHALL be allowed only for a site coordinator. Anyone else SHALL be refused with `FORBIDDEN` before any other check, and the refusal SHALL write nothing and store no receipt. The save SHALL take an action id, and a repeated request with the same action id SHALL return the stored result and write nothing more. It SHALL be sent at the revision the page read. A stale revision SHALL be refused with `CONFLICT`, and with no row the revision is 0.

Signed-in users SHALL have no direct write grant on the stored schedule settings. Schedule viewers (capability `volunteer-schedule`) SHALL be able to read the row only so that realtime can deliver its changes.

#### Scenario: An admin who is not a site coordinator saves
- **WHEN** a staff member with the Admin role who is not a site coordinator calls the schedule settings save
- **THEN** it is refused with `FORBIDDEN`, nothing changes, and no receipt is stored

#### Scenario: Two site coordinators save
- **WHEN** two site coordinators open Season settings at the same revision, and both change Saturday's hours and press Save
- **THEN** the second is refused with `CONFLICT`, and the card shows the first one's hours after it re-reads

#### Scenario: A repeated save
- **WHEN** a site coordinator's schedule settings save is sent twice with the same action id
- **THEN** both answers are the same, and the revision went up once

#### Scenario: No direct write
- **WHEN** a signed-in site coordinator writes the stored schedule settings table directly
- **THEN** the write is refused
