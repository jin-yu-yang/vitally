# ViTally

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

ViTally is a web app that runs the shared workflow of a VITA (Volunteer Income Tax Assistance)
site: a multilingual intake form for clients, a workspace where volunteers prepare and review
returns, and an office workspace for follow-up, the volunteer roster and updates to the team. It
is built with and for **PCDC (Philadelphia Chinatown Development Corporation)**.

CSE 416 Final Project Group

By Cody, Hailey, Jinyu, Kelvin, Manqi

What is built and what comes next: **[docs/roadmap.md](docs/roadmap.md)**.

## Clone

```bash
git clone https://github.com/jin-yu-yang/vitally.git
cd vitally
```

## Requirements

**Node.js 24.21.0.** Check with `node -v`. To install or switch versions:

- **macOS / Linux:** [nvm](https://github.com/nvm-sh/nvm), then `nvm use` in this folder
- **Windows:** [nvm-windows](https://github.com/coreybutler/nvm-windows) or the [official installer](https://nodejs.org)

**Docker**, running, for the local Supabase stack: [Docker Desktop](https://www.docker.com/products/docker-desktop/)
on macOS and Windows.

Everything else, including the Supabase CLI and OpenSpec, comes with:

```bash
npm ci
```

## Deployment

Test environment: **not live yet**. It will be a hosted Supabase project plus the static front
end ([`public-config.json`](public-config.json)), with email from `help@govitally.org`. What is
left: [docs/roadmap.md](docs/roadmap.md#deployment). How: [`docs/setup.md` §6–7](docs/setup.md#6-classroom-and-hosted-setup-pending).

## Local Development

```bash
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). Without `.env.local` it shows the
setup-needed screen. To sign in, first create the local Supabase stack, `.env.local`,
`.env.test` and the rehearsal accounts by following [`docs/setup.md`](docs/setup.md) (the stack
runs from its own folder, never from the repo root). Then:

```bash
npm run db:migrate:test   # apply the migrations
npm run seed:local        # fictional cases and volunteers
npm start
```

1. Sign in as `site-coordinator@example.org` and press **Send verification code**.
2. Copy the code from the local mailbox at [http://127.0.0.1:54324](http://127.0.0.1:54324).
3. For the client side, use a private window and `client-a@example.org`.

## Tests

```bash
npm test                        # unit, no network
npm run test:database           # database, against the local stack
npm run test:auth-browser       # sign-in, real Chrome and Firefox
npm run test:browser            # the full story, ~20–25 min
npm run build:hant -- --check   # 繁體 is up to date
```

CI runs them on every pull request. Which to run for a change: [`CLAUDE.md`](CLAUDE.md), Verification.

## Cross-platform notes

**Windows:**

- Every text file is checked out with LF (`.gitattributes`). A clone made before that keeps CRLF
  files and fails `build:hant -- --check`; refresh it as in
  [`docs/setup.md`, Line endings](docs/setup.md#line-endings-windows).
- `tests/write-test-env.test.mjs` (mode 600) always fails on Windows; CI passes. Ignore that one.
- The local stack uses a lot of memory. Stop it when you are not using it
  ([`docs/setup.md`, Start and stop](docs/setup.md#start-and-stop)).
- Each test account needs its own browser profile, for example Chrome, Chrome Incognito, Edge and
  Edge InPrivate.

**macOS:** if Docker is not on `PATH`, add `~/.docker/bin` to the command's `PATH`.

## How it works

At PCDC's site a client fills Form 13614-C, the office checks it, one volunteer prepares the
return in TaxSlayer, a second volunteer reviews it, and the client signs. ViTally tracks that case
from intake to the IRS's answer. **It never prepares or files a return**; the office records each
result (e-filed, accepted, rejected) by hand.

- **The database owns the workflow.** Every action is a SQL function that checks who is asking,
  the case's stage and its revision, then writes the change and its history
  ([`supabase/migrations/`](supabase/migrations/)). The browser only asks
  ([`src/case-actions.mjs`](src/case-actions.mjs)); stages are in [`src/contracts.mjs`](src/contracts.mjs).
- **One data adapter**, [`src/supabase-store.mjs`](src/supabase-store.mjs), calls those functions
  and listens to Supabase Realtime, so every open window updates at once.
- **Intake questions** are written in [`docs/intake-questions/`](docs/intake-questions/) and built
  with `npm run build:intake`.
- **Forms** (draft 13614-C, Exit Form) are built in the browser with pdf-lib
  ([`src/draft-pdf.mjs`](src/draft-pdf.mjs), [`src/exit-form.mjs`](src/exit-form.mjs)); nothing is stored.
- **Client text:** English and 简体 in [`src/client-text.mjs`](src/client-text.mjs); 繁體 is
  generated with `npm run build:hant`. Staff screens are English.
- **Security:** email-code sign-in, invitation only; row-level security decides who reads what;
  a reviewer can never review their own preparation; a volunteer without confirmed certificates
  reads no case data; no uploaded files are stored. **Fictional data only** until PCDC agrees to
  the next rollout step.

More: [`docs/developer/`](docs/developer/README.md).

## How we work

Behaviour changes go through an OpenSpec change (`openspec/changes/<name>/`), then a pull request
that a teammate reviews and squash-merges. Bug fixes and docs go straight to a PR. Migrations are
hand-written and never edited once applied. The rules: [`CLAUDE.md`](CLAUDE.md).

## Documentation

| Document | What it is |
| --- | --- |
| [`docs/roadmap.md`](docs/roadmap.md) | What is built, what comes next, target dates |
| [`docs/setup.md`](docs/setup.md) | Local stack, migrations, tests, hosted setup |
| [`docs/developer/`](docs/developer/README.md) | Architecture, database and action API, browser app, tooling |
| [`docs/demo-script.md`](docs/demo-script.md) | Walk-through for the local rehearsal accounts |
| [`docs/design/`](docs/design/README.md) | Design system and screen images |
| [`docs/spec.md`](docs/spec.md), [`docs/proposal.md`](docs/proposal.md) | Original specification, pre-survey and proposal |
| [`docs/meeting-minutes/`](docs/meeting-minutes/) | Meeting minutes |

## License

[MIT](LICENSE)
