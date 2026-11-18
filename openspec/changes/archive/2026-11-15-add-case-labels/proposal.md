## Why

Office staff and volunteers have no way to mark a case with a short, shared fact that affects how it is handled. Facts like "City Tax", "MFS" (married filing separately) or "Multi-state" have to be found again in the intake answers each time. Issue #148 (roadmap part 7, team features) asks for case labels: shown on the case, on the work board and in the case pool, and usable as a filter in the admin case pool. The designs already show the chips, and the color tokens already exist in `src/styles.css`, but nothing uses them.

## What Changes

- **Labels:** a workspace has its own set of labels. Each label has a name (1-24 characters, unique ignoring case) and one of six fixed colors: sky, amber, pink, green, violet, slate.
- **Starter labels:** every workspace, existing and new, starts with City Tax (sky), MFS (pink) and Multi-state (amber).
- **Admins manage labels inline.** In the case header's `+ Add a label` menu, an admin can:
  - create a label when the search matches none;
  - rename or recolor any label (pencil).
  
  There is no separate labels page, and no delete.
- **Applying labels:** anyone who works on the case (`works_on_case`: the office on any case, a volunteer on a case they prepare or review) can add or remove labels from the case header. Labels are frozen on a closed case. Other cleared staff see the chips read-only.
- **Where chips show:**
  - in the case header;
  - under the reference on the work board;
  - under the reference in the admin case pool.
- **Case pool filter:** a new single-choice "Label" filter (`Any label`, each label, `No label`).
- **Database (migration 051):**
  - two staff-only tables, `case_labels` and `case_label_links`, in the Realtime publication;
  - two new RPCs, `vitally_save_label` (admin) and `vitally_set_case_label`;
  - removing a label marks the link inactive instead of deleting it, so Realtime reports it;
  - a label change writes a staff history line but never changes the case's `revision` or `updated_at`.
- **Seed data:** `npm run seed:local` puts a few labels on rehearsal cases.

**Case revision and labels**
- From: n/a (labels are new).
- To: label changes leave `cases.revision` and `cases.updated_at` alone.
- Reason: a label must never turn another window's half-finished work into a "Someone else updated this application" conflict, or reorder the case pool.
- Impact: non-breaking.

## Capabilities

### New Capabilities
- `case-labels`: what labels are, who creates, renames, recolors and applies them, where staff see them, the case pool's label filter, what clients never see, and the two RPCs with their checks.

### Modified Capabilities
- `volunteer-clearance`:
  - the read gate covers the two new label tables;
  - the "refuse an uncleared staff member first" rule covers the two new RPCs.
- `staff-case-work`: the list of tables a cleared staff member reads (with Realtime) adds case labels.

## Impact

- **Database:**
  - a new hand-written migration `051_case_labels.sql` (047-050 are taken on open branches);
  - two tables with RLS, grants, checks and Realtime;
  - two `public` RPCs, a few private helpers, and a trigger on `workspaces` that adds the starter labels;
  - a one-time insert of the starter labels into existing workspaces.
  
  `initialize_workspace`, `vitally_apply_action` and `check_payload` are not changed.
- **Browser:**
  - `src/supabase-store.mjs` (new store calls, `STAFF_TABLES`);
  - the controller (the label menu's actions);
  - `src/staff-views.mjs` (case header, work board);
  - `src/pool-views.mjs` (chips and filter);
  - `src/styles.css` (tokens renamed by color, three new colors, chip and menu styles).
- **Tools:** `tools/admin/seed.mjs` (or the case seeding it calls) labels rehearsal cases.
- **Tests:**
  - unit (views, filter, store);
  - a new `tests/database-labels.mjs`;
  - updates to `tests/support/rpc-signatures.mjs`, to the clearance policy and catalog tests, and to the Realtime publication test;
  - the browser story.
- **Docs:** `docs/developer/database.md` (migration row, tables, RPCs, Realtime) and `docs/developer/frontend.md` where the screens are described.
- **Merge points with open branches:**
  - `add-account-invitations` and `add-posted-updates` also add RPCs to `rpc-signatures.mjs`;
  - `add-posted-updates` also edits `STAFF_TABLES` and the `volunteer-clearance` spec.
- **Out of scope (follow-ups):**
  - deleting a label (a new issue);
  - chips on the volunteer dashboard (not built yet);
  - a "New label" office notice (posted updates are not on `main`);
  - a work board label filter.
