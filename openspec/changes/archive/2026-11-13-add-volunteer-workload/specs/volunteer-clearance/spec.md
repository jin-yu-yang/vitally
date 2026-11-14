## MODIFIED Requirements

### Requirement: The caller's capabilities come from their roles, within the roster ceiling
For a `staff` caller, every public RPC SHALL use effective capabilities: the union of the capabilities of the caller's current-season roles, intersected with the person's `people.capabilities`. A caller with no roles SHALL have no effective capabilities. The role capabilities SHALL be:
- Greeter: none;
- Intaker: `receive_documents`, `assist`;
- Preparer: `prepare`;
- Reviewer: `prepare`, `review`;
- Admin: `admin`, `followup`, `assist`, `receive_documents`.

Checks of another person's capability, for example that a follow-up assignee or the default follow-up person has `followup`, SHALL keep reading that person's `people.capabilities`. The one exception SHALL be the person an admin assigns as a case's preparer or reviewer (`ASSIGN_CASE`, capability `volunteer-workload`): their `prepare` or `review` SHALL be read from their effective capabilities. The Roster's admin check SHALL keep reading the caller's `people.capabilities`. Independent review SHALL be unchanged: a preparation participant SHALL still be refused the review with `SELF_REVIEW`.

#### Scenario: A role narrower than the ceiling
- **WHEN** a cleared staff member whose `people.capabilities` are `prepare` and `review` has only the Preparer role, and claims a review
- **THEN** the claim is refused with `INELIGIBLE`

#### Scenario: A role wider than the ceiling
- **WHEN** a cleared staff member whose `people.capabilities` are only `review` has the Reviewer role, and claims preparation
- **THEN** the claim is refused with `INELIGIBLE`

#### Scenario: Creating an assisted case
- **WHEN** a cleared staff member whose ceiling includes `admin` but whose only role is Intaker creates an assisted case
- **THEN** it is refused with `FORBIDDEN`

#### Scenario: The self-review rule still holds
- **WHEN** a cleared Reviewer prepares a case and then tries to claim its review
- **THEN** the claim is refused with `SELF_REVIEW`

#### Scenario: Assigning a reviewer whose role is narrower than the ceiling
- **WHEN** an admin assigns, as a case's reviewer, a cleared person whose `people.capabilities` are `prepare` and `review` but whose only role is Preparer
- **THEN** it is refused with `INELIGIBLE`

### Requirement: A signed-in staff member's buttons follow their effective capabilities
The staff screens SHALL decide which of the signed-in staff member's own buttons, links and screens to offer from their effective capabilities. Lists of other people, for example filters and follow-up holders, SHALL keep using those people's `people.capabilities`. The Workload's rows and its Assign/Reassign picker (capability `volunteer-workload`) SHALL instead use those people's effective capabilities, as the database does.

#### Scenario: A Preparer under a wider ceiling
- **WHEN** a cleared staff member whose ceiling is `prepare` and `review`, and whose only role is Preparer, opens a case waiting for review
- **THEN** no claim-review button is offered

#### Scenario: The picker follows effective capabilities
- **WHEN** an admin opens Assign for a case's reviewer, and a cleared volunteer's ceiling is `prepare` and `review` but their only role is Preparer
- **THEN** that volunteer is not offered

### Requirement: Staff assign work only to a cleared person
When a staff member's action puts another person on a case, a follow-up or a help request that the system did not choose, the database SHALL refuse the action with `INELIGIBLE` if that person is not cleared. Nothing SHALL be written, and no receipt SHALL be stored. Any picker that offers people for such an assignment SHALL list only cleared people.

Work the system assigns to the workspace's default follow-up person SHALL never be refused because that person is not cleared, whether a staff member's action or a client's triggers it. This covers escalating a document request, approving a review, closing a case and a client's withdrawal. Claiming preparation, a review or a help request puts the caller on the work, and the caller is already checked.

Filters SHALL keep listing people by `people.capabilities`. An admin's assignment of a case's preparer or reviewer SHALL also require the assignee's effective capabilities to include `prepare` or `review` respectively, and its picker SHALL apply the same rule.

The functions that write a case's preparer or reviewer, a follow-up's or help request's assignee, or the default follow-up person SHALL be exactly these:
- `act_claim_preparation`, `act_claim_review` and `act_assistance_claim`: the caller;
- `act_assign_case`: the person an admin chose, checked with `require_cleared_assignee`;
- `act_escalate_contact`, `act_approve_review`, `act_close_case` and `act_withdraw`: the default follow-up person;
- `set_default_followup`: the roster command;
- `hand_to_review` and `act_request_corrections`, which clear the reviewer.

A new function that assigns work SHALL be added to that list together with this check.

#### Scenario: Today's assignments
- **WHEN** the database catalog is read for functions that write those columns or insert follow-ups, help requests, reviews or preparation participants
- **THEN** exactly the functions listed above do, so a new assignment path fails the test until it is classified

#### Scenario: Claims assign only the caller
- **WHEN** a cleared preparer claims preparation, a cleared reviewer claims a review, and a cleared intaker claims a help request
- **THEN** each piece of work is assigned to the caller

#### Scenario: An uncleared default follow-up person
- **WHEN** the default follow-up person is not cleared, and a cleared staff member escalates a document request
- **THEN** the follow-up is created and assigned to the default follow-up person

#### Scenario: A client's withdrawal
- **WHEN** the default follow-up person is not cleared, and a client withdraws their application
- **THEN** the withdrawal succeeds, and its notice is assigned to the default follow-up person

#### Scenario: A staff assignment to someone uncleared
- **WHEN** an admin assigns or reassigns a case's preparer to a person who has the Preparer role but is not cleared
- **THEN** it is refused with `INELIGIBLE`, nothing is written, no receipt is stored, and the picker offered no such person
