## ADDED Requirements

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
- that ViTally and PCDC never ask for a password, Social Security number or bank details by email.

A volunteer's invitation email SHALL be in English. It SHALL say:
- that they were added to the PCDC VITA volunteer roster;
- that the first time they sign in they confirm their site with their name and the site's SIDN, which their site coordinator gives them, without giving the SIDN;
- that ViTally shows what is still needed for the season before they can work on cases.

#### Scenario: A client's invitation
- **WHEN** an admin invites a fictional client
- **THEN** one email reaches the address, in English and 简体, with the configured sign-in link, the expiry in New York time and the line that ViTally and PCDC never ask for a password, Social Security number or bank details by email, and with no six-digit run

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

## MODIFIED Requirements

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
5. send the invitation email to that address.

The invitation SHALL expire seven days after it is recorded. A volunteer with no roles or certificates SHALL be allowed an account. `admin` and `followup` SHALL NOT be granted by Create account. A repeated request with the same action id SHALL return the stored result and create nothing more.

Create account SHALL be disabled, with "Save your changes first.", while the drawer has unsaved changes, so the invitation always goes to the saved email. Before anything is sent, the drawer SHALL ask "Send a sign-in invitation to <email>?" with the saved email, and only its confirmation SHALL send.

When the email cannot be sent, the account SHALL stay `invited`, and the drawer SHALL say "Account created; the invitation email wasn't sent. Use Resend later." A repeated request that returns the stored result SHALL say "This invitation was already sent. If it didn't arrive, use Resend.", never that the email was not sent. Otherwise it SHALL say "Account created and invitation sent".

#### Scenario: Creating an account
- **WHEN** an admin presses Create account for a volunteer with an email and no sign-in
- **THEN** the volunteer has an active `staff` membership, their account is `invited`, their capabilities are `assist`, `prepare`, `receive_documents` and `review`, an invitation email with no code reaches their address, the drawer says "Account created and invitation sent", and the Roster shows "Invited"

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
- **THEN** the account is created and the volunteer is not cleared

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

## RENAMED Requirements

- FROM: `### Requirement: Resend sends a new code to an invited account`
- TO: `### Requirement: Resend sends the invitation again to an invited account`
