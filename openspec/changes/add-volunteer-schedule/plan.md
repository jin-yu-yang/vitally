# Volunteer Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the hourly volunteer Schedule (issue #140): shifts with one role each, site hours and coverage targets in Season settings, a coverage-gap row, private usual days, a My profile page, and the Workload's Hours this week column.

**Architecture:**
- Migration 057 adds `shifts`, `schedule_settings` and `volunteer_profiles.usual_days`. The browser reads them through RPCs. SELECT policies exist only so realtime can deliver changes, and they hide no-sign-in volunteers' shifts from non-admins.
- The database decides what each shift counts toward. A pure browser module sums coverage, formats New York dates and orders the picker.
- Two new view modules render the Schedule and My profile. `app.mjs` adds pointer drag on top of the same save action the drawer uses.

**Tech Stack:**
- Postgres/Supabase (plpgsql RPCs, RLS, the `supabase_realtime` publication);
- vanilla ES modules (`src/*.mjs`);
- `node:test` (`npm test`, `npm run test:database`);
- Playwright (`npm run test:browser`).

**Spec:** `openspec/changes/add-volunteer-schedule/`. Read `design.md` (D1–D12) and `specs/{volunteer-schedule,season-settings,volunteer-roster,volunteer-workload,volunteer-clearance,local-seed-data}/spec.md`. The decision log is in `brainstorm.md`.

## Global Constraints

- **Time:** every date and hour is America/New_York, whatever the viewer's or test machine's time zone. Hours are whole, with `0 ≤ start < end ≤ 24`. A week runs Monday to Sunday, and ISO weekdays run Monday = 1 to Sunday = 7.
- **Roles:** `greeter`, `intaker`, `preparer`, `reviewer`, `admin`, shown as Greeter, Intaker, Preparer, Reviewer, Admin.
- **Targets:** `preparersNeeded`, `reviewersNeeded`, `onSiteNeeded`, each a whole number 0–9, defaulting to 2 / 1 / 1.
- **Errors:** `VT001` FORBIDDEN, `VT003` CONFLICT, `VT007` VALIDATION. A VALIDATION reason or field name goes in the error `detail`, as 052's `season_link` does.
- **RPC order:** FORBIDDEN (nothing written, no receipt) → shape VALIDATION → `pg_advisory_xact_lock(hashtextextended(workspace_id::text,0))` → `reserve_receipt` (a replay returns the stored answer) → CONFLICT → domain VALIDATION.
- **Grants:** every new function revokes all from `public,anon,authenticated,service_role`, and public RPCs grant execute to `authenticated` only. Every new public RPC is added to `tests/support/rpc-signatures.mjs` and `tests/database-catalog.mjs`.
- **Replaced functions:** each copies its latest body verbatim (053 for `vitally_save_volunteer` and `vitally_my_clearance`, 052 for `vitally_season_settings`) and marks every added or changed line `-- 057`.
- **Migrations:** final once applied. Don't edit 001–054.
- **Copy:** staff screens are English only, and there is no client text, so `src/client-text.mjs` and `src/zh-hant.mjs` are untouched. Use fictional data only. Never touch `src/pcdc-logo.png`.
- **Exact copy from the specs:**
  - "Schedule" with the overline "VOLUNTEERS"; "My profile" with the overline "VOLUNTEER";
  - "+ Add shift", "Remove shift", "Remove <name>'s shift?";
  - "The site is closed on <weekday>s.", "Set site hours in Season settings first.";
  - "<N> of <M> hours have gaps", "No gaps", "OK", "1 more preparer" / "2 more preparers" / "1 more reviewer" / "1 more on site";
  - "Usually here <weekday>s"; the tags "Not cleared", "No sign-in", "Role removed", "Outside site hours";
  - "Roles this season", "No roles recorded", "Usual days", "Only you and the office admins see your usual days.", "Your shifts this week", "No shifts this week.";
  - "Someone changed this shift. The schedule has been refreshed.";
  - "Site hours and coverage", "Hours this week".
- **Commits:** end each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `.superpowers/`.

## Review Focus

1. **Today and the week across DST and time zones.** The week that holds a DST change (2026-11-01 back, 2027-03-14 forward) must still run Monday to Sunday by calendar date, and a viewer in UTC+8 at 23:30 NY time must get NY's date. Tests are in Task 6 (`nyToday`, `weekBounds`) and Task 5 (`shiftsThisWeek` with the SQL `now()` pinned).
2. **A flagged shift opened in the drawer.** A shift tagged "Outside site hours" must show its saved hours, not snap to the new site hours. Saving it unchanged must show the `OUTSIDE_SITE_HOURS` refusal text, not a blank error. Test in Task 7 (`shiftDrawer` keeps 2–5 when Saturday closes at 4).
3. **A drag gesture that sends twice.** A `pointerup` and a click on the same gesture, or a fast second drag, must not create two shifts. Each gesture gets one action id, and the replay returns the stored answer. Tests in Task 3 (replay) and Task 8 (one save per gesture).
4. **Close hour 24 and noon.** Hour labels must read "12 pm" for 12 and "12 am" for 24, with no "0 pm" or "24 am". Test in Task 6 (`hourLabel`).
5. **A volunteer with two shifts in a day.** The row holds both blocks. A drag-create takes the role of the earliest one, and a resize can't run into the other (`OVERLAP`). Tests in Task 6 (`dragRole`, `scheduleRows`) and Task 3 (adjacent shifts are allowed, overlapping ones refused).

---

### Task 1: Migration 057 storage, visibility and realtime

**Files:**
- Create: `supabase/migrations/057_volunteer_schedule.sql` (sections §1–§3)
- Create: `tests/database-schedule.mjs`
- Modify: `docs/developer/database.md` (table list: `volunteer_profiles.usual_days`, `schedule_settings`, `shifts`)

**Interfaces:**
- Produces:
  - `public.shifts(id uuid pk default gen_random_uuid(), workspace_id uuid, season smallint, person_id uuid, shift_date date, start_hour smallint, end_hour smallint, role text, revision bigint default 1, created_at, created_by_person_id uuid, updated_at, updated_by_person_id uuid, removed_at timestamptz)`, with a foreign key `(workspace_id,person_id) → people on delete cascade` and an index `shifts_day (workspace_id,season,shift_date)`.
  - `public.schedule_settings(workspace_id uuid pk, site_hours jsonb not null default '{}', preparers_needed smallint default 2, reviewers_needed smallint default 1, on_site_needed smallint default 1, revision bigint default 1, updated_at, updated_by_person_id uuid)`.
  - `volunteer_profiles.usual_days smallint[] not null default '{}'`.
  - `vitally_private.valid_site_hours(jsonb) returns boolean`.
  - `vitally_policy.is_schedule_viewer(p_workspace_id uuid) returns boolean`, granted to `authenticated`.
  - `vitally_private.schedule_viewer(p_workspace_id uuid, p_person_id uuid) returns boolean`.

- [ ] **Step 1: Write the failing tests.** In `tests/database-schedule.mjs`, `test("Volunteer schedule against real Supabase")` uses one `createDatabaseFixture()`, with the `rpc` and `refused` helpers as in `database-season-settings.mjs`. Subtests:
  - **"storage checks"**: inserting through `f.sql`:
    - `start_hour=5,end_hour=5` fails;
    - `end_hour=25` fails;
    - `role='host'` fails;
    - `usual_days='{8}'` fails, `'{6,6}'` fails, and `'{6,2}'` fails (must be sorted);
    - `'{2,6}'` succeeds.
  - **"site hours validator"**:
    - `valid_site_hours('{"6":{"open":10,"close":16}}')` is true;
    - `{"6":{"open":16,"close":10}}`, `{"8":{"open":1,"close":2}}`, `{"6":{"open":-1,"close":2}}` and `{"6":{"open":10}}` are false.
  - **"who reads shifts directly"**:
    - insert a shift for `f.preparerId` and one for a volunteer with no sign-in, created with `vitally_save_volunteer` as `f.siteCoordinator` with role greeter and certificate vsc;
    - `f.siteCoordinator.from("shifts").select("id")` returns both;
    - `f.preparer` returns only the first;
    - an `f.staff({ key: "nora_no_entry", capabilities: [], cleared: false })` whose roster entry is deleted returns none;
    - `f.applicantA` returns none.
  - **"schedule_settings reads"**: a viewer reads the row, `f.applicantA` reads none.
  - **"no direct writes"**: `insert`, `update` and `delete` on both tables from `f.siteCoordinator` return an error.
  - **"published"**: `pg_publication_tables` for `supabase_realtime` lists `shifts` and `schedule_settings`.
- [ ] **Step 2: Run it to see it fail.** Run `npm run db:migrate:test` and then `node --env-file=.env.test --test tests/database-schedule.mjs`. Expected: FAIL (`relation "public.shifts" does not exist`).
- [ ] **Step 3: Write 057 §1–§3.**
  - The checks in D1, with sorted usual days checked as `usual_days = (select array_agg(d order by d) from unnest(usual_days) d)` or empty.
  - RLS on both tables, with `grant select … to authenticated` and no write grant.
  - The policy on `shifts`: `vitally_policy.is_schedule_viewer(workspace_id) and (exists(select 1 from people p where p.workspace_id=shifts.workspace_id and p.id=shifts.person_id and p.user_id is not null) or vitally_policy.is_workspace_admin(workspace_id))`.
  - The policy does not test `removed_at`. Removed rows stay readable so realtime can deliver the removal UPDATE, and every RPC and the store's `weekShifts` filter `removed_at is null`.
  - `schedule_viewer` is `is_workspace_admin`-equivalent for that person, or `audience_member(ws, person, 'everyone', '{}')`. `is_schedule_viewer` applies it to the caller's own person.
  - 049's DO block over `array['shifts','schedule_settings']`.
- [ ] **Step 4: Run it to see it pass.** Run the same two commands. Expected: PASS.
- [ ] **Step 5: Commit** `057: shifts, schedule settings and usual days storage (#140)` with the migration, the test and the doc.

### Task 2: Schedule settings RPCs and the Season settings read

**Files:**
- Modify: `supabase/migrations/057_volunteer_schedule.sql` (§4)
- Modify: `tests/database-schedule.mjs`, `tests/database-season-settings.mjs`, `tests/support/rpc-signatures.mjs`, `tests/database-catalog.mjs`

**Interfaces:**
- Consumes: Task 1's tables and `valid_site_hours`.
- Produces:
  - `vitally_private.schedule_settings_answer(ws uuid) returns jsonb`, which returns `{siteHours, targets:{preparersNeeded,reviewersNeeded,onSiteNeeded}, revision}`. With no row it returns `{}`, the defaults and revision 0.
  - `public.vitally_save_schedule_settings(p_action_id uuid, p_expected_revision bigint, p_settings jsonb) returns jsonb`, with the same answer.
  - `vitally_season_settings()`, replaced, adds the key `schedule` holding that answer.

- [ ] **Step 1: Write the failing tests.** In the subtest "schedule settings save":
  - `f.siteCoordinator` saves `{siteHours:{"2":{open:17,close:20},"4":{open:17,close:20},"6":{open:10,close:16}}, targets:{preparersNeeded:2,reviewersNeeded:1,onSiteNeeded:0}}` at revision 0, and the answer equals the input with revision 1.
  - `vitally_season_settings().schedule` equals it.
  - Admin-not-site-coordinator: `f.staff({key:"ada_admin", capabilities:["admin"]})` is refused VT001 with 0 receipts.
  - `{"6":{open:16,close:10}}` is refused VT007 with detail `siteHours.6`.
  - `onSiteNeeded: 10` is refused VT007 with detail `onSiteNeeded`.
  - `preparersNeeded: 1.5` is refused VT007 with detail `preparersNeeded`.
  - A stale revision is refused VT003.
  - The same action id twice gives equal answers and revision +1 once.
  - In `database-season-settings.mjs`, assert the read has `schedule.revision === 0` before any save.
- [ ] **Step 2: Run it to see it fail.** Run `node --env-file=.env.test --test tests/database-schedule.mjs`. Expected: FAIL (function does not exist).
- [ ] **Step 3: Implement §4** in the Global Constraints order. Use the operation `'SAVE_SCHEDULE_SETTINGS'` in the digest, and insert at revision 0 or update otherwise. Add both RPC registry entries, with `receiptKeys` `["revision","siteHours","targets"]`.
- [ ] **Step 4: Run it to see it pass.** Run `npm run db:migrate:test` and then `node --env-file=.env.test --test tests/database-schedule.mjs tests/database-season-settings.mjs tests/database-catalog.mjs tests/database.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `057: site hours and coverage targets on Season settings (#140)`.

### Task 3: Saving and removing shifts

**Files:**
- Modify: `supabase/migrations/057_volunteer_schedule.sql` (§5)
- Modify: `tests/database-schedule.mjs`, `tests/support/rpc-signatures.mjs`, `tests/database-catalog.mjs`

**Interfaces:**
- Consumes: Task 2's saved site hours.
- Produces:
  - `public.vitally_save_shift(p_action_id uuid, p_shift_id uuid, p_expected_revision bigint, p_shift jsonb) returns jsonb`.
    - `p_shift` is `{volunteerId, date:"YYYY-MM-DD", startHour, endHour, role}`. On an edit, `volunteerId` must match the stored person, or VALIDATION `volunteerId`.
    - Add means both ids are null (`p_expected_revision` null). Edit means both are present.
    - It answers `{shiftId, revision}`.
  - `public.vitally_remove_shift(p_action_id uuid, p_shift_id uuid, p_expected_revision bigint) returns jsonb`, answering `{shiftId, revision, removed:true}`.
  - Domain VALIDATION details: `NOT_ON_ROSTER`, `DEACTIVATED`, `ROLE_NOT_HELD`, `SITE_CLOSED`, `OUTSIDE_SITE_HOURS`, `OVERLAP`. A removed or unknown shift gives VT002 `NOT_FOUND`.

- [ ] **Step 1: Write the failing tests** for each scenario of the spec requirements "A shift is one role over whole hours inside site hours" and "Only a workspace admin changes shifts", using Saturday 10–16 and a Saturday date computed in the test as the next Saturday in NY:
  - a valid add gives revision 1;
  - `ROLE_NOT_HELD`, `OUTSIDE_SITE_HOURS` (9–12), `SITE_CLOSED` (a Monday);
  - `OVERLAP` for 12–15 against 10–13, and success for 13–15;
  - `DEACTIVATED`, via `vitally_deactivate_account` on an `f.staff` volunteer;
  - `NOT_ON_ROSTER`;
  - `f.preparer` refused VT001 with 0 receipts;
  - an uncleared site coordinator adds a shift;
  - two admins, the second at revision 1, refused VT003;
  - a replay of the same action id leaves one row;
  - remove, then edit the removed shift, refused VT002;
  - remove sets `removed_at` and revision+1 (the realtime UPDATE).
- [ ] **Step 2: Run it to see it fail.** Expected: FAIL.
- [ ] **Step 3: Implement §5.**
  - Checks run in the order of the reasons list.
  - "Holds the role" means `role = any(roster_entries.roles)` for the current season.
  - Hours come from `schedule_settings.site_hours ->> extract(isodow from date)::text`.
  - Overlap: `start_hour < new_end and end_hour > new_start and removed_at is null and id <> p_shift_id`.
  - Add both registry entries.
- [ ] **Step 4: Run it to see it pass.** Expected: PASS.
- [ ] **Step 5: Commit** `057: save and remove shifts (#140)`.

### Task 4: The schedule day read, flags and counts

**Files:**
- Modify: `supabase/migrations/057_volunteer_schedule.sql` (§6)
- Modify: `tests/database-schedule.mjs`, `tests/support/rpc-signatures.mjs`, `tests/database-catalog.mjs`

**Interfaces:**
- Produces: `public.vitally_schedule_day(p_date date) returns jsonb`, which returns:
  - `{date, weekday:1..7, hours:{open,close}|null, anyOpen:boolean, targets, settingsRevision, canEdit, canEditSettings, shifts:[{shiftId,revision,volunteerId,name,role,startHour,endHour}], candidates?}`.
  - For admins, each shift adds `flags:["notCleared"|"noSignIn"|"roleRemoved"|"outsideSiteHours"]` and `counts:"preparer"|"reviewer"|"onSite"|null`.
  - `candidates` is for admins only: `[{volunteerId,name,roles,usualDays,cleared,works,signedIn}]`.
  - Shifts are ordered by name, then `startHour`.

- [ ] **Step 1: Write the failing tests.**
  - **Non-admin answer:** for `f.preparer`, no shift object has `flags` or `counts`, there is no `candidates` key, and the no-sign-in volunteer's shift is absent. For the site coordinator the same shift is present with `flags` containing `noSignIn` and `notCleared`.
  - **Counts:**
    - a cleared preparer gives `"preparer"`;
    - an uncleared preparer (`f.staff` with `cleared:false`) gives null;
    - a cleared Intaker with works `remote` gives null, and with `on_site_and_remote` gives `"onSite"`;
    - an Admin shift gives null.
  - **Role removed:** removing a role through `vitally_save_volunteer` gives `roleRemoved` and `counts` null.
  - **Hours shrink:** saving Saturday 10–15 makes the 14–17 shift `outsideSiteHours`.
  - **Candidates:** they exclude a no-roles volunteer and a deactivated one, and include the no-sign-in volunteer.
  - **Refusals:** `f.applicantA` and a non-viewer get VT001.
  - **No site hours:** a Monday with none saved gives `hours:null` and `anyOpen:false`.
- [ ] **Step 2: Run it to see it fail.** Expected: FAIL.
- [ ] **Step 3: Implement §6** with `vitally_private.cleared`, the D6 rule in a private `shift_counts(ws, shift) returns text` helper, and the registry entries.
- [ ] **Step 4: Run it to see it pass.** Expected: PASS.
- [ ] **Step 5: Commit** `057: schedule day read with coverage counts for admins (#140)`.

### Task 5: Usual days, My profile and the replaced roster and clearance functions

**Files:**
- Modify: `supabase/migrations/057_volunteer_schedule.sql` (§7–§9)
- Modify: `tests/database-schedule.mjs`, `tests/database-volunteer-roster.mjs`, `tests/database-clearance.mjs`, `tests/support/rpc-signatures.mjs`, `tests/database-catalog.mjs`

**Interfaces:**
- Produces:
  - `public.vitally_my_profile() returns jsonb`: `{name, roles, usualDays, profileRevision, weekStart, weekEnd, shiftsThisWeek:[{shiftId,date,startHour,endHour,role}]}`.
  - `public.vitally_save_my_usual_days(p_action_id uuid, p_expected_revision bigint, p_days int[]) returns jsonb`: `{usualDays, profileRevision}`.
  - `vitally_save_volunteer`, replaced, accepts an optional `usualDays`.
  - `vitally_my_clearance()`, replaced, adds `scheduleViewer`.
  - `vitally_private.ny_week(p_at timestamptz) returns table(monday date, sunday date)`.

- [ ] **Step 1: Write the failing tests.**
  - **Usual days:**
    - `f.preparer` saves `[6,2]` and gets `[2,6]` back with profile revision +1;
    - `[8]` and `[1,1]` are refused VT007;
    - a stale revision is refused VT003;
    - an admin's `vitally_save_volunteer` at the pre-save profile revision is then refused VT003;
    - a `vitally_save_volunteer` without `usualDays` keeps `[2,6]`.
  - **Privacy:** no answer of `vitally_schedule_day` or `vitally_my_profile` for `f.reviewer` contains the preparer's `usualDays` (stringify and search for the key under another volunteer's id).
  - **Week bounds:** `ny_week('2026-11-02 03:30+00')` is (2026-10-26, 2026-11-01), because it is still Sunday Nov 1 in NY. `ny_week('2027-03-14 12:00-04')` is (2027-03-08, 2027-03-14).
  - **My profile:** it lists this week's shifts and not next Monday's or a removed one.
  - **Clearance:** `scheduleViewer` is true for a no-roles rostered `f.staff` and false for one without an entry. Add the scenarios to `database-clearance.mjs`.
  - **Roster:** `usualDays` round-trips, and `[6,6]` is refused, in `database-volunteer-roster.mjs`.
- [ ] **Step 2: Run it to see it fail.** Expected: FAIL.
- [ ] **Step 3: Implement §7–§9.**
  - `ny_week` uses `(p_at at time zone 'America/New_York')::date` and `isodow`.
  - Copy 053's `vitally_save_volunteer` and `vitally_my_clearance` verbatim, adding the `-- 057` lines.
  - Add the registry entries.
- [ ] **Step 4: Run it to see it pass.** Run `npm run db:migrate:test`, then the full `npm run test:database`. Expected: PASS, with no regressions in the roster, clearance-uploads or season settings suites.
- [ ] **Step 5: Commit** `057: usual days, My profile, and scheduleViewer in the clearance (#140)`.

### Task 6: Store calls and the pure schedule module

**Files:**
- Modify: `src/supabase-store.mjs` (`STAFF_TABLES`, new methods), `src/errors.mjs` (reason messages)
- Create: `src/volunteer-schedule.mjs`, `tests/volunteer-schedule.test.mjs`
- Modify: `tests/database-store.mjs`

**Interfaces:**
- Produces, as store methods returning the RPC answers: `scheduleDay(date)`, `saveShift({actionId, shiftId, revision, shift})`, `removeShift({actionId, shiftId, revision})`, `myProfile()`, `saveMyUsualDays({actionId, revision, days})`, `saveScheduleSettings({actionId, revision, settings})`, and `weekShifts({monday, sunday})`, the admin's direct read of live current-season shifts.
- Produces, from `src/volunteer-schedule.mjs`:
  - `nyToday(now: number): string`, `addDays(date, n): string`, `isoWeekday(date): 1..7`, `weekBounds(date): {monday, sunday}`;
  - `hourLabel(h): string`, `dayLabel(date): string`, `weekdayPlural(weekday): string` ("Saturdays");
  - `shiftLine(shift): string`;
  - `coverageRows({hours, targets, shifts}): [{hour, missing:{preparers,reviewers,onSite}, text}]`;
  - `gapHeader(rows): string`;
  - `orderCandidates(candidates, weekday): [{...candidate, usual:boolean}]`;
  - `scheduleRows(shifts): [{volunteerId, name, shifts}]`;
  - `dragRole(shifts, volunteerId): string|null`;
  - `ROLE_LABELS`.
- Reason messages, in `errors.mjs`:
  - `OUTSIDE_SITE_HOURS` → "The shift must stay inside site hours.";
  - `SITE_CLOSED` → "The site is closed that day.";
  - `OVERLAP` → "That volunteer already has a shift at that time.";
  - `ROLE_NOT_HELD` → "That volunteer doesn't have that role this season.";
  - `NOT_ON_ROSTER` → "That volunteer isn't on this season's roster.";
  - `DEACTIVATED` → "That volunteer's account is deactivated.".

- [ ] **Step 1: Write the failing unit tests:**
  - `nyToday(Date.parse("2026-11-07T04:30:00Z")) === "2026-11-06"`, because UTC+8 users at NY 23:30 still get NY's date;
  - `weekBounds("2026-11-01")` is `{monday:"2026-10-26", sunday:"2026-11-01"}`;
  - `weekBounds("2027-03-10")` is `{monday:"2027-03-08", sunday:"2027-03-14"}`;
  - `hourLabel` for 0, 10, 12, 17 and 24 gives `["12 am","10 am","12 pm","5 pm","12 am"]`;
  - `dayLabel("2027-02-06") === "Saturday, February 6"`;
  - `shiftLine({date:"2027-02-02",startHour:17,endHour:20,role:"preparer"}) === "Tue, Feb 2 · 5 pm – 8 pm · Preparer"`;
  - `coverageRows` for the spec's four coverage scenarios gives the exact texts ("1 more preparer", "1 more preparer, 1 more on site", "2 more preparers, 1 more reviewer, 1 more on site", "OK");
  - `gapHeader` gives "2 of 6 hours have gaps" and "No gaps";
  - `orderCandidates` lists Hana and Wen (usual on 6) before Ari, by name within each group;
  - `dragRole` returns the earliest shift's role;
  - `scheduleRows` puts two shifts of one person in one row.
  
  In `database-store.mjs`, assert `SUBSCRIBED_TABLES.staff` includes `shifts` and `schedule_settings`, and that `scheduleDay` maps VT001 to FORBIDDEN.
- [ ] **Step 2: Run it to see it fail.** Run `node --test tests/volunteer-schedule.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.** Do date arithmetic on `YYYY-MM-DD` strings through `Date.UTC`, never local `new Date(string)`. `nyToday` uses `Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York"})`.
- [ ] **Step 4: Run it to see it pass.** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Schedule store calls and pure helpers (#140)`.

### Task 7: The Schedule screen, the shift drawer and the gates

**Files:**
- Create: `src/schedule-views.mjs`, `tests/schedule-views.test.mjs`
- Modify: `src/controller.mjs`, `src/views.mjs` (`staffSidebar`), `src/setup-views.mjs`, `src/app.mjs` (click actions), `src/clearance.mjs` (read `scheduleViewer`), `src/styles.css`, `tests/controller.test.mjs`, `tests/setup-views.test.mjs`

**Interfaces:**
- Consumes: Task 6's store methods and helpers.
- Produces:
  - Screens `"schedule"` and `"my-profile"`.
  - `state.schedule = {date, day, drawer:null|{mode:"add"|"edit", shiftId, revision, volunteerId, role, startHour, endHour, actionId}}`.
  - Controller methods `openSchedule()`, `scheduleGo("prev"|"next"|"today")`, `openShiftDrawer(shiftId|null)`, `saveShift(draft)`, `removeShift(shiftId)` (through the shared confirmation dialog) and `readScheduleDay()`.
  - Views `scheduleScreen(state, person)` and `shiftDrawer(state)`.
  - Data actions `open-schedule`, `open-my-profile`, `schedule-prev`, `schedule-next`, `schedule-today`, `open-add-shift`, `open-shift`, `save-shift`, `remove-shift`.

- [ ] **Step 1: Write the failing tests.**
  - **View tests (`schedule-views.test.mjs`):**
    - An admin day answer renders the header "2 of 6 hours have gaps", one column per open hour, the tags, the coverage row and "+ Add shift".
    - A non-admin answer renders no tags, no coverage row, no "+ Add shift", and shift elements that are not `data-action="open-shift"`.
    - A closed day says "The site is closed on Mondays.". `anyOpen:false` says "Set site hours in Season settings first." and gives a Season settings link only when `canEditSettings`.
    - The drawer limits start and end to the open hours and the roles to the candidate's roles.
    - The drawer for a shift flagged `outsideSiteHours` (14–17 with Saturday closing at 16) still shows 2 pm – 5 pm (Review Focus 2).
  - **Controller tests:**
    - `scheduleViewer:false` restoring `"schedule"` lands on the home screen.
    - The uncleared viewer's sidebar has Schedule and My profile.
    - The sidebar order is admin Follow-ups, All cases, Volunteers, Schedule, My profile, Post an update, Season settings; non-admin Work board, Schedule, My profile.
    - A CONFLICT on save re-reads and toasts "Someone changed this shift. The schedule has been refreshed.".
    - A `shifts` or `schedule_settings` realtime change re-reads the open day.
    - Focus re-reads.
- [ ] **Step 2: Run it to see it fail.** Run `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The grid is a CSS grid with `grid-column: span (end-start)`, inside `overflow-x:auto`.
  - Every shift is a `<button>` with an `aria-label` like "Rowan Diaz, Preparer, 10 am to 1 pm".
  - Remove uses the existing confirmation dialog helper.
- [ ] **Step 4: Run it to see it pass.** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Schedule screen, shift drawer and sidebar links (#140)`.

### Task 8: Drag to create and resize

**Files:**
- Create: `src/schedule-drag.mjs`, `tests/schedule-drag.test.mjs`
- Modify: `src/app.mjs` (pointer listeners on `.schedule-grid` when `canEdit`), `src/schedule-views.mjs` (`data-hour` cells and `data-edge="start|end"` handles), `src/styles.css`

**Interfaces:**
- Consumes: `controller.saveShift(draft)` and `dragRole`.
- Produces:
  - `dragResult({kind:"create"|"start"|"end", volunteerId, shift?, fromHour, toHour, hours, shifts}): draft|null`. It returns null for a zero-length or no-op gesture. A create spans `min..max+1` of the cells crossed.
  - One `actionId` per gesture, made at `pointerdown`.

- [ ] **Step 1: Write the failing tests:**
  - a create across 14 and 15 in a row whose earliest shift is Preparer gives `{startHour:14,endHour:16,role:"preparer"}`;
  - an end-drag of 10–13 to the 14 cell gives `{startHour:10,endHour:15}`;
  - a start-drag past the end gives null;
  - a create over an occupied cell gives null;
  - the same gesture's draft carries one `actionId`, and a second `pointerup` returns null (Review Focus 3).
- [ ] **Step 2: Run it to see it fail.** Expected: FAIL.
- [ ] **Step 3: Implement.** `pointerdown` calls `setPointerCapture`, `pointermove` highlights cells, and `pointerup` calls `dragResult` and then `controller.saveShift`. Ignore events from a non-primary button.
- [ ] **Step 4: Run it to see it pass.** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Drag to create and resize shifts (#140)`.

### Task 9: My profile, the Roster's usual days and the Season settings card

**Files:**
- Create: `src/profile-views.mjs`, `tests/profile-views.test.mjs`
- Modify: `src/controller.mjs` (`openMyProfile`, `saveMyUsualDays(days)`, `saveScheduleSettings(settings)`, re-reads), `src/volunteer-views.mjs`, `src/volunteer-roster.mjs` (`usualDays` in the drawer model and the save payload), `src/season-settings-views.mjs`, `src/app.mjs` (`save-usual-days`, `save-site-hours`, toggles), `src/styles.css`, and `tests/{volunteer-roster,season-settings-views,controller}.test.mjs`

**Interfaces:**
- Consumes: Task 6's `myProfile`, `saveMyUsualDays`, `saveScheduleSettings`, `shiftLine` and `hourLabel`.
- Produces: `myProfileScreen(state)`. `seasonSettingsScreen` gains the "Site hours and coverage" card.

- [ ] **Step 1: Write the failing tests.**
  - My profile renders "Roles this season", seven `aria-pressed` toggles with Save, the privacy note, and the shift lines or "No shifts this week.".
  - The Roster drawer renders Usual days after Works and sends `usualDays:[2,6]`. A drawer model without the field sends no `usualDays` key.
  - The Season settings card:
    - for a site coordinator: tiles, hour selects and number inputs 0–9 with their own Save;
    - for another admin: "Saturday · 10 am – 4 pm" and "Tuesday · Closed" as text;
    - on save, a VT007 with detail `siteHours.6` names Saturday.
- [ ] **Step 2: Run it to see it fail.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it to see it pass.** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `My profile, usual days on the Roster, and site hours on Season settings (#140)`.

### Task 10: Workload "Hours this week"

**Files:**
- Modify: `src/volunteer-workload.mjs` (`workloadRows` gains `hours`, and `"hours"` joins the sort keys), `src/controller.mjs` (`WORKLOAD_SORT_KEYS`, and loading `weekShifts` for the Workload with re-reads on `shifts` changes), `src/workload-views.mjs`, `tests/volunteer-workload.test.mjs`, `tests/workload-views.test.mjs`

**Interfaces:**
- Consumes: `store.weekShifts`, `weekBounds` and `nyToday`.
- Produces: `weekHours(shifts, personId): number`.

- [ ] **Step 1: Write the failing tests.**
  - Tuesday 17–20 plus Saturday 10–14 this week plus next Monday gives 7.
  - Flagged shifts count.
  - The Unassigned row has no hours cell.
  - The header "Hours this week" follows Stalled and sorts 9, 6, 0 on the first press and reverses on the second.
- [ ] **Step 2: Run it to see it fail.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it to see it pass.** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Workload: Hours this week (#140)`.

### Task 11: Seed a week of the schedule

**Files:**
- Modify: `tools/admin/seed.mjs` and its seed helpers under `tools/admin/`, `tests/database-seed.mjs`

**Interfaces:**
- Consumes: `vitally_season_settings`, `vitally_save_schedule_settings`, `vitally_save_volunteer` (`usualDays`), `vitally_save_shift`, `vitally_remove_shift`, and the run file under `.vitally-runs/`.
- Produces: a `shifts: [{id, revision}]` list in the run file.

- [ ] **Step 1: Write the failing tests:**
  - after a seed, `schedule_settings.site_hours` is Tue/Thu 17–20 and Sat 10–16;
  - at least four fictional volunteers have usual days, two of them including 6;
  - about six live shifts fall in this NY week, one of them a no-sign-in volunteer's;
  - this week's Saturday read by the site coordinator has an hour whose `coverageRows` text is not "OK";
  - a second run keeps an admin-added shift and leaves exactly one seeded set;
  - saved hours (Sat 9–13) are kept, and the seeded shifts fit inside them;
  - the story's seed path adds none of this.
- [ ] **Step 2: Run it to see it fail.** Expected: FAIL.
- [ ] **Step 3: Implement.** Place shifts on this week's open days within whatever hours are saved, and use past days in the week if needed.
- [ ] **Step 4: Run it to see it pass.** Run `node --env-file=.env.test --test tests/database-seed.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `seed:local: site hours, usual days and a week of shifts (#140)`.

### Task 12: Browser story, docs and the final checks

**Files:**
- Modify: `tests/browser.mjs` (or its walk module in `tests/support/story-pages.mjs`), `docs/developer/database.md` (RPCs, realtime), `docs/developer/frontend.md` (Schedule, My profile, drag), `docs/developer/production-roadmap.md` (the Workload line)

- [ ] **Step 1: Add the story walk.**
  1. The site coordinator saves Saturday 10–16 in Season settings.
  2. They open the Schedule on a Saturday and add a Preparer shift for the preparer account with "+ Add shift".
  3. They drag its end one cell to the right, and see the coverage row change.
  4. The preparer window sees the shift without a reload, with no tags or coverage row.
  5. The preparer saves Tue and Sat on My profile.

  Screenshot the admin day and the preparer day. Keep the walk under about 40 s.
- [ ] **Step 2: Run it.** Run `npm run test:browser`. Expected: PASS for both browser orders.
- [ ] **Step 3: Update the docs** listed above, and drop "Schedule" from the sidebar's "does not exist yet" note if Task 7 didn't already.
- [ ] **Step 4: Run the final checks.**
  - `npm test`;
  - `npm run db:migrate:test` on a stack that already has main's migrations, then `npm run test:database`;
  - `npx openspec validate --all`;
  - `npm run build:hant -- --check` (expected unchanged).
  
  Expected: all PASS.
- [ ] **Step 5: Commit** `Story walk and docs for the volunteer schedule (#140)`.

---

## Reconciliation with main's My profile (added 2026-11-22, `/opsx:update`)

Main merged `add-my-profile` (#262/#264/#265, `057_my_profile.sql`) while this change was in review. By the user's decision this change adopts main's My profile and usual days, and keeps My profile cleared-only. These tasks implement tasks.md group 8. They supersede Tasks 5 (`vitally_my_profile`, `vitally_save_my_usual_days`, the `vitally_save_volunteer` replacement) and 9 (the My profile page and the Roster usual-days toggles), and step 6 of Task 12's walk.

**Constraints added to the Global Constraints for these tasks:**
- Main's My profile is the authority for the page, usual days, `vitally_my_profile` and `vitally_save_my_profile`. Do not change their behaviour or their tests, except to add the shifts section.
- Usual days are main's `text[]`, values `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`. ISO weekday 1 is `mon` and 7 is `sun`.
- The migration is `058_volunteer_schedule.sql`, with markers `-- 058`. Replaced functions copy their latest body: main's `057_my_profile.sql` for `vitally_my_clearance`, and 052 for `vitally_season_settings`.
- My profile opens only for cleared windows (main's spec). Uncleared windows hold the realtime channel only while on the Schedule.

### Task 13: Merge main

**Files:** whatever conflicts.

- [ ] **Step 1:** Run `git fetch origin` and `git merge origin/main` (a merge commit). Resolve conflicts so main's My profile is intact and every schedule change outside My profile and usual days is kept. If a conflict lands under `openspec/specs/`, stop and report it.
- [ ] **Step 2:** The tree may not build or pass yet, because Tasks 14–16 reconcile it. Commit the merge as `Merge main into add-volunteer-schedule (#262 My profile took 057)`.

### Task 14: Migration 058 and the database tests

**Files:**
- Modify: `supabase/migrations/057_volunteer_schedule.sql` → `058_volunteer_schedule.sql`
- Modify: `tests/database-schedule.mjs`, `tests/database-clearance.mjs`, `tests/support/rpc-signatures.mjs`, `tests/database-catalog.mjs`

**Interfaces:**
- Produces: `public.vitally_my_shifts() returns jsonb`, which returns `{weekStart, weekEnd, shifts:[{shiftId, date, startHour, endHour, role}]}`. It is gated like main's `vitally_my_profile` (FORBIDDEN for a client, an anonymous caller, no person, an `invited` account; no clearance gate), and it is in both registries.
- Removes: this change's `volunteer_profiles.usual_days` DDL, `vitally_private.valid_usual_days`, `public.vitally_my_profile`, `public.vitally_save_my_usual_days`, and the `vitally_save_volunteer` replacement.
- Keeps: `vitally_private.ny_week` if `vitally_my_shifts` uses it.

- [ ] **Step 1: Write the failing tests.**
  - `vitally_my_shifts` returns only the caller's live current-season shifts in the New York week. It leaves out next Monday and removed shifts, refuses an `invited` account and a client with VT001, and holds no other volunteer's shift.
  - The day read's `candidates[].usualDays` are main's strings, for example `["sat"]` for a volunteer an admin saved with `usualDays: ["sat"]` through main's `vitally_save_volunteer`.
  - `vitally_my_clearance` still returns main's `reviewedAt` and `reviewReason`, plus `scheduleViewer`.
  - Remove the tests of this change's dropped functions. Keep the privacy check that no non-admin answer contains another volunteer's `usualDays`.
- [ ] **Step 2: Run them to see them fail.** Reset the local database first, by adapting the scratch reset script outside the repo. Then run `npm run db:migrate:test` and `node --env-file=.env.test --test tests/database-schedule.mjs`.
- [ ] **Step 3: Implement.** Copy `vitally_my_clearance` verbatim from main's `057_my_profile.sql`, plus the `scheduleViewer` line marked `-- 058`.
- [ ] **Step 4: Run them to see them pass.** Run the full `npm run test:database`. The known env-only failure in `database-accounts-function.mjs` is the only failure allowed.
- [ ] **Step 5: Commit** as `058: reconcile with main's My profile; vitally_my_shifts (#140)`.

### Task 15: Store, pure helpers and the My profile section

**Files:**
- Modify: `src/supabase-store.mjs`, `src/volunteer-schedule.mjs`, `src/controller.mjs`, `src/profile-views.mjs` (main's file), `src/views.mjs`, `src/volunteer-views.mjs`, `src/volunteer-roster.mjs`, `src/app.mjs`, `src/styles.css`
- Test: `tests/volunteer-schedule.test.mjs`, `tests/profile-views.test.mjs`, `tests/controller.test.mjs`, `tests/volunteer-roster.test.mjs`

**Interfaces:**
- Produces:
  - `store.myShifts()`;
  - `orderCandidates(candidates, weekday)`, now matching `usualDays` strings (`WEEKDAY_KEYS = ["mon","tue","wed","thu","fri","sat","sun"]`, exported);
  - `state.myShifts = {weekStart, weekEnd, shifts}`;
  - the section "Your shifts this week" in main's `myProfilePage`.

- [ ] **Step 1: Write the failing tests.**
  - `orderCandidates` puts `["sat"]` volunteers first on weekday 6.
  - Main's `myProfilePage` renders "Your shifts this week" with lines like "Tue, Feb 3 · 5 pm – 8 pm · Preparer", or "No shifts this week.". Main's other sections are unchanged, and main's existing profile-view tests still pass.
  - The controller reads `myShifts` when My profile opens, on focus, and on a `shifts` change, for a cleared window.
  - An uncleared window has no My profile, and holds the channel only on the Schedule.
  - The sidebar has Schedule and no "My profile" nav link; My profile stays main's account-row link.
  - The Roster drawer shows main's usual-days checkboxes only.
- [ ] **Step 2: Run them to see them fail.** Run `npm test`.
- [ ] **Step 3: Implement.** Remove this change's My profile page, route, nav link, `saveMyUsualDays` and usual-days toggles, and the R13 base revision for usual days. The site-hours base revision stays.
- [ ] **Step 4: Run them to see them pass.** Run `npm test`.
- [ ] **Step 5: Commit** as `My profile: Your shifts this week on main's page; drop the duplicate profile (#140)`.

### Task 16: Seed

**Files:** `tools/admin/seed-values.mjs`, `tools/admin/seed-cases.mjs`, `tests/database-seed.mjs`

- [ ] **Step 1:** Change the seed volunteers' `usualDays` to `mon`…`sun` strings, saved through main's `vitally_save_volunteer`. Tests: at least four fictional volunteers have usual days, and at least two include `sat`.
- [ ] **Step 2:** Run `node --env-file=.env.test --test tests/database-seed.mjs` until it passes.
- [ ] **Step 3: Commit** as `seed:local: usual days as mon…sun (#140)`.

### Task 17: Browser walk, docs and the final checks

**Files:** `tests/browser.mjs`, `docs/developer/*.md`, `README.md`

- [ ] **Step 1:** In "A site coordinator schedules a volunteer, and the volunteer sees it", replace step 6, the preparer saving usual days on this change's My profile. The preparer now opens main's My profile from the account row and sees the Saturday shift under "Your shifts this week".
- [ ] **Step 2:** Run the schedule, Season settings and My profile browser tests with a test-name filter, then the full `npm run test:browser`.
- [ ] **Step 3:** Update the docs. Re-derive the migration, RPC and Realtime-table counts from the migrated database. Describe `vitally_my_shifts`, and remove the dropped functions.
- [ ] **Step 4:** Run the final checks:
  - `npm test`;
  - `npm run db:migrate:test` then `npm run test:database`;
  - `npm run build:hant -- --check`;
  - `npx openspec validate --all`.
- [ ] **Step 5: Commit** as `Schedule walk on main's My profile; docs and counts (#140)`.
