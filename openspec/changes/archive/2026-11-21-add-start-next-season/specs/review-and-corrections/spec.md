## MODIFIED Requirements

### Requirement: The Exit Form's header comes from the case
The Exit Form SHALL show the tax year (the case's season − 1, matching the season's label "<season> for TY <season − 1>"), the date it was made, the client number, and the taxpayer's name. For a couple (married, or widowed in the tax year, by the intake's own spouse rule) the name SHALL read "Taxpayer & Spouse". The date SHALL be the day the form is made, not the day of the approval.

#### Scenario: A single taxpayer's header
- **WHEN** the form is made on 11/01/2026 for Mei Chen, client number 31, season 2026
- **THEN** it shows 2025, 11/01/2026, 31 and Mei Chen

#### Scenario: A couple's header
- **WHEN** the form is made for a married taxpayer Mei Chen and spouse Lin Wu
- **THEN** the name reads "Mei Chen & Lin Wu"
