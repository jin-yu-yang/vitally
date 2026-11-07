## ADDED Requirements

### Requirement: A seed re-run publishes no deletion and keeps receipts
When a seed run deletes its previous set, the deletion SHALL NOT be published to any member over realtime, as no deletion ever is. The action receipts that named the deleted cases SHALL remain, as historical records.

#### Scenario: An applicant sees no deletion
- **WHEN** the seed runs again on a workspace and deletes its previous cases
- **THEN** no member's realtime stream carries a deletion of those cases

#### Scenario: Receipts outlive the deleted cases
- **WHEN** the seed runs again and deletes a case that earlier actions targeted
- **THEN** those actions' receipts are still there, naming the deleted case's id

#### Scenario: A re-run never reuses a client number
- **WHEN** the seed runs again on a workspace, in the same season
- **THEN** the new set's client numbers are all higher than any number the previous set used
