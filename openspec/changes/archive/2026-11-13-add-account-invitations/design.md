## Context

ViTally gives sign-ins only through the operator's roster command (`tools/admin/roster.mjs`, which calls `vitally_private.initialize_workspace` and `vitally_private.add_staff_member`). A volunteer added on the Roster (`vitally_save_volunteer`) is a person with no sign-in and an empty capability ceiling. Clients exist only as `applicant` memberships from the roster file.

Clearance (045) is roles and the photo ID in `vitally_private.cleared`. The "usable sign-in" part is an active `staff` membership in `vitally_policy.cleared_workspace_id`.

The relevant structures:
- **`memberships`:** primary key `(workspace_id, user_id)`, `access` is `applicant` or `staff`, plus `active`. `memberships_one_active_workspace` is unique on `user_id` where active. A deferred trigger checks staff/person links.
- **`people`:** `user_id`, linked by a deferred FK to `memberships`, and `capabilities` (the ceiling).
- **`volunteer_profiles`:** `email`, lower-cased, unique per workspace.
- **An inactive membership is invisible to `own_membership`** and refused by `require_membership`, so the browser shows "This account has no access".

The Roster is read by plain selects joined in the browser (`combineVolunteers`, `src/volunteer-roster.mjs`), which also computes cleared and missing.

Errors are `raise sqlstate 'VT00x' using message='<NAME>'`, with `detail` for structured reasons. The browser maps them in `src/contracts.mjs` and `src/errors.mjs`.

Nothing uses Edge Functions yet. The test stack (local and CI) excludes `edge-runtime`, and `[auth.rate_limit] email_sent = 2`. There is no hosted project. The decision log is `brainstorm.md` (Q1-Q7 and "Decided without the user").

## Goals / Non-Goals

**Goals:**
- An `accounts` row per membership, with status `invited | active | deactivated`, the time of each step, and a revision.
- Create account and Resend for a volunteer, and Invite and Resend for a client, through one Edge Function. All rules are in the database.
- Deactivate and Reactivate for staff as database RPCs, with internal per-membership functions that Start next season can reuse later.
- `cleared()` requires an active account. Existing staff, the fixtures and the seed role accounts stay cleared.
- The test stack and CI run the edge runtime and can send and catch mail.

**Non-Goals:**
- `is_site_coordinator`, site coordinator handover, granting `admin` in-app (revisited with the site coordinator change), Start next season.
- Deactivating clients, custom invitation wording, and widening who can invite.
- Hosted SMTP and hosted function deployment. These are a prerequisite for the December test, tracked as a dependency only.

## Decisions

### D1: `accounts` table, one row per membership
- **Choice:**
  - Columns: `workspace_id`, `user_id` (primary key, FK to `memberships(workspace_id, user_id)` on delete cascade), `person_id uuid null` (FK to `people(workspace_id, id)`), `status text check in ('invited','active','deactivated')`, `invited_at`, `activated_at`, `deactivated_at`, `invited_by uuid null` (a person), `revision bigint default 1`, `updated_at`.
  - Check: `person_id` is set exactly when the membership is `staff`. A deferred constraint trigger compares it with `memberships.access`.
  - Unique `(workspace_id, person_id)`.
  - RLS: select only by a workspace admin (`vitally_policy.is_workspace_admin`). No writes for `authenticated`; every write goes through the functions below. Not in the realtime publication, like the roster tables.
  - Grants: `select` to `authenticated`; nothing to `anon` or `service_role`, on the table or on any function this change adds. The Edge Function calls the database with the admin's own JWT and uses the service key only for `auth.admin.createUser` (D4). (Review round: 047 first granted `service_role` everything on the table, left over from the brainstorm's `service_role` RPCs; revoked.)
- **Why:** clients are not people, and the membership is what ties a sign-in to a workspace and an access type (Q1). `is_site_coordinator` can be added to this row later.
- **Alternatives:** one row per person (excludes clients); one row per auth user (deactivation ends the workspace link, not the user).

### D2: Status transitions
```
 (no row) --create/invite--> invited --first sign-in (trigger)--> active
                                |                                    |
                                +-------------deactivate-------------+--> deactivated
 deactivated --reactivate--> active   (activated_at set)
 deactivated --reactivate--> invited  (activated_at null)
```
- First sign-in: an `after update of last_sign_in_at on auth.users` trigger, from `vitally_private.account_signed_in()` (security definer). Whenever `last_sign_in_at` changes to a non-null value, it sets that user's `invited` rows to `active`, stamps `activated_at` and bumps `revision`.
- Deactivate also sets `memberships.active = false`. Reactivate sets it back to `true`.
- The roster command, the fixtures and the backfill write `active` directly.
- **Why:** a stored status is what the user chose. The trigger runs before the person's first request, so `cleared()` never races it (Q5c).

### D3: Database functions
Internal (`vitally_private`, no grants):
- `account_check(p_workspace_id, p_op, p_target jsonb) returns jsonb`. It applies every refusal rule (D5) without writing, and returns `{op, email, reusableUserId, volunteerId, accountRevision}`. The admin check happens in the public wrappers, so the check needs no actor.
- `deactivate_account(p_workspace_id, p_user_id)` and `reactivate_account(p_workspace_id, p_user_id)`. They take one membership and do the open-work check (deactivate) or the email-in-use check (reactivate). Start next season can call them in a loop later.
- `insert_active_account(...)`, used by `add_staff_member`, `initialize_workspace` and the backfill.

Public, `authenticated` only, each resolving the caller as usual; the admin check is `vitally_policy.is_workspace_admin`:
- `vitally_prepare_account(p_action_id uuid, p_op text, p_target jsonb) returns jsonb`: read-only, wraps `account_check`. When the caller already recorded that action id, it returns `{replay: <stored result>}` before any check. This way a retried Create or Invite through the function gets the same answer, not ALREADY_INVITED.
  - `op` is `create`, `invite` or `resend`.
  - `target` is `{volunteerId}` for create, `{email}` for invite, and `{volunteerId}` or `{email}` for resend.
- `vitally_record_account(p_action_id uuid, p_op text, p_target jsonb, p_user_id uuid) returns jsonb`. It takes the workspace advisory lock, repeats `account_check`, and requires the auth user's lower-cased email to equal the checked email and the user to have no account row. Then:
  - `create`: inserts the `staff` membership, links `people.user_id`, sets `people.capabilities` to `{assist, prepare, receive_documents, review}`, bumps the profile revision, and inserts the account as `invited`;
  - `invite`: inserts the `applicant` membership and an `invited` account.
  - It stores an action receipt; a replay returns the same result.
- `vitally_deactivate_account(p_action_id, p_volunteer_id, p_expected_revision)` and `vitally_reactivate_account(...)`: receipts, `CONFLICT` on a stale revision, refusal of the caller's own account (deactivate).
- `vitally_client_invitations() returns jsonb`: admin only. Lists the workspace's `applicant` accounts that are not `deactivated` as `{email, status, invitedAt, activatedAt, accountRevision}`, newest first. The email is read from `auth.users` inside the security definer.
- **Why public with the caller's JWT:** see brainstorm "Decided without the user" 2. Passing an arbitrary `p_user_id` to `vitally_record_account` gains nothing, because only an account-less auth user with exactly the checked email is accepted, and only the function (service key) can create one.
- **Alternatives:** `service_role` RPCs, or a direct Postgres connection from the function.

### D4: Edge Function `accounts`
- `supabase/functions/accounts/index.ts` is a thin Deno entry. It builds three clients with `npm:@supabase/supabase-js@2.116.0`: user (caller's JWT), admin (`SUPABASE_SERVICE_ROLE_KEY`) and anon. It then calls `handleAccountRequest` from `supabase/functions/accounts/handler.mjs`, plain JavaScript with no Deno or Node globals, which `npm test` imports.
- `verify_jwt = false` for this function; the handler calls `auth.getUser(jwt)` itself. A missing or invalid JWT gets 401 `FORBIDDEN`. CORS headers and an `OPTIONS` answer are included.
- The request body is `{ op, actionId, volunteerId? , email? }`. The flow (Q6):
  1. get the user;
  2. `vitally_prepare_account` (a `replay` answer is returned to the browser as the result, with `emailSent: false`, skipping steps 3-5);
  3. if there is no `reusableUserId`, `admin.auth.admin.createUser({ email, email_confirm: true })`;
  4. `vitally_record_account`;
  5. anon `signInWithOtp({ email, options: { shouldCreateUser: false } })`.
  - `resend` runs steps 1, 2 and 5.
- Response:
  - `200 { status: 'invited', emailSent: true|false, revision }`;
  - a refusal is `4xx { code, reason }`, with `code` from the VT map and `reason` the `detail`.
  - When step 5 fails, `emailSent: false` with HTTP 200. The record stands.
- The browser store gets `createAccount`, `resendAccount` and `inviteClient` via `client.functions.invoke('accounts', …)`, mapped to the existing `AppError` codes, and `deactivateAccount`, `reactivateAccount` and `listClientInvitations` via `call()`.

### D5: Refusal rules (Q4)
Emails are compared lower-cased.

| Reason (`detail`) | When |
|---|---|
| `NO_EMAIL` | create for a volunteer with no profile email |
| `ALREADY_INVITED` | create or invite when the target already has an `invited` or `active` row, or the email belongs to an applicant account in any workspace (invite) |
| `USE_REACTIVATE` | create for a person whose account row is `deactivated` |
| `EMAIL_IN_USE` | the email belongs to an auth user with an account row in any workspace (staff or client, any status) that is not the target's own; also reactivate when the user has an active membership elsewhere |
| `EMAIL_ON_ROSTER` | invite with an email on any workspace's volunteer profile |
| `SELF` | deactivate the caller's own account |
| (none: reuse) | the auth user exists with no account row at all |
| `FORBIDDEN` | the caller is not a workspace admin |
| `NOT_FOUND` | the volunteer is not in the workspace or has no current-season roster entry |
| `INVALID_TRANSITION` | resend when not `invited`; deactivate when not `invited` or `active`; reactivate when not `deactivated` |
| `OPEN_WORK` (`VT004`) | deactivate while `vitally_private.open_work` returns rows; `detail` is the labels, as for a volunteer save |

The roster command keeps its own checks.

### D6: Clearance requires an active account
- `vitally_private.cleared(ws, person)` adds `and exists (select 1 from public.accounts a where a.workspace_id = ws and a.person_id = person and a.status = 'active')`.
- `cleared_workspace_id`, `require_cleared`, the assignee checks and `vitally_my_clearance` follow without edits.
- The Roster computes cleared in the browser. `combineVolunteers` gets each person's account (admins read `accounts`), and `missing` gains `noAccount`, `notSignedIn` or `deactivated`, after `form13615` and `photoId`.
- Clearance text: "No account yet", "Hasn't signed in yet", "Account deactivated".
- **Effect:**
  - Backfilled staff, staff created by the roster command and fixture staff (`add_staff_member`) are active, so main stays green.
  - The 8 seed volunteers have no sign-in and become not cleared, with "No account yet".
  - DB tests that call `cleared()` on an unlinked person expecting true are converted to expect false with the account reason, and a linked active counterpart is added. Nothing is deleted.

### D7: Creation paths write active accounts
- 047 redefines `add_staff_member`: after its membership insert, it calls `insert_active_account` with the person. The identical re-run path inserts nothing new.
- 047 redefines `initialize_workspace`: each applicant membership gets an active account.
- The roster command code itself needs no change.
- Backfill:
  - every active membership gets an `active` row (`activated_at = coalesce(last_sign_in_at, now())`, `person_id` from `people` for staff);
  - every inactive membership gets a `deactivated` row ("Decided without the user" 4).

### D8: Browser
- **Roster:**
  - An Account column: "Not created", "Invited", "Active", "Deactivated".
  - The Edit drawer gains an Account section after the season section, with the status and one of:
    - Create account (no row; the email is required and saved first; see D13);
    - Resend (Invited);
    - Deactivate (Invited or Active, with a confirm dialog);
    - Reactivate (Deactivated).
  - Results show in the drawer: "Account created and sign-in code sent", "Account created; the email wasn't sent. Use Resend in a minute.", the refusal sentences, and the open-work sentence through `openWorkMessage`.
  - The drawer re-reads the list after each action.
  - The email field is read-only once there is a sign-in, as now: `people.user_id` stays set through deactivation. Cancel invitation (D10) is the one way back to an editable email.
- **Office screen** (Follow-ups, "Office queue"): an "Invite a client" panel, admin-only, with an email field, an Invite button, and the client list from `vitally_client_invitations` (email, status, Resend while Invited).
- English only (staff screens). No `src/client-text.mjs` change.

### D9: Test stack and CI
- In `supabase/test-stack.config.example.toml`:
  - `[edge_runtime] enabled = true`, plus `[functions.accounts] verify_jwt = false`;
  - test-only `[auth.rate_limit] email_sent = 1000`, commented like `sign_in_sign_ups`.
- In `.github/actions/test-stack/action.yml`: drop `edge-runtime` from `--exclude`, and copy `supabase/functions/` into `$VITALLY_STACK/supabase/functions/`, next to the template copy.
- `docs/setup.md`: the same steps for a hand-built stack, plus a note that a running stack must be restarted after pulling.
- Mail catcher: CLI 2.117.0's API (Mailpit `/api/v1/search` or Inbucket `/api/v1/mailbox/<name>`) is confirmed in the first plan task. A small `tests/support/mail-catcher.mjs` reads the code from the newest message to an address. Its URL comes from `supabase status` (`INBUCKET_URL` or `MAILPIT_URL`), written to `.env.test` by `write-test-env.mjs`.

## Review round (PR #197, 2026-11-14)

The user's decisions after the PR review (a reviewer's locked-email finding and the user's own review). They change the agreed behaviour above where they say so; the delta specs as archived show the behaviour before this round, and the canonical specs (`sign-in-accounts`, `volunteer-clearance`, `volunteer-roster`, `sign-in`) were edited in the same PR to match. The calls made without the user are in brainstorm.md, "Decided without the user (review)", 16 to 30.

**Why.** After Create account the email is read-only, Deactivate keeps the link, Create account again says `USE_REACTIVATE`, and Reactivate brings back the same address. A typo, or Create account pressed before the drawer's new email was saved, sent the invitation to the wrong person, and the only way out was a second Roster entry. Worse, if the volunteer already had roles, whoever held that address could sign in and be cleared at once.

### D10: Cancel invitation
For an account that is `invited` and was never `active` (`activated_at` is null), an admin can cancel from the drawer (target `{volunteerId}`) or the office list (`{email}`): `vitally_cancel_invitation(p_action_id, p_target, p_expected_revision)`, with a receipt and `CONFLICT` for a stale revision. In one transaction it clears `people.user_id`, resets the person's capabilities to none, bumps the profile revision, and deletes the membership (the account row goes with it). The auth user stays and becomes the reusable kind (D5). It is refused with `INVALID_TRANSITION` once the account was ever active. This changes "the email is locked once there is a sign-in" only for invitations never completed.

### D11: Seven-day expiry
Create account, Invite, Resend and a Reactivate that gives `invited` set `expires_at` seven days on. An invitation past it is cancelled exactly as D10 does. Expiry is applied when the account is next looked at, not by a timer: every account RPC, `vitally_client_invitations`, the Roster read (it first calls the admin RPC `vitally_expire_invitations()`), the site check and the sign-in trigger. Resend now writes: `vitally_record_account` with `p_op='resend'` restarts the seven days and bumps the revision before the function sends the code.

### D12: Site check at a volunteer's first sign-in
- The sign-in trigger activates only client invitations. A volunteer's `invited` account stays invited, and `vitally_my_clearance` answers `siteCheck: true`, so the window shows "Confirm your site" (name, required, and the site's SIDN).
- `vitally_complete_site_check(p_name, p_sidn)` acts on the caller's own account. The right SIDN makes the account active and stores the name in `volunteer_profiles.signed_in_name` (admin-only; never on `people`). A wrong one keeps it invited ("That isn't this site's number.") and counts an attempt; the fifth cancels the invitation (D10). Results that write are answers, not errors, since an error would roll the write back.
- The SIDN lives in `vitally_private.site_numbers`, which no API role can read, set by `vitally_private.set_site_number` through the roster command's optional `siteNumber` (S and eight digits). Season settings will own it later. The repository, seed, tests and screenshots use the fictional `S00000000`.
- Until the check passes the volunteer is not cleared, so the 045 policies already give them no case data; a database test proves it.
- The Roster row and drawer show "Signed in as <name>".

### D13: Sending safely
Create account is disabled, with "Save your changes first.", while the drawer has unsaved changes, so the invitation goes to the saved email. Create account and Invite both ask "Send a sign-in invitation to <email>?" first, and only the confirmation sends.

### D14: Messages
A replayed Create or Invite says "This invitation was already sent. If it didn't arrive, use Resend.", never that the email was not sent. `ALREADY_INVITED` reads "This person is already invited or signed in.", which fits volunteers and clients.

### Follow-ups opened, not fixed here
- Cross-workspace email probing through `vitally_prepare_account`: any workspace admin can learn whether an email belongs to staff, a volunteer or a client of another workspace.
- A reactivated user with an existing session stays Invited until they sign in again.

## Risks / Trade-offs

- [Risk] A trigger on `auth.users` could fail if the migration role can't create triggers on the auth schema. → Mitigation: Supabase's documented pattern; the migration runs as `postgres`. CI's `database` job proves it.
- [Risk] The edge runtime adds start-up time and an image pull to every CI stack job, and the function fetches `npm:` modules at first call. → Mitigation: accepted (Q6); `npm:` is pinned. The function test retries the first call once after a cold start.
- [Risk] Other local stacks without the edge runtime fail the new function test after this merges. → Mitigation: setup.md restart note; the test's failure message names the fix. It never silently skips.
- [Risk] The mail catcher's API differs from the assumption. → Mitigation: the first plan task checks it before anything is built on it.
- [Trade-off] The invitation reuses the "Your ViTally code" email. → Accepted for now; custom wording is later work.
- [Trade-off] Expiry waits for the next look (D11) rather than a timer, so an expired row can sit in the table until someone opens the Roster or the office list, or the invitee signs in. → The invitee was never cleared and every reader cancels it first; no pg_cron dependency on the hosted project.
- [Risk] A workspace with no site number leaves every new volunteer at "This site isn't set up for sign-in yet." → The roster example and docs/setup.md name `siteNumber`; the screen tells the volunteer to ask their site coordinator.
- [Trade-off] An invited volunteer becomes visible to all staff (`people.user_id` set) and has a four-capability ceiling before being cleared. → They can do nothing until cleared, and assignment pickers list only cleared people.
- [Risk] Concurrent PRs (#139, #150) may take 046, or modify the sign-in RPC list. → Mitigation: merge `main` before the PR, renumber, and re-run CI. Spec conflicts are surfaced at archive. (Done: renumbered to 047 when #195 took 046.)

## Migration Plan

- `047_accounts.sql` (renumbered from 046 when #195 took it), in one transaction:
  1. the table and its constraints and RLS;
  2. the backfill;
  3. the trigger;
  4. internal and public functions;
  5. the redefined `add_staff_member`, `initialize_workspace` and `cleared`;
  6. grants, then `notify pgrst`.
- Additive. Existing rows only gain account rows, and no existing row is changed or deleted.
- Rollback is a new migration that drops the table and functions and restores the 045 definitions. A hand-written migration is never edited after it's applied.
- **Deployment prerequisite (out of scope, blocking for the December test):** the hosted project needs custom SMTP and this function deployed before real testers can receive invitations or codes.

## Open Questions

- Mail catcher API paths on CLI 2.117.0. Owner: plan task 1. Affects only the tests that read mail.
- None else; the decisions are in brainstorm.md.
