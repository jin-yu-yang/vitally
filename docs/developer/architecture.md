# Architecture

This page explains how the pieces fit together and why. Details for each layer are in the
[database](database.md), [front-end](frontend.md) and [back-end](backend.md) guides.

## Context and goals

The demo had to show a realistic VITA workflow across roles, in two browsers at once, with real
email sign-in and shared state, for a classroom presentation. That shaped four constraints:

- **No custom server** to build or host. The browser uses Supabase directly (design decision in the
  [design spec, section 2](../superpowers/specs/2026-09-15-vitally-shared-demo-design.md#2-user-confirmed-decisions)).
- **Static hosting** on GitHub Pages: no build step, relative paths, one JSON config file.
- **Correct under concurrency.** Two volunteers can press "claim" at the same moment; exactly one
  must win, and neither may see a false success.
- **Private by construction.** A classmate playing a client must never see another client's data
  or any staff note, even by calling the API directly.

These constraints produced an architecture where PostgreSQL is the back end. That is a sound
foundation for production too; see [key decisions](#key-decisions-and-trade-offs) for what to keep.

## Components

| Component | Where | Responsibility |
| --- | --- | --- |
| Browser app | `index.html`, `src/` | Screens, navigation, forms, live updates. Predicts permissions to hide buttons; decides nothing. |
| Supabase Auth (GoTrue) | Supabase | Email one-time-code sign-in. Accounts exist only for approved addresses. |
| PostgREST | Supabase | Exposes tables (read-only for browsers) and the eight RPC functions over HTTP. |
| PostgreSQL | Supabase | Schema, row-level security, and all workflow logic in `SECURITY DEFINER` functions. |
| Realtime | Supabase | Pushes INSERT/UPDATE events on nineteen tables, filtered by the same row-level security. |
| `server.mjs` | Local machine | Serves the static files and `/public-config.json` locally. Any static host can replace it. |
| `tools/admin/` | Operator's machine | Privileged tasks (migrations, roster) behind fail-closed target guards. Never in the browser. |

## Identity: accounts, memberships and people

Three separate records answer three separate questions.

```mermaid
erDiagram
  AUTH_USER ||--o| MEMBERSHIP : "has at most one active"
  WORKSPACE ||--o{ MEMBERSHIP : "admits"
  WORKSPACE ||--o{ PERSON : "has staff"
  MEMBERSHIP {
    uuid user_id
    text access "applicant | staff"
  }
  PERSON {
    uuid id
    uuid user_id "the staff account that is this person"
    text name "a staff member"
    text_array capabilities "prepare, review, admin, followup, receive_documents, assist"
  }
```

- **Auth user** (`auth.users`): who signed in. Created only by the roster command, so only
  approved addresses can sign in.
- **Membership** (`public.memberships`): which workspace the account belongs to, and whether it
  is an `applicant` (a client) or `staff` (a staff member's own account).
- **Person** (`public.people`): a staff member with capabilities. Every staff action is done as
  the account's own person, and the database checks that person's capabilities.

There is no presenter access and there are no demonstration people (Alex, Morgan, Sam): #136
removed them. A former presenter address cannot sign in, and a window that was open shows "This
account has no access". Migration 043 deleted the presenter accounts, and the demonstration
people that nothing references.

**Staff accounts are linked.** A `staff` membership has exactly one `people` row with a matching
`user_id`, created from the roster. The database, not the browser, decides who is acting: the six entry points that act as a
person take no person parameter and call `vitally_private.acting_person` first, which gives a
staff account its own person
([Database: who is acting](database.md#who-is-acting)). So receipts, case history, participation, reviews and the contact log name the real staff
member, and the independence rule (a preparer never reviews their own case) holds across real
accounts. The browser's principal carries `personId` and `personName` for a staff account, and
`staffWindow()` and `actingPersonId()` in the controller route it to the staff screens as its own
person ([Front end: the controller](frontend.md#the-controller)). What remains is visibility and
roles; see the [roadmap](production-roadmap.md#1-staff-identity).

## Who can see what

Visibility is enforced by row-level security on every table (full policies in
[Database: who can see what](database.md#who-can-see-what)):

| Principal | Sees |
| --- | --- |
| Applicant | Their own cases, and on those only: document requests, their documents, their contact details (`case_contacts`), and plain-language progress messages (`client_events`). |
| Staff | Every case in the workspace **except other people's unsubmitted client drafts**, plus all staff records: people, internal history, participation, follow-ups, the contact log (`contact_log`, `contact_log_versions`), reviews, assistance items, materials received. Narrowing it is the roadmap's visibility work. |
| Anonymous | Nothing. |

The browser mirrors this: the applicant adapter never requests a staff table
(`CLIENT_TABLES` in [`src/supabase-store.mjs`](../../src/supabase-store.mjs)).

**Contact details are narrower on screen than in the database.** Row-level security lets every
staff account read `case_contacts`, because it cannot tell roles apart. The screens apply decision
D5 themselves through `canSeeContact` in
[`src/intake-catalogue.mjs`](../../src/intake-catalogue.mjs): office staff (`followup` or `admin`)
on any case, a volunteer only on a case they prepare or review. The actions that change contact
details or materials (`UPDATE_CONTACT`, `RECORD_MATERIALS`) enforce the same rule in the database
(`vitally_private.works_on_case`, migration 013). Enforcing it on reads too is part 5 of the
redesign (access and masking) and part of [staff identity](production-roadmap.md#1-staff-identity).

## The intake version

A case's intake version is fixed when the case is created (`cases.intake_version`, migration 011),
and version 2 is the only version since migration 023: both version columns accept only 2. The
original four-step version 1 was removed with its screens, keys, samples and database paths.

**Version 2** is the form of steps 0–9 with sub-steps (part 4b2), built from the drafted questions in
[`docs/intake-questions/`](../intake-questions/), with standard and senior wording. The
questions live in one **catalogue**, generated by `npm run build:intake` into the browser module
`src/intake-catalogue-data.mjs` **and** a migration that loads the private `intake_fields` and `intake_substeps` tables,
so the browser and the database check answers against the same rules. A test compares the two
sides' checks, and another fails if the database is behind the committed catalogue.

New cases take the workspace's `default_intake_version`, which is 2 everywhere (since migration
020, and the only value since 023), so new client applications, the office's Add a case and sample
resets are version 2. The columns stay so that a future version is a new value. The design is in
[the intake catalogue spec](../superpowers/specs/2026-09-29-intake-catalogue-design.md) and
[the intake screens spec](../superpowers/specs/2026-09-30-intake-screens-design.md).

## How a read works

The store reads tables directly through PostgREST with the signed-in user's token. RLS filters
rows. A staff case list also fetches per-case summaries (participants, open follow-ups,
open requests) so the work board can show what each case is waiting for. The store turns
`snake_case` rows into the `camelCase` objects described at the bottom of
[`src/contracts.mjs`](../../src/contracts.mjs).

## How a write works

Every change is one call to a database function with an **envelope**:

```js
{ actionId, caseId, expectedRevision, personId, type, payload }
```

```mermaid
sequenceDiagram
  participant U as Person
  participant A as app.mjs
  participant C as controller.mjs
  participant S as supabase-store.mjs
  participant DB as vitally_apply_action
  participant RT as Realtime
  participant W as Other windows
  U->>A: clicks a button (data-case-action="CLAIM_PREPARATION")
  A->>A: payloadFor(type, button data, form values)
  A->>C: runAction(type, payload)
  C->>C: new actionId, expectedRevision = case.revision, personId = actingPersonId()
  C->>S: act(envelope)
  S->>DB: rpc("vitally_apply_action", ...)
  Note over DB: one transaction: membership, acting person, receipt, lock case,<br/>authority, revision, payload, stage, eligibility,<br/>then mutate + history + revision + receipt
  DB-->>S: receipt {actionId, caseId, reference, revision}
  S-->>C: receipt
  C->>C: refresh() and re-render
  DB-->>RT: UPDATE cases, INSERT case_events, ...
  RT-->>W: {table, id, caseId} only
  W->>W: re-read affected list/case through RLS, re-render
```

Three properties matter:

- **Idempotent.** The database stores a receipt per `(workspace, account, actionId)`. If the
  network drops after the database committed, the browser retries the **identical** envelope and
  gets the stored receipt back instead of acting twice. The same action id with a different
  payload is refused as `VALIDATION`.
- **Revision-fenced.** `expectedRevision` must equal the case's current revision, otherwise
  `CONFLICT`. Two simultaneous claims lock the same row; the second sees a moved revision and
  loses cleanly. The browser then re-reads and shows the newer state.
- **All or nothing.** Any refusal rolls back the whole call, including the reserved receipt.
  There is never a partial change.

The fixed order of checks, and which error each step produces, is in
[Database: check order](database.md#check-order-and-error-codes).

## How live updates work

Realtime sends INSERT and UPDATE events for nineteen tables. The browser uses an event only as a
hint: it takes the table and row id, decides what might be stale (the list, the open case, the
assistance list), and **re-reads through the normal RLS-scoped queries**. It never trusts event
payloads as data. Realtime applies RLS too, so a client never receives another client's event.

Deletes are never published, because a deleted row cannot be checked against RLS. Nothing in the
app deletes in bulk, so no event announces one.

## How sign-in works

1. The person types an email address. The browser calls Supabase Auth with
   `shouldCreateUser: false`, so an unknown address creates nothing.
2. The screen shows the same neutral message for known and unknown addresses, so the form cannot
   be used to discover who is on the roster.
3. The person types the code from the email. Supabase verifies it and issues a session.
4. The browser reads the account's membership. No membership means no access.

A resend cooldown (server interval plus five seconds) is enforced in the browser and survives a
reload. Details in [Front end: sign-in](frontend.md#sign-in) and
[Back end: Auth and email](backend.md#auth-and-email).

## Key decisions and trade-offs

| Decision | Why | Trade-off | Keep for production? |
| --- | --- | --- | --- |
| Business logic in `SECURITY DEFINER` SQL functions; browser roles read-only | One place enforces every rule, atomically, for every client, including direct API calls | Logic in PL/pgSQL is harder to unit-test and refactor; changing a function means copying it into a new migration | Yes, or move it to a service that keeps the same contract |
| Browser talks to Supabase directly | No server to build or host | No place for server-side integrations (email notifications, file scanning, reports) | Add a service beside it for integrations; the RPC contract can stay |
| Client-generated action ids with stored receipts | Safe retries on flaky networks; no double actions | One extra row per action | Yes |
| Per-case `revision` fencing | Concurrency without locks held across requests | Users sometimes see "someone else changed this" and must retry | Yes |
| Realtime events carry ids only; browser re-reads | No private data in the event stream; one code path for data | More reads per change | Yes |
| Inline RLS predicates, repeated per table | Avoids granting browsers EXECUTE on helper functions | Seven copies of the case-visibility rule must stay in agreement (a test checks this) | Revisit; a view or helper with care |
| Vanilla ES modules, no framework, no build | Static hosting, nothing to install to view | Full-page re-render needs hand-written focus and draft preservation | Probably not; see [front end](frontend.md#moving-to-a-framework) |
| Committed, pinned Supabase SDK bundle | Works from any static host, reproducible | Must be rebuilt by hand on upgrade | Replaced by a normal build if a framework is adopted |
| `staff` accounts linked to a person, acting person decided by the database | The browser never claims an identity; receipts and history name the real person | A staff account is exactly one person, so one account cannot demonstrate every role | Yes |

## Real versus simulated

| Real | Simulated |
| --- | --- |
| Email one-time-code sign-in and sessions | Document upload: one fixed fictional file name, no file storage |
| Shared state across browsers, live updates | Reminders: a timestamp, no message is sent |
| Every permission, eligibility and independence rule | TaxSlayer milestones: recorded by hand, no integration |
| Concurrency, idempotency, audit history | — |
| Screening checks: a volunteer ticks what they confirmed | — |
| Row-level privacy between clients | Client phone calls: outcomes are recorded, calls happen elsewhere |
| Intake answer checks, in the browser and again in the database | Materials received: staff tick what they were shown; nothing is stored |
