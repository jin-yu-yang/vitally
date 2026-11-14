## MODIFIED Requirements

### Requirement: A staff account acts as its own person with no person parameter
For a `staff` member, every public RPC that acts on the workspace SHALL act as the person linked to the signed-in account. The browser SHALL have no way to name another person. These RPCs and their signatures are:
- `vitally_apply_action(p_action_id uuid, p_case_id uuid, p_expected_revision bigint, p_type text, p_payload jsonb)`;
- `vitally_assistance_action(p_action_id uuid, p_item_id uuid, p_expected_revision bigint, p_type text, p_note text)`;
- `vitally_close_unsigned(p_action_id uuid, p_cases jsonb, p_confirmed boolean)`;
- `vitally_create_case(p_action_id uuid, p_mode text, p_answers jsonb)`;
- `vitally_log_contact(p_action_id uuid, p_case_id uuid, p_followup_id uuid, p_entry jsonb)`;
- `vitally_edit_contact(p_action_id uuid, p_contact_id uuid, p_expected_revision bigint, p_entry jsonb)`;
- `vitally_save_volunteer(p_action_id uuid, p_volunteer_id uuid, p_expected_revision bigint, p_volunteer jsonb)`, whose volunteer argument names the volunteer being edited, never the actor;
- `vitally_my_clearance()`;
- `vitally_save_update(p_action_id uuid, p_update_id uuid, p_expected_revision bigint, p_update jsonb)`;
- `vitally_update_action(p_action_id uuid, p_update_id uuid, p_expected_revision bigint, p_type text)`;
- `vitally_mark_updates(p_update_ids uuid[], p_confirm boolean)`;
- `vitally_my_updates()`;
- `vitally_posted_updates()`.

None of them SHALL take a person parameter. Each SHALL be executable by `authenticated` and by no other client role.

The acting person SHALL be resolved before the request digest and the receipt of every RPC that stores a receipt, so `action_receipts.actor_person_id` records the staff member's person. The request digest SHALL keep its `personId` entry, filled with the resolved person, so receipts stored before the parameter was removed still match their replays. The acting person's capabilities SHALL be their effective capabilities (capability `volunteer-clearance`).

#### Scenario: A staff call
- **WHEN** a cleared staff member whose effective capabilities include `prepare` claims preparation
- **THEN** the claim succeeds, the case's preparer is the staff member's person, and the receipt's actor is that person

#### Scenario: A request that names a person
- **WHEN** a request to any of the six case RPCs carries a `p_person_id` argument
- **THEN** no function matches the call, nothing is written, and no receipt is stored

#### Scenario: Every entry point resolves the person
- **WHEN** a cleared staff member calls each of `vitally_apply_action`, `vitally_close_unsigned`, `vitally_assistance_action`, `vitally_create_case` in assisted mode, `vitally_log_contact` and `vitally_edit_contact`
- **THEN** each call acts as, and is recorded as, the staff member's own person

#### Scenario: Capabilities still apply
- **WHEN** a cleared staff member whose effective capabilities are only `prepare` tries to close a case
- **THEN** the call is refused with `FORBIDDEN`

#### Scenario: A replay keeps its actor
- **WHEN** a cleared staff member repeats an identical request with the same action id
- **THEN** both calls return the stored receipt with the same actor, and no second change is made

#### Scenario: The old signatures are gone
- **WHEN** the database catalog is read
- **THEN** no public function takes `p_person_id`, and `public` holds exactly these thirteen RPCs, each with execute granted to `authenticated` only

#### Scenario: The read-only and naturally idempotent RPCs store no receipt
- **WHEN** a staff member calls `vitally_my_clearance`, `vitally_my_updates`, `vitally_posted_updates` or `vitally_mark_updates`
- **THEN** no action receipt is stored, and each still acts only for the signed-in person
