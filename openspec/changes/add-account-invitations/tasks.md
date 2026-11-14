## 1. Test stack, CI and mail catcher

- [x] 1.1 Enable the edge runtime in `supabase/test-stack.config.example.toml` (`[edge_runtime] enabled = true`, `[functions.accounts] verify_jwt = false`) and add the test-only `email_sent` override
- [x] 1.2 `.github/actions/test-stack/action.yml`: drop `edge-runtime` from `--exclude`, copy `supabase/functions/` into the stack work directory
- [x] 1.3 Confirm the CLI 2.117.0 mail catcher API (Mailpit or Inbucket) and its `supabase status` key; write the catcher URL to `.env.test` (`write-test-env.mjs` and its unit test)
- [x] 1.4 `tests/support/mail-catcher.mjs`: read the newest code sent to an address
- [x] 1.5 `docs/setup.md`: edge runtime, functions copy, email override, restart note, and the hosted SMTP prerequisite

## 2. Migration 046: accounts

- [x] 2.1 `accounts` table, constraints (staff names a person, client none), RLS (admin read only), grants, not published
- [x] 2.2 Backfill: active rows for active memberships, deactivated rows for inactive ones
- [x] 2.3 Trigger on `auth.users` sign-in: invited -> active
- [x] 2.4 `add_staff_member` and `initialize_workspace` write active accounts
- [x] 2.5 `cleared()` requires an active account
- [x] 2.6 `account_check` and the refusal reasons; `vitally_prepare_account`, `vitally_record_account`
- [x] 2.7 `deactivate_account` / `reactivate_account` internals and their public RPCs (receipts, revision, open work, self, email in use)
- [x] 2.8 `vitally_client_invitations`
- [x] 2.9 RPC signature list (`tests/support/rpc-signatures.mjs`) and database tests (`tests/database-accounts.mjs`; adjust clearance, roster, seed and staff-identity tests that assumed sign-in-free clearance)

## 3. Edge Function

- [x] 3.1 `supabase/functions/accounts/handler.mjs` (create, invite, resend flow, error mapping, CORS) with `npm test` unit tests
- [x] 3.2 `supabase/functions/accounts/index.ts` Deno entry
- [x] 3.3 `tests/database-accounts-function.mjs`: the function against the stack, reading the mail catcher

## 4. Browser

- [x] 4.1 Store: `createAccount`, `resendAccount`, `inviteClient` (functions.invoke), `deactivateAccount`, `reactivateAccount`, `listClientInvitations`, and accounts in `listVolunteers`; contracts and error mapping
- [x] 4.2 `combineVolunteers`: account status, cleared with account, missing reasons; Roster Account column and cleared text
- [x] 4.3 Edit drawer Account section and controller actions with result and refusal messages
- [x] 4.4 Office screen "Invite a client" panel and controller actions
- [x] 4.5 View and controller unit tests
- [x] 4.6 `test:auth-browser`: an admin invites a client, the client signs in with the emailed code, the panel shows Active

## 5. Seed and docs

- [x] 5.1 Seed: no change in behaviour; adjust seed tests and docs that say the fictional volunteers are cleared
- [x] 5.2 Developer docs and demo script: Create account, Invite a client, Deactivate/Reactivate

## 6. Verification

- [ ] 6.1 `npm test`, `npm run build:hant -- --check`, `npx openspec validate --all` locally
- [ ] 6.2 CI on the pushed branch: checks, database, sign-in and both story legs pass; review story screenshots
