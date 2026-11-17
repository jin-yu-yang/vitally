## ADDED Requirements

### Requirement: Household cells follow the household the client shows
The number of visible household rows SHALL be the number of household members, capped at 4, while the case's intake catalogue, for its own intake version, shows the household list (the client answered Yes to the household question). Otherwise it SHALL be 0. Members kept from before an answer of No SHALL NOT count. "A row with no household member" SHALL mean a row past this count. The browser and the database SHALL apply the same rule.

#### Scenario: Yes, two members, then No
- **WHEN** the client answers Yes, adds two household members, then changes the answer to No, and the preparer fills row 1's qualifying child cell and saves
- **THEN** the save is refused with `VALIDATION`, the browser names row 1, and nothing is stored

#### Scenario: Yes with three members
- **WHEN** the client answers Yes with three household members, and the preparer fills a cell in each of rows 1, 2 and 3 and saves
- **THEN** the save is accepted
- **AND** a save that also fills a row 4 cell is refused with `VALIDATION`, and the browser names row 4

#### Scenario: More members than rows
- **WHEN** the client answers Yes with six household members
- **THEN** rows 1 to 4 take cells

#### Scenario: The browser and the database agree
- **WHEN** the same set of answers is given to the browser's rule and to the database's rule: no household answer, No with members kept, Yes with none, Yes with 1, 3, 4 and 6 members
- **THEN** both give the same number of visible rows for each

### Requirement: The case page counts only the cells it can show
The case page's count of filled shaded fields SHALL leave out household cells stored on rows that are not visible.

#### Scenario: The case page counts visible cells only
- **WHEN** a case's stored section holds W-2s ticked and two cells on row 1, and the client has since answered No to the household question
- **THEN** the case page reads "1 field filled"

## MODIFIED Requirements

### Requirement: A save replaces the section, and a stale save is refused
`SAVE_PREPARER_FIELDS` SHALL carry exactly the whole set of filled values on the visible section, and the version it was based on. An accepted save SHALL replace the visible section and raise its version by one. Household cells already stored on rows that are not visible (capability rule "Household cells follow the household the client shows") SHALL be kept as they are, so they return if those rows become visible again. Such a kept cell SHALL NOT cause a save to be refused, and SHALL NOT be named as changed. A case with no saved section SHALL be at version 0. A save whose version is not the stored version SHALL be refused with `CONFLICT`, changing nothing. A save SHALL NOT be refused because the case changed in other ways since the preparer started. A save MAY leave every field blank, and it MAY save no change.

#### Scenario: Another action on the case doesn't block the save
- **WHEN** the office logs a contact on the case while the preparer is filling the shaded section, and the preparer then saves
- **THEN** the save is accepted

#### Scenario: A save from a second window
- **WHEN** the preparer saves the section in one window, then saves in a second window that was opened before that save
- **THEN** the second save is refused with `CONFLICT`, and the first window's values stay stored

#### Scenario: A partial save
- **WHEN** the preparer fills only the household table and saves
- **THEN** the save is accepted, and the other fields stay blank

#### Scenario: Hidden cells are kept and come back
- **WHEN** a case's stored section holds Yes in rows 1 and 2's qualifying child cells, the client changes the household answer to No, and the preparer ticks W-2s and saves
- **THEN** the save is accepted, the staff history names only "W-2s", and the row 1 and 2 cells stay stored
- **AND** when the client answers Yes again with the same two members, the editor and the draft show those cells again
- **NOTE:** today a client's answers cannot change after submission (`SAVE_ANSWERS` is accepted only at draft, and nothing returns a case to draft), so this scenario applies only once a later change lets answers change, for example staff correcting answers during the interview (#202)

### Requirement: The editing copy keeps only the shaded fields fillable
The system SHALL make an editing copy of the English 13614-C for the case's preparer. It SHALL show the client's answers as the draft does, and SHALL keep exactly the 106 shaded fields fillable, already holding the saved values on the visible section. A household cell stored on a row that is not visible SHALL NOT be filled in. Every other field SHALL be flattened. The copy SHALL be built for any client answers the draft supports, including names and addresses in Chinese, and with saved notes in Chinese. The editing copy SHALL never be uploaded or stored.

#### Scenario: Only the shaded fields are fillable
- **WHEN** the editing copy is built for a case
- **THEN** it has exactly 106 form fields, the shaded ones, and the client's answers are drawn on the pages

#### Scenario: A client with a Chinese name
- **WHEN** the editing copy is built for a client whose first name is "美玲" and whose saved income note is in Chinese
- **THEN** it builds without an error, with exactly the 106 shaded fields fillable

#### Scenario: Hidden cells are not prefilled, so Save still works
- **WHEN** the editing copy is built for a case whose stored section holds a row 1 cell and W-2s ticked, after the client changed the household answer to No
- **THEN** row 1's cells are empty and W-2s is ticked
- **AND** pressing Save without changes is accepted
