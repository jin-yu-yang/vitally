# season-export Specification

## Purpose
Exporting a workspace's current season for PCDC's archive. A site coordinator confirms a dialog on Season settings and downloads one ZIP holding a README and eight CSVs (cases, intake answers, household members, status history, messages, follow-ups, call log and help requests) of the current season's submitted cases, plus help requests with no case. It covers who may export (active site coordinators only), the record each export leaves in `season_exports` (season, person, time, row counts), the columns of each file, the spreadsheet-safe CSV format, and the rule that bank numbers are never exported and an SSN or ITIN keeps only its last four digits.

## Requirements

### Requirement: Only a site coordinator exports the current season, from a confirm dialog
The Season export card's "Export this season…" (capability `season-settings`) SHALL open a dialog titled "Export the <season> season", for the workspace's current season.

The dialog SHALL list what is included: cases and intake answers, household members, status history, messages between clients and staff, follow-ups, the call log, and help requests. It SHALL say what is not included:
- the roster and certificates, with "use Roster → Export CSV";
- the 13614-C PDFs, "rebuilt from the answers".

It SHALL warn: "Messages, notes and call log entries are exported as staff and clients wrote them. Notes must not hold amounts or ID numbers." It SHALL have Cancel and "Download ZIP". While the export runs, "Download ZIP" SHALL be disabled and read "Preparing…".

The database call SHALL be `vitally_export_season`, with no arguments.
- It SHALL refuse with `FORBIDDEN`, as its first check, anyone who is not active staff whose acting person is a site coordinator of the workspace (capability `site-coordinators`). A refused call SHALL return no case data and record nothing.
- It SHALL export only the workspace's current season. It SHALL take no season argument.
- It SHALL NOT be refused for open work. Open cases, open follow-ups and claimed help requests SHALL be exported as they stand.

On success:
- the file SHALL download;
- the dialog SHALL close;
- the page SHALL say "Season exported";
- the card's Last export line SHALL show the exporter and the time from the answer.

On `FORBIDDEN`, the page SHALL read Season settings again.

#### Scenario: A site coordinator exports mid-season
- **WHEN** a site coordinator in season 2026 opens the dialog while two cases are still at Preparation in progress, and presses Download ZIP
- **THEN** a ZIP downloads holding both cases, the dialog closes, the page says "Season exported", and the card reads "Last export: <their name> · <now>"

#### Scenario: An admin who is not a site coordinator calls the export
- **WHEN** a staff member with the Admin role who is not a site coordinator calls `vitally_export_season` directly
- **THEN** it is refused with `FORBIDDEN`, the answer holds no case data, and no export is recorded

#### Scenario: A preparer or a client calls the export
- **WHEN** a staff member with only the Preparer role, or a signed-in client, calls `vitally_export_season`
- **THEN** it is refused with `FORBIDDEN`, and no export is recorded

#### Scenario: A site coordinator cancels
- **WHEN** a site coordinator opens the dialog and presses Cancel
- **THEN** nothing downloads and no export is recorded

### Requirement: Each export is recorded, and every call records one
Each successful `vitally_export_season` call SHALL insert one record in one transaction with the rows it returns. The record SHALL hold:
- the workspace and the season exported;
- the exporting person;
- the time;
- the number of rows for each CSV built straight from database rows: `cases.csv`, `status-history.csv`, `messages.csv`, `follow-ups.csv`, `call-log.csv` and `help-requests.csv`. The intake answer and household files are derived from the answers in the browser, so they are counted only in `README.txt`.

The call SHALL take no action id. A repeated call SHALL record another export. Signed-in users SHALL have no direct read or write grant on the records. The answer SHALL carry the season, the exporter's name and the export time.

#### Scenario: Two exports
- **WHEN** a site coordinator exports twice
- **THEN** two records exist for the current season, and the Season settings read's last export is the later one

#### Scenario: No direct access
- **WHEN** a signed-in site coordinator reads or writes the export records table directly
- **THEN** the read returns nothing or is refused, and the write is refused

#### Scenario: Row counts
- **WHEN** a site coordinator exports a season with three submitted cases and five status history rows
- **THEN** the record's counts say 3 for `cases.csv` and 5 for `status-history.csv`

### Requirement: The ZIP holds a README and eight CSVs of the current season
The download SHALL be named `vitally-<season>-export-<YYYY-MM-DD>.zip`, with the New York date. It SHALL be a ZIP with stored (uncompressed) entries and UTF-8 file names. A standard unzip tool SHALL open it with matching CRCs.

It SHALL hold, in this order:
- `README.txt`: the workspace's season, who exported it and when (New York time), one line per CSV with its row count, the free-text warning, and that the file is PCDC's archive and is not re-imported;
- `cases.csv`, `intake-answers.csv`, `household-members.csv`, `status-history.csv`, `messages.csv`, `follow-ups.csv`, `call-log.csv` and `help-requests.csv`.

A case SHALL be in the export when it is in the workspace, its season is the current season and it has a client number. Drafts (no season) and cases of other seasons SHALL NOT appear in any file. The rows of every file SHALL come from one snapshot. A CSV with no rows SHALL hold its header row only.

#### Scenario: Only the current season
- **WHEN** the current season is 2026, and the workspace has two submitted 2026 cases, one 2025 case and one client draft
- **THEN** `cases.csv` has exactly the two 2026 cases, and no file names the 2025 case or the draft

#### Scenario: A file name
- **WHEN** it is 2026-11-27 in New York and the current season is 2026
- **THEN** the download is named `vitally-2026-export-2026-11-27.zip`

#### Scenario: The ZIP opens
- **WHEN** the ZIP is read back by a standard unzip
- **THEN** it lists `README.txt` and the eight CSVs in order, and each entry's CRC matches its contents

#### Scenario: No help requests
- **WHEN** the season has no help requests
- **THEN** `help-requests.csv` holds only its header row

### Requirement: Each CSV has its columns
Each CSV SHALL have English Title Case headers, in this order:

| File | Rows | Columns |
|---|---|---|
| `cases.csv` | each exported case, by client number | Client Number, Reference, Origin, Stage, Closing Reason, Submitted At, Preparer, Reviewer |
| `intake-answers.csv` | each answered question the case's form shows, in catalogue order | Client Number, Reference, Question Id, Question, Answer |
| `household-members.csv` | each household row the case's form shows | Client Number, Reference, Member, then each household member question |
| `status-history.csv` | each staff history event, by time | Client Number, Time, Action, By, Detail |
| `messages.csv` | each document request and each client history line, by time | Client Number, Time, Kind, From, Title, Message, Status |
| `follow-ups.csv` | each follow-up, by opened time | Client Number, Reason, Assignee, Status, Outcome, Note, Opened, Resolved |
| `call-log.csv` | each call log entry (its current version) and each follow-up contact attempt, by time | Client Number, Contacted At, Direction, With Whom, Method, Purpose, Outcome, Note, Logged By |
| `help-requests.csv` | each help request on an exported case, and each help request that names no case | Client Number, Title, Status, Assignee, Language, Contact Preference, Note, Created |

**How cells are written:**
- **Times:** `YYYY-MM-DD HH:MM` in America/New_York.
- **People:** named by their name.
- **Questions and answers:** in English. Option answers SHALL use their English option labels, and several options SHALL be joined with "; ".
- **Status history `Detail`:** compact JSON.
- **`messages.csv` `Kind`:** "Document request" or "Client history". A client history line's From SHALL be "PCDC", and its Title and Status SHALL be empty.
- **A help request with no case:** an empty Client Number.
- **Submitted At:** the case's first submission.
- **Missing values:** a missing value SHALL give an empty cell.

#### Scenario: An answer with options
- **WHEN** a case answered a multi-select question with two options
- **THEN** its `intake-answers.csv` row holds the question's English wording and both English option labels joined with "; "

#### Scenario: A hidden answer
- **WHEN** a case's answers hold a value for a question its form no longer shows
- **THEN** `intake-answers.csv` has no row for that question

#### Scenario: Household members
- **WHEN** a case's form shows two household rows
- **THEN** `household-members.csv` has two rows for that case, Member 1 and Member 2

#### Scenario: A help request with no case
- **WHEN** an unclaimed help request names no case
- **THEN** `help-requests.csv` has a row for it with an empty Client Number

#### Scenario: Messages from both sides
- **WHEN** a preparer asked for a W-2 and the client's history has the line about it
- **THEN** `messages.csv` has a "Document request" row from the preparer with the title and message, and a "Client history" row from "PCDC"

### Requirement: The export opens safely in a spreadsheet
Every CSV SHALL follow the Roster CSV's rules (capability `volunteer-roster`):
- UTF-8 with a byte-order mark;
- lines ending with CR LF;
- a field quoted when it contains a double quote, comma, carriage return or line feed, with each double quote doubled;
- a cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return written with a leading apostrophe.

`README.txt` SHALL be UTF-8 with CR LF line endings.

#### Scenario: A Chinese answer
- **WHEN** a client's name is 李小明 and `cases.csv` is opened in Excel
- **THEN** the name shows as 李小明

#### Scenario: A note that would be a formula
- **WHEN** a call log note is "=HYPERLINK(1)"
- **THEN** `call-log.csv` holds "'=HYPERLINK(1)"

#### Scenario: A message with a line break
- **WHEN** a document request's message has two lines and a comma
- **THEN** its Message cell is quoted and keeps both lines

### Requirement: Bank numbers are never exported, and an SSN or ITIN keeps only its last four digits
No file SHALL hold a bank account number or a routing number. An SSN or ITIN SHALL appear only as its last four digits. Every file SHALL be built from explicit columns, and answers only from catalogue questions.

ViTally stores none of these values today. A check SHALL fail when a catalogue question's id or English wording names an SSN, an ITIN, a routing number or an account number, until that question gets the masking above.

#### Scenario: Today's catalogue
- **WHEN** the check runs against the current catalogue
- **THEN** it passes, because no question asks for those numbers

#### Scenario: A new bank question
- **WHEN** a catalogue change adds a question with id `routing_number`
- **THEN** the check fails until the export masks or drops that question
