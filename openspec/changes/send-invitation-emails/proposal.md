## Why

The invitation email that Create account, Invite a client and Resend send is really a sign-in code email, and its code can't be used: the sign-in screen's only path to code entry asks for a new code, which replaces the emailed one, and a code expires after an hour while an invitation lasts seven days (#219). Inviting the volunteer and admin testers by Dec 21 depends on fixing it. An invitation that says who invited them and where to sign in, with no code, lets every invitee sign in on their first try through the unchanged sign-in flow.

## What Changes

**The invitation email**
- From: the `accounts` Edge Function finishes Create account / Invite / Resend with Auth's `signInWithOtp`, so the invitee gets the Magic Link template, "Your ViTally code is …".
- To: the function sends its own invitation email with no code: who invited them (the PCDC VITA site), the sign-in link from configuration, "sign in with this email; you'll get a code then", the invitation's expiry date and time in New York time, and nothing personal, not even the recipient's address. A client's email is English then 简体, and says what ViTally is for and that ViTally never asks for passwords, Social Security numbers or bank details by email. A volunteer's is English: they were added to the roster, they'll confirm their site with their name and the SIDN at first sign-in, and ViTally shows what is still needed for the season.
- Reason: the emailed code can never be typed in.
- Impact: non-breaking for the sign-in flow, which is unchanged. The function's answer stays `{status, emailSent, accountRevision[, replay]}`.

**How it is sent**
- From: Auth's email path (custom SMTP through Resend on the hosted project; the mail catcher locally).
- To: the function calls Resend's HTTP API on the hosted project and the mail catcher's (Mailpit's) HTTP send API locally and in CI. Exactly one of `RESEND_API_KEY` / `VITALLY_MAIL_CATCHER_URL` must be set, and `VITALLY_SITE_URL` is required. Otherwise the function answers the existing missing-variable server error. Create and Invite send the action id as Resend's idempotency key.
- Impact: two new hosted function secrets (`RESEND_API_KEY`, a send-only key restricted to govitally.org, and `VITALLY_SITE_URL`). No migration.

**Staff wording**
- From: "Account created and sign-in code sent", "Sign-in code sent", "…the email wasn't sent. Use Resend in a minute.", "Use Resend to send a sign-in code.", and the Cancel invitation dialog's "its sign-in code will no longer work".
- To: "Account created and invitation sent", "Invitation sent", "…the invitation email wasn't sent. Use Resend later.", "Use Resend to send the invitation.", and "it will no longer give them access".
- Reason: nothing in the invitation is a code any more, and the 60-second Auth gap that "in a minute" referred to no longer applies.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `sign-in-accounts`: Create account, Resend and Invite a client send an invitation email with no code instead of a sign-in code email; the invitation email's contents; what the admin is told when it is or isn't sent.

## Impact

- Code: `supabase/functions/accounts/` (handler, entry, a new email text module and sender module), `src/controller.mjs` and `src/volunteer-views.mjs` (staff wording).
- Tests: `tests/accounts-function.test.mjs`, `tests/database-accounts-function.mjs`, `tests/auth-browser.mjs`, `tests/support/mail-catcher.mjs`, `tests/controller.test.mjs`, `tests/volunteer-views.test.mjs`.
- Local stack and CI: `supabase/test-stack.config.example.toml`, `.github/actions/test-stack/action.yml`, so the function gets `VITALLY_MAIL_CATCHER_URL` and `VITALLY_SITE_URL`.
- Docs: `docs/setup.md` (secrets, hosted setup), `docs/developer/backend.md`, `docs/demo-script.md`.
- External: Resend HTTP API (free tier, 100 emails a day, shared with sign-in codes). Hosted project: redeploy the `accounts` function and set the two secrets.
- No database migration, RPC, RLS or realtime change. No change to the sign-in screen or to the client text in `src/`.
