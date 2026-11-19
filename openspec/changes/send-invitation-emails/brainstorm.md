# Brainstorm: send-invitation-emails (#219)

Decision log of the design agreed with Hailey in the conversation of 2026-11-18. Everything
below was settled there; items marked *(my call)* are proposals the builder made and the user
did not object to.

## Background

Issue #219: the code in the invitation email can't be used. Inviting the volunteer and admin
testers by Dec 21 depends on it, so it is this week's top priority.

What happens today (checked by Hailey, confirmed in the code):

- `supabase/functions/accounts/handler.mjs`: Create account / Invite / Resend create the user with
  `admin.createUser({ email_confirm: true })` (Resend skips that), record the account, then finish
  with `anonClient.auth.signInWithOtp({ shouldCreateUser: false })`. So the "invitation" is the
  Magic Link template, `<p>Your ViTally code is {{ .Token }}</p>`.
- `src/auth.mjs`: the only way to reach code entry is `sendCode`, which calls `signInWithOtp` again.
  That replaces the emailed code, so the code in the invitation can never be typed in.
- A code expires after 1 hour (`otp_expiry = 3600`); an invitation lasts 7 days.
- Clients (Invite a client) and volunteers (Create account / Resend on the Roster) share this path.
- On the hosted test environment, Auth email goes through Supabase custom SMTP via Resend, sender
  `ViTally <help@govitally.org>`. The Resend API key is in the Supabase dashboard and Hailey's
  password manager only; it is not an Edge Function secret.

## Q0. What should the invitation be? (decided by Hailey before the brainstorm)

**Option A:** the invitation email is an invitation with no code. It says who invited them (the PCDC
VITA site) and tells them to go to the site and sign in with this email; they get a code when they
sign in. The sign-in flow is unchanged (email → code → enter code), and the volunteer site check
(name + SIDN) at first sign-in stays as it is.

Rejected: B, "I already have a code" on the sign-in screen (codes expire after an hour, invitations
after seven days); C, wording only (the code still wouldn't work).

## Q1. How is the invitation email sent?

Findings:
- Auth's `inviteUserByEmail` (`/invite`, Invite template) refuses an email whose user already exists
  and is confirmed (`email_exists`). Every user we create is confirmed, and so is every reused user
  after a cancelled invitation. Using it would mean replacing `createUser`, which leaves new users
  unconfirmed. That changes how sign-in treats them and still breaks reuse and Resend. **Ruled out.**
- SMTP from the Edge Function: hosted Edge Functions can't open outgoing ports 25 and 587, so it would
  need 465 and a Deno SMTP library, which is more fragile. Kept only as the local fallback (Q2).
- **Chosen: the Edge Function calls Resend's HTTP API** (`POST https://api.resend.com/emails`),
  replacing the `signInWithOtp` step.

Details agreed:
- The sender is passed into the handler like the Supabase clients (`deps`), so unit tests use a fake.
- Create and Invite send `actionId` as Resend's `Idempotency-Key`.
- New secret `RESEND_API_KEY`: a **separate send-only key restricted to govitally.org**. Hailey
  creates it and sets it on the hosted project; documented in `docs/setup.md`.
- **No migration.** No new database state.

## Q2. Local stack and CI

- The local stack's mail goes to the mail catcher (Mailpit, container still named "inbucket"),
  which the tests already read (`tests/support/mail-catcher.mjs`). Resend can't deliver there.
- **Chosen: locally and in CI the function posts to Mailpit's HTTP send API**
  (`POST /api/v1/send`). One HTTP sender, two targets.
- **Exactly one** of `RESEND_API_KEY` / `VITALLY_MAIL_CATCHER_URL` must be set; neither or both is
  the existing missing-variable 500. CI has no Resend key, so it can never send real email.
  Unit tests for the guard: neither set, both set (Hailey).
- **Unknown, first task of plan.md (Hailey):** that the edge-runtime container can reach Mailpit's
  send API on the stack's Docker network, and how the stack passes the variable
  (`[edge_runtime.secrets]` in the stack config, or `supabase/functions/.env`). If it can't,
  the fallback is SMTP to the catcher.
- Tests that relied on the invitation carrying a code (found in recon):
  - `tests/database-accounts-function.mjs`: "create account sends a code that signs the volunteer
    in", "invite then resend sends a second code";
  - `tests/auth-browser.mjs`: the client invitation test (~l.638) and the volunteer Create account
    test (~l.777), both `latestCode` after the invite and `loginTestUser({ otp: code })`;
  - `tests/accounts-function.test.mjs`: the `signInWithOtp` step;
  - `tests/support/mail-catcher.mjs`: `latestCode` takes the first 6-digit run in the newest
    email, so the invitation must contain none;
  - wording in `tests/controller.test.mjs`, `tests/volunteer-views.test.mjs`.
  They change to: read the invitation (link, expiry, no 6-digit code), then request a code the way
  a person does, read that code, and sign in with it. `latestCode` reads only sign-in-code
  emails. *(my call)*
- The story (`tests/browser.mjs`) doesn't create accounts or invite; only the staff wording it may
  render changes.

## Q3. Language

- Client invitation: **one email, English then 简体**, two-language subject. Nothing changes in the
  invite panel, and no language is stored.
- Volunteer invitation: **English only** (volunteer screens are staff screens). It says they will
  confirm their site at first sign-in, without the SIDN.
- The text lives with the function (`supabase/functions/accounts/`), because the function can't
  import `src/`. So `build:hant` doesn't cover it.
- **Open question: 繁體 in the client email.** Owner: Hailey, with PCDC (many Cantonese-speaking
  clients read traditional characters). It affects only the client invitation text. If it's added
  later, extend `build:hant` to the function's text so `--check` catches drift.

## Q4. When the email fails

- As today: the account stays `invited`, the function answers `emailSent: false`, Resend is offered.
- The function logs Resend's error code and HTTP status, never the address.
- Resend doesn't retry a refused API call; the admin presses Resend.
- Staff wording: "Account created and invitation sent", "Invitation sent", "Account created; the
  invitation email wasn't sent. Use Resend later." (drops "in a minute", which came from Auth's 60 s
  gap per address). No reason field (Hailey).
- **Idempotency (Hailey's condition):** Resend compares the payload as well as the key. If the same
  actionId ever reaches Resend twice, the expiry text is recomputed, so the payload differs and
  Resend answers `409 invalid_idempotent_request` although the first email went out. Since the key
  is the actionId, treat that as **already sent (`emailSent: true`)**. Treat
  `409 concurrent_idempotent_requests` as **not sent, no retry** *(my call; the admin gets "Use
  Resend later", and the key stops a second email)*. Both unit-tested with the fake sender; Mailpit
  has no idempotency. Note: in today's handler a receipt replay returns before any send, so this is
  a defensive check for a request that gets past the receipt check, not the usual path.

## Q5. Rate and quota

- Resend free tier: 100 emails a day, 3,000 a month, about 2 requests a second.
- Testers: about 10 people by Dec 21 (4–5 volunteers, the admin team, the program manager), at
  most 20–30 emails a day. 100 a day is enough for the test.
- **Invitations and sign-in codes share the quota** (Auth's custom SMTP goes through the same
  Resend account). The real season needs a paid plan or PCDC's sender; that belongs to #215, not
  this change.

## Q6. Additions from Hailey

- **Sign-in link from configuration:** a required `VITALLY_SITE_URL` (Edge Functions can't read
  Auth's Site URL). The hosted project sets `https://govitally.org`; local and CI set
  `http://127.0.0.1:4173`. It's part of the startup check. Tests check the link.
- **The email states the invitation's expiry.**
- **No personal data beyond the recipient's address:** no client name, nothing from a case.
- The choice of sender moves from `index.ts` into a plain module, so the guard is unit-testable.
  *(my call)*

## Q7. Where the expiry date comes from

`vitally_record_account` answers `{status, email, accountRevision}`, not `expires_at`
(`047_accounts.sql:787`, `:828`); the database sets `now() + interval '7 days'`.

- (a) **Chosen:** the function adds 7 days to its own clock. No migration; the two clocks differ by
  milliseconds. The 7-day rule then exists twice, so the database test compares the email's expiry
  with the row's `expires_at` **within one minute** (Hailey: not an exact string, so a send that
  crosses a minute boundary can't flake it).
- (b) A migration adding `expiresAt` to the RPC's answer: exact, but breaks "no migration".
- (c) Read the row with the service-role client after recording: Resend doesn't know the user id,
  so it needs an extra lookup.

Shown as a **date and a time in New York time**, not just a date: the invitation expires at the
minute it was sent, so "until Nov 25" alone would be wrong on the evening of Nov 25. For example:
"This invitation expires on Wednesday, November 25, 2026 at 3:00 PM (New York time). After that,
ask the site to invite you again." 简体 in Chinese date order. `Intl` with an explicit
`America/New_York` (hosted functions run in UTC).

## Scope

**In:** Create account, Invite and Resend send an invitation email with no code (Resend's API on the
hosted project, Mailpit locally and in CI); client email English + 简体, volunteer email English;
staff wording changes to "invitation"; spec, test and doc updates.

**Out:** the sign-in screen and site check; self sign-up (#158); a longer client invitation expiry
(ask PCDC first); `vita@chinatown-pcdc.org` as sender; quota planning for the season (#215); 繁體 in
the email; any migration.

## Dependencies

| Dependency | Status |
|---|---|
| Resend API on govitally.org (domain verified for SMTP) | Ready; Hailey creates the key; tests use a fake |
| Supabase hosted function secrets | Ready; Hailey sets them |
| Mailpit send API reachable from the local edge runtime | Unknown; plan task 1, SMTP fallback |

## Acceptance

- An invited client and an invited volunteer each get one invitation email: the configured link, the
  expiry, no 6-digit code, no personal data. They then get a code from the sign-in screen and sign
  in on the first try (sign-in test and database test).
- New staff wording in place.
- `openspec/specs/sign-in-accounts/spec.md` modified (it says "a sign-in code email reaches their
  address" today).
- Checks: `npm test` (with the function's unit tests); `npm run test:database`
  (`database-accounts-function`); `npm run test:auth-browser`; `npm run test:browser`, because staff
  wording changes (the PR's CI may stand in, with the run linked); `npx openspec validate --all`.
  `build:hant -- --check` isn't needed: no 简体 text in `src/` changes.
- After merge, together with Hailey: set the secrets, then redeploy the accounts function (order per
  Q8), and send one
  client invitation and one volunteer invitation to Hailey's own email.

## Q8. Review of the planning artifacts (Hailey, 2026-11-18)

- **Copy:** clients and volunteers get different emails, with the exact copy in plan.md Task 2.
  - The client email says what ViTally is for, and that ViTally and PCDC never ask for a password, Social Security number or bank details by email.
  - The volunteer email says they were added to the roster, that they'll confirm their site with their name and the SIDN (from their site coordinator), and that ViTally shows what's still needed for the season (such as the signed Form 13615).
  - Both say "Questions? Reply to this email."
  - The recipient's address is in neither the body nor the link.
- **Database time zone:** `now() + interval '7 days'` is exactly 7×24 h only when the database
  session time zone is UTC. Plan Task 1 records `show timezone` on a test stack, and the hosted deploy checks it. If either isn't UTC, stop and decide with Hailey.
- **Deploy order:** a missing or doubled secret makes the function refuse Create account, Invite and Resend. (Cancel, Deactivate and Reactivate are database RPCs and keep working.) So the secrets are set before the redeploy, never after.
