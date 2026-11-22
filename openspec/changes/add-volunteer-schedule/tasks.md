## 1. Migration 057: storage and visibility

- [x] 1.1 Add `volunteer_profiles.usual_days smallint[] not null default '{}'`, with a check for values 1–7, no duplicates, sorted (design D1).
- [x] 1.2 Add `public.schedule_settings` (one row per workspace; `site_hours jsonb` keyed `"1"`…`"7"` with `{open, close}`; three targets 0–9 defaulting 2/1/1; revision; updater) and a private validator for `site_hours` (D1).
- [x] 1.3 Add `public.shifts`:
  - columns: id, workspace, season, person, `shift_date`, `start_hour`, `end_hour`, role, revision, created/updated by and at, `removed_at`;
  - checks: `0 ≤ start < end ≤ 24` and the five roles;
  - an index on `(workspace_id, season, shift_date)` (D1, D2).
- [x] 1.4 Add `vitally_policy.is_schedule_viewer(ws)`, which answers only for the caller: workspace admin, or `audience_member(…, 'everyone', '{}')`. Add SELECT policies with no write grants: on `shifts`, a viewer, with no-sign-in people's rows for workspace admins only; on `schedule_settings`, a viewer (D3).
- [x] 1.5 Add `shifts` and `schedule_settings` to `supabase_realtime` with 049's DO block (D10).
- [x] 1.6 Database tests:
  - the column checks;
  - the RLS: a viewer, a non-viewer, a client, the no-sign-in rule for direct reads;
  - realtime: a non-admin gets no change for a no-sign-in person's shift, and an admin does;
  - no direct writes.

## 2. Migration 057: RPCs

- [x] 2.1 `vitally_save_schedule_settings` and the replaced `vitally_season_settings` (adds `schedule: {siteHours, targets, revision}`). Site coordinator only, in the 052 order: FORBIDDEN → VALIDATION → lock → receipt → CONFLICT (D4, D5).
- [x] 2.2 `vitally_save_shift`:
  - add or edit, workspace admin only, with receipt and CONFLICT;
  - the refusals `NOT_ON_ROSTER`, `DEACTIVATED`, `ROLE_NOT_HELD`, `SITE_CLOSED`, `OUTSIDE_SITE_HOURS`, `OVERLAP` (adjacent shifts allowed);
  - an edit keeps the person (D4).
- [x] 2.3 `vitally_remove_shift`: soft delete, raises the revision; a later change is refused (D2).
- [x] 2.4 `vitally_schedule_day(p_date)` (D5):
  - for viewers: hours, targets, `canEdit`, and shifts with name, role, hours and revision, with no-sign-in shifts left out for non-admins;
  - for admins only: `flags`, `counts` (the D6 rule in SQL) and `candidates` with roles, usual days, cleared and works.
- [x] 2.5 `vitally_my_profile()` (name, roles, usual days, profile revision, shifts this NY week) and `vitally_save_my_usual_days` (own profile only; validation; raises the profile revision; CONFLICT) (D5, D8).
- [x] 2.6 Replace `vitally_save_volunteer`. Copy 053's body verbatim and add an optional `usualDays` (missing = keep), with the added lines marked `-- 057` (D8).
- [x] 2.7 Replace `vitally_my_clearance`. Copy 053's body and add `scheduleViewer` (D11).
- [x] 2.8 Add `tests/database-schedule.mjs`, which covers every `volunteer-schedule` database scenario:
  - the refusal order;
  - the shift rules and flags;
  - `counts`, including uncleared, remote, Admin and flagged shifts;
  - usual days privacy and CONFLICT;
  - My profile's week bounds in New York time.
  
  Also extend `database-season-settings`, `database-volunteer-roster` and `database-clearance` for the replaced functions. Then run `npm run db:migrate:test` and `npm run test:database`.

## 3. Store and pure logic

- [x] 3.1 `src/supabase-store.mjs`: the new RPC calls, `shifts` and `schedule_settings` in `STAFF_TABLES`, the admin's direct `shifts` read for a week, and the mapping of the new refusal reasons.
- [x] 3.2 New `src/volunteer-schedule.mjs`, with pure functions and unit tests:
  - New York today and week bounds;
  - hour labels;
  - coverage sums and gap wording ("1 more preparer", "N of M hours have gaps", "No gaps");
  - picker ordering (usual days first, then by name);
  - the role a drag-created shift takes;
  - the "Tue, Feb 3 · 5 pm – 8 pm · Preparer" lines.

## 4. Screens

- [x] 4.1 Controller:
  - the `schedule` and `my-profile` screens, gated on `scheduleViewer`, with the home screen for anyone else;
  - day navigation;
  - the save, remove and usual-days actions with the refusal and CONFLICT messages;
  - realtime and focus re-reads for the Schedule, My profile and Season settings (D10, D11).
- [x] 4.2 Sidebar (`src/views.mjs`) and the setup screen (`src/setup-views.mjs`): the Schedule and My profile links in the D11 order. Drop Schedule from the "does not exist yet" comment.
- [x] 4.3 New Schedule view module:
  - header, day picker, closed and no-site-hours states;
  - the grid with shift buttons, tags and the coverage row (admin);
  - the read-only variant;
  - the shift drawer with the picker, role, start/end, Save, and Remove shift with the shared confirmation dialog (D7).
- [x] 4.4 Drag in `src/app.mjs`: pointer events with pointer capture to create across empty cells and to resize by an edge. Save at once, and redraw on a refusal. Admin screens only (D7).
- [x] 4.5 New My profile view module: roles, usual-days toggles with Save and the privacy note, and the week list (D8).
- [x] 4.6 Season settings: the "Site hours and coverage" card, editable for site coordinators and text for other admins, with its own Save and revision (`src/season-settings-views.mjs`).
- [x] 4.7 Roster Edit drawer: the Usual days toggles after Works, sent as `usualDays` (`src/volunteer-views.mjs`, `src/volunteer-roster.mjs`).
- [x] 4.8 CSS for the grid (sideways scroll inside its box), shift blocks, tags, the coverage row and the toggles.
- [x] 4.9 Unit tests for the views and the controller gates: admin, non-admin and uncleared viewer, non-viewer, a restored window, the read-only Schedule with no tags or coverage, the drawer's limits.

## 5. Workload hours

- [x] 5.1 `src/volunteer-workload.mjs` and `src/workload-views.mjs`: "Hours this week" after Stalled, summing every live shift of the NY week, sortable, re-read on shift changes. Unit tests (D9).

## 6. Seed

- [x] 6.1 `tools/admin/seed*.mjs`:
  - site hours only when never saved;
  - usual days for at least four fictional volunteers, two of them on Saturdays;
  - about six shifts this week, with one Saturday gap and one no-sign-in volunteer;
  - shift ids in the run file, removed on re-run through `vitally_remove_shift`;
  - none of this for the browser story.

  Extend `tests/database-seed.mjs` (D12).

## 7. Browser story and docs

- [x] 7.1 Browser story, kept short:
  - the site coordinator sets site hours in Season settings;
  - an admin adds a shift with the button path and resizes one by drag, and the coverage row shows a gap and then OK;
  - the preparer window sees the shift live, read-only, with no tags or coverage;
  - the preparer saves usual days on My profile.

  Run `npm run test:browser`.
- [x] 7.2 Docs: `docs/developer/database.md` (new column, tables, RPCs, realtime), the frontend notes for the new screens and drag, and the production-roadmap line about the Workload's Hours this week column.
- [x] 7.3 Final checks: `npm test`, `npm run db:migrate:test` on a stack that already has main's migrations, then `npm run test:database`, and `npm run test:browser`. Also `npx openspec validate --all`.

## 8. Reconcile with main's My profile (#262)

Decided by the user on 2026-11-22: adopt main's merged My profile (`add-my-profile`) and its usual days, and keep My profile cleared-only. Group 8 supersedes tasks 2.5, 2.6, 4.5 and 4.7 and the My profile half of 7.1.

- [x] 8.1 Merge `origin/main` into the branch. Resolve every conflict in favour of main's My profile: its page, `vitally_my_profile`, `vitally_save_my_profile`, its usual-days column and drawer checkboxes, and its account-row link. Stop if a conflict lands under `openspec/specs/`.
- [ ] 8.2 Migration 058:
  - rename `057_volunteer_schedule.sql` to `058_volunteer_schedule.sql`, with `-- 058` markers;
  - remove this change's `usual_days` column, `valid_usual_days`, `vitally_my_profile`, `ny_week` if nothing else uses it, `vitally_save_my_usual_days`, and the `vitally_save_volunteer` replacement;
  - rebuild `vitally_my_clearance` from main's `057_my_profile.sql` body, adding only `scheduleViewer`;
  - make the day read's candidates and `shift_counts` read main's `usual_days` (`mon`…`sun`);
  - add `vitally_my_shifts()` (D5);
  - update `tests/database-schedule.mjs`, `tests/database-clearance.mjs`, `tests/support/rpc-signatures.mjs` and `tests/database-catalog.mjs`;
  - reset the local database, then run `npm run db:migrate:test` and the full `npm run test:database`.
- [ ] 8.3 Store and pure helpers: `myShifts()` replaces `myProfile()` and `saveMyUsualDays()`. `orderCandidates` maps `mon`…`sun` to ISO weekdays. Unit tests.
- [ ] 8.4 Interface:
  - remove this change's My profile page, its route, its sidebar link and the Roster drawer's usual-days toggles, keeping main's;
  - add a "Your shifts this week" section to main's `myProfilePage`, read on open, on focus and on `shifts` changes;
  - make the uncleared-viewer channel Schedule-only;
  - update the sidebar-order and gate tests.
- [ ] 8.5 Seed: write usual days as `mon`…`sun` through main's `vitally_save_volunteer`. `tests/database-seed.mjs`.
- [ ] 8.6 Browser walk: replace step 6, where the preparer saved usual days on My profile, with the preparer opening main's My profile and seeing the shift under "Your shifts this week". Run the schedule, Season settings and My profile browser tests.
- [ ] 8.7 Docs and counts (`docs/developer/*.md`, README): migrations, RPCs and Realtime tables, re-derived from the migrated database.
- [ ] 8.8 Final checks:
  - `npm test`;
  - `npm run db:migrate:test` and `npm run test:database`;
  - `npm run test:browser`;
  - `npm run build:hant -- --check`;
  - `npx openspec validate --all`.
