# sign-in Specification

## Purpose
Who a signed-in account acts as: a client; a presenter, the demonstration staff account that chooses a persona; or a staff member, who always acts as their own person, as the database decides from the signed-in account. It also covers how the roster creates staff accounts and chooses the default follow-up person, and workspaces with staff and no presenter.

## Requirements

### Requirement: A signed-in account acts as a client, a presenter or a staff member
Every active membership SHALL have exactly one access type: `applicant` (a client), `presenter` (a demonstration staff account that chooses a persona) or `staff` (a staff member who signs in as themselves). The database SHALL refuse any other access value. A `staff` membership SHALL be linked to exactly one person in its workspace, and that person SHALL be linked to no other membership. A `presenter` or `applicant` membership SHALL have no linked person.

#### Scenario: The three access types
- **WHEN** a roster creates one presenter, one staff member and one client in a workspace
- **THEN** their memberships have access `presenter`, `staff` and `applicant`, and only the staff membership has a linked person

#### Scenario: Another access value is refused
- **WHEN** an operator tries to store a membership with access `admin`
- **THEN** the database refuses it

#### Scenario: A staff member cannot be saved without a person
- **WHEN** a transaction creates a `staff` membership and commits without linking a person to it
- **THEN** the commit is refused, and neither the membership nor anything else from that transaction is saved

#### Scenario: A person cannot be linked to a presenter
- **WHEN** a transaction links a person to a `presenter` membership
- **THEN** the commit is refused

### Requirement: A staff account always acts as its own person
For a `staff` member, every public RPC that takes `p_person_id` (`vitally_apply_action`, `vitally_close_unsigned`, `vitally_assistance_action`, `vitally_create_case`, `vitally_log_contact`, `vitally_edit_contact`) SHALL act as the person linked to the signed-in account. `p_person_id` SHALL be null or that person's id; any other value SHALL be refused with `FORBIDDEN` (`VT001`) before anything is written or a receipt is reserved. The acting person SHALL be resolved before the request digest and the receipt, so `action_receipts.actor_person_id` records the staff member's person whether the call sent null or its own id. The RPCs' signatures SHALL NOT change.

#### Scenario: A staff call with no person named
- **WHEN** a staff member whose person can prepare claims preparation with `p_person_id` null
- **THEN** the claim succeeds, the case's preparer is the staff member's person, and the receipt's actor is that person

#### Scenario: A staff call naming its own person
- **WHEN** the same staff member sends their own person's id
- **THEN** the result is the same as sending null

#### Scenario: A staff call naming someone else
- **WHEN** a staff member sends the id of another person in the workspace (another staff member's, or Alex's)
- **THEN** the call is refused with `FORBIDDEN`, nothing changes, and no receipt is stored

#### Scenario: Every entry point resolves the person
- **WHEN** a staff member calls each of `vitally_apply_action`, `vitally_close_unsigned`, `vitally_assistance_action`, `vitally_create_case` in assisted mode, `vitally_log_contact` and `vitally_edit_contact`, once with null and once with another person's id
- **THEN** each null call acts as the staff member's own person, and each call naming another person is refused with `FORBIDDEN`

#### Scenario: Capabilities still apply
- **WHEN** a staff member whose person has only `prepare` tries to close a case
- **THEN** the call is refused with `FORBIDDEN`, as it would be for a presenter acting as a person without `admin`

#### Scenario: A replay keeps its actor
- **WHEN** a staff member repeats a request with the same action id, once with `p_person_id` null and once with their own id
- **THEN** both return the stored receipt, and no second change is made

### Requirement: A presenter cannot act as a staff member's person
A `presenter` SHALL keep choosing any unlinked person in its workspace as `p_person_id`, as before. A `presenter` call whose `p_person_id` names a person linked to a staff account SHALL be refused with `FORBIDDEN`.

#### Scenario: A presenter chooses a demo persona
- **WHEN** a presenter acts as Alex, an unlinked person
- **THEN** the action is checked against Alex's capabilities and recorded as Alex, as before this change

#### Scenario: A presenter tries a staff member's person
- **WHEN** a presenter sends the id of a person linked to a staff account
- **THEN** the call is refused with `FORBIDDEN`

### Requirement: A client acts as themselves, as before
An `applicant` SHALL act with no person: `p_person_id` SHALL be null, and any other value SHALL be refused with `FORBIDDEN`. Clients' behaviour SHALL NOT change.

#### Scenario: A client names a person
- **WHEN** a client calls `vitally_apply_action` with a person's id
- **THEN** the call is refused with `FORBIDDEN`

### Requirement: The roster creates staff members as new people
The roster file SHALL accept an optional `staff` list. Each entry SHALL have an `email`, a `name` of 1 to 80 characters, a `personKey` that is a valid person key, and `capabilities` from `prepare`, `review`, `admin`, `followup`, `receive_documents` and `assist`. For each entry, the roster command SHALL create a confirmed, password-free Auth account if none exists. In one database transaction with the rest of the workspace setup, it SHALL create the `staff` membership and a new person with that key, name and capabilities, linked to the membership. Re-running the same roster SHALL create nothing new and SHALL succeed. The roster command SHALL refuse:
- a staff entry whose `personKey` is `alex`, `morgan` or `sam` (reserved for the demonstration personas);
- a key or address that appears twice;
- an address that is also listed as a presenter or a client;
- an address with an active membership in another workspace;
- a capability outside the list above, or a staff entry with no capabilities;
- a re-run that gives an existing staff member a different name, key or capabilities.

The roster command SHALL never print an email address.

#### Scenario: A staff member is added
- **WHEN** an operator adds `{ email, name: "Riley Park", personKey: "riley", capabilities: ["prepare"] }` to the `staff` list and runs the roster command
- **THEN** a confirmed account exists for that address, with a `staff` membership linked to a new person `riley` named "Riley Park" with `prepare`

#### Scenario: Running the roster again
- **WHEN** the operator runs the same roster again
- **THEN** it succeeds and creates no account, membership or person

#### Scenario: A reserved key
- **WHEN** a staff entry uses the key `sam`
- **THEN** the roster command refuses the roster, and nothing is created in the workspace

#### Scenario: Changed capabilities on a re-run
- **WHEN** the operator changes `riley`'s capabilities to `["prepare","review"]` and runs the roster again
- **THEN** the roster command refuses it, and `riley` keeps `prepare` only

#### Scenario: The demonstration personas stay
- **WHEN** a roster that adds staff members runs on a new workspace
- **THEN** the workspace also has Alex, Morgan and Sam, unlinked, with their usual capabilities

### Requirement: A workspace can have staff and no presenter
A roster SHALL need at least one presenter or one staff member, and SHALL NOT require a presenter. A roster with no presenter SHALL name a `defaultFollowup`. A workspace with no presenter SHALL work for staff and clients.

#### Scenario: A staff-only roster
- **WHEN** a roster lists staff members and clients, no presenters, and a `defaultFollowup` naming a staff member with `followup`
- **THEN** the roster command succeeds, the staff members can sign in and work cases, and new follow-ups go to that staff member

#### Scenario: A staff-only roster without a follow-up person
- **WHEN** a roster lists staff members and no presenters, and has no `defaultFollowup`
- **THEN** the roster command refuses it, and nothing is created in the workspace

#### Scenario: An empty staff side
- **WHEN** a roster lists only clients
- **THEN** the roster command refuses it

### Requirement: The roster can choose the default follow-up person
The roster file SHALL accept an optional `defaultFollowup`, naming the `personKey` of a staff entry whose capabilities include `followup`. When given, the workspace's default follow-up person SHALL become that person, and follow-ups escalated afterwards SHALL be assigned to them. Follow-ups already open SHALL keep their assignee. When `defaultFollowup` is absent, which a roster with a presenter allows, the default SHALL stay as it is (Sam in a new workspace). Withdrawal notices SHALL go to the default follow-up person, as escalated follow-ups do. The roster command SHALL refuse a `defaultFollowup` that names no staff entry, or a person without `followup`.

#### Scenario: A staff member takes new follow-ups
- **WHEN** the roster sets `defaultFollowup` to a staff member with `followup`, and a document request then goes unanswered and is escalated
- **THEN** the new follow-up is assigned to that staff member

#### Scenario: Open follow-ups stay where they are
- **WHEN** Sam has an open follow-up and the roster sets `defaultFollowup` to a staff member
- **THEN** the open follow-up is still assigned to Sam

#### Scenario: No default given
- **WHEN** a roster with a presenter and staff members has no `defaultFollowup`
- **THEN** Sam stays the default follow-up person

#### Scenario: A default without the capability
- **WHEN** `defaultFollowup` names a staff member whose capabilities do not include `followup`
- **THEN** the roster command refuses the roster, and the default does not change

### Requirement: A presenter account gets a plain screen and no staff screens
When an account whose membership has access `presenter` signs in, the app SHALL show one screen in English with:
- the heading "This account is no longer used";
- the text "Presenter mode has been removed. Ask your site coordinator for a staff account.";
- a Sign out button.

It SHALL show nothing else: no work board, case page, office screen, persona picker, sample reset, checkpoint or class-workspace indicator. The app SHALL load no cases, people, help requests or workspace details for a presenter, and SHALL start no live updates for one. Sign out SHALL work as it does for any account. This SHALL hold until presenter access is removed from the database.

#### Scenario: A presenter signs in
- **WHEN** the presenter signs in through the sign-in form
- **THEN** the screen says "This account is no longer used" and "Presenter mode has been removed. Ask your site coordinator for a staff account.", with Sign out, and shows no board, no case and no presenter controls

#### Scenario: Nothing is loaded for a presenter
- **WHEN** a presenter's window is open on the plain screen and a case changes in the workspace
- **THEN** the window shows no case data and its screen does not change

#### Scenario: A presenter signs out
- **WHEN** a presenter on the plain screen presses Sign out
- **THEN** the window returns to the sign-in form

#### Scenario: A staff member and a client are unchanged
- **WHEN** a staff member or a client signs in
- **THEN** they get their own screens as before
