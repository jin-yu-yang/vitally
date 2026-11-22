# Returning Volunteers and Roster CSV Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin re-add last season's (or any earlier) volunteer from Add a volunteer, and export the Roster as shown to a safe CSV, with no database change.

**Architecture:** Everything is in the browser. The picker reads earlier volunteers with a new store read beside the Roster's. A pick fills the Add form, and Save sends the existing Edit call (`vitally_save_volunteer` with the person id and profile revision), which already creates the current-season roster entry. The CSV is built from the filtered list by a shared encoder `src/csv.mjs`. The local seed writes a previous-season roster directly with SQL.

**Tech Stack:** Plain ES modules (no framework), Supabase JS, `node:test`, Playwright (`tests/browser.mjs`), PostgreSQL via `tools/admin/database.mjs`.

**Spec:** `openspec/changes/add-returning-volunteers-and-roster-csv/` — `design.md` (D1–D8), `specs/volunteer-roster/spec.md`, `specs/local-seed-data/spec.md`, and `brainstorm.md` for the decisions.

## Global Constraints

- No migration, RPC, RLS, Edge Function or realtime change. 058 stays unused.
- Staff screens are English only. No `src/client-text.mjs` and no `build:hant`.
- Fictional data only: example.org addresses, fictional names and phones (`(215) 555-01xx`).
- No local Docker. Never run `supabase start` or the local stack. Database tests are iterated with `gh workflow run database-quick.yml --ref add-returning-volunteers-and-roster-csv -f files="tests/database-volunteer-roster.mjs"`, and the full database and browser suites are verified by the PR's CI run.
- Every command a subagent runs has a timeout. No foreground server. CI waits are bounded (`gh run watch` with a timeout). An approval prompt means report BLOCKED.
- Exact copy:
  - "Returning volunteer? Search last season's roster"
  - "Earlier volunteer"
  - "Not this person"
  - "That email belongs to an earlier volunteer. Pick them above."
  - "That email is already on the Roster." (unchanged)
  - "Export CSV"
- CSV filename: `roster-<season>-<YYYY-MM-DD>.csv`, with the date in America/New_York.
- CSV columns, in order: `Name, Email, Phone, Roles, Certificates, Languages, Account, Cleared`.
- New tests in `tests/browser.mjs` go in their own `test(...)` block, never in the story.

## Review Focus

1. **Dates near midnight.** A certificate confirmed at `2026-11-04T03:30:00Z` is `2026-11-03` in New York, and an export at 23:30 New York time on Nov 23 is named `…-2026-11-23.csv`. Pinned in Task 2.
2. **Picking someone with a sign-in.** Saving a picked person who has a sign-in must send their stored email unchanged, or the database refuses it. The email is read-only after a pick. Pinned in Task 4's view test and Task 5's database test.
3. **A picked person edited meanwhile.** If another admin saves the picked profile first, Save gets `CONFLICT` and the drawer shows the usual conflict message, not a generic error. Pinned in Task 3's controller test.
4. **No current season, or the first season.** `listEarlierVolunteers()` returns `[]` when the workspace has no current season, and the picker shows no list. A full-email match still works for profiles not on the roster. Pinned in Task 3's store test.
5. **Typed text in the CSV.** Names or other languages containing commas, quotes or line breaks, and names starting with `=` or `-`, must stay one cell and never run as a formula. Pinned in Task 1 and Task 2.

---

### Task 1: Shared CSV encoder

**Files:**
- Create: `src/csv.mjs`
- Test: `tests/csv.test.mjs`

**Interfaces:**
- Produces: `toCsv(header: string[], rows: Array<Array<string|null|undefined>>): string`, the full file text starting with `"﻿"`.

- [ ] **Step 1: Write the failing tests** in `tests/csv.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { toCsv } from "../src/csv.mjs";

test("starts with a BOM and ends lines with CR LF", () => {
  assert.equal(toCsv(["A", "B"], [["1", "2"]]), "﻿A,B\r\n1,2\r\n");
});
test("quotes commas, quotes, CR and LF, doubling quotes", () => {
  assert.equal(toCsv(["A"], [['Tagalog, "Filipino"'], ["x\ny"], ["x\ry"]]),
    '﻿A\r\n"Tagalog, ""Filipino"""\r\n"x\ny"\r\n"x\ry"\r\n');
});
test("guards cells that start like a formula, phones included", () => {
  const out = toCsv(["A"], [["=HYPERLINK(1)"], ["+1 555 0100"], ["-2"], ["@x"], ["\tx"], ["\rx"]]);
  assert.deepEqual(out.slice(1).split("\r\n").slice(1, 6), ["'=HYPERLINK(1)", "'+1 555 0100", "'-2", "'@x", "'\tx"]);
  assert.match(out, /"'\rx"/);
});
test("null and undefined are empty cells", () => {
  assert.equal(toCsv(["A", "B"], [[null, undefined]]), "﻿A,B\r\n,\r\n");
});
```

- [ ] **Step 2: Run** `node --test tests/csv.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `toCsv`** in `src/csv.mjs`. For each cell: apply the guard first (`/^[=+\-@\t\r]/` gets `'` prefixed), then quote if it contains `"`, `,`, `\r` or `\n`. Add a header comment naming design D7 and that #256 reuses it.
- [ ] **Step 4: Run** `node --test tests/csv.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** with `git add src/csv.mjs tests/csv.test.mjs` and the message `Roster CSV: shared CSV encoder with BOM, quoting and formula guard`.

---

### Task 2: Roster CSV rows, certificate dates and filename

**Files:**
- Modify: `src/volunteer-roster.mjs` (`combineVolunteers`, new exports)
- Test: `tests/volunteer-roster.test.mjs`

**Interfaces:**
- Consumes: `toCsv` (Task 1).
- Produces:
  - Each volunteer from `combineVolunteers` gains `certificateDates: { [certificate]: string }`, holding ISO `confirmed_at` for confirmed certificates. `certificates` is unchanged.
  - `rosterCsvFilename(season: number, now: Date): string`.
  - `rosterCsv(volunteers: Volunteer[]): string`, the full file via `toCsv`.

- [ ] **Step 1: Write the failing tests.**
  - `combineVolunteers` puts `certificateDates.itqr === "2026-11-04T03:30:00Z"` on a volunteer whose confirmed itqr row has that `confirmed_at`. Uploaded rows are not in `certificates` or `certificateDates`, as today.
  - `rosterCsvFilename(2026, new Date("2026-11-24T04:30:00Z")) === "roster-2026-2026-11-23.csv"`.
  - The header of `rosterCsv([...])` is `Name,Email,Phone,Roles,Certificates,Languages,Account,Cleared`.
  - A Preparer with itqr and basic confirmed at `2026-11-04T03:30:00Z` gives a row with `Preparer` and `IT&QR (2026-11-03); Basic (2026-11-03)`.
  - Languages use `languagesText` wording, with the other language written out.
  - Account is `accountLabel` (`Not created` / `Invited` / `Active` / `Deactivated`).
  - Cleared is `Yes` / `No`.
  - A volunteer with no roles and no certificates has empty Roles and Certificates cells.
  - A phone `+1 555 0100` is written `'+1 555 0100`.
- [ ] **Step 2: Run** `node --test tests/volunteer-roster.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - Labels come from `ROLES` and `CERTIFICATES` (`label`), joined with `"; "`.
  - The date is from `Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })`, which gives `YYYY-MM-DD`.
  - `languagesText` and `accountLabel` live in `src/volunteer-views.mjs`. If importing them into `volunteer-roster.mjs` would make an import cycle, move them into `volunteer-roster.mjs` and re-export them from `volunteer-views.mjs` under the same names.
- [ ] **Step 4: Run** `node --test tests/volunteer-roster.test.mjs tests/volunteer-views.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Roster CSV: rows, certificate dates and New York filename`.

---

### Task 3: Earlier volunteers, the pick, and saving a pick

**Files:**
- Modify: `src/supabase-store.mjs` (new `listEarlierVolunteers`, near `listVolunteers`)
- Modify: `src/volunteer-roster.mjs` (`returningCandidates`, `returningFill`, `volunteerProblem`)
- Modify: `src/controller.mjs` (`readVolunteers`, new `pickReturningVolunteer` / `unpickReturningVolunteer` / `setReturningSearch`, `saveVolunteer`, initial state)
- Test: `tests/store.test.mjs`, `tests/volunteer-roster.test.mjs`, `tests/controller.test.mjs`

**Interfaces:**
- Produces:
  - `store.listEarlierVolunteers(): Promise<Earlier[]>`. An `Earlier` is `{ id, name, email, phone, works, languages, otherLanguage, usualDays, revision, hasSignIn, lastSeason: boolean }`.
    - It returns people with a `volunteer_profiles` row and no `roster_entries` row for `current_season`, sorted by name.
    - `lastSeason` is true when they have an entry for `current_season - 1`.
    - It returns `[]` when `current_season` is null.
    - Staff-only, like `listVolunteers`.
  - `returningCandidates(earlier: Earlier[], query: string): Array<Earlier & { earlier: boolean }>`.
    - It keeps `lastSeason` people whose name or email contains the trimmed query, ignoring case. An empty query keeps all of them.
    - When the query is a full email equal, ignoring case, to a non-`lastSeason` person's email, that person is added with `earlier: true`.
  - `returningFill(person: Earlier)` returns a drawer `volunteer` object:
    - `{ ...person fields, roles: [], certificates: [], isNew: false, photoIdChecked: false }`;
    - `hasSignIn` is carried.
  - `volunteerProblem(payload, list, volunteerId, earlier = [])`. After the current-Roster duplicate check, an email equal to the email of an `earlier` person whose `id !== volunteerId` returns `"That email belongs to an earlier volunteer. Pick them above."`.
  - Controller state:
    - `state.earlierVolunteers: Earlier[]` (initially `[]`);
    - `state.dialogContext` for a pick is `{ volunteerId: <id>, returning: true }`;
    - `state.returningSearch: string`, reset when the drawer opens.
  - Controller functions:
    - `pickReturningVolunteer(id)`;
    - `unpickReturningVolunteer()`, which returns the context to `null`;
    - `setReturningSearch(text)`.
  - `saveVolunteer` with `dialogContext.returning` finds `current` in `state.earlierVolunteers`, sends `expectedRevision: Number(current.revision)`, and passes `state.earlierVolunteers` to `volunteerProblem`.

- [ ] **Step 1: Write the failing store tests** in `tests/store.test.mjs`, using the `fakeClient` / `ROSTER_ROWS` pattern of the `listVolunteers` tests. Cover:
  - current season 2026, rows for 2026 and 2025: a 2025-only person is returned with `lastSeason: true`;
  - a 2024-only person is returned with `lastSeason: false`;
  - a 2026 person is not returned;
  - `current_season` null returns `[]`;
  - an applicant is refused.
- [ ] **Step 2: Write the failing helper tests** in `tests/volunteer-roster.test.mjs`. Cover:
  - `returningCandidates` with query `"ker"`;
  - the full-email match of a 2024-only person, flagged `earlier: true`;
  - an empty query listing only `lastSeason` people;
  - `returningFill` keeping `usualDays: ["tue","thu"]` and `otherLanguage`, with no roles, no certificates and not new;
  - `volunteerProblem` returning the earlier-volunteer sentence for an unpicked add, and `null` for the picked person's own email (`volunteerId` = their id).
- [ ] **Step 3: Write the failing controller tests** in `tests/controller.test.mjs`, using the existing `store.listVolunteers` stub pattern (around line 6686). Cover:
  - `readVolunteers` also fills `state.earlierVolunteers`;
  - after `pickReturningVolunteer(id)`, `saveVolunteer(values)` calls `store.saveVolunteer` with `{ volunteerId: id, expectedRevision: <their revision>, volunteer: values }`;
  - a `CONFLICT` from that save shows `VOLUNTEER_CONFLICT_MESSAGE` and re-reads both lists;
  - `unpickReturningVolunteer()` returns `dialogContext` to `null`, and the next save is a plain add (`volunteerId: null`);
  - an unpicked add with an earlier person's email sets `state.volunteerFormError` to the earlier-volunteer sentence and sends nothing.
- [ ] **Step 4: Run** `node --test tests/store.test.mjs tests/volunteer-roster.test.mjs tests/controller.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 5: Implement** the interfaces above.
  - `listEarlierVolunteers` reads `workspaces.current_season`, then reads these in parallel: `volunteer_profiles` (`*`), `people` (`id,name,user_id`), and `roster_entries` (`person_id,season`) with `.in("season", [season, season - 1])`.
  - `readVolunteers` uses `Promise.all` for both reads and keeps today's failure handling for the list.
  - Opening the drawer (`open-add-volunteer` / `open-edit-volunteer`) clears `returning` and `returningSearch`.
- [ ] **Step 6: Run** `npm test`. Expected: PASS.
- [ ] **Step 7: Commit** with the message `Returning volunteers: earlier-volunteer read, pick and save through Edit`.

---

### Task 4: The picker and Export CSV on screen

**Files:**
- Modify: `src/volunteer-views.mjs` (`volunteerDrawerBody`, `renderRoster`)
- Modify: `src/views.mjs` (the `state.dialog === "volunteer"` branch near line 793, `rosterPage` near line 357)
- Modify: `src/app.mjs` (actions `pick-returning-volunteer`, `unpick-returning-volunteer` and `export-roster-csv`, plus the input handler for `#returning-search`)
- Modify: `src/styles.css` (picker list and toolbar button, using existing tokens)
- Test: `tests/volunteer-views.test.mjs`

**Interfaces:**
- Consumes: `returningCandidates`, `returningFill`, `rosterCsv`, `rosterCsvFilename`, `filterVolunteers`, and the Task 3 controller functions and state.
- Produces:
  - `volunteerDrawerBody({ ..., returning: { query, candidates, picked } | null })`.
    - In add mode with nothing picked, it starts with a labelled search input `#returning-search` ("Returning volunteer? Search last season's roster") and a list of candidates. Each candidate is a button with `data-action="pick-returning-volunteer" data-id` showing the name and email, with an "Earlier volunteer" tag when `earlier`.
    - With `picked`, it shows the picked name and a `data-action="unpick-returning-volunteer"` "Not this person" button, renders the fill with the email `readonly`, and leaves New volunteer unticked. Add mode stays on: no account section and no document lines.
  - `renderRoster(..., { exportable })` adds a toolbar button "Export CSV" with `data-action="export-roster-csv"`, `disabled` when no row passes the filters.

- [ ] **Step 1: Write the failing view tests.** Cover:
  - Add drawer with candidates: the search label text, one pick button per candidate, and the "Earlier volunteer" tag only on `earlier`.
  - Picked drawer:
    - the email input has `readonly`;
    - `isNew` is not checked and Photo ID is not checked;
    - no role or certificate is checked;
    - Tue and Thu usual days are checked;
    - "Not this person" is present;
    - there is no search box.
  - Picked person with `hasSignIn`: the email is still readonly.
  - Roster with rows has an enabled "Export CSV". With a search matching nobody, it has a disabled one.
- [ ] **Step 2: Run** `node --test tests/volunteer-views.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement the views and wiring.**
  - `views.mjs` passes `returning` from `state.returningSearch`, `state.earlierVolunteers` and the picked person. For a pick, the title stays "Add a volunteer".
  - `export-roster-csv` in `app.mjs` builds `rosterCsv(filterVolunteers(state.volunteers, state.volunteerFilters))`. It downloads it as a `Blob([text], { type: "text/csv;charset=utf-8" })` through a temporary `<a download>`, the way `downloadShadedCopy` does, named `rosterCsvFilename(state.workspace.currentSeason, new Date())`.
  - The search input redraws only the list and keeps focus, like the Roster search box.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Returning volunteers: search and pick in Add; Roster: Export CSV`.

---

### Task 5: Database contract for saving a past volunteer

**Files:**
- Test: `tests/database-volunteer-roster.mjs` (a new subtest inside the existing `test("volunteer roster records against real Supabase", ...)`)

**Interfaces:**
- Consumes: the file's helpers `editArgs(personId, revision, entry)`, `volunteer(extra)`, `save`, `refusedWith`, `profileOf`, `revisionOf`, `count` and `one`.

- [ ] **Step 1: Write the subtest** "Edit adds a past-season volunteer to the current season".
  - **Setup:** add a volunteer with `save(addArgs(volunteer({ usualDays: ["tue","thu"], roles: [...], certificates: [...] })))`. Move their roster entry and certificates to `current_season - 1` with `f.sql` (update `season` on `roster_entries` and `certificates`), so they have a profile and only a previous-season entry.
  - **Then:** save with `editArgs(id, revision, volunteer({ email: same, roles: [], certificates: [], isNew: false, photoIdChecked: false, usualDays: ["tue","thu"] }))`.
  - **Assert:**
    - a current-season entry exists with `roles = '{}'`, `is_new = false` and `added_by_person_id` = the caller;
    - the revision is one higher;
    - `usual_days = {tue,thu}`;
    - the previous-season entry and its certificates are unchanged;
    - replaying the same action id returns the same result, with one current entry;
    - a second save with the old revision is refused with `CONFLICT`, with one current entry;
  - another past volunteer saved with Preparer plus VSC, IT&QR and Basic gets a current entry with Preparer, and three `confirmed` current-season certificates confirmed by the caller. Saved with Preparer and only VSC, it is refused with `ROLE_NEEDS`, writing nothing.
  - **Sign-in case:** for a past volunteer with a sign-in (if the file has a helper that links one; otherwise skip this case and note it), saving with the same email succeeds.
- [ ] **Step 2: Run on CI** with `gh workflow run database-quick.yml --ref add-returning-volunteers-and-roster-csv -f files="tests/database-volunteer-roster.mjs"` (push first), then `gh run watch <id>` with a 20-minute timeout. Expected: PASS. The behaviour already exists, so a failure means the test is wrong or the contract assumption is. Report it rather than changing SQL.
- [ ] **Step 3: Commit** with the message `Database test: Edit adds a past-season volunteer to the current season`.

---

### Task 6: The local seed's previous season

**Files:**
- Modify: `tools/admin/seed-values.mjs` (new `SEED_PAST_VOLUNTEERS`, plus the email of the one of the 8 who also gets a past entry)
- Modify: `tools/admin/seed-cases.mjs` (after `seedVolunteers`, a new `seedPastSeason(client, { workspaceId, actorPersonId })`; the re-run delete)
- Test: `tests/seed.test.mjs`, `tests/database-seed.mjs`

**Interfaces:**
- Produces:
  - `SEED_PAST_VOLUNTEERS`: three entries with name, email, phone, works, languages, other language, usual days (at least one non-empty), roles, and certificates backing the roles under `ROLE_NEEDS`. The names are fictional and new, for example Nadia Kerr, Elliot Brandt and Mei Sato, with example.org emails.
  - `SEED_PAST_ALSO_CURRENT_EMAIL`: one of `SEED_VOLUNTEERS`' emails.
  - `seedPastSeason` returns `3`.

- [ ] **Step 1: Write the failing tests.**
  - In `tests/seed.test.mjs`: the three past volunteers are fictional (example.org) and distinct from the 8; each role is backed (`missingFor(role, certificates)` is empty); at least one has usual days; `SEED_PAST_ALSO_CURRENT_EMAIL` is one of the 8.
  - In `tests/database-seed.mjs`, after a seed run:
    - three people have a `current_season - 1` entry and no current entry;
    - the one of the 8 has both;
    - the current Roster count is unchanged;
    - a second run leaves exactly three past-only people, each with one past entry;
    - the story's use adds none, under the same flag the 8 use.
- [ ] **Step 2: Run** `node --test tests/seed.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `seedPastSeason`.
  - **Writes:** in the seed's connection and transaction, insert `people` (`person_key` `'v_'` + 12 hex, as the RPC does), `volunteer_profiles`, `roster_entries` for `current_season - 1` (with `added_by_person_id` = the Site Coordinator person and `is_new = false`), and `certificates` (`status 'confirmed'`, `confirmed_at now()`, confirmer = the Site Coordinator). Also insert the past entry for the one of the 8.
  - **Re-run delete:** extend the existing re-run delete (the query near line 525 with the email list) to cover the past emails, with the same no-sign-in rule.
  - **Comment:** the code comment names this as the `local-seed-data` exception.
- [ ] **Step 4: Run** `node --test tests/seed.test.mjs`, then the database seed test on CI with `database-quick.yml -f files="tests/database-seed.mjs"`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Local seed: a previous season's roster to pick returning volunteers from`.

---

### Task 7: Browser test block

**Files:**
- Modify: `tests/browser.mjs` (a new `test(...)` after the Roster's block near line 9148, Chrome only, with its own `createBrowserFixture()`)

- [ ] **Step 1: Write the block** "An admin re-adds a returning volunteer and exports the Roster".
  - **Setup with SQL:** a past-only person Nadia Kerr (`nadia.kerr@example.org`, usual days Tue and Thu, a `season - 1` entry as Preparer with VSC, IT&QR and Basic).
  - **The picker:**
    - As the Site Coordinator, open Add a volunteer.
    - Typing `nadia.kerr@example.org` straight into the email field, with a name, and saving shows "That email belongs to an earlier volunteer. Pick them above."
    - Type "ker" in the search and pick her. The email is readonly, Tue and Thu are ticked, and New volunteer is unticked.
    - Save. Her Roster row shows "No roles recorded". The database has a current entry, `usual_days {tue,thu}`, and `is_new false`.
  - **The export:**
    - Choose role Preparer. Press Export CSV and catch the `download` event.
    - The suggested filename matches `/^roster-\d{4}-\d{4}-\d{2}-\d{2}\.csv$/`.
    - The file starts with the BOM, its header is the eight columns, and its rows are exactly the Preparers shown.
  - **Then:** capture a screenshot of the picker at desktop width and at `MOBILE_WIDTH`, and check there's no sideways scroll, like the Season settings block.
- [ ] **Step 2: Check the syntax** with `node --check tests/browser.mjs`. Expected: no output. The suite itself runs only on CI.
- [ ] **Step 3: Commit** with the message `Browser test: returning volunteer picker and Roster CSV`.

---

### Task 8: Docs and verification

**Files:**
- Modify: `docs/developer/` pages that describe the Roster and `seed:local` (find them with `grep -rln "Roster\|seed:local" docs/developer`)
- Modify: the roadmap's #138 progress line, if it lists these items

- [ ] **Step 1: Update the docs.** The developer guide gets the picker (earlier volunteers read, save through Edit), the CSV (`src/csv.mjs`, shared with #256) and the seed's previous season. The roadmap's #138 line gets these two items.
- [ ] **Step 2: Run** `npm test` and `npx openspec validate --all`. Expected: PASS, with 0 failed.
- [ ] **Step 3: Commit** with the message `Docs: returning volunteers, Roster CSV, seed's previous season`.
- [ ] **Step 4: Push the branch and run CI.** Run `gh workflow run ci.yml --ref add-returning-volunteers-and-roster-csv`, and watch it with a bounded wait. Expected: `checks`, `database`, `sign-in` and both `story` legs pass, including the new browser block. Record the run link for `verify.md`, and review the screenshots from the run's artifacts.
