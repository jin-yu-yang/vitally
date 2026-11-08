## ADDED Requirements

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
