## ADDED Requirements

### Requirement: Only a site coordinator starts the next season, by one, after typing the year
Season settings SHALL have a "Next season" card. For a site coordinator (capability `site-coordinators`) it SHALL offer "Start next season…". Any other workspace admin SHALL see the card without the button.

The button SHALL open a dialog titled "Start the <season + 1> season". The dialog SHALL say that:
- site coordinators keep their sign-in;
- every other staff account loses it;
- the new roster starts with only the person starting it.

It SHALL remind: "Export this season's roster and cases first if you need them." No export SHALL be required. It SHALL have one field, "Type <season + 1> to confirm", and its confirm button SHALL stay disabled until the field equals that year.

The database call SHALL be `vitally_start_next_season`, sent:
- an action id;
- the season the page read;
- the typed year.

It SHALL check, in this order:
1. Refuse anyone who is not an active site coordinator of the workspace with `FORBIDDEN`, writing nothing and storing no receipt.
2. Take the workspace lock.
3. Return the stored result for a repeated action id.
4. Refuse with `CONFLICT` when the workspace's current season is not the season sent.
5. Refuse with `VALIDATION` when the typed year is not that season + 1, or when the new season would be past 2100.

The season SHALL move forward by exactly one.

#### Scenario: A site coordinator opens the dialog
- **WHEN** a site coordinator in season 2026 presses "Start next season…"
- **THEN** the dialog is titled "Start the 2027 season", reminds them to export, and its confirm button is disabled until they type 2027

#### Scenario: An admin who is not a site coordinator
- **WHEN** a staff member with the Admin role who is not a site coordinator opens Season settings, or calls `vitally_start_next_season` directly
- **THEN** the page shows no "Start next season…" button, the call is refused with `FORBIDDEN`, and nothing changes

#### Scenario: The wrong year
- **WHEN** a site coordinator in season 2026 sends the typed year 2028
- **THEN** it is refused with `VALIDATION`, and the season stays 2026

#### Scenario: The season already moved
- **WHEN** two site coordinators read season 2026, and one starts 2027 before the other confirms
- **THEN** the second is refused with `CONFLICT`, their page reads Season settings again, closes the dialog, and says "The season has already moved."

#### Scenario: A retry after a lost reply
- **WHEN** a successful call is sent again with the same action id
- **THEN** it returns the first result, not `CONFLICT`, and the season moved once

### Requirement: Starting the next season is refused while work is unfinished
`vitally_start_next_season` SHALL be refused with `SEASON_NOT_FINISHED`, changing nothing, while any of these exist in the workspace. The refusal SHALL carry each count:
- open cases, in any season: every stage but Draft, Accepted and Closed;
- open follow-ups;
- claimed help requests;
- unclaimed help requests that name a case.

Unclaimed help requests that name no case SHALL NOT be counted; they carry over. The dialog SHALL stay open and list, under "Finish these first:", one line for each count above zero:
- "<N> open cases";
- "<N> open follow-ups";
- "<N> claimed help requests";
- "<N> unclaimed help requests on cases".

Each line SHALL use the singular when N is 1.

#### Scenario: Open cases and a follow-up
- **WHEN** a site coordinator starts the next season while one case is at Ready to e-file, one at E-filed, and one follow-up is open
- **THEN** it is refused with `SEASON_NOT_FINISHED`, the dialog lists "2 open cases" and "1 open follow-up", and nothing changes

#### Scenario: An open case from an older season
- **WHEN** a case from the season before is still at Rejected
- **THEN** it is counted among the open cases, and the start is refused

#### Scenario: Finished cases don't count
- **WHEN** every case is Accepted or Closed, and some clients have unsubmitted drafts
- **THEN** no case is counted

#### Scenario: Help requests
- **WHEN** one help request is claimed, one unclaimed help request names an Accepted case, and one unclaimed help request names no case
- **THEN** the dialog lists "1 claimed help request" and "1 unclaimed help request on cases"; the third is not counted

### Requirement: Starting the next season resets the roster and staff sign-ins
When nothing refuses it, `vitally_start_next_season` SHALL, in one transaction and in this order:
1. Keep the default follow-up person if they are a site coordinator. Otherwise it SHALL make the person starting the season the default follow-up person.
2. Set the workspace's current season to the next one.
3. Add the person starting it to the new season's roster with no roles and no certificates, not marked new.
4. Deactivate, as Deactivate does (capability `sign-in-accounts`), every `invited` or `active` staff account in the workspace that is not a site coordinator's. Deactivation SHALL send no email.
5. Recompute every person's `people.capabilities` as the mirror of the new season's roles (capability `volunteer-clearance`).
6. Record the start: the seasons from and to, who started it and when, the default follow-up person before and after when it moved, and how many accounts were deactivated.
7. Store the result as the action's receipt.

Client accounts, already deactivated accounts and site coordinators' accounts SHALL NOT be changed. At least one site coordinator SHALL remain. Roster entries and certificates of earlier seasons SHALL be kept. The new season's client numbers SHALL start at 1. Signed-in users SHALL have no direct read or write grant on the record of starts.

After the start:
- the starter's window SHALL show the setup screen, since they have no roles;
- other site coordinators SHALL keep the admin screens, and their Roster SHALL list only the starter;
- every deactivated person's open window SHALL show "This account has no access".

#### Scenario: A rollover
- **WHEN** site coordinator Dana Wu starts 2027 in a workspace with two site coordinators, five other staff with active or invited accounts, and three client accounts
- **THEN** the season is 2027, the 2027 roster has only Dana Wu with no roles, the five staff accounts are deactivated, both site coordinators and all three clients are unchanged, every person's capabilities equal the mirror, and one start is recorded with five deactivations

#### Scenario: The default follow-up person is not a site coordinator
- **WHEN** the default follow-up person is an Admin who is not a site coordinator, and site coordinator Dana Wu starts the next season
- **THEN** Dana Wu is the default follow-up person, the Admin's account is deactivated, and the record names both

#### Scenario: The default follow-up person is a site coordinator
- **WHEN** the default follow-up person is another site coordinator
- **THEN** they stay the default follow-up person, and their account stays active

#### Scenario: The starter's own window
- **WHEN** the start succeeds
- **THEN** the starter's window shows "Finish your setup", their sidebar still has the Roster and Season settings, and Season settings shows the new season's label

#### Scenario: A deactivated volunteer's window
- **WHEN** a preparer has the work board open when the season starts
- **THEN** their window shows "This account has no access"

#### Scenario: The new season's first case
- **WHEN** a client submits an application after the start
- **THEN** it gets client number 1 in the new season

### Requirement: Past-season cases are read-only
Every write to a case whose season is set and is not the workspace's current season SHALL be refused with `INVALID_TRANSITION` (`PAST_SEASON`), writing nothing. This SHALL hold for staff and clients, and for every case-writing database call:
- every case action;
- the season-end close;
- logging and editing a contact;
- setting a case label;
- help request actions on a help request that names such a case.

It SHALL also hold for any direct write to a case's rows. A draft, whose season is not yet set, SHALL stay writable, and SHALL join the current season when it is submitted.

#### Scenario: A staff action on a past case
- **WHEN** an admin adds a label to, or logs a contact on, an Accepted case from the season before
- **THEN** it is refused with `PAST_SEASON`, and nothing is written

#### Scenario: Every case-writing call
- **WHEN** each case-writing database call is sent for a case from the season before
- **THEN** each is refused with `PAST_SEASON`

#### Scenario: A leftover draft
- **WHEN** a client's unsubmitted draft from before the start is submitted after it
- **THEN** it is accepted, and the case is in the new season

### Requirement: Clients keep their past-season applications, read-only
A client SHALL still see their own applications from earlier seasons, as today. Any action on them SHALL be refused with `PAST_SEASON`. Read access to past-season rows SHALL be unchanged for clients and staff.

#### Scenario: A returning client
- **WHEN** a client with an Accepted application from the season before signs in after the start
- **THEN** they see that application, and they can start a new application for the new season

### Requirement: Migration 055 drops the copy of capabilities from before 052
Migration 055 SHALL drop `vitally_private.capabilities_before_052`. Nothing SHALL restore capabilities from it afterwards.

#### Scenario: After migration 055
- **WHEN** migration 055 has run
- **THEN** `vitally_private.capabilities_before_052` does not exist
