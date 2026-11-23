# sign-in-accounts Specification

## Purpose
Sign-in accounts made from inside ViTally: one account per membership recording whether it is invited, active or deactivated, and how an admin gives a volunteer an account (Create account, Resend, Deactivate, Reactivate in the Roster drawer) or invites a client (the office screen's Invite a client panel), through the `accounts` Edge Function and the database rules behind it. It covers which emails are refused, how first sign-in makes an account active (after a site check for a volunteer), how an invitation is cancelled or expires, and how the roster command and existing memberships get accounts.

## Requirements

### Requirement: Each membership has at most one account recording its sign-in status
The database SHALL keep an `accounts` row for a membership, keyed by the membership's workspace and user, with:
- a status of `invited`, `active` or `deactivated`;
- `invited_at`, `activated_at` and `deactivated_at`;
- `expires_at`, set while the account is `invited`;
- the number of wrong site numbers entered at the site check;
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

### Requirement: A client's account becomes active at first sign-in or first use, a volunteer's after the site check
When a user signs in, before the session's first request reaches the database:
- every `invited` account of that user past its `expires_at` SHALL be cancelled, as Cancel invitation does;
- every other `invited` client account of that user SHALL become `active`, with `activated_at` set to that time, `expires_at` cleared and its revision increased;
- an `invited` volunteer account SHALL stay `invited` until the volunteer passes the site check.

`deactivated` accounts SHALL NOT change on sign-in.

A client who already holds a session when they are invited (or reactivated) does not sign in again, so a client's `invited` account SHALL also become `active` the first time they act as a member:
- **their first read:** once the window finds the client's membership, and before it reads anything else, it SHALL call `vitally_activate_client_account()`. That RPC SHALL make the caller's own `invited` client account `active`, unless the invitation is past its seven days and its membership is not in use, in which case it SHALL cancel it, as expiry does, and the window SHALL show no access;
- **their first action:** any row written that refers to the client's membership (a case they own, a case event, document or contact entry they made) SHALL first make that client's `invited` account `active`.

A volunteer's account SHALL NOT become `active` by use; only the site check makes it `active`.

#### Scenario: A client's first sign-in
- **WHEN** an invited client signs in with the code the sign-in screen sends them
- **THEN** their account is `active`, and the office panel lists them as "Active"

#### Scenario: A volunteer's first sign-in
- **WHEN** an invited volunteer signs in with the code the sign-in screen sends them
- **THEN** their account is still `invited`, the Roster shows "Invited", and their window shows "Confirm your site"

#### Scenario: A deactivated person signs in
- **WHEN** a person whose account is `deactivated` completes a sign-in
- **THEN** their account stays `deactivated`, and the window shows "This account has no access"

#### Scenario: An expired invitation signs in
- **WHEN** a client whose invitation is past its seven days signs in with a code
- **THEN** the invitation is cancelled, and the client has no access

#### Scenario: Re-invited client who never signed in again
- **WHEN** a client whose invitation was cancelled still holds a session, an admin invites them again, and the client reloads the window without signing in
- **THEN** their account becomes `active` at that first read, and a case they start keeps it `active`

#### Scenario: A client acts before their first read
- **WHEN** a row referring to an invited client's membership is written, such as a case they start
- **THEN** their account becomes `active` first

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

### Requirement: Resend sends the invitation again to an invited account
While an account is `invited`, the drawer for a volunteer, and the office panel for a client, SHALL offer Resend. Resend SHALL send the invitation email to the account's address again through the same Edge Function, and SHALL start the invitation's seven days again, increasing the account revision. It SHALL change nothing else. The window SHALL say "Invitation sent", or "The invitation email wasn't sent. Use Resend later." when it cannot be sent. Resend SHALL be refused with `INVALID_TRANSITION` for an account that is not `invited`, including a volunteer's cancelled because it expired; a client named by an email that no longer has an account SHALL be refused with `NOT_FOUND`. Within its seven days, an invited person SHALL be able to request a code from the sign-in screen.

A Reactivate that gives `invited` SHALL say "Account reactivated. Use Resend to send the invitation."

#### Scenario: Resend
- **WHEN** an admin presses Resend for an invited volunteer whose invitation has one day left
- **THEN** a new invitation email reaches the volunteer, showing the new expiry, the account is still `invited`, it now expires seven days from the resend, and the drawer says "Invitation sent"

#### Scenario: Resend for an active account
- **WHEN** a Resend request names an `active` account
- **THEN** it is refused with `INVALID_TRANSITION`, and no email is sent

#### Scenario: Signing in without the email
- **WHEN** an invited volunteer who never opened the invitation asks for a code on the sign-in screen
- **THEN** a code is sent, and they can sign in

### Requirement: An admin can invite a client from the office screen
The office screen SHALL show an admin an "Invite a client" panel with an email field and an Invite button. Below them it SHALL list the workspace's client accounts, newest first, each with its email, its status ("Invited" or "Active") and, while Invited, Resend and Cancel. Before anything is sent, Invite SHALL ask "Send a sign-in invitation to <email>?" with the email as typed and trimmed, and only its confirmation SHALL send. Staff without `admin` SHALL NOT see the panel, and SHALL be refused the list with `FORBIDDEN`.

Invite SHALL go through the `accounts` Edge Function with the same steps as Create account. It SHALL create an active `applicant` membership and an `invited` account with no person, expiring in seven days, and send the invitation email. The panel SHALL say "Account created and invitation sent", or "Account created; the invitation email wasn't sent. Use Resend later." when it cannot be sent. The client SHALL then sign in from the sign-in screen with the code they are sent, as clients do today. Public self-registration SHALL stay off. A client who never signs in SHALL need no account.

#### Scenario: Inviting a client
- **WHEN** an admin enters a fictional client's email and presses Invite
- **THEN** the client has an active `applicant` membership and an `invited` account, an invitation email with no code reaches the address, and the panel lists the client as "Invited"

#### Scenario: The client signs in
- **WHEN** the invited client enters their email on the sign-in screen and then the code they are sent
- **THEN** they see the client screens, and the panel lists them as "Active"

#### Scenario: A non-admin
- **WHEN** a staff member without `admin` opens the office screen or asks for the client list
- **THEN** no panel is shown, and the list is refused with `FORBIDDEN`

### Requirement: Create account and Invite refuse emails that belong to someone else
Emails SHALL be compared ignoring case, across every workspace. Before any auth user is created or anything is written, the database SHALL refuse with `VALIDATION`, giving the reason as the error detail:
- `NO_EMAIL`: Create account for a volunteer with no email ("Add an email first");
- `ALREADY_INVITED`: the target already has an `invited` or `active` account, or Invite names an email whose user has a client account ("This person is already invited or signed in.");
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
- be refused with `OPEN_WORK` (SQLSTATE VT004), the open work as its detail, while the person holds open work as defined for a volunteer save, which counts only current-season cases (capability `volunteer-roster`). Being the default follow-up person SHALL always count as open work here, site coordinator or not. The drawer SHALL say "<name> still has open work: <list>. Finish it or hand it over first.";
- be refused with `INVALID_TRANSITION` (`LAST_SITE_COORDINATOR`) for the last site coordinator, and the drawer SHALL say "At least one site coordinator must remain. Make someone else a site coordinator first.";
- for any other site coordinator, remove their site coordinator mark in the same transaction (capability `site-coordinators`);
- be refused with `VALIDATION` (`SELF`) for the caller's own account.

Reactivate SHALL:
- make the membership active again;
- set the account to `active` if the person has signed in before, or to `invited` if not;
- send no email;
- restore the account only: the person SHALL still need roles, certificates and any photo ID check to be cleared, and SHALL NOT be a site coordinator again;
- be refused with `VALIDATION` (`EMAIL_IN_USE`) when the user meanwhile has an active membership in another workspace.

Deactivate and reactivate SHALL each be built on one internal function that acts on a single membership, so Start next season can reuse them (capability `season-rollover`), deactivating each account as Deactivate does.

Clients SHALL NOT be deactivated in this release.

A Reactivate that gives `invited` SHALL start a new seven days and a new five site-check attempts.

#### Scenario: Deactivating
- **WHEN** an admin deactivates a volunteer who holds no open work
- **THEN** the account is `deactivated`, the membership is inactive, the Roster shows "Deactivated", and the volunteer's open window shows "This account has no access" the next time it wakes (focus, the tab becoming visible, `online`, or a realtime reconnect), without a reload

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

#### Scenario: A past-season case is not open work
- **WHEN** an admin deactivates a volunteer whose only cases are Accepted cases from an earlier season
- **THEN** the account is `deactivated`

### Requirement: An admin can cancel an invitation that was never completed
The drawer SHALL offer Cancel invitation, after a confirmation, for a volunteer whose account is `invited` and was never `active`; the office panel SHALL offer Cancel for such a client. It SHALL be a database RPC that takes an action id, the target (the volunteer, or the client's email) and the account revision the window read. It SHALL refuse a stale revision with `CONFLICT`, an account that is not `invited`, or was ever `active`, with `INVALID_TRANSITION`, and a membership that is in use (anything other than the person's link and the account refers to it) with `INVALID_TRANSITION` and the reason `IN_USE`. It SHALL store a receipt, and a replay SHALL return it.

In one transaction, Cancel invitation SHALL:
- delete the account row and the membership;
- for a volunteer, clear the person's link to the sign-in, set the person's capabilities to none, and increase the profile revision, so the email can be edited and saved again;
- keep the auth user, which then has no account row and is reused by a later Create account or Invite for that email.

A cancelled invitee's sign-in code SHALL give no access. The window SHALL say "Invitation cancelled." This is the only way an email linked to a sign-in becomes editable again; it SHALL NOT apply to an account that was ever `active`.

#### Scenario: Cancelling a volunteer's invitation
- **WHEN** an admin cancels the invitation of a volunteer who never signed in
- **THEN** the volunteer has no membership and no account, the Roster shows "Not created", and the drawer's email can be changed and saved

#### Scenario: A cancelled invitee signs in
- **WHEN** the volunteer whose invitation was cancelled signs in with a code the sign-in screen sends them
- **THEN** they have no membership, read no case data, and every RPC refuses them

#### Scenario: Refused once active
- **WHEN** an admin tries to cancel the invitation of a volunteer who passed the site check
- **THEN** it is refused with `INVALID_TRANSITION`, and the account stays `active`

#### Scenario: Cancelling a client's invitation
- **WHEN** an admin presses Cancel for an invited client in the office panel
- **THEN** the client has no membership and no account, and the panel no longer lists them

### Requirement: An invitation not completed in seven days is cancelled
An `invited` account that was never `active` and is past its `expires_at` SHALL be cancelled with the same effect as Cancel invitation. Expiry SHALL be applied whenever the account is next looked at: by every account RPC, the office panel's list, the Roster's read (through an admin RPC that cancels the workspace's expired invitations), the site check and the person's sign-in. An expired invitee SHALL never have been cleared, so nothing SHALL be able to act as them before the cancellation is applied.

Expiry SHALL never break the read or action that applies it:
- an invitation whose membership is in use (anything other than the person's link and the account refers to it) SHALL NOT be cancelled; it SHALL be left as it is;
- a cancellation that fails anyway SHALL be undone on its own, logged as a database warning and skipped, and the rest SHALL go on;
- the admin RPC SHALL answer how many invitations it cancelled, left in use and failed to cancel: `{cancelled, inUse, failed}`.

#### Scenario: Seven days pass
- **WHEN** a volunteer's invitation is past its seven days and an admin opens the Roster
- **THEN** the invitation is cancelled, and the Roster shows "Not created"

#### Scenario: Creating the account again
- **WHEN** an admin presses Create account for that volunteer
- **THEN** it is not refused as already invited, and the old auth user is reused

#### Scenario: An expired invitation already in use
- **WHEN** a client's invitation is past its seven days, but they own a case, and an admin opens the Roster or the office panel
- **THEN** the invitation is left as it is, the client keeps their access, and the Roster and the office panel load

#### Scenario: A cancellation fails
- **WHEN** cancelling an expired invitation fails for a reason the database did not foresee
- **THEN** that invitation is skipped and logged, the others are cancelled, and the Roster, the office panel, the account RPCs and the sign-in keep working

### Requirement: The Roster shows each volunteer's account
Each Roster row SHALL show an Account column with "Not created", "Invited", "Active" or "Deactivated", and, once the volunteer has passed the site check, "Signed in as <name>" with the name they entered. The drawer's Account section SHALL show the same line.

#### Scenario: The four states
- **WHEN** the Roster has a volunteer with no account, one invited, one active and one deactivated
- **THEN** their Account column shows "Not created", "Invited", "Active" and "Deactivated"

#### Scenario: The signed-in name
- **WHEN** a volunteer entered "Rowan P." at the site check
- **THEN** their Roster row and drawer show "Signed in as Rowan P."

### Requirement: The invitation email has no code and says where to sign in
Create account, Invite and Resend SHALL send one invitation email to the account's address, built by the `accounts` Edge Function and not by Auth. It SHALL NOT contain a sign-in code, a link that signs the person in, or any run of six digits. It SHALL say:
- that the PCDC VITA site invited this address to ViTally;
- to go to the sign-in link and sign in with this email, and that a code is sent when they sign in;
- when the invitation expires, as a date and a time in New York time, seven days after it was sent, and that after that they should ask the site to invite them again.

The sign-in link SHALL be the function's `VITALLY_SITE_URL` setting, with nothing added to it. The email SHALL contain no personal data, not even the recipient's address: no name, and nothing from a case or a profile. The expiry shown SHALL be within one minute of the account's `expires_at`.

#### Scenario: The expiry matches the account
- **WHEN** an invitation is sent
- **THEN** the expiry in the email is within one minute of the account's `expires_at`

#### Scenario: First sign-in after the invitation
- **WHEN** an invitee asks for a code on the sign-in screen and enters it
- **THEN** they are signed in on that first try

#### Scenario: No personal data
- **WHEN** an invitation is sent for a volunteer whose profile has a name and a phone number
- **THEN** the email contains neither

### Requirement: A client's invitation is in English and 简体, a volunteer's in English
A client's invitation email SHALL be in English followed by 简体, with a subject in both. It SHALL say:
- that the PCDC VITA free tax site invited them to ViTally, to answer the questions for their tax return and see which documents to bring;
- that ViTally never asks for a password, Social Security number or bank details by email.

A volunteer's invitation email SHALL be in English. It SHALL say:
- that they were added to the PCDC VITA volunteer roster;
- that the first time they sign in they confirm their site with their name and the site's SIDN, which their site coordinator gives them, without giving the SIDN;
- that ViTally shows what is still needed for the season before they can work on cases.

#### Scenario: A client's invitation
- **WHEN** an admin invites a fictional client
- **THEN** one email reaches the address, in English and 简体, with the configured sign-in link, the expiry in New York time and the line that ViTally never asks for a password, Social Security number or bank details by email, and with no six-digit run

#### Scenario: A volunteer's invitation
- **WHEN** an admin creates an account for a fictional volunteer
- **THEN** one English email reaches the address, with the configured sign-in link, the expiry, a line saying they will confirm their site with their name and the site's SIDN at first sign-in, and a line saying ViTally shows what is still needed for the season, and with no SIDN value and no six-digit run

### Requirement: The accounts function sends through exactly one configured sender
The `accounts` Edge Function SHALL send invitations through Resend's HTTP API when `RESEND_API_KEY` is set, and through the mail catcher's HTTP API when `VITALLY_MAIL_CATCHER_URL` is set. Exactly one of the two SHALL be set, and `VITALLY_SITE_URL` SHALL be set. Otherwise every request SHALL be answered with `SERVER_ERROR`, before anything is created, and the log SHALL name the variables, never their values. Local stacks and CI SHALL NOT have `RESEND_API_KEY`.

#### Scenario: No sender configured
- **WHEN** neither `RESEND_API_KEY` nor `VITALLY_MAIL_CATCHER_URL` is set
- **THEN** a Create account request is answered with `SERVER_ERROR`, and no auth user or account is created

#### Scenario: Both senders configured
- **WHEN** both `RESEND_API_KEY` and `VITALLY_MAIL_CATCHER_URL` are set
- **THEN** a Create account request is answered with `SERVER_ERROR`, and nothing is created

#### Scenario: No site URL
- **WHEN** `VITALLY_SITE_URL` is not set
- **THEN** a request is answered with `SERVER_ERROR`

### Requirement: The answer says whether the invitation email was sent
Create and Invite SHALL send their action id as Resend's idempotency key. The answer's `emailSent` SHALL be:
- `true` when the sender accepts the email;
- `true` when Resend answers `409 invalid_idempotent_request`, because that key was already sent;
- `false` for `409 concurrent_idempotent_requests`, any other refusal, a network error, or no answer within the send timeout.

A failed send SHALL be logged with the sender's error name and HTTP status, never the address or the key. It SHALL change nothing in the database.

#### Scenario: The same action reaches Resend again
- **WHEN** Resend answers an invitation with `409 invalid_idempotent_request`
- **THEN** the answer has `emailSent: true`

#### Scenario: A concurrent request with the same key
- **WHEN** Resend answers an invitation with `409 concurrent_idempotent_requests`
- **THEN** the answer has `emailSent: false`, and the account stays `invited`

### Requirement: Removing a volunteer from the roster deactivates their account as Deactivate does
Removing a volunteer from this season's roster (capability `volunteer-roster`) SHALL deactivate their account through the same internal function that Deactivate and Start next season use, when the account is `invited` or `active` and is not a site coordinator's. The deactivation SHALL be recorded with the remover as the person who changed it. It SHALL send no email.

The removal SHALL NOT cancel an invitation: an `invited` account SHALL become `deactivated`, keeping the auth user, the membership and the person's link, so the email stays linked to the person.

With no account, or an account already `deactivated`, the removal SHALL NOT call the deactivation, and the account SHALL be unchanged.

Afterwards, Reactivate SHALL work as for any deactivated account: `active` if the person signed in before, otherwise `invited` with a new seven days.

#### Scenario: An active account
- **WHEN** an admin removes a volunteer with an active account
- **THEN** the account is `deactivated` with `deactivated_at` set, the membership is inactive, and the Roster's search offers the person as an earlier volunteer with the account shown as deactivated

#### Scenario: An invited account
- **WHEN** an admin removes a volunteer whose invitation is still pending
- **THEN** the account is `deactivated`, the membership is inactive but kept, and the profile email can't be edited

#### Scenario: Reactivating after a re-add
- **WHEN** a removed volunteer who had signed in is added back and an admin presses Reactivate
- **THEN** the account is `active`, and the volunteer is cleared only once their roles and photo ID check allow it

#### Scenario: The removed volunteer's window
- **WHEN** a removed volunteer has the work board open and the window then regains focus
- **THEN** their window shows "This account has no access", without a reload
