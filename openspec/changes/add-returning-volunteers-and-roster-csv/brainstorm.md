# Brainstorm: add-returning-volunteers-and-roster-csv

Raw capture of the design agreed with Hailey in the conversation of 2026-11-21/22 (explore → brainstorm). Part of #138.

## Background

- After Start next season (capability `season-rollover`, migration 055) the new roster holds only the starter. Every returning volunteer has to be added again by hand, and Add a volunteer refuses them: the browser's duplicate-email check (`src/volunteer-roster.mjs`, "That email is already on the Roster.") sees only this season's list, while `volunteer_profiles` is `unique (workspace_id, email)` across seasons, so the server answers a generic `VALIDATION`.
- The season-rollover dialog already says "Export this season's roster and cases first if you need them", but there is no roster export. The season data export (#256, open) explicitly leaves the roster and certificates to "the Roster CSV in #138".

## What we found in the code (checked against main at c830b36, after #262 / migration 057)

- **`vitally_save_volunteer` (057) already adds a past volunteer to the current season through its Edit path.** Called with `p_volunteer_id` = the person and `p_expected_revision` = their profile revision, for someone with a profile but no current-season roster entry:
  - ADMIN_ROLE check: stored current-season roles are null → passes unless Admin is requested;
  - NOT_FOUND / CONFLICT look only at `volunteer_profiles` → found, revision checked;
  - email uniqueness excludes the person themself → their own email is fine;
  - ROLE_NEEDS → empty roles have nothing to check; requested roles need this season's ticked certificates, as for Add;
  - open-work rule → `cleared()` for the current season is false and there are no current roles, so nothing is taken away;
  - writes: `people.name`, `volunteer_profiles` (revision + 1, `usual_days = coalesce(v_days, usual_days)`), a new `roster_entries` row for the current season (`added_by` = caller, `is_new` as sent), certificates as ticked.
  - Nothing in the canonical spec says Edit may target someone not on the current roster. It is behaviour, not a contract.
- **Reads:** admin RLS on `roster_entries`, `certificates` and `volunteer_profiles` (044) has no season filter. `listVolunteers` already loads every profile and narrows entries and certificates to `current_season`. A `season - 1` read of `roster_entries` gives the picker its list; nothing new is exposed.
- **Accounts:** a returning volunteer's account is `deactivated` after the rollover. On the roster they show "Account deactivated", and the drawer's existing Reactivate (047) handles it; it does not depend on the season.
- **Usual days:** since #262 the drawer always sends `usualDays`, so a picked person's form must carry their stored days or a save wipes them.
- **CSV:** every field the table shows is already in the `combineVolunteers` result except certificate confirmation dates (`confirmed_at` is dropped). Downloads already exist as a Blob + link (`downloadShadedCopy`, `src/app.mjs`).
- **Seed:** `seed:local` adds volunteers only through `vitally_save_volunteer`, which always writes the current season. No RPC writes a past season. The seed connects directly (`openDatabase`), so past-season rows can be inserted with SQL.
- **Browser tests** set up their own rows with SQL (e.g. the `season_settings` insert in `tests/browser.mjs`), so a new test block does not depend on the seed.

## Decision log

- **Q1 — What does the picker do?** (settled Nov 21) A search box in Add a volunteer. It lists people on last season's roster who aren't on this one yet; typing an email that was on last season's roster offers that person. Picking one copies their person fields; they start with no roles and not new. Clearance rules: roles only after this season's Form 13615 certificates are confirmed; certificates are never copied.
- **Q2 — What does the Roster CSV export?** (settled Nov 21) The rows and columns the table shows, with the current filters: name, email, phone, roles, certificates with confirmation dates, languages, account status. Admin only.
- **Q3 — Which existing people does a typed email match?** Decided **(b)**: a full email matches any profile in the workspace that isn't on this season's roster; the browse list stays last season's roster. Admins already load every profile, so nothing new is exposed, and Add never fails on an email the admin can't see. (Rejected (a): last season only, which leaves older profiles blocking Add with an error.)
- **Q4 — One change or two?** One change, no migration. The split condition ("CSV front-end only, picker needs a migration") doesn't hold: both halves are browser-only.
- **Q5 — Contract for the save path.** Pin "Edit may add a person who isn't on the current roster" as a `volunteer-roster` requirement, with a database test, so a later change to the save RPC can't quietly break it.
- **Q6 — Seed.** Past-season rows are inserted directly with SQL, a stated exception in `local-seed-data` to "both steps go through `vitally_save_volunteer`".
- **Q7 — CSV encoding.** UTF-8 with a BOM, so Excel shows Chinese names correctly (the same as the season export, #256). Cells that start with `=`, `+`, `-`, `@`, a tab or a carriage return get a leading apostrophe, phones included (`+1…` exports as `'+1…`).
- **Q8 — Defaults accepted, with changes:**
  1. Picking also fills usual days (test: a past volunteer with stored usual days keeps them after being picked and saved).
  2. A Cleared column (Yes/No) is added.
  3. Certificate names as the table shows them (IT&QR, not ITQR).
  4. Filename `roster-<season>-<YYYY-MM-DD>.csv`, New York date, so repeated exports don't overwrite each other.
  5. `src/csv.mjs` as a shared module that #256 can reuse.

## Approaches considered

### Adding a returning volunteer

| Approach | Trade-off | Verdict |
|---|---|---|
| **A. Picker sends the existing Edit call** (person id + profile revision) | No migration; reuses validation, receipts, CONFLICT handling, ROLE_NEEDS and the open-work rule. Needs the behaviour pinned in a spec and a database test. | **Chosen** |
| B. New RPC `vitally_add_returning_volunteer` (migration 058) | An explicit contract, but duplicates save's validation and receipt logic for no new behaviour. | Rejected |
| C. Add with an existing email reattaches that person | No new UI, but changes Add's meaning silently: a typo could overwrite someone else's profile. | Rejected |

### Roster CSV

| Approach | Trade-off | Verdict |
|---|---|---|
| **A. Built in the browser from the loaded, filtered list** (Blob download) | Exports exactly what's on screen; no server work; admin-only by being on the Roster. | **Chosen** |
| B. RPC or Edge Function returns the CSV | A server contract for data the page already holds; filters would have to be sent and mirrored. | Rejected |

### Seed's previous season

| Approach | Trade-off | Verdict |
|---|---|---|
| **A. Direct SQL insert of past-season rows** | Simple, within the seed's existing direct connection; one stated exception. | **Chosen** |
| B. Seed, then run Start next season | Deactivates the role accounts and empties the roster; wrecks the rehearsal stack. | Rejected |

## Agreed design

### Picker (in Add a volunteer)

- At the top of the Add drawer: "Returning volunteer? Search last season's roster". Under the box, a list of last season's people who aren't on this roster, filtered by name or email as the admin types. A full email that matches any other profile in the workspace not on this roster also appears, labelled "Earlier volunteer".
- Picking someone fills the form: name, email, phone, works, languages (and the other language), usual days. "New volunteer" is unticked and "Photo ID checked" is empty. Roles and certificates start empty but stay usable, with the same ROLE_NEEDS rule as Add, so an admin holding this season's Form 13615 can confirm it in the same save. Certificates are never copied.
- The email locks once a person is picked. "Not this person" resets to a blank Add.
- Save sends the Edit call with the picked profile's revision. A stale revision gets the existing CONFLICT handling (re-read, ask to save again).
- Typing an existing, not-on-this-roster profile's email into the plain email field gives "That email belongs to an earlier volunteer. Pick them above." instead of the generic error.

### Roster CSV

- An "Export CSV" button in the Roster toolbar beside the filters. It exports exactly the rows on screen (search, role, Show), and is disabled when nothing matches. Admin only (the Roster is admin only).
- Filename `roster-<season>-<YYYY-MM-DD>.csv`, New York date.
- Columns: Name; Email; Phone; Roles (joined with `; `); Certificates as the table names them, each with its confirmation date in New York local date, e.g. `IT&QR (2026-11-03); Basic (2026-11-03)`; Languages (the other language written out); Account (Not created / Invited / Active / Deactivated); Cleared (Yes / No).
- `src/csv.mjs`: UTF-8 BOM, RFC 4180 quoting, `\r\n` line endings, apostrophe guard for cells starting `=`, `+`, `-`, `@`, tab or carriage return. Shared so #256 can reuse it.
- `combineVolunteers` carries each certificate's confirmation date (browser-only).

### Seed

- `seed:local` adds about three fictional people with a profile and a `season - 1` roster entry with confirmed certificates and no current entry, and gives one of today's 8 volunteers a `season - 1` entry too, to show that someone already on this roster is left off the picker. Direct SQL, the stated exception. The re-run delete covers them by email list.

### Tests and checks

- `npm test`: unit tests for `src/csv.mjs` (BOM, quoting, guard), the CSV rows and filename, and the picker's candidate list and form fill.
- Database test: Edit adds a past volunteer to the current season (no roles, not new, roster entry created, revision raised, usual days kept); iterate with `database-quick.yml`.
- A new `tests/browser.mjs` block (not the story): pick a returning volunteer from last season, save, see them on the Roster with their usual days kept; export the CSV with a filter and check its rows. Past-season rows set up with SQL.
- No `build:hant`: staff screens are English. No sign-in check: sign-in is untouched.
- No local Docker: the database and browser suites are verified by the PR's full CI run.

## Goals / non-goals

- Goals: re-adding last season's volunteers without retyping, without the email dead end; an admin export of the roster as shown.
- Non-goals: copying roles or certificates; bulk add of every returning volunteer; the season data export (#256); any migration or RPC change; reactivating accounts automatically.
- Anti-goals: a pick that silently overwrites a different person's profile; an export that runs formulas in Excel or garbles Chinese names; a save that wipes a returning volunteer's usual days.

## Left to the builder

- Exact drawer markup and ordering inside the toolbar, following existing Roster patterns.
- How the past-season read is added to `listVolunteers` (one more `roster_entries` read for `season - 1`).
- The seed's fictional names, emails and phones (fictional only).
