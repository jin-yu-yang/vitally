# Invitation Emails Without a Code: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create account, Invite a client and Resend send an invitation email with no code. It says who invited the person, where to sign in and when the invitation expires. It goes through Resend's HTTP API on the hosted project and the mail catcher's HTTP API locally and in CI.

**Architecture:** The `accounts` Edge Function's handler stops calling `signInWithOtp`. Instead it calls an injected `sendInvitation`, built by a plain sender module from the environment. Exactly one of Resend or the mail catcher is configured, plus a required site URL. A plain text module builds the email. Staff wording changes from "code" to "invitation". The integration tests read the invitation, then request a code the way the sign-in screen does.

**Tech Stack:** Deno Edge Function (plain ES modules tested with `node --test`), Resend HTTP API, Mailpit HTTP API, Supabase CLI local stack, Playwright (`tests/auth-browser.mjs`).

**Spec:** `openspec/changes/send-invitation-emails/design.md` and `openspec/changes/send-invitation-emails/specs/sign-in-accounts/spec.md`. Read both before any task.

## Global Constraints

- **No migration**, no RPC/RLS/realtime change, no change to the sign-in screen or `src/client-text.mjs`.
- **Fictional data only** in tests and fixtures: `@example.org` addresses, the fictional SIDNs already in the tests.
- **From:** `ViTally <help@govitally.org>`.
- **Resend:** `POST https://api.resend.com/emails`, header `Authorization: Bearer <RESEND_API_KEY>`. `Idempotency-Key: <actionId>` for create and invite only.
- **Mail catcher:** `POST <VITALLY_MAIL_CATCHER_URL>/api/v1/send` (Mailpit's send API), unless Task 1 records the SMTP fallback.
- **Environment:** exactly one of `RESEND_API_KEY` / `VITALLY_MAIL_CATCHER_URL`, and `VITALLY_SITE_URL` is required. Otherwise the function answers `500 {"code":"SERVER_ERROR"}`, and the log names the variables, never their values.
- **Expiry:** the function's clock + 7 days, shown in `America/New_York`.
- **No email ever contains:** a run of six digits (`/\b\d{6}\b/`), a sign-in code or link, the recipient's name, or anything from a case or profile.
- **Recipient's address:** the email does not print the recipient's address, in the body or in the link. It says "the email address this message was sent to" (spec and D3). A numeric address therefore can't produce a six-digit run.
- **Logging:** never the address or a key.
- **Send timeout:** 10 000 ms.
- **Staff wording (exact):**
  - "Account created and invitation sent"
  - "Invitation sent"
  - "Account created; the invitation email wasn't sent. Use Resend later."
  - "The invitation email wasn't sent. Use Resend later."
  - "Account reactivated. Use Resend to send the invitation."
  - Cancel dialog: "The invitation for <who> will be cancelled and it will no longer give them access. …"
- **Unchanged wording:** "Send a sign-in invitation to <email>?" and "This invitation was already sent. If it didn't arrive, use Resend."
- **Commands (per memory and CLAUDE.md):**
  - Give every command a timeout. Never run a server in the foreground.
  - Never run `supabase start` from the repo root. A stack lives in its own `$VITALLY_STACK` (docs/setup.md).
  - Never touch another developer's running stack.
  - If Docker or an approval is missing, report BLOCKED.

## Review Focus

1. **The site URL has a trailing slash** (`https://govitally.org/`): the link is printed once, without `//`. Test in Task 2.
2. **An expiry that crosses a daylight-saving change** (sent 2026-10-29 at 3:00 PM EDT): the database adds exactly 7×24 h (`now() + interval '7 days'` in UTC), so the expiry is 2026-11-05 at 2:00 PM EST. The email must show that true instant, not the send's wall-clock time. Test in Task 2. The handler adds `7 * 86400000` ms, as the database does.
3. **Resend answers with a non-JSON body** (a 502 HTML page) or an empty body: not sent, no throw. Test in Task 3.
4. **The sender throws or `fetch` rejects:** the handler still answers 200 with `emailSent: false`, and the account stands. Test in Task 4.
5. **An address in mixed case or with `+tag`:** the email goes to the address the database returned, unchanged. Test in Task 4.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/functions/accounts/invitation-email.mjs` (new) | builds `{ subject, text, html }` for a client or volunteer invitation |
| `supabase/functions/accounts/sender.mjs` (new) | reads the environment, returns the configuration error or `{ siteUrl, sendInvitation }`; Resend and mail-catcher senders |
| `supabase/functions/accounts/handler.mjs` | uses `deps.sendInvitation` and `deps.siteUrl` instead of `anonClient` |
| `supabase/functions/accounts/index.ts` | builds the sender with `senderFromEnv`, merges its missing variables into the existing check |
| `tests/invitation-email.test.mjs`, `tests/accounts-sender.test.mjs` (new) | unit tests |
| `tests/accounts-function.test.mjs` | handler unit tests |
| `src/controller.mjs`, `src/volunteer-views.mjs` | staff wording |
| `tests/support/mail-catcher.mjs` | `latestInvitation`, and `latestCode` limited to code emails |
| `tests/database-accounts-function.mjs`, `tests/auth-browser.mjs` | integration tests |
| `supabase/test-stack.config.example.toml`, `.github/actions/test-stack/action.yml` | function variables for local stacks and CI |
| `docs/setup.md`, `docs/developer/backend.md`, `docs/demo-script.md` | docs |

---

### Task 1: The local mail path (design D2, open question)

**Files:**
- Modify: `supabase/test-stack.config.example.toml`, `.github/actions/test-stack/action.yml`, `docs/setup.md` (the stack section only)
- Create: none in the repo. Probe files go in the scratchpad.

**Interfaces:**
- Produces: the database session time zone (expected `UTC`); a recorded `VITALLY_MAIL_CATCHER_URL` value or pattern that works from inside the edge runtime, and the mechanism that passes it and `VITALLY_SITE_URL=http://127.0.0.1:4173` to the function on every team stack and in CI. Or else the decision to use SMTP: host, port, and the reason. Tasks 3 and 6 use it.

- [ ] **Step 1: Start a fresh isolated stack.** Follow docs/setup.md ("Isolated local Supabase test stack") with a new `$VITALLY_STACK` and a label such as `invite-probe`. Copy `supabase/functions/` and the example config as documented.
- [ ] **Step 2: Find the catcher from inside the edge runtime.**
  - Put a throwaway probe function in `$VITALLY_STACK/supabase/functions/mail-probe/index.ts`, never in the repo. It does `fetch(Deno.env.get("VITALLY_MAIL_CATCHER_URL") + "/api/v1/info")` and returns the status and body.
  - Try these, in order:
    1. `http://supabase_inbucket_<project_id>:8025`, through `[edge_runtime.secrets]` with `env(VITALLY_MAIL_CATCHER_URL)` exported before `supabase start`;
    2. the same value in `$VITALLY_STACK/supabase/functions/.env`;
    3. `http://host.docker.internal:<mail web port>` (works on Docker Desktop; check whether it works on the CI runner's Linux).
  - Expected: `200` with Mailpit's version JSON for at least one of them.
- [ ] **Step 3: Confirm the send API.**
  - From the probe, `POST /api/v1/send` with `{"From":{"Email":"help@govitally.org","Name":"ViTally"},"To":[{"Email":"probe@example.org"}],"Subject":"probe","Text":"probe"}`.
  - Expected: 200 `{"ID":…}`, and the message shows up in `GET <mail web URL>/api/v1/search?query=to:probe@example.org` from the host.
- [ ] **Step 4: If no option passes Steps 2–3:** record why, and switch Task 3's catcher sender to SMTP to the catcher (`supabase_inbucket_<project_id>:1025`) with a Deno SMTP client pinned to an exact version. Note the deviation in the task report.
- [ ] **Step 5: Write the mechanism into the repo.**
  - In `supabase/test-stack.config.example.toml`: add the mechanism with a comment that it is for test stacks only and never holds `RESEND_API_KEY`.
  - In `.github/actions/test-stack/action.yml`: set whatever CI needs (for example, export the variable before `supabase start`, with project id `vitally-ci`).
  - In docs/setup.md's stack section: one paragraph on the two variables, including that a running stack needs a restart after the change.
- [ ] **Step 6: Check the database time zone.** Run `show timezone;` on the probe stack's database, both as `postgres` and as the API's role (`set role authenticator;` in `psql`, then `show timezone;`). Record both. Expected: `UTC`. If either isn't UTC, **stop and report BLOCKED to Hailey**. D5 assumes `now() + interval '7 days'` is exactly 7×24 h, and in another zone Postgres keeps the wall-clock time across a DST change.
- [ ] **Step 7: Stop and delete the probe stack** (`supabase stop --no-backup --workdir "$VITALLY_STACK"`). Delete its directory only if it is the probe stack you created.
- [ ] **Step 8: Commit.**
  ```bash
  git add supabase/test-stack.config.example.toml .github/actions/test-stack/action.yml docs/setup.md
  git commit -m "Test stack: pass the mail catcher and site URL to the accounts function (#219)"
  ```

### Task 2: The invitation email text (design D3, D4, D5)

**Files:**
- Create: `supabase/functions/accounts/invitation-email.mjs`, `tests/invitation-email.test.mjs`

**Interfaces:**
- Produces: `invitationEmail({ kind, siteUrl, expiresAt }) → { subject: string, text: string, html: string }`.
  - `kind` is `"client" | "volunteer"`.
  - `expiresAt` is a `Date`.
  - It throws `TypeError` for an unknown kind.
  - Also `export const INVITATION_DAYS = 7`.

Exact copy (Hailey, 2026-11-18):

- **Client subject:** `You're invited to ViTally · 邀请您使用 ViTally`
- **Client text:** the English block, a blank line, then the 简体 block.

  English:
  ```
  Hello,

  The PCDC VITA free tax site has invited you to ViTally, where you can answer the questions for your tax return and see which documents to bring.

  To sign in, go to {link} and enter the email address this message was sent to. We will email you a sign-in code when you sign in.

  This invitation is valid until {en}. After that, ask the tax site to invite you again.

  ViTally and PCDC will never ask for your password, Social Security number or bank details by email.

  Questions? Reply to this email.

  If you weren't expecting this email, you can ignore it.
  ```

  简体:
  ```
  您好：

  PCDC 免费报税站（VITA）邀请您使用 ViTally。您可以在 ViTally 上填写报税所需的资料，并查看需要携带哪些文件。

  登录方法：前往 {link}，输入接收这封邮件的电子邮箱地址。登录时，我们会通过电子邮件发送登录验证码。

  此邀请有效期至{zh}。过期后，请联系报税站重新发送邀请。

  ViTally 和 PCDC 绝不会通过电子邮件索取您的密码、社会安全号码或银行信息。

  如有疑问，请直接回复此邮件。

  如果您不清楚为什么收到这封邮件，请直接忽略。
  ```

- **Volunteer subject:** `You're invited to ViTally as a PCDC VITA volunteer`
- **Volunteer text (English only):**
  ```
  Hello,

  You've been added to the PCDC VITA volunteer roster, and your ViTally account is ready. ViTally is where the site prepares, reviews and follows up on returns.

  To sign in, go to {link} and enter the email address this message was sent to. We will email you a sign-in code when you sign in.

  The first time you sign in, you'll confirm your site with your name and the site's SIDN. Your site coordinator can give you the SIDN.

  If anything is still needed for this season, such as your signed Form 13615, ViTally will show you what's missing before you can work on cases.

  This invitation is valid until {en}. After that, ask your site coordinator to invite you again.

  Questions? Reply to this email.

  If you weren't expecting this email, you can ignore it.
  ```

- **Placeholders:**
  - `{link}`: `siteUrl` with trailing slashes removed. Nothing is added to it: no address, no query.
  - `{en}`: built from `Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts`, as `${weekday}, ${month} ${day}, ${year} at ${hour}:${minute} ${dayPeriod} (New York time)`, with plain spaces only.
  - `{zh}`: `纽约时间 ${year}年${month}月${day}日 ${HH}:${mm}`, from `zh-CN` parts with `hourCycle: "h23"`.
- **HTML:** the same paragraphs in `<p>` elements, with `{link}` as a clickable `<a href="{link}">{link}</a>`, and every inserted value HTML-escaped (`& < > " '`).

- [ ] **Step 1: Write the failing tests** in `tests/invitation-email.test.mjs`:
  - `client email is English then 简体`:
    - the subject equals the client subject;
    - the text contains "has invited you to ViTally, where you can answer the questions" before "邀请您使用 ViTally";
    - the link is printed in both blocks;
    - the text contains "will never ask for your password" and "绝不会通过电子邮件索取".
  - `volunteer email is English with the site check and setup lines`:
    - the subject equals the volunteer subject;
    - it contains "volunteer roster", "confirm your site with your name and the site's SIDN" and "Form 13615";
    - no CJK (`/[一-鿿]/`), and no SIDN value (`!/S\d{8}/`).
  - `expiry in New York time`: `expiresAt = new Date("2026-11-25T20:00:00Z")` gives `valid until Wednesday, November 25, 2026 at 3:00 PM (New York time)` and `有效期至纽约时间 2026年11月25日 15:00`.
  - `expiry across daylight saving` (Review Focus 2): `new Date("2026-11-05T19:00:00Z")` (7×24 h after 2026-10-29 3:00 PM EDT) gives `Thursday, November 5, 2026 at 2:00 PM`.
  - `trailing slash` (Review Focus 1): `siteUrl: "https://govitally.org/"` → the printed link is `https://govitally.org`, and the html's `href` is exactly `https://govitally.org`.
  - `no six-digit run and no code words`, for both kinds and 20 random dates: `!/\b\d{6}\b/.test(text + html)`; no `{{`.
  - `nothing personal`: the function takes no address or name. The test calls it with an extra `{ name: "Rowan Pike", phone: "555-0100", to: "ada@example.org" }` and asserts that none of those strings appear anywhere, including the `href`.
  - `escaping`: `siteUrl: 'http://x.test/?a=1&b="2"'` → the html contains `&amp;` and `&quot;`, and no raw `"2"`.
  - `unknown kind throws`.
- [ ] **Step 2: Run them; expect failure** (module not found). `node --test tests/invitation-email.test.mjs`
- [ ] **Step 3: Implement `invitationEmail`** in `supabase/functions/accounts/invitation-email.mjs`. A plain module: no imports, no Deno or process globals.
- [ ] **Step 4: Run them; expect PASS.** Then run `npm test`; expect all pass.
- [ ] **Step 5: Commit.**
  ```bash
  git add supabase/functions/accounts/invitation-email.mjs tests/invitation-email.test.mjs
  git commit -m "Accounts function: invitation email text with no code (#219)"
  ```

### Task 3: Senders and the configuration guard (design D2, D6)

**Files:**
- Create: `supabase/functions/accounts/sender.mjs`, `tests/accounts-sender.test.mjs`
- Modify: `supabase/functions/accounts/index.ts`

**Interfaces:**
- Consumes: Task 1's catcher decision (HTTP or SMTP).
- Produces:
  - `senderFromEnv(get, { fetch = globalThis.fetch, log = console.error, timeoutMs = 10000 } = {}) → { ok: false, missing: string[] } | { ok: true, siteUrl: string, sendInvitation }`.
  - `get` is `(name) => string | undefined`, and blank counts as unset.
  - `missing` entries:
    - `"RESEND_API_KEY or VITALLY_MAIL_CATCHER_URL"` when neither is set;
    - `"only one of RESEND_API_KEY and VITALLY_MAIL_CATCHER_URL"` when both are set;
    - `"VITALLY_SITE_URL"` when it is missing.
  - `sendInvitation({ to, subject, text, html, idempotencyKey }) → Promise<{ sent: boolean }>`. It never rejects.
  - `export const FROM = "ViTally <help@govitally.org>"`.

- [ ] **Step 1: Write the failing tests** in `tests/accounts-sender.test.mjs`, with a recording fake `fetch` and `log`:
  - **guard:**
    - neither set → `{ ok: false }` with that entry;
    - both set → the "only one" entry;
    - no site URL → `"VITALLY_SITE_URL"` (alone or together with the others);
    - assert that `JSON.stringify(result)` contains no value passed in (for example `"re_secret"`).
  - **Resend request:**
    - URL is `https://api.resend.com/emails`, method POST;
    - `authorization: Bearer re_secret`;
    - `idempotency-key: <key>` when given, and absent when `idempotencyKey` is undefined;
    - JSON body `{ from: FROM, to: ["ada@example.org"], subject, text, html }`;
    - a `signal` is passed.
  - **Catcher request (HTTP):** `POST http://catcher.test/api/v1/send` (trailing slash on the setting tolerated), body `{ From: { Email: "help@govitally.org", Name: "ViTally" }, To: [{ Email: "ada@example.org" }], Subject, Text, HTML }`.
  - **Results:**

    | Fake answer | Expected |
    |---|---|
    | 200 | `{ sent: true }` |
    | `409 {"name":"invalid_idempotent_request"}` | `{ sent: true }` |
    | `409 {"name":"concurrent_idempotent_requests"}` | `{ sent: false }` |
    | `429 {"name":"daily_quota_exceeded"}` | `{ sent: false }` |
    | 502 with an HTML body (Review Focus 3) | `{ sent: false }` |
    | empty body | `{ sent: false }` |
    | `fetch` rejects | `{ sent: false }` |
    | an abort after `timeoutMs: 20` (fake fetch honours the signal) | `{ sent: false }` |

  - **Log:** each failure logs once, with the error name or `"network"` / `"timeout"` and the status. The log text never contains `ada@example.org` or `re_secret`.
- [ ] **Step 2: Run them; expect failure.** `node --test tests/accounts-sender.test.mjs`
- [ ] **Step 3: Implement `senderFromEnv`** in `supabase/functions/accounts/sender.mjs`. A plain module; use `AbortSignal.timeout(timeoutMs)`. If Task 1 chose SMTP, the catcher branch takes an injected `smtp` dependency instead of `fetch`. Adjust the catcher test to the recorded host and port.
- [ ] **Step 4: Run them; expect PASS.**
- [ ] **Step 5: Wire it into `index.ts`.**
  - `const mail = senderFromEnv((n) => Deno.env.get(n))`.
  - Append `mail.missing` to the existing `missing` list, so the same `console.error` and 500 path handles it.
  - On success, pass `sendInvitation: mail.sendInvitation, siteUrl: mail.siteUrl` in `deps`. Remove `anonClient` from `deps` (Task 4 stops using it).
- [ ] **Step 6: Run `npm test`; expect all pass.** The handler tests still pass, because they build their own deps.
- [ ] **Step 7: Commit.**
  ```bash
  git add supabase/functions/accounts/sender.mjs supabase/functions/accounts/index.ts tests/accounts-sender.test.mjs
  git commit -m "Accounts function: Resend and mail-catcher senders, exactly one configured (#219)"
  ```

### Task 4: The handler sends the invitation (design D1, D6)

**Files:**
- Modify: `supabase/functions/accounts/handler.mjs:136-149` (the `signInWithOtp` block), `tests/accounts-function.test.mjs`

**Interfaces:**
- Consumes: `invitationEmail`, `INVITATION_DAYS` (Task 2); the `sendInvitation` shape (Task 3).
- Produces: `deps` is `{ userClient, adminClient, sendInvitation, siteUrl, now? }`, where `now` defaults to `Date.now`. The answer shape is unchanged.

- [ ] **Step 1: Update the tests.**
  - In `fakes()`, replace `anonClient`/`otp` with `send` (a result, or a function that throws). It records `{ sendInvitation: message }` in `calls`. Add `siteUrl: "http://127.0.0.1:4173"` and `now: () => Date.parse("2026-11-18T20:00:00Z")` to deps.
  - Rename and change the existing tests:
    - `create runs prepare, createUser, record, then sends a volunteer invitation`: call order `getUser, vitally_prepare_account, createUser, vitally_record_account, sendInvitation`; `to: "ada@example.org"`; `idempotencyKey: ACTION`; subject `You're invited to ViTally as a PCDC VITA volunteer`; the text contains `valid until Wednesday, November 25, 2026 at 3:00 PM`.
    - `invite sends a client invitation`: subject contains `邀请您使用`; `idempotencyKey: ACTION`.
    - `resend sends the invitation of the account's kind with no key`: the volunteer resend gets the volunteer subject, the client resend (by email) gets the client subject, and `idempotencyKey` is undefined.
    - `email failure still answers 200 with emailSent false`: `send: { sent: false }`.
    - `a throwing sender still answers 200 with emailSent false` (Review Focus 4): `send: () => { throw new Error("x") }` → 200, `emailSent: false`, and `vitally_record_account` was called.
    - `the address goes as the database returned it` (Review Focus 5): prepare returns `email: "Ada+Tax@Example.org"` → `to` is identical.
    - Refusal and replay tests: assert `sendInvitation` is not in `names(calls)` (replacing `signInWithOtp`).
- [ ] **Step 2: Run them; expect the new tests to fail.** `node --test tests/accounts-function.test.mjs`
- [ ] **Step 3: Change `handler.mjs`.**
  - Replace the `signInWithOtp` block with:
    - `kind = target.volunteerId ? "volunteer" : "client"`;
    - `expiresAt = new Date((deps.now ?? Date.now)() + INVITATION_DAYS * 86400000)`;
    - `invitationEmail({ kind, siteUrl: deps.siteUrl, expiresAt })`;
    - `await deps.sendInvitation({ to: checked.email, ...email, idempotencyKey: op === "resend" ? undefined : actionId })` inside the existing try/catch;
    - `emailSent = result?.sent === true`.
  - Update the comment at the top and the "rate limit, cooldown" comment.
- [ ] **Step 4: Run `npm test`; expect all pass.**
- [ ] **Step 5: Commit.**
  ```bash
  git add supabase/functions/accounts/handler.mjs tests/accounts-function.test.mjs
  git commit -m "Accounts function: send the invitation email instead of a sign-in code (#219)"
  ```

### Task 5: Staff wording (design D7)

**Files:**
- Modify: `src/controller.mjs:3819-3820, 3901, 3907, 3912, 4001, 4004`, `src/volunteer-views.mjs:199`, `tests/controller.test.mjs` (around lines 8423, 8439, 8444, 8720, 8739, 8828), `tests/volunteer-views.test.mjs:393-394`

- [ ] **Step 1: Change the expected strings** in the two test files to the exact Global Constraints wording. Add a volunteer-views assertion that the cancel dialog lead contains "it will no longer give them access" and not "sign-in code".
- [ ] **Step 2: Run `npm test`; expect those tests to fail.**
- [ ] **Step 3: Change the strings** in `src/controller.mjs` and `src/volunteer-views.mjs`. Search `src/` for any other staff text about an invitation "code" (`grep -n "code" src/controller.mjs src/volunteer-views.mjs | grep -i "invit\|resend"`). The sign-in screen's texts stay.
- [ ] **Step 4: Run `npm test`; expect all pass.**
- [ ] **Step 5: Commit.**
  ```bash
  git add src/controller.mjs src/volunteer-views.mjs tests/controller.test.mjs tests/volunteer-views.test.mjs
  git commit -m "Roster and office panel: say invitation, not sign-in code (#219)"
  ```

### Task 6: Integration tests read the invitation, then sign in with a requested code (design D8)

**Files:**
- Modify: `tests/support/mail-catcher.mjs`, `tests/database-accounts-function.mjs:84-121`, `tests/auth-browser.mjs` (the client invitation test ~l.638–700 and the volunteer test ~l.770–790)

**Interfaces:**
- Consumes: Task 1's stack configuration (the function has `VITALLY_MAIL_CATCHER_URL` and `VITALLY_SITE_URL=http://127.0.0.1:4173`).
- Produces:
  - `latestInvitation(mailUrl, email, { after, timeoutMs }) → Promise<{ subject, text, html }>`: the newest message to `email` after `after` whose subject starts with `You're invited to ViTally`.
  - `latestCode` considers only messages whose subject is `Your ViTally code`.
  - Both read Mailpit (`Subject`, `Text`, `HTML`) and Inbucket (`subject`, `body.text`, `body.html`).

- [ ] **Step 1: Update `mail-catcher.mjs`.** Update its header comment.
- [ ] **Step 2: Add a shared assertion helper** in `mail-catcher.mjs`: `assertInvitation(message, { siteUrl, expiresAt })`.
  - The text contains `siteUrl`.
  - `!/\b\d{6}\b/.test(text + html)`.
  - The English expiry parsed from the text (`/valid until (.+?) \(New York time\)/`) is within 60 000 ms of `expiresAt`. Parse it by rebuilding the date in New York time; no exact string compare.
- [ ] **Step 3: Database test.**
  - **"create account sends an invitation, and a requested code signs the volunteer in":**
    - after `call(create)`, `latestInvitation`, then `assertInvitation` with the row's `expires_at`, read by `select expires_at from public.accounts …`;
    - then `signedIn.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })` with no error, `latestCode`, `verifyOtp`;
    - the rest is as today.
  - **"invite then resend sends a second invitation":** two `latestInvitation` calls, the second after the resend. Delete the 61-second wait: the invitation no longer goes through Auth. The second expiry is later than or equal to the first.
- [ ] **Step 4: Sign-in test.**
  - **Client invitation test:**
    - after "Invited", `latestInvitation`, then `assertInvitation` with the row's `expires_at`;
    - then `await fixture.anonClient().auth.signInWithOtp({ email, options: { shouldCreateUser: false } })` with no error, then `latestCode`;
    - then `loginTestUser({ …, otp: code })` as today. The helper intercepts the form's `/auth/v1/otp`, so the requested code stays valid. Update the comment that says the code came from the invitation.
  - **Volunteer test:** wait for "Account created and invitation sent", then the same three steps, then `heading: "Confirm your site"` as today.
- [ ] **Step 5: Run the integration tests** on a fresh isolated stack built with Task 1's config and the current `supabase/functions/` (docs/setup.md):
  - `npm run test:database` (timeout 15 min); expect all pass;
  - `npm run test:auth-browser` (timeout 20 min); expect all pass.
  - Report the counts, before and after.
- [ ] **Step 6: Commit.**
  ```bash
  git add tests/support/mail-catcher.mjs tests/database-accounts-function.mjs tests/auth-browser.mjs
  git commit -m "Tests: read the invitation, then sign in with a requested code (#219)"
  ```

### Task 7: Docs

**Files:**
- Modify: `docs/setup.md` (section 6, hosted setup), `docs/developer/backend.md:103-134`, `docs/demo-script.md:205-225`

- [ ] **Step 1: `docs/setup.md` section 6.** Add:
  - the hosted function secrets `RESEND_API_KEY` (a send-only Resend key restricted to govitally.org, separate from Auth's SMTP key) and `VITALLY_SITE_URL=https://govitally.org`;
  - redeploy the `accounts` function after setting them;
  - invitations and sign-in codes share Resend's 100-emails-a-day free quota (the real season: #215);
  - the startup check: a missing or doubled setting gives `SERVER_ERROR` before anything is created.
- [ ] **Step 2: `backend.md`.** The function now sends its own invitation (sender, guard, idempotency, 409 handling); update the "Use Resend in a minute" sentence.
- [ ] **Step 3: `demo-script.md`.** The new wording; the invitee goes to the site and asks for a code.
- [ ] **Step 4: Check for leftover wording.** `grep -rn "sign-in code sent\|Resend in a minute\|code email" docs/ --include=*.md | grep -v superpowers` → nothing outside history.
- [ ] **Step 5: Commit.**
  ```bash
  git add docs/setup.md docs/developer/backend.md docs/demo-script.md
  git commit -m "Docs: invitation email, hosted secrets and shared quota (#219)"
  ```

### Task 8: Checks

- [ ] **Step 1:** `npm test` → all pass. Record the count.
- [ ] **Step 2:** `npx openspec validate --all` → 0 failed.
- [ ] **Step 3:** `npm run test:browser` on the isolated stack (about 25 min, background with a bounded wait), or the PR's CI `story` jobs. Record which, with the run link and the screenshot review.
- [ ] **Step 4:** Record in the task report:
  - which checks ran and why (`build:hant -- --check` isn't needed: no 简体 change in `src/`; no database migration);
  - the test counts before and after.
