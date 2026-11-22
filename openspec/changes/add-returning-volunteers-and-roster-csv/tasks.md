## 1. Shared CSV encoder

- [x] 1.1 Add `src/csv.mjs` (`toCsv(header, rows)`): UTF-8 BOM, RFC 4180 quoting, CR LF line endings, and the apostrophe guard for cells starting `=`, `+`, `-`, `@`, tab or CR (design D7)
- [x] 1.2 Unit tests for `src/csv.mjs`: BOM, quoting of `"`, `,`, CR and LF, the guard (phones included), and empty cells

## 2. Roster data

- [x] 2.1 `combineVolunteers` carries each confirmed certificate's confirmation date; unit test
- [x] 2.2 New store method `listEarlierVolunteers()`: the profiles of people with no current-season roster entry, each with `lastSeason` (on the `current_season - 1` roster); `readVolunteers` reads it alongside `listVolunteers()` into `state.earlierVolunteers` (design D5); store and controller unit tests
- [x] 2.3 Pure helpers in `src/volunteer-roster.mjs`: the picker's candidates (last season's people not on this roster, filtered by name or email; full-email match on any other profile, labelled "Earlier volunteer") and the form values a pick fills (person fields and usual days; not new, photo ID unticked, no roles, no certificates); unit tests
- [x] 2.4 Form validation: an email belonging to a profile not on the current roster gives "That email belongs to an earlier volunteer. Pick them above."; an email on the current Roster keeps "That email is already on the Roster."; unit tests

## 3. Picker in Add a volunteer

- [x] 3.1 Render the search box "Returning volunteer? Search last season's roster" and its list at the top of the Add drawer, with "Earlier volunteer" labels; view unit tests
- [x] 3.2 Pick and "Not this person" actions: a pick fills the form, locks the email and carries the person id and profile revision; "Not this person" restores a blank Add with New ticked
- [x] 3.3 Save of a picked person sends `vitally_save_volunteer` with that person id and profile revision (the Edit call); conflicts handled as for Edit; controller unit tests

## 4. Roster CSV export

- [x] 4.1 Pure CSV row builder for the Roster: the columns of design D6 in order, the table's labels (IT&QR), certificate dates in New York time, Account and Cleared; the filename `roster-<season>-<YYYY-MM-DD>.csv` from the New York date; unit tests
- [x] 4.2 "Export CSV" button in the Roster toolbar, disabled when no row is shown; it downloads the rows `filterVolunteers` keeps, as a Blob; view unit tests

## 5. Database contract

- [x] 5.1 Database test in `tests/database-volunteer-roster.mjs`: saving a past-season volunteer through Edit creates their current-season entry (no roles, not new, added by the caller), raises the revision, keeps usual days, leaves earlier entries and certificates unchanged; a stale revision is `CONFLICT` with one entry; a repeated action id returns the stored result. Iterate with `database-quick.yml`

## 6. Local seed

- [ ] 6.1 Add three fictional previous-season volunteers (one with usual days) to `tools/admin/seed-values.mjs`, and pick one of the 8 to also get a previous-season entry
- [ ] 6.2 `seed:local` inserts their profiles, previous-season roster entries and confirmed certificates directly with SQL after the 8; a re-run first deletes the previous-season list's people with no sign-in; the browser story's use adds none
- [ ] 6.3 Seed tests: unit tests in `tests/seed.test.mjs` and the database check in `tests/database-seed.mjs` (three previous-season-only people, the one of the 8 on both, re-run stable, current Roster unchanged)

## 7. Browser test

- [ ] 7.1 A new `tests/browser.mjs` block (not the story) that sets up last season's roster with SQL: an admin picks a returning volunteer with usual days, saves, and sees them on the Roster with their usual days kept; typing an earlier volunteer's email without picking shows the message; Export CSV with a role filter downloads the expected rows and filename

## 8. Docs and checks

- [ ] 8.1 Update the developer guide where it describes the Roster and the seed (`docs/developer/`), and the roadmap's #138 progress line if it lists these items
- [ ] 8.2 Run `npm test` locally; run the database tests with `database-quick.yml`; verify `test:database` and the browser suite with the PR's full CI run (no local Docker)
