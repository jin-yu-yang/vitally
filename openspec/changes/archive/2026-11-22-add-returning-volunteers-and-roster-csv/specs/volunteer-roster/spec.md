## ADDED Requirements

### Requirement: Add a volunteer offers last season's people
The Add a volunteer drawer SHALL start with a search box, "Returning volunteer? Search last season's roster".

Under the box it SHALL list each person with a roster entry for the season before the current one and none for the current season, sorted by name. Typing SHALL keep those whose name or email contains the text, without regard to case.

When the box holds an email equal, ignoring case, to the profile email of anyone in the workspace with no current-season roster entry, that person SHALL also be offered. They SHALL be labelled "Earlier volunteer" when they were not on last season's roster.

Nobody on the current roster SHALL be offered.

#### Scenario: Last season's people are offered
- **WHEN** the season is 2026, Nadia Kerr and Owen Pratt were on the 2025 roster, and Owen Pratt is already on the 2026 roster, and an admin opens Add a volunteer
- **THEN** the search list offers Nadia Kerr and not Owen Pratt

#### Scenario: Searching by name
- **WHEN** an admin types "ker" into the search box
- **THEN** only last season's people not on this roster whose name or email contains "ker" are listed

#### Scenario: An earlier volunteer found by email
- **WHEN** a person with a profile was on the 2024 roster only, and an admin types their full email into the search box in 2026
- **THEN** they are offered, labelled "Earlier volunteer"

### Requirement: Picking a returning volunteer fills their person fields only
Picking a person SHALL fill the form from their profile: name, email, phone, works, languages with the other language, and usual days.

"New volunteer" and "Photo ID checked" SHALL be unticked. Roles and certificates SHALL start empty, and no certificate SHALL be copied from an earlier season. They SHALL stay editable under the rule that a role needs its certificates ticked.

While a person is picked, the email SHALL be read-only. "Not this person" SHALL return the drawer to a blank Add, with "New volunteer" ticked.

Saving SHALL send `vitally_save_volunteer` with the picked person as the volunteer and their profile revision as the expected revision. A conflict SHALL be handled as for Edit.

#### Scenario: Picking fills the person's fields, not the season's
- **WHEN** an admin picks Nadia Kerr, who was a Preparer with VSC, IT&QR and Basic in 2025 and has stored usual days Tue and Thu
- **THEN** the form shows her name, email (read-only), phone, works, languages and usual days Tue and Thu; New volunteer and Photo ID checked are unticked; no role and no certificate is ticked

#### Scenario: Saving a picked volunteer
- **WHEN** an admin picks Nadia Kerr and saves without other changes
- **THEN** she appears on the Roster with "No roles recorded", not new, and not cleared, and her usual days are still Tue and Thu

#### Scenario: Confirming this season's Form 13615 in the same save
- **WHEN** an admin picks Nadia Kerr, ticks VSC, IT&QR, Basic and Preparer, and saves
- **THEN** she appears on the Roster as a Preparer with those certificates, confirmed by that admin now

#### Scenario: Not this person
- **WHEN** an admin picks Nadia Kerr and then presses "Not this person"
- **THEN** the form is empty, the email is editable, and New volunteer is ticked

### Requirement: Saving a volunteer who is not on the current roster adds them to it
`vitally_save_volunteer` for a volunteer with a profile in the caller's workspace but no current-season roster entry SHALL save as for Edit:
- it SHALL update their name and profile and raise the profile's revision;
- it SHALL create their current-season roster entry, with the caller as who added them;
- it SHALL confirm each ticked certificate.

Earlier seasons' entries and certificates SHALL be unchanged. Refusals SHALL be as for Edit: `CONFLICT`, `ROLE_NEEDS` and `ADMIN_ROLE`. A repeated action id SHALL return the stored result.

#### Scenario: A past volunteer is added
- **WHEN** the season is 2026, a person has a profile and a 2025 roster entry with Preparer and confirmed certificates, and an admin saves them with no roles, not new, and the same profile fields
- **THEN** they have a 2026 roster entry with no roles, not new, added by that admin; their profile revision is one higher; and their 2025 roster entry and certificates are unchanged

#### Scenario: Usual days are kept
- **WHEN** that past volunteer has stored usual days Tue and Thu, and the save sends usual days Tue and Thu
- **THEN** their usual days are still Tue and Thu

#### Scenario: A stale revision
- **WHEN** two admins pick the same past volunteer, and the second saves after the first
- **THEN** the second is refused with `CONFLICT`, and the volunteer has one 2026 roster entry

#### Scenario: Retrying the same save
- **WHEN** the same save of a past volunteer is sent twice with the same action id
- **THEN** both calls return the same result, and one 2026 roster entry exists

### Requirement: An earlier volunteer's email points to the search
When an admin types an email into the Add form's email field without picking, and it equals, ignoring case, the profile email of a person with no current-season roster entry, the drawer SHALL say "That email belongs to an earlier volunteer. Pick them above." It SHALL NOT send the save.

An email already on the current Roster SHALL keep the message "That email is already on the Roster."

#### Scenario: Typing a returning volunteer's email
- **WHEN** an admin fills in Add a volunteer with Nadia Kerr's email, without picking her, and saves
- **THEN** the drawer says "That email belongs to an earlier volunteer. Pick them above.", and nothing is saved

#### Scenario: An email on this Roster
- **WHEN** an admin enters an email already on the current Roster
- **THEN** the drawer says "That email is already on the Roster.", and nothing is saved

### Requirement: An admin can export the Roster as a CSV
The Roster SHALL have an "Export CSV" button. It SHALL download a CSV of exactly the rows the table shows under the current search, role and Show filters, in the table's order. It SHALL be disabled when no row is shown.

The file SHALL be named `roster-<season>-<YYYY-MM-DD>.csv`, with the current season and the New York date. Only workspace admins SHALL have the button, as only they open the Roster.

#### Scenario: Exporting a filtered Roster
- **WHEN** the season is 2026, it is 2026-11-23 in New York, and an admin chooses Reviewer and presses Export CSV
- **THEN** a file `roster-2026-2026-11-23.csv` downloads with the header row and one row per Reviewer shown, and no other volunteers

#### Scenario: Nothing to export
- **WHEN** the search matches nobody
- **THEN** Export CSV is disabled

### Requirement: The Roster CSV has the table's columns
The CSV SHALL have these columns, in this order:
- Name, Email and Phone;
- Roles, as the table names them, joined with "; ";
- Certificates, as the table names them, each followed by its confirmation date (`YYYY-MM-DD`, New York time) in brackets, joined with "; ";
- Languages, as the table names them, with the other language written out;
- Account: "Not created", "Invited", "Active" or "Deactivated";
- Cleared: "Yes" or "No".

No roles or no certificates SHALL give an empty cell.

#### Scenario: Certificates with their dates
- **WHEN** a volunteer has IT&QR and Basic confirmed on 2026-11-03 New York time
- **THEN** their Certificates cell is "IT&QR (2026-11-03); Basic (2026-11-03)"

#### Scenario: A volunteer waiting for their form
- **WHEN** a volunteer has no roles and no certificates, and no account
- **THEN** their Roles and Certificates cells are empty, Account is "Not created", and Cleared is "No"

### Requirement: The Roster CSV opens safely in a spreadsheet
The CSV SHALL be UTF-8 with a byte-order mark, and its lines SHALL end with CR LF.

A field SHALL be quoted when it contains a double quote, comma, carriage return or line feed, and each double quote in it SHALL be doubled.

A cell whose text starts with `=`, `+`, `-`, `@`, a tab or a carriage return SHALL start with an apostrophe in the file. Phones are included.

#### Scenario: A Chinese name
- **WHEN** a volunteer is named 李小明 and the file is opened in Excel
- **THEN** the name shows as 李小明, because the file starts with a UTF-8 byte-order mark

#### Scenario: A cell that would be a formula
- **WHEN** a volunteer's name is "=HYPERLINK(1)" and their phone is "+1 555 0100"
- **THEN** the file holds "'=HYPERLINK(1)" and "'+1 555 0100"

#### Scenario: A comma and a quote
- **WHEN** a volunteer's other language is written `Tagalog, "Filipino"`
- **THEN** the Languages cell is quoted, and its quotes are doubled
