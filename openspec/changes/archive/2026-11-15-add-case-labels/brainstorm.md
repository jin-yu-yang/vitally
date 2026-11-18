<!--
Raw capture of superpowers:brainstorming output.
The design below was agreed with the user, decision by decision, in the
/opsx:explore conversation of 2026-11-15 (questions Q1-Q6 and six defaults).
Items marked "builder's call" were settled by Claude while writing this up and
are open to the user's correction during the planning review.
-->

# Brainstorm: case labels (issue #148)

## Background

Issue #148 (jin-yu-yang/vitally, roadmap part 7, team features) asks for case
labels such as City Tax, MFS and Multi-state:

- Labels on a case, shown in the case header, on the work board, the dashboard
  and the case pool.
- Add and remove a label from the case header.
- A label filter in the admin case pool.
- Open in the issue: who creates a label. The design's Posted updates table shows
  "New label: City Tax" as an office notice, which suggests admins create labels
  and volunteers apply them. The user said to assume that.

Design screens (`docs/design/screens/`):

- `case-preparer-view-v3-full-page.png`: header chip row ends with `City Tax ×`
  and `+ Add a label`.
- `volunteer-dashboard-v4-full-page.png`: a small label chip under the
  application reference in "Your cases".
- `admin-work-board-full-page.png` (the case pool): a "Labels" filter button
  beside Stage; a label chip under the reference of some rows.

What exists today (observed in the code on `main` at 6add349):

- Case header: `caseHeader` in `src/staff-views.mjs`.
- Work board: `renderStaffBoard` in `src/staff-views.mjs`.
- Case pool and its filters: `src/pool-views.mjs`. Filters are single-choice
  dropdowns (`filterSelect`) kept in `state.boardFilters`, with a "Clear filters"
  button and per-tab counts.
- The volunteer dashboard is not built (a placeholder in the nav).
- Posted updates are not on `main`; an open branch `add-posted-updates`
  (migration 049) builds them.
- `src/styles.css` defines three unused label color sets, named per label:
  `--vt-label-city-tax-*` (sky), `--vt-label-multi-state-*` (amber),
  `--vt-label-mfs-*` (pink), each with base, `-bg`, `-ink`, `-line`.
- `vitally_private.works_on_case` (013): an `admin` or `followup` person on any
  case, or the case's preparer or reviewer. Document cards use it.
- The contact log (031) writes through its own RPCs and never bumps
  `cases.revision`, so logging never turns another window's form into a
  conflict.
- Realtime publishes INSERT and UPDATE only; deletes are never published.
- Open branches already use migrations 047 (`add-account-invitations`), 048,
  049 (`add-posted-updates`) and 050. `add-account-invitations` replaces
  `vitally_private.initialize_workspace`. Both it and `add-posted-updates` add
  RPCs to `tests/support/rpc-signatures.mjs`, and `add-posted-updates` adds a
  table to `STAFF_TABLES`.

## Decision chain

### Q1. Scope: where labels appear

Options: all four places in the issue, or only the three that exist.

**Decided (user): three places only.**
- The case header (show, add, remove).
- The work board (show).
- The admin case pool (show and filter).

Out of scope: the volunteer dashboard, which isn't built; its chip comes with
whoever builds it. Also out: the "New label" office notice, since posted
updates aren't on `main`.

### Q2. Label colors

Options:
- **A.** A fixed palette the admin picks from, stored by color name.
- **B.** A color assigned automatically.
- **C.** Any hex color the admin types.

**Decided (user): A, six fixed colors.**
- The tokens are renamed by color, not by label: sky, amber, pink, plus three
  new ones.
- The database stores the color name, checked against the list, never raw CSS.
- Two labels may share a color.

**Decided (user): the three starter labels exist in every workspace:**
City Tax (sky), MFS (pink), Multi-state (amber). They are created both for
existing workspaces and for new ones.

Rejected:
- B, because the colors feel random and can collide.
- C, because it allows unreadable colors and puts unchecked values into CSS.
- Seed-only starter labels, because the user wants them everywhere.

### Q3. Where admins create labels, and what else they can do

Options:
- **(a)** Inline, in the case header's `+ Add a label` menu.
- **(b)** A separate admin Labels page.

For each, the question was also whether admins may create, edit or delete
labels.

**Decided (user): (a) inline, create plus rename/recolor, no delete.**
- The "Create" row shows only to admins, when the search text matches no label.
- A pencil on each label row lets an admin rename or recolor it, and only
  admins see the pencil.
- Chips update everywhere at once, because a case links to the label, not to a
  copy of its name.

**Deleting a label becomes a follow-up issue.** It is the hard part: what
happens to the cases that carry the label (removed silently, refused, or
archived). The user asked for this to be noted as a follow-up.

Rejected:
- (b), because it needs a new route, a nav item and new story coverage, and the
  designs show no such page.
- Create-only, because typos would be permanent.

### Q4. Who may apply and remove a label

Options:
- **(a)** Any cleared staff member.
- **(b)** `works_on_case`.

**Decided (user): (b) `works_on_case`.** That is the office (`admin` or
`followup`) on any case, and a volunteer on a case they prepare or review.
Labels are **frozen on a closed case**.
- Other cleared staff see the chips read-only and can filter by them.
- A client's unsent draft can't be labelled, because staff can't see it.

Rejected: (a), because a volunteer could label someone else's case by mistake.
A greeter or intaker who notices "Multi-state" at intake tells the office, which
can label any case.

### Q5. How a label change is saved

Options:
- **(a)** A new case action through `vitally_apply_action`. It bumps
  `cases.revision`.
- **(b)** Separate RPCs, like the contact log. They leave the revision alone.

**Decided (user): (b), two separate functions plus "mark as removed".**

- `vitally_set_case_label(action_id, case_id, label_id, on)`:
  - Who: a cleared staff member who works on the case, on a case that isn't
    closed.
  - Writes: the link row (a status change, never a delete) and a `case_events`
    history row.
  - Does not write: `cases.revision`, `cases.updated_at`, or any
    `client_events`.
  - Setting the state a label already has changes nothing, so two people adding
    the same label at once both succeed.
- `vitally_save_label(action_id, label_id or null, expected_revision, {name, color})`:
  - Who: a cleared admin.
  - Creates a label (no id) or renames/recolors one, with the label's own
    revision check.
- **Removing is a status change, not a delete.** Realtime never publishes
  deletes, so a deleted link would leave a stale chip in other open windows.
  Adding a label back reactivates the same row.

Why:
- A label is a light marker. It must not refuse a preparer's half-finished
  review with "Someone else updated this application."
- Labelling must not push a case to the top of the case pool, which is sorted
  by `updated_at`.
- The contact log already set this precedent, for the same reason.

Rejected: (a), because of the conflict scenario above.

### Q6. The case pool's label filter

Options:
- **(a)** A single-choice dropdown like the other pool filters.
- **(b)** A multi-select popup.

**Decided (user): (a), with `No label`.** The dropdown is labelled "Label" and
offers `Any label`, each label by name, and `No label`. It works with the
existing filter state and "Clear filters".

This differs from the design picture, which shows a "Labels" button. The
difference is accepted and is recorded in design.md.

Rejected: (b), because it needs a new popup control, keyboard handling and an
any/all rule, for combinations an office rarely needs.

### Defaults (proposed, accepted by the user)

1. **Names:** 1-24 characters after trimming, and unique per workspace ignoring
   case.
2. **Order:** chips and menu entries are sorted by name.
3. **Placement:** on the work board and the case pool, chips go under the
   reference, as in the designs. The work board gets no label filter in this
   change.
4. **History:**
   - Staff history shows lines like "<person> added label City Tax" and
     "<person> removed label MFS".
   - An admin's rename or recolor is recorded on the label, not on each case.
   - A client sees nothing.
5. **Seed data:** `npm run seed:local` puts a few labels on rehearsal cases.
6. **Clearance:** labels follow the clearance gate. An uncleared staff member
   can't read labels or change them.

## Constraints

- Labels are **staff-only**. A client session reads no label and no link, not
  even on its own case, and receives none over Realtime. "MFS" discloses a
  filing status.
- The database is the only writer. Browsers get `SELECT` only, and RLS is
  enabled on both new tables. There are composite `(workspace_id, id)` foreign
  keys, length and value `CHECK`s, and typed `VT00N` errors.
- Migrations are hand-written. This one is **051**, because 047-050 are taken
  on open branches.
- Staff screens stay English. No client text changes, so `build:hant` is not
  needed.
- Fictional data only.

## Builder's calls (made while writing this up; open to correction at review)

- **Starter labels are not added in `initialize_workspace`.**
  `add-account-invitations` (047) replaces that function, and copying it here
  would collide with that branch at merge time. Instead:
  - an `after insert` trigger on `public.workspaces` creates the three starter
    labels;
  - the migration adds them once to every existing workspace.
- **Two more browser-callable RPCs, not "ten".** Other open branches also add
  RPCs, so the pinned signature list (`tests/support/rpc-signatures.mjs`) and
  `STAFF_TABLES` are expected merge points. Whoever merges second resolves them.
- **The three new colors:** green, violet and slate, each with the same four
  shades as the existing ones. The exact hex values are chosen for legibility
  next to the existing tokens.
- **The two tables:**
  - `case_labels`: `workspace_id`, `id`, `name`, `color`, `revision`, and who
    created and last changed it, and when.
  - `case_label_links`: `workspace_id`, `case_id`, `label_id`, `active`, who
    changed it, and when.

  Both go in the Realtime publication and are watched by staff windows only.
  The exact columns are left to design.md.

## Follow-ups (not in this change)

- Deleting a label: decide what happens to cases that carry it (a new issue).
- Label chips on the volunteer dashboard, once the dashboard exists.
- A "New label" office notice, once posted updates (`add-posted-updates`) are
  on `main`.
- A label filter on the work board, if volunteers ask for one.
