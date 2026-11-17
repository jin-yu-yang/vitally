# draft-13614c Specification

## Purpose
What the draft Form 13614-C, which ViTally fills from a client's intake answers for the volunteer, shows: which answers go into which fields on the form, when the spouse's lines are filled, and how a household member's name reads on the dependents rows and in Additional Comments.

## Requirements

### Requirement: A household member's name on the draft shows first, middle and last name
On the draft Form 13614-C, each household member's name SHALL read first, middle and last name, with the full middle name, separated by single spaces and skipping any part that is empty. This SHALL hold on the dependents row (`nameFirstLast`, rows 1–4) and on the Additional Comments line for every member past row 4. The taxpayer's and spouse's middle initials at the top of the form SHALL be unchanged.

#### Scenario: A member with a middle name
- **WHEN** the draft is built for a household member with first name "Ana", middle name "Mei" and last name "Lin"
- **THEN** that member's dependents row name reads "Ana Mei Lin"

#### Scenario: A member without a middle name
- **WHEN** the draft is built for a household member with first name "Ana", last name "Lin" and no middle name
- **THEN** that member's dependents row name reads "Ana Lin"

#### Scenario: A member past row 4
- **WHEN** the draft is built for five household members and the fifth has first name "Eva", middle name "Q" and last name "Lin"
- **THEN** the Additional Comments line for that member gives the name as "Eva Q Lin"

### Requirement: The draft's not-sure lines quote the wording the client saw
When the draft Form 13614-C lists a question answered "Not sure" in Additional Comments, it SHALL quote the question in the wording that application's client saw. The rule is "filing with the spouse possible": married, or widowed with the spouse's death in 2025. When filing with the spouse isn't possible, the line SHALL use the wording without a spouse. When it is possible, the line SHALL use the wording with the spouse.

#### Scenario: An unmarried client unsure whether someone can claim them
- **WHEN** the draft is built for a never-married client who answered Q5.2 "Not sure"
- **THEN** the Additional Comments line quotes "Can anyone else (such as a parent or adult child) claim you as a dependent on their tax return?"

#### Scenario: A married client unsure whether someone can claim them
- **WHEN** the draft is built for a married client who answered Q5.2 "Not sure"
- **THEN** the Additional Comments line quotes "Can anyone else (such as a parent or adult child) claim you or your spouse as a dependent on their tax return?"

#### Scenario: A client whose spouse died in 2025
- **WHEN** the draft is built for a widowed client whose spouse died in 2025 and who answered Q5.2 "Not sure"
- **THEN** the Additional Comments line quotes the wording with the spouse

### Requirement: The draft's spouse lines appear only when a joint return is possible
The draft Form 13614-C SHALL fill the spouse's name, middle initial, date of birth and job title only when filing with the spouse is possible: married, or widowed with the spouse's death in 2025. For a widowed client, it SHALL tick the widowed box and fill the year of the spouse's death. For a widowed client whose spouse died in 2023 or 2024, the spouse lines SHALL stay empty, even though the intake asked for the spouse's name and date of birth.

#### Scenario: A spouse who died in 2025
- **WHEN** the draft is built for a widowed client whose spouse, Wei Lin, died in 2025
- **THEN** the widowed box is ticked, the year reads 2025, and the spouse's first name reads "Wei"

#### Scenario: A spouse who died in 2024
- **WHEN** the draft is built for a widowed client whose spouse, Wei Lin, died in 2024
- **THEN** the widowed box is ticked, the year reads 2024, and the spouse's name lines are empty

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

### Requirement: Long shaded notes continue in Additional Comments
Each block's shaded notes SHALL be printed in their own box, wrapped to its width at its font size, with line breaks kept. What doesn't fit SHALL continue in Additional Comments under the line "Continued from page <n>, <block> notes:", followed by the rest of the note, and from there onto continued pages as Additional Comments does. No part of a note SHALL be cut off.

#### Scenario: A note longer than its box
- **WHEN** the staff draft is built for a case whose Standard or itemized deductions notes are 400 characters long
- **THEN** the box shows the note's first lines, and Additional Comments continues it under "Continued from page 3, Standard or itemized deductions notes:", with every character of the note printed

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
