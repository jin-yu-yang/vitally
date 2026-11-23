## Context

Issue #257 asks ViTally to record when volunteers actually work. The decision
log is in `brainstorm.md`.

This change builds on #140 (`add-volunteer-schedule`, PR #271, archived on
this branch and not yet merged to `main`).

**What the code gives us** (read during propose, 2026-11-22, branch at
a4ec880):

*Schedule tables (`058_volunteer_schedule.sql`):*
- `public.shifts` holds whole hours, one role, one date and the current
  season. Removal sets `removed_at` and raises the revision.
- `public.schedule_settings` holds the site hours (`site_hours` jsonb keyed
  `"1"`…`"7"`, `{open, close}`) and the coverage targets.
- Both are in `supabase_realtime`, and both are written only through RPCs.

*Schedule helpers and reads:*
- `vitally_private.schedule_viewer` and `vitally_policy.is_schedule_viewer`.
- `vitally_private.shift_flags` and `shift_counts`.
- `vitally_private.ny_week` (the Monday-to-Sunday week holding a moment, in
  New York).
- `public.vitally_schedule_day(p_date)`: the day read. It gives admins flags,
  counts and candidates. Others get names, roles and hours, without
  no-sign-in volunteers.

*Policy helpers:*
- `vitally_policy.is_workspace_admin` (052): a site coordinator, or the Admin
  role this season, with no clearance needed.
- `vitally_private.cleared(workspace, person)` (052).

*Workload hours:*
- The Workload's Hours this week is computed in the browser.
  `readWorkloadHours` (`src/controller.mjs`) calls `store.weekShifts`, and
  `weekHours` (`src/volunteer-workload.mjs`) sums `end_hour − start_hour`.
- It re-reads on a `shifts` change.

*Front end and tools:*
- `STAFF_TABLES` in `src/supabase-store.mjs` lists what a staff window
  subscribes to. The store watches INSERT and UPDATE only.
- The staff shell (`src/views.mjs`) has a collapsible sidebar and no top bar.
  On a phone the sidebar is usually collapsed.
- `seed:local` (`tools/admin/seed-cases.mjs`) acts only through public RPCs,
  as the Site Coordinator and the role accounts.

**Constraints:**
- Fictional data only.
- Migrations are final once applied. This is a new migration, expected
  `059`, and 058 is not edited, even though it has not reached `main`.
- Staff screens are English. There is no client text.
- America/New_York throughout.
- The browser story's legs run near their time limit, so the check-in walk
  must be short.

## Goals / Non-Goals

**Goals:**
- A cleared volunteer checks in and out with one tap, from any staff screen,
  on a phone.
- Hours this week reflects time actually worked, including a sensible figure
  when someone forgets to check out.
- An admin sees, on the day they schedule, who came, who forgot to check out
  and who came unscheduled, and can fix it without leaving the Schedule.
- One SQL definition of a check-in's counted minutes, so #141 can reuse it.

**Non-Goals:**
- A volunteer's own check-in history.
- #141's season hours.
- Admin-side phone layouts (#147).
- Coverage based on check-ins. Coverage stays on shifts.
- Keeping a volunteer's original times after a correction.
- Check-in for uncleared staff.
- Notifications or reminders to check out.
- Geofencing or kiosk mode.

## Decisions

### D1: Storage, `public.check_ins`

- **Choice:**
  - **Columns:** `id uuid`, `workspace_id`, `season smallint`, `person_id`,
    `check_in_date date` (the New York date of `checked_in_at`),
    `checked_in_at timestamptz`, `checked_out_at timestamptz null`,
    `revision bigint`, `created_at`, `created_by_person_id`, `updated_at`,
    `updated_by_person_id`, `corrected_by_person_id uuid null`,
    `removed_at timestamptz null`.
  - **Checks:**
    - `checked_out_at > checked_in_at`;
    - both moments fall on `check_in_date` in New York. A check-out may be
      at most the following midnight.
  - **Keys:** a foreign key to `people(workspace_id,id)`, and an index on
    `(workspace_id, season, check_in_date)`.
  - **Removal:** sets `removed_at` and raises the revision, as for shifts.
  - **`corrected_by_person_id`:** set by every admin save, and never by the
    volunteer's own check-in or check-out. "Corrected" means it is not null.
- **Why:**
  - The same shape and soft delete as `shifts`, so the realtime and receipt
    patterns carry over. A removed row is still announced as an UPDATE.
  - Timestamps rather than hours, because times are exact (brainstorm Q3).
  - `check_in_date` is stored so day and week reads stay indexed and never
    depend on the server's time zone.
- **Alternatives considered:**
  - Hard delete: never announced to open windows.
  - A separate corrections log: not wanted (Q6.4).
  - A unique partial index for "one open check-in": a missed check-out from
    yesterday is also open, so the rule must look at the date. It is
    checked under the workspace lock instead.

### D2: The counted end is derived in SQL

- **Choice:** `vitally_private.check_in_span(p_check_in public.check_ins, p_now timestamptz)` returns `state`, `ends_at` and `minutes`.
  - **The day's end** is the latest `end_hour` of the person's live shifts on
    `check_in_date`, any role, flagged or not. With no shift, it is that
    weekday's site close hour. With neither, there is no end.
  - **The state:**
    - **`out`**: `checked_out_at` is set. `ends_at` is `checked_out_at`.
    - **`open`**: no check-out, and `check_in_date` is today in New York.
      `ends_at` is the earlier of `p_now` and the day's end. With no day's
      end, `ends_at` is `checked_in_at`.
    - **`missed`**: no check-out, and `check_in_date` is before today.
      `ends_at` is the day's end, or `checked_in_at` when there is none.
  - **The minutes:** `greatest(0, ends_at − checked_in_at)` in whole minutes,
    rounded down. An `ends_at` before `checked_in_at` counts 0 minutes, and
    `ends_at` is then reported as `checked_in_at`.
- **Why:**
  - Q4 decided "derived on read". One function serves the day read, the
    hours read and later #141.
  - `p_now` is a parameter so database tests can fix the clock.
- **Alternatives considered:**
  - Computing it in the browser: the Workload would also have to read site
    hours and every shift, and #141 would need a third copy.
  - Writing the derived check-out: rejected in Q4.

### D3: Who can check in, and the self RPCs

- **Choice:** three RPCs. Each answers only for the signed-in caller. Each
  refuses a client, an anonymous caller, a staff caller with no person row,
  and an `invited` account with `FORBIDDEN`.
  - **`vitally_my_check_in()`** returns `today`, `canCheckIn` and `open`.
    - `canCheckIn` is true when the caller is cleared
      (`vitally_private.cleared`) and has a current-season roster entry.
    - `open` is `{checkInId, checkedInAt}` for the caller's live check-in
      today with no check-out, otherwise null.
    - This read is not gated by clearance, so a window can learn it has no
      strip.
  - **`vitally_check_in(p_action_id)`**: a caller who is not cleared is
    refused with `NOT_CLEARED`, as the case RPCs refuse. A caller with an
    open check-in today is refused with `VALIDATION` `ALREADY_CHECKED_IN`.
    Otherwise it inserts a check-in at `now()` and returns `open`.
  - **`vitally_check_out(p_action_id)`**: a caller with no open check-in
    today is refused with `VALIDATION` `NOT_CHECKED_IN`. Otherwise it sets
    `checked_out_at = now()` and raises the revision.
  - **Order of checks:**
    1. FORBIDDEN or NOT_CLEARED, with nothing written and no receipt.
    2. The workspace advisory lock.
    3. The receipt (a replay returns the stored answer).
    4. The domain refusals.
  - **No revision is sent.** A self action has one actor, and the domain
    refusals already catch a stale strip, for example one checked out from
    the phone.
- **Why:**
  - Q1: cleared only.
  - A replayed tap (a double tap, a retry on a flaky phone network) must
    not create two check-ins.
- **Alternatives considered:**
  - Folding `canCheckIn` and `open` into `vitally_my_clearance`: that would
    replace it yet again, at the risk of dropping 057's fields.

### D4: Admin corrections

- **Choice:** both RPCs are for workspace admins (`is_workspace_admin`),
  cleared or not, and follow 058's shift order: FORBIDDEN, VALIDATION of
  shape, the lock, the receipt, CONFLICT on a stale revision, then domain
  refusals.
  - **`vitally_save_check_in(p_action_id, p_check_in_id, p_expected_revision, p_check_in jsonb)`**:
    - It adds a check-in when both ids are null, and edits one when both are
      present.
    - `p_check_in` holds `volunteerId` and `date` (add only; an edit keeps
      both), `checkedIn` as `"HH:MM"` and `checkedOut` as `"HH:MM"` or null.
      The times are New York times on that date, and `"24:00"` is allowed
      for a check-out only.
    - Every save sets `corrected_by_person_id` to the admin.
  - **`vitally_remove_check_in(p_action_id, p_check_in_id, p_expected_revision)`**
    soft-deletes.
  - **Refusals** are `VALIDATION` with a reason:
    - `NOT_ON_ROSTER` and `DEACTIVATED`, as for shifts;
    - `OUT_BEFORE_IN`: the check-out is not after the check-in;
    - `IN_FUTURE`: the check-in, or the check-out when given, is after
      `now()`;
    - `OVERLAP`: the span overlaps another live check-in of the person that
      day. Each check-in's span is from `checked_in_at` to its D2 `ends_at`,
      except that for this check a check-in dated today with no check-out
      runs on with no end, the one being saved included. Spans may meet.
      Why: an open row's capped end is only an estimate. A later row added
      after it would take the volunteer's next check-out, and the two would
      then overlap and double-count (final-review finding I1, decided by the
      user on 2026-11-23). The counted minutes (D2) are unchanged.
  - Times outside site hours, on a closed day, or with no shift are
    allowed.
  - **Who an admin can add for:** the Add shift candidates, including
    volunteers who are not cleared or have no sign-in. Clearance gates only
    self check-in (Q1). An admin's record of who was there is theirs to
    keep.
  - **5-minute steps:** the drawer offers times in 5-minute steps. A saved
    time that is not on a step (a volunteer's own 9:52) stays as it is
    unless the admin changes that field. The RPC checks only the `HH:MM`
    shape, so an unchanged odd minute is accepted.
- **Why:**
  - Q6.
  - The same rights and order as shifts, so the tests and the controller's
    refusal mapping carry over.
- **Alternatives considered:**
  - Refusing outside site hours: real arrivals don't follow the grid.
  - Admins editing the date: a wrong date is a remove plus an add.

### D5: Who reads check-ins

- **Choice:**
  - A SELECT policy on `check_ins` admits:
    - a workspace admin, for every row of the workspace;
    - the person, for their own rows.
  - No other staff member can read any check-in.
  - SELECT is granted for realtime and for the admin day read's joins. All
    writes go through the RPCs, and signed-in users have no direct write
    grant.
  - The read-only Schedule shows no check-ins.
- **Why:**
  - Q2: non-admins see no check-ins.
  - The person's own rows let realtime move the strip on their other
    devices.
- **Alternatives considered:** giving schedule viewers names and times: not
  wanted, because attendance is admin information.

### D6: The strip

- **Choice:**
  - **Where:** a slim bar at the top of the main area of the staff shell,
    above the page title, in every cleared staff window. It is outside the
    sidebar, so collapsing the sidebar never hides it.
  - **It reads:**
    - "Check in" (a button), with no open check-in;
    - "Checked in since 9:52 am" and a "Check out" button, with one.
  - **Who gets it:** it is absent when `canCheckIn` is false, in uncleared
    windows, on the setup screen and for clients.
  - **Taps:**
    - Check out asks nothing.
    - Each tap sends one action id, and the button is busy until the answer.
    - `ALREADY_CHECKED_IN` and `NOT_CHECKED_IN` re-read
      `vitally_my_check_in` and redraw with no error, because another
      device already did it.
  - **At phone width (390 px):** the bar fits on one line or wraps without
    sideways scroll, and its button is at least 44 px tall.
  - **When it re-reads:**
    - on sign-in and window restore;
    - on focus;
    - on a realtime `check_ins` change for the caller's own rows;
    - after a clearance re-read that changes `cleared`.
  - **Midnight:** a window left open past midnight shows yesterday's state
    until its next re-read (focus or a change).
- **Why:**
  - Q5.
  - Focus re-reads are the existing pattern, and a timer only for midnight
    isn't worth it.
- **Alternatives considered:** a ticking "worked so far" counter: not
  asked for.

### D7: Check-ins on the admin Schedule

- **Choice:**
  - **The day read:** `vitally_schedule_day` is replaced in the new
    migration, keeping 058's answer and adding `checkIns` for workspace
    admins only. Each check-in carries:
    - `checkInId`, `revision`, `volunteerId`, `name`;
    - `checkedInAt`, `checkedOutAt` (ISO), and `endsAt`, `state` and
      `minutes` from D2;
    - `flags`: any of `noCheckOut` (state `missed`), `notScheduled` (no
      live shift for the person that day), `corrected` and
      `outsideSiteHours` (any part of the span outside the weekday's open
      hours, or a closed day);
    - `correctedByName`.

    Non-admin answers are byte-for-byte 058's.
  - **Rows:** one per volunteer with a live shift or a live check-in that
    day, ordered by name.
  - **Bars:**
    - Each check-in is a thin bar under the row's shifts, from
      `checkedInAt` to `endsAt`. It is placed by minutes across the hour
      columns, and clipped at the grid's edges.
    - Its label is "9:52 am – 1:10 pm", or "9:52 am – now" when open. A
      missed one reads "9:52 am – no check-out".
    - The tags are "No check-out", "Not scheduled", "Corrected" and
      "Outside site hours".
    - Each bar is a button the keyboard reaches.
  - **Closed days:** on a closed day, or when no weekday is open, the
    "closed" or "set site hours" message stays. Below it, admins get the
    day's check-ins as a list of the same buttons, with the same labels and
    tags.
  - **Buttons:**
    - "+ Add check-in" sits beside "+ Add shift". It is shown on today and
      past days, not on future days.
    - It opens the check-in drawer: the Add shift volunteer picker (usual
      days first), "Checked in" and "Checked out" time pickers in 5-minute
      steps (Checked out may be left empty), and Save.
    - Pressing a bar opens the same drawer with its times, "Corrected by
      <name>" when corrected, a note for a missed check-out ("No check-out.
      Counted to 1 pm."), Save and "Remove check-in".
    - Remove asks first in the shared confirmation dialog: "Remove <name>'s
      check-in?".
  - **No drag:** check-ins are not dragged. The drawer is their only editor.
  - Coverage, counts and shift tags are unchanged.
- **Why:**
  - Q2 and Q6.
  - A drag for check-ins would collide with the shift drag in the same row
    and adds nothing over 5-minute pickers.
- **Alternatives considered:**
  - A separate admin read for check-ins: two reads per day for one screen.

### D8: Hours this week from check-ins

- **Choice:**
  - A new **`vitally_hours_this_week()`**, for workspace admins (FORBIDDEN
    otherwise), returns `weekStart`, `weekEnd` and
    `hours: [{volunteerId, minutes}]`. The minutes are the D2 minutes of
    every live current-season check-in dated in `ny_week(now())`.
  - `readWorkloadHours` calls it in place of `store.weekShifts`.
    `weekHours` becomes a lookup of minutes, and the view formats minutes
    ÷ 60 to one decimal, rounded half up, with a whole number shown without
    the decimal. A volunteer with none shows "0".
  - Sorting uses minutes.
  - The Workload re-reads hours on a change to `check_ins`, `shifts` or
    `schedule_settings`, or a new season, because a derived end depends on
    all three.
  - `store.weekShifts` is removed if nothing else uses it.
- **Why:**
  - One definition of minutes (D2).
  - The Workload stays cleared-admin-only, and the RPC is the second gate.
- **Alternatives considered:**
  - Keeping scheduled hours as a second column: not asked for, and it
    clutters a dense table.

### D9: Realtime and re-reads

- **Choice:**
  - `check_ins` joins `supabase_realtime` with 049's DO block, and joins
    `STAFF_TABLES`.
  - A `check_ins` change:
    - re-reads an open admin Schedule's day;
    - re-reads the Workload's hours;
    - re-reads the strip when the row is the caller's own.
  - Uncleared windows route nothing from `check_ins`. They hold the channel
    only on the Schedule (058), and RLS gives them only their own rows
    anyway.
  - A CONFLICT on a check-in save re-reads the day and says "Someone
    changed this check-in. The schedule has been refreshed."
    **(builder's call for the wording, mirroring the shift message)**
- **Why:** the same pattern as 058.

### D10: Seed

- **Choice:**
  - `seed:local`, as the Site Coordinator and only through the public RPCs,
    adds about four check-ins through `vitally_save_check_in`, on site days
    before today. It uses the most recent open days, which may fall in
    last week when today is early in the week.
  - They match some of the seeded shifts, with:
    - one missed check-out (no check-out time);
    - one "Not scheduled", for a role account with no shift that day.
  - Their ids go into the run file, and a re-run removes exactly those
    through `vitally_remove_check_in`.
  - The browser story's use of the seed module adds none.
  - Every seeded check-in reads "Corrected", because an admin wrote it.
- **Why:**
  - The seed uses public RPCs only (capability `local-seed-data`), and only
    the admin save can write past times.
  - Showing "Corrected" honestly says who wrote it.
- **Alternatives considered:**
  - Service-role inserts: they break the seed's RPC-only rule.
  - Self check-ins as the role accounts: they can only record "now".

### D11: The browser story

- **Choice:** one short walk.
  1. The preparer window checks in from the strip at 390 px and sees
     "Checked in since …".
  2. The site coordinator's Schedule shows the bar tagged "Not scheduled"
     (the story has made no shift for the preparer that day). The
     coordinator edits its in time through the drawer, and the bar reads
     "Corrected".
  3. The preparer checks out.
  4. The Workload's Hours this week shows a number with one decimal or
     none.

  A missed check-out is covered by the database suite with a fixed
  `p_now`, not by the story.
- **Why:** the story's time budget, and a missed check-out needs yesterday.

## Risks / Trade-offs

- [Risk] **#271 merges with changes after this branch was cut.**
  → Mitigation: merge `main` into this branch before verify, and again
  before archive (lifecycle step 8). The new migration replaces only
  `vitally_schedule_day`, so a change to 058's other functions doesn't
  collide.
- [Risk] **Replacing `vitally_schedule_day` drops part of 058's answer.**
  → Mitigation: copy 058's body as is, and add only the `checkIns` block,
  marked `-- 059`. The 058 schedule database tests run unchanged and must
  still pass.
- [Risk] **Migration number collision** with other open branches.
  → Mitigation: check `main` and open PRs before writing the file, and
  again before the PR. Whoever merges second renumbers.
- [Risk] **Time zone mistakes** around `check_in_date`, midnight and
  `"24:00"`. → Mitigation: all conversions go through
  `at time zone 'America/New_York'` in SQL. The database tests cover a
  check-in at 11:58 pm, a check-out of 24:00, and a DST-change Sunday.
- [Trade-off] An open check-in on a day with no shift and no site hours
  counts 0 until it is checked out. → Accepted: it follows Q4's rule, and a
  real check-out counts in full.
- [Trade-off] Seeded check-ins all read "Corrected". → Accepted: it is
  true, and it shows the tag in the demo.
- [Trade-off] A window open across midnight shows a stale strip until
  focus. → Accepted: focus re-reads, and the next tap is refused and
  re-reads.
- [Trade-off] Hours this week changes meaning, and early in the season it
  will read lower than the scheduled hours did. → Accepted: it is the
  issue's decision.

## Migration Plan

1. The new migration (`059_volunteer_check_in.sql`, number to confirm) is
   additive. It adds the table, its policy and grants, the six RPCs and the
   span helper, replaces `vitally_schedule_day`, and adds `check_ins` to
   the publication. It changes no existing row.
2. 049's DO block refuses if `supabase_realtime` is missing.
3. Deploy order: migration, then front end. An old front end ignores the
   new `checkIns` key and keeps reading `shifts` for its hours.
4. Rollback is a new migration that drops the table, the functions and the
   publication entry, and restores 058's `vitally_schedule_day`.
5. Checks:
   - `npm test`;
   - `npm run db:migrate:test`, then `npm run test:database`, on a stack
     that already has 058;
   - `npm run test:browser`.

## Open Questions

- **The migration number** (expected 059). Owner: the implementer, before
  the migration task. It affects only the file name.
- **Merge order with #271.** Owner: the user and team. #271 must be in
  `main` before this change is archived. Until then this branch carries
  it.
