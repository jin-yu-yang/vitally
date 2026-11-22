## MODIFIED Requirements

### Requirement: An admin can create a volunteer's account from the Roster
The Roster Edit drawer SHALL have an Account section after the season section, showing the account status: "Not created", "Invited", "Active" or "Deactivated". With no account, it SHALL offer Create account.

Create account SHALL go through the `accounts` Edge Function, which SHALL:
1. identify the caller from their session;
2. check the request in the database, writing nothing;
3. create a confirmed, password-free auth user for the volunteer's profile email, unless an auth user with that email exists with no account row, which SHALL be reused;
4. in one database transaction:
   - create the volunteer's active `staff` membership;
   - link the person to it, so their capabilities become those of their current-season roles (capability `volunteer-clearance`);
   - record the account as `invited` with `invited_at` and the admin who invited them;
   - store an action receipt;
5. send the invitation email to that address.

The invitation SHALL expire seven days after it is recorded. A volunteer with no roles or certificates SHALL be allowed an account. Create account SHALL NOT choose any capability: a volunteer gets `admin` and `followup` only from the Admin role, which only a site coordinator gives (capability `volunteer-roster`). A repeated request with the same action id SHALL return the stored result and create nothing more.

Create account SHALL be disabled, with "Save your changes first.", while the drawer has unsaved changes, so the invitation always goes to the saved email. Before anything is sent, the drawer SHALL ask "Send a sign-in invitation to <email>?" with the saved email, and only its confirmation SHALL send.

When the email cannot be sent, the account SHALL stay `invited`, and the drawer SHALL say "Account created; the invitation email wasn't sent. Use Resend later." A repeated request that returns the stored result SHALL say "This invitation was already sent. If it didn't arrive, use Resend.", never that the email was not sent. Otherwise it SHALL say "Account created and invitation sent".

#### Scenario: Creating an account
- **WHEN** an admin presses Create account for a volunteer with an email, no sign-in and the Preparer role
- **THEN** the volunteer has an active `staff` membership, their account is `invited`, their capabilities are `prepare`, an invitation email with no code reaches their address, the drawer says "Account created and invitation sent", and the Roster shows "Invited"

#### Scenario: Signing in after the invitation
- **WHEN** that volunteer enters their email on the sign-in screen and then the code they are sent
- **THEN** they are signed in, their account is still `invited`, and they see "Confirm your site"

#### Scenario: Unsaved changes
- **WHEN** an admin changes the email in the drawer and has not saved
- **THEN** Create account is disabled, and says "Save your changes first."

#### Scenario: Confirming the address
- **WHEN** an admin presses Create account for a volunteer whose saved email is ada@example.org
- **THEN** the drawer asks "Send a sign-in invitation to ada@example.org?", and nothing is sent until the admin confirms

#### Scenario: A volunteer waiting for their form
- **WHEN** an admin creates an account for a volunteer with no roles
- **THEN** the account is created, the volunteer has no capabilities, and is not cleared

#### Scenario: Reusing an account-less auth user
- **WHEN** an auth user exists for the volunteer's email with no account row, and an admin presses Create account
- **THEN** that auth user is linked, and no second auth user is created

#### Scenario: A repeated request
- **WHEN** the same Create account request is sent twice with the same action id
- **THEN** one membership and one account exist, both answers are the same, and the drawer says "This invitation was already sent. If it didn't arrive, use Resend."

#### Scenario: The email is not sent
- **WHEN** the account is recorded but the sender refuses the invitation email
- **THEN** the account is `invited`, and the drawer says "Account created; the invitation email wasn't sent. Use Resend later."

### Requirement: An admin can deactivate and reactivate a volunteer's account
The drawer SHALL offer Deactivate for an `invited` or `active` staff account, after a confirmation, and Reactivate for a `deactivated` one. Both SHALL be database RPCs that take an action id, the volunteer and the account revision the drawer read. They SHALL refuse a stale revision with `CONFLICT`. They SHALL store a receipt, and a replay SHALL return it.

Deactivate SHALL:
- in one transaction, set the account to `deactivated` with `deactivated_at`, and make the membership inactive;
- keep the auth user and the person's link, so the email stays locked and the person stays on the Roster;
- be refused with `OPEN_WORK` (SQLSTATE VT004), the open work as its detail, while the person holds open work as defined for a volunteer save. Being the default follow-up person SHALL always count as open work here, site coordinator or not. The drawer SHALL say "<name> still has open work: <list>. Finish it or hand it over first.";
- be refused with `INVALID_TRANSITION` (`LAST_SITE_COORDINATOR`) for the last site coordinator, and the drawer SHALL say "At least one site coordinator must remain. Make someone else a site coordinator first.";
- for any other site coordinator, remove their site coordinator mark in the same transaction (capability `site-coordinators`);
- be refused with `VALIDATION` (`SELF`) for the caller's own account.

Reactivate SHALL:
- make the membership active again;
- set the account to `active` if the person has signed in before, or to `invited` if not;
- send no email;
- restore the account only: the person SHALL still need roles, certificates and any photo ID check to be cleared, and SHALL NOT be a site coordinator again;
- be refused with `VALIDATION` (`EMAIL_IN_USE`) when the user meanwhile has an active membership in another workspace.

Deactivate and reactivate SHALL each be built on one internal function that acts on a single membership, so a season rollover can reuse them.

Clients SHALL NOT be deactivated in this release.

A Reactivate that gives `invited` SHALL start a new seven days and a new five site-check attempts.

#### Scenario: Deactivating
- **WHEN** an admin deactivates a volunteer who holds no open work
- **THEN** the account is `deactivated`, the membership is inactive, the Roster shows "Deactivated", and the volunteer's open window shows "This account has no access"

#### Scenario: Deactivating with open work
- **WHEN** an admin deactivates a volunteer who is preparing an open case
- **THEN** it is refused with `OPEN_WORK`, the drawer lists that case, and the account is unchanged

#### Scenario: Deactivating the default follow-up person
- **WHEN** a site coordinator deactivates the default follow-up person, who is another site coordinator
- **THEN** it is refused with `OPEN_WORK`, and the drawer lists being the default follow-up person

#### Scenario: Deactivating the last site coordinator
- **WHEN** an admin who is not a site coordinator deactivates the only site coordinator, who is not the default follow-up person
- **THEN** it is refused with `FORBIDDEN` (only a site coordinator deactivates a site coordinator, capability `site-coordinators`), and the account is unchanged

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

### Requirement: A volunteer confirms the site at first sign-in
A signed-in volunteer whose account is `invited` SHALL see "Confirm your site" instead of the setup screen or the work, and SHALL enter their name (required, at most 80 characters) and the site's SIDN. Client invitations SHALL have no site check.

The SIDN SHALL be a workspace setting, `S` followed by eight digits, set by a site coordinator on Season settings (capability `season-settings`). No signed-in user SHALL read it. Spaces, hyphens and letter case in the number entered SHALL be ignored. The repository, the seed, the tests and screenshots SHALL use fictional numbers only.

The check SHALL be a database RPC for the caller's own account. In order:
- an invitation past its `expires_at` SHALL be cancelled, and the window SHALL say "This invitation was cancelled. Ask your site coordinator to invite you again.";
- a missing name SHALL be refused with `VALIDATION` (`NO_NAME`), "Enter your name.", and counts as no attempt;
- a blank SIDN SHALL be refused with `VALIDATION` (`NO_SIDN`), "Enter this site's SIDN.", and counts as no attempt;
- a workspace with no SIDN SHALL refuse with `VALIDATION` (`SITE_NOT_SET`), "This site isn't set up for sign-in yet. Ask your site coordinator.", and counts as no attempt;
- the right SIDN SHALL make the account `active` with `activated_at`, and store the name as the volunteer's signed-in name;
- a wrong SIDN SHALL keep the account `invited`, count one attempt, and say "That isn't this site's number.";
- the fifth wrong SIDN SHALL cancel the invitation, as Cancel invitation does.

When the RPC answers `FORBIDDEN` because the invitation was cancelled meanwhile, the window SHALL show the cancelled message; when it answers `INVALID_TRANSITION` because an earlier press already passed, the window SHALL read the clearance again and move on.

The signed-in name SHALL be stored on the admin-only volunteer profile, never on the person. The RPC SHALL be refused with `FORBIDDEN` for a caller with no `invited` volunteer account of their own, and with `INVALID_TRANSITION` once the account is not `invited`.

#### Scenario: The right number
- **WHEN** an invited volunteer enters their name and the site's SIDN
- **THEN** their account is `active`, the Roster shows "Active" and "Signed in as <name>", and they see "Finish your setup for this season" until they are cleared

#### Scenario: A wrong number
- **WHEN** an invited volunteer enters another SIDN
- **THEN** they see "That isn't this site's number.", and their account is still `invited`

#### Scenario: Five wrong numbers
- **WHEN** an invited volunteer enters a wrong SIDN for the fifth time
- **THEN** the invitation is cancelled, and the volunteer has no access

#### Scenario: No case data before the check
- **WHEN** an invited volunteer with roles and certificates has signed in but not passed the site check
- **THEN** they read no cases, documents, document requests or client events, and every case action is refused with `NOT_CLEARED`

#### Scenario: A SIDN changed on Season settings
- **WHEN** a site coordinator changes the SIDN on Season settings, and an invited volunteer then enters the old number
- **THEN** they see "That isn't this site's number.", and the new number passes
