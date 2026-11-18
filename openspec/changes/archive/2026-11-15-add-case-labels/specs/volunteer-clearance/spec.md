## MODIFIED Requirements

### Requirement: Only a cleared staff member reads case data
Every SELECT policy that gives a `staff` member access to case data SHALL require the caller to be cleared. These policies are on:
- admin_followups, assistance_items, case_contacts, case_document_cards, case_events, case_label_links, case_labels, case_materials, cases;
- client_events, contact_attempts, contact_log, contact_log_versions, document_requests, documents;
- filing_attempts, filing_notes, filing_returns;
- preparation_participants, preparer_questionnaires, preparer_shaded_fields, reviewer_questionnaires, reviews.

The check SHALL be the no-argument `vitally_policy.cleared_workspace_id()`, used as an uncorrelated subquery so it is evaluated once per statement. A client's access through the same policies SHALL NOT change. `people` SHALL NOT be gated, so an uncleared staff member still reads their own row and the other staff names.

#### Scenario: An uncleared staff member reads nothing
- **WHEN** a staff member who is not cleared reads each of the 23 tables
- **THEN** they get no rows

#### Scenario: They still read people
- **WHEN** a staff member who is not cleared reads `people`
- **THEN** they get their own row and the default follow-up person's row

#### Scenario: A cleared staff member reads as before
- **WHEN** a cleared staff member reads each of the 23 tables
- **THEN** they get the same rows a staff member got before this change, and the label tables' rows of their workspace on cases they can see

#### Scenario: Clients are unchanged
- **WHEN** a client reads their own case, documents and requests
- **THEN** they get the same rows as before this change

#### Scenario: Live updates stop
- **WHEN** an uncleared staff member is subscribed to changes on `cases`, and a case changes
- **THEN** they receive no change

#### Scenario: Every case-data policy is gated
- **WHEN** the database catalog is read
- **THEN** every policy with a staff branch, except on `people`, calls `vitally_policy.cleared_workspace_id()`

#### Scenario: Evaluated once per statement
- **WHEN** a cleared staff member reads many rows of `cases` in one statement
- **THEN** the plan evaluates `vitally_policy.cleared_workspace_id()` once, as an InitPlan, not per row

### Requirement: The case RPCs refuse an uncleared staff member first
`vitally_apply_action`, `vitally_assistance_action`, `vitally_close_unsigned`, `vitally_create_case`, `vitally_log_contact`, `vitally_edit_contact`, `vitally_set_case_label` and `vitally_save_label` SHALL refuse a `staff` caller who is not cleared with `NOT_CLEARED` (SQLSTATE VT009). The refusal SHALL come after the caller is resolved and before any case, item, contact, label or receipt is read. Nothing SHALL be written, and no receipt SHALL be stored. A client caller SHALL NOT be checked. `vitally_save_volunteer` SHALL NOT be checked.

#### Scenario: Each case RPC
- **WHEN** an uncleared staff member calls each of the eight RPCs
- **THEN** each is refused with `NOT_CLEARED`, and nothing changes

#### Scenario: An unknown id
- **WHEN** an uncleared staff member calls `vitally_apply_action` with a case id that does not exist
- **THEN** it is refused with `NOT_CLEARED`, not `NOT_FOUND`

#### Scenario: A replay
- **WHEN** a staff member who lost clearance repeats an action id that succeeded while they were cleared
- **THEN** it is refused with `NOT_CLEARED`

#### Scenario: A client is not checked
- **WHEN** a client submits their application
- **THEN** it succeeds as before

#### Scenario: An uncleared admin can still save a volunteer
- **WHEN** an admin with no roles saves their own certificates and Admin role through `vitally_save_volunteer`
- **THEN** the save succeeds, and they are cleared
