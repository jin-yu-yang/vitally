## 1. Local mail path (design D2, open question)

- [ ] 1.1 On a fresh isolated test stack, confirm the edge runtime reaches the mail catcher's send API (`POST /api/v1/send`), record the URL that works and how the stack passes `VITALLY_MAIL_CATCHER_URL` and `VITALLY_SITE_URL` to the function; if it can't, switch the local sender to SMTP to the catcher and record why
- [ ] 1.2 Pass both variables to the function in `supabase/test-stack.config.example.toml` and `.github/actions/test-stack/action.yml`, with no `RESEND_API_KEY`

## 2. Invitation email text (design D3, D4, D5)

- [x] 2.1 Unit tests for `invitationEmail({ kind, siteUrl, expiresAt })` with Hailey's copy (plan Task 2): client English + 简体 with a two-language subject and the safety line, volunteer English with the roster, site check and setup lines and no SIDN value, the link, the expiry in New York time (English and Chinese formats, a date across a DST change), no six-digit run, nothing personal from the request, HTML escaping
- [x] 2.2 Write `supabase/functions/accounts/invitation-email.mjs` to pass them

## 3. Senders and configuration guard (design D2, D6)

- [x] 3.1 Unit tests for the sender module: Resend request shape (endpoint, auth header, from, idempotency key only when given), mail-catcher request shape, the guard (neither set, both set, no `VITALLY_SITE_URL`) naming variables and never values, the send timeout, and the result mapping (2xx, `409 invalid_idempotent_request` → sent, `409 concurrent_idempotent_requests` → not sent, other errors and network errors → not sent, logged without address or key)
- [x] 3.2 Write `supabase/functions/accounts/sender.mjs` to pass them
- [x] 3.3 Wire `index.ts`: build the sender from the environment, answer a configuration error with the existing missing-variable `SERVER_ERROR`

## 4. Handler (design D1, D6)

- [x] 4.1 Update `tests/accounts-function.test.mjs`: a fake sender replaces `signInWithOtp`; create, invite and resend each send one invitation of the right kind to the right address, with the action id as key for create and invite and none for resend; sender failure keeps `emailSent: false` and the account; replays and refusals send nothing
- [x] 4.2 Change `handler.mjs` to send through `deps.sendInvitation` with the computed expiry, and drop `anonClient`

## 5. Staff wording (design D7)

- [x] 5.1 Update `tests/controller.test.mjs` and `tests/volunteer-views.test.mjs` to the new messages
- [x] 5.2 Change the messages in `src/controller.mjs` and the Cancel invitation dialog in `src/volunteer-views.mjs`

## 6. Integration tests (design D8)

- [ ] 6.1 Add `latestInvitation` to `tests/support/mail-catcher.mjs`, and make `latestCode` read only sign-in-code emails
- [ ] 6.2 Update `tests/database-accounts-function.mjs`: the invitation has the configured link, an expiry within one minute of `expires_at` and no six-digit run; a code then requested with `signInWithOtp` signs the volunteer in; invite then resend delivers a second invitation
- [ ] 6.3 Update the client and volunteer invitation tests in `tests/auth-browser.mjs`: read the invitation, request a real code, sign in with it on the first try

## 7. Docs

- [ ] 7.1 `docs/setup.md`: the stack's new function variables, the hosted secrets (`RESEND_API_KEY` send-only key for govitally.org, `VITALLY_SITE_URL`), the shared 100-a-day quota, and the redeploy step
- [ ] 7.2 `docs/developer/backend.md` and `docs/demo-script.md`: the invitation email and the new wording

## 8. Checks

- [ ] 8.1 `npm test`
- [ ] 8.2 On a stack with the new function: `npm run test:database` and `npm run test:auth-browser`
- [ ] 8.3 `npm run test:browser`, or the PR's CI story run, linked
- [ ] 8.4 `npx openspec validate --all`
