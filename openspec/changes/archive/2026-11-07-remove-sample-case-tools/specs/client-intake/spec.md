## REMOVED Requirements

### Requirement: Sample cases are version 2
**Reason**: Sample cases no longer exist. Migration 040 deletes them and drops the reset that seeded them.
**Migration**: The seed's cases are made through `vitally_create_case` and are version 2, as every case is (capability `local-seed-data`).

### Requirement: The sample cases include their Form 14446 answers
**Reason**: Sample cases no longer exist, and a modified requirement can't drop the scenario "A sample is complete".
**Migration**: Its live rules, that "Fill fictional details" leaves 0.4 and 1.5 to the client and that regenerating keeps the client's own 14446 answers, move unchanged to "Fictional details leave the client's 14446 answers alone" below.

## ADDED Requirements

### Requirement: Fictional details leave the client's 14446 answers alone
"Fill fictional details" SHALL NOT tick 0.4 or sign 1.5 for the client, and regenerating the fictional details SHALL keep the client's own 14446 answers.

#### Scenario: Regenerate keeps the consent
- **WHEN** a client who ticked 0.4 and signed 1.5 regenerates the fictional details
- **THEN** 0.4 is still ticked, and 1.5's answers are unchanged

#### Scenario: Fill leaves the consent to the client
- **WHEN** a client who hasn't ticked 0.4 uses "Fill fictional details"
- **THEN** 0.4 is still unticked and 1.5's signatures are still empty
