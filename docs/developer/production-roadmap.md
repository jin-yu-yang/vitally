# From demo to production

The demo proves the workflow, the privacy model and the concurrency model with fictional data. It
is not yet a system PCDC could use with real clients. This page lists what separates the two,
measured against the group's product spec, [`docs/spec.md`](../spec.md). Each section says what
exists, what is missing, and where the change lands.

**Do not put real client data into any environment until sections 1, 3 and 8 are done.**

## At a glance

| Product spec area | Demo today | Gap |
| --- | --- | --- |
| Roles (spec §6) | Client; real per-person `staff` accounts (038); and a "presenter" account acting as staff personas for the demo | Role-based visibility, role-to-capability mapping, presenter removal ([§1](#1-staff-identity)) |
| Client accounts (spec §8.1) | Rostered email addresses only, one-time codes; the drafted intake (steps 0–9 with sub-steps) is built but not switched on yet | Open client sign-up; the intake-first flow the spec describes ([§2](#2-client-accounts-and-intake)) |
| Documents (spec §5, §7.1) | Metadata for one fixed fictional file | Real upload, storage, scanning, retention ([§3](#3-documents)) |
| State machine (spec §8.2) | Intake, screening, preparation, review, corrections, signature, e-filing, closure | Unreachable client, the IRS's answer after e-filing, amendments, waiting for documents and hold, withdrawal, reassignment ([§4](#4-workflow-coverage)) |
| Client portal (spec §8.3) | Status, requests, document response, progress history | Queue position, preparer/reviewer contact, print, withdraw, notifications |
| Volunteer portal (spec §8.4) | Work board, filters, case detail, internal history | Profiles, certifications, contact details |
| Admin dashboard (spec §8.5) | Office board, follow-ups, reminders, closure, assistance | Reassignment, workload, reports, reference materials ([§7](#7-admin-reporting-and-forms)) |
| Form generation (spec §8.6) | None | IRS Form 13614-C and Form 14446 drafts ([§7](#7-admin-reporting-and-forms)) |
| Bilingual (spec §9) | English on screen; the intake catalogue already carries Chinese wording | English and Chinese throughout ([§6](#6-language-and-accessibility)) |
| Security and audit (spec §9) | RLS, audited writes, no passwords | Production hardening ([§8](#8-security-and-privacy)) |

## 1. Staff identity

**Built (add-staff-identity, migration 038).** A third membership access, `staff`, is linked to
exactly one `people` row (`people.user_id`). The database decides the acting person from
`auth.uid()` at every entry point that takes `p_person_id`: a staff account always acts as its own
person, and receipts, case history, participation, reviews and the contact log name it. The
independence rule holds across real accounts, and a presenter can no longer act as a staff member's
person. The roster command creates staff accounts (`staff` list, optional `defaultFollowup`), staff
get the staff screens without the persona picker or demo tools, and staff-only workspaces work. See
[Database: who is acting](database.md#who-is-acting) and
[Back end: privileged tooling](backend.md#privileged-tooling).

**Still to do.**

- **Visibility.** Staff see exactly what presenters see: every case except other people's unsubmitted
  drafts. The spec says volunteers see the cases they prepare or review and admins see everything.
  Volunteers also need to see unclaimed work to claim it. Decide the rule, then change every policy
  and `lock_case` together (see
  [Database: who can see what](database.md#who-can-see-what)). Until then, no real client data.
- **Roles and certifications.** Spec §8.1 lists volunteer roles (Site Coordinator, VITA Volunteer,
  and others). Map them to the existing capabilities (`prepare`, `review`, `admin`, `followup`,
  `receive_documents`, `assist`), and decide who may grant them. Today a roster entry sets a staff
  member's capabilities once; changing them, or deactivating a staff member, is not built, and
  there is no admin screen.
- **One person, two workspaces** ([#104](https://github.com/jin-yu-yang/VITA-Management-System-Demo/issues/104)).
  The screens are chosen by the acting person's capabilities (ruling R55): `admin` gets the office
  workspace, everyone else the preparation/review one. A presenter switches persona to move between
  them; a staff account is one person and cannot. So a staff member with `admin` and `prepare` or
  `review` — PCDC's site coordinator, who runs the office and also reviews — reaches only the office
  workspace and never sees *Claim review*. Found on 2026-10-30 rehearsing with real accounts; the
  rehearsal gives the reviewer `review` alone. Needed on day 1 of the pilot: a switch between the two
  workspaces for such a person (a view change; the database already checks every action), decided
  together with the role mapping above.
- **Presenter removal.** Presenter access, the persona picker and `p_person_id` stay for the
  classroom demonstration. Once the demo no longer needs them (§5), remove them and rename or split
  the remaining access into real roles.
- **Tooling.** Staff can be added only as new people; linking an existing person (including the
  demo personas) is not supported.

Do the visibility change next and keep the database tests green throughout.

## 2. Client accounts and intake

**Today.** Only rostered addresses can sign in. A client creates an application after signing in
and fills the intake form, version 2, the only intake version since migration 023 (see
[Architecture: the intake version](architecture.md#the-intake-version)). It was built in parts 4a,
4b and 4b2 and switched on by part 4c: the group's drafted questions in steps 0–9 with sub-steps
(101 questions, standard and senior wording), with contact details and a materials checklist. The
database checks every value against the same catalogue and refuses a submit with a required answer
missing. It has **no scope screening**: by the group's decision (2026-09-30) an out-of-scope
application submits normally, and the office handles scope at its intake checks, until scope rules
are written in version-2 terms. The original four-step version 1, with its screening rule, was
removed by migration 023.

**Needed.**

- **Sign-up.** Spec §8.1 describes starting intake without an account and receiving credentials
  on submission. Email one-time codes (what the demo uses) avoid passwords entirely; decide with
  the team whether to keep them and open sign-up (`shouldCreateUser: true` plus an automatic
  applicant membership), and add abuse controls (captcha, rate limits).
- **Intake questions.** The drafted questions are the version-2 catalogue; changing them is an
  edit to `docs/intake-questions/` and a build
  ([Database: change the intake questions](database.md#change-the-intake-questions)). They collect
  personal data for the taxpayer, spouse and every household member: names, dates of birth, phone,
  email, address, and typed signatures. See [§8](#8-security-and-privacy) before collecting any of
  it for a real client.
- **Scope screening for version 2**, if the site wants the form to stop out-of-scope clients
  rather than the office.
- **Out-of-scope clients.** Spec §13 asks what happens to records of clients who turn out to be
  out of scope. Today they remain drafts that staff cannot see.
- **Phone access.** Deferred in the design; email is the only sign-in route.

## 3. Documents

**Today.** `documents` stores a file name and who submitted it. The only accepted name is
`demo-mileage-record-2025.pdf`, enforced in `check_payload`. No file is stored anywhere.

**Needed.**

- A private Supabase Storage bucket (or equivalent) with access rules that mirror case visibility.
- Upload through short-lived signed URLs; size and type limits; virus scanning in a server-side
  step before a document is visible to staff.
- `documents` gains a storage path, size, content type and checksum; the fixed-name check in
  `check_payload` and `receive_document` goes away.
- Retention and deletion rules for tax documents.

## 4. Workflow coverage

The demo's stages against the spec's state machine (spec §8.2):

| Spec state | Demo | Notes |
| --- | --- | --- |
| Intake | `draft`, `received`, `screening` | An admin opening a `received` case starts screening (`START_SCREENING`); the office's explicit intake check (`VERIFY_INTAKE`) then moves it on. An office-entered case starts in `screening` |
| PendingPrepare | `preparation_ready` | |
| InPrepare | `preparing` | |
| Pending (missing documents) | Document requests beside `preparing`; `awaiting_documents` at intake (036) | **Design difference.** In preparation the demo keeps the preparer assigned while waiting; the spec returns the case to the pool (§8.2's in-preparation Pending). Before preparation, an admin's request moves the case to Waiting for documents and back automatically when the last request is verified. Decide which the site wants for preparation |
| Hold | `on_hold` (036) | Built. An admin puts a case on hold from Waiting for documents or Ready to exit; "Got in touch" resumes it |
| PendingReview | `review_ready` | |
| InReview | `reviewing` | |
| (not in spec) | `corrections_required` | Reviewer sends back to the same preparer, who resubmits a new version |
| ReadyToExit | `review_approved` | The reviewer records a follow-up conversation with the client |
| NeedSign | `review_approved`, then `ready_to_efile` | `review_approved` is the wait for the client's signature; once the reviewer's call is recorded, an admin records the signature (`MARK_READY_TO_EFILE`) |
| Efiled | `efiled`, then `accepted` or `rejected` | An admin records the e-filing and each return's method (`MARK_EFILED`), then the IRS's and Pennsylvania's answers by hand (`RECORD_FILING_RESULT`). A rejection returns to signing (`RETURN_TO_SIGNING`) and is filed again; nothing is sent to or read from the IRS or Pennsylvania |
| Amended | Not built | Amendments after acceptance are not modelled |
| CantFindClient | `on_hold`, then `closed` as Dismissed (036) | Built: Hold, "Got in touch", and closing as Dismissed when the client stays unreachable |
| Cancelled | `closed` | An admin closes with one of six reasons (and a note for Other); the client may withdraw at the stages the spec allows (036) |

To build next:

- **Amendments**, **same day** and **FSA**. Model them as new stages and actions
  ([database recipe](database.md#add-a-workflow-action)). Waiting for documents, Hold, the
  unreachable client and client withdrawal are built (036). The IRS's answer after e-filing
  (accepted, rejected, paper) is built, recorded by hand; importing the real answers is not.
- **The signing method, asked at the right moment**
  ([#106](https://github.com/jin-yu-yang/VITA-Management-System-Demo/issues/106)). The reviewer
  questionnaire requires how the client will sign Form 8879 even when the reviewer answered No to
  going over the return with them; nobody can know it before that conversation. The go-over
  follow-up's resolution is where the office learns it, so ask it there and choose the signing-plan
  client text then. Changes `APPROVE_REVIEW`'s validation, `RESOLVE_FOLLOWUP`'s payload and the
  client text. Found on 2026-10-30 rehearsing the demo; PCDC's own practice.
- **Release and reassignment** (spec §8.5, §13), not built: an admin action to change a case's preparer or
  reviewer. The participation record must still block self-review after reassignment; the database
  already enforces that.
- **The fast path** (spec §13): creating a case directly during peak season. The demo's assisted
  intake (`vitally_create_case` with `p_mode = 'assisted'`) is a starting point.

## 5. Demo-only parts

Remove these, or restrict them to non-production environments, before real use:

| Part | Where |
| --- | --- |
| Presenter access and the persona picker | `memberships.access = 'presenter'` (#136). The screen parts, `presenter-views.mjs` and `selectedPersonId`, are done in #134 |
| Sample cases, reset and checkpoints | Done in #135 (migration 040): `vitally_reset_fixtures`, `vitally_load_checkpoint`, `cases.fixture`, `cases.fixture_key`, `origin = 'fixture'`, `workspaces.fixture_generation`, `vitally_private.fixture_client_bindings`, `assistance_items.fixture` are gone |
| Fictional form filling | `sample-data.mjs`, the "Fill fictional details" buttons and pill |
| Simulated document and upload failure | The fixed file name; the "simulate upload failure" checkbox |
| Tick-box intake checks | `VERIFY_INTAKE`'s four `true` attestations |
| Simulated reminders | `REMIND` records a time and sends nothing |
| "Class workspace" wording | Done in #134: the presenter panel and indicator text are gone |

Removing database objects is a new migration that drops or revokes them; never edit 009.
`vitally_private.test_workspaces` is used by the test suites and can stay.

## 6. Language and accessibility

**Bilingual.** Part 4d did the browser side. Client screens are in English, 简体 or 繁體, chosen
with a switch and saved per browser. The version-2 catalogue holds every question, option and tip
in English and Chinese (`wording(question, { lang })`). Every other client string is in the
client text table, `TEXT` in [`src/client-text.mjs`](../../src/client-text.mjs). Sentences that
arrive in English (error and sign-in messages, and the client progress messages the database
still stores as English sentences in `client_events.message`) are translated in the browser by
matching the whole sentence (`SENTENCES`). Traditional is generated at build time from the
Simplified with OpenCC `tw`, characters only ([`src/zh-hant.mjs`](../../src/zh-hant.mjs)). Staff
screens stay English. For production:

- Change the database to store a message key and parameters in `client_events` instead of a
  sentence, and translate by key in the browser, so a reworded sentence cannot fall back to
  English. Existing rows need a migration or a fallback.
- Intake answers that are shown back to staff need consistent stored values (codes) with
  translated labels. Version 2 already stores codes (`drop_off`, `mandarin`) and shows labels
  (`serviceLabel`, `languageLabel`, `formatAnswer`).

**Accessibility.** The demo uses labels, focus management, `role="status"` and `role="alert"`,
and keyboard-safe live updates. A production release needs a proper audit against WCAG 2.1 AA with
screen readers, and testing with the site's actual clients.

## 7. Admin, reporting and forms

- **Admin dashboard** (spec §8.5): workload per volunteer, clients on hold, counts by stage (the
  board already counts), reassignment ([§4](#4-workflow-coverage)), reports, reference materials.
- **Volunteer profiles** (spec §8.4): name, certifications, contact details.
- **Form generation** (spec §8.6): drafts of IRS Form 13614-C and Form 14446 from intake answers.
  This needs a server-side service with PDF generation; see
  [Back end: adding a service](backend.md#adding-a-service-beside-the-database).
- **Notifications** (spec §8.3): status-change email, which also needs a service. The demo sends
  only sign-in email.

## 8. Security and privacy

Foundations already in place: no passwords; RLS on every table; browser roles cannot write
tables; every write checked in one ordered function; an audit row (`case_events`) for every
accepted action with actor and time; no staff data in client payloads; secrets never served.

Before real data:

- **Staff identity** ([§1](#1-staff-identity)) and a narrower staff visibility rule.
- **Sensitive fields.** The version-2 intake already holds names, dates of birth, addresses and
  phones for whole households, and a real intake may add identifiers such as Social Security
  numbers. Decide which fields need column-level encryption or a separate protected table, and who
  may read them. Phones already live apart from the answers (`case_contacts`) so part 5 can mask
  them in one place; today every presenter can read that table and only the screens hide it
  ([Architecture: who can see what](architecture.md#who-can-see-what)).
- **Program rules.** Follow the IRS's VITA privacy and confidentiality requirements for handling
  taxpayer information; confirm them with PCDC's site coordinator.
- **Staff account security.** Stronger sign-in for staff (multi-factor), shorter sessions, and
  prompt removal when a volunteer leaves.
- **Audit of reads.** `case_events` records changes, not who viewed a case. Decide whether views
  must be logged.
- **Retention and deletion** for cases, documents and receipts (`action_receipts` currently grows
  forever).
- **Hosting headers**: Content-Security-Policy and HSTS ([Back end](backend.md#operations-checklist-for-a-real-deployment)).
- **An independent security review** of the RLS policies and entry points before launch.

## 9. Scale and performance

The demo is sized for a classroom: a handful of cases per workspace.

- The staff case list reads every visible case plus per-case summaries, with no pagination.
- Child tables (`documents`, `contact_log`, `case_events`, `client_events`) have no index on
  `case_id`; add them before real volumes.
- Each staff window keeps one Realtime channel over nineteen tables and re-reads on each event. With many
  staff online at once, measure and consider narrower subscriptions.
- One account has one active membership, so one person cannot work at two sites. Revisit if PCDC
  runs several sites.

## 10. Known limitations

Reviewed and accepted for the demo, and worth knowing about:

- The full-page re-render can, rarely, drop a click that lands during a burst of live updates.
  A framework with DOM diffing removes this ([Front end](frontend.md#moving-to-a-framework)).
- The "simulate upload failure" state is shared by all requests on one case.
- There is no screen for creating assistance items; the only one is seeded.
- The readable-reference generator exists twice (migrations 001 and 009).
- `ASSISTANCE:CLAIM` and `ASSISTANCE:RESOLVE` sent to the case entry point at a stale revision
  answer `CONFLICT` instead of `VALIDATION`. The browser never sends them there.
- **Version-2 draft saves are all-or-nothing on the server.** One invalid value makes
  `SAVE_ANSWERS` refuse the whole save without naming the field, so the browser withholds invalid
  values and saves the rest. Better long-term: accept any format in a draft save and check formats
  at submit, which needs a migration.
- **An email with a space inside** is invalid in the browser but accepted by the server's check.
  The browser withholds it, so the server never receives one; the two checks are otherwise the
  same, and a database test compares them.

## Suggested order of work

1. **Staff identity and visibility** (database, front end): everything else builds on it.
2. **Remove or gate demo-only parts** (all).
3. **Continuous integration and environments** (back end): development, staging, production.
4. **Client sign-up and the intake's personal data** (all): open sign-up, and the security
   decisions for the fields the version-2 intake collects.
5. **Document storage** (back end, database, front end).
6. **Bilingual support** (front end, database); the intake's Chinese is part 4d of the redesign.
7. **Workflow extensions**: withdrawal, reassignment, the unreachable client, the IRS's answer and amendments.
8. **Admin reporting, notifications and form generation** (a new service).
9. **Security review, accessibility audit, load testing**, then a pilot with fictional data before
   any real client.

Open product questions are tracked in [spec §13](../spec.md#13-open-questions--items-to-resolve)
and the [proposal](../proposal.md#10-open-questions).
