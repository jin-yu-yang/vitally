# ViTally

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

ViTally is a web app that runs the shared workflow of a VITA (Volunteer Income Tax Assistance)
site: a multilingual intake form for clients, a workspace where volunteers prepare and review
returns, and an office workspace for follow-up, the volunteer roster and updates to the team. It
is built with and for **PCDC (Philadelphia Chinatown Development Corporation)**.

CSE 416 Final Project Group · By Cody Chi, Hailey Zheng, Jinyu Yang, Kelvin Chiu, Manqi Lu

## Background

At PCDC's site a client fills Form 13614-C, the office checks it, one volunteer prepares the
return in TaxSlayer, a second volunteer reviews it, and the client signs. ViTally tracks that case
from intake to the IRS's answer. **It never prepares or files a return**: TaxSlayer does that, and
the office records each result (e-filed, accepted, rejected) by hand.

There are three parts:

* **Client side:** sign in with an emailed code; the intake in English, 简体 or 繁體 (switchable
  at any moment), in standard or senior wording; consent forms 15080 and 14446; a progress
  page.
* **Volunteer workspace:** the work board, claiming preparation or review, a short questionnaire
  at each hand-off, the shaded section of Form 13614-C, and PCDC's Exit Form at signing.
* **Office workspace:** screening, walk-in cases, follow-ups, filing results and closing; the
  Volunteers tab (roster, clearance, workload) and posted updates.

What is built and what comes next: [docs/roadmap.md](docs/roadmap.md).

### Notable constructs

* **The database owns the workflow.** Every action is a SQL function that checks who is asking,
  the case's stage and its revision, then writes the change and its history
  ([`003_action_core.sql`](supabase/migrations/003_action_core.sql) onward). The browser only
  names what it may ask for ([`src/domain.mjs`](src/domain.mjs),
  [`src/case-actions.mjs`](src/case-actions.mjs)); stages are listed in
  [`src/contracts.mjs`](src/contracts.mjs).
* **One data adapter:** [`src/supabase-store.mjs`](src/supabase-store.mjs) calls those functions
  and listens to Supabase Realtime, so every open window sees a change at once.
* **Intake catalogue:** questions are written in [`docs/intake-questions/`](docs/intake-questions/)
  and built by `npm run build:intake` into [`src/intake-catalogue-data.mjs`](src/intake-catalogue-data.mjs)
  and a catalogue migration.
* **Forms built in the browser:** the draft 13614-C ([`src/draft-form.mjs`](src/draft-form.mjs),
  [`src/draft-pdf.mjs`](src/draft-pdf.mjs)) and the Exit Form ([`src/exit-form.mjs`](src/exit-form.mjs))
  are made with pdf-lib from the answers; nothing is stored.
* **Client text:** English and 简体 live in [`src/client-text.mjs`](src/client-text.mjs);
  繁體 ([`src/zh-hant.mjs`](src/zh-hant.mjs)) is generated with `npm run build:hant`. Staff screens
  are English.
* **Clearance:** a volunteer's roles need confirmed certificates, and an uncleared staff member
  reads no case data ([`045_volunteer_clearance.sql`](supabase/migrations/045_volunteer_clearance.sql),
  [`src/clearance.mjs`](src/clearance.mjs)).

### Security

* Sign-in is Supabase Auth with a one-time email code; there is no public sign-up, and accounts
  are invited by the office.
* Row-level security decides who reads what; a reviewer can never review their own preparation, and
  the database enforces it.
* ViTally stores no uploaded files: documents go to PCDC's own OneDrive.
* **Use fictional data only** until PCDC agrees to the next rollout step. The open security work is
  in [#160](https://github.com/jin-yu-yang/vitally/issues/160) and [docs/roadmap.md](docs/roadmap.md).

## Setup

Requirements:

* Node.js **24.21.0** (the project uses a command-scoped `PATH`, see
  [`docs/setup.md` §1](docs/setup.md#1-runtime))
* Docker, for the local Supabase stack
* `npm ci` installs everything else, including the Supabase CLI and OpenSpec

The local Supabase stack runs from its own work directory, never from the repo root. Follow
[`docs/setup.md`](docs/setup.md) end to end: the stack, `.env.local` and `.env.test`, migrations,
and the fictional rehearsal accounts.

## Run the server

```sh
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). Without `.env.local` the app shows its
setup-needed screen.

To sign in locally:

1. Type `site-coordinator@example.org` (a staff account from the example roster) and press
   **Send verification code**.
2. Open the local mailbox at [http://127.0.0.1:54324](http://127.0.0.1:54324) and copy the code
   from the newest message. Nothing leaves your machine.
3. Paste the code and press **Verify and continue**.
4. To play the client too, use a private window and `client-a@example.org`.

`npm run seed:local` adds fictional cases and volunteers to the local stack.

## Development

### Run some tests!

| Command | What it runs |
| --- | --- |
| `npm test` | Unit tests, no network |
| `npm run test:database` | Database suites against the local stack (after `npm run db:migrate:test`) |
| `npm run test:auth-browser` | Sign-in in real Chrome and Firefox |
| `npm run test:browser` | The full story in both browsers (about 20–25 minutes) |
| `npm run build:hant -- --check` | 繁體 is up to date |

CI runs all of them on every pull request ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

### How we work

Behaviour changes go through an OpenSpec change in `openspec/changes/<name>/` (brainstorm,
proposal, design, delta specs, tasks, plan, verify, retrospective), then a pull request that a
teammate reviews and squash-merges. Bug fixes and documentation go straight to a PR. Canonical
specs are in [`openspec/specs/`](openspec/specs/); the rules are in [`CLAUDE.md`](CLAUDE.md).
Migrations are hand-written and never edited once applied.

## Deploying the Application

The test environment is a hosted Supabase project plus the static front end
([`public-config.json`](public-config.json)), with email sent from `help@govitally.org`. It is
not fully running yet; the steps are in [`docs/setup.md` §6–7](docs/setup.md#6-classroom-and-hosted-setup-pending)
and what remains is in [docs/roadmap.md](docs/roadmap.md#deployment).

## Documentation

| Document | What it is |
| --- | --- |
| [`docs/roadmap.md`](docs/roadmap.md) | What is built, what comes next, and target dates |
| [`docs/setup.md`](docs/setup.md) | Local setup, migrations, tests, hosted setup |
| [`docs/developer/`](docs/developer/README.md) | Architecture, database and action API, browser app, tooling |
| [`docs/demo-script.md`](docs/demo-script.md) | Walk-through for the local rehearsal accounts |
| [`docs/intake-questions/`](docs/intake-questions/) | Intake questions, standard and senior wording |
| [`docs/design/`](docs/design/README.md) | Design system and screen images |
| [`docs/spec.md`](docs/spec.md), [`docs/proposal.md`](docs/proposal.md) | Original specification, pre-survey and proposal |
| [`docs/meeting-minutes/`](docs/meeting-minutes/) | Meeting minutes |
| [`docs/media/`](docs/media/) | PCDC logos, lifecycle diagrams, IRS forms |

## License

[MIT](LICENSE)
