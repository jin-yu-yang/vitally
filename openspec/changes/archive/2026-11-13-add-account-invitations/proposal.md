## Why

Only the operator's roster command can give anyone a sign-in today. An admin can add a volunteer to the Roster but cannot let them sign in, and office staff cannot invite a client. Clearance still treats "usable sign-in" as an active staff membership because nothing records sign-in status. Real testers in December need volunteers and clients to get sign-ins from inside ViTally. Clearance also needs a real account state to rest on before the site coordinator and Start next season work, which build on it.

## What Changes

- **New `accounts` table**, one row per membership. Status is `invited | active | deactivated`, with `invited_at`, `activated_at` and `deactivated_at`. "Not created" is the absence of a row. A migration backfills an `active` row for every existing active membership.
- **Create account and Resend** for a volunteer, in a new Account section of the Roster Edit drawer. A Supabase Edge Function (`accounts`) checks the request in the database, creates or reuses a confirmed auth user, records the membership and the account as `invited`, and sends the existing sign-in code email. Create account sets the volunteer's capability ceiling to `prepare`, `review`, `receive_documents` and `assist`, so their roles decide their work. `admin` and `followup` stay with the roster command.
- **Invite a client:** an admin-only panel on the office screen. An admin enters a client's email; the same Edge Function creates an `applicant` membership with an `invited` account and sends the code email. The panel lists invited clients with their status and Resend.
- **Deactivate and Reactivate** a volunteer's account in the drawer. These are database RPCs. Deactivate is refused while the person holds open work. Reactivate restores `active` if the person has signed in before, otherwise `invited`, and sends no email.
- **Refusal rules** across staff and client sign-in emails, ignoring case: an email already used by a sign-in elsewhere, an email on another volunteer's profile, an email with a deactivated account ("Use Reactivate"), and a volunteer with no email. Only auth users with no account row may be reused.
- **invited -> active** when the person first signs in, set by a trigger on `auth.users`.
- **Clearance**
  - From: a staff member is cleared with roles and, if new, a photo ID check. A usable sign-in means an active staff membership.
  - To: cleared also requires an `active` account. The Roster's "what is missing" gains "No account yet", "Hasn't signed in yet" or "Account deactivated".
  - Reason: clearance must rest on a real account state.
  - Impact: volunteers with no sign-in show as not cleared. The roster command and the test fixtures write `active` accounts, so existing staff stay cleared.
- **Roster Account column:** Not created · Invited · Active · Deactivated.
- **Roster command:** writes an `active` account row for each staff member and applicant it creates. It stays the bootstrap for the first admin.
- **Test stack and CI:** run the edge runtime, serve `supabase/functions/`, and raise `email_sent` for tests only.

## Capabilities

### New Capabilities
- `sign-in-accounts`: the accounts table and its states, Create account, Resend, Invite a client, Deactivate and Reactivate, the refusal rules, the Edge Function, and first sign-in activation.

### Modified Capabilities
- `volunteer-clearance`: cleared requires an active account, and the setup and "what is missing" reasons include the account.
- `volunteer-roster`: the Roster row's Account column, and cleared and missing reason including the account.
- `sign-in`: the roster command writes active accounts; the list of public RPCs grows by the account RPCs.
- `local-seed-data`: the 8 fictional volunteers have no account and show as not cleared.

## Impact

- **Database:** new migration `046_accounts.sql` (renumbered before the PR if 047 is taken). It adds the table, backfill, trigger on `auth.users`, check and commit functions for `service_role`, Deactivate and Reactivate RPCs, the list read for the office panel, and changes to `cleared()` or `cleared_workspace_id()` and to the Roster read.
- **New `supabase/functions/accounts/`:** a Deno entry plus a plain handler module tested under `npm test`.
- **Browser:** the Roster view and Edit drawer, the office screen panel, and the store calls (`functions.invoke` and the new RPCs).
- **Tools:** `tools/admin/roster.mjs` and workspace setup, the seed, test fixtures, `supabase/test-stack.config.example.toml`, `.github/actions/test-stack`, and `docs/setup.md`.
- **Tests:** `test:database` (including a function test against the stack), `test:auth-browser` (one invitation end to end), and unit tests for the views and handler. The browser story is unchanged.
- **Dependencies:**
  - edge runtime and mail catcher on the test stack: ready;
  - `@supabase/supabase-js` 2.116.0: ready;
  - hosted custom SMTP and function deployment: unknown/blocking for the December test, out of scope.
