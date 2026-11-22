## Context

Issue #140 asks for an hourly volunteer schedule: one day at a time, a role per shift, coverage gaps, site hours in Season settings, and a button alternative to every drag. The Nov 6 decision adds two more parts. Usual days (availability) are private to the volunteer and admins, and they hint admins while scheduling. Every rostered volunteer sees the shifts, and My profile lists their shifts this week. The decision log is in `brainstorm.md`.

**What the code already gives us** (read during propose, 2026-11-21, main at 7e06662):

*Tables and visibility:*
- `volunteer_profiles` (044) carries `works`, languages and a `revision`. It is readable only by workspace admins and not published.
- `roster_entries` holds the per-season `roles` (greeter, intaker, preparer, reviewer, admin).
- 044 (c)'s `staff_people` policy hides a person with no sign-in and no capabilities from everyone but a workspace admin. Since 052, capabilities are a mirror that is `{}` without a sign-in, so "no sign-in" alone hides a person.

*Checks and patterns:*
- `vitally_policy.is_workspace_admin` (052) means site coordinator, or the Admin role this season, with no clearance needed. `vitally_private.is_site_coordinator`, `vitally_private.cleared` and `vitally_private.effective_capabilities` exist.
- 049's `audience_member` is the pattern for "active account on an active staff membership with a current-season roster entry". That is exactly the Schedule's viewer, with audience `everyone`.
- 049 also gives the realtime pattern for a table the browser reads through RPCs. The table gets a SELECT grant and policy so realtime can deliver, and it is added to `supabase_realtime`.
- `src/supabase-store.mjs` watches INSERT and UPDATE only: "A deleted row is never announced."
- Season settings (052) is a single RPC-only row (`season_settings`, RLS on with no policy). `vitally_season_settings` answers workspace admins and `vitally_save_season_settings` writes for site coordinators. Both use receipts, the workspace advisory lock and revision CONFLICT.

*Functions this change replaces:*
- `vitally_my_clearance`. Since 2026-11-22 its latest body is main's `057_my_profile.sql`, which added `reviewedAt` and `reviewReason` to the document items and withholds `uploadUrl` while the site check is owed.
- `vitally_season_settings`, last replaced in 052.

**Reconciliation with main's My profile (2026-11-22).** While this change was in review, main merged a separate My profile change (`add-my-profile`, #262/#264/#265, migration `057_my_profile.sql`). That change owns:
- `volunteer_profiles.usual_days text[]` (`mon`…`sun`), and admin editing of usual days through `vitally_save_volunteer` (capability `volunteer-roster`);
- `vitally_my_profile()` and `vitally_save_my_profile()`;
- the My profile page (`myProfilePage` in `src/profile-views.mjs`), opened from the sidebar's account row for cleared windows only (capability `my-profile`).

By the user's decision, this change adopts all of that. It drops its own usual-days column and validator, `vitally_my_profile`, `vitally_save_my_usual_days`, its My profile page and its usual-days requirements. It stops replacing `vitally_save_volunteer`. It adds only a "Your shifts this week" section to main's page, read through a new `vitally_my_shifts()`. Its migration becomes `058_volunteer_schedule.sql`. The decision log is in brainstorm.md, "Update 2026-11-22".

*Front end:*
- The Workload (046) is computed in the browser (`src/volunteer-workload.mjs`) from the admin's Roster read and the staff case list.
- `staffSidebar` (`src/views.mjs`) already says the Schedule screen "does not exist yet".
- Staff screens are English.

**Constraints:**
- Fictional data only.
- Migrations are final once applied. This is 058 (main took 055 for Start next season, 056 for OneDrive and 057 for My profile).
- No client text.
- The browser story runs at about 550–600 s per leg against a 900 s limit, so the Schedule walk must stay short.
- Times are America/New_York throughout. The contact log already shows NY time whatever the viewer's zone.

## Goals / Non-Goals

**Goals:**
- An admin fills a day's open hours knowing where the gaps are and who usually comes.
- Every rostered volunteer with an active account sees the schedule and their own week. Usual days never leak to other volunteers.
- Coverage never shows OK because of uncleared, remote-only or flagged shifts.
- Every drag has a button alternative.

**Non-Goals:**
- One-off closed dates.
- Hours on usual days.
- Moving a shift between people in one step.
- Shift swaps or requests from volunteers.
- Notifications about shifts.
- Client appointments.
- Mobile layouts (#147).
- Carrying shifts into a new season. Shifts are per season and reads filter the current season, so Start next season (migration 055) opens on an empty schedule. Usual days (on the volunteer's profile) and the site hours and coverage targets (one row per workspace) carry over.

## Decisions

### D1: Storage. `shifts` and `schedule_settings`; usual days are main's
- **Choice:**
  - **`public.shifts`**:
    - Columns: `id uuid`, `workspace_id`, `season smallint`, `person_id`, `shift_date date`, `start_hour smallint`, `end_hour smallint`, `role text`, `revision bigint`, `created_at`, `created_by_person_id`, `updated_at`, `updated_by_person_id`, `removed_at timestamptz`.
    - Checks: `0 ≤ start_hour < end_hour ≤ 24`, and the role is one of the five.
    - A foreign key to `people(workspace_id,id)`.
    - An index on `(workspace_id, season, shift_date)`.
  - **`public.schedule_settings`**:
    - One row per workspace: `site_hours jsonb`, `preparers_needed`, `reviewers_needed` and `on_site_needed` (smallint 0–9, defaults 2 / 1 / 1), `revision`, `updated_at`, `updated_by_person_id`.
    - `site_hours` is an object keyed `"1"`…`"7"` (ISO weekday, Monday = 1), each `{open, close}` with `0 ≤ open < close ≤ 24`. A missing key means closed.
    - A missing row means every day is closed and the targets are at their defaults.
  - **Usual days:** this change adds no column. It reads main's `volunteer_profiles.usual_days text[]` (`mon`…`sun`, admin-only RLS, from `057_my_profile.sql`). The day read maps a date's ISO weekday to that key (1 → `mon` … 7 → `sun`).
- **Why:**
  - Site hours and targets get their own table, not columns on `season_settings`. Every Schedule window must learn of a change through realtime, and `season_settings` is deliberately unreadable by the browser (it sits beside the upload links and the SIDN flow).
  - jsonb for site hours keeps the save one row and one revision. A per-weekday table would need seven revisions or a parent row anyway.
  - Usual days were first built here as `smallint[]` (1–7). Main's My profile shipped the same column first as `text[]` (`mon`…`sun`), and the user chose to adopt it (2026-11-22).
- **Alternatives considered:**
  - Columns on `season_settings`: no realtime without exposing the links.
  - A `site_hours` row per weekday: more locking for no gain.
  - Keeping this change's `smallint[]` usual days and converting main's column: it would rewrite a teammate's merged change (rejected by the user).

### D2: Removing a shift is a soft delete
- **Choice:** Remove sets `removed_at` and raises the revision. Every read ignores removed shifts. Nothing deletes a shift row.
- **Why:** The store watches INSERT and UPDATE only, and a DELETE is never announced. A soft delete reaches open windows like any edit.
- **Alternatives considered:** Hard delete plus a separate "schedule changed" ping table: two tables to keep in step.

### D3: Who reads, and the no-sign-in rule
- **Choice:**
  - A **schedule viewer** is a workspace admin, or `audience_member(workspace, person, 'everyone', '{}')`: an active account on an active staff membership with a current-season roster entry. Clearance does not matter.
  - A new `vitally_policy.is_schedule_viewer(workspace)` answers this for the caller only.
  - The SELECT policy on `shifts` admits a viewer, and only for rows whose person has a sign-in (`people.user_id is not null`), unless the caller is a workspace admin.
  - The SELECT policy on `schedule_settings` admits any viewer.
  - Both tables are granted SELECT for realtime only. The browser reads them through the RPCs (D5). Admins additionally read `shifts` directly for the Workload's hours (D9).
  - Non-admin viewers never receive another volunteer's usual days, works, email, phone, clearance or flags. The read-only Schedule shows names, roles and hours only, and has no coverage row. **(builder's call: coverage depends on others' clearance and Works, which are admin-only data.)**
- **Why:**
  - It keeps volunteer-roster's "A volunteer with no sign-in is visible only to admins" unchanged (user ruling, OQ1).
  - The coverage row is identical for everyone anyway, because such shifts never count.
  - Reusing `audience_member` keeps one definition of "on the current roster".
- **Alternatives considered:**
  - Show a no-sign-in row unnamed (rejected by the user).
  - Refuse to schedule people with no sign-in (rejected by the user).
  - Show coverage to everyone: it leaks clearance indirectly.

### D4: Who writes. Shifts by workspace admins, settings by site coordinators
- **Choice:**
  - `vitally_save_shift(p_action_id, p_shift_id, p_expected_revision, p_shift jsonb)` adds a shift when both ids are null and edits it when both are present. `vitally_remove_shift(p_action_id, p_shift_id, p_expected_revision)` removes one. Both are for workspace admins, cleared or not.
  - `vitally_save_schedule_settings(p_action_id, p_expected_revision, p_settings jsonb)` is for site coordinators.
  - All follow 052's order:
    1. FORBIDDEN, with nothing written and no receipt.
    2. VALIDATION of shape.
    3. The workspace advisory lock.
    4. The receipt (a replay returns the stored answer).
    5. CONFLICT on a stale revision.
    6. The domain refusals.
  - A shift save is refused with VALIDATION and a reason when:
    - `NOT_ON_ROSTER`: the person has no current-season roster entry;
    - `DEACTIVATED`: the person's account is deactivated;
    - `ROLE_NOT_HELD`: the role is not in their current roles;
    - `SITE_CLOSED`: the weekday is closed;
    - `OUTSIDE_SITE_HOURS`: the start or end lies outside that weekday's hours;
    - `OVERLAP`: the shift overlaps another live shift of the same person on that date.
  - An edit keeps the shift's person. A change of person is a remove plus an add.
- **Why:**
  - Same rights as the Roster (user decision Q4): the schedule holds no case data.
  - Settings follow the rest of Season settings.
  - The shared order matches every RPC since 044, so the tests and the controller's refusal mapping carry over.
- **Alternatives considered:**
  - A btree_gist exclusion constraint for overlap: it needs an extension the project has not enabled. The check under the workspace lock is enough at this scale.

### D5: Reads go through RPCs
- **Choice:**
  - **`vitally_schedule_day(p_date date)`**, for schedule viewers. FORBIDDEN otherwise. It returns:
    - `date`, `weekday`, `hours` (`{open, close}` or null for closed), `anyOpen` (some weekday is open), `targets`, `settingsRevision`, `canEdit` (workspace admin) and `canEditSettings` (site coordinator, for the Season settings link);
    - `shifts`: each with `shiftId`, `revision`, `volunteerId`, `name`, `role`, `startHour` and `endHour`.
  - For workspace admins only, each shift also carries:
    - `flags`: any of `notCleared`, `noSignIn`, `roleRemoved`, `outsideSiteHours`;
    - `counts`: `preparer`, `reviewer`, `onSite` or null. This is the D6 rule decided in SQL from clearance, role and Works.
  - Admins also get `candidates`: current-season roster people with at least one role whose account is not deactivated. Each carries `volunteerId`, `name`, `roles`, `usualDays` (main's `mon`…`sun` strings), `cleared` and `works`.
  - **`vitally_my_shifts()`**, caller-only. It is gated like main's `vitally_my_profile`: FORBIDDEN for a client, an anonymous caller, a staff caller with no person row, or an `invited` account, and not gated by clearance. It returns `weekStart`, `weekEnd` and `shifts` (each `shiftId`, `date`, `startHour`, `endHour`, `role`) for the caller's live current-season shifts in the Monday-to-Sunday week that holds today in America/New_York. It replaces this change's earlier `vitally_my_profile` and `vitally_save_my_usual_days`, which are dropped (main owns `vitally_my_profile`).
  - **`vitally_season_settings`** (replaced) adds `schedule: {siteHours, targets, revision}` to its answer.
- **Why:**
  - One answer per screen, with the privacy filtering in one place.
  - The SQL decides `counts`, so the browser only adds them up. Clearance logic is never duplicated in the browser.
- **Alternatives considered:** Browser reads of the tables plus browser-side clearance. Non-admins can't read clearance, and it duplicates `cleared`.

### D6: Coverage is counted per open hour from `counts`
- **Choice:**
  - For each open hour h of the day, sum the shifts whose span covers h (`start ≤ h < end`) by `counts`.
  - A shift counts as:
    - `preparer` when its role is preparer;
    - `reviewer` when its role is reviewer;
    - `onSite` when its role is greeter or intaker and the volunteer's Works is `on_site` or `on_site_and_remote`.
  - A shift counts only when the volunteer is cleared and the shift has no `roleRemoved` or `outsideSiteHours` flag. Otherwise `counts` is null.
  - An Admin shift counts toward nothing.
  - An hour has a gap when any count is below its target. A target of 0 is never a gap.
  - The hour cell reads "OK", or lists what is missing ("1 more preparer", "2 more preparers, 1 more reviewer", "1 more on site").
  - The header reads "N of M hours have gaps", or "No gaps" when N is 0.
  - The summing and the wording live in a pure module (`src/volunteer-schedule.mjs`) with unit tests.
- **Why:** The rule is the user's (Q7). Splitting it into SQL classification plus browser summing keeps each half testable.

### D7: The day view, drag and its button alternatives
- **Choice:**
  - **Header:** "Schedule" with the overline "VOLUNTEERS". A day picker with ‹ Prev, the date as "Saturday, February 7", Next › and Today. Today is the New York date, and the screen opens on it. For admins, "+ Add shift".
  - **Closed day:** "The site is closed on Saturdays." with no grid.
  - **No site hours:** an admin reads "Set site hours in Season settings first.", with a link for site coordinators.
  - **Grid:**
    - One column per open hour, labelled "10 am", "12 pm", "5 pm".
    - One row per volunteer with a live shift that day, ordered by name, then by their earliest start.
    - Each shift is a button spanning its hours. It shows the role, plus the admin's flag tags: "Not cleared", "No sign-in", "Role removed", "Outside site hours".
    - Admins get the coverage row at the bottom.
    - The grid scrolls sideways inside its own box.
  - **Drag (admins, pointer only):**
    - Dragging across empty cells of a row creates a shift. It takes the role of that row's earliest shift that day, and saves at once.
    - Dragging a shift's start or end edge resizes it, and saves at once.
    - A refused save shows the refusal and redraws from the server.
    - A drag never starts on a non-admin screen.
  - **Buttons:**
    - "+ Add shift" opens the shift drawer: a volunteer picker, then the volunteer's current roles, a start and an end, each limited to the day's hours.
    - The picker lists volunteers who usually come that weekday first, each tagged "Usually here Saturdays", then the rest, by name within each group.
    - Clicking a shift opens the same drawer with its role, start and end editable, plus "Remove shift". Remove asks first through the shared confirmation dialog: "Remove <name>'s shift?".
    - Keyboard users never need a drag.
  - **Past days:** editable, so the Workload's hours stay true. **(builder's call)**
- **Why:**
  - The layout is the user's (Q8).
  - Saving a drag at once keeps it a direct manipulation. The drawer covers everything else.
  - "Earliest shift's role" makes a drag in a row unambiguous with no extra prompt.
- **Alternatives considered:**
  - A drag that opens the drawer to confirm: slower, and redundant with the button path.
  - Drag to move a shift: not agreed, and it equals remove plus add.

### D8: "Your shifts this week" on main's My profile
- **Choice:**
  - Main's My profile page (`myProfilePage`, capability `my-profile`) gains one section, "Your shifts this week". It lists each shift as "Tue, Feb 3 · 5 pm – 8 pm · Preparer", or "No shifts this week.". The page's other sections, its usual-days checkboxes and its save are main's and are not changed.
  - The section reads `vitally_my_shifts()` (D5) when the page opens, on focus, and on a `shifts` change (D10).
  - My profile stays cleared-only, as main's spec says (user decision 2026-11-22). Uncleared rostered volunteers see their shifts on the read-only Schedule.
  - This change's own My profile screen, its usual-days toggles on My profile and on the Roster drawer, and the base-revision handling for usual days (ruling R13's usual-days half) are removed. Main's page and drawer do these.
- **Why:** The user chose to adopt main's merged My profile rather than keep two pages and two usual-days models.
- **Alternatives considered:** Keeping this change's page and RPCs (rejected: duplicate screens and column). Opening My profile to uncleared viewers (rejected: it would change main's spec and its site-check privacy reasoning).

### D9: Workload "Hours this week"
- **Choice:**
  - Admins read `shifts` directly (D3's policy admits them to every row), for the current season and the current NY week.
  - `src/volunteer-workload.mjs` sums `end − start` per person across every live shift, flagged or not.
  - The column follows the existing counts. It reads "0" when the volunteer has no shifts, and it sorts.
- **Why:** The Workload is already browser-computed from admin-readable tables. A new RPC would duplicate the read.

### D10: Realtime and re-reads
- **Choice:**
  - `shifts` and `schedule_settings` join `supabase_realtime` with 049's DO block, and join `STAFF_TABLES` in the store.
  - A change on either table makes an open Schedule re-read its day. A change to `shifts` (or a new season) makes an open My profile re-read its shifts this week (cleared windows; D8) and a Workload re-read its shifts. A `schedule_settings` change does not re-read those two, because site hours and targets can't change either list (user decision 2026-11-22).
  - An uncleared window holds the realtime channel only while it is on the Schedule, and routes only `shifts` and `schedule_settings` to the day read.
  - Season settings re-reads on a `schedule_settings` change (cleared windows; ruling R11).
  - Focus re-reads these screens as it does the Roster.
  - A CONFLICT re-reads, then shows "Someone changed this shift. The schedule has been refreshed." **(builder's call for the wording)**
  - Usual days are not published.
- **Why:** The user chose revisions plus a live refresh (Q10), and the pattern is proven by posted updates.

### D11: The sidebar and the setup screen
- **Choice:**
  - `vitally_my_clearance` (replaced, rebuilt from main's `057_my_profile.sql` body) adds `scheduleViewer` (D3), for cleared and uncleared callers alike.
  - The staff sidebar shows "Schedule" (calendar icon) after Volunteers for admins and after the Work board for others. **(builder's call for the order)** My profile stays main's account-row link (cleared windows only), not a nav link.
  - The setup screen's sidebar shows Schedule when `scheduleViewer` is true.
  - A window restored on the Schedule without `scheduleViewer` gets the home screen.
  - The sidebar's "does not exist yet" comment drops Schedule.
- **Why:** User decision Q5: every rostered volunteer, cleared or not, can see the Schedule, including during preseason. My profile access follows main's spec (user decision 2026-11-22).

### D12: Seed and fixtures
- **Choice:**
  - `seed:local` writes site hours (Tue and Thu 5 pm – 8 pm, Sat 10 am – 4 pm), the default targets, and usual days for several fictional volunteers, as main's `mon`…`sun` values through main's `vitally_save_volunteer`.
  - It also writes about six shifts in the current NY week across the four role accounts and two roster volunteers. One Saturday hour is left with a gap, and one shift goes to a volunteer with no sign-in.
  - Site hours are written only when the workspace never saved them.
  - A re-run keeps any fictional person, current or previous-season (main's #267), who holds a live shift the seed did not add. Deleting them would cascade-delete that shift. The seed spec's MODIFIED requirements record this (user decision 2026-11-22).
  - The seeded shift ids go into the run file, and a re-run removes exactly those through `vitally_remove_shift`.
  - The browser story's use of the seed module adds none of this. The story sets its own site hours and creates its own shifts through the UI. That covers the button path, one drag, the gap row, and a read-only check from the preparer window.
  - All values are fictional.
- **Why:** A demo needs a populated week, and the story stays self-contained like its other walks. PCDC's real hours are an open question (OQ2).

## Risks / Trade-offs

- [Risk] **Scope against the Dec 6 target.** This is a large change: three screens, three replaced RPCs and drag. → Mitigation: the plan orders tasks so the Workload column and the seeded shifts come last and can be cut (OQ3).
- [Risk] **Replacing `vitally_my_clearance` again** risks dropping main's 057 review fields. → Mitigation: copy main's `057_my_profile.sql` body as is, add only the `scheduleViewer` line marked `-- 058`, and re-run the clearance, clearance-upload and my-profile database suites. `vitally_save_volunteer` is no longer replaced by this change.
- [Risk] **Reconciling a reviewed implementation with main's My profile** (2026-11-22) touches the migration, the store, the views and the browser walk after review. → Mitigation: one more task group (tasks.md group 8) runs through apply with task reviews, then verify is re-run in full.
- [Risk] **Drag on touch screens and in Playwright.** → Mitigation: pointer events with `setPointerCapture`. The story drives the button path, and one drag runs with Playwright's mouse API.
- [Risk] **Migration number collision.** `main` took 055 (`055_start_next_season.sql`, #255) after this change was proposed, so this change is 056. Open PR #245 (`055_onedrive_client_documents.sql`) must also renumber and may claim 056. → Mitigation: re-check `main` and open PRs right before the PR. Whoever merges second renumbers; 056 is applied nowhere until merge. #245 merged first and took 056 (`056_onedrive_client_documents.sql`), so this change became 057, and then #262 took 057 (`057_my_profile.sql`), so this change is 058.
- [Trade-off] Non-admins don't see the coverage row. → Accepted: coverage encodes others' clearance and Works.
- [Trade-off] Overlap is checked in the RPC, not by a constraint. → Accepted: every write goes through the RPC under the workspace lock, and RLS refuses direct writes.
- [Trade-off] Site hours repeat weekly with no closed dates. → Accepted (Q3): a holiday is handled by not scheduling anyone.

## Migration Plan

1. 058 is additive. It adds new tables, new functions and policies, replaces two functions (`vitally_my_clearance` from main's 057, `vitally_season_settings` from 052), and adds two tables to the publication. It changes no existing row.
   - Even so, run the local `db:migrate:test` on a stack that already has main's migrations through 057.
2. The 049 DO block refuses if the `supabase_realtime` publication is missing. Hosted already has it.
3. Deploy order is the usual one: migration, then front end. An old front end ignores the new answer keys.
4. Rollback means a new migration that drops the tables, the publication entries and the new functions, and restores main's 057 `vitally_my_clearance` and 052's `vitally_season_settings`. Applied migrations are never edited.
5. Checks:
   - `npm test`;
   - `npm run db:migrate:test` then `npm run test:database`;
   - `npm run test:browser`.
   - Not `build:hant`: no client text. Not `test:auth-browser`: sign-in is untouched.

## Open Questions

- **OQ2: PCDC's real site hours.** Owner: the team. They affect only the seed (D12). The seed uses fictional hours until then.
- **OQ3: the Dec 6 target.** Owner: the user. If the change runs late, the Workload column (D9) and the seeded shifts (D12) are the first things to cut.
- OQ1 (no-sign-in visibility) was resolved by the user on 2026-11-21. See D3.
- OQ4 (overlap with main's My profile, #262) was resolved by the user on 2026-11-22: adopt main's My profile and usual days, add only "Your shifts this week", and keep My profile cleared-only. See Context, D1, D5, D8, D11.
