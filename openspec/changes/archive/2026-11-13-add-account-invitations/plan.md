# Account Invitations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An `accounts` row per membership, plus Create account, Resend, Deactivate and Reactivate on the Roster and an admin-only "Invite a client" panel on the office screen, backed by one Edge Function. `cleared()` requires an active account.

**Architecture:** All rules live in migration `046_accounts.sql`: the table, backfill, sign-in trigger and public `authenticated` RPCs. The Edge Function `supabase/functions/accounts` only identifies the caller, calls those RPCs with the caller's JWT, creates the auth user with the service key, and sends the existing sign-in code email through `signInWithOtp`. The browser calls the function through `client.functions.invoke` and the other RPCs through the store's `call()`.

**Tech Stack:** Postgres/PL/pgSQL (hand-written migrations, `tools/admin/migrate.mjs`), Supabase CLI 2.117.0 local stack with the edge runtime (Deno), `@supabase/supabase-js` 2.116.0, vanilla ES modules in `src/`, `node --test`, Playwright (`tests/auth-browser.mjs`).

**Spec:** `openspec/changes/add-account-invitations/` (`design.md` D1-D9, `specs/sign-in-accounts`, `specs/volunteer-clearance`, `specs/volunteer-roster`, `specs/sign-in`, `specs/local-seed-data`; the decision log is `brainstorm.md`).

## Global Constraints

- Fictional data only: emails `@example.org` or `@vitally.invalid`; names like the existing fixtures.
- Staff screens are English. Do not touch `src/client-text.mjs` or `src/zh-hant.mjs`.
- The migration is `supabase/migrations/046_accounts.sql`, written by hand. Never edit 001-045.
- Error convention: `raise sqlstate 'VT00x' using message='<NAME>'`, with `detail` for the reason. The codes are:
  - VT001 FORBIDDEN, VT002 NOT_FOUND, VT003 CONFLICT, VT004 INVALID_TRANSITION / OPEN_WORK, VT007 VALIDATION.
  - Refusal `detail` values: `NO_EMAIL`, `ALREADY_INVITED`, `USE_REACTIVATE`, `EMAIL_IN_USE`, `EMAIL_ON_ROSTER`, `SELF`.
- The ceiling that Create account sets: `{assist,prepare,receive_documents,review}`, never `admin` or `followup`.
- Exact UI copy:
  - Account states: "Not created", "Invited", "Active", "Deactivated".
  - Missing reasons: "No account yet", "Hasn't signed in yet", "Account deactivated".
  - Results: "Account created and sign-in code sent", "Account created; the email wasn't sent. Use Resend in a minute."
  - Refusals: "Add an email first", "This client is already invited", "This account is deactivated. Use Reactivate.", "That email is already used by another sign-in. Use another email.", "That email belongs to a volunteer. Use another email.", "You can't deactivate your own account."
- **Implementers MUST NOT run `npm run db:migrate:test`, `npm run test:database`, `npm run test:auth-browser` or `npm run test:browser`, and must not start, stop or reset any Supabase stack.** The stack is shared with other sessions. Locally run only `npm test`, `npm run build:hant -- --check` and `npx openspec validate --all`. The database, sign-in and browser suites are verified on CI by the controller (Task 8).
- No-hang rules for every command:
  - wrap it in `timeout` (`timeout 300 npm test`);
  - never start a foreground server;
  - if a command needs an approval you don't have, stop and report BLOCKED.
- Each commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Letter case and whitespace in emails** (`Client@Example.org `): it must be compared and stored lower-cased and trimmed everywhere, in the function, the RPCs and the refusal checks. The Task 3 test `invite trims and lower-cases the email` pins it.
2. **Double-click or retry of Create account or Invite** (same action id, or a second request while the first is in flight): one auth user, one membership, one account. The Task 3 test `a repeated record returns the stored result` and the Task 4 handler test `a reusable user id skips createUser` pin it.
3. **Admin opens a drawer, then another admin deactivates**: the stale action is refused with CONFLICT and the drawer says someone else changed this volunteer. The Task 3 test `a stale revision is refused` and the Task 5 controller test pin it.
4. **The email send fails** (rate limit or 60 s cooldown) after the account is recorded: the record stands, the UI says to use Resend, and Resend works later. The Task 4 handler test `email failure still answers 200 with emailSent false` pins it.
5. **A deactivated person still holding a browser session**: no data, the no-access screen, and signing in again doesn't flip them to active. The Task 2 test `a deactivated account stays deactivated on sign-in` pins it.

---

### Task 1: Test stack, CI and mail catcher

**Files:**
- Modify: `supabase/test-stack.config.example.toml` (the `[auth.rate_limit]` and `[edge_runtime]` sections; add `[functions.accounts]`)
- Modify: `.github/actions/test-stack/action.yml` (the template copy near line 27; the `--exclude` list near line 37)
- Modify: `tools/admin/write-test-env.mjs`, `tests/write-test-env.test.mjs`
- Create: `tests/support/mail-catcher.mjs`
- Modify: `docs/setup.md` (section 3, "Create the stack" and the start command; section 6, a deployment prerequisite)

**Interfaces:**
- Produces:
  - the env var `VITALLY_TEST_MAIL_URL` in `.env.test`;
  - `latestCode(mailUrl: string, email: string, { after?: Date, timeoutMs?: number }) -> Promise<string>` in `tests/support/mail-catcher.mjs`. It polls until a message to `email` newer than `after` arrives, and returns its 6-digit code. It throws after `timeoutMs` (default 15000).

- [ ] **Step 1: Find the mail catcher API.** Read the Supabase CLI 2.117.0 sources or docs, or `node_modules/supabase` if it carries them. Do not start a stack. Find whether the catcher is Mailpit or Inbucket, its HTTP API for listing and reading messages, and the `supabase status --output json` key for its URL (`INBUCKET_URL` or `MAILPIT_URL`). Record the finding in the task report.
- [ ] **Step 2: Write the failing test** in `tests/write-test-env.test.mjs`: `writes the mail catcher URL`. Given status JSON with the key found in step 1 set to `http://127.0.0.1:57324`, the written env contains `VITALLY_TEST_MAIL_URL=http://127.0.0.1:57324`.
- [ ] **Step 3: Run it to verify it fails:** `timeout 300 node --test tests/write-test-env.test.mjs`. Expected: FAIL.
- [ ] **Step 4: Implement it** in `write-test-env.mjs`, accepting either status key.
- [ ] **Step 5: Run it to verify it passes.** Same command; expected PASS.
- [ ] **Step 6: Write `tests/support/mail-catcher.mjs`** for the API from step 1. The code is the first `\b\d{6}\b` in the body. The template is `<p>Your ViTally code is {{ .Token }}</p>`.
- [ ] **Step 7: Edit the stack config:**
  - `[edge_runtime] enabled = true`;
  - `[functions.accounts]` with `verify_jwt = false`, plus a comment pointing to design D4;
  - `email_sent = 1000`, with a "TEST-ONLY OVERRIDE" comment like `sign_in_sign_ups` (Q6);
  - update the header comment's `--exclude` list (remove `edge-runtime`).
- [ ] **Step 8: Edit `action.yml`:** remove `edge-runtime` from `--exclude`, and add `mkdir -p "$stack/supabase/functions" && cp -R supabase/functions/. "$stack/supabase/functions/"` next to the template copy.
- [ ] **Step 9: Edit `docs/setup.md`:**
  - the same two steps for a hand-built stack;
  - "after pulling a change to `supabase/functions/`, copy it again and restart the stack";
  - in section 6, a "Deployment prerequisite (blocking for the December test)" paragraph: the hosted project needs custom SMTP, and the `accounts` function deployed with `verify_jwt = false`, before testers can receive invitations or codes.
- [ ] **Step 10: Check locally:** `timeout 600 npm test`. Expected: all pass.
- [ ] **Step 11: Commit** with the message `Test stack: run the edge runtime, copy functions, catch mail (add-account-invitations)`.

### Task 2: Migration 046, part 1: the table, the backfill, sign-in activation, clearance

**Files:**
- Create: `supabase/migrations/046_accounts.sql`
- Create: `tests/database-accounts.mjs`
- Modify: `tests/database-clearance.mjs`, `tests/database-volunteer-roster.mjs`, `tests/database-staff-identity.mjs`, `tests/database-seed.mjs` (only where they assume a person with no account is cleared; convert those assertions, never delete them)
- Modify (only if needed): `tests/support/database-fixture.mjs`

**Interfaces:**
- Produces:
  - Table `public.accounts`: `workspace_id uuid`, `user_id uuid`, primary key `(workspace_id, user_id)`, FK to `memberships` on delete cascade; `person_id uuid null`; `status text`; `invited_at`, `activated_at`, `deactivated_at timestamptz null`; `invited_by uuid null`; `revision bigint not null default 1`; `updated_at timestamptz not null default now()`; unique `(workspace_id, person_id)`.
  - `vitally_private.insert_active_account(p_workspace_id uuid, p_user_id uuid, p_person_id uuid) returns void`. Idempotent: it does nothing if a row exists.
  - `vitally_private.cleared(uuid, uuid)` now also requires `accounts.status = 'active'` for that person.

- [ ] **Step 1: Write the failing database tests** in `tests/database-accounts.mjs`, using `createDatabaseFixture` as `tests/database-volunteer-roster.mjs` does:
  - `fixture staff have an active account`: `f.staff({...})`, then a SQL read gives `status = 'active'` and `person_id` equal to the person.
  - `applicants have an active account with no person`.
  - `an admin reads accounts; a preparer and a client read none`.
  - `authenticated cannot write accounts`: insert, update and delete as an admin are each refused.
  - `a client account naming a person is refused at commit`.
  - `sign-in activates an invited account`: set a row to `invited` in SQL, `signInWithPassword` as that user, and read `active`, with `activated_at` not null and revision + 1.
  - `a deactivated account stays deactivated on sign-in`.
  - `cleared requires an active account`: a person with roles and certificates and no account gives false; with an active account, true; invited gives false; deactivated gives false.
  - `backfill`: run the backfill statement against a membership inserted without an account (active gives `active`; inactive gives `deactivated`). Call a `vitally_private.backfill_accounts()` function that the migration defines and calls once.
- [ ] **Step 2: Do not run them locally** (Global Constraints). Check syntax: `timeout 120 node --check tests/database-accounts.mjs`.
- [ ] **Step 3: Write `046_accounts.sql` part 1:**
  - the table and its check `status in ('invited','active','deactivated')`;
  - a deferred constraint trigger `accounts_person_matches_access`: `person_id is not null` exactly when the membership's access is `staff`, else VT007;
  - RLS: select policy `admin_accounts` using `vitally_policy.is_workspace_admin(workspace_id)`; grant select to `authenticated`, everything to `service_role`;
  - `insert_active_account`;
  - `backfill_accounts()`, called once;
  - `vitally_private.account_signed_in()`, an `after update of last_sign_in_at on auth.users` trigger: `invited` rows of `new.id` become `active`, with `activated_at = new.last_sign_in_at`, `revision + 1` and `updated_at = now()`;
  - redefine `add_staff_member` (copy 044:237-305 exactly, then call `insert_active_account` after both the link and the new-person paths);
  - redefine `initialize_workspace(uuid, uuid[])` (copy 043:598-635, then add active accounts for the applicants);
  - redefine `cleared` with the account condition;
  - end with `notify pgrst, 'reload schema';` if the earlier migrations do.
  - Keep the 045 header comment style.
- [ ] **Step 4: Convert the existing tests** that expect an account-less person to be cleared. Search `tests/database-*.mjs` for direct `cleared(` calls and for expectations of "Cleared" on people with `user_id` null. Each becomes expect not cleared with no account, and gets a counterpart with an active account. List every converted test in the task report.
- [ ] **Step 5: Check locally:** `timeout 600 npm test` passes, and `timeout 120 node --check` passes on each changed test file.
- [ ] **Step 6: Commit** with the message `Accounts table, backfill, sign-in activation; clearance needs an active account (add-account-invitations)`.

### Task 3: Migration 046, part 2: the account RPCs

**Files:**
- Modify: `supabase/migrations/046_accounts.sql` (append; the file is applied nowhere shared yet)
- Modify: `tests/database-accounts.mjs`, `tests/support/rpc-signatures.mjs`
- Modify: `src/contracts.mjs` (only if a new error code name is needed; the reasons travel as `detail`, not as new codes)

**Interfaces:**
- Consumes: Task 2's table and `insert_active_account`; `vitally_private.open_work(uuid, uuid)`, `reserve_receipt(member, action_id, operation, digest, person_id)`, `require_membership()`, `acting_person(member)` and `vitally_policy.is_workspace_admin(uuid)` (045).
- Produces (all `security definer`, `set search_path=''`; execute revoked from public and granted to `authenticated` only):
  - `public.vitally_prepare_account(p_op text, p_target jsonb) returns jsonb`. Returns `{op, email, reusableUserId: uuid|null, volunteerId: uuid|null, accountRevision: bigint|null}`. Writes nothing.
  - `public.vitally_record_account(p_action_id uuid, p_op text, p_target jsonb, p_user_id uuid) returns jsonb`. Returns `{actionId, status:'invited', email, accountRevision}`. `p_op` is `create` or `invite` only.
  - `public.vitally_deactivate_account(p_action_id uuid, p_volunteer_id uuid, p_expected_revision bigint) returns jsonb` and `public.vitally_reactivate_account(...)`, each returning `{actionId, status, accountRevision}`.
  - `public.vitally_client_invitations() returns jsonb`: an array of `{email, status, invitedAt, activatedAt, accountRevision}`, newest first by `coalesce(invited_at, activated_at)`.
  - `vitally_private.account_check(p_workspace_id uuid, p_op text, p_target jsonb) returns jsonb`, `vitally_private.deactivate_account(p_workspace_id uuid, p_user_id uuid) returns void` and `vitally_private.reactivate_account(p_workspace_id uuid, p_user_id uuid) returns text` (the new status). No grants on these.
  - `p_target` is `{volunteerId}` for `create`, `{email}` for `invite`, and either for `resend`. An email is trimmed and lower-cased before any comparison.

- [ ] **Step 1: Write the failing tests** in `tests/database-accounts.mjs`. The refusal assertions check the SQLSTATE and `detail`:
  - `prepare create returns the profile email and no reusable user`.
  - `prepare reuses an auth user with no account row`: create the auth user with the admin client first, and expect `reusableUserId` to be that id.
  - `record create links the volunteer`: after `admin.auth.admin.createUser`, the record gives a staff membership (active), `people.user_id` set, `people.capabilities = {assist,prepare,receive_documents,review}`, account `invited` with `invited_at` and `invited_by` set, and the profile revision + 1.
  - `record invite creates an applicant`: an applicant membership, and an account with `person_id` null.
  - `a repeated record returns the stored result`: the same action id twice gives an equal result and one account.
  - `record refuses a user whose email differs` with VT007.
  - `invite trims and lower-cases the email`: `'  Client.X@Example.ORG '` is stored and refused later as the same address.
  - Refusals, one test each: `NO_EMAIL`; `ALREADY_INVITED` (create twice; invite an email with an applicant account in another workspace); `USE_REACTIVATE`; `EMAIL_IN_USE` (create for a volunteer whose email is a client's sign-in elsewhere, in different case; invite a staff email; invite an email with a deactivated staff account); `EMAIL_ON_ROSTER`; FORBIDDEN for a preparer; NOT_FOUND for a volunteer in another workspace.
  - `resend is refused unless invited` with VT004 INVALID_TRANSITION.
  - `deactivate`: the account is `deactivated`, the membership inactive, `people.user_id` still set; that user's `require_membership` gives FORBIDDEN (call any RPC as them and expect VT001).
  - `deactivate with open work`: the person prepares an open case; VT004 OPEN_WORK, with the label in `detail`; nothing changes.
  - `deactivate yourself` gives VT007 SELF.
  - `a stale revision is refused` with VT003.
  - `reactivate after sign-in gives active`, and `reactivate without a sign-in gives invited`.
  - `reactivate refused when active elsewhere` gives VT007 EMAIL_IN_USE.
  - `reactivate restores the account only`: a person with no roles is reactivated and is not cleared.
  - `client invitations list`: an admin gets the workspace's applicant accounts with emails, newest first; a preparer gets VT001.
- [ ] **Step 2: Add the five RPCs to `tests/support/rpc-signatures.mjs`**, with valid argument shapes, receipt keys and `authorized` actors. For `vitally_prepare_account` and `vitally_client_invitations`, use the Site Coordinator.
- [ ] **Step 3: Implement the functions** in 046:
  - Follow the `vitally_save_volunteer` prologue (045:1042-1100): `require_membership`, `acting_person`, the admin check, the advisory lock, then the digest and `reserve_receipt` with operation names `RECORD_ACCOUNT`, `DEACTIVATE_ACCOUNT` and `REACTIVATE_ACCOUNT`.
  - `account_check` implements design D5's table in that order.
  - `deactivate_account` raises OPEN_WORK exactly as `vitally_save_volunteer` does (045:1185-1196).
- [ ] **Step 4: Check locally:** `timeout 600 npm test` passes (`tests/store.test.mjs` and any test pinning the RPC list), and `node --check` passes on the changed files.
- [ ] **Step 5: Commit** with the message `Account RPCs: prepare, record, deactivate, reactivate, client list (add-account-invitations)`.

### Task 4: The Edge Function

**Files:**
- Create: `supabase/functions/accounts/handler.mjs`, `supabase/functions/accounts/index.ts`
- Create: `tests/accounts-function.test.mjs` (unit, run by `npm test`)
- Create: `tests/database-accounts-function.mjs` (against the stack, run by `test:database` on CI)

**Interfaces:**
- Consumes: Task 3's RPCs; Task 1's `latestCode`.
- Produces:
  - `handleAccountRequest(request: Request, deps) -> Promise<Response>`, where `deps = { userClient(jwt) -> SupabaseClient, adminClient: SupabaseClient, anonClient: SupabaseClient }`.
  - The request is `POST` with JSON `{op: 'create'|'invite'|'resend', actionId: string, volunteerId?: string, email?: string}` and `Authorization: Bearer <jwt>`.
  - Responses:
    - `200 {status:'invited', emailSent: boolean, accountRevision}`;
    - `401 {code:'FORBIDDEN'}` with no or a bad JWT;
    - `400 {code, reason}` for VT007 or VT004;
    - `403 {code:'FORBIDDEN'}`, `404 {code:'NOT_FOUND'}`, `409 {code:'CONFLICT'}`;
    - `500 {code:'SERVER_ERROR'}`.
  - `code` is the name `src/contracts.mjs` maps the SQLSTATE to.
  - `OPTIONS` gives 204 with CORS headers (`Access-Control-Allow-Origin: *`, allow headers `authorization, x-client-info, apikey, content-type`, allow methods `POST, OPTIONS`). Every response carries the same CORS headers.

- [ ] **Step 1: Write the failing unit tests** in `tests/accounts-function.test.mjs`, with fake clients that record their calls:
  - `options answers 204 with CORS`.
  - `no bearer token is 401`.
  - `create runs prepare, createUser, record, then signInWithOtp with shouldCreateUser false`, checking the call order and arguments.
  - `a reusable user id skips createUser`.
  - `resend runs prepare and signInWithOtp only`.
  - `a refusal maps VT007 detail to 400 {code:'VALIDATION', reason}`, with no createUser called.
  - `email failure still answers 200 with emailSent false`.
  - `createUser failure is 500 and nothing is recorded`.
- [ ] **Step 2: Run them to verify they fail:** `timeout 300 node --test tests/accounts-function.test.mjs`. Expected: FAIL (the module is missing).
- [ ] **Step 3: Implement `handler.mjs`.** Use plain ES module JavaScript with no `Deno` or `process` references, and import nothing. The error mapping reads `error.code` (SQLSTATE) and `error.details`.
- [ ] **Step 4: Run the tests to verify they pass.** Same command; expected PASS.
- [ ] **Step 5: Write `index.ts`.**
  - Imports: `npm:@supabase/supabase-js@2.116.0` and `./handler.mjs`.
  - Env: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (falling back to `SUPABASE_PUBLISHABLE_KEY`) and `SUPABASE_SERVICE_ROLE_KEY`.
  - `userClient(jwt)` passes `global.headers.Authorization`.
  - All clients use `auth: { persistSession: false }`.
  - Serve with `Deno.serve`.
- [ ] **Step 6: Write `tests/database-accounts-function.mjs`**, using `assertTestTarget()` for the API URL and `createDatabaseFixture`:
  - `create account sends a code that signs the volunteer in`: an admin session posts to `${apiUrl}/functions/v1/accounts`; `latestCode` reads the code from `VITALLY_TEST_MAIL_URL`; `verifyOtp({type:'email'})` succeeds; the account is `active`.
  - `invite then resend sends a second code`.
  - `a non-admin is refused 403 and no auth user exists`.
  - Retry the first function call once on 5xx or a connection error (cold start), and fail with a message naming the edge runtime and setup.md if it still fails.
- [ ] **Step 7: Check locally:** `timeout 600 npm test` passes, and `node --check` passes on the stack test.
- [ ] **Step 8: Commit** with the message `accounts Edge Function: create, invite, resend (add-account-invitations)`.

### Task 5: Roster account state and the Edit drawer's Account section

**Files:**
- Modify: `src/supabase-store.mjs` (`listVolunteers` near 685; new methods next to `saveVolunteer`), and `src/store.mjs` or the store interface file if there is one (follow how `saveVolunteer` is declared)
- Modify: `src/volunteer-roster.mjs` (`combineVolunteers` 65-103; add `accountMessage(reason)` next to `openWorkMessage` 180-189)
- Modify: `src/volunteer-views.mjs` (`MISSING_TEXT` and `clearedCell` 29-36, `volunteerRow` 38-55, `volunteerDrawerBody` 114-172)
- Modify: `src/controller.mjs` (next to `saveVolunteer` 2831-2900)
- Test: `tests/volunteer-roster.test.mjs`, `tests/volunteer-views.test.mjs`, `tests/store.test.mjs`, `tests/controller.test.mjs`

**Interfaces:**
- Consumes: Task 3's RPC names and returns, and Task 4's response shape.
- Produces:
  - Store methods:
    - `createAccount({actionId, volunteerId})`, `resendAccount({actionId, volunteerId})` and `inviteClient({actionId, email})`, `resendClient({actionId, email})`, all via `client.functions.invoke('accounts', {body})`. A non-2xx response becomes an `AppError` with `code` and `cause.details = reason`. Each resolves to `{status, emailSent, accountRevision}`.
    - `deactivateAccount({actionId, volunteerId, expectedRevision})`, `reactivateAccount({…})` and `listClientInvitations()`, via `call()`.
  - `combineVolunteers` adds `account: {status:'none'|'invited'|'active'|'deactivated', revision: number|null}` to each volunteer. `cleared` also requires `account.status === 'active'`. `missing` appends `'noAccount' | 'notSignedIn' | 'deactivated'`.
  - `accountMessage(reason) -> string`, mapping the six `detail` values to the Global Constraints copy.

- [ ] **Step 1: Write the failing tests:**
  - `tests/volunteer-roster.test.mjs`:
    - `combineVolunteers marks a volunteer with roles and no account not cleared with noAccount`;
    - `... invited gives notSignedIn`, `... deactivated gives deactivated`, `... active with roles is cleared`;
    - `accountMessage maps each reason` (all six strings exactly).
  - `tests/volunteer-views.test.mjs`:
    - `roster row shows the account column` (the four labels);
    - `cleared cell lists No account yet after Form 13615`;
    - `drawer account section offers Create account with no account`, `... Resend and Deactivate when invited`, `... Deactivate when active`, `... Reactivate when deactivated`, `... nothing for a new volunteer before saving`.
  - `tests/store.test.mjs`: `createAccount invokes the accounts function with op create`; `a 400 response becomes VALIDATION with the reason`; `deactivateAccount calls vitally_deactivate_account with the expected revision`.
  - `tests/controller.test.mjs`:
    - `create account shows the sent message and re-reads the roster`;
    - `email not sent shows the Resend message`;
    - `OPEN_WORK on deactivate shows the open-work sentence`;
    - `CONFLICT on deactivate says someone else changed this volunteer` (reuse the existing save-conflict text);
    - `deactivate asks for confirmation first` (reuse the existing confirm-dialog pattern in `tests/confirm-dialogs.test.mjs`).
- [ ] **Step 2: Run them to verify they fail:** `timeout 600 npm test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the store methods, `listVolunteers` (add `select workspace_id,user_id,person_id,status,revision from accounts`), `combineVolunteers`, the views and the controller actions. Data actions are `account-create`, `account-resend`, `account-deactivate` and `account-reactivate`. Generate action ids as `saveVolunteer` does, and keep them across a retry the same way.
- [ ] **Step 4: Run the tests to verify they pass:** `timeout 600 npm test`. Expected: all PASS.
- [ ] **Step 5: Commit** with the message `Roster: account column and the drawer's Account section (add-account-invitations)`.

### Task 6: The office screen's "Invite a client" panel

**Files:**
- Modify: `src/office-views.mjs` (`renderFollowups` near 376), `src/views.mjs` (370-388, pass the invitations in), `src/controller.mjs` (load the list when the office screen opens; the invite and resend actions)
- Test: `tests/office-views.test.mjs`, `tests/controller.test.mjs`, `tests/empty-states.test.mjs` (only if the empty list adds a state)

**Interfaces:**
- Consumes: `inviteClient`, `resendClient`, `listClientInvitations` and `accountMessage` (Task 5).
- Produces: `inviteClientPanel({invitations, ui}) -> string` in `src/office-views.mjs`.

- [ ] **Step 1: Write the failing tests:**
  - `invite panel has an email field and Invite button`;
  - `lists clients newest first with status and Resend only while Invited`;
  - `empty list says No clients invited yet`;
  - `the panel is not rendered for a non-admin office state`;
  - controller tests: `invite refused EMAIL_ON_ROSTER shows its sentence`, `invite success clears the field, shows the sent message and re-reads the list`.
- [ ] **Step 2: Run them to verify they fail:** `timeout 600 npm test`.
- [ ] **Step 3: Implement** the panel, controller actions `client-invite` and `client-resend`, and the list load.
- [ ] **Step 4: Run the tests to verify they pass:** `timeout 600 npm test`.
- [ ] **Step 5: Commit** with the message `Office screen: Invite a client (add-account-invitations)`.

### Task 7: Sign-in browser case, seed and docs

**Files:**
- Modify: `tests/auth-browser.mjs`, and `tests/support/browser-fixture.mjs` (only if a helper is needed)
- Modify: `tools/admin/seed-values.mjs` comments, and `tests/seed.test.mjs` (only if they assert that seed volunteers are cleared)
- Modify: `docs/demo-script.md`, `docs/developer/` (the page that covers the Roster and sign-in), `README.md` (only if it lists what admins can do)

- [ ] **Step 1: Add one case to `tests/auth-browser.mjs`: `an admin invites a client who signs in with the emailed code`.**
  - The Site Coordinator opens the office screen and invites `invited-<uuid>@example.org`.
  - The panel shows "Invited".
  - In a second browser context, the client enters the email. Install the existing `/auth/v1/otp` interception so no second email is sent.
  - The client enters the code from `latestCode` and reaches the client screen.
  - The admin's panel, after reload, shows "Active".
- [ ] **Step 2: Check syntax:** `timeout 120 node --check tests/auth-browser.mjs`. Don't run it locally.
- [ ] **Step 3: Seed:** confirm that `seedVolunteers` needs no change. Update any unit assertion or comment that says the fictional volunteers are cleared.
- [ ] **Step 4: Docs:** in the demo script, add a short "Accounts" walk-through (Create account, the code email in the local mail catcher, Invite a client, Deactivate and Reactivate), and the hosted SMTP prerequisite under the developer docs.
- [ ] **Step 5: Check locally:** `timeout 600 npm test`, `timeout 300 npm run build:hant -- --check` and `timeout 120 npx openspec validate --all` all pass.
- [ ] **Step 6: Commit** with the message `Sign-in browser case for client invitations; seed and docs (add-account-invitations)`.

### Task 8: CI verification (controller, not an implementer)

- [ ] **Step 1:** Push the branch, then run `gh workflow run ci.yml --ref <branch>`. Find the run with `gh run list --workflow ci.yml --branch <branch> --limit 1`, and wait with `timeout 3000 gh run watch <id> --exit-status`.
- [ ] **Step 2:** On a failure, read `gh run view <id> --log-failed`, fix it in the owning task's files, commit, push and re-run. After 3 failed fixes of the same check, stop and ask the user.
- [ ] **Step 3:** When `checks`, `database`, `sign-in` and both `story` legs pass on the same commit, download the story screenshots (`gh run download <id>`) and review them.
