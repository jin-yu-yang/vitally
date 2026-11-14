# sign-in-accounts Specification

## Purpose
Sign-in accounts made from inside ViTally: one account per membership recording whether it is invited, active or deactivated, and how an admin gives a volunteer an account (Create account, Resend, Deactivate, Reactivate in the Roster drawer) or invites a client (the office screen's Invite a client panel), through the `accounts` Edge Function and the database rules behind it. It covers which emails are refused, how first sign-in makes an account active, and how the roster command and existing memberships get accounts.

## Requirements

### Requirement: Each membership has at most one account recording its sign-in status
The database SHALL keep an `accounts` row for a membership, keyed by the membership's workspace and user, with:
- a status of `invited`, `active` or `deactivated`;
- `invited_at`, `activated_at` and `deactivated_at`;
- a revision.

A `staff` membership's account SHALL name its person. An `applicant` membership's account SHALL name no person. "Not created" SHALL mean that no row exists; it SHALL NOT be stored.

Only a workspace admin SHALL read the workspace's account rows. No signed-in user SHALL write them directly. `accounts` SHALL NOT be in the realtime publication.

#### Scenario: An admin reads accounts
- **WHEN** an admin reads `accounts`
- **THEN** they get their own workspace's rows only

#### Scenario: Others read nothing
- **WHEN** a staff member without `admin`, a client or an anonymous caller reads `accounts`
- **THEN** they get no rows

#### Scenario: No direct writes
- **WHEN** a signed-in admin inserts, updates or deletes an `accounts` row directly
- **THEN** the write is refused

#### Scenario: A client account has no person
- **WHEN** a transaction stores a client's account that names a person
- **THEN** the commit is refused

### Requirement: Existing memberships get account rows when accounts are introduced
The migration that adds `accounts` SHALL give:
- every active membership an `active` row, with `activated_at` from the user's last sign-in, or the migration time if they never signed in;
- every inactive membership a `deactivated` row.

It SHALL change no membership, person or other existing row.

#### Scenario: Existing staff stay cleared
- **WHEN** the migration runs on a workspace whose cleared staff member has an active membership
- **THEN** their account is `active`, and they are still cleared

#### Scenario: An inactive membership
- **WHEN** the migration runs where a membership is inactive
- **THEN** its account is `deactivated`

### Requirement: The roster command and workspace setup create active accounts
Every staff member and client created by the roster command SHALL get an `active` account in the same transaction as their membership. Re-running the same roster SHALL create no second account.

#### Scenario: A roster run
- **WHEN** the operator runs a roster with one staff member and one client on a new workspace
- **THEN** both memberships have `active` accounts, and the staff member's account names their person

#### Scenario: A re-run
- **WHEN** the same roster runs again
- **THEN** each membership still has exactly one account

### Requirement: An account becomes active when its person first signs in
When a user signs in, every `invited` account of that user SHALL become `active`, with `activated_at` set to that time and its revision increased, before the session's first request reaches the database. `deactivated` accounts SHALL NOT change on sign-in.

#### Scenario: First sign-in
- **WHEN** an invited volunteer signs in with their emailed code
- **THEN** their account is `active` and the Roster shows "Active"

#### Scenario: A deactivated person signs in
- **WHEN** a person whose account is `deactivated` completes a sign-in
- **THEN** their account stays `deactivated`, and the window shows "This account has no access"

### Requirement: An admin can create a volunteer's account from the Roster
The Roster Edit drawer SHALL have an Account section after the season section, showing the account status: "Not created", "Invited", "Active" or "Deactivated". With no account, it SHALL offer Create account.

Create account SHALL go through the `accounts` Edge Function, which SHALL:
1. identify the caller from their session;
2. check the request in the database, writing nothing;
3. create a confirmed, password-free auth user for the volunteer's profile email, unless an auth user with that email exists with no account row, which SHALL be reused;
4. in one database transaction:
   - create the volunteer's active `staff` membership;
   - link the person to it;
   - set the person's capabilities to `prepare`, `review`, `receive_documents` and `assist`;
   - record the account as `invited` with `invited_at` and the admin who invited them;
   - store an action receipt;
5. send the sign-in code email to that address.

A volunteer with no roles or certificates SHALL be allowed an account. `admin` and `followup` SHALL NOT be granted by Create account. A repeated request with the same action id SHALL return the stored result and create nothing more.

When the email cannot be sent, the account SHALL stay `invited`, and the drawer SHALL say "Account created; the email wasn't sent. Use Resend in a minute." Otherwise it SHALL say "Account created and sign-in code sent".

#### Scenario: Creating an account
- **WHEN** an admin presses Create account for a volunteer with an email and no sign-in
- **THEN** the volunteer has an active `staff` membership, their account is `invited`, their capabilities are `assist`, `prepare`, `receive_documents` and `review`, a sign-in code email reaches their address, and the Roster shows "Invited"

#### Scenario: Signing in after the invitation
- **WHEN** that volunteer enters their email and the emailed code on the sign-in screen
- **THEN** they are signed in, their account is `active`, and they see "Finish your setup for this season" until they are cleared

#### Scenario: A volunteer waiting for their form
- **WHEN** an admin creates an account for a volunteer with no roles
- **THEN** the account is created and the volunteer is not cleared

#### Scenario: Reusing an account-less auth user
- **WHEN** an auth user exists for the volunteer's email with no account row, and an admin presses Create account
- **THEN** that auth user is linked, and no second auth user is created

#### Scenario: A repeated request
- **WHEN** the same Create account request is sent twice with the same action id
- **THEN** one membership and one account exist, and both answers are the same

#### Scenario: The email is not sent
- **WHEN** the account is recorded but the sign-in email is refused by the mail limit
- **THEN** the account is `invited`, and the drawer says "Account created; the email wasn't sent. Use Resend in a minute."

### Requirement: Resend sends a new code to an invited account
While an account is `invited`, the drawer for a volunteer, and the office panel for a client, SHALL offer Resend. Resend SHALL send a new sign-in code email to the account's address through the same Edge Function, and SHALL change no record. Resend SHALL be refused with `INVALID_TRANSITION` for an account that is not `invited`. An invitation SHALL NOT expire: an invited person SHALL be able to request a code from the sign-in screen at any time.

#### Scenario: Resend
- **WHEN** an admin presses Resend for an invited volunteer
- **THEN** a new sign-in code email reaches the volunteer, and the account is still `invited`

#### Scenario: Resend for an active account
- **WHEN** a Resend request names an `active` account
- **THEN** it is refused with `INVALID_TRANSITION`, and no email is sent

#### Scenario: Signing in without the email
- **WHEN** an invited volunteer whose code expired asks for a code on the sign-in screen
- **THEN** a code is sent, and they can sign in

### Requirement: An admin can invite a client from the office screen
The office screen SHALL show an admin an "Invite a client" panel with an email field and an Invite button. Below them it SHALL list the workspace's client accounts, newest first, each with its email, its status ("Invited" or "Active") and, while Invited, Resend. Staff without `admin` SHALL NOT see the panel, and SHALL be refused the list with `FORBIDDEN`.

Invite SHALL go through the `accounts` Edge Function with the same steps as Create account. It SHALL create an active `applicant` membership and an `invited` account with no person, and send the sign-in code email. The client SHALL then sign in with the emailed code as clients do today. Public self-registration SHALL stay off. A client who never signs in SHALL need no account.

#### Scenario: Inviting a client
- **WHEN** an admin enters a fictional client's email and presses Invite
- **THEN** the client has an active `applicant` membership and an `invited` account, a sign-in code email reaches the address, and the panel lists the client as "Invited"

#### Scenario: The client signs in
- **WHEN** the invited client signs in with the emailed code
- **THEN** they see the client screens, and the panel lists them as "Active"

#### Scenario: A non-admin
- **WHEN** a staff member without `admin` opens the office screen or asks for the client list
- **THEN** no panel is shown, and the list is refused with `FORBIDDEN`

### Requirement: Create account and Invite refuse emails that belong to someone else
Emails SHALL be compared ignoring case, across every workspace. Before any auth user is created or anything is written, the database SHALL refuse with `VALIDATION`, giving the reason as the error detail:
- `NO_EMAIL`: Create account for a volunteer with no email ("Add an email first");
- `ALREADY_INVITED`: the target already has an `invited` or `active` account, or Invite names an email whose user has a client account ("This client is already invited");
- `USE_REACTIVATE`: Create account for a volunteer whose account is `deactivated` ("This account is deactivated. Use Reactivate.");
- `EMAIL_IN_USE`: the email belongs to a user with any account row, staff or client, in any status, that is not the target's own ("That email is already used by another sign-in. Use another email.");
- `EMAIL_ON_ROSTER`: Invite with an email that is on a volunteer profile in any workspace ("That email belongs to a volunteer. Use another email.").

An auth user with that email and no account row at all SHALL be reused, not refused. A caller who is not a workspace admin SHALL be refused with `FORBIDDEN`, and a volunteer outside the workspace's current roster with `NOT_FOUND`. The roster command SHALL keep its own checks.

#### Scenario: A volunteer email used by a client
- **WHEN** an admin presses Create account for a volunteer whose email, in different letter case, is a client's sign-in in another workspace
- **THEN** it is refused with `EMAIL_IN_USE`, no auth user is created, and the drawer says to use another email

#### Scenario: A client email used by staff
- **WHEN** an admin invites an email that is a staff member's sign-in
- **THEN** it is refused with `EMAIL_IN_USE`

#### Scenario: A client email on the Roster
- **WHEN** an admin invites an email that is on a volunteer profile with no sign-in
- **THEN** it is refused with `EMAIL_ON_ROSTER`

#### Scenario: A deactivated volunteer
- **WHEN** an admin presses Create account for a volunteer whose account is deactivated
- **THEN** it is refused with `USE_REACTIVATE`

#### Scenario: A deactivated email invited as a client
- **WHEN** an admin invites an email whose user has a `deactivated` staff account
- **THEN** it is refused with `EMAIL_IN_USE`

#### Scenario: No email
- **WHEN** Create account is requested for a volunteer with no profile email
- **THEN** it is refused with `NO_EMAIL`

#### Scenario: A non-admin calls the function
- **WHEN** a staff member without `admin` sends a Create account request
- **THEN** it is refused with `FORBIDDEN`, and nothing is created

### Requirement: An admin can deactivate and reactivate a volunteer's account
The drawer SHALL offer Deactivate for an `invited` or `active` staff account, after a confirmation, and Reactivate for a `deactivated` one. Both SHALL be database RPCs that take an action id, the volunteer and the account revision the drawer read. They SHALL refuse a stale revision with `CONFLICT`. They SHALL store a receipt, and a replay SHALL return it.

Deactivate SHALL:
- in one transaction, set the account to `deactivated` with `deactivated_at`, and make the membership inactive;
- keep the auth user and the person's link, so the email stays locked and the person stays on the Roster;
- be refused with `OPEN_WORK` (SQLSTATE VT004), the open work as its detail, while the person holds open work as defined for a volunteer save. The drawer SHALL say "<name> still has open work: <list>. Finish it or hand it over first.";
- be refused with `VALIDATION` (`SELF`) for the caller's own account.

Reactivate SHALL:
- make the membership active again;
- set the account to `active` if the person has signed in before, or to `invited` if not;
- send no email;
- restore the account only: the person SHALL still need roles, certificates and any photo ID check to be cleared;
- be refused with `VALIDATION` (`EMAIL_IN_USE`) when the user meanwhile has an active membership in another workspace.

Deactivate and reactivate SHALL each be built on one internal function that acts on a single membership, so a season rollover can reuse them.

Clients SHALL NOT be deactivated in this release.

#### Scenario: Deactivating
- **WHEN** an admin deactivates a volunteer who holds no open work
- **THEN** the account is `deactivated`, the membership is inactive, the Roster shows "Deactivated", and the volunteer's open window shows "This account has no access"

#### Scenario: Deactivating with open work
- **WHEN** an admin deactivates a volunteer who is preparing an open case
- **THEN** it is refused with `OPEN_WORK`, the drawer lists that case, and the account is unchanged

#### Scenario: Deactivating yourself
- **WHEN** an admin deactivates their own account
- **THEN** it is refused with `VALIDATION`

#### Scenario: Reactivating someone who signed in before
- **WHEN** an admin reactivates a deactivated volunteer who had signed in
- **THEN** the account is `active`, the membership is active, no email is sent, and the volunteer is cleared only if their roles and photo ID check allow it

#### Scenario: Reactivating someone who never signed in
- **WHEN** an admin reactivates a deactivated volunteer who never signed in
- **THEN** the account is `invited`, and Resend is offered

#### Scenario: A stale drawer
- **WHEN** two admins open the same volunteer, one deactivates, and the other then presses Deactivate
- **THEN** the second is refused with `CONFLICT`

### Requirement: The Roster shows each volunteer's account
Each Roster row SHALL show an Account column with "Not created", "Invited", "Active" or "Deactivated".

#### Scenario: The four states
- **WHEN** the Roster has a volunteer with no account, one invited, one active and one deactivated
- **THEN** their Account column shows "Not created", "Invited", "Active" and "Deactivated"
