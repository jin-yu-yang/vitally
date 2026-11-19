## Context

The `accounts` Edge Function (change add-account-invitations) handles Create account and Resend on
the Roster, and Invite a client and Resend on the office screen. After it checks the request,
creates or reuses a confirmed, password-free Auth user and records the account, it ends with
`anonClient.auth.signInWithOtp({ shouldCreateUser: false })`. So the "invitation" is Auth's Magic
Link template, `Your ViTally code is {{ .Token }}`.

That code can't be used (#219). The sign-in screen's only way to code entry is `sendCode`
(`src/auth.mjs`), which asks for a new code and so replaces the emailed one. A code also lasts one
hour (`otp_expiry = 3600`), while an invitation lasts seven days. Inviting about ten testers
(4–5 volunteers, the admin team, the program manager) by Dec 21 depends on this.

Constraints:
- Hosted Auth email already goes through Supabase custom SMTP via Resend, from
  `ViTally <help@govitally.org>`. The domain is verified. The API key is not an Edge Function secret.
- The function's logic is in `handler.mjs`, a plain module tested under Node with fakes. `index.ts`
  only builds the clients and serves. The function cannot import `src/`.
- Local stacks and CI send all mail to the stack's mail catcher (Mailpit, container still named
  "inbucket"), which the sign-in and database tests read (`tests/support/mail-catcher.mjs`).
- No migration (decided). Client screen text stays in `src/client-text.mjs`, and staff screens stay
  English.

## Goals / Non-Goals

**Goals:**
- Every invitation (Create account, Invite, Resend) is one email with no code. It says who invited
  them, where to sign in, and when the invitation expires. The invitee signs in on the first try
  through the unchanged sign-in flow.
- The hosted project sends it through Resend's HTTP API. Local stacks and CI send it to the mail
  catcher, and can never send real email.
- Staff wording speaks of invitations, not codes.

**Non-Goals:**
- Any change to the sign-in screen, code entry or the volunteer site check.
- Self sign-up (#158), a longer client invitation expiry, PCDC's own sender, quota for the real
  season (#215).
- 繁體 in the client email (open question below).
- Storing an email's delivery state, or telling the admin why it failed.
- Any database migration, RPC, RLS or realtime change.

## Decisions

### D1: The function sends its own invitation email through Resend's HTTP API
- **Choice:** replace the `signInWithOtp` step with `deps.sendInvitation(message)`. On the hosted
  project, that is `POST https://api.resend.com/emails` with `Authorization: Bearer RESEND_API_KEY`,
  from `ViTally <help@govitally.org>`, with a text and an HTML body.
- **Why:** it's the only option that keeps confirmed users and reused users working, needs no Auth
  change, and is a plain `fetch` in Deno.
- **Alternatives:**
  - Auth `inviteUserByEmail`: refuses an existing confirmed user (`email_exists`). Every user we
    create, and every reused user, is confirmed. Using it would mean leaving new users unconfirmed,
    which changes sign-in and still breaks reuse and Resend.
  - SMTP from the function: hosted functions can't use ports 25 and 587, and it needs a Deno SMTP
    library. Kept only as the local fallback (D2).
- `RESEND_API_KEY` is a separate send-only key restricted to govitally.org, so it can be revoked
  without touching Auth's SMTP key.

### D2: Local and CI send to the mail catcher's HTTP API; exactly one sender is configured
- **Choice:** a plain sender module (for example `supabase/functions/accounts/sender.mjs`) builds
  the sender from an environment object:
  - `RESEND_API_KEY` set → Resend;
  - `VITALLY_MAIL_CATCHER_URL` set → `POST <url>/api/v1/send` (Mailpit's send API);
  - neither set, or both set → a configuration error naming the variables, never their values.
    `index.ts` answers it with the existing missing-variable `SERVER_ERROR`, as it does today.
- `VITALLY_SITE_URL` is required in every mode (D4).
- **Why:**
  - One HTTP sender with two targets.
  - The tests keep reading the catcher they already read.
  - CI has no Resend key, so it can never send real email.
  - "Both set" is refused so a stack can't send real mail by accident.
- **Unknown, plan task 1:** that the edge-runtime container reaches Mailpit's send API on the
  stack's Docker network (the hostname depends on the stack's `project_id`), and how the stack
  passes the variables (`[edge_runtime.secrets]` in the stack config, or `supabase/functions/.env`).
  - **Fallback:** if the API is unreachable or missing, the local sender speaks SMTP to the catcher.
- **Alternative:** a fake sender inside the function, reached only from tests. Rejected: the sign-in
  and database tests would no longer see a real email.

### D3: The email's text lives with the function; client English + 简体, volunteer English
- **Choice:** a plain module (for example `supabase/functions/accounts/invitation-email.mjs`)
  exports `invitationEmail({ kind, to, siteUrl, expiresAt })`, which returns
  `{ subject, text, html }`.
- **The two emails differ** (copy by Hailey; the exact text is in `plan.md` Task 2):
  - **Client:** English first, then 简体, with a two-language subject. The PCDC VITA free tax site invited them to ViTally, where they answer the questions for their tax return and see which documents to bring. It also says ViTally never asks for a password, Social Security number or bank details by email. The line speaks for ViTally only until PCDC agrees (Open Questions).
  - **Volunteer:** English, with the subject "You're invited to ViTally as a PCDC VITA volunteer". They were added to the volunteer roster and their account is ready. At first sign-in they confirm their site with their name and the site's SIDN, which their site coordinator gives them; the SIDN itself never appears. If anything is still needed for the season (such as the signed Form 13615), ViTally shows what's missing before they can work on cases.
- **Both say:**
  - go to `siteUrl` and sign in with the email address the message was sent to;
  - you'll get a code when you sign in;
  - the invitation is valid until the expiry (D5); after that, ask the site (the site coordinator, for a volunteer) to invite them again;
  - "Questions? Reply to this email." Replies go to the sender, `help@govitally.org`.
- **Never in it:** the recipient's address (in the body or in the link), a name, anything from a case,
  and no run of six digits (the tests' code reader and a person must never take anything in it for
  a code).
- HTML values are escaped.
- **Why:** the function can't import `src/`, and staff wording rules don't apply to email.
  `build:hant` doesn't cover this module.
- **Alternatives:**
  - A language chosen when inviting: needs a panel field and storage. Rejected for now.
  - One English email: some clients read only Chinese.

### D4: The sign-in link comes from `VITALLY_SITE_URL`
- **Choice:** a required function setting. The hosted project uses `https://govitally.org`; local
  stacks and CI use the app's origin, `http://127.0.0.1:4173`. The tests check the link.
- **Why:** Edge Functions can't read Auth's Site URL, and a hard-coded govitally.org would send
  local testers to the hosted site.

### D5: The expiry is the function's clock plus 7 days, shown as date and time in New York time
- **Choice:** the function computes `now + 7 days` itself and formats it with `Intl`, using
  `timeZone: "America/New_York"`:
  - English: "Wednesday, November 25, 2026 at 3:00 PM (New York time)";
  - 简体: Chinese date order.
- **Why:** `vitally_record_account` doesn't return `expires_at`, and adding it needs a migration.
  The two clocks differ by milliseconds. A time, not just a date, because the invitation expires at
  the minute it was sent.
- **The database's time zone:** `now() + interval '7 days'` is exactly 7×24 h only when the database session time zone is UTC. In another zone, Postgres keeps the wall-clock time across a DST change, so an invitation that crosses one would show an expiry an hour off. Plan Task 1 records `show timezone` on a test stack, and the hosted deploy checks it too (Migration Plan step 1). If either isn't UTC, stop and decide with Hailey. CI's `TZ=America/New_York` affects Node and the browsers, not Postgres.
- **Guarding the duplicated 7-day rule:** the database test compares the email's expiry with the
  row's `expires_at` within one minute, so a send that crosses a minute boundary can't flake it.
- **Alternatives:**
  - A migration returning `expiresAt`: exact, but breaks "no migration".
  - A service-role read of the row: Resend doesn't know the user id, so it needs an extra lookup.

### D6: Send results, idempotency and logging
- **Idempotency key:**
  - Create and Invite send `Idempotency-Key: <actionId>`.
  - Resend has no action id, so it sends no key.
  - The mail catcher ignores the header.
- **Resend's answer → `emailSent`:**

  | Resend's answer | `emailSent` |
  |---|---|
  | 2xx | `true` |
  | `409 invalid_idempotent_request` | `true` |
  | `409 concurrent_idempotent_requests` | `false` (no retry) |
  | any other error, a network error or a timeout | `false` |

  - `invalid_idempotent_request` means the same key arrived with a different payload. The payload
    differs because the expiry text is recomputed. The key is the action id, so the first request
    with that key already sent the email.
  - `concurrent_idempotent_requests`: the admin gets "Use Resend later", and the key stops a
    second email.
- **When this happens:** in today's handler a receipt replay returns before any send. So the 409s
  are a defensive check for a request that gets past the receipt check. Both are unit-tested with
  the fake sender; Mailpit has no idempotency.
- **Timeout:** the send has a bounded timeout (about 10 s), so a hung API can't hold the request.
- **Logging:** a failure logs Resend's error name and HTTP status, never the address or the key.
- **The answer is unchanged:** `{ status: "invited", emailSent, accountRevision }`. The account
  stands either way, as today. There is no reason field.

### D7: Staff wording
- **Messages:**
  - "Account created and invitation sent";
  - "Invitation sent";
  - "Account created; the invitation email wasn't sent. Use Resend later.";
  - "The invitation email wasn't sent. Use Resend later.";
  - "Account reactivated. Use Resend to send the invitation.";
  - the Cancel invitation dialog: "…will be cancelled and it will no longer give them access."
- **Unchanged:**
  - "Send a sign-in invitation to <email>?";
  - "This invitation was already sent. If it didn't arrive, use Resend.";
  - every sign-in screen text.
- **Why:** nothing in the invitation is a code any more. "In a minute" referred to Auth's 60-second
  gap per address, which invitations no longer go through. A used-up daily quota lasts until the
  next day.

### D8: Tests follow the real path: invitation, then a code from the sign-in request
- **Mail-catcher helper:**
  - `latestInvitation(mailUrl, email, { after })` returns the newest invitation (subject, text,
    HTML).
  - `latestCode` reads only sign-in-code emails (subject "Your ViTally code").
- **Database test:**
  - Create account and Invite each deliver one invitation: the configured link, an expiry within one
    minute of `expires_at`, no six-digit run.
  - The test then requests a code with `signInWithOtp` (as the sign-in screen does), reads it, and
    verifies it.
  - Resend delivers a second invitation.
- **Sign-in test:** the client and volunteer invitation tests read the invitation the same way, then
  request a real code, read it, and pass it to `loginTestUser({ otp })`. The helper's intercepted
  `/auth/v1/otp` sends no second email, so that code stays valid.
- **Unit tests:**
  - the handler with a fake sender (what is sent, for which `kind`, with which key);
  - the 409 cases, failure, and the timeout;
  - the sender guard: neither set, both set, no `VITALLY_SITE_URL`;
  - the email module: links, expiry formats, no personal data from the request, no six-digit run,
    escaping.

## Risks / Trade-offs

- **[Risk] The edge runtime can't reach Mailpit's send API, or the CLI's Mailpit lacks it.**
  → Mitigation: plan task 1 checks it before anything else; the fallback is SMTP to the catcher.
- **[Risk] The free tier's 100 emails a day is shared by invitations and sign-in codes (Auth's SMTP
  uses the same Resend account).** About 10 testers send at most 20–30 a day, which is enough for
  the test. → Mitigation: the real season needs a paid plan or PCDC's sender, tracked in #215.
  A refused send shows "Use Resend later".
- **[Risk] The 7-day rule now exists in the function and in the database.** → Mitigation: the
  database test compares the two within one minute.
- **[Risk] A missing or doubled secret on the hosted project.** The function then answers every
  request with `SERVER_ERROR`. That covers all three of its operations (Create account, Invite and
  Resend), not only the sending. Cancel, Deactivate and Reactivate are database RPCs
  (`src/supabase-store.mjs`), so they keep working. → Mitigation:
  - deploy in this order and never the reverse: set the secrets first, then redeploy. The old
    function ignores the new secrets, so there is no gap;
  - the startup check refuses before anything is created;
  - the post-merge check sends one client and one volunteer invitation to Hailey's address.
- **[Trade-off] Delivery state is not stored.** If an email fails, the admin sees it once, and the
  Roster and the office panel still say "Invited". Accepted: Resend is always offered while invited,
  and nothing in the database changes.
- **[Risk] Replies land in a personal inbox.** "Questions? Reply to this email." goes to
  `help@govitally.org`, which Cloudflare Email Routing forwards to Hailey's Gmail. There is no
  `reply_to`. Replies may carry personal data. → Accepted for the test with fictional data. Where
  replies go for the real season belongs to #215.
- **[Trade-off] Client email is English + 简体 only.** Accepted for the test; 繁體 is an open
  question for PCDC.

## Migration Plan

No database migration. Deploy after merge, together with Hailey:
1. Check that the hosted database's session time zone is UTC (`show timezone;` in the SQL editor). If it isn't, stop (D5).
2. Hailey creates a send-only Resend key restricted to govitally.org.
3. Set the hosted function secrets `RESEND_API_KEY` and `VITALLY_SITE_URL=https://govitally.org`.
4. Only after step 3, redeploy the `accounts` function (`verify_jwt = false`, as today). Never reverse these two steps: until both secrets are set, the new function refuses every Create account, Invite and Resend.
5. Send one client invitation and one volunteer invitation to Hailey's own address. Check that each
   email has no code, the right link and the expiry, and that the invitee signs in on the first try.

Team stacks need the stack config update and a fresh copy of `supabase/functions/`, then a restart
(documented in `docs/setup.md`).

Rollback: redeploy the previous `accounts` function. The hosted secrets can stay; the old function
ignores them.

## Open Questions

- **繁體 in the client invitation.** Owner: Hailey, with PCDC. Many Cantonese-speaking clients read
  traditional characters. It affects only the client invitation text. If it's added, extend
  `build:hant` to the function's text, so `--check` catches drift.
- **May the client email's safety line also speak for PCDC?** Owner: Hailey, with PCDC. Today it
  says "ViTally will never ask…". If PCDC agrees, it becomes "ViTally and PCDC will never ask…" in
  English and 简体. It affects only the client invitation text and the tests that match the line.
- **Mailpit reachability and how the stack passes variables.** Owner: plan task 1. It affects only
  local and CI configuration, and whether the local sender uses HTTP or SMTP.
