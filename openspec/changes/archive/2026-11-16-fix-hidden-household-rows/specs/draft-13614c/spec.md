## MODIFIED Requirements

### Requirement: The draft shows the preparer's shaded section
When the case has a saved shaded section (capability `shaded-section`), the staff draft Form 13614-C SHALL show its values in the English, Simplified Chinese and Traditional Chinese forms:
- each household cell SHALL read Yes, No or N/A, in English on every form;
- each ticked checkbox SHALL be ticked;
- counts, amounts, the VIN, the year and the reason SHALL read as saved. An amount SHALL have no dollar sign.

A household cell SHALL be printed only on a visible household row (`shaded-section` rule "Household cells follow the household the client shows"). A cell stored on a row that is not visible SHALL stay empty on the draft. Text in Chinese SHALL be printed as typed. A field left blank SHALL stay empty. Household members past row 4 SHALL keep their Additional Comments lines unchanged. A case with no saved section SHALL have a draft that is unchanged by this requirement.

#### Scenario: The values in every form
- **WHEN** the staff draft is built in English, Simplified Chinese and Traditional Chinese for a case whose saved section has row 1 qualifying child Yes, W-2s ticked and 2 W-2s
- **THEN** each draft shows Yes in row 1's qualifying child cell, the W-2s box ticked and 2 as their number

#### Scenario: No saved section
- **WHEN** the staff draft is built for a case with no saved shaded section
- **THEN** the shaded section of the draft is empty

#### Scenario: Cells for members the client no longer shows
- **WHEN** the staff draft is built for a case whose saved section has Yes in rows 1 and 2's qualifying child cells and W-2s ticked, after the client changed the household answer from Yes to No
- **THEN** rows 1 and 2's cells are empty, and the W-2s box is ticked

#### Scenario: Three visible members
- **WHEN** the staff draft is built for a case with three household members and saved cells on rows 1 to 3
- **THEN** rows 1 to 3 show their cells

### Requirement: The draft's stamp says whether it holds preparer entries
The draft Form 13614-C SHALL carry the stamp "DRAFT – prepared from online answers, <date>, <reference>" at the top of every page, continued pages included. When the case has any saved shaded value that the draft prints (household cells on rows that are not visible don't count), the stamp SHALL instead read "DRAFT – online answers and preparer entries, <date>, <reference>". The date SHALL read MM/DD/YYYY and the reference SHALL be the case's reference.

#### Scenario: A draft with preparer entries
- **WHEN** the staff draft is built on 2026-02-14 for case VT-ABCD-EFGH, which has a saved shaded section
- **THEN** every page reads "DRAFT – online answers and preparer entries, 02/14/2026, VT-ABCD-EFGH"

#### Scenario: A draft without preparer entries
- **WHEN** the staff draft is built on 2026-02-14 for case VT-ABCD-EFGH, which has no saved shaded section
- **THEN** every page reads "DRAFT – prepared from online answers, 02/14/2026, VT-ABCD-EFGH"

#### Scenario: Only hidden cells are stored
- **WHEN** the staff draft is built on 2026-02-14 for case VT-ABCD-EFGH, whose saved section holds only row 1 cells, after the client changed the household answer to No
- **THEN** every page reads "DRAFT – prepared from online answers, 02/14/2026, VT-ABCD-EFGH"
