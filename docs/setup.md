# ViTally setup and testing guide

This is the single setup guide for ViTally. It replaces the earlier per-task sections that used
to be appended here as each task landed; everything from those sections is folded in below,
organized by phase instead of by task number.

## What exists today, and what does not

Everything through the shared demonstration story is implemented and tested against an
**isolated local Supabase stack**: identity and case ownership, the full workflow (intake,
preparation, documents, admin follow-up, assistance, independent review and corrections,
reminders and closure), Realtime-driven shared state, rehearsal cases from `npm run seed:local` (a new workspace has none), and the client/staff/admin browser screens with real email
(OTP) sign-in. A roster command admits approved addresses to a workspace, so the local stack can
hold permanent fictional rehearsal accounts for signing in by hand
([Signing in locally](#signing-in-locally)).

**Not done, and not claimed here:** there is no hosted Supabase project, no classroom roster
admitted to one, no configured SMTP sender, and no live email delivery — that is Task 10B, a
user-owned step (see [Classroom and hosted setup](#6-classroom-and-hosted-setup-pending) below). There is also no public
hosting destination yet (Task 10D): the GitHub Pages copy of `main` currently serves the app with
no `/public-config.json` values set, so it shows the **"ViTally is not configured yet"** setup-needed
screen, not a working sign-in form. Nothing in this document should be read as claiming otherwise.
Every test described below runs against the isolated local stack; none of it exercises a hosted
project or real mail delivery.

## 1. Runtime

Use Node **24.21.0** explicitly. The machine's default shell resolves an older Node; never change
the global Node configuration. Prepend the pinned bin directory to `PATH` **for each command**
that needs it (installs, builds, tests) instead:

```sh
VITALLY_NODE_BIN=/Users/jinyuyang/.nvm/versions/node/v24.21.0/bin
VITALLY_NODE="$VITALLY_NODE_BIN/node"
VITALLY_NPM=/Users/jinyuyang/.nvm/versions/node/v24.21.0/lib/node_modules/npm/bin/npm-cli.js
"$VITALLY_NODE" --version
PATH="$VITALLY_NODE_BIN:$PATH" "$VITALLY_NODE" "$VITALLY_NPM" ci
```

`npm ci` installs the exact-pinned dependencies from `package-lock.json`: `@supabase/supabase-js`,
and (dev) `esbuild`, `pg`, `playwright`, the `supabase` CLI, and `opencc-js`. `opencc-js` is used
only at build and test time, never in the browser: `npm run build:hant` derives the Traditional
Chinese map `src/zh-hant.mjs` from every Simplified source string (OpenCC `tw`, characters only,
plus `tools/hant-overrides.mjs`), `npm run build:hant -- --check` fails if the committed map is out
of date, and the unit tests use it to check that no Simplified character survives on a 繁體 screen.
Run `npm run build:hant` after adding or changing any Chinese text, and commit the regenerated map. Docker must be running for the
local Supabase stack and its tests. On this Mac, if Docker is not otherwise on `PATH`, add
`/Users/jinyuyang/.docker/bin` to the **command's** `PATH` (shown in the database/auth/browser test
commands below).

## 2. Running the app locally

```sh
npm start
```

This runs `node --env-file-if-exists=.env.local server.mjs`, so the server starts whether or not
`.env.local` exists. Open <http://127.0.0.1:4173>.

- **No `.env.local`, or an incomplete one:** the app fetches `./public-config.json`, reads
  `{"configured": false}`, and renders the **setup-needed** screen ("ViTally is not configured
  yet") instead of a sign-in form. This is the state the public GitHub Pages copy of `main` is in
  today.
- **A complete `.env.local`:** copy `.env.example` to `.env.local` (git-ignored) and fill in:

  | Variable | Meaning |
  | --- | --- |
  | `SUPABASE_URL` | The project's API URL: your local stack's `API_URL` from its `status` output (`http://127.0.0.1:54321` with the CLI's default ports), or `https://<project-ref>.supabase.co` once a hosted project exists. |
  | `SUPABASE_PUBLISHABLE_KEY` | The publishable (anonymous) key. A public client identifier, not a secret — the service-role/secret key must never go here. |
  | `AUTH_RESEND_COOLDOWN_SECONDS` | Optional. The project's own minimum email-resend interval plus five seconds (65 for the verified 60-second local setting). Falls back to 65 if missing or non-positive. |

  Only these three values ever reach the browser, and only through `GET /public-config.json`,
  which returns `{"configured":true,"supabaseUrl":…,"supabasePublishableKey":…,
  "authResendCooldownSeconds":<positive integer, default 65>}` when both required values are set,
  and `{"configured":false}` otherwise. It contains nothing else. The app fetches it **relatively**
  (`./public-config.json`), so a static host can ship a plain file in that path instead of running
  this server (relevant to Task 10D). Administrative keys, database URLs and SMTP credentials
  belong in `.env.test` / `.env.admin` (below) and are never served.

  `server.mjs`'s allowlist serves only the page, `/src/<name>.(mjs|css|svg)`,
  `/src/vendor/<name>.mjs`, and `/public-config.json`; everything else — including `.env.local`,
  `.env.test`, migrations, and this documentation — is 404.

  If port 4173 is taken (`lsof -nP -iTCP:4173 -sTCP:LISTEN` shows by what, often an older
  `npm start` still running in another terminal), stop that process or add `PORT=4174` to
  `.env.local`.

### Signing in locally

A configured app shows the sign-in form, but a code is only sent to an address on a workspace
roster: every other address gets the same neutral message and nothing else, by design. The test
suites delete every account they create, so a fresh local stack has nobody on it. Rehearsing by
hand therefore needs a small, permanent roster of fictional **rehearsal accounts**. The local
stack never sends real mail: every code lands in its local mailbox (Mailpit), a web page at
`http://127.0.0.1:54324` with the CLI's default ports (the `[local_smtp]` port otherwise).

**Create the rehearsal accounts (once per stack).**

1. Copy the example roster:

   ```sh
   cp tools/admin/roster.example.json .vitally-roster.local.json
   ```

2. Replace `replace-with-a-uuid` in that file with a new ID. This is the only time you need one;
   the ID stays in the file and every later run reuses it.

   ```sh
   "$VITALLY_NODE" -e "console.log(crypto.randomUUID())"
   ```

3. Create the accounts. The example roster makes one presenter, `presenter@example.org`, one
   client, `client-a@example.org`, and four staff accounts named for
   their roles:

   | Address | Person | Can |
   | --- | --- | --- |
   | `site-coordinator@example.org` | Sky Chen (site coordinator) | admin, follow-up, assist, receive documents. Is the default follow-up person |
   | `preparer@example.org` | Rowan Diaz (preparer) | prepare |
   | `reviewer@example.org` | Ari Novak (reviewer) | review |
   | `intaker@example.org` | Kai Mensah (intaker) | receive documents, assist |

   The Intaker lands on the Work board until the roster change that gives the role its own
   landing page.

   ```sh
   PATH="$VITALLY_NODE_BIN:/Users/jinyuyang/.docker/bin:$PATH" \
     "$VITALLY_NODE" --env-file=.env.test tools/admin/roster.mjs \
     --target test --roster .vitally-roster.local.json
   ```

   It prints how many accounts it created. Running it again is harmless and creates nothing new;
   to add people, append addresses to the file and run it again. Nobody is ever removed.

   Run it again after you pull a change to the example roster. The seed command (below) needs the
   current role accounts. If you copied the file before this change, copy it again and keep your
   workspace ID.

**Use them (every time).**

1. Start the app with `PATH="$VITALLY_NODE_BIN:$PATH" npm start` and open
   <http://127.0.0.1:4173>.
2. Type `site-coordinator@example.org` and press **Send verification code**.
3. Open <http://127.0.0.1:54324> in another tab, open the newest message, and copy the code.
4. Paste it into **Verification code** and press **Verify and continue**. You are signed in as
   Sky Chen, the site coordinator, with the office screens.
5. To rehearse as another role, sign in as `preparer@example.org`, `reviewer@example.org` or
   `intaker@example.org` the same way (the code arrives in Mailpit like any other). The preparer's
   screen says "Signed in as Rowan Diaz (preparer)". Each account acts only as its own
   person, with that person's capabilities. The fill buttons ("Fill fictional details",
   "Auto-fill fictional data") appear for anyone, staff included, only when `.env.local` sets
   `VITALLY_DEMO_TOOLS=1`. To add another fictional staff rehearsal account, append an entry to
   the `staff` list of `.vitally-roster.local.json` (see [Rosters](#rosters)) with a fictional
   address and run the roster command again.
6. To play the client at the same time, open <http://127.0.0.1:4173> in a private window (or a
   second browser) and repeat steps 2–4 with `client-a@example.org`.

A new code for the same address can be requested only about once a minute; the form shows a
countdown. The presenter account, `presenter@example.org`, is still in the example roster. It
shows one plain screen, "This account is no longer used", with **Sign out**. There are no
sample cases, persona picker or checkpoint loader. For rehearsal
cases, run `npm run seed:local` (below). Stop the app with Ctrl+C in its terminal.

**Seed the rehearsal cases.** To fill the rehearsal workspace with cases at every stage, run the
seed command. It is local only: it refuses any target that is not the local test stack, and it does
nothing unless you opt in with `VITALLY_ALLOW_LOCAL_SEED=1`.

```sh
VITALLY_ALLOW_LOCAL_SEED=1 PATH="$VITALLY_NODE_BIN:/Users/jinyuyang/.docker/bin:$PATH" npm run seed:local
```

It reads `.vitally-roster.local.json` (or the file after `--roster`), acts as the role accounts
through the same functions the app uses, and builds:

- client A's case, just submitted, at Received;
- ten office-entered cases: preparation ready, waiting on documents, an escalated follow-up for the
  Site Coordinator, ready for review, corrections required, review approved, state return rejected,
  accepted, on hold and withdrawn;
- one open help request on client A's case.

On the corrections-required case the case has no current reviewer, because asking for corrections
clears it. The Reviewer is named on that review round.

It prints `Seeded 11 cases (removed N from the previous run).` and records the cases in
`.vitally-runs/seed-<workspaceId>.json`. A re-run replaces the previous set and leaves every other
case alone. If it stops with `SEED_SETUP`, a role account or client A is missing from the
workspace, or the default follow-up person is not the site coordinator account (this happens on a
stack set up from the old example roster). In both cases, run the roster command again with the
current example roster.

Seed before you open the app, or reload any window that is already open afterwards.

To get the fictional fill buttons while rehearsing, add `VITALLY_DEMO_TOOLS=1` to `.env.local` and
restart the app. They appear only when `SUPABASE_URL` points at this machine (`127.0.0.1`,
`localhost` or `[::1]`). With a hosted URL the setting is ignored and the server prints a warning.

The rehearsal workspace is permanent and separate from the test suites' own workspaces; the
database suite and the sign-in gate pass with it present.

### The vendor bundle

`src/app.mjs` imports its browser libraries from committed files, not a CDN or a runtime build
step:

```sh
PATH="$VITALLY_NODE_BIN:$PATH" "$VITALLY_NODE" tools/build.mjs   # npm run build:vendor
```

This writes four files under `src/vendor/`, each with a banner naming its library version:

- `supabase.mjs`: `@supabase/supabase-js` alone (via `tools/vendor-entry.mjs`, which re-exports
  only `createClient`), bundled into minified ESM with esbuild.
- `pdf-lib.mjs`: `pdf-lib` and `@pdf-lib/fontkit` (via `tools/vendor-pdf-entry.mjs`), bundled the
  same way, for the draft Form 13614-C and Form 14446.
- `pdfjs.mjs` and `pdfjs-worker.mjs`: `pdfjs-dist`'s legacy build, copied rather than bundled
  (it is already minified ESM and its worker must stay a separate file), for the shaded-section
  editor. The editor loads them only when it opens.

Rebuild and commit them whenever one of those pinned versions changes; there is no other build
step, and a static host serves these files as-is.

## 3. Isolated local Supabase test stack

All database migrations, integration tests, and the browser test suites run against a dedicated,
**uniquely named** local Supabase CLI stack — never the classroom project, and never an
already-in-use workspace inside a shared database (that is not isolation). This project's guarded
tooling verifies both the literal loopback endpoints and the running containers' exact project
label, names, and published ports on every privileged connection.

### Create the stack

```sh
VITALLY_STACK=$(mktemp -d /private/tmp/vitally-<label>.XXXXXXXX)
VITALLY_INSTANCE=$(basename "$VITALLY_STACK")
SUPABASE_HOME="$VITALLY_STACK/cli-home" PATH="$VITALLY_NODE_BIN:$PATH" \
  ./node_modules/.bin/supabase init --workdir "$VITALLY_STACK"
```

`project_id` in the generated `config.toml` is set automatically from the working directory's
basename and must equal `VITALLY_INSTANCE`. Edit that `config.toml` to match
**[`supabase/test-stack.config.example.toml`](../supabase/test-stack.config.example.toml)**, the
committed, secret-free reference for this stack's settings (project id placeholder aside). In
summary: `[api] schemas=["public"]`; the database pooler (`[db.pooler]`) disabled; `[realtime]`
left **enabled** (the realtime isolation tests need it —
the earlier standalone Auth probe excluded Realtime deliberately and proves nothing about
subscriptions); `[auth] site_url="http://127.0.0.1:4173"`, `enable_signup=false`,
`enable_anonymous_sign_ins=false`; `[auth.email] enable_signup=true`, `max_frequency="60s"`; and,
**for this isolated automated stack only**, `[auth.rate_limit] sign_in_sign_ups=1000` (the
automated fixtures provision many independent password sessions from one loopback address in a
single run — this override must never be copied to a classroom/hosted project, which keeps the
CLI/hosted default).

**The sign-in email must carry the code.** The CLI's default Magic Link template sends a link and
no code, so the sign-in form, which asks for a code, cannot be used, and only the automated suites
(which read the code through the admin API) would work. Copy the example's
`[auth.email.template.magic_link]` section into the stack's `config.toml` and put the template file
it names next to it: copy this repository's
[`supabase/templates/magic_link.html`](../supabase/templates/magic_link.html) (one line,
`<p>Your ViTally code is {{ .Token }}</p>`) to `$VITALLY_STACK/supabase/templates/magic_link.html`.
A stack that is already running picks the template up after `supabase stop` (without
`--no-backup`, which would delete its accounts) and `supabase start`. The hosted project needs the
same template, set in its dashboard ([section 6](#6-classroom-and-hosted-setup-pending)).

`supabase init` writes the CLI's default ports: API 54321, PostgreSQL 54322, mail catcher web UI
54324, and so on. Keep them if nothing else on this machine uses them, or change every enabled
service's port in the stack's `config.toml` to an unused set, such as the one below that this
project's development runs used. Whichever set the stack runs on, `.vitally-targets.json` must
record the same API and PostgreSQL ports (see
[Private test configuration](#private-test-configuration)); a mismatch fails every guarded
command with `TARGET_REJECTED`.

| Service | Port |
| --- | --- |
| API (Kong) | 57321 |
| PostgreSQL | 57322 |
| Shadow PostgreSQL | 57320 |
| Studio (config only — the service is excluded at start) | 57323 |
| Mail catcher (Inbucket) web UI | 57324 |
| Mail catcher SMTP | 57325 |
| Mail catcher POP3 | 57326 |

### Pin PostgREST to 16.3

```sh
mkdir -p "$VITALLY_STACK/supabase/.temp"
printf %s v16.3 > "$VITALLY_STACK/supabase/.temp/rest-version"
```

Supabase CLI 2.117.0's default PostgREST 16.2 intermittently rejects freshly issued valid
sessions with `PGRST303: JWT issued at future`. PostgREST 16.3 fixes that upstream bug; no test
retry, token bypass, or timing delay is used instead. See the
[PostgREST changelog](https://github.com/PostgREST/postgrest/blob/main/CHANGELOG.md) and the
[CLI's override mechanism](https://github.com/supabase/cli/blob/v2.117.0/apps/cli/src/command-internal/legacy-service-version-overrides.ts).

### Start and stop

```sh
SUPABASE_HOME="$VITALLY_STACK/cli-home" PATH="$VITALLY_NODE_BIN:$PATH" \
  ./node_modules/.bin/supabase start --workdir "$VITALLY_STACK" \
  --exclude storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
SUPABASE_HOME="$VITALLY_STACK/cli-home" PATH="$VITALLY_NODE_BIN:$PATH" \
  ./node_modules/.bin/supabase status --workdir "$VITALLY_STACK" --output json \
  > "$VITALLY_STACK/status.private.json"
chmod 600 "$VITALLY_STACK/status.private.json"
```

`realtime` is deliberately **not** in the exclude list — omitting it from every stack-start
command used by this project's tests is required, not optional. Save status output only to an
ignored/private file; never paste keys into logs, chat, or a commit.

```sh
SUPABASE_HOME="$VITALLY_STACK/cli-home" PATH="$VITALLY_NODE_BIN:$PATH" \
  ./node_modules/.bin/supabase stop --workdir "$VITALLY_STACK" --no-backup
```

Stop only the stack created for a given run. **A system `/private/tmp` cleanup can delete the
stack's working directory while its Docker containers keep running underneath it** — that
happened during this project's own development. If CLI commands against a stack directory start
failing (missing `config.toml`, no `.temp`, etc.) but `docker ps` still shows its containers
healthy, the directory is gone; either restore it from
[`test-stack.config.example.toml`](../supabase/test-stack.config.example.toml) (same project id,
same ports, same PostgREST pin) or stop the orphaned containers by hand and recreate the stack
from scratch. Do not assume a stopped-looking stack has actually stopped.

### Private test configuration

Copy `.env.test.example` to ignored `.env.test` and populate it from the stack's own `status`
output — never by hand-typing values into chat or a log:

| Variable | Source |
| --- | --- |
| `VITALLY_TEST_MODE` | `local` |
| `VITALLY_TEST_SUPABASE_URL` | the stack's `API_URL` |
| `VITALLY_TEST_PUBLISHABLE_KEY` | the stack's `PUBLISHABLE_KEY` (or `ANON_KEY`) |
| `VITALLY_TEST_ADMIN_KEY` | the stack's `SECRET_KEY` (or `SERVICE_ROLE_KEY`) |
| `VITALLY_TEST_DATABASE_URL` | the stack's `DB_URL` |
| `VITALLY_TEST_LOCAL_INSTANCE_ID` | `VITALLY_INSTANCE` (the exact stack/project id) |
| `VITALLY_TARGET_MANIFEST` | the absolute path to ignored `.vitally-targets.json` |

[`tools/admin/write-test-env.mjs`](../tools/admin/write-test-env.mjs) writes both `.env.test` and
`.vitally-targets.json` from the status file saved in [Start and stop](#start-and-stop), with mode
600, and prints nothing secret. CI uses it the same way:

```sh
PATH="$VITALLY_NODE_BIN:$PATH" "$VITALLY_NODE" tools/admin/write-test-env.mjs \
  --status "$VITALLY_STACK/status.private.json" --instance "$VITALLY_INSTANCE" \
  --env .env.test --manifest "$PWD/.vitally-targets.json"
```

It refuses a status that is not a plain loopback stack. It overwrites both files, so a stack that
already has a working `.env.test` doesn't need it.

`.vitally-targets.json` records **endpoint identity only** — never passwords or API keys:

```json
{
  "version": 1,
  "test": {
    "mode": "local",
    "instanceId": "vitally-<label>.<random>",
    "apiOrigin": "http://127.0.0.1:57321",
    "database": {
      "host": "127.0.0.1", "port": 57322, "database": "postgres",
      "user": "postgres", "connectionMode": "direct"
    },
    "containers": {
      "api": {"name": "supabase_kong_vitally-<label>.<random>", "containerPort": 8000},
      "database": {"name": "supabase_db_vitally-<label>.<random>", "containerPort": 5432}
    }
  }
}
```

The `57321` and `57322` above are the example ports from the table in
[Create the stack](#create-the-stack), not fixed values. Copy `apiOrigin` and `database.port`
from your own stack's `API_URL` and `DB_URL` in its `status` output; a stack that kept the CLI
defaults uses `http://127.0.0.1:54321` and `54322`. `instanceId` is `VITALLY_INSTANCE`, and the
two container names are that id with the `supabase_kong_` and `supabase_db_` prefixes.

Set both files to mode `600`. Neither is ever printed, committed, or served: `.gitignore` excludes
`.env*` (except `*.example`) and `.vitally-targets*.json`, and `server.mjs`'s allowlist serves
only the page, compiled bundle, styles, and `/public-config.json`. No test tool falls back to
application (`.env.local`) or classroom (`.env.admin`) configuration; a missing or mismatched
manifest, wrong ports, a stopped stack, or a non-loopback target fails the guard rather than
silently skipping.

When a guarded command fails with `TARGET_REJECTED`, the guard deliberately does not say which
check failed. Check, in this order:

1. `apiOrigin` and `database.port` in `.vitally-targets.json` match the host ports `docker ps`
   shows for the stack's `supabase_kong_` and `supabase_db_` containers. This is the most common
   cause: copying the example ports while the stack runs on the CLI defaults.
2. `instanceId` equals `VITALLY_TEST_LOCAL_INSTANCE_ID` and the stack's `project_id`.
3. `VITALLY_TARGET_MANIFEST` is an absolute path to the file.
4. The stack is running, and `docker` is on the `PATH` of the command.

## 4. Migrations

Forty-one migrations, applied in order. 020, the version-2 switch-over, was added after 021 and 022: a stack that already has them applies it last, and a new one applies it in number order. Both give the same result. Re-running the migrator on an already-migrated stack is safe,
but not because the files themselves are re-runnable — `001` and `002` create their tables with a
plain `create table`, which fails the second time. What makes it safe is the ledger
`tools/admin/migrate.mjs` keeps: `vitally_private.schema_migrations`, one row per file with a
SHA-256 digest of its text. The migrator reads that row before each file and skips every file
already applied, so **the migrations are run only through the migrator, never by hand**:

| File | Adds |
| --- | --- |
| `001_identity_and_cases.sql` | Workspaces, memberships, people, `cases`, `action_receipts`; `vitally_create_case`; ownership RLS |
| `002_workflow_schema.sql` | `preparation_participants`, `document_requests`, `documents`, `admin_followups`, `contact_attempts`, `case_events`, `client_events`, `assistance_items` and their RLS (schema only — no actions yet) |
| `003_action_core.sql` | `vitally_apply_action` dispatcher; SAVE_ANSWERS, SUBMIT, VERIFY_INTAKE, CLAIM_PREPARATION |
| `004_documents_followup.sql` | REQUEST_DOCUMENT, RESPOND_DOCUMENT, RECORD_DOCUMENT_RESPONSE, VERIFY_DOCUMENT, ESCALATE_CONTACT, RECORD_CONTACT, RESOLVE_FOLLOWUP |
| `005_assistance_closure.sql` | `vitally_assistance_action` (CLAIM/RESOLVE); REMIND, CLOSE_CASE; `cases.last_reminded_at`/`last_reminded_by_person_id` |
| `006_review.sql` | `reviews` table; CLAIM_REVIEW, SUBMIT_REVIEW, REQUEST_CORRECTIONS, RESUBMIT_REVIEW, APPROVE_REVIEW, RECORD_REVIEW_CONTACT; self-review enforcement |
| `007_realtime_publication.sql` | Adds the twelve browser-readable tables to `supabase_realtime`, `publish = 'insert, update'` |
| `008_case_timestamps.sql` | `cases.created_at`/`updated_at`, maintained by every action/create path |
| `009_fixtures_and_realtime.sql` | `vitally_reset_fixtures`, `vitally_load_checkpoint`; the six seeded sample cases and one assistance item |
| `010_client_numbers.sql` | `workspaces.current_season`; `cases.season`/`client_number`, one number per submitted case in each workspace and season; the private `client_number_counters`; the `cases_client_number` trigger that assigns on submit and refuses any change; `backfill_client_numbers` for cases submitted before it; SUBMIT's `detail.clientNumber` |
| `011_intake_v2.sql` | The version-2 intake, schema only: `workspaces.default_intake_version` and `cases.intake_version` (set from the workspace on insert, never changed; a version-2 case starts empty); the private `intake_fields` table and its loader `load_intake_catalogue`; the value, visibility and missing-field checks that mirror `src/intake-catalogue.mjs`; `case_contacts` (both phones, best time and note; client-visible, in `supabase_realtime`); version-2 SAVE_ANSWERS and SUBMIT (no eligibility screening) |
| `012_intake_catalogue_<hash8>.sql` | Generated by `npm run build:intake`: the first load of the version-2 catalogue into `intake_fields` |
| `013_contact_materials.sql` | `case_materials` (staff only) and the UPDATE_CONTACT and RECORD_MATERIALS actions |
| `014_intake_catalogue_<hash8>.sql` | Generated in part 4b: reloads the same field rows as 012 (part 4b renamed three step titles, and the catalogue hash covers them) |
| `015_intake_loader.sql` | The loader learns the redesigned catalogue: the hidden `id` field type (`hh.member_id`), the private `intake_substeps` table (one row per sub-step, in order), and household members refused without a well-formed, unique `member_id` |
| `016_intake_catalogue_<hash8>.sql` | Generated: the redesigned catalogue (steps 0–9 with sub-steps) loaded through 015's loader |
| `017_documents_and_visits.sql` | `cases.intake_visited` (the sub-steps a client has opened, sent with SAVE_ANSWERS); `case_document_cards` (one row per document card the client or staff marked; client-visible on own cases, staff after submit; inserts and updates published to Realtime; no person column); the SET_DOCUMENT_CARD and SET_DOCUMENT_GROUP actions |
| `018_document_card_authority.sql` | Card authority: staff mark and move a case's document cards when they work on it (office staff on any case, a volunteer as its preparer or reviewer), the same rule as contact details and materials; never on a client's unsent draft |
| `019_fixtures_v2.sql` | The sample cases follow the workspace's version: in a version-2 workspace they are version-2 cases with answers, a `case_contacts` row and a household member with a fixed `member_id`. A checkpoint reload clears the sample's materials and card marks. No workspace's default version changes |
| `020_intake_v2_default.sql` | The switch-over: version 2 of the intake is the default. The column default becomes 2 and every workspace is set to 2, so new client and office applications and sample resets are version 2. Existing cases kept their version until 023 |
| `021_review_approved_message.sql` | The client's history line when a review is approved says signing and filing come next ("A volunteer will contact you soon to sign and file."): `act_approve_review` and `fixture_history` copied from 006 and 009 with only that sentence changed |
| `022_intake_catalogue_<hash8>.sql` | Generated by `npm run build:intake`: the wording review's catalogue (a document tip that lists more than one document ends "You will upload them") |
| `023_remove_intake_v1.sql` | Version 2 is the only intake version. A guard refuses while a real version-1 application exists (see below); version-1 samples and test-workspace version-1 cases are deleted (`fixture_generation` moves, so open windows re-read); every workspace is set to 2; the functions lose their version-1 paths (`vitally_create_case` now takes `{}` answers only); `intake_answer_keys` and `fixture_answers` are dropped; both version columns accept only 2. Nothing is re-seeded: the next **Reset sample cases** seeds version 2 |
| `024_intake_catalogue_59560589.sql` | Generated by `npm run build:intake`: a household member's optional middle name, and the Form 15080 signatures required when the client consents (the spouse's too when married) |
| `025_intake_catalogue_194034c5.sql` | Generated by `npm run build:intake`: not-married wording for Q5.2, Q9.1a, Q12.4, the nine income/expense/event leads and section 6's intro; the senior leads say 您爱人 (text only); for an unmarried client, Q5.3–Q5.9 ask directly and every "who" question offers Yes/No |
| `026_intake_catalogue_2239685d.sql` | Generated by `npm run build:intake`: Q0.5 `language_also` (the client's other service languages, multi-select, optional) and Q0.6 `language_also_other` (its "Please specify", shown if Q0.5 includes Other) |
| `027_intake_show_if_any_and_year_range.sql` | Hand-written: `intake_holds` reads the show-if conditions `gte`, `lte` (a whole number at least or at most `value`) and `any` (one of its AND groups holds); the loader checks them through the new `intake_show_if_ok`; `check_intake_value` applies a year's `min_value`/`max_value` |
| `028_intake_catalogue_40593b97.sql` | Generated by `npm run build:intake`: the spouse questions follow rule `spouse_on_return` (married, or widowed with the death from 2023 to 2025) or rule `joint_possible` (married, or a 2025 death); `spouse_death_year` is 1900–2025 |
| `029_intake_catalogue_9ee07ca8.sql` | Generated by `npm run build:intake`: Sections 15 and 16, the Form 14446 consent at 0.4 and the signatures at 1.5 |
| `030_fixture_answers_14446.sql` | Hand-written: the sample cases' Form 14446 answers |
| `031_contact_log.sql` | Hand-written: the contact log tables and RPCs, follow-up attempts moved in, `RECORD_CONTACT` refused, the sample cases seed the log, and `contact_attempts` leaves the Realtime publication |
| `032_screening_and_efiling_stages.sql` | Hand-written: the `screening`, `ready_to_efile` and `efiled` stages, `START_SCREENING`, `MARK_READY_TO_EFILE` and `MARK_EFILED`, `VERIFY_INTAKE` from `screening`, an office submit landing in `screening`, and `CLOSE_CASE` from `screening` |
| `033_review_questionnaires.sql` | Hand-written: `preparer_questionnaires` and `reviewer_questionnaires` (staff-only), `admin_followups.purpose` and a nullable `request_id`, `cases.signing_plan` and `signing_appointment_at`; the review hand-offs take a questionnaire, an approval settles the contact step and opens a go-over task when the reviewer did not, `MARK_READY_TO_EFILE` waits for that task, and the sample cases seed questionnaires |
| `034_screening_checks.sql` | Hand-written: `VERIFY_INTAKE` records the real screening checks, `phone`, `documents` and `in_scope`, plus `identity` only when the case's `service` answer is `online`; the client's history line says PCDC finished screening the application; `check_payload`, `act_verify_intake` and `fixture_history` replaced, and the sample cases record the new checks |
| `035_post_efiling_stages.sql` | Hand-written: the `rejected` and `accepted` stages, each return's filing method and result on `cases`, the staff-only `filing_attempts`, `filing_returns` and append-only `filing_notes`, `MARK_EFILED` with methods, `RECORD_FILING_RESULT` and `RETURN_TO_SIGNING`, and the `rejected` and `accepted` sample cases |
| `036_hold_and_closing.sql` | Hand-written: the `awaiting_documents` and `on_hold` stages, `cases.documents_origin`, `hold_origin` and `closing_reason`, the `REQUEST_DOCUMENTS_AT_INTAKE`, `PUT_ON_HOLD`, `RESUME_FROM_HOLD` and `WITHDRAW` actions, `CLOSE_CASE` with a reason, the `withdrawal_notice` follow-up purpose, and the `on_hold` and `withdrawn` sample cases |
| `037_adjust_filing_to_pcdc.sql` | Hand-written: PCDC never mails a return, so a paper return is `given_to_client` at Mark e-filed and the stored `mailed` result is renamed; all four federal/state method pairs are allowed; the `vitally_close_unsigned` RPC closes signing cases at season end |
| `038_staff_identity.sql` | Hand-written: the `staff` membership access, `people.user_id` linking a person to its staff account, the database's own `acting_person` resolver for the six entry points, staff accepted by the locks, authority check and policies, and `add_staff_member`, `set_default_followup` and a re-runnable `initialize_workspace` |
| `039_preparer_shaded_fields.sql` | Hand-written: the shaded section of Form 13614-C, filled by the case's preparer: the staff-only `preparer_shaded_fields` table (one row per case, in the Realtime publication; its select policy accepts `staff` like 038's), `vitally_private.check_preparer_fields`, and the `SAVE_PREPARER_FIELDS` action with its version guard; `check_operation_authority` and `vitally_apply_action` copied from 038 with the new action; the sample cases that have a preparer questionnaire get a fictional shaded row |
| `040_remove_sample_case_tools.sql` | Hand-written: the sample cases, the reset and checkpoint functions, the client bindings and the `fixture` columns are removed, and `origin` accepts only `client` and `assisted`. A workspace starts with no cases; use `npm run seed:local` for rehearsal cases |
| `041_resolve_go_over_during_hold.sql` | Hand-written: resolving a go-over task while the case is on a Hold from Ready to exit also switches the signing plan to the reviewer's method (#171) |

Catalogue changes ship as a new `NNN_intake_catalogue_*.sql` written by `npm run build:intake`;
never edit an applied one. The build writes one only when the catalogue's hash differs from the
newest catalogue migration's, and `tests/intake-build.test.mjs` fails while the committed catalogue
is ahead of the database.

**023's guard.** 023 refuses, and changes nothing, while any version-1 application exists that is
neither a sample case nor in a test suite's workspace — on a local stack, that means applications
made by hand in the rehearsal workspace before the switch-over (020). The error names the count and
the workspace ids (`Migration 023 refused: … version-1 application(s) exist outside test
workspaces`). There is no real version-1 data anywhere, so clear the stack instead of keeping it:
either delete that rehearsal workspace on the stack's database
(`delete from public.workspaces where id = '<id>'`; its people, memberships, cases and their rows
go with it, the sign-in accounts stay) and set it up again with step 3 of
[Signing in locally](#signing-in-locally) after the migration, or recreate the stack from scratch.
Then run `npm run db:migrate:test` again.

> **Migration numbering as built.** The original plan sketched fixtures/Realtime as a single
> migration named `007`. As implemented, the Realtime publication landed first as its own
> migration (**007**, Task 5) because Task 6's controller needed live subscriptions before Task 9
> existed; case timestamps followed as **008** (Task 7), so the staff board and My applications
> could show real times; the six seeded cases and reset/checkpoint controls became **009**
> (Task 9). Nothing here was renumbered after being applied to a shared/classroom project — no
> such project exists yet.

Apply and verify:

```sh
PATH="$VITALLY_NODE_BIN:/Users/jinyuyang/.docker/bin:$PATH" \
  "$VITALLY_NODE" --env-file=.env.test tools/admin/migrate.mjs
```

Expected output: `Approved test migrations applied.` The migrator uses one guarded persistent
PostgreSQL connection and a transaction, records checksums in a private schema, and refuses
changes to an already-applied migration file (a further change needs a new migration number). It
never deletes or resets a database. This is also `npm run db:migrate:test` under the same scoped
`PATH`.

Editing a file that has already been applied changes its digest, and the migrator refuses the
whole run with `MIGRATION_CHANGED` before it applies anything. On the isolated test stack the
recovery is the one migration `009`'s own header comment describes: either recreate the stack
from scratch, or first drop that file's own objects and its `schema_migrations` row with a local
script that is not part of the repository, then apply again.

A branch's own migration that is written to be re-applied (every migration since 010 is) can
instead be forgotten and applied again while it is not on `main`: delete its `schema_migrations`
row **and the rows of every later migration that replaces the same functions**, then run
`npm run db:migrate:test`. Forgetting one alone can put its older version of a function back over
a later one's (for example 011's `check_payload` over 013's). Migrations on `main` (001–014) are
never changed. A catalogue change on a branch deletes that branch's catalogue
migration and regenerates it with `npm run build:intake` instead of adding a second one, and a
change to the loader or the `intake_fields` columns bumps `LOADER_VERSION` in
`tools/build-intake-catalogue.mjs` so the build writes a new catalogue migration. The full rules
and the commands are in [`docs/developer/database.md`](developer/database.md#migrations).

## 5. Tests

All commands below run from the repository root with the command-scoped `PATH` shown. Each
suite's **last-verified count** is below. The database and unit counts were last verified on the
go-over Hold fix (2026-11-07, issue #171, with migration 041 applied). The story count was last
verified on 2026-11-06, in one run (see the note below the table). The auth-gate count is still from
the not-married intake wording (2026-10-14, change `add-unmarried-intake-wording`, with migration
025 applied). Re-run the commands yourself for the current number, since new work changes these counts.

| Suite | Command | Last verified | What it proves |
| --- | --- | --- | --- |
| Unit | `"$VITALLY_NODE" --test tests/*.test.mjs` | 1496/1496 | Pure domain/contract logic, the intake catalogue and version-2 renderer, the client text in three languages (every client screen swept in 简体 and 繁體, and the Traditional map checked against `opencc-js`), the auth/store adapters against fakes, the pure view renderers, the controller's async state machine, server allowlist/config logic — no network, no database. |
| Database | `PATH="$VITALLY_NODE_BIN:/Users/jinyuyang/.docker/bin:$PATH" "$VITALLY_NODE" --env-file=.env.test --test tests/database*.mjs` | 441/441 | Every migration, RLS policy, RPC, and error/ordering rule against the real isolated stack: ownership, authority, idempotent replay, concurrency, Realtime publication/isolation, client numbers, and the version-2 intake checks compared with the browser's. |
| Auth gate | `PATH="$VITALLY_NODE_BIN:/Users/jinyuyang/.docker/bin:$PATH" "$VITALLY_NODE" --env-file=.env.test --test tests/auth-browser.mjs` | 20/20, ~20–95 s | Real Chrome and real Firefox, driving the actual access form: a generated one-time code is typed in and verified through the real `verifyOtp` call; only the outbound `/auth/v1/otp` **send** is intercepted (email-free automation), never verification. |
| Browser story | `PATH="$VITALLY_NODE_BIN:/Users/jinyuyang/.docker/bin:$PATH" "$VITALLY_NODE" --env-file=.env.test --test tests/browser.mjs` | 83/83, ~11–26 min (see the note below the table) | The full demonstration script (see [`docs/demo-script.md`](demo-script.md)) end to end, twice, roles swapped between Chrome and Firefox, plus the regression list below. The main story signs in as the database fixture's role-named staff accounts, each once, in a staff window of its own (the Site Coordinator Avery Lin, the Preparer Taylor Brooks and the Reviewer Jamie Ellis), and switches windows instead of personas; its cases come from the seed module (`tools/admin/seed-cases.mjs`), run on the story's own workspace with a temporary run file. No step signs in as the presenter: each presenter step was replaced one for one by a step that uses the role accounts or the seed, and one phase checks that a presenter who signs in sees only the plain "This account is no longer used" screen. Its throwaway workspace is on version 2, the only intake version: staff read the answers, the contact card before and after a claim, record materials, edit the best time, work the document checklist and open the draft 13614-C; the office takes in a walk-in on the version-2 Add a case; one phase walks every sub-step of the redesigned intake, marks document cards, reviews, opens the draft 13614-C and submits; one phase checks the staff sidebar's peek and pin (peek without pushing the page, stay, a realtime redraw during a peek, close after leaving, pin, no re-peek after a collapse, keyboard, a dialog opened from a peek, and touch); one phase signs two real staff accounts in through the form, in separate windows (Riley Park, who prepares and reviews, and Jordan Lee, who reviews): the board updates live, Riley fills the shaded section in the editor and its field is as tall as its cell, Riley cannot review a case Riley prepared, and a persona left in storage is ignored. An extra admin account, Quinn Harper, made in the contact log step, serves the in-window account switch; and one phase works in Chinese in its own `zh-CN` browser context (the first visit is 简体 from the browser's language, the version-2 intake by Fill and the rail, submit, the progress page and its history in Chinese, one switch to 繁體 that fetches the Traditional map for the first time, a reload that keeps it, and back to English). Every other context is pinned to `en-US`. Optional to re-run before every rehearsal, but recommended before a presentation. |
The story passed 83/83 in one run on 2026-11-06 (about 26 minutes; the Chrome-client order about 14.1 minutes and the Firefox-client order about 12.2, against what was then a 15-minute limit for each, so the Chrome-client order was close to it; the limit is now 20 minutes, see #126), after the main story moved to the role-named staff accounts and the seed (#132), with migration 039 applied, run from a worktree on D:. The run before it failed once in the Firefox-client order on a hover check that passed in the runs before and after. Before that it passed 77/77 in one run on 2026-10-24 (about 25.6 minutes; an earlier run that day took about 20.7), on change `add-preparer-13614c-fields`, with migration 038 applied, run from a worktree on D: (not under OneDrive). History: it passed 63/63 in one run on 2026-10-20, on change `replace-simulated-screening-checks`, with migration 034 applied, run from a worktree on D: (not under OneDrive). Before that it passed 63/63 in one run on 2026-10-19, on change `add-preparer-and-reviewer-questionnaires`, with migration 033 applied, run from a worktree on D: (not under OneDrive); a worktree outside OneDrive works, while one under OneDrive fails it. Before that it passed 63/63 in one run on 2026-10-19, on change `add-screening-and-efiling-stages`, with migration 032 applied, run from the main checkout. Before that it passed 61/61 in one run on 2026-10-18, on change `add-contact-log`. Before that it passed 57/57 in one run on 2026-10-16 (about 16.6 minutes), on change `add-form-14446-consent`. Before that
it passed 57/57 in one run on 2026-10-16 (about 14 minutes), on change `add-widowed-spouse-rules`. Before that
it passed 57/57 in one run on 2026-10-15 (about 12.5 minutes), on change
`allow-multiple-service-languages`. Before that it passed 57/57 in one run on 2026-10-14 (about 13
minutes), on change `gate-review-and-redesign-summary`. Before that it passed 57/57 in one run on
2026-10-14 (about 12 minutes), on change `add-unmarried-intake-wording`. Before that it passed 57/57 in one run on 2026-10-13 (about 12
minutes), on change `require-15080-signatures-and-household-middle-name`. Before that it passed
57/57 in one run on 2026-10-12 (about 11.5 minutes), after its version-1 phase was removed (that
phase ran once per browser order, hence two fewer tests). Earlier still, it passed 59/59 twice in a row on 2026-10-10
(about 12 minutes each, on a machine with a load average of 7–8 on 8 cores). Earlier runs had
stopped intermittently in the
Chrome-client/Firefox-staff permutation on two Firefox-staff waits. Both are fixed: a persona press
now waits for a still page, as every other story press does; and the walk-in's materials wait came
from an app bug, now fixed, where a redraw unticked a box that was ticked but not yet saved. If a
run still stops on a Firefox-staff wait, run it again; a run on a quiet machine is the better check.

Install the second browser engine once, with the same scoped `PATH`, before the first auth-gate or
story run (Chrome runs through an already-installed Google Chrome browser via
`chromium.launch({channel:'chrome'})` and needs no separate install):

```sh
PATH="$VITALLY_NODE_BIN:$PATH" ./node_modules/.bin/playwright install firefox
```

Versions observed in the last recorded run (browsers on 2026-10-04, the stack on 2026-09-21): Google
Chrome 154.0.8037.97, Playwright Firefox 155.0 (build 1543), Playwright 1.63.0, Supabase Auth/GoTrue `v2.196.0`, PostgREST `v16.3`,
Realtime `v2.130.0`.

**What is simulated versus real, in every one of these runs.** The OTP **send** step
(`/auth/v1/otp`) is intercepted so automated tests never ask a mail server for anything; OTP
**verification** is real (`verifyOtp` against the real Auth server), every workflow action is a
real database call, and every Realtime notification is a real subscription delivery. Documents,
reminders, and TaxSlayer preparation milestones are simulated by design (see
[`docs/demo-script.md`](demo-script.md)) — the app never uploads a file, sends an external
message, or talks to tax-preparation software. No test run logs an address, a one-time code, or a
token; the browser story's evidence output is explicitly redacted before it is printed
(`tests/support/story-pages.mjs`).

The browser story writes screenshots (720px side-by-side and 390px mobile) to the git-ignored
`artifacts/browser/` directory; they are inspected as part of each task's review, not committed.
CI keeps each story leg's screenshots as a run artifact for 7 days
([Continuous integration](#continuous-integration)).

### Continuous integration

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every pull request into `main`,
every push to `main`, and on demand (`gh workflow run ci.yml --ref <branch>` runs it on any pushed
branch). Every job uses Node 24.21.0 and `npm ci`. A new push to a pull request cancels that pull
request's older run; runs on `main` are never cancelled.

**`checks`** needs no database, no browser and no `.env` file. It is the only job `main`'s branch
protection requires. It first fails if any text file is committed with CRLF line endings, then
runs:

1. `npm test` (the unit suite above);
2. `npm run build:hant -- --check` (the 繁體 map matches the 简体 source);
3. `npm run build:intake`, then fails if that leaves anything to commit (the catalogue module or a
   new catalogue migration is missing);
4. `npx openspec validate --all` (every active OpenSpec change and canonical spec). The OpenSpec
   CLI is a pinned dev dependency (`@fission-ai/openspec`, exactly 1.14.0), so the team and CI run
   the same version; its telemetry is off in CI.

**`database`, `sign-in` and `story`** each start their own fresh stack with
[`.github/actions/test-stack`](../.github/actions/test-stack/action.yml), which follows
[section 3](#3-isolated-local-supabase-test-stack) on the runner:

- The stack's `config.toml` is [`supabase/test-stack.config.example.toml`](../supabase/test-stack.config.example.toml)
  itself, with the project id `vitally-ci`, plus the code-carrying Magic Link template and the
  PostgREST 16.3 pin. CI therefore checks the committed reference, ports and all.
- `supabase start` runs with section 3's `--exclude` list, from the stack's own folder under the
  runner's temporary directory, never the repository root. Its output, which lists the keys, goes
  to a private file; if the start fails, the job prints the container states and only the log lines
  that name no key.
- [`tools/admin/write-test-env.mjs`](../tools/admin/write-test-env.mjs) writes `.env.test` and the
  target manifest from `supabase status --output json` and masks every key in the log. The target
  guard then checks the running containers exactly as it does locally; CI has no exception.
- `npm run db:migrate:test` applies every migration, in number order, to the empty database.

The stack's keys are generated on the runner, so CI uses no repository secret, and a pull request
from a fork runs the same way. These jobs run on `ubuntu-24.04` in New York time
(`TZ=America/New_York`), as every recorded local pass did: some screens use the browser's own date
while the database counts days in New York, so a runner on UTC could disagree with the database in
the evening. `checks` stays on UTC.

| Job | Runs | Notes |
| --- | --- | --- |
| `database` | `npm run test:database` | |
| `sign-in` | `npm run test:auth-browser` | Installs Playwright's Firefox with `playwright install --with-deps firefox`; Chrome is the runner image's Google Chrome |
| `story (chrome-client)`, `story (firefox-client)` | `tests/browser.mjs`, one browser order each (`--test-skip-pattern` skips the other) | Each uploads `artifacts/browser/` as `story-screenshots-<leg>`, pass or fail, kept 7 days |

Versions: Node, the Supabase CLI (and so its default service images), PostgREST and Playwright
(and so its Firefox) are pinned; Google Chrome is whatever the runner image ships, as on a
teammate's machine. Each job prints the images and browser versions it used. Only the npm cache
is cached: Playwright advises against caching its browsers, and saving and loading the stack's
Docker images takes about as long as pulling them.

The new jobs report on every pull request but do not block merging yet: after they have passed on
real pull requests for about a week, the repository owner can add `database` and `sign-in` to
`main`'s required checks. The story stays advisory until it has a record in CI. When a passing CI
run may stand in for running these suites locally is in [`CLAUDE.md`](../CLAUDE.md) (Project
rules, Verification).

### Line endings (Windows)

[`.gitattributes`](../.gitattributes) stores and checks out every text file with LF, whatever the
clone's OS or `core.autocrlf` (#56); images, PDFs and fonts are binary and never converted. The
tests compare generated files byte for byte and the migrator digests every migration file, so a
CRLF checkout used to fail `tests/hant.test.mjs` and `build:hant -- --check` on Windows.

A clone made before `.gitattributes` landed keeps its CRLF files until they are checked out
again. To refresh one (this discards uncommitted changes, so commit or set them aside first):

```bash
git rm -rq --cached .
git reset --hard
```

If such a clone ever ran `npm run db:migrate:test` from CRLF files, its test stack recorded CRLF
digests, and the migrator now refuses with `MIGRATION_CHANGED`: recreate that stack from scratch
(section 3). The same thing happens in the other direction: a stack whose digests were recorded from
CRLF checkouts reports `MIGRATION_CHANGED` for files that have not changed once it is migrated from an
LF checkout. The cause is the line endings, not an edit, so recreate the stack rather than hunting for
a changed file.

### Known, intentional behaviors these tests pin (not defects)

- **A stale-revision refusal at the client's document-response step is expected, not a bug.** If a
  client presses "Send sample document" within about a second of the office's own work on that
  case, the save is refused as a stale revision — correct per spec (a stale revision must never
  report false success) — and the refusal now stays on screen until the client presses again. A
  presenter driving both windows in a demonstration should expect this occasionally and simply
  press again.
- **An accepted case action produces two `cases` UPDATE events** (one from the action's own
  handler, one from the shared commit path). Anything that waits on a Realtime update should match
  the case's revision number, not merely the fact that an update arrived.
- **Internal findings, resolutions, and office notes never reach a client screen.** The browser
  story asserts this directly at the point where the client's own screen says "Ready to sign."

## 6. Classroom and hosted setup (pending)

Nothing in this section has happened. It is Task 10B (setup) and Task 10D (publication) —
user-owned steps, not implementation work, and this document does not claim otherwise. What the
user needs to provide before either can proceed.

A hosted or classroom copy never shows the fill tools, because its Supabase URL is not on the
machine that serves it. Classroom demos type their answers, or run from a local stack.

What the user needs to provide:

1. **A school sender email/account** (for the preferred Gmail SMTP path) **or** a
   presenter-controlled, DNS-verified domain for the Resend SMTP fallback — a school address alone
   cannot be used as an unverified sender.
2. **One approved test-client email address**, for the first real, authorized email-delivery
   check. Additional roster members can be added later.
3. **A Supabase account** with either two Free project slots (one classroom project, one separate
   automated-test project) or approval to keep using the isolated local stack above for testing
   indefinitely while only the classroom project is hosted.
4. **The class roster**: the exact approved email addresses admitted to the classroom project.
   Group/class admission is exact-address only; there is no domain-wide or public sign-up, and
   roster administration goes through the same privileged setup tooling this document uses for
   tests, not a browser admin screen.
5. **A hosting destination** for the built static app (Task 10D) — the current plan is GitHub
   Pages from `main`'s root, per this project's existing Pages configuration, but that is
   confirmed with the user when publication is actually reached, not assumed here.

Once those are available, classroom provisioning uses a separate, ignored `.env.admin` (copied
from `.env.admin.example`, which documents each variable name with no real values):

| Variable | Meaning |
| --- | --- |
| `VITALLY_ADMIN_SUPABASE_URL` | The classroom project's API URL — never the test project's. |
| `VITALLY_ADMIN_AUTH_KEY` | The classroom project's admin (service-role) key. |
| `VITALLY_ADMIN_DATABASE_URL` | The classroom project's direct/session-pooler database URL. |
| `VITALLY_CLASSROOM_PROJECT_REF` | The classroom project's reference id. |
| `VITALLY_ADMIN_CONFIRMED_PROJECT_REF` | The operator's **explicit, manually typed** confirmation that this is the intended classroom project — never derived automatically from a URL. |
| `VITALLY_TARGET_MANIFEST` | The absolute path to the same ignored `.vitally-targets.json` the tests use, which gains a `classroom` entry (step 1 below). |

`tools/admin/classroom-target.mjs`'s `assertClassroomTarget()` validates this whole tuple (and
TLS, and connection mode) before any classroom Auth-admin call, migration, or initialization; it
rejects any match to the test project's identity, any loopback target, a mismatched API/SQL
project pair, and a missing confirmation. Provisioning is a short sequence of separate steps,
each run against the confirmed target; there is deliberately no single command that does all of
them, and classroom tooling never imports the test suite's cleanup helpers. **Never run
privileged test cleanup against the classroom project.**

1. **Record the classroom project's identity** in `.vitally-targets.json`, beside `test`
   (identity only, never a password or key). Use the project's Session pooler endpoint:

   ```json
   "classroom": {
     "projectRef": "<classroom-ref>",
     "apiOrigin": "https://<classroom-ref>.supabase.co",
     "database": {
       "host": "<region-host>.pooler.supabase.com", "port": 5432, "database": "postgres",
       "user": "postgres.<classroom-ref>", "connectionMode": "session"
     }
   }
   ```

   `VITALLY_ADMIN_DATABASE_URL` is that same Session pooler URL with its password and
   `?sslmode=verify-full`; the transaction pooler (port 6543) is refused.
2. **Apply the migrations:**

   ```sh
   "$VITALLY_NODE" --env-file=.env.admin tools/admin/migrate.mjs --target classroom
   ```

   Expected output: `Approved classroom migrations applied.`
3. **Configure Auth in the Supabase dashboard:**
   - Custom SMTP (Authentication → Emails → SMTP Settings). Gmail: host `smtp.gmail.com`, port
     465, the full address as username and sender, and a Google *app password* (which requires
     2-Step Verification, and which a school's Google administrator may have disabled). Resend:
     host `smtp.resend.com`, port 465, username `resend`, the Resend API key as password, and a
     sender on the verified domain.
   - The **Magic Link** email template must contain `{{ .Token }}` (for example "Your ViTally code
     is {{ .Token }}"): existing users receive that template, and the app asks for the code, not a
     link.
   - Turn off new-user sign-ups and anonymous sign-ins; keep the Email provider on; set the Site
     URL to the hosting address once it exists.
4. **Admit the roster** with the roster command (format below). Start with one presenter and the
   one approved test-client address, send that client one real code, and only then add the class:

   ```sh
   "$VITALLY_NODE" --env-file=.env.admin tools/admin/roster.mjs \
     --target classroom --roster .vitally-roster.json
   ```

### Rosters

A roster is a small JSON file; [`tools/admin/roster.example.json`](../tools/admin/roster.example.json)
is the template. Real rosters hold people's addresses, so they live only in git-ignored files
matching `.vitally-roster*.json` and are never committed.

| Field | Meaning |
| --- | --- |
| `workspaceId` | A lower-case UUID. Generate it once and keep it: re-running the same roster with more addresses adds them to the same workspace. |
| `presenters` | Group members who run the demonstration. A presenter who signs in sees only the plain "This account is no longer used" screen (the role is removed in #136). Optional, but the roster needs at least one presenter or one staff member. |
| `staff` | Optional. Real staff members, each `{ "email", "name", "personKey", "capabilities" }`. Each gets a `staff` account linked to its own new person, which it always acts as, with the staff screens and no demo tools. `capabilities` is non-empty, from `prepare`, `review`, `admin`, `followup`, `receive_documents`, `assist`; `personKey` is unique and not `alex`, `morgan` or `sam`. Re-running is harmless, but an existing member's values cannot be changed. For a rehearsal, use fictional names and addresses. |
| `defaultFollowup` | Optional: the `personKey` of a `staff` entry with `followup`, who then gets new follow-ups. Required when the roster has no presenter. See [Back end: the roster](developer/backend.md#the-roster). |
| `applicants` | Classmates who play clients. Each sees only their own applications. |
| `sampleCaseOwners` | Removed in #135. A roster that still has it runs, and the command prints a note that it was ignored. |

For each address the command finds the existing Auth account or creates one already confirmed
and without a password (sign-in is by one-time code only), then grants presenter, staff or applicant
access through the shared `initializeWorkspace` routine. Addresses are matched exactly, ignoring
case. One account belongs to one workspace with one role; the routine refuses a roster that would
move someone or change their role (`VALIDATION`). The command never removes anyone, and its
output and errors never print an address — a problem is reported by roster position, such as
`applicants[3]`.

The `[auth.rate_limit] sign_in_sign_ups = 1000` override used by the isolated test stack above is
**test-only** and must not be copied into classroom configuration, which keeps the CLI/hosted
default.

Hosted `.env.test` (if hosted testing is later chosen instead of the isolated local stack)
additionally requires nonempty, distinct `VITALLY_TEST_PROJECT_REF` and
`VITALLY_CLASSROOM_PROJECT_REF`, and uses the project's **Session pooler** endpoint (port 5432,
`sslmode=verify-full`, TLS verification on) rather than the transaction pooler (port 6543) or an
unverified direct connection.

## 7. Hosting (pending)

`npm start` and its local server serve only the machine running them; nothing here is reachable
from anywhere else. Publication (Task 10D) happens only with the user's explicit authorization and
destination choice — this document does not invent or assume one. The built app is already
designed for static hosting with no build step (the committed vendor bundle, and
`/public-config.json` fetched relatively so a static host can ship a plain JSON file at that path
instead of running `server.mjs`), but until that file exists with real values, any deployed copy —
including the current GitHub Pages copy of `main` — shows the same "ViTally is not configured yet"
screen a fresh local checkout does.

Pages serves `main`'s root, so a deployed copy publishes every committed file, not only the page
and its bundle: the migrations, the admin tooling, the tests and these documents are all fetchable
at their repository paths. No secret is among them — `.gitignore` excludes `.env*` (except
`*.example`) and `.vitally-targets*.json` — and whether publishing the rest of the repository is
acceptable is part of what the hosting task (10D) settles with the user.
