## Context

Issue #148 asks for case labels (City Tax, MFS, Multi-state) and a label filter in the admin case pool. The user agreed the design decision by decision; `brainstorm.md` records that conversation. This document turns those decisions into the technical design.

Current state (`main` at 6add349):

- **Staff screens:**
  - the case header is `caseHeader` and the work board is `renderStaffBoard`, both in `src/staff-views.mjs`;
  - the admin case pool is `src/pool-views.mjs`, whose filters are single-choice dropdowns kept in `state.boardFilters` with a "Clear filters" button;
  - the volunteer dashboard is not built.
- **Label colors:** `src/styles.css:49-60` holds three unused color sets named per label (`--vt-label-city-tax-*`, `--vt-label-multi-state-*`, `--vt-label-mfs-*`).
- **Writes:**
  - every write goes through a `SECURITY DEFINER` RPC, and browsers have `SELECT` only;
  - case actions through `vitally_apply_action` bump `cases.revision` and `updated_at`;
  - the contact log (031, current definitions in 045) uses its own RPCs and leaves the case row alone;
  - `vitally_private.works_on_case` (013) is "admin or followup, or the case's preparer or reviewer". Fed the person from `contact_person` (045), it sees the *effective* capabilities.
- **Clearance (045):** every staff SELECT policy on case data is gated by `vitally_policy.cleared_workspace_id()`, and the case RPCs call `require_cleared` right after `acting_person`.
- **Realtime** publishes INSERT and UPDATE only. The browser treats each event as "something changed" and re-reads. `SUBSCRIBED_TABLES` in `src/supabase-store.mjs` must match the publication, and a test asserts it.
- **Open branches:**
  - they hold migrations 047-050;
  - `add-account-invitations` (047) replaces `initialize_workspace`;
  - both it and `add-posted-updates` (049) add RPCs to `tests/support/rpc-signatures.mjs`;
  - `add-posted-updates` also adds a table to `STAFF_TABLES` and edits the `volunteer-clearance` spec.

Stakeholders: office admins (create and manage labels), volunteers (apply labels on their cases), the course team (merges from several branches).

## Goals / Non-Goals

**Goals:**
- Labels are created per workspace. Each has a name and one of six fixed colors, and the three starter labels exist in every workspace.
- Admins create, rename and recolor labels inline, from the case header's label menu.
- Staff who work on a case add and remove its labels from the case header. Labels are frozen when the case is closed.
- Chips appear in the case header, on the work board and in the admin case pool. The pool has a single-choice Label filter with `No label`.
- A label change is recorded in the staff history. It never changes the case's `revision` or `updated_at`.
- Other open staff windows update live, including when a label is removed.
- Clients never see labels, by RLS and over Realtime.

**Non-Goals:**
- Deleting a label (a follow-up issue).
- Chips on the volunteer dashboard (not built yet).
- A "New label" office notice (posted updates are not on `main`).
- A work board label filter.
- A multi-select filter.
- Labels on assistance items or Follow-ups.
- Any client-facing text.

## Decisions

### D1: Two tables: label definitions and per-case links
- **Choice:**
  - `public.case_labels`:
    - columns `workspace_id`, `id`, `name`, `color`, `revision`, `created_by_person_id`, `created_at`, `updated_by_person_id`, `updated_at`;
    - unique `(workspace_id, id)`, and a unique index on `(workspace_id, lower(name))`;
    - checks: `name` equals its trimmed self and has 1-24 characters; `color in ('sky','amber','pink','green','violet','slate')`.
  - `public.case_label_links`:
    - columns `workspace_id`, `case_id`, `label_id`, `active`, `changed_by_person_id`, `changed_at`;
    - primary key `(case_id, label_id)`;
    - composite foreign keys to `cases(workspace_id, id)` (on delete cascade) and to `case_labels(workspace_id, id)`.
- **Rationale:**
  - A case points to a label, so a rename or recolor shows everywhere at once.
  - The composite keys keep every link inside its workspace, as the other tables do.
- **Alternative considered:** a `labels text[]` column on `cases`. Rejected for three reasons:
  - a rename would have to rewrite every case;
  - Realtime would send the whole case row;
  - and writing it would touch the case row we deliberately leave alone (D3).

### D2: A removed label is a status change, not a delete
- **Choice:** removing sets `active = false`, and adding it back sets `active = true` on the same row. Each sets `changed_by_person_id` and `changed_at`. No function deletes a link.
- **Rationale:** Realtime never publishes deletes, so a deleted link would leave a stale chip in every other open window until a reload. An update is published and filtered by RLS.
- **Alternative considered:** delete the link and bump some other published row to nudge the windows. Rejected: it's indirect and fragile.

### D3: Separate RPCs; the case row is never written
- **Choice:**
  - two new `public` RPCs, `vitally_set_case_label` and `vitally_save_label` (D4, D5);
  - neither goes through `vitally_apply_action`, and neither changes `cases.revision` or `updated_at`;
  - `vitally_set_case_label` still takes the case's row lock (`lock_case`), so it serializes with case actions and applies the visibility rule;
  - each RPC stores its own receipt.
- **Rationale:**
  - A label is a light marker. It must not refuse another window's half-finished review with `CONFLICT`, or move the case to the top of the pool (which is sorted by `updated_at`).
  - The contact log set this precedent for the same reason.
- **Alternative considered:** a case action `SET_CASE_LABEL`. Rejected because it bumps the revision and causes the conflict above. It would also mean redefining `vitally_apply_action`, `check_operation_authority` and `check_payload`, which other branches also replace.

### D4: `vitally_set_case_label(p_action_id uuid, p_case_id uuid, p_label_id uuid, p_on boolean)`
- **Check order** (mirrors `vitally_log_contact` and the documented case check order):
  1. `require_membership`.
  2. `acting_person`, then `require_cleared` (`VT009`).
  3. Null arguments → `VALIDATION`.
  4. A caller that is not staff → `FORBIDDEN`.
  5. Digest of `{operation: 'SET_CASE_LABEL', caseId, labelId, on, personId}`, then `reserve_receipt`. An identical replay returns the stored receipt after re-checking the person.
  6. `lock_case` → `NOT_FOUND` (a missing case, a case in another workspace and a client's draft all look the same).
  7. `contact_person`. If `works_on_case` is false → `FORBIDDEN`.
  8. The label must exist in the case's workspace → `VALIDATION`, as for any related record.
  9. Stage `closed` → `INVALID_TRANSITION`.
- **Effect:**
  - Upsert the link.
  - If the label's state actually changed, insert one `case_events` row: action `ADD_CASE_LABEL` or `REMOVE_CASE_LABEL`, with `detail {labelId, name}`. The name is the one at that moment, so the history keeps reading correctly after a rename.
  - If nothing changed (it was already on, or already off), write no event, but still return a receipt.
  - Never write `client_events`.
- **Receipt:** `{actionId, caseId, labelId, on}`.
- **Why "set to on/off" and not "toggle":** two people adding the same label at once both succeed and agree on the result. A toggle would undo the first add.

### D5: `vitally_save_label(p_action_id uuid, p_label_id uuid, p_expected_revision bigint, p_label jsonb)`
- **Checks** (in this order):
  1. `require_membership`, `acting_person`, `require_cleared`.
  2. Staff, with the `admin` effective capability → else `FORBIDDEN`.
  3. `p_label` has exactly the keys `{name, color}`. `name` is trimmed, then 1-24 characters; `color` is one of the six. Anything else → `VALIDATION`.
  4. Receipt reserved over the digest; a replay returns the stored receipt.
- **Create** (`p_label_id` null, `p_expected_revision` null):
  - inserts with `revision 1`;
  - a name that matches another label's, ignoring case → `VALIDATION`.
- **Edit:**
  - locks the label in the caller's workspace (`NOT_FOUND` if absent);
  - a revision mismatch → `CONFLICT`;
  - a name clash → `VALIDATION`;
  - then updates `name` and `color`, increments `revision`, and sets `updated_by_person_id` and `updated_at`.
- **Receipt:** `{actionId, labelId, revision}`.
- **No case history.** A rename is recorded on the label itself, not on every case.
- **Browser behaviour:** it checks name clashes against the labels it holds and shows "A label with this name already exists" before it sends anything. The server's `VALIDATION` is the backstop.

### D6: Visibility and clearance
- **Choice:**
  - `case_labels` gets one SELECT policy for `authenticated`: a staff membership in the row's workspace, plus `workspace_id = (select vitally_policy.cleared_workspace_id())`.
  - `case_label_links` gets the inline case-visibility rule, staff branch only, plus the same clearance gate.
  - There is no applicant branch on either table.
  - Both tables: `enable row level security`, `grant select` to `authenticated` only, and nothing for `anon`.
- **Rationale:** labels are staff-only ("MFS" discloses a filing status). Gating by clearance keeps the 045 rule that an uncleared staff member reads no case data.
- **Spec impact:**
  - `volunteer-clearance`'s list of gated tables grows from 21 to 23;
  - its list of RPCs that call `require_cleared` gains the two new ones;
  - `staff-case-work`'s list of staff-readable tables gains labels.

### D7: Starter labels through a trigger, not `initialize_workspace`
- **Choice:**
  - an `after insert` trigger on `public.workspaces` inserts City Tax (sky), MFS (pink) and Multi-state (amber), with no creating person;
  - the migration inserts the same three into every existing workspace that lacks a label of that name, ignoring case.
- **Rationale:** `add-account-invitations` (047) replaces `initialize_workspace`. Copying that function here would collide when the two branches merge, and whichever merged second would silently drop the other's version.
- **Alternative considered:** a new `create or replace initialize_workspace`. Rejected for the merge reason above.

### D8: Six colors, tokens named by color
- **Choice:**
  - rename the three token sets to `--vt-label-sky-*`, `--vt-label-amber-*` and `--vt-label-pink-*`, with the same values;
  - add `green`, `violet` and `slate`, each with the same four shades (base, `-bg`, `-ink`, `-line`);
  - a chip renders as `<span class="case-label" data-color="sky">`, and CSS maps `data-color` to the tokens;
  - the browser never puts a database value into a `style` attribute.
- **Rationale:** the database can only hold one of six names (D1), so no stored value reaches CSS unchecked.
- **Alternative considered:** a free hex color. Rejected: it allows unreadable colors and puts unchecked values into CSS.

### D9: Browser data flow
- **Loading:**
  - the store's case list read also reads `case_labels` and active `case_label_links`, and attaches `record.labels = [{id, name, color}]` to each case, sorted by name;
  - the workspace's labels are kept as `state.labels` for the menu and the filter;
  - `case_labels` and `case_label_links` join `STAFF_TABLES`, so any event re-reads as today.
- **Store calls:** `saveLabel({labelId, expectedRevision, label})` and `setCaseLabel({caseId, labelId, on})`. Each sends a fresh action id, which a retry reuses, as other calls do.
- **Eligibility in the browser:** `canLabelCase(record, person)` mirrors `works_on_case` (`admin` or `followup` in the person's effective capabilities, or the case's preparer or reviewer) and requires that the case is not closed. `canManageLabels(person)` is `admin`. These rules only decide what is shown; the database decides what is allowed.

### D10: The label menu in the case header
- **Choice:**
  - The header gets a chip row after the existing badges, holding each label's chip.
  - When `canLabelCase`, each chip gets a remove button (`×`, accessible name "Remove label <name>"), and the row ends with a `+ Add a label` button.
  - The button opens a small panel with:
    - a search box;
    - one toggle per workspace label (`aria-pressed` shows whether it's on the case);
    - for an admin, a pencil per label that opens the inline rename/recolor form (name field plus six color swatches as radio buttons, then Save and Cancel);
    - for an admin, when the search text matches no label's name ignoring case, a `+ Create "<text>"` row that opens the same form, pre-filled.
  - Escape and a click outside close the panel. Focus returns to the `+ Add a label` button.
  - Staff who can't label a case see the chips read-only.
- **Redraws:** the panel's open state and search text live in UI state, so a live redraw keeps them. The existing redraw hold during a press (#186) applies.
- **Alternative considered:** a native `<select multiple>`. Rejected: it can't hold the create row or the edit pencil.

### D11: Work board and case pool
- **Choice:**
  - Both tables show the case's chips under the reference, as in the designs, read-only.
  - The pool gets a "Label" `filterSelect` (key `poolLabel`) with `Any label`, each label by name, and `No label`.
  - `filterPool` matches a case when the chosen label is among its active labels, or, for `none`, when it has none.
  - `poolLabel` joins `DEFAULT_POOL_FILTERS`, so "Clear filters" and the tab counts include it.
  - A chosen label that no longer exists falls back to `all`.
- **Recorded difference from the design picture:** the picture shows a "Labels" button that suggests a multi-select popup. We use a dropdown, as the user decided (brainstorm Q6).

### D12: History text and seed data
- **History lines:**
  - staff history shows "<person> added label <name>" and "<person> removed label <name>", from `detail.name`;
  - a case event with an unknown label id still reads correctly, because the name is stored in the event;
  - clients get no line.
- **Seed data:** `tools/admin/seed-cases.mjs` labels a few rehearsal cases through `vitally_set_case_label`, acting as an admin, so the demo shows chips. Each starter label goes on at least one case, and one case gets two labels.

## Risks / Trade-offs

- **[Risk]** Merge conflicts with `add-account-invitations` and `add-posted-updates`: both edit `tests/support/rpc-signatures.mjs`, and the latter also edits `STAFF_TABLES`, the clearance policy count and the `volunteer-clearance` spec.
  - Mitigation: our edits are additive (list entries); D7 avoids `initialize_workspace`. Whoever merges second resolves the lists and the count, and the PR body names the merge points.
- **[Risk]** Migration number 051 could be taken by another branch first.
  - Mitigation: check open branches again before the PR, and renumber if needed (it's an unapplied branch migration).
- **[Risk]** `vitally_set_case_label` takes the case row lock, so a label click can wait briefly behind a running case action.
  - Mitigation: these are short transactions, and the lock keeps the visibility rule and ordering consistent with every other writer.
- **[Risk]** A stale menu (labels renamed in another window) might send an old name.
  - Mitigation: links point at label ids, not names. An edit uses the label's own `revision` → `CONFLICT`; the browser re-reads and reopens the form.
- **[Trade-off]** The history stores the label's name at the time, so after a rename an old line shows the old name. Accepted: the history records what was true then.
- **[Trade-off]** With no delete, a mistaken label can only be renamed into something useful or left unused. Accepted until the follow-up issue.
- **[Trade-off]** The filter is a single choice, unlike the multi-select the design picture suggests. Accepted (Q6).

## Migration Plan

1. **Write `supabase/migrations/051_case_labels.sql` (hand-written):**
   - the two tables, checks, indexes, RLS policies and grants;
   - the trigger on `workspaces`, and the one-time starter-label insert for existing workspaces;
   - the two RPCs and their private helpers;
   - `alter publication supabase_realtime add table` for both tables;
   - the closing `revoke all on all functions in schema vitally_private …`, plus revoke and grant for the two `public` functions.
2. **Apply locally:** `npm run db:migrate:test`, then `npm run test:database`. Run this on a stack that already has `main`'s migrations, because the starter-label insert changes existing rows (CLAUDE.md: CI starts from an empty database).
3. **Rollback:** migrations are forward-only. Undoing means a later migration that drops the two RPCs, the trigger and the two tables (and removes them from the publication). No existing table or function is changed, so nothing else needs restoring.
4. **Docs:** update `docs/developer/database.md`:
   - the migration row;
   - the tables;
   - who can see what;
   - the API list and "Who is acting";
   - Realtime;
   - the current-definition table.
   
   Also update `docs/developer/frontend.md` for the label menu and the pool filter.

## Open Questions

- **The hex values of the three new colors** (green, violet, slate): the builder picks them for legibility next to the existing tokens and checks the contrast of `-ink` on `-bg`. This affects only appearance. Owner: the implementer; the user reviews the screenshots.
- **The follow-up issue for deleting a label:** to be filed by the user (`gh` isn't installed here). Claude drafts the text. It affects nothing in this change.
