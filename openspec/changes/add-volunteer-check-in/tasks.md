## 1. Migration: storage, span and visibility

- [ ] 1.1 Confirm the migration number against `origin/main` and the open PRs, expected `059_volunteer_check_in.sql`. Record it in design.md if it differs (Open Questions).
- [ ] 1.2 Add `public.check_ins` (design D1):
  - columns: id, workspace, season, person, `check_in_date`, `checked_in_at`, `checked_out_at`, revision, created and updated by and at, `corrected_by_person_id`, `removed_at`;
  - checks: out after in, both on `check_in_date` in New York, and out at the latest the following midnight;
  - a foreign key to `people(workspace_id,id)`;
  - an index on `(workspace_id, season, check_in_date)`.
- [ ] 1.3 Add `vitally_private.check_in_span(p_check_in, p_now)`, returning `state`, `ends_at` and `minutes` (D2). The day's end is the latest live shift end that day, else the site close, else none.
- [ ] 1.4 Add a SELECT policy and grant on `check_ins`: workspace admins see every row, a person sees their own, and there is no write grant (D5).
- [ ] 1.5 Add `check_ins` to `supabase_realtime` with 049's DO block (D9).
- [ ] 1.6 Add `tests/database-check-in.mjs`, part 1:
  - the table checks;
  - the RLS for an admin, the person, another preparer and a client;
  - no direct writes;
  - realtime: an admin and the person get the change, and another preparer gets none;
  - every span scenario with a fixed `p_now`: a missed check-out with a shift, one with no shift, a check-in after the end, a closed day, open and capped, staying late, 11:58 pm, a check-out of 24:00, and a DST Sunday.

## 2. Migration: RPCs

- [ ] 2.1 `vitally_my_check_in`, `vitally_check_in` and `vitally_check_out` (D3):
  - the refusals FORBIDDEN, then NOT_CLEARED, with no receipt;
  - the lock, then the receipt;
  - `ALREADY_CHECKED_IN` and `NOT_CHECKED_IN`;
  - yesterday's open check-in is not `open`.
- [ ] 2.2 `vitally_save_check_in` and `vitally_remove_check_in` (D4):
  - workspace admins only, in the order FORBIDDEN, VALIDATION, lock, receipt, CONFLICT, domain refusals;
  - the reasons `NOT_ON_ROSTER`, `DEACTIVATED`, `OUT_BEFORE_IN`, `IN_FUTURE` and `OVERLAP` (spans may meet);
  - `HH:MM` New York times, with `24:00` for the check-out only;
  - an edit keeps the person and the date;
  - every save sets `corrected_by_person_id`;
  - removal is a soft delete.
- [ ] 2.3 Replace `vitally_schedule_day`: copy 058's body as is and add only the admin-only `checkIns` block, marked `-- 059`. Each check-in carries its id, revision, volunteer, name, times, `endsAt`, `state`, `minutes`, its flags (`noCheckOut`, `notScheduled`, `corrected`, `outsideSiteHours`) and `correctedByName` (D7).
- [ ] 2.4 `vitally_hours_this_week()`: workspace admins only, returning `weekStart`, `weekEnd` and `hours [{volunteerId, minutes}]` over `ny_week(now())` (D8).
- [ ] 2.5 Grants: execute for `authenticated` only on the six RPCs, and none on the private helper. Update `tests/support/rpc-signatures.mjs` and `tests/database-catalog.mjs`.
- [ ] 2.6 `tests/database-check-in.mjs`, part 2: every `volunteer-check-in` RPC scenario, the day read's `checkIns` (an admin gets them, a non-admin's answer is unchanged), and `vitally_hours_this_week`. Check that `tests/database-schedule.mjs` passes unchanged. Run `npm run db:migrate:test` on a stack that already has 058, then `npm run test:database`.

## 3. Store and pure logic

- [ ] 3.1 `src/supabase-store.mjs`:
  - `myCheckIn`, `checkIn`, `checkOut`, `saveCheckIn`, `removeCheckIn` and `hoursThisWeek`;
  - `check_ins` in `STAFF_TABLES`;
  - the new refusal reasons mapped;
  - `weekShifts` removed if nothing else uses it.
- [ ] 3.2 Pure helpers with unit tests, in `src/volunteer-schedule.mjs` or a new `src/volunteer-check-in.mjs`:
  - New York time labels ("9:52 am") and bar labels ("– now", "– no check-out");
  - the bar's left and width by the minute across the open hours, cut off at the edges;
  - 5-minute time options that keep an off-step saved time;
  - the "No check-out. Counted to 1 pm." note;
  - the hours format (minutes to one decimal, rounded half up, whole numbers without a decimal).

## 4. Screens

- [ ] 4.1 Controller, the strip (D6):
  - its state from `vitally_my_check_in` on sign-in, restore, focus, own `check_ins` changes, and clearance changes;
  - the Check in and Check out actions with an action id and a busy state;
  - `ALREADY_CHECKED_IN` and `NOT_CHECKED_IN` re-read quietly;
  - none in uncleared windows.
- [ ] 4.2 `src/views.mjs`: the strip at the top of the staff shell's main area, outside the sidebar, for cleared windows with `canCheckIn`. CSS: one line or wrapping, a tap target of at least 44 px, and no sideways scroll at 390 px.
- [ ] 4.3 Controller, the Schedule:
  - the check-in drawer (add and edit), its save and remove with the shared confirmation dialog, and refusals shown in the drawer;
  - the CONFLICT message "Someone changed this check-in. The schedule has been refreshed.";
  - a `check_ins` change re-reads the day for admins (D7, D9).
- [ ] 4.4 `src/schedule-views.mjs`:
  - rows for volunteers with a shift or a check-in (admins);
  - the check-in bars with labels and tags, as keyboard-reachable buttons;
  - the closed-day and no-site-hours list for admins;
  - "+ Add check-in" on today and past days only;
  - the check-in drawer with "Corrected by" and the missed note;
  - the read-only Schedule unchanged.

  CSS for the bars and tags.
- [ ] 4.5 Workload (`src/controller.mjs`, `src/volunteer-workload.mjs`, `src/workload-views.mjs`): `readWorkloadHours` calls `hoursThisWeek`, and the rows carry minutes, formatted and sorted by minutes. It re-reads on `check_ins`, `shifts` and `schedule_settings` changes and on a new season (D8).
- [ ] 4.6 Unit tests:
  - the strip's gates: cleared, uncleared, setup screen and client;
  - the strip's states and quiet refusals;
  - the Schedule's admin and read-only variants with check-ins;
  - the drawer's limits;
  - the Workload's hours column format and sort.

## 5. Seed

- [ ] 5.1 `tools/admin/seed-cases.mjs`:
  - about four check-ins through `vitally_save_check_in` as the Site Coordinator, on the most recent open days before today;
  - most matching seeded shifts, one with no check-out, and one for a role account with no shift that day;
  - their ids in the run file, removed on a re-run through `vitally_remove_check_in`;
  - none for the browser story.

  Extend `tests/database-seed.mjs` (D10).

## 6. Browser story and docs

- [ ] 6.1 The browser story's check-in walk (D11):
  - the preparer checks in from the strip at 390 px, with no sideways scroll;
  - the site coordinator's Schedule shows the bar tagged "Not scheduled", corrects its in time, and the bar reads "Corrected";
  - the preparer checks out;
  - the Workload's Hours this week shows the formatted number.

  Keep it short. Run `npm run test:browser`.
- [ ] 6.2 Docs:
  - `docs/developer/database.md`: the table, the RPCs, the realtime table and the migration row;
  - the frontend notes: the strip and the check-in drawer;
  - `docs/setup.md`'s migration table if it lists migrations;
  - the README counts, if they list RPCs or tables.
- [ ] 6.3 Final checks:
  - merge `origin/main` first if it has moved;
  - `npm test`;
  - `npm run db:migrate:test` on a stack with main's migrations and 058, then `npm run test:database`;
  - `npm run test:browser`;
  - `npx openspec validate --all`.
