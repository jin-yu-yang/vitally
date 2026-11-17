# ViTally

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

ViTally runs the shared workflow of a VITA (Volunteer Income Tax Assistance) site: client intake,
volunteer preparation, independent review, office follow-up, the volunteer roster and updates for
the team. It is built with and for **PCDC (Philadelphia Chinatown Development Corporation)**.

ViTally never prepares or files a tax return: that stays in TaxSlayer, and the office records
each milestone (e-filed, accepted, rejected) by hand. **Use fictional data only until PCDC agrees
to the next rollout step** (see [Before the pilot](#2-before-the-pilot-tax-season-2027)).

## Where ViTally stands (Nov 17, 2026)

The core workflow is built, and PCDC volunteers, the admin team and the program manager have tried
it. Three questions are still open, and the plan below is organised around them:

| | Question | What it means for us |
| --- | --- | --- |
| **Trust** | Is it safe enough to hold PCDC's data? | PCDC has had website security problems before. Our tests check what we expected; they don't prove safety, and most code is AI-written with limited human review. Safety has to be something PCDC can judge, not something hidden in code. |
| **Adoption** | Does it replace enough of what PCDC already uses? | Today ViTally *adds* a platform next to Slack, OneDrive, Airtable, TaxSlayer and Outlook. It has to take over the hard parts: volunteer management from Airtable, updates and notifications from Slack. |
| **Maintenance** | Who keeps it running after this season? | ViTally has no funding or staff, and its know-how sits with a few student developers. Without a handoff, PCDC goes back to its old workflow. |

### What works today

- **Clients:** sign in with an emailed code (office-invited addresses); fill the intake at home
  in English, 简体 or 繁體 (switchable at any moment), in standard or conversational wording; sign
  Forms 15080 and 14446; follow their case; withdraw.
- **Office:** screening checks, Add a case for walk-ins, Follow-ups, the case pool, waiting for
  documents and Hold, same-day signing, e-filed / accepted / rejected for federal and
  Pennsylvania, Return to signing, close, case history and contact log.
- **Volunteers:** work board, claim preparation or review, questionnaires at each hand-off, the
  shaded section of Form 13614-C, auto-generated 13614-C and 14446 drafts, PCDC's Exit Form at
  signing. The database stops anyone reviewing their own preparation.
- **Volunteer management (admin):** Roster with roles and certificates per season; a role exists
  only once its certificates are confirmed; an uncleared volunteer reads no case data and sees
  "Finish your setup"; Workload with Assign and Reassign; account invitations by email.
- **Updates:** admins post updates to the team, with notifications.

Behaviour is specified in [`openspec/specs/`](openspec/specs/).

## 1. Before Dec 21 (end of the semester)

**Outcome:** ViTally is deployed to a hosted test environment, ready to send magic links to
testers, and covers volunteer management (instead of Airtable) and team updates (instead of
Slack). Screening stays in Airtable. Dates are targets.

| | Work | Issue | Target | State |
| --- | --- | --- | --- | --- |
| Adoption | Roster: Form 13615 and photo ID uploads to PCDC's OneDrive link with "I've uploaded it" | [#138](https://github.com/jin-yu-yang/vitally/issues/138) | Nov 29 | Not started |
| Adoption | Season settings, site coordinator role, Start next season | [#138](https://github.com/jin-yu-yang/vitally/issues/138) | Nov 29 | Not started |
| Adoption | Returning-volunteer picker; Roster CSV export | [#138](https://github.com/jin-yu-yang/vitally/issues/138) | Nov 29 | Not started; picker can be cut |
| Adoption | Clearance fixes: role changes without a reload, a self-cleared admin, screen-reader announcement | [#190](https://github.com/jin-yu-yang/vitally/issues/190) [#191](https://github.com/jin-yu-yang/vitally/issues/191) [#192](https://github.com/jin-yu-yang/vitally/issues/192) | Nov 22 | Not started |
| Adoption | Workload and Reassign | #139 | — | **Done** |
| Adoption | Hourly volunteer schedule with a role per shift | [#140](https://github.com/jin-yu-yang/vitally/issues/140) | Dec 6 | Not started |
| Adoption | Posted updates and notifications | #150 | — | **Done** |
| Adoption | Note for the team on the case page | [#151](https://github.com/jin-yu-yang/vitally/issues/151) | Dec 6 | Not started; first to cut |
| Adoption | Case labels (City Tax, MFS, Multi-state) | [#148](https://github.com/jin-yu-yang/vitally/issues/148) | Nov 22 | In review ([#206](https://github.com/jin-yu-yang/vitally/pull/206)) |
| Adoption | One account reaches both the office and the work board | [#104](https://github.com/jin-yu-yang/vitally/issues/104) | Dec 13 | Not started; can be cut |
| Adoption | Mobile layouts for the admin screens | [#147](https://github.com/jin-yu-yang/vitally/issues/147) | Dec 20 | Not started |
| Trust | **"Export this season's data"** to CSV, so PCDC can keep it in SharePoint | not filed | Dec 13 | What the file holds and who may export: to decide by Dec 7 |
| Trust | **Plain-language security summary:** one page on where data lives, who sees what, when it's deleted, compared with Airtable | not filed | Dec 13 | Not started |
| Testing | **Hosted test environment**, end to end with one tester, then the final deploy | [#159](https://github.com/jin-yu-yang/vitally/issues/159) | Dec 6 / Dec 13 / Dec 20 | Project and email sending done; see [Deployment](#deployment) |

If we run late, we cut in this order: note for the team, the #104 switch, the returning-volunteer
picker.

## 2. Before the pilot (tax season 2027)

**Outcome:** PCDC volunteers use ViTally for real cases, one step at a time, and someone is
responsible for it after the student team. The season opens in late January 2027; nothing here is
scheduled week by week yet. Real-client prerequisites are collected in
[#167](https://github.com/jin-yu-yang/vitally/issues/167).

**Trust**
- **Step-by-step rollout:** fictional data, then a little low-risk real data, then full use. PCDC
  decides each step; real data only when PCDC agrees. *(not filed)*
- **A plan for when things go wrong:** how we notice a problem, who we tell, how we pause the
  system. *(not filed)*
- Security items before real taxpayer data: sensitive fields, staff sign-in, audit of reads,
  hosting headers, IRS confidentiality rules ([#160](https://github.com/jin-yu-yang/vitally/issues/160));
  a volunteer sees only the cases they work on ([#162](https://github.com/jin-yu-yang/vitally/issues/162));
  a backup-and-restore drill and real accounts ([#159](https://github.com/jin-yu-yang/vitally/issues/159)).
- **Season data:** when a new season starts, export to CSV, PCDC keeps it in SharePoint, ViTally
  deletes the previous season (agreed with PCDC). The deletion is
  [#161](https://github.com/jin-yu-yang/vitally/issues/161).

**Adoption**
- Magic links to more volunteers and to PCDC's board; improve from their feedback.
- Client documents through PCDC's OneDrive upload link ([#157](https://github.com/jin-yu-yang/vitally/issues/157));
  how clients get an account beyond office invitations ([#158](https://github.com/jin-yu-yang/vitally/issues/158)).
- Remove the remaining demo wording ([#58](https://github.com/jin-yu-yang/vitally/issues/58)); rename
  "senior version" to "conversational version" (tester suggestion).
- Exit Form and drafts: long Remarks cut off, font downloads ([#122](https://github.com/jin-yu-yang/vitally/issues/122),
  [#121](https://github.com/jin-yu-yang/vitally/issues/121)); the 2026 revision of Form 13614-C
  ([#42](https://github.com/jin-yu-yang/vitally/issues/42)).
- May follow during the season: same-day service ([#163](https://github.com/jin-yu-yang/vitally/issues/163)),
  amendments ([#155](https://github.com/jin-yu-yang/vitally/issues/155)), the client's place in the
  queue ([#164](https://github.com/jin-yu-yang/vitally/issues/164)), a volunteer's own cases
  ([#110](https://github.com/jin-yu-yang/vitally/issues/110)).

**Maintenance**
- **Handoff documentation** so volunteer developers can step in. *(not filed)*
- **A long-term support model:** for example seasonal support from the original team. The upkeep
  after features settle is mostly security updates and yearly form changes. *(not filed;
  unresolved)*

### Later

Client profiles and visit history ([#146](https://github.com/jin-yu-yang/vitally/issues/146)),
season analytics ([#141](https://github.com/jin-yu-yang/vitally/issues/141)), groups and pinned
cases ([#149](https://github.com/jin-yu-yang/vitally/issues/149)), case location
([#152](https://github.com/jin-yu-yang/vitally/issues/152)), mobile client intake
([#153](https://github.com/jin-yu-yang/vitally/issues/153)), staff Settings
([#154](https://github.com/jin-yu-yang/vitally/issues/154)), a second state return
([#116](https://github.com/jin-yu-yang/vitally/issues/116)), scale
([#165](https://github.com/jin-yu-yang/vitally/issues/165)). Not planned: chat and SMS,
appointment booking, storing documents in ViTally.

## Deployment

The test environment runs under Hailey's accounts, inside a Supabase organization so it can be
handed to PCDC later.

- **Done:** Supabase project with custom SMTP (Resend, sender `ViTally <help@govitally.org>`);
  the `govitally.org` domain at Cloudflare, with `help@govitally.org` forwarded; the front end's
  [`public-config.json`](public-config.json) points at the hosted project (#212).
- **Remaining:** migrations on the hosted database; the `accounts` Edge Function and its secrets;
  Auth Site URL / Redirect URLs and the email rate limit; public sign-up off; the front end on the
  custom domain; the tester roster and the site's SIDN. The seed never runs against the hosted
  project.

Step by step: [`docs/setup.md` §6–7](docs/setup.md#6-classroom-and-hosted-setup-pending). Free
tiers cover the December test; for the season, Supabase Pro (about $25 a month, no pausing, daily
backups) is recommended.

## Run locally

Use Node.js **24.21.0** explicitly (see [`docs/setup.md`](docs/setup.md#1-runtime) for the
command-scoped `PATH` this project uses instead of changing the global Node version), then:

```sh
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). With no local configuration, this shows the
setup-needed screen. To sign in against an isolated, local-only Supabase stack, follow
[`docs/setup.md`](docs/setup.md) end to end: the runtime, the local test stack, `.env.local`,
fictional rehearsal accounts ([Signing in locally](docs/setup.md#signing-in-locally)) and
`npm run seed:local` for rehearsal cases and volunteers.

Once that is done, signing in takes five steps:

1. Run `npm start` and open [http://127.0.0.1:4173](http://127.0.0.1:4173).
2. Type `site-coordinator@example.org` (a staff account from the example roster) and press **Send verification code**.
3. Open the local mailbox at [http://127.0.0.1:54324](http://127.0.0.1:54324), open the newest
   message, and copy the code. Nothing is sent outside your machine.
4. Paste the code and press **Verify and continue**. You are signed in as staff.
5. To play the client too, open the app in a private window and repeat steps 2–4 with
   `client-a@example.org`.

A new code can be requested about once a minute. Stop the server with Ctrl+C.

## Tests

```sh
npm test                    # unit suite, no network
npm run test:database       # against the isolated stack, requires .env.test
npm run test:auth-browser   # real Chrome + real Firefox, real OTP verification
npm run test:browser        # the full story, both engines, both directions (~20–25 min)
```

CI runs all of them on every pull request (`.github/workflows/ci.yml`). Which ones to run locally
for a given change is in [`CLAUDE.md`](CLAUDE.md) (Project rules, Verification) and
[`docs/setup.md` §5](docs/setup.md#5-tests).

## How we work

Behaviour changes go through an OpenSpec change (`openspec/changes/<name>/`: brainstorm, proposal,
design, delta specs, tasks, plan, verify, retrospective), then a pull request that a teammate
reviews and squash-merges. Bug fixes and documentation go straight to a PR. The rules are in
[`CLAUDE.md`](CLAUDE.md).

## Documents

| Document | What it is |
| --- | --- |
| [`docs/setup.md`](docs/setup.md) | Local setup, migrations, tests, hosted setup |
| [`docs/developer/`](docs/developer/README.md) | Developer guide: architecture, database and action API, browser app, tooling, [production roadmap](docs/developer/production-roadmap.md) |
| [`docs/demo-script.md`](docs/demo-script.md) | Walk-through script for the local rehearsal accounts |
| [`docs/proposal.md`](docs/proposal.md) | Project proposal: problem, users, scope, plan |
| [`docs/spec.md`](docs/spec.md) | M1 product specification and pre-survey findings |
| [`docs/m4-tradeoffs.md`](docs/m4-tradeoffs.md) | What was cut at M4 and why (historical) |
| [`docs/CSE416_VITA_SMS_Project_Notebook.docx`](docs/CSE416_VITA_SMS_Project_Notebook.docx) | Team notebook: spec draft, pre-survey, meeting notes (9/6 – 9/29), UI design log |
| [`docs/meeting-minutes/`](docs/meeting-minutes/) | Meeting minutes |
| [`docs/intake-questions/`](docs/intake-questions/) | Intake questions, standard and senior wording (source of the catalogue) |
| [`docs/design/`](docs/design/README.md) | Design system, redesign review (D1–D12), screen images |
| [`docs/media/`](docs/media/) | PCDC logos, lifecycle diagrams, IRS forms, materials checklist |
| [`docs/superpowers/`](docs/superpowers/) | Historical design documents and plans (parts 1–4d); not updated |

## Repository layout

```text
index.html, server.mjs   static entry page and local dev server (no build step)
public-config.json       front-end configuration for the hosted test project
src/                     browser app: controller, Supabase store, auth, views, styles, client text
supabase/migrations/     schema, row-level security, action functions, intake catalogue (001–050)
supabase/functions/      Edge Functions (account invitations)
tests/                   unit tests (*.test.mjs), database suites, browser suites
tools/                   vendor bundle and catalogue builds, guarded admin tooling (migrate, roster, seed)
openspec/                canonical specs, active and archived changes, workflow schema
docs/                    setup and developer guides, project documents, design
```

## About

ViTally started as a CSE 416 (Software Engineering, Fall 2026) project at Stony Brook University.


| Name | Sub-team | Focus |
| --- | --- | --- |
| Hailey Zheng | Frontend | UI development and redesign; intake question design |
| Jinyu Yang | Frontend | UI development |
| Manqi Lu | Frontend | UI development; English–Chinese translation |
| Cody Chi | Backend | Server development |
| Kelvin Chiu | Backend | Database design |

## License

[MIT](LICENSE)
