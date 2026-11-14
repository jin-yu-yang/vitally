<!--
Raw capture of superpowers:brainstorming output.
Recorded 2026-11-13 from the verbal brainstorm in the conversation (explore, then Q1-Q6).
-->

# add-account-invitations: brainstorm

## Background

Next slice of #138 (volunteer roster, clearance and site coordinator). Today:

- Volunteers can be added to the Roster (`vitally_save_volunteer`, change add-volunteer-roster-records), but the only way to give anyone a sign-in is the operator's roster command (`tools/admin/roster.mjs`), which creates confirmed, password-free auth users plus `staff` / `applicant` memberships from a JSON file.
- "Has a sign-in" means `people.user_id` is set through an active `staff` membership. The Roster email lock and the admin-only visibility of volunteers with no sign-in both rest on that.
- Clearance (change add-volunteer-clearance): `vitally_private.cleared(workspace, person)` checks roles and the photo ID only. The sign-in part is in `vitally_policy.cleared_workspace_id()` (045), which requires an active `staff` membership, recorded as "usable sign-in = active staff membership, until the accounts table exists".
- Clients exist only as `applicant` memberships created from the roster file's `applicants` list. There is no client list on the staff side.
- Sign-in is `signInWithOtp({ shouldCreateUser: false })` plus a typed 6-digit code (`src/auth.mjs`). Public sign-up is off (`[auth] enable_signup = false`).
- No Edge Function exists (no `supabase/functions/`). The test stack, locally and in CI (`.github/actions/test-stack`), starts with `--exclude ... edge-runtime ...` and `[edge_runtime] enabled = false`.
- No hosted Supabase project exists yet (docs/setup.md section 6, pending).
- The test stack has a local mail catcher (`[local_smtp]`) but `[auth.rate_limit] email_sent = 2` per hour. Tests never read mail: codes come from `auth.admin.generateLink`, and the browser suites intercept `/auth/v1/otp`.

Decisions the user brought in as settled (from the design notes):

- An `accounts` table with status, `invited_at` and `deactivated_at`.
- "Create account" is a separate step after "Add a volunteer". A Supabase Edge Function (server side) sends the sign-in email.
- Roster states: Not created · Invited · Active · Deactivated. Resend while Invited. The Account section goes in the Edit drawer.
- The same Edge Function serves the client invitation. Office staff enter a client's email, ViTally sends an invitation, and the client signs in with the emailed code as today. Client states: Not created · Invited · Active. Public self-registration stays off. Drop-off and same-day clients need no account.
- Deactivating is refused while the person holds open work, reusing the open-work rule from add-volunteer-clearance.
- A volunteer email already used by a client sign-in is refused ("use another email"). The check runs across staff and client sign-in emails.
- The email is locked once the person has a sign-in. Volunteer contact details stay in admin-only `volunteer_profiles`.
- `cleared()` requires an active account. Fixtures and seed:local must keep main green.
- The roster command stays as the bootstrap for the first admin. Roster access stays on the `people.capabilities` ceiling.
- Fictional data only. Staff screens are English.

## Conflicts raised with the settled decisions

1. "`accounts`, one per person" cannot cover clients: clients are not in `people`; they are only an `applicant` membership.
2. "not_created" cannot be a stored row for a client: no client record exists before the invitation.

## Decision chain

**Q1. What is `accounts` keyed on?**
Options: one row per person (does not fit clients); one row per auth user (but deactivation ends a workspace link, not the auth user); one row per membership.
**Decided (user):** one row per membership. `membership_id` unique; `person_id` nullable, set for staff only; status `invited | active | deactivated`. "Not created" is the absence of a row and is not stored. `is_site_coordinator` must be able to sit on the same row later.

**Q1b. Does `is_site_coordinator` land now or in the site coordinator change?**
**Decided (user):** next change. A column nothing reads or writes would have no spec and no test, and adding it later is a one-line migration. A later check can enforce "site coordinator implies a staff row with a person".

**Q2. Where do client invitations live, and who sends them?**
Options: an "Invite a client" panel on the office screen (admin-only); a separate "Clients" sidebar screen; a wider gate (`receive_documents`, Intakers).
**Decided (user):** a panel on the office screen, admin-only. It has an email field and an Invite button, and below them the clients invited in this workspace, each with email, status (Invited / Active) and Resend while Invited.

**Q3. What does Deactivate do, and can it be undone?**
**Decided (user):**
- Deactivate is a database RPC, not the Edge Function. In one transaction it sets the account to `deactivated` with `deactivated_at`, and sets the membership's `active = false`. It is refused with the existing open-work list ("<name> still has open work: ... Finish it or hand it over first.").
- The auth user is kept, not banned. With no active membership, a signed-in window gets "This account has no access", and a new code request is treated like an address not on the roster (the path 043 built for former presenters).
- `people.user_id` stays set, so the email stays locked and the person stays visible to staff. A deactivated person is not cleared, so they cannot be assigned work.
- Staff only. Clients get no Deactivate.
- Reactivate is in this slice, in the Edit drawer while Deactivated. It sets the account to `active` if the person has signed in before, or `invited` if not, and sends no email. Reactivating restores the account only: the person still needs roles and certificates to be cleared.
- Design note (user): when Start next season lands, "everyone not on the new roster loses sign-in" should reuse this same deactivate/reactivate path, so a returning volunteer is just reactivated. Don't build it now; don't block it. Deactivate and reactivate therefore live in internal functions that take one membership, and the RPCs are thin wrappers.

**Q4. When are Create account and Invite refused?**
All emails are compared ignoring case.

| Case | Create account (volunteer) | Invite (client) |
|---|---|---|
| Email used by a client sign-in, any workspace | Refused: "use another email" | Refused: already invited |
| Email used by a staff sign-in, any workspace | Refused | Refused: "use another email" |
| Email on a volunteer profile with no sign-in yet | n/a (that is this person) | Refused (it would collide when that volunteer gets an account) |
| Email whose person or membership has a deactivated account row | Refused: "Use Reactivate" | Refused: "use another email" |
| Auth user with no account row at all (failed half-create, 043's former presenters) | Allowed, reusing that auth user | Allowed, reusing it |
| Volunteer has no email on their profile | Refused: "Add an email first" | n/a |
| Volunteer has no roles or certificates | Allowed (they need a sign-in to see "Finish your setup") | n/a |
| Account already exists (Invited or Active) | No button; Resend instead | Refused: already invited |

**Decided (user):** all rows as above. Row 4 was narrowed by the user: a deactivated account row is not an orphan. Only auth users with no account row can be reused.
The roster command keeps its own checks, and now also writes `active` account rows for the staff and applicants it creates.

**Q5. How does the Edge Function create or invite the auth user?**
Options:
- A. `auth.admin.inviteUserByEmail`: creates an unconfirmed user and sends the Invite template. It needs its own template carrying the code, and how an invited, unconfirmed user interacts with our `signInWithOtp({ shouldCreateUser: false })` code form is unproven.
- B. `auth.admin.createUser({ email_confirm: true })`, then `signInWithOtp({ shouldCreateUser: false })`, which sends the code through the existing Magic Link template. It reuses the email that already works.
- C. `auth.admin.generateLink` and our own mailer. We have no mailer.
**Decided (user):** B. Reusing the sign-in code email for the invitation is fine for now. Custom invitation wording is later work.

**Q5b. What if the invited person never signs in?**
**Decided (user):** they stay Invited, with no expiry. The account is confirmed, so they can request a code from the normal sign-in form at any time. Resend sends a fresh code (60 s cooldown). A dead invitation is handled with Deactivate (staff).

**Q5c. How is "active" detected?**
**Decided (user):** a stored status. invited -> active is set by a trigger on `auth.users` when `last_sign_in_at` is first set. Roster-created and backfilled accounts start `active`. The trigger fires before the person's first request, so a `cleared()` that requires an active account has no ordering race. Password and code sign-ins both set `last_sign_in_at`, so fixtures keep working.

**Q6. The function's flow, the stack and CI, and the tests.**
**Decided (user):**

```
 browser (admin's JWT)
   |  POST /functions/v1/accounts  { op: create | resend | invite, personId | email }
   v
 Edge Function
   1. verify the caller's JWT  ->  caller's user id
   2. rpc check(op, target, actor)      [service_role only] -- every refusal rule, nothing written
   3. no reusable auth user? admin.createUser(email, email_confirm: true)
   4. rpc commit(op, target, actor, user_id)  [service_role only]
        re-checks under lock; membership (active) + account 'invited' + people.user_id, one transaction
   5. signInWithOtp(email, shouldCreateUser: false)  -> code email via GoTrue
```

- A failure between steps 3 and 4 leaves an auth user with no account row, which the next attempt reuses (Q4 row 4). No cleanup is needed.
- A failure at step 5 (cooldown or rate limit) leaves the account Invited, and the screen says "Account created; the email wasn't sent. Use Resend in a minute."
- Resend is steps 1, 2 and 5 only. Deactivate and Reactivate are plain database RPCs.
- Stack and CI: stop excluding `edge-runtime`, set `[edge_runtime] enabled = true` in the example config and `.github/actions/test-stack`, make `supabase/functions/` visible from `$VITALLY_STACK` (copy or link step in setup and in the action), and add a test-only `email_sent` override next to `sign_in_sign_ups`.
- The mail catcher API paths on CLI 2.117.0 are unknown until a spike. The first plan task checks them.
- Tests:
  - `test:database`: check, commit, deactivate, reactivate, every refusal row, the trigger, `cleared()` requiring an active account, and the backfill;
  - a new Node test of the function against the stack, reading the catcher, run under `test:database` so the existing CI job covers it;
  - the function's request handling as a plain module with `npm test` unit tests (thin Deno entry);
  - `test:auth-browser`: one end-to-end case (an admin invites a client, the client reads the code from the catcher and signs in, and the panel shows Active);
  - the browser story stays as it is (900 s limit). The Roster and office views get unit tests.

**Hosted email (user):** this is a deployment prerequisite, not a section 6 aside. The hosted project needs custom SMTP before real testers can receive invitations or codes. It is out of scope for this change and is listed under dependencies as "unknown/blocking for the December test". Deploying the Edge Function to the hosted project sits under the same item.

## Confirmed defaults (user confirmed 1 to 4)

1. Roster row: an Account column showing Not created · Invited · Active · Deactivated. The Edit drawer's Account section shows status with Create account, Resend, Deactivate or Reactivate as the state allows.
2. Clearance "what is missing" gains one reason, after the Form 13615 and photo ID: "No account yet", "Hasn't signed in yet" or "Account deactivated".
3. Capabilities: new `accounts`; modified `volunteer-clearance`, `volunteer-roster`, `sign-in` and `local-seed-data`.
4. Migration `046_accounts.sql`. It backfills an `active` row for every existing active membership, staff and applicant. Before the PR: sync with main and renumber if #139 (Workload) or #150 (notifications) took 047.

## Scope

**In:**
- the `accounts` table, one row per membership;
- Create account, Resend, Deactivate and Reactivate for volunteers in the Roster Edit drawer;
- an admin-only "Invite a client" panel on the office screen;
- one Edge Function for create, resend and invite;
- `cleared()` requiring an active account.

**Out:**
- `is_site_coordinator`;
- Start next season;
- custom invitation wording;
- hosted SMTP and hosted deployment;
- widening who can invite;
- deactivating clients.

## Approaches considered for the overall build

- **Edge Function plus database RPCs (chosen, user's settled decision).** The service key stays on the server side, and the database keeps every rule.
- **`server.mjs` as the privileged endpoint.** Rejected: `server.mjs` deliberately serves only the browser files and one public config document, and a hosted copy is static.
- **Inserting auth users from SQL.** Rejected: it bypasses GoTrue and cannot send the email.

## Dependencies

| Dependency | State |
|---|---|
| Edge runtime on the local and CI test stack | ready (costs CI start-up time) |
| Local mail catcher (Inbucket/Mailpit on CLI 2.117.0) | ready; API paths unknown until the first plan task |
| `@supabase/supabase-js` 2.116.0 inside the function | ready (same pinned version) |
| Hosted custom SMTP and Edge Function deployment | unknown/blocking for the December test; out of scope |

## Later work noted

- Custom invitation wording (its own template).
- `is_site_coordinator` and site coordinator handover (next change).
- Start next season reusing deactivate/reactivate.
- Hosted SMTP and function deployment.

## Q7 (raised during propose). What capability ceiling does Create account set?

Found in the code: effective capabilities are the roles' capabilities intersected with `people.capabilities` (the ceiling, 045 `effective_capabilities`). A volunteer added on the Roster is saved with an empty ceiling, and only the roster command (`add_staff_member`) sets one. Create account alone would therefore leave a cleared volunteer able to do nothing.

Options:
- A: `prepare`, `review`, `receive_documents`, `assist`;
- B: all six;
- C: empty, with ceiling editing left to a later change.

**Decided (user): A.** Roles decide the work within that ceiling. `admin` and `followup` are still given only by the roster command, so "Roster access stays on the `people.capabilities` ceiling" holds. Admins for the December test are added with the roster command. Granting admin in-app is revisited with the site coordinator change.

The user also confirmed working autonomously for this change: smaller calls are made without asking and recorded below; stop only for agreed behaviour, scope, auth, or who can see client data.

## Decided without the user (review)

1. **New capability name `sign-in-accounts`, not `accounts`.** Default 3 said "new: accounts". Every existing capability, and the spec template, uses a compound name. The alternative, keeping `accounts`, would be the only one-word capability.
2. **The function calls the database with the caller's own JWT, through public RPCs granted to `authenticated`; only `auth.admin.createUser` uses the service key.** The flow agreed in Q6 drew check and commit as `service_role`-only RPCs. In this project PostgREST exposes only `public`, and the sign-in spec pins the public RPCs to `authenticated`, so a `service_role` RPC in `public` breaks that rule.
   - With the caller's JWT, the admin check and the receipt's actor resolve as for every other RPC.
   - The commit takes the new auth user's id, but it only accepts a user whose email equals the target email and who has no account row. Calling it directly from a browser therefore gains nothing that the function's flow doesn't already allow.
   - Alternatives: `service_role` RPCs in a second exposed schema (more config, plus actor plumbing); a direct Postgres connection from the function (a second credential path).
3. **`accounts` is keyed `(workspace_id, user_id)`**, the membership's own primary key; memberships have no id column. `person_id` is nullable and set for staff.
4. **The backfill also gives every inactive membership a `deactivated` row.** Otherwise those users would count as "no account row" and be reused, which would collide with the membership's primary key. The alternative was special-casing an inactive membership in commit.
5. **No constraint requires every membership to have an account row.** A membership with no row is treated as before: a client signs in as today, and a staff member is not cleared. Every creation path (roster command, fixtures, the function) writes a row. A deferred constraint would break any raw fixture insert, for no behaviour gain.
6. **An admin cannot deactivate their own account** (refused with `VALIDATION`). This stops an admin from locking themselves out by accident; the roster command can always restore access. The alternative was to allow it.
7. **Reactivate is refused (`VALIDATION`, reason `EMAIL_IN_USE`) when the user meanwhile got an active membership in another workspace,** for example from the roster command. `memberships_one_active_workspace` would refuse the write anyway; the reason makes it readable.
8. **The office panel lists every client account in the workspace,** both roster-created (`active`, no `invited_at`) and invited, newest first. Admins already see client data on the office screens. The alternative, invited-only, would hide roster-created clients who also have accounts.
9. **Account writes take an expected `accounts.revision`** and refuse a stale one with `CONFLICT`, like `vitally_save_volunteer`. Each write takes an action id and stores a receipt.
10. **The function verifies the JWT itself** (`verify_jwt = false` in its config, then `auth.getUser(jwt)`). The new publishable keys and the gateway's own JWT check have known mismatches on recent CLIs, and the handler needs the user anyway.
11. **`vitally_my_clearance` is unchanged.** A signed-in staff caller always has an active account (the trigger runs at sign-in), so an account reason can never be what they are missing. The account reasons appear on the Roster only.
12. **Refusal reasons travel as `VALIDATION` (`VT007`) with `detail` naming the reason:** `EMAIL_IN_USE`, `EMAIL_ON_ROSTER`, `USE_REACTIVATE`, `NO_EMAIL`, `ALREADY_INVITED`, `SELF`. This follows the `OPEN_WORK` and `ROLE_NEEDS` pattern; the browser maps each reason to its sentence.
13. **(During apply) `vitally_prepare_account` takes the action id, and answers an already-recorded action with its stored result.** Otherwise a retried Create or Invite through the function would be refused ALREADY_INVITED at the check step, and the spec's "a repeated request gets the same answer" would fail end to end. The function then answers `emailSent: false`, so the screen offers Resend instead of claiming a second email. The alternative was to put receipt lookups in the function, which would duplicate the database's receipt logic.
14. **(During apply) "Signed in before", for Reactivate, means the account's own `activated_at`, not the auth user's last sign-in.** An auth user reused from elsewhere who never signed in under this account reactivates as Invited. The alternative was reading `auth.users.last_sign_in_at`, which counts sign-ins from before this account existed.
15. **(During apply) The office client list leaves out deactivated client accounts** (only backfilled rows can be deactivated), because the panel shows only Invited and Active.

### Review round (PR #197, 2026-11-14)

The user decided Cancel invitation, the seven-day expiry, the site check, sending safely and the message wording (design.md, "Review round", D10 to D14). These are the smaller calls made without them:

16. **Cancel invitation resets the person's capabilities to none** (`'{}'`), as a Roster-added person starts, and **keeps the auth user**, which then has no account row and is reused by a later Create account or Invite (D5). Deleting the auth user would also end a session the invitee might hold, but needs the service key in the database path.
17. **Expiry is applied when the account is next looked at, not by a timer.** Every account RPC, the office list, the Roster read (a new admin RPC, `vitally_expire_invitations()`), the site check and the sign-in trigger cancel expired invitations first. An expired invitee was never cleared, so nothing can act as them in between. The alternative, pg_cron, adds an extension to enable on the hosted project.
18. **The SIDN is stored in `vitally_private.site_numbers`,** unreadable by any API role, and set by the roster command's optional `siteNumber` (S and eight digits; spaces, hyphens and case ignored). A column on `workspaces` would be readable by staff, and so by the invitee before the check.
19. **A Reactivate that gives `invited` starts a new seven days and a new five attempts.** Otherwise a volunteer reactivated after a week would be cancelled at once.
20. **A Resend of an expired invitation is refused**: `INVALID_TRANSITION` for a volunteer, `NOT_FOUND` for a client named by email. The admin creates the account again. The cancellation the refusing call made is rolled back with the refusal; the next reader that commits (the Roster or office list) applies it again, and every reader treats the row as gone meanwhile.
21. **Each wrong site number bumps the account revision,** so a drawer read before it gets `CONFLICT` on Deactivate or Cancel invitation and re-reads.
22. **The site check answers writes as results** (`{status:'invited', reason:'WRONG_SITE', attemptsLeft}`, `{status:'cancelled', reason}`), because a raised error would roll back the attempt count or the cancellation.
23. **A missing name, a blank SIDN and an unset site number count as no attempt** (the blank SIDN after the final review: five empty presses would otherwise cancel). Neither says anything about whether the person knows the site.
24. **`vitally_my_clearance` gains `siteCheck`** (true while the caller's own account is invited). This replaces call 11: a signed-in volunteer can now be invited.
25. **The "unsaved changes" rule applies to the drawer.** The Invite panel's only field is the email it sends, so its safeguard is the confirmation with that exact email.
26. **Only Create account and Invite ask for confirmation,** not Resend, which goes to an address already confirmed once.
27. **The office list's Cancel names the client by email,** as Resend does, with the revision the list read.
28. **The site check is refused with `FORBIDDEN` to anyone without an invited volunteer account of their own** (a client, a cancelled invitee), and with `INVALID_TRANSITION` once the account is not invited (an active admin).
29. **The site number in the repository is the fictional `S00000000`:** the roster example, the test fixture and the docs.
30. **The migration stays 047 and was edited in place for this round.** It had not been applied to any stack yet (CI builds a fresh one); it was applied to the user's local stack only after the round's SQL was final, with a backup taken first.

