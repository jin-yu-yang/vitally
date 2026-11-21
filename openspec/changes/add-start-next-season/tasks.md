## 1. Migration 055: past seasons and open work

- [x] 1.1 Inventory every write path to case rows (RPCs, direct table grants, storage policies) and list them in the task's report
- [x] 1.2 Database tests (failing first): every case-writing RPC on a past-season case is refused with `PAST_SEASON`; a draft (`season is null`) stays writable and submits into the current season
- [x] 1.3 Add the past-season check to `vitally_private.lock_case`, to `vitally_assistance_action` for items that name a case, and to any direct write path found in 1.1
- [x] 1.4 Database tests (failing first): `open_work` ignores past-season cases; a returning volunteer with a past-season Accepted case has Preparer removed in the new season; Deactivate succeeds for a volunteer whose only cases are past-season; a current-season Accepted case still counts
- [x] 1.5 Scope `vitally_private.open_work`'s preparer and reviewer branches to the current season (or a null season)
- [x] 1.6 Drop `vitally_private.capabilities_before_052`, with a test that it is gone

## 2. Migration 055: Start next season

- [x] 2.1 Add the `season_starts` table (RLS on, no grants to signed-in users), with a test that signed-in users can't read or write it
- [x] 2.2 Database tests (failing first) for the refusal order: FORBIDDEN (no receipt), replay before CONFLICT, CONFLICT, VALIDATION (wrong year, past 2100)
- [x] 2.3 Database tests (failing first) for `SEASON_NOT_FINISHED` and its four counts: open cases in any season, open follow-ups, claimed help requests, unclaimed help requests that name a case; no-case help requests and drafts not counted
- [x] 2.4 Database tests (failing first) for a successful start:
  - the default follow-up person is moved to the starter, or kept if they are a site coordinator;
  - the season is +1;
  - the starter's roster entry has no roles;
  - non-site-coordinator staff accounts are deactivated;
  - clients, site coordinators and deactivated accounts are unchanged;
  - the mirror equals the new season's roles;
  - the history row is written;
  - the new season's first client number is 1.
- [x] 2.5 Write `vitally_start_next_season` per design D1â€“D4, under the workspace lock, deactivating through the ordinary `vitally_private.deactivate_account`
- [x] 2.6 Push and run `gh workflow run database-quick.yml --ref add-start-next-season -f files="tests/database-past-season.mjs tests/database-open-work-season.mjs tests/database-start-next-season.mjs"` (no local Docker)

## 3. Browser: current season only

- [ ] 3.1 Unit tests (failing first): staff `listCases` asks only for `season = current or season is null`; clients' query is unchanged; staff `getCase` for a past-season case answers as unavailable
- [ ] 3.2 Add the staff season filter to `listCases` and `getCase` in `src/supabase-store.mjs`, reading the current season from the workspace row
- [ ] 3.3 Make the controller send a staff window opening or restoring a past-season case to its home screen, with a unit test
- [ ] 3.4 Show a `PAST_SEASON` refusal with the existing "not available" handling, with a unit test

## 4. Browser: Start next season on Season settings

- [ ] 4.1 Unit tests (failing first) for the "Next season" card: the button for site coordinators only, none for other admins
- [ ] 4.2 Unit tests (failing first) for the dialog: title, export reminder, the typed-year gate, the `SEASON_NOT_FINISHED` lines (singular and plural), `CONFLICT` re-read and close
- [ ] 4.3 Add the store call, controller action and view for the card and dialog (staff text in English)
- [ ] 4.4 After success, every window re-reads: the starter's window shows the setup screen, and deactivated windows show "This account has no access"

## 5. Exit Form tax year

- [ ] 5.1 Unit test (failing first): the Exit Form for a season-2026 case shows tax year 2025
- [ ] 5.2 Change `src/app.mjs` to pass `season - 1`, falling back to `currentSeason - 1`, with no hard-coded 2025

## 6. Story, docs and checks

- [ ] 6.1 In the story, change only the Exit Form tax-year assertion to season − 1
- [ ] 6.2 Add a separate Chrome test with its own workspace, "A site coordinator starts the next season", in `tests/browser.mjs`. It covers:
  - a refused start that lists the counts;
  - a successful start: the starter's setup screen, a volunteer's no-access window, and an empty case pool.
- [ ] 6.3 Update the developer docs that describe seasons, the roster, open work and `capabilities_before_052`
- [ ] 6.4 Run `npm test` and `npx openspec validate --all` locally. The database, sign-in and story checks are the PR's full CI run, linked in `verify.md`.
