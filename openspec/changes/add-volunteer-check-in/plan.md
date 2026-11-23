# Volunteer Check-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Cleared volunteers check themselves in and out from a strip on every staff screen.
- Workspace admins see check-ins on the Schedule and correct them there.
- The Workload's Hours this week becomes checked-in time.

**Architecture:**
- **The database:** one new migration adds `public.check_ins`, which is RPC-only for writes and readable by workspace admins and by the person. It also adds a private span function, the single definition of a check-in's counted end and minutes. Every read uses it: the Schedule day read (replaced) and the new hours read.
- **The browser:** it only formats what the RPCs return:
  - the strip lives in `appShell`;
  - the bars and the drawer live in `schedule-views.mjs`;
  - pure helpers live in a new `src/volunteer-check-in.mjs`.

**Tech Stack:** Postgres and Supabase (hand-written SQL migrations, RLS, Realtime), `node:test`, vanilla ES modules, Playwright (the browser story).

**Spec:** `openspec/changes/add-volunteer-check-in/`:
- `design.md` (D1–D11);
- `specs/volunteer-check-in/spec.md`;
- `specs/volunteer-schedule/spec.md`;
- `specs/volunteer-workload/spec.md`;
- `specs/local-seed-data/spec.md`.

Read design.md and the specs before each task.

## Global Constraints

**Data and the database:**
- Fictional data only, in code, tests, fixtures and screenshots.
- Never edit an applied migration. `058_volunteer_schedule.sql` is not edited. Everything new goes in `supabase/migrations/060_volunteer_check_in.sql`, or the next free number found in Task 1 Step 1.
- Times are America/New_York throughout. In SQL, convert only with `at time zone 'America/New_York'`.
- RPC refusal order for admin writes: `FORBIDDEN` → `VALIDATION` (shape) → the workspace advisory lock → the receipt (a replay returns the stored answer) → `CONFLICT` → domain `VALIDATION` reasons. A refusal before the receipt writes nothing and stores no receipt.
- Self RPCs: `FORBIDDEN` → `NOT_CLEARED` → lock → receipt → domain reasons. No revision is sent.
- Execute on every new public RPC is granted to `authenticated` only. Private helpers get no grant.

**Screen text:**
- Staff screens are English only. Add no text to `src/client-text.mjs`.
- Exact text:
  - the strip: "Check in", "Checked in since 9:52 am", "Check out";
  - the bar labels: "9:52 am – 1:10 pm", "9:52 am – now", "9:52 am – no check-out" (with an en dash and spaces);
  - the tags: "No check-out", "Not scheduled", "Corrected", "Outside site hours";
  - the Schedule buttons: "+ Add check-in", "Remove check-in";
  - the Remove dialog: "Remove <name>'s check-in?";
  - the drawer notes: "Corrected by <name>", "No check-out. Counted to 1 pm.";
  - the CONFLICT message: "Someone changed this check-in. The schedule has been refreshed."
- Hours format: minutes ÷ 60 to one decimal, rounded half up, with a whole number shown without a decimal ("6.5", "7", "0").

**Verification:** run the checks that cover each task. At the end, run `npm test`, `npm run db:migrate:test` with `npm run test:database`, and `npm run test:browser`. Never run `supabase start` from the repo root (the stack is at `$VITALLY_STACK`, see `docs/setup.md`).

## Review Focus

1. **The New York day edge.** A check-in at 11:58 pm with a check-out of `24:00`, or `now()` just past midnight. Expected: the check-in stays on its date, and after midnight it is `missed`, not `open`. → Task 1's tests `span: 11:58 pm and 24:00` and `span: open becomes missed after midnight`.
2. **A DST Sunday** (2027-03-14 or 2027-11-07). Expected: a 10:00–13:00 check-in counts 180 minutes, and `HH:MM` converts to the right instant. → Task 1's test `span: DST Sunday`.
3. **A double tap or retry on a phone.** The same action id sent twice for Check in. Expected: one row, the same answer. A *new* action id while open: `ALREADY_CHECKED_IN`, and the strip re-reads quietly. → Task 2's `check in: replay` and Task 5's `strip: ALREADY_CHECKED_IN re-reads quietly`.
4. **An admin edit that keeps a volunteer's odd minute.** Open 9:52–1:10 and change only the out time. Expected: 9:52 is sent unchanged, and the 5-minute select still shows it as selected. → Task 4's `timeOptions keeps an off-step saved time` and Task 6's `drawer keeps 9:52 when only out changes`.
5. **Overlap against a derived end.** An existing missed check-out (derived end 1 pm) and an admin adding 12:00–14:00 the same day. Expected: `OVERLAP`. Adding 13:00–14:00 is accepted. → Task 3's `save: overlap uses the derived end`.

---

### Task 1: Migration, the table, the span, RLS and realtime

**Files:**
- Create: `supabase/migrations/060_volunteer_check_in.sql`
- Create: `tests/database-check-in.mjs`
- Reference (do not edit): `supabase/migrations/058_volunteer_schedule.sql`:
  - the `shifts` table at :56;
  - the policies at :140;
  - the publication DO block at :154;
  - `ny_week` at :638.

**Interfaces:**
- Produces:
  - **The table `public.check_ins`:**
    - `id uuid pk default gen_random_uuid()`, `workspace_id uuid`, `season smallint`, `person_id uuid`, `check_in_date date`;
    - `checked_in_at timestamptz not null`, `checked_out_at timestamptz null`;
    - `revision bigint default 1`;
    - `created_at`, `created_by_person_id`, `updated_at`, `updated_by_person_id`, `corrected_by_person_id uuid null`, `removed_at timestamptz null`;
    - `fk (workspace_id,person_id) → people`;
    - an index `check_ins_day(workspace_id,season,check_in_date)`.
  - **Its checks:**
    - `check_ins_out_after_in`: `checked_out_at is null or checked_out_at > checked_in_at`;
    - `check_ins_on_date`: `(checked_in_at at time zone 'America/New_York')::date = check_in_date`, and `checked_out_at is null or checked_out_at <= ((check_in_date + 1)::timestamp at time zone 'America/New_York')`.
  - **`vitally_private.check_in_day_end(p_workspace_id uuid, p_person_id uuid, p_date date) returns timestamptz`** (null for no end): the latest live shift `end_hour` that day for the person, else the weekday's `schedule_settings.site_hours->>(isodow)` close, else null. The instant is `(p_date + make_interval(hours => h))::timestamp at time zone 'America/New_York'`.
  - **`vitally_private.check_in_span(p_check_in public.check_ins, p_now timestamptz) returns table(state text, ends_at timestamptz, minutes int)`**, with these rules:
    ```
    state  = 'out'    if checked_out_at is not null
           = 'open'   if check_in_date = (p_now at time zone NY)::date
           = 'missed' otherwise
    end    = checked_out_at                       (out)
           = least(p_now, day_end)                (open; day_end null -> checked_in_at)
           = day_end                              (missed; null -> checked_in_at)
    if end < checked_in_at then end = checked_in_at
    minutes = floor(extract(epoch from end - checked_in_at) / 60)
    ```
  - **The policy `check_ins_read`**, for select to authenticated: `vitally_policy.is_workspace_admin(workspace_id)`, or `person_id` is the caller's person in that workspace. There is a SELECT grant to `authenticated` and no insert, update or delete grant.
  - `check_ins` is in `supabase_realtime`.

- [ ] **Step 1: Confirm the migration number.** Run `git fetch origin && git ls-tree --name-only origin/main supabase/migrations/ | tail -3`, then `gh pr list --state open --json headRefName,files --jq '.[] | select(.files[].path | startswith("supabase/migrations/")) | .headRefName'`. Expected: the highest number on main plus this branch's 058 leaves 059 free. If not, use the next free number everywhere in this plan and note it in design.md's Open Questions.
- [ ] **Step 2: Write the failing database tests** in `tests/database-check-in.mjs`, following `tests/database-schedule.mjs`:
  - **The harness:** `createDatabaseFixture`, the `one` and `rpc` helpers, and the fixture's people (a site coordinator, a cleared preparer and a client).
  - Insert rows directly as the superuser through `f.sql`, for this task only.
  - Name each test case `t.test("<name>", …)`:
    - `table: out must be after in`: inserting out = in rejects.
    - `table: a check-out after the following midnight is refused`.
    - `table: check_in_date must be the NY date of checked_in_at`: inserting `2027-02-06 03:00Z` with date `2027-02-06` rejects, because it is the evening of 2027-02-05 in NY.
    - `rls: an admin reads every row, a preparer only their own, a client none`.
    - `rls: no direct insert, update or delete`, for an admin and a preparer.
    - `realtime: check_ins is in supabase_realtime`: the row exists in `pg_publication_tables`.
    - **The span** (call `vitally_private.check_in_span(row, p_now)` through `f.sql`, using site hours Sat 10–16 and Tue 17–20, saved with `vitally_save_schedule_settings` as the site coordinator):
      - `span: missed with a shift`: shift 10–13 on Sat 2027-02-06, in 09:55, no out, `p_now` = Sun noon. Expect `('missed', 13:00 NY, 185)`.
      - `span: missed with no shift`: Tue 2027-02-09, in 17:30, no shift, `p_now` = Wed. Expect `ends_at` 20:00 and 150 minutes.
      - `span: check-in after the shift ended`: shift 10–13, in 14:10, missed. Expect 0 minutes, `ends_at` = `checked_in_at`, state `missed`.
      - `span: closed day no shift`: a Monday. Expect 0 minutes.
      - `span: open and capped`: shift 17–20 on a Tuesday, in 17:00, `p_now` 21:30 the same day. Expect `('open', 20:00, 180)`.
      - `span: staying late`: out 20:40. Expect `('out', 20:40, 220)`.
      - `span: 11:58 pm and 24:00`: in 23:58, out `(date+1) 00:00 NY`. Expect `('out', …, 2)`.
      - `span: open becomes missed after midnight`: the open row from "open and capped" with `p_now` at the next day's 00:01. Expect state `missed`.
      - `span: DST Sunday`: Sun 2027-03-14, out set 10:00–13:00 NY. Expect 180.
      - `span: a removed shift does not set the end`.
- [ ] **Step 3: Run the tests and see them fail.** Run `npm run db:migrate:test && node --env-file=.env.test --test tests/database-check-in.mjs`. Expected: FAIL, because `relation "public.check_ins" does not exist`.
- [ ] **Step 4: Write the migration's §1 (table), §2 (day end and span), §3 (policy and grants) and §4 (publication).** Use 058's DO block shape for the publication, and a header comment listing the sections like 058's.
- [ ] **Step 5: Run the tests and see them pass.** Run the same command. Expected: PASS, all cases.
- [ ] **Step 6: Commit.**
  ```bash
  git add supabase/migrations/060_volunteer_check_in.sql tests/database-check-in.mjs
  git commit -m "Check-ins: table, counted span, RLS and realtime (#257)"
  ```

### Task 2: Migration, the self check-in RPCs

**Files:**
- Modify: `supabase/migrations/060_volunteer_check_in.sql` (add §5)
- Modify: `tests/database-check-in.mjs`
- Modify: `tests/support/rpc-signatures.mjs`, `tests/database-catalog.mjs` (the new functions)

**Interfaces:**
- Consumes: Task 1's table and `check_in_span`. The 052 helpers: `vitally_private.cleared(ws, person)` and the caller and person lookup used by `vitally_my_shifts` in 058 :654. The receipts table and the advisory-lock call used by `vitally_save_shift` in 058 :341.
- Produces:
  - `public.vitally_my_check_in() returns jsonb`: `{today: 'YYYY-MM-DD', canCheckIn: bool, open: {checkInId, checkedInAt} | null}`.
  - `public.vitally_check_in(p_action_id uuid) returns jsonb`: `{open: {checkInId, checkedInAt}}`.
  - `public.vitally_check_out(p_action_id uuid) returns jsonb`: `{checkInId, checkedInAt, checkedOutAt}`.
  - Refusals: `FORBIDDEN`, `NOT_CLEARED`, and `VALIDATION` with the reasons `ALREADY_CHECKED_IN` and `NOT_CHECKED_IN`, raised the way 058 raises its reasons.
  - `canCheckIn` means cleared **and** a current-season roster entry. The same condition gates `NOT_CLEARED`.

- [ ] **Step 1: Write the failing tests.** Each RPC call is made as the signed-in person through the fixture's clients:
  - `check in: a cleared preparer checks in`: then `vitally_my_check_in().open.checkInId` equals the new id and `canCheckIn` is true.
  - `check in: not cleared`: a rostered staff member with no roles. Expect `NOT_CLEARED`, zero `check_ins` rows, and zero receipts with that action id.
  - `check in: forbidden for a client, and for an invited account`.
  - `check in: replay`: the same action id twice gives deep-equal answers and one row.
  - `check in: already checked in`: a new action id while open. Expect `VALIDATION` / `ALREADY_CHECKED_IN`.
  - `check out: closes the open one`: `checked_out_at` is set, the revision is 2, and `corrected_by_person_id` is null.
  - `check out: nothing open`. Expect `NOT_CHECKED_IN`.
  - `my check-in: yesterday's open row is not open`: insert a row dated yesterday with no out. `open` is null, and `vitally_check_in` then succeeds.
  - `my check-in: not gated by clearance`: an uncleared staff member gets `canCheckIn: false`, with no error.
  - Add the three signatures to `tests/support/rpc-signatures.mjs` and `tests/database-catalog.mjs`, as for `vitally_my_shifts`.
- [ ] **Step 2: Run the tests and see them fail.** Run `npm run db:migrate:test && node --env-file=.env.test --test tests/database-check-in.mjs tests/database-catalog.mjs`. Expected: FAIL, because the functions do not exist.
- [ ] **Step 3: Write §5.** It holds the three `security definer` functions with `set search_path`, as in 058. Each takes the workspace lock before the receipt and the open-row check. Grant execute to `authenticated` only.
- [ ] **Step 4: Run the tests and see them pass.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Check-ins: self check in and out RPCs (#257)"`.

### Task 3: Migration, admin corrections, the day read and the hours

**Files:**
- Modify: `supabase/migrations/060_volunteer_check_in.sql` (add §6 to §8)
- Modify: `tests/database-check-in.mjs`, `tests/support/rpc-signatures.mjs`, `tests/database-catalog.mjs`

**Interfaces:**
- Consumes: Task 1 and Task 2. 058's `vitally_schedule_day` body, `shift_flags`, `ny_week` and the shift-save helpers for roster and deactivated checks.
- Produces:
  - **`public.vitally_save_check_in(p_action_id uuid, p_check_in_id uuid, p_expected_revision bigint, p_check_in jsonb) returns jsonb`**:
    - `p_check_in` is `{volunteerId?, date?, checkedIn: 'HH:MM', checkedOut: 'HH:MM'|null}`, where `'24:00'` is allowed for `checkedOut` only.
    - It returns the saved check-in as one `checkIns` item (below).
  - **`public.vitally_remove_check_in(p_action_id uuid, p_check_in_id uuid, p_expected_revision bigint) returns jsonb`**: `{checkInId, revision}`.
  - **Reasons:** `NOT_ON_ROSTER`, `DEACTIVATED`, `OUT_BEFORE_IN`, `IN_FUTURE`, `OVERLAP`. Shape errors (a bad `HH:MM`, a missing field, mismatched ids and revision) are `VALIDATION` with the reason 058 uses for shape.
  - **`public.vitally_schedule_day(p_date date)`**, replaced. 058's answer is unchanged, plus, for workspace admins only, `checkIns: [...]`. Each item is `{checkInId, revision, volunteerId, name, checkedInAt, checkedOutAt, endsAt, state, minutes, flags: {noCheckOut, notScheduled, corrected, outsideSiteHours}, correctedByName}`, ordered by `checkedInAt`.
  - **`public.vitally_hours_this_week() returns jsonb`**: `{weekStart, weekEnd, hours: [{volunteerId, minutes}]}`, workspace admins only, otherwise `FORBIDDEN`.
  - **`outsideSiteHours`** is true when the weekday is closed, `checkedInAt` is before the open hour, or `endsAt` is after the close hour.

- [ ] **Step 1: Write the failing tests:**
  - **Saves:**
    - `save: fixing a missed check-out`: out 12:30. Expect state `out`, `corrected_by_person_id` = the admin, and minutes to 12:30.
    - `save: reopening today`: `checkedOut: null` on today's row gives state `open`.
    - `save: add yesterday 10:00–13:00`: 180 minutes and `flags.corrected`.
    - `save: out before in`, which gives `OUT_BEFORE_IN`.
    - `save: future`: today with out after now gives `IN_FUTURE`. Compute "now" in the test, and pick a date and time relative to it.
    - `save: overlap and meeting spans`: 10–12 exists. 11:30–13:00 gives `OVERLAP`, and 12:00–13:00 is saved.
    - `save: overlap uses the derived end`: a missed row with shift end 13:00. 12:00–14:00 gives `OVERLAP`, and 13:00–14:00 is saved.
    - `save: outside site hours and no sign-in are allowed`.
    - `save: forbidden for a preparer, no receipt`.
    - `save: stale revision is CONFLICT`.
    - `save: replay returns the stored answer`.
    - `save: an edit keeps person and date`: a different `volunteerId` or `date` in an edit is ignored or refused. Pick refusal, with the `VALIDATION` shape reason, and assert it.
    - `save: 24:00 is out-only`: `checkedIn: '24:00'` is refused.
  - **Removal:**
    - `remove: soft delete and later change refused`: `removed_at` is set and the revision raised. A later save on it is refused with the reason 058 uses for a removed shift. It is gone from the day read and the hours.
  - **The day read:**
    - `day: admin gets checkIns with flags`: an unscheduled check-in has `notScheduled`, a missed one `noCheckOut`, and a closed Monday `outsideSiteHours`.
    - `day: non-admin answer is unchanged`: a preparer's `vitally_schedule_day` has no `checkIns` key, and is deep-equal to the answer before the check-ins were inserted.
  - **The hours:**
    - `hours: 6.5 hours`: Tue 17:00–20:00 and Sat 09:52–13:22 this week give 390 minutes. Next Monday's row is excluded. Build the dates from `ny_week(now())` in SQL.
    - `hours: forbidden for a preparer`.
  - Add the four signatures to `rpc-signatures.mjs` and `database-catalog.mjs`.
- [ ] **Step 2: Run the tests and see them fail.** Run `npm run db:migrate:test && node --env-file=.env.test --test tests/database-check-in.mjs tests/database-schedule.mjs tests/database-catalog.mjs`. Expected: the new cases FAIL, and `database-schedule.mjs` passes.
- [ ] **Step 3: Write the functions:**
  - **§6** holds `vitally_save_check_in` and `vitally_remove_check_in`. Convert `HH:MM` as `(date + time 'HH:MM')::timestamp at time zone 'America/New_York'`, and `'24:00'` as `(date+1)::timestamp at time zone …`. Check overlap under the lock against the person's other live rows that day, with spans `[checked_in_at, check_in_span(...).ends_at)`.
  - **§7** replaces `vitally_schedule_day`: copy 058's body verbatim and add the admin-only `checkIns` block, each added line marked `-- 060`.
  - **§8** holds `vitally_hours_this_week`.
- [ ] **Step 4: Run the tests and see them pass.** Run the same command. Expected: PASS, with `database-schedule.mjs` unchanged and passing.
- [ ] **Step 5: Run the whole database suite.** Run `npm run test:database`. Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "Check-ins: admin corrections, the day read and hours this week (#257)"`.

### Task 4: The store and the pure helpers

**Files:**
- Create: `src/volunteer-check-in.mjs`
- Create: `tests/volunteer-check-in.test.mjs`
- Modify: `src/supabase-store.mjs`, at :34 (`STAFF_TABLES`) and :1002–1050 (the schedule RPC block)
- Modify: `src/errors.mjs`, if refusal reasons are mapped there. Follow how `OUTSIDE_SITE_HOURS` is mapped, and the same for its test.
- Test: `tests/supabase-store.test.mjs`, if one exists for the RPC wrappers. Otherwise, the wrappers are covered by the controller tests in Tasks 5 and 6.

**Interfaces:**
- Produces:
  - **Store methods:**
    - `store.myCheckIn()` calls `vitally_my_check_in`;
    - `store.checkIn({actionId})` and `store.checkOut({actionId})`;
    - `store.saveCheckIn({actionId, checkInId, revision, checkIn})` and `store.removeCheckIn({actionId, checkInId, revision})`;
    - `store.hoursThisWeek()`;
    - `"check_ins"` appended to `STAFF_TABLES`;
    - `store.weekShifts` deleted if `grep -rn weekShifts src tests` shows only Task 7's caller.
  - **`src/volunteer-check-in.mjs` exports:**
    - `timeLabel(iso: string) -> string`: the New York time as "9:52 am" or "12:00 pm" (lowercase, no leading zero).
    - `barLabel(checkIn) -> string`: "9:52 am – 1:10 pm" | "9:52 am – now" | "9:52 am – no check-out", by `state`.
    - `barPlacement(checkIn, hours: {open, close}) -> {left: number, width: number} | null`: percentages of the open span, cut off to [0,100]. It is null when the bar lies wholly outside.
    - `timeOptions(saved: 'HH:MM' | null, {allow24 = false}) -> string[]`: `"00:00"`…`"23:55"` in 5-minute steps (plus `"24:00"` when allowed), with `saved` inserted in order when it is off-step.
    - `hhmm(iso) -> 'HH:MM'`: the New York wall time.
    - `missedNote(checkIn) -> string`: "No check-out. Counted to 1 pm." (the end through `timeLabel`, with ":00" dropped).
    - `formatHours(minutes: number) -> string`: one decimal, half up, whole numbers bare.
    - `checkInTags(flags) -> string[]`, in the order "No check-out", "Not scheduled", "Corrected", "Outside site hours".

- [ ] **Step 1: Write the failing unit tests** in `tests/volunteer-check-in.test.mjs`:
  - `timeLabel("2027-02-06T14:52:00Z") === "9:52 am"` (EST), and a July instant uses EDT.
  - `barLabel({state:"open", checkedInAt}) === "9:52 am – now"`, with the `out` and `missed` forms too.
  - `barPlacement` for 10:30–12:00 in hours {10,16} is `{left: 8.333…, width: 25}` (compare rounded to 3 places). One from 09:00 to 11:00 is cut to `{left: 0, width: 16.667}`. One wholly at 17:00–18:00 is `null`.
  - `timeOptions("09:52")` includes `"09:50"`, `"09:52"` and `"09:55"`, in that order. `timeOptions(null).length === 288`. `timeOptions(null, {allow24: true}).at(-1) === "24:00"`.
  - `missedNote({endsAt: 13:00 NY}) === "No check-out. Counted to 1 pm."`
  - `formatHours`: 390 is `"6.5"`, 420 is `"7"`, 0 is `"0"`, 393 is `"6.6"` (6.55, half up), 392 is `"6.5"`.
  - `checkInTags({corrected:true, noCheckOut:true})` is `["No check-out","Corrected"]`.
  - In `tests/supabase-store.test.mjs`, if present: `STAFF_TABLES` includes `"check_ins"`, and `saveCheckIn` sends `p_check_in_id`, `p_expected_revision` and `p_check_in`.
- [ ] **Step 2: Run the tests and see them fail.** Run `node --test tests/volunteer-check-in.test.mjs`. Expected: FAIL, because the module is not found.
- [ ] **Step 3: Implement the module and the store methods.** Format New York time with `Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', …})`, as `src/volunteer-schedule.mjs` does.
- [ ] **Step 4: Run the tests and see them pass.** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Check-ins: store calls and pure helpers (#257)"`.

### Task 5: The strip

**Files:**
- Modify: `src/views.mjs:146` (`appShell` gains `strip = ""`, rendered as the first child of `.app-main`), and where the staff screens call `appShell` (pass `checkInStrip(state)`)
- Modify: `src/controller.mjs`: state `checkIn: {loaded, canCheckIn, open, busy}`, and the functions below
- Modify: `src/app.mjs`: actions `check-in` and `check-out`, plus focus and restore hooks next to the existing clearance re-read
- Modify: `src/styles.css`
- Test: `tests/controller.test.mjs`, and `tests/views.test.mjs` (or the test file that covers `appShell`; find it with `grep -ln appShell tests`)

**Interfaces:**
- Consumes: `store.myCheckIn`, `checkIn`, `checkOut` (Task 4) and `timeLabel` (Task 4).
- Produces:
  - `checkInStrip(state) -> string` in `src/views.mjs`. It renders `<div class="check-in-strip">…</div>`, or `""` when the window is not cleared, the screen is setup, or `!state.checkIn.canCheckIn`. Its buttons are `data-action="check-in"` and `data-action="check-out"`.
  - In the controller: `readMyCheckIn()`, `checkIn()` and `checkOut()`. Each write uses `newActionId()`, sets `busy`, and on `VALIDATION` with `ALREADY_CHECKED_IN` or `NOT_CHECKED_IN` calls `readMyCheckIn()` with no `noteFailure`.
  - The realtime routing: a `check_ins` change whose `person_id` is the caller's re-reads the strip.

- [ ] **Step 1: Write the failing tests:**
  - `strip: cleared preparer sees Check in`: the rendered HTML contains `data-action="check-in"` and the text "Check in".
  - `strip: open shows since and Check out`: `open.checkedInAt` = 9:52 am NY renders "Checked in since 9:52 am" and `data-action="check-out"`.
  - `strip: absent when not cleared, on setup, for clients, and when canCheckIn is false`.
  - `strip: is inside .app-main and outside the sidebar`, and is present with `open: false` (sidebar collapsed).
  - `strip: check in sends one action id and is busy until the answer`: a fake store records calls. A second call while busy sends nothing.
  - `strip: ALREADY_CHECKED_IN re-reads quietly`: the fake `checkIn` rejects with `{code:"VALIDATION", reason:"ALREADY_CHECKED_IN"}`. `myCheckIn` is called again, and `state.error` stays null. Do the same for `NOT_CHECKED_IN` on check out.
  - `strip: own check_ins change re-reads, another person's does not`.
  - `strip: focus re-reads`, and `strip: a clearance change re-reads`.
- [ ] **Step 2: Run the tests and see them fail.** Run `node --test tests/controller.test.mjs`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement it:**
  - `appShell` takes `strip`.
  - The controller holds the state and the actions, and reads on sign-in and restore where the clearance read happens.
  - CSS for `.check-in-strip`: a flex row with `flex-wrap: wrap`, `gap`, and `max-width: 100%`, and its button at `min-height: 44px`.
- [ ] **Step 4: Run the tests and see them pass.** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Check-ins: the check-in strip on staff screens (#257)"`.

### Task 6: Check-ins on the admin Schedule

**Files:**
- Modify: `src/schedule-views.mjs`:
  - `scheduleScreen` (:127): the rows, bars, closed-day list and "+ Add check-in";
  - new `checkInDrawer(state)` and `removeCheckInDialogBody(state)`, next to `shiftDrawer` (:183) and `removeShiftDialogBody` (:239).
- Modify: `src/volunteer-schedule.mjs:128`. `scheduleRows(shifts)` becomes `scheduleRows(shifts, checkIns = [])`, returning a row per volunteer with either, ordered by name.
- Modify: `src/views.mjs:56` (the imports and the dialog registry, as for the shift drawer)
- Modify: `src/controller.mjs`, next to `saveShift` (:1949):
  - `openCheckIn(id)`, `openAddCheckIn()`, `saveCheckIn(values)` and `removeCheckIn()`;
  - the CONFLICT message;
  - a `check_ins` change re-reads the day when `state.schedule.day?.canEdit`.
- Modify: `src/app.mjs`: actions `open-check-in`, `add-check-in`, `save-check-in` and `remove-check-in`, and the form values helper, as for `saveShiftFromDrawer` (:1149).
- Modify: `src/styles.css` (`.check-in-bar` and its tags)
- Test: `tests/schedule-views.test.mjs`, `tests/controller.test.mjs`, `tests/volunteer-schedule.test.mjs` (if present)

**Interfaces:**
- Consumes: the day read's `checkIns` (Task 3), `store.saveCheckIn` and `removeCheckIn` (Task 4), and `barLabel`, `barPlacement`, `checkInTags`, `timeOptions`, `hhmm` and `missedNote` (Task 4).
- Produces:
  - **The drawer state** `state.schedule.checkInDrawer`: `{mode: "add"|"edit", checkInId, revision, volunteerId, checkedIn: 'HH:MM', checkedOut: 'HH:MM'|null}`.
  - **The save** sends `checkIn: {volunteerId, date, checkedIn, checkedOut}` on an add, and `{checkedIn, checkedOut}` on an edit. The fields come from the drawer as they are, so an unchanged off-step time is sent as it was read.

- [ ] **Step 1: Write the failing tests:**
  - **The admin day view:**
    - `schedule: admin bar under its shift`: a shift 10–13 and a check-in 09:52–13:10 (out). The row has one `.check-in-bar` labelled "9:52 am – 1:10 pm" with no tags. Its style left is 0, because it is cut off at 10.
    - `schedule: unscheduled row`: a check-in with no shift creates a row with "11:00 am – now" and the tag "Not scheduled".
    - `schedule: missed`: the label is "10:05 am – no check-out", with the tag "No check-out".
    - `schedule: closed day lists check-ins for admins`: the "The site is closed on Mondays." text plus a list item with the tags "Not scheduled" and "Outside site hours".
    - `schedule: each bar is a button with data-action="open-check-in"`.
  - **The buttons:**
    - `schedule: Add check-in on today and past, not future`: compare `state.schedule.date` with the New York today.
  - **The read-only Schedule:**
    - `schedule: read-only has no check-ins`: the answer has `canEdit: false`. There is no `.check-in-bar`, no "Add check-in", and no unscheduled row, even if `checkIns` were present.
  - **The drawer:**
    - `drawer: corrected and missed notes`: "Corrected by Sam Lee" and "No check-out. Counted to 1 pm." (fictional names).
    - `drawer keeps 9:52 when only out changes`: open 09:52–13:10, set out to 13:30, and save. The fake store gets `checkedIn: "09:52"`.
    - `drawer: Checked out may be empty`, which sends `checkedOut: null`.
  - **The controller:**
    - `remove check-in asks first`: the dialog body says "Remove Ari Moss's check-in?" (fictional).
    - `conflict re-reads and says the check-in message`.
    - `a check_ins change re-reads an admin's day, not a read-only one`.
- [ ] **Step 2: Run the tests and see them fail.** Run `node --test tests/schedule-views.test.mjs tests/controller.test.mjs`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement it.** A bar is absolutely positioned inside its row's grid cell span, using `barPlacement` percentages. It sits below the row's shift blocks, so it does not take part in the drag hit areas. Check that `src/schedule-drag.mjs` ignores `.check-in-bar` targets, and add a test in `tests/schedule-drag.test.mjs` if it does not.
- [ ] **Step 4: Run the tests and see them pass.** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Check-ins: bars, Add check-in and the drawer on the Schedule (#257)"`.

### Task 7: Workload hours from check-ins

**Files:**
- Modify: `src/controller.mjs:1498` (`readWorkloadHours`) and :1284 (`touchesHours`)
- Modify: `src/volunteer-workload.mjs:64` (`weekHours`) and `workloadRows`
- Modify: `src/workload-views.mjs:51` (the cell format)
- Test: `tests/volunteer-workload.test.mjs`, `tests/workload-views.test.mjs` and `tests/controller.test.mjs` (the existing hours tests change from shifts to minutes)

**Interfaces:**
- Consumes: `store.hoursThisWeek()` and `formatHours` (Task 4).
- Produces:
  - `state.weekHours: [{volunteerId, minutes}]` replaces `state.weekShifts`.
  - `weekMinutes(hours, personId) -> number` replaces `weekHours(shifts, personId, week)`.
  - `workloadRows({..., hours = []})` takes `hours`, and each row has `minutes`. The sort key `hours` sorts by `minutes`.

- [ ] **Step 1: Update and add the failing tests:**
  - `workload: hours from minutes`: 390 minutes renders "6.5", and a volunteer with none renders "0".
  - `workload: sort by hours uses minutes`: 540, 360 and 0 sort descending, then reversed.
  - `workload: re-reads on check_ins, shifts and schedule_settings changes`.
  - Delete the tests that assert sums of `end_hour − start_hour`.
- [ ] **Step 2: Run the tests and see them fail.** Run `node --test tests/volunteer-workload.test.mjs tests/workload-views.test.mjs tests/controller.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement it.** Remove `store.weekShifts` and its test if nothing else uses it (`grep -rn weekShifts src tests tools`).
- [ ] **Step 4: Run the tests and see them pass.** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Workload: Hours this week from check-ins (#257)"`.

### Task 8: The seed

**Files:**
- Modify: `tools/admin/seed-cases.mjs`, where the shifts are seeded (`grep -n vitally_save_shift tools/admin/seed-cases.mjs`)
- Test: `tests/database-seed.mjs`

**Interfaces:**
- Consumes: `vitally_save_check_in` and `vitally_remove_check_in` (Task 3).
- Produces: a run-file key `checkInIds: string[]` next to the seeded shift ids.

- [ ] **Step 1: Write the failing tests** in `tests/database-seed.mjs`:
  - `seed: adds check-ins on recent open days`: at least 3 live check-ins dated before today, all with `corrected_by_person_id` set. At least one has `checked_out_at is null`. At least one belongs to a role account with no live shift that day.
  - `seed: re-run replaces only its own check-ins`: an admin adds one check-in between runs, and after the re-run it is still live, with one seeded set.
  - `seed: the story's seed adds no check-ins`: the story's seed entry point leaves `check_ins` empty.
- [ ] **Step 2: Run the tests and see them fail.** Run `node --env-file=.env.test --test tests/database-seed.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - Find the most recent open weekdays before the New York today from the saved site hours, and use the seeded shifts on those days.
  - Seed about four check-ins:
    - two matching shifts (in 5–10 minutes before the start, out at the end or a little after);
    - one matching a shift with no check-out;
    - one for the `reviewer` role account with no shift that day, inside the open hours.
  - All of them go through `vitally_save_check_in` as the Site Coordinator.
  - On a re-run, remove the ids in `checkInIds` through `vitally_remove_check_in`, before the shifts are removed.
- [ ] **Step 4: Run the tests and see them pass.** Expected: PASS. Then run `npm test`, for `tests/seed.test.mjs`.
- [ ] **Step 5: Commit** `git commit -m "Seed: fictional check-ins (#257)"`.

### Task 9: The browser story, docs and final checks

**Files:**
- Modify: `tests/browser.mjs`, the schedule walk (`grep -n "Schedule" tests/browser.mjs`)
- Modify: `docs/developer/database.md` (the table, the six RPCs, the realtime table, the migration row), the frontend notes in `docs/developer/` that describe the Schedule (`grep -rln "Add shift" docs/developer`), `docs/setup.md`'s migration table if it lists 058, and the README counts if they list tables or RPCs

- [ ] **Step 1: Extend the story**, right after the existing schedule walk and reusing its windows:
  1. Set the preparer window's viewport to 390×844. Press "Check in", and assert the strip text starts with "Checked in since". Assert `document.documentElement.scrollWidth <= innerWidth`.
  2. In the site coordinator's window on today's Schedule, wait for a `.check-in-bar` tagged "Not scheduled" in the preparer's row. The story makes no preparer shift today, or else asserts the bar without that tag. Press it, set "Checked in" one 5-minute step earlier, and Save. Assert the tag "Corrected".
  3. In the preparer window, press "Check out", and assert "Check in" is back.
  4. Open the Workload in the coordinator window (it is a cleared admin in the story). Assert the preparer's Hours this week matches `/^\d+(\.\d)?$/`.

  Restore the preparer viewport afterwards.
- [ ] **Step 2: Run the story.** Run `npm run test:browser`. Expected: PASS on both legs. Review the screenshots of the strip at 390 px and of the bars.
- [ ] **Step 3: Update the docs** listed above, with the counts re-derived from the migrated database (`select count(*) from pg_proc …`, as group 8.7 of add-volunteer-schedule did).
- [ ] **Step 4: Run the final checks:**
  - `git fetch origin && git merge origin/main` if main moved. Stop and ask the user on any conflict under `openspec/specs/`.
  - `npm test`;
  - `npm run db:migrate:test`, then `npm run test:database`, on a stack that already has 058;
  - `npm run test:browser`;
  - `npx openspec validate --all`.

  Expected: all PASS.
- [ ] **Step 5: Commit** `git commit -m "Check-ins: browser walk and docs (#257)"`, and tick `tasks.md` 6.1–6.3.

### Task 10: Final-review fixes (added 2026-11-23)

**Files:**
- Modify: `supabase/migrations/060_volunteer_check_in.sql`. Change the OVERLAP check in `vitally_save_check_in` and the header comments. 060 is applied nowhere shared, so edit it in place, then reset it on the local stack: drop its objects and delete its `vitally_private.schema_migrations` row, then run `npm run db:migrate:test`. The stack's stored digest is already stale (a CRLF copy), so this reset also clears that.
- Modify: `tests/database-check-in.mjs`.
- Modify: `src/schedule-views.mjs`, the Checked out options; `src/controller.mjs`, the `state.weekHours` comment; `docs/developer/frontend.md`, the 24:00 line.
- Test: `tests/schedule-views.test.mjs`.

**Interfaces:** none change. The OVERLAP reason and shape are as before.

- [ ] **Step 1: Write the failing database tests.**
  - `save: adding beside an open check-in`: today, open since 10:00 with a shift ending 13:00, and `now()` after 14:30. Add 14:00–14:30. Expect `OVERLAP`, and one open row remains. Derive the times from `now()` so the test holds at any hour; if it is too early in the day for the layout, shift the times earlier.
  - `save: reopening before a later check-in`: today has 10:00–12:00 and 13:00–14:00 (both past). Clear the first one's out. Expect `OVERLAP`, and the row is unchanged.
  - Keep `save: overlap uses the derived end` (a missed row from an earlier date) passing unchanged.
- [ ] **Step 2: Run them and see them fail:** `node --env-file=.env.test --test tests/database-check-in.mjs`.
- [ ] **Step 3: Implement it.** In the OVERLAP query, the other rows' end, and the saved row's own end, is `'infinity'` when `check_in_date` is the New York today and `checked_out_at` is null. Otherwise it stays `check_in_span(...).ends_at`. Fix the header comments' design refs.
- [ ] **Step 4: Write a failing view test:** the Checked out select has exactly one option labelled "12:00 am (midnight)", with value `24:00`, and no `00:00` option. Then implement it, and correct the `frontend.md` line and the controller comment.
- [ ] **Step 5: Run** `npm test` and `npm run test:database`, ignoring only the known `database-accounts-function.mjs` edge-runtime baseline. Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "Check-ins: an open check-in today blocks overlapping corrections; review minors (#257)"`, and tick `tasks.md` 7.1–7.2.

---

**Task to tasks.md map:**

| Plan task | tasks.md |
|---|---|
| 1 | 1.1–1.6 |
| 2 | 2.1, plus part of 2.5 and 2.6 |
| 3 | 2.2–2.6 |
| 4 | 3.1–3.2 |
| 5 | 4.1, 4.2 and the strip half of 4.6 |
| 6 | 4.3, 4.4 and the Schedule half of 4.6 |
| 7 | 4.5 and the Workload half of 4.6 |
| 8 | 5.1 |
| 9 | 6.1–6.3 |
| 10 | 7.1–7.2 (then re-run 6.3) |

Tick each tasks.md box when its plan task is committed.
