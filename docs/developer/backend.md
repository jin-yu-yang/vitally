# Back end and operations

ViTally has no application server. Supabase provides authentication, the HTTP API, live updates
and the database, and the business logic lives in the database ([database guide](database.md)).
This page covers everything else on the server side: the small local web server, configuration,
Auth and email, the privileged tooling, environments, and what to add when the system needs a
real service.

Step-by-step setup is in [`docs/setup.md`](../setup.md); this page explains how the parts work.

## What runs where

| Piece | Runs on | Talks to | Holds secrets? |
| --- | --- | --- | --- |
| Static files (`index.html`, `src/`) | Browser, from `server.mjs` or any static host | Supabase, with the publishable key | No |
| `server.mjs` | Developer machine, `127.0.0.1:4173` | Nothing; serves files and one JSON document | Reads `.env.local`, publishes only public values |
| Supabase (Auth, PostgREST, Realtime, PostgreSQL) | Local Docker stack, or a hosted project | Browsers, and SMTP for sign-in email | Yes: service keys, database password, SMTP credentials |
| `tools/admin/*` | Operator's machine | The database and Auth admin API directly | Uses `.env.test` or `.env.admin` |
| Test suites | Developer machine | The local stack only | Uses `.env.test` |

## The local server

[`server.mjs`](../../server.mjs) exists so a developer can run the app with `npm start`. It is not
needed in production: any static host that serves the files plus a `public-config.json` does the
same job.

- **Allowlist, not a file server.** It serves exactly `/`, `/index.html`, `/src/<name>.mjs|css|svg|png`,
  `/src/vendor/<name>.mjs`, the PDF forms under `/src/forms/` by their exact names (`FORMS` in
  `server.mjs`; the list is in [HTTP headers on the static host](#operations-checklist-for-a-real-deployment)), and
  `/public-config.json`. A new form file is served only once it is added to that pattern. The check runs on the raw request path
  before any `..` or percent-escape is resolved, so path tricks cannot reach migrations, tools or
  `.env` files. Everything else is 404.
- **`GET` and `HEAD` only**, with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
- **Port** 4173, or `PORT` from `.env.local`. It binds to `127.0.0.1` only.
- Tests: [`tests/server.test.mjs`](../../tests/server.test.mjs) covers traversal attempts, methods,
  and that no private value ever appears in a response.

### The public configuration contract

The browser fetches `./public-config.json` at start-up. It is one of exactly three shapes:

```json
{"configured": false}
```

```json
{
  "configured": true,
  "supabaseUrl": "https://<project-ref>.supabase.co",
  "supabasePublishableKey": "<publishable key>",
  "authResendCooldownSeconds": 65
}
```

```json
{
  "configured": true,
  "supabaseUrl": "http://127.0.0.1:54321",
  "supabasePublishableKey": "<publishable key>",
  "authResendCooldownSeconds": 65,
  "demoTools": true
}
```

`server.mjs` builds it from `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and
`AUTH_RESEND_COOLDOWN_SECONDS` in `.env.local`. A static host serves it as a plain committed file.
`server.mjs` adds `"demoTools": true` only when `VITALLY_DEMO_TOOLS` is `1` and `SUPABASE_URL` is a
loopback address (`127.0.0.1`, `localhost` or `[::1]`). If the flag is set but the URL is not on
this machine, the key is left out and the server prints a start-up warning that never includes
the URL. The browser shows the fill tools only when it receives the key and its own
`supabaseUrl` is also a loopback address. A committed `public-config.json` must never carry
`demoTools`; `tests/demo-tools-config.test.mjs` fails if any tracked `public-config*.json` does.
The publishable key is designed to be public; row-level security protects the data. **The
service-role (secret) key must never appear in this file, in `src/`, or in the repository.**

## Configuration files

| File | Committed? | Used by | Contains |
| --- | --- | --- | --- |
| `.env.example` | Yes | Template | Variable names for `.env.local` |
| `.env.local` | No | `npm start` | Public browser config (URL, publishable key, cooldown, optional port) |
| `.env.test.example` | Yes | Template | Variable names for `.env.test` |
| `.env.test` | No | Tests, `migrate`, `roster --target test` | Local stack URL, publishable and secret keys, database URL, instance id, manifest path |
| `.env.admin.example` | Yes | Template | Variable names for `.env.admin` |
| `.env.admin` | No | `migrate`/`roster --target classroom` | Classroom project URL, secret key, database URL, project ref, operator confirmation |
| `.vitally-targets.json` | No | Every privileged tool | Endpoint identity only (hosts, ports, container names, project refs); no keys |
| `.vitally-roster*.json` | No | `roster` | Approved email addresses and roles |
| `supabase/test-stack.config.example.toml` | Yes | Reference | The local stack's Supabase CLI settings |
| `.vitally-runs/` | No | Test fixtures | Records of what each test run created, for cleanup |

`.gitignore` excludes every `.env*` file except the `*.example` templates, and the targets,
roster and run files. Keep private files at mode `600`.

## Auth and email

Sign-in is Supabase Auth email one-time codes. The configuration that makes it safe:

| Setting | Value | Why |
| --- | --- | --- |
| Public sign-up | Off (`[auth] enable_signup = false`) | Only rostered accounts exist |
| Email provider | On (`[auth.email] enable_signup = true`) | The email method itself must stay enabled |
| Anonymous sign-ins | Off | No anonymous sessions |
| Browser call | `signInWithOtp({ shouldCreateUser: false })` | An unknown address creates nothing |
| Minimum resend interval | 60 s (`max_frequency = "60s"`) | The browser adds 5 s and shows a countdown |
| Email template | The **Magic Link** template contains `{{ .Token }}` | Existing users get that template; the app asks for the code, not a link |
| Rate limits | Supabase defaults | The local test stack raises `sign_in_sign_ups` to 1000 for automated tests only. Never copy that to a real project |

**Accounts are created only by the roster command** (below), already confirmed and with no
password. The sign-in form shows the same message for any address, so it cannot reveal who is on
the roster.

**Email delivery.** The local stack sends nothing: every email is caught by its local mailbox
(Mailpit, `http://127.0.0.1:54324` with default ports). A hosted project needs custom SMTP (Gmail
with an app password, or Resend with a verified domain); setup is in
[`docs/setup.md`, classroom section](../setup.md#6-classroom-and-hosted-setup-pending).

## Privileged tooling

Everything in [`tools/admin/`](../../tools/admin/) uses the secret key or the database password,
so each tool must prove it is pointed at the intended target before doing anything.

| Module | Role |
| --- | --- |
| `target-common.mjs` | Shared guard helpers: read the manifest, validate an API/database endpoint pair |
| `test-target.mjs` | Approves the local test stack: loopback only, exact container names, labels and ports from the manifest |
| `classroom-target.mjs` | Approves the classroom project: HTTPS, the session pooler (or a verified direct connection) with `sslmode=verify-full`, a project ref the operator typed in by hand, and nothing that matches the test target |
| `database.mjs` | `openDatabase(target)`: guard first, then connect; maps database errors |
| `migrate.mjs` | Applies pending migrations with a SHA-256 ledger. `--target test` (default) or `--target classroom` |
| `workspace-setup.mjs` | `initializeWorkspace`: creates a workspace, its three demo people, memberships, and staff members (038) |
| `roster.mjs` | Reads a roster file, creates confirmed password-free accounts, and calls `initializeWorkspace`. Never prints an address ([roster format](#the-roster)) |
| `seed.mjs` | `npm run seed:local`: builds rehearsal cases on the **local test stack only**. Needs `VITALLY_ALLOW_LOCAL_SEED=1` (checked before any file is read) and refuses any other target as `TARGET_REJECTED`. Records its case ids in `.vitally-runs/seed-<workspaceId>.json`, which the next run uses to replace the previous set. Never prints an address |
| `seed-cases.mjs` | The cases it builds, acting as the role accounts through `vitally_create_case` and `vitally_apply_action`. The only direct insert is the help request |

The database has no sample cases, reset or checkpoints (removed in #135, migration 040). Rehearsal cases come from `seed.mjs`.

A guard failure is always `TARGET_REJECTED` and deliberately does not say which check failed;
[`docs/setup.md`](../setup.md#private-test-configuration) lists what to check. The guards are unit
tested in [`tests/targets.test.mjs`](../../tests/targets.test.mjs).

### The roster

The roster is a JSON file (a `.vitally-roster*.json` file, ignored by version control; the template is
[`tools/admin/roster.example.json`](../../tools/admin/roster.example.json), and the base fields are in
[`docs/setup.md`](../setup.md#rosters)). Since 038 it can also create staff accounts:

```json
{
  "workspaceId": "replace-with-a-uuid",
  "presenters": ["presenter@example.org"],
  "staff": [
    { "email": "site-coordinator@example.org", "name": "Sky Chen (site coordinator)", "personKey": "site_coordinator", "capabilities": ["admin", "followup", "assist", "receive_documents"] },
    { "email": "preparer@example.org", "name": "Rowan Diaz (preparer)", "personKey": "preparer", "capabilities": ["prepare"] },
    { "email": "reviewer@example.org", "name": "Ari Novak (reviewer)", "personKey": "reviewer", "capabilities": ["review"] },
    { "email": "intaker@example.org", "name": "Kai Mensah (intaker)", "personKey": "intaker", "capabilities": ["receive_documents", "assist"] }
  ],
  "defaultFollowup": "site_coordinator",
  "applicants": ["client-a@example.org"]
}
```

| Field | Rule |
| --- | --- |
| `staff` | Optional list. Each entry has `email`, `name`, `personKey` and `capabilities`. `capabilities` is non-empty, from `prepare`, `review`, `admin`, `followup`, `receive_documents`, `assist`. `personKey` is lower-case letters, digits and underscores, unique on the roster, and not `alex`, `morgan` or `sam` |
| `defaultFollowup` | Optional: the `personKey` of a `staff` entry that has `followup`. It becomes the workspace's default follow-up person (who new follow-ups and withdrawal notices go to). **Required when the roster has no presenter**, because Sam, the default otherwise, would get work nobody can act on |
| `presenters` | Now optional, but the roster needs at least one presenter or one staff member. A presenter who signs in sees one plain screen, "This account is no longer used"; the role goes in #136 |

For each staff entry the command creates the Auth account as it does for any address, then, inside
`initializeWorkspace`'s one serializable transaction, calls `add_staff_member` (and
`set_default_followup` once, when given). Staff are always **new** people: the demo personas are never
linked. Re-running the same roster is safe; different values for an existing key or account are
refused, and changing a staff member's capabilities is not supported. Memberships, people and the
default are atomic, but the Auth account is created first, outside the transaction: a failed run can
leave a confirmed account with no membership, and a re-run completes it. The command never prints an
address; a problem is reported by position, such as `staff[1].capabilities`.

**Never run test cleanup against a real project.** The test fixtures create and delete their own
workspaces and accounts; they only ever accept the test target.

## Build tools

Two scripts generate committed files. Neither needs a key or touches a database.

| Command | Writes | When |
| --- | --- | --- |
| `npm run build:vendor` (`tools/build.mjs`) | `src/vendor/supabase.mjs` (the SDK), `src/vendor/pdf-lib.mjs` (pdf-lib and fontkit) and `src/vendor/pdfjs.mjs` with `src/vendor/pdfjs-worker.mjs` (pdf.js, copied), each pinned | After upgrading `@supabase/supabase-js`, `pdf-lib`, `@pdf-lib/fontkit` or `pdfjs-dist` |
| `npm run build:intake` (`tools/build-intake-catalogue.mjs`) | `src/intake-catalogue-data.mjs`, and a new `supabase/migrations/NNN_intake_catalogue_<hash8>.sql` when the catalogue's hash changed | After editing `docs/intake-questions/` ([database recipe](database.md#change-the-intake-questions)) |

The catalogue data is a JavaScript module rather than JSON because the local server (and the
allowlist above) serves only `/src/<name>.mjs|css|svg|png`. The migration must still be applied
to each environment with `migrate.mjs`, like any other.

## Environments

| Environment | Status | Purpose |
| --- | --- | --- |
| Local test stack (Docker, Supabase CLI 2.117.0) | Working | Development, all test suites, rehearsal accounts |
| Classroom project (hosted Supabase) | Not created yet | The class demonstration with real email |
| GitHub Pages copy of `main` | Serves files; shows "not configured" | Public demo once a `public-config.json` for the classroom project is committed |

For production you will want at least a development project, a staging project and a production
project, each with its own keys, SMTP settings and roster, and migrations applied to each in turn.
The target guards already separate a test target from a classroom target; extend the same idea to
staging and production rather than reusing one set of credentials.

## Operations checklist for a real deployment

None of this exists yet; it is the list to work through.

- **Continuous integration.** [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs on every
  pull request into `main` and every push to `main`: it fails on any text file committed with CRLF
  line endings, then runs `npm test`, `npm run build:hant -- --check`, `npm run build:intake` (failing if
  it leaves anything to commit), and `npx openspec validate --all`. None needs a database or a
  browser. The database and browser suites are not in CI yet: add each as its own job, with a Supabase
  CLI stack for the database and Playwright for the browser.
- **Backups and restore.** Decide what the plan's backups provide, and practise a restore.
- **Secrets.** Secret keys only in the hosting provider's secret store and operators' private
  files. Rotate them when someone leaves the team.
- **Monitoring.** Supabase logs for Auth failures, database errors and slow queries; alerts on
  email delivery failures.
- **HTTP headers on the static host.** A Content-Security-Policy allowing only the app's own
  scripts and the Supabase URL, plus HSTS. The local server sets `nosniff` but no CSP. Two
  things such a policy must keep working: the draft 13614-C fetches its Chinese fonts (and the
  Latin font beside them) from `https://cdn.jsdelivr.net`, pinned by version and checked by
  SHA-256 (`DRAFT_FONTS` in `src/draft-pdf.mjs`), so `connect-src` must allow that origin; and
  the three IRS forms, PCDC's two Form 14446 files and PCDC's blank Exit Form are the app's own
  files under `src/forms/` (`server.mjs` serves exactly those six as `application/pdf`), so a
  static host must publish that folder. The finished
  draft opens as a `blob:` URL in a new tab.
- **Data retention.** Tax data has retention and deletion obligations; decide them before any real
  client uses the system.

## Adding a service beside the database

Some production features cannot run in the browser or in SQL alone: sending status emails,
storing and scanning uploaded documents, generating IRS forms (13614-C, 14446) as PDFs, reports,
and any integration. When you need one:

- **Keep the database contract.** Let workflow changes keep going through the eight RPC functions
  (or new ones added the same way), so every rule stays enforced in one place, for every caller.
- **Run it server-side with the secret key**, as a Supabase Edge Function or a small separate
  service. Never ship the secret key to a browser.
- **React to changes, do not poll.** Subscribe to Realtime or use a database trigger to notify the
  service when a case changes, then read what you need.
- **Keep it idempotent.** Reuse the action-id-and-receipt pattern for anything a service writes, so
  retries are safe.

If the team later wants a conventional back end (for example Node or Python with its own API),
the SQL functions can move into it, but the check order, error codes, receipts and revision
fencing described in the [database guide](database.md#check-order-and-error-codes) are the
contract to keep. The browser's tests and the database tests describe that contract precisely.
