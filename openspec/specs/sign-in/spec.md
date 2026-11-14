# sign-in Specification

## Purpose
Who a signed-in account acts as: a client, or a staff member, who always acts as their own person, as the database decides from the signed-in account. It also covers how the roster creates staff accounts and chooses the default follow-up person, and how former presenter accounts were removed.

## Requirements

### Requirement: The roster can choose the default follow-up person
The roster file SHALL require a `defaultFollowup`, naming the `personKey` of a staff entry whose capabilities include `followup`. The workspace's default follow-up person SHALL become that person, and follow-ups escalated afterwards SHALL be assigned to them. Follow-ups already open SHALL keep their assignee. Withdrawal notices SHALL go to the default follow-up person, as escalated follow-ups do.

The roster command SHALL refuse a `defaultFollowup` that is missing, that names no staff entry, or that names a person without `followup`.

#### Scenario: A staff member takes new follow-ups
- **WHEN** the roster sets `defaultFollowup` to a staff member with `followup`, and a document request then goes unanswered and is escalated
- **THEN** the new follow-up is assigned to that staff member

#### Scenario: Open follow-ups stay where they are
- **WHEN** a staff member has an open follow-up and the roster sets `defaultFollowup` to another staff member
- **THEN** the open follow-up is still assigned to the first staff member

#### Scenario: No default given
- **WHEN** a roster has staff members and no `defaultFollowup`
- **THEN** the roster command refuses it, and nothing is created in the workspace

#### Scenario: A default without the capability
- **WHEN** `defaultFollowup` names a staff member whose capabilities do not include `followup`
- **THEN** the roster command refuses the roster, and the default does not change

### Requirement: A staff member with follow-up access also has admin
A staff member whose capabilities include `followup` SHALL also have `admin`, because office follow-ups are worked on the office screens, which are admin-only (capability `office-follow-up`). A staff member MAY have `admin` without `followup`.

- **The roster command** SHALL refuse a staff entry whose capabilities include `followup` but not `admin`, before it creates any account, with the message "staff[<n>].capabilities must include admin when they include followup.", where <n> is the entry's position in the list, counted from 0.
- **`add_staff_member`** SHALL refuse such capabilities with `VALIDATION`, and SHALL create nothing.
- **The database** SHALL refuse to store any person whose capabilities include `followup` but not `admin`, whoever writes the row.

The default follow-up person must hold `followup` (requirement "The roster can choose the default follow-up person"), so they SHALL always have `admin` too.

#### Scenario: The roster refuses follow-up without admin
- **WHEN** the operator runs the roster command with a staff entry at position 1 whose capabilities are `followup` and `assist`
- **THEN** the command stops with "staff[1].capabilities must include admin when they include followup.", and no account is created

#### Scenario: The database function refuses it
- **WHEN** `add_staff_member` is called with the capabilities `followup` only
- **THEN** it refuses with `VALIDATION`, and no membership or person is created

#### Scenario: No follow-up-only person can be stored
- **WHEN** a person's capabilities are written as `followup` and `review` directly in the database
- **THEN** the write is refused, and the person keeps their earlier capabilities

#### Scenario: Admin without follow-up is allowed
- **WHEN** the roster has a staff entry whose capabilities are `admin` and `receive_documents`
- **THEN** the roster accepts it, and that staff member sees "Needs office follow-up access." where a follow-up task would offer its forms

### Requirement: A signed-in account acts as a client or a staff member
Every active membership SHALL have exactly one access type:
- `applicant`: a client;
- `staff`: a staff member who signs in as themselves.

The database SHALL refuse any other access value, including `presenter`.

A `staff` membership SHALL be linked to exactly one person in its workspace, and that person SHALL be linked to no other membership. An `applicant` membership SHALL have no linked person.

#### Scenario: The two access types
- **WHEN** a roster creates one staff member and one client in a workspace
- **THEN** their memberships have access `staff` and `applicant`, and only the staff membership has a linked person

#### Scenario: Another access value is refused
- **WHEN** an operator tries to store a membership with access `admin` or `presenter`
- **THEN** the database refuses it

#### Scenario: A staff member cannot be saved without a person
- **WHEN** a transaction creates a `staff` membership and commits without linking a person to it
- **THEN** the commit is refused, and neither the membership nor anything else from that transaction is saved

#### Scenario: A person cannot be linked to a client
- **WHEN** a transaction links a person to an `applicant` membership
- **THEN** the commit is refused

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
- `vitally_prepare_account(p_action_id uuid, p_op text, p_target jsonb)`;
- `vitally_record_account(p_action_id uuid, p_op text, p_target jsonb, p_user_id uuid)`, whose user argument names the auth user being given an account, never the actor;
- `vitally_deactivate_account(p_action_id uuid, p_volunteer_id uuid, p_expected_revision bigint)` and `vitally_reactivate_account(p_action_id uuid, p_volunteer_id uuid, p_expected_revision bigint)`, whose volunteer argument names the volunteer whose account changes, never the actor;
- `vitally_client_invitations()`;
- `vitally_cancel_invitation(p_action_id uuid, p_target jsonb, p_expected_revision bigint)`, whose target names the volunteer or client whose invitation is cancelled, never the actor;
- `vitally_expire_invitations()`;
- `vitally_complete_site_check(p_name text, p_sidn text)`, which acts on the caller's own account.

None of them SHALL take a person parameter. Each SHALL be executable by `authenticated` and by no other client role.

The acting person SHALL be resolved before the request digest and the receipt, so `action_receipts.actor_person_id` records the staff member's person. The request digest SHALL keep its `personId` entry, filled with the resolved person, so receipts stored before the parameter was removed still match their replays. The acting person's capabilities SHALL be their effective capabilities (capability `volunteer-clearance`).

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

### Requirement: A client acts with no person
An `applicant` SHALL act with no person. The RPCs take no person parameter, so a client's request SHALL have no way to name one. Clients' behaviour SHALL NOT otherwise change.

#### Scenario: A client's action records no person
- **WHEN** a client submits their application
- **THEN** the receipt's actor person is empty and the actor account is the client's

#### Scenario: A client's request that names a person
- **WHEN** a client's request to `vitally_apply_action` carries a staff member's person id as `p_person_id`
- **THEN** no function matches the call, and nothing is written

### Requirement: The roster creates staff members as new people, with no reserved keys
The roster file SHALL accept a `staff` list. Each entry SHALL have:
- an `email`;
- a `name` of 1 to 80 characters;
- a `personKey` that is a valid person key;
- `capabilities` from `prepare`, `review`, `admin`, `followup`, `receive_documents` and `assist`.

For each entry, the roster command SHALL create a confirmed, password-free Auth account if none exists. In one database transaction with the rest of the workspace setup, it SHALL create the `staff` membership and link it to a person:
- If a person in the workspace has no sign-in and their volunteer profile has this account's email, ignoring case, that person SHALL be linked. They SHALL take the entry's key and capabilities, and keep the name recorded on the Roster.
- Otherwise a new person SHALL be created with that key, name and capabilities, with a volunteer profile holding the account's email and a roster entry for the current season with no roles.

Re-running the same roster SHALL create nothing new and SHALL succeed. A re-run SHALL NOT compare the name, and SHALL NOT change the name in the database.

The roster command SHALL refuse:
- a key or address that appears twice;
- an address that is also listed as a client;
- an address with an active membership in another workspace;
- a capability outside the list above, or a staff entry with no capabilities;
- a re-run that gives an existing staff member a different key or capabilities;
- a key already held in the workspace by any person who is not exactly that staff member, including a kept demonstration persona.

No person key SHALL be reserved by name. A new workspace SHALL be created with no unlinked people.

When an entry links a person already on the Roster, the roster command SHALL print a line naming that entry's key, and SHALL say so when the name on the Roster differs from the name in the file.

The roster command SHALL never print an email address.

#### Scenario: A link is reported
- **WHEN** a roster run links an entry with key `riley` to a volunteer whose Roster name differs from the file's name
- **THEN** the command prints a line naming `riley`, says the names differ, and prints no email address

#### Scenario: A staff member is added
- **WHEN** an operator adds `{ email, name: "Riley Park", personKey: "riley", capabilities: ["prepare"] }` to the `staff` list and runs the roster command
- **THEN** a confirmed account exists for that address, with a `staff` membership linked to a new person `riley` named "Riley Park" with `prepare`, and Riley is on the Roster with that email and no roles

#### Scenario: Running the roster again
- **WHEN** the operator runs the same roster again
- **THEN** it succeeds and creates no account, membership or person

#### Scenario: A volunteer already on the Roster
- **WHEN** an admin has added a volunteer named "Riley Park" with no sign-in, and the operator then runs a roster with that email, the key `riley` and `prepare`, in any letter case and under any name
- **THEN** the workspace still has one person for that volunteer, now linked to a `staff` membership with key `riley` and `prepare`, still named "Riley Park" and still with their roles and certificates

#### Scenario: A renamed staff member on a re-run
- **WHEN** an admin renames a staff member on the Roster and the operator runs the same roster again
- **THEN** it succeeds, and the staff member keeps the name given on the Roster

#### Scenario: A freed key
- **WHEN** a staff entry uses the key `sam` in a workspace that has no person with that key
- **THEN** the staff member is added as a new person `sam`

#### Scenario: A key held by a kept persona
- **WHEN** a staff entry uses the key `sam` in a workspace that kept its unlinked Sam
- **THEN** the database refuses the roster, nothing is created in the workspace, and the kept Sam stays unlinked

#### Scenario: Changed capabilities on a re-run
- **WHEN** the operator changes `riley`'s capabilities to `["prepare","review"]` and runs the roster again
- **THEN** the roster command refuses it, and `riley` keeps `prepare` only

#### Scenario: A new workspace has no personas
- **WHEN** a roster runs on a new workspace
- **THEN** the workspace's people are exactly its staff members; it has no Alex, Morgan or Sam

### Requirement: A roster needs staff and a default follow-up person
A roster SHALL list at least one staff member and SHALL name a `defaultFollowup`. A roster MAY give the site's SIDN as `siteNumber` (`S` and eight digits; spaces, hyphens and letter case ignored), which the command stores as the workspace's site number for the volunteer site check (capability `sign-in-accounts`); any other value SHALL stop the command with "siteNumber must be the site's SIDN: S followed by eight digits." A roster that still has a `presenters` list SHALL be accepted, and the command SHALL print "presenters is no longer used and was ignored; those addresses get no access." It SHALL create no account and no membership for those addresses. A workspace SHALL work for its staff and clients.

#### Scenario: A staff roster
- **WHEN** a roster lists staff members and clients and a `defaultFollowup` naming a staff member with `followup`
- **THEN** the roster command succeeds, the staff members can sign in and work cases, and new follow-ups go to that staff member

#### Scenario: An empty staff side
- **WHEN** a roster lists only clients
- **THEN** the roster command refuses it

#### Scenario: An old roster with presenters
- **WHEN** a roster that also lists `presenters` is run
- **THEN** the command prints that presenters is no longer used and those addresses get no access, and no account or membership is created for them

### Requirement: Presenter accounts are removed with their test-run history
Migration 043 SHALL remove presenter access from every stack it runs on, in one transaction. It SHALL first check whether a presenter account is referenced, and SHALL refuse with SQLSTATE `VT008`, changing nothing, if any of these exist:
- a case, case event, document, contact attempt, contact log entry, contact log version or person that references a presenter's membership;
- a case created by a presenter account;
- any other membership of a presenter account.

Its message SHALL give the count for each kind.

Otherwise it SHALL delete, in order:
1. every action receipt whose actor account is a presenter account;
2. every presenter membership;
3. every presenter account, with the Auth rows that belong to it;
4. every unlinked person with key `alex`, `morgan` or `sam` that no row references. A reference is any column that refers to people, or an action receipt's actor person.

It SHALL keep each such person that something still references. It SHALL then refuse the `presenter` access value.

After the migration, no function, constraint, policy or view in the database SHALL mention `presenter`. Each staff read policy formerly named `presenter_<table>` SHALL be named `staff_<table>`.

A former presenter address SHALL be treated at sign-in like any address not on the roster. A window still signed in as a former presenter SHALL show the no-access screen ("This account has no access", with Sign out) and SHALL load and subscribe to nothing.

#### Scenario: A stack with test-run presenters
- **WHEN** 043 runs on a stack whose presenter accounts have only receipts
- **THEN** their receipts, memberships and accounts are deleted, and every other row is unchanged except unreferenced personas

#### Scenario: A presenter referenced by real work
- **WHEN** 043 runs on a stack where a case event's actor is a presenter account
- **THEN** 043 fails with `VT008`, its message counts the referencing rows, and nothing on the stack changes

#### Scenario: Personas nothing references
- **WHEN** 043 runs on a workspace whose Alex, Morgan and Sam are referenced only by presenter receipts
- **THEN** all three are deleted

#### Scenario: A persona that is still referenced
- **WHEN** 043 runs on a workspace whose default follow-up person is Sam
- **THEN** Sam is kept, unlinked, and stays the default follow-up person

#### Scenario: A former presenter tries to sign in
- **WHEN** a former presenter address asks for a sign-in code after 043
- **THEN** the sign-in form answers as it does for an address not on the roster, and no code is sent

#### Scenario: A window still signed in
- **WHEN** a window was signed in as a presenter before 043, and refreshes afterwards
- **THEN** it shows "This account has no access" with Sign out, and loads no cases, people or workspace details

#### Scenario: The catalog has no presenter
- **WHEN** the database catalog is read after 043
- **THEN** no function source, constraint, policy name, policy expression or view contains `presenter`
