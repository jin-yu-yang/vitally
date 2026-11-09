# ViTally

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

ViTally is a classroom demonstration of a VITA (Volunteer Income Tax Assistance) shared workflow:
client intake, volunteer preparation, independent review with corrections, admin follow-up, and
assistance requests, with real email sign-in and shared state across browsers. It is designed for
**PCDC (Philadelphia Chinatown Development Corporation) Community**.

**Course:** CSE 416 — Software Engineering Project, Fall 2026 ·
**Team:** Cody Chi · Hailey Zheng · Jinyu Yang · Kelvin Chiu · Manqi Lu

Use fictional data only. ViTally never files or prepares a real tax return; document uploads,
reminders, and TaxSlayer preparation milestones are simulated throughout, and every seeded sample
case uses invented names with no address or other routable contact detail.

## Current status

### Planned vs delivered (M4)

What we promised in the M1 spec (§8) and the plan since, checked against `main` on 2026-10-29.
Rows are things a person using ViTally can see or do.

| Planned | Status | Where in the app |
| --- | --- | --- |
| A client fills the intake form at home in English, 简体 or 繁體 | Delivered | Client intake, steps 0–9, with standard and senior wording and a language switch |
| A client signs the consent forms (15080, 14446) and can print the 14446 | Delivered | Signatures inside the intake; "View Draft Form 14446" in English or 繁體 on the summary page |
| A client sees their own case's progress | Delivered | Client progress page |
| A client sees their place in the queue and their preparer's and reviewer's contact | Cut | Progress page shows the stage, not queue position or volunteer contact; on the roadmap after the Feb pilot |
| A client starts the form without an account and gets one on submit | Shrunk | Clients sign in with a one-time email code instead of a password; only invited addresses for now |
| The office checks new requests against a checklist | Delivered | Screening stage with screening checks on the office case page |
| A volunteer claims a case and works it, answering a short questionnaire at each hand-off | Delivered | Work board and case pool; preparer and reviewer questionnaires |
| The client gets PCDC's Exit Form at signing, filled from the reviewer's answers | Delivered | "Download Exit Form" under an approved review, and an Exit Form panel on the office's case page; made in the browser on PCDC's own template, nothing kept (#115) |
| A reviewer can never review their own preparation | Delivered | Enforced by the database, so no screen can skip it |
| Every staff member signs in as themselves | Delivered | Staff accounts from the roster sign in by email code and act as themselves ("Signed in as …"), enforced by the database (#90, 10/29) |
| A case reaches E-filed, then Accepted or Rejected, and can be closed | Delivered | Mark e-filed, filing result (IRS and Pennsylvania), close with a reason |
| Hold, waiting for documents, same-day signing and client withdrawal | Delivered | Waiting for documents and Hold stages, same-day signing plan, Withdraw on the client's progress page |
| FSA (facilitated self-assistance) path | Cut | Not built; after the Feb pilot |
| The office sees who is waiting and what needs attention | Shrunk | Follow-ups queue and case pool tabs (Needs attention, Done); reports and charts are on the roadmap after the Feb pilot |
| An admin moves a case to a different preparer or reviewer | Cut | Not built; the database already keeps a preparer from reviewing their own case after any future move |
| An admin posts reference materials for volunteers | Cut | Not built; on the roadmap after the Feb pilot |
| A volunteer has a profile with certifications and contact details | Cut | Not built; depends on staff accounts (#90) |
| A draft 13614-C is generated from the client's answers, and the preparer completes it | Delivered | Draft for staff from the client's answers; the preparer fills the shaded section in ViTally (form or PDF editor) and the generated 13614-C carries those values (#98, 10/29); clients cannot print an unfinished form on purpose |
| An audit trail of who did what, and when | Delivered | Case history and the contact log on the staff case page |
| The case records its service method: drop-off, same-day or online | Delivered | The intake's `service` answer; it drives the screening checks (identity only for online clients) and the signing plan |
| A client gets their completed return from the app once filing is done | Cut | Not built; PCDC hands the client a paper copy when the return is marked e-filed (#97) |
| Email or text notifications | Cut | Clients don't trust texts or voicemails from an unfamiliar number (site coordinator, pre-survey in `docs/spec.md` §4); the contact log covers day one; needs a service beside the database; after the Feb pilot |
| Document upload | Cut | Not reached by the Oct 29 gate; needs private storage, scanning and retention rules first (Feb roadmap); meanwhile online clients send documents to PCDC's own storage and the case keeps the link |
| Appointment scheduling | Cut | An open question in M1, never promised; the reviewer records the signing time by hand |
| Hosted deployment for PCDC | Cut | Not a feature; the target is the **February PCDC pilot** (Dec–Jan work: hosting, real accounts, backup-restore drill, security review); why it moved from November is in `docs/m4-tradeoffs.md` |

### Implementation detail

The full workflow described in the [approved design](docs/superpowers/specs/2026-09-15-vitally-shared-demo-design.md)
is implemented and tested against an isolated local Supabase stack: identity and case ownership,
every workflow action (intake through closure, documents, admin follow-up, assistance, independent
review and corrections), real email (OTP) sign-in, Realtime-driven shared state across two
browsers. No screen has reset or checkpoint controls; rehearsal cases come from `npm run seed:local`.

You can already sign in by hand on the local stack with fictional rehearsal accounts (see
[Run locally](#run-locally)).

**Not done yet:** there is no hosted Supabase project, no classroom roster admitted to one, and no
configured SMTP sender or live email delivery (Task 10B — a user-owned setup step), and there is
no public hosting destination (Task 10D). The GitHub Pages copy of `main` therefore currently
shows ViTally's "not configured yet" setup screen rather than a working sign-in form, and nothing
in this repository's documentation claims live delivery or hosted access is working. See
[`docs/setup.md`](docs/setup.md#6-classroom-and-hosted-setup-pending) for exactly what remains and
what it needs from the user.

Track progress in the [implementation plan](docs/superpowers/plans/2026-09-15-vitally-shared-demo.md).

### Redesign (September 28 onward)

The UI redesign is built in parts, following the
[redesign roadmap](docs/superpowers/specs/2026-09-28-redesign-roadmap-and-restyle-design.md)
(decisions D1–D12 are logged in [`docs/design/redesign-review.md`](docs/design/redesign-review.md)):

| # | Part | Status |
| --- | --- | --- |
| 0 | Foundations: design tokens, logo, icons, app shell | Done |
| 1 | Visual restyle: volunteer board, case page, client screens, office screens (4 PRs) | Done |
| 2 | [Client numbers](docs/superpowers/specs/2026-09-29-client-numbers-design.md): `#001`-style numbers assigned on submit, per season, searchable on the board | Done |
| 3 | Lifecycle stages: the ~25 stages in [`return-lifecycle.svg`](docs/media/return-lifecycle.svg) replace today's 9 | Planned |
| 4 | [New intake](docs/superpowers/specs/2026-09-30-intake-screens-design.md): the drafted questions in steps 0–9 with sub-steps, standard and senior wording, best time to reach, the materials checklist, document cards, Review & submit and a draft 13614-C ([redesign spec](docs/superpowers/specs/2026-10-04-intake-redesign-design.md)). 4a catalogue and server, 4b client form, 4b2 redesign | 4a, 4b, 4b2 done |
| | 4c: staff version-2 answers by sub-step, contact, materials and the document checklist; the version-2 Add a case; version 2 the default since the switch-over (migration 020), after the group's wording review. Then 4d Chinese; then version 1 was removed, so version 2 is the only intake version (migration 023) | 4c done |
| | 4d: [Chinese on screen](docs/superpowers/specs/2026-10-05-chinese-on-screen-design.md): the whole client side in 简体 and 繁體 (Traditional derived at build time with OpenCC `tw`, characters only); staff stay English | 4d done |
| 5–8 | Access and masking, returning clients, team features, dashboards | Planned |

Case messaging/SMS, real document uploads, scheduling, mobile layouts, and certification levels
are after the MVP. Screenshots of the final designs and of what is implemented so far are in
[`docs/design/`](docs/design/README.md).

## Run locally

Use Node.js **24.21.0** explicitly (see [`docs/setup.md`](docs/setup.md#1-runtime) for the
command-scoped `PATH` this project uses instead of changing the global Node version), then:

```sh
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). With no local configuration, this shows the
setup-needed screen. To sign in and try the client/staff/admin screens against a real
(isolated, local-only) Supabase project, follow [`docs/setup.md`](docs/setup.md) end to end — it
covers the runtime, the isolated local Supabase test stack, `.env.local`, the one-time creation of
fictional rehearsal accounts ([Signing in locally](docs/setup.md#signing-in-locally)), and every
test command.

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
npm test
```

This runs the unit suite alone (pure domain logic, adapters against fakes, view renderers, the
controller, server config logic — no network). The database suite, the two-engine Auth
compatibility gate, and the full cross-browser demonstration story all require the isolated local
Supabase stack described in [`docs/setup.md`](docs/setup.md#5-tests):

```sh
npm run test:database       # against the isolated stack, requires .env.test
npm run test:auth-browser   # real Chrome + real Firefox, real OTP verification
npm run test:browser        # the full demonstration story, both engines, both directions
```

## Rehearsing the demonstration

[`docs/demo-script.md`](docs/demo-script.md) is the rehearsal script: the two-minute main story,
the full story the browser test suite runs, the assisted-intake (walk-in) path, the demo
wording, what is simulated versus real, and what to expect and say about the known behaviors
the test suite has pinned (a stale-revision refusal, the `review_ready` fixture's staff-recorded
document, and so on).

## For developers

[`docs/developer/`](docs/developer/README.md) is the guide for front-end, back-end and database
developers turning this demo into a production system: the architecture and its key decisions,
the database schema and action API, the browser app's structure, the server-side tooling, and a
roadmap of what separates the demo from the product described in [`docs/spec.md`](docs/spec.md).

## Project documents

| Document | What it is |
| --- | --- |
| [`docs/proposal.md`](docs/proposal.md) | Project proposal: problem, users, scope, and plan |
| [`docs/spec.md`](docs/spec.md) | Product specification: functional and non-functional requirements, case state machine |
| [`docs/CSE416_VITA_SMS_Project_Notebook.docx`](docs/CSE416_VITA_SMS_Project_Notebook.docx) | Team project notebook: spec draft, pre-survey findings, meeting notes (9/6 – 9/29, English and Chinese), and UI design log |
| [`docs/meeting-minutes/`](docs/meeting-minutes/) | Meeting minutes in Markdown |
| [`docs/intake-questions/`](docs/intake-questions/) | Drafted intake questions, standard and senior wording |
| [`docs/design/`](docs/design/README.md) | Design system, redesign review, and screen images |
| [`docs/media/`](docs/media/) | PCDC logos, case state machine and return lifecycle diagrams, IRS Forms 13614-C and 14446, materials checklist |

## Repository layout

```text
index.html, server.mjs   static entry page and local dev server (no build step)
src/                     browser app: controller, Supabase store, auth, views, styles
supabase/migrations/     database schema, row-level security, action functions, intake catalogue (001–042)
tests/                   unit tests (*.test.mjs), database suites, browser suites
tools/                   vendor bundle and intake catalogue builds, guarded admin tooling (migrate, roster)
docs/                    specs, plans, setup guide, developer guide, design, project documents
```

## Team

| Name | Sub-team | Focus |
| --- | --- | --- |
| Hailey Zheng | Frontend | UI development and redesign; intake question design |
| Jinyu Yang | Frontend | UI development |
| Manqi Lu | Frontend | UI development; English–Chinese translation |
| Cody Chi | Backend | Server development |
| Kelvin Chiu | Backend | Database design |

## License

[MIT](LICENSE)
