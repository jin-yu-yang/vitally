# Case Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff-only case labels (City Tax, MFS, Multi-state, and admin-made ones), shown in the case header, on the work board and in the admin case pool, with a single-choice Label filter in the pool.

**Architecture:**
- **Database:** migration 051 adds two tables, `case_labels` and `case_label_links`, and two `SECURITY DEFINER` RPCs, `vitally_save_label` and `vitally_set_case_label`. The RPCs follow the contact log's pattern: their own receipts, the case row lock, and no change to the case's `revision` or `updated_at`. A removed label is an inactive link, never a deleted row, so Realtime reports the removal.
- **Browser:** the browser reads labels with the case list, renders color-named chips, and drives a label menu in the case header. The database is the only authority.

**Tech Stack:** PostgreSQL on local Supabase (hand-written SQL migrations, RLS, Realtime), plain ES modules (`src/*.mjs`), `node:test` unit and database suites, and the Playwright story (`tests/browser.mjs`).

**Spec:** `openspec/changes/add-case-labels/`:
- `specs/case-labels/spec.md` (new capability);
- `specs/volunteer-clearance/spec.md` and `specs/staff-case-work/spec.md` (modified);
- `design.md` (decisions D1-D12);
- `brainstorm.md` (the agreed decisions).

## Global Constraints

- **Migration:** `supabase/migrations/051_case_labels.sql`, hand-written. Never edit an applied migration. 047-050 are taken on open branches, so re-check before the PR.
- **Colors:** exactly `sky`, `amber`, `pink`, `green`, `violet` and `slate`.
- **Starter labels:** City Tax = `sky`, MFS = `pink`, Multi-state = `amber`.
- **Label names:** stored trimmed, 1-24 characters, unique per workspace by `lower(name)`.
- **Errors:** raised only as `raise sqlstate 'VT00N' using message='NAME'`. The codes are `VT001` FORBIDDEN, `VT002` NOT_FOUND, `VT003` CONFLICT, `VT004` INVALID_TRANSITION, `VT007` VALIDATION and `VT009` NOT_CLEARED.
- **Private functions:** every `vitally_private` function is `security definer set search_path=''`. The migration ends with `revoke all on all functions in schema vitally_private from public, anon, authenticated, service_role;`.
- **Public functions:** each new `public` function gets `revoke all … from public,anon,authenticated,service_role; grant execute … to authenticated;`.
- **Browser roles** get `SELECT` only on the new tables. No applicant policy branch.
- **No case writes:** neither RPC writes `cases`, `client_events` or `case_events` beyond D4's two event types.
- **Language and data:** staff screens are English, there is no client text (no `build:hant`), and all data is fictional.
- **Do not redefine** `initialize_workspace`, `vitally_apply_action`, `check_payload` or `check_operation_authority`.
- **Where to run:** in the change's worktree. Database commands need the local stack from `docs/setup.md` (`$VITALLY_STACK`). Never run `supabase start` from the repo root.

## Review Focus

1. **A removal reaching other windows.** Removing a label must reach another open window live. A deleted row would not; the link has to be marked inactive. Owned by Task 3 (realtime test) and Task 10 (story).
2. **Concurrent adds of the same label.** Both must succeed, leaving one link and one history line. Owned by Task 3.
3. **A rename while a case window is open.** The chip and the pool filter options must follow the new name, and the old history line must keep the old name. Owned by Task 3 (detail.name) and Task 8 (render from `record.labels`).
4. **The pool filter holding a stale label id**, e.g. a label created and then the window reloaded in another workspace. It must fall back to `Any label`, not show an empty pool. Owned by Task 8.
5. **A label applied by a preparer who is then reassigned away** (ASSIGN_CASE). The label stays on the case, and the former preparer loses the controls. Owned by Task 3 (stays) and Task 5 (`canLabelCase` uses the current holder).

---

### Task 1: Tables, starter labels, visibility and Realtime

**Files:**
- Create: `supabase/migrations/051_case_labels.sql` (sections 1-4 of the file; the RPCs come in Tasks 2-3)
- Create: `tests/database-labels.mjs`

**Interfaces:**
- **Produces the tables:**
  - `public.case_labels(workspace_id uuid, id uuid default gen_random_uuid(), name text, color text, revision bigint default 1, created_by_person_id uuid null, created_at timestamptz, updated_by_person_id uuid null, updated_at timestamptz)`;
  - `public.case_label_links(workspace_id uuid, case_id uuid, label_id uuid, active boolean, changed_by_person_id uuid, changed_at timestamptz, primary key(case_id,label_id))`.
- **Keys and indexes:**
  - unique `(workspace_id,id)` on `case_labels`;
  - unique index `case_labels_name_key on (workspace_id, lower(name))`;
  - foreign keys `(workspace_id,case_id) → cases(workspace_id,id) on delete cascade`, `(workspace_id,label_id) → case_labels(workspace_id,id)`, and the person columns `→ people(workspace_id,id)`.
- **Produces the trigger:** `vitally_private.add_starter_labels()` on `public.workspaces` (after insert, for each row).

- [ ] **Step 1: Write the failing database tests** in `tests/database-labels.mjs`. Use `createDatabaseFixture()` and `f.sql`, as in `tests/database-contacts.mjs`.
  - `starter labels in a new workspace`: `select name,color from case_labels where workspace_id=$1 order by name` returns `[{City Tax,sky},{MFS,pink},{Multi-state,amber}]` for `f.workspaceId`, and the same for `f.foreignWorkspaceId`.
  - `names are checked`:
    - a privileged insert of `' Amended'`, `''`, a 25-character name, and `'city tax'` (a clash) each fails;
    - a color of `'red'` fails;
    - `'Amended'`/`'sky'` succeeds.
  - `clients read no labels`: `f.applicantA.from("case_labels").select()` and `.from("case_label_links").select()` return `[]`, after a privileged insert of a link on applicant A's submitted case (`f.submittedClientCase()`).
  - `staff read their workspace only`:
    - `f.preparer.from("case_labels")` returns exactly the 3 rows of `f.workspaceId`;
    - links on a case in `f.foreignWorkspaceId` are never returned.
  - `uncleared staff read nothing`: `f.staff({key:"uncleared", name:"Kai Moreno", capabilities:["prepare"], cleared:false})` reads `[]` from both tables.
  - `no write grants`: a staff client's `.insert`, `.update` and `.delete` on both tables each return an error, and the row count is unchanged.
- [ ] **Step 2: Run, and expect FAIL** (relation does not exist): `npm run db:migrate:test && node --env-file=.env.test --test tests/database-labels.mjs`.
- [ ] **Step 3: Write sections 1-4 of `051_case_labels.sql`.**
  - **Header comment:** what the migration adds, and the merge points (D7, Risks).
  - **The two tables (D1):** checks `name = btrim(name) and char_length(name) between 1 and 24` and `color in (...)`.
  - **RLS:** `enable row level security`, `grant select … to authenticated`, nothing for `anon`.
  - **Policy `staff_read_case_labels`:** a staff membership in the row's workspace, and `workspace_id = (select vitally_policy.cleared_workspace_id())`.
  - **Policy `staff_read_case_label_links`:** the inline case-visibility rule from `docs/developer/database.md` §Who can see what, staff branch only, plus the same gate.
  - **Starter labels:**
    - the trigger function `add_starter_labels()` inserts the three starters `on conflict do nothing`;
    - a one-time `insert … select` for existing workspaces, skipping a workspace with a same-named label ignoring case.
  - **Realtime:** `alter publication supabase_realtime add table public.case_labels, public.case_label_links;`.
- [ ] **Step 4: Run, and expect PASS:** the same command.
- [ ] **Step 5: Commit:** `git add supabase/migrations/051_case_labels.sql tests/database-labels.mjs && git commit -m "Case labels: tables, starter labels, staff-only visibility (051)"`.

### Task 2: `vitally_save_label`

**Files:**
- Modify: `supabase/migrations/051_case_labels.sql` (section 5)
- Modify: `tests/database-labels.mjs`
- Modify: `tests/support/database-fixture.mjs` (add `f.saveLabel`)

**Interfaces:**
- **Consumes:** Task 1's tables, and `vitally_private.require_membership()`, `acting_person(memberships)`, `require_cleared(memberships)` and `reserve_receipt(member, action_id, operation, digest, person_id)` (current definitions: 045 and 040).
- **Produces:**
  - `public.vitally_save_label(p_action_id uuid, p_label_id uuid, p_expected_revision bigint, p_label jsonb) returns jsonb`, which returns `{actionId, labelId, revision}`;
  - `vitally_private.check_label(p_label jsonb) returns jsonb`, which returns `{name (trimmed), color}` or raises `VT007`;
  - the fixture helper `f.saveLabel(client, {labelId=null, expectedRevision=null, name, color}) → {data, error}`.

- [ ] **Step 1: Write the failing tests:**
  - `an admin creates a label`: `f.saveLabel(f.siteCoordinator, {name:"Amended", color:"green"})` returns `revision: 1`, and the row exists with `created_by_person_id = f.siteCoordinatorId`.
  - `an admin renames and recolors`: City Tax at revision 1 becomes `{name:"City tax (Phila.)", color:"violet"}` → `revision: 2`.
  - `refusals in order`:
    - uncleared admin → `VT009`;
    - client → `VT001`;
    - `f.preparer` → `VT001`;
    - extra key `{name, color, x}` → `VT007`;
    - name `"   "` → `VT007`;
    - a 25-character name → `VT007`;
    - color `"#ff0000"` → `VT007`;
    - name `"mfs"` (a clash) → `VT007`;
    - unknown id → `VT002`;
    - a foreign-workspace label id → `VT002`;
    - a stale revision → `VT003`.
    
    Each is checked with the `refuse()` helper pattern from `tests/database-contacts.mjs` (no receipt left behind).
  - `replay`: the same action id and arguments return an equal receipt, and the revision stays the same. The same id with another name → `VT007`.
  - `no case history`: the `case_events` count for the workspace is unchanged after a rename.
- [ ] **Step 2: Run, and expect FAIL** (the function does not exist).
- [ ] **Step 3: Implement it.**
  - **Check order:** D5 — membership, acting person, `require_cleared`, staff + effective `admin` (else `VT001`), `check_label`, the digest of `{operation:'SAVE_LABEL', labelId, expectedRevision, label, personId}`, and `reserve_receipt(…,'SAVE_LABEL',…)`.
  - **Replay:** returns `v_receipt.receipt`.
  - **Create:** requires `p_expected_revision is null`, else `VT007`.
  - **Edit:** `select … for update` in the caller's workspace, the revision check, then update.
  - **Name clash:** check via `lower(name)` before writing (raise `VT007`). Also catch `unique_violation` from a race and re-raise it as `VT007`.
  - **Grants:** revoke and grant as in Global Constraints.
- [ ] **Step 4: Run, and expect PASS:** `npm run db:migrate:test && node --env-file=.env.test --test tests/database-labels.mjs`. If 051 was already applied on this stack, forget it first (`docs/developer/database.md` §Migrations, "Re-applying a changed migration").
- [ ] **Step 5: Commit:** "Case labels: vitally_save_label".

### Task 3: `vitally_set_case_label`

**Files:**
- Modify: `supabase/migrations/051_case_labels.sql` (section 6)
- Modify: `tests/database-labels.mjs`
- Modify: `tests/support/database-fixture.mjs` (add `f.setCaseLabel`)

**Interfaces:**
- **Consumes:** Task 1; `lock_case(member, case_id) returns cases` (043); `contact_person(member, person_id) returns people` (045); `works_on_case(cases, people)` (013).
- **Produces:**
  - `public.vitally_set_case_label(p_action_id uuid, p_case_id uuid, p_label_id uuid, p_on boolean) returns jsonb`, which returns `{actionId, caseId, labelId, on}`;
  - `case_events.action` values `ADD_CASE_LABEL` and `REMOVE_CASE_LABEL` with `detail {labelId, name}`;
  - the fixture helper `f.setCaseLabel(client, caseId, labelId, on) → {data, error}`.

- [ ] **Step 1: Write the failing tests:**
  - `the preparer adds and removes`, on `f.preparedCase()`:
    - the add leaves one active link and one `ADD_CASE_LABEL` event whose detail is `{labelId, name:"Multi-state"}` and whose `actor_person_id` is `f.preparerId`;
    - the remove leaves the link `active=false` (the row still exists) and adds a `REMOVE_CASE_LABEL` event.
  - `the office labels any case`: `f.siteCoordinator` on a case at `screening` succeeds.
  - `refusals in order`:
    - uncleared → `VT009`;
    - client → `VT001`;
    - a draft (`f.draftCase(f.applicantA)`) → `VT002`;
    - a case in `foreignWorkspaceId` → `VT002`;
    - `f.reviewer` on a case where they are not the reviewer → `VT001`;
    - a foreign label id → `VT007`;
    - a closed case (`CLOSE_CASE` via `f.act`) → `VT004`.
    
    Each refusal leaves no receipt, no link change and no event.
  - `unchanged state writes nothing`: adding twice leaves one event, and removing a label never set leaves no event. Both return receipts.
  - `concurrent adds`: `Promise.all` of the site coordinator's and the preparer's adds → both succeed, with one link and one event.
  - `the case row is untouched`:
    - `cases.revision` and `updated_at` are equal before and after an add;
    - then `f.act(f.preparer, caseId, "SUBMIT_REVIEW", …)` at the pre-label revision succeeds.
  - `replay`: the same id and arguments → the same receipt and one event. The same id with `on:false` → `VT007`.
  - `reassignment keeps labels`: after `f.reassignPreparer(...)`, the link is still active, and the former preparer's set → `VT001`.
  - `history keeps the old name`: add City Tax, rename it (Task 2) → the event detail `name` is still "City Tax".
  - **Realtime**, in `tests/database-realtime.mjs`, following its existing subscription helper:
    - a cleared staff subscriber gets an UPDATE on `case_label_links` when a label is removed;
    - applicant A, subscribed while staff add a label to A's case, gets no event for either table.
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement it.**
  - **Check order:** D4 — membership, acting person, `require_cleared`, null arguments → `VT007`, staff-only → `VT001`, the digest of `{operation:'SET_CASE_LABEL', caseId, labelId, on, personId}`, `reserve_receipt`, and on replay `contact_person` before returning the receipt. Then `lock_case`, `contact_person`, `works_on_case` (else `VT001`), the label in `v_case.workspace_id` (else `VT007`), and `stage='closed'` → `VT004`.
  - **The write:** `insert … on conflict (case_id,label_id) do update set active=excluded.active, … where case_label_links.active is distinct from excluded.active returning …`. Write the event only when a row was inserted or changed.
  - **Grants:** revoke and grant.
- [ ] **Step 4: Run, and expect PASS:** `node --env-file=.env.test --test tests/database-labels.mjs tests/database-realtime.mjs`.
- [ ] **Step 5: Commit:** "Case labels: vitally_set_case_label".

### Task 4: Shared database contracts

**Files:**
- Modify: `tests/support/rpc-signatures.mjs`, `tests/database-clearance.mjs`, `tests/database-catalog.mjs`, plus any test that counts published tables (find them with `grep -rn "supabase_realtime\|21 tables\|six RPCs" tests/`)

**Interfaces:**
- **Consumes:** Tasks 1-3.

- [ ] **Step 1:** Add both signatures to `RPC_SIGNATURES` (argument names and types exactly as in Tasks 2-3, returning `jsonb`).
- [ ] **Step 2: Update the clearance tests:**
  - the gated-table list gains `case_label_links` and `case_labels` (23 in all);
  - the "each case RPC refuses an uncleared staff member" list gains `vitally_set_case_label` and `vitally_save_label` (eight);
  - the catalog check that every staff policy calls `cleared_workspace_id()` covers the two new policies;
  - the visibility-rule copies test (`database.md`: "A database test checks that all copies agree") includes `staff_read_case_label_links`.
- [ ] **Step 3: Run the whole suite:** `npm run db:migrate:test && npm run test:database`. Expected: all pass (448 + new).
- [ ] **Step 4: Commit:** "Case labels: RPC signatures and clearance lists".

### Task 5: Store and browser eligibility

**Files:**
- Modify: `src/supabase-store.mjs` (`STAFF_TABLES`; `listCases()` at about line 465; new `listLabels`, `saveLabel` and `setCaseLabel` beside `logContact` at about line 724)
- Create: `src/case-labels.mjs`
- Test: `tests/store.test.mjs`, new `tests/case-labels.test.mjs`

**Interfaces:**
- **Produces:**
  - `LABEL_COLORS = ["sky","amber","pink","green","violet","slate"]`;
  - `canLabelCase(record, person) → boolean`: `admin` or `followup` in `person.capabilities`, or `person.id` is `record.preparerId` or `record.reviewerId`; and `record.stage !== "closed"`;
  - `canManageLabels(person) → boolean`: `admin`;
  - `sortLabels(labels) → labels`, by name with `localeCompare`, sensitivity `base`;
  - `labelNameTaken(labels, name, exceptId = null) → boolean`, comparing trimmed names ignoring case;
  - the store's `listCases()` gives each case `labels: [{id,name,color}]`, sorted, active links only;
  - `store.listLabels() → [{id,name,color,revision}]`;
  - `store.saveLabel({actionId, labelId, expectedRevision, label:{name,color}})`;
  - `store.setCaseLabel({actionId, caseId, labelId, on})`.

- [ ] **Step 1: Write the failing tests:**
  - `canLabelCase`: true for an admin on any open case, and for the preparer and the reviewer; false for another volunteer, and false for anyone on a closed case.
  - `labelNameTaken(["City Tax"], " city tax ")` is true; with `exceptId` set to the same label's id, it is false.
  - **Store tests** (follow the existing fake-client style in `tests/store.test.mjs`):
    - `listCases` attaches sorted labels and ignores inactive links;
    - `STAFF_TABLES` contains both tables;
    - `setCaseLabel` calls `rpc("vitally_set_case_label", {p_action_id, p_case_id, p_label_id, p_on})`;
    - `saveLabel` calls `rpc("vitally_save_label", {p_action_id, p_label_id, p_expected_revision, p_label})`.
- [ ] **Step 2: Run, and expect FAIL:** `node --test tests/case-labels.test.mjs tests/store.test.mjs`.
- [ ] **Step 3: Implement** the functions above.
- [ ] **Step 4: Run, and expect PASS.** Also run `npm run test:database` for `tests/database-store.mjs`, which reads the real database, so it covers `listCases`.
- [ ] **Step 5: Commit:** "Case labels: store calls and eligibility".

### Task 6: Controller

**Files:**
- Modify: `src/controller.mjs` (beside `logContact`, at about line 2961; export it in the returned object at about line 3206), `src/app.mjs` (click and key dispatch)
- Test: `tests/controller.test.mjs`

**Interfaces:**
- **Consumes:** Task 5.
- **Produces:**
  - **UI state:** `state.labels` (from `store.listLabels()`, loaded and refreshed with the case list), and `state.labelMenu = {caseId, search, editing: null | {labelId|null, name, color, error}} | null`.
  - **Controller methods:** `openLabelMenu(caseId)`, `closeLabelMenu()`, `setLabelSearch(text)`, `toggleCaseLabel(caseId, labelId, on)`, `startLabelEdit(labelId|null, name="")`, `saveLabelEdit({name, color})`.
  - **`data-action` values:** `open-label-menu`, `close-label-menu`, `toggle-case-label` (with `data-label-id` and `data-on`), `edit-label`, `create-label`, `save-label`, `cancel-label-edit`.

- [ ] **Step 1: Write the failing tests** (the fake store pattern already used for `logContact`):
  - `toggleCaseLabel` sends one `setCaseLabel` with a fresh action id; a retry after `OFFLINE` reuses it.
  - `saveLabelEdit` with a taken name sets `editing.error = "A label with this name already exists"` and sends nothing.
  - A `CONFLICT` from `saveLabel` re-reads the labels and keeps the form open with the fresh revision.
  - `saveLabelEdit` from the create row (`labelId` null) creates the label, then calls `setCaseLabel(caseId, newId, true)`.
  - A live list refresh keeps `state.labelMenu`.
  - `closeLabelMenu` clears it.
- [ ] **Step 2: Run, and expect FAIL:** `node --test tests/controller.test.mjs`.
- [ ] **Step 3: Implement it** with the same error handling as `logContact` (`runContactWrite` or its equivalent). Escape closes the menu in `app.mjs`, and focus returns to `[data-action="open-label-menu"]`.
- [ ] **Step 4: Run, and expect PASS.**
- [ ] **Step 5: Commit:** "Case labels: controller and menu state".

### Task 7: Chips, styles and the case header menu

**Files:**
- Modify: `src/styles.css:49-60` (tokens) plus new rules; `src/ui.mjs` (`labelChip`); `src/staff-views.mjs` (`caseHeader` at line 876 and the menu renderer)
- Test: `tests/ui.test.mjs`, `tests/staff-views.test.mjs`

**Interfaces:**
- **Consumes:** Tasks 5-6.
- **Produces:**
  - `labelChip({name, color}, {removeFor = null} = {}) → html`: renders `<span class="case-label" data-color="<color>">name</span>` (escaped). With `removeFor` set to a case id, it adds `<button data-action="toggle-case-label" data-on="false" aria-label="Remove label <name>">×</button>`. An unknown color renders as `slate`.
  - `caseHeader(record, person, principal, ui)`: takes `ui.labels` and `ui.labelMenu`, with the existing call sites updated.

- [ ] **Step 1: Write the failing tests:**
  - `labelChip({name:"<b>", color:"sky"})` escapes the name and has no `style=` attribute; `color:"red"` gives `data-color="slate"`.
  - **The case header for the preparer**, on a case with City Tax: the chip has a remove button and `+ Add a label`.
  - **For another volunteer:** the chip only, with no `toggle-case-label` and no `open-label-menu`.
  - **For a closed case and an admin:** the chip only.
  - **The menu open for an admin with search "Amended":** it contains `Create "Amended"` and one `edit-label` per label.
  - **For the preparer:** no `create-label` and no `edit-label`. The toggles carry `aria-pressed="true"` for labels already on the case.
  - **The edit form:** six radio inputs named `label-color`, with values exactly `LABEL_COLORS`.
- [ ] **Step 2: Run, and expect FAIL:** `node --test tests/ui.test.mjs tests/staff-views.test.mjs`.
- [ ] **Step 3: Implement it.**
  - **Tokens:** rename them `--vt-label-sky-*`, `--vt-label-amber-*` and `--vt-label-pink-*` (same values). Add green, violet and slate with base, `-bg`, `-ink` and `-line`, with each `-ink` on `-bg` at a 4.5:1 contrast or better.
  - **Rules:** `.case-label[data-color="…"]` for all six, plus the menu and chip-row rules.
  - **Design:** follow `case-preparer-view-v3-full-page.png` for the chip and button look.
- [ ] **Step 4: Run, and expect PASS.**
- [ ] **Step 5: Commit:** "Case labels: chips, colors and the case header menu".

### Task 8: Work board, case pool filter and history lines

**Files:**
- Modify: `src/staff-views.mjs` (`renderStaffBoard` row; the history map at about line 2184), `src/pool-views.mjs`
- Test: `tests/staff-views.test.mjs`, `tests/pool-views.test.mjs`

**Interfaces:**
- **Consumes:** `labelChip` (Task 7), and `record.labels` and `state.labels` (Task 5).
- **Produces:**
  - `poolLabel` in `DEFAULT_POOL_FILTERS` (default `"all"`; also `"none"` or a label id);
  - `renderCasePool(cases, people, ui)` reads `ui.labels`;
  - `poolFilters(filters, labels = [])` resets an unknown label id to `"all"`.

- [ ] **Step 1: Write the failing tests:**
  - **Work board:** a row of a case with MFS shows the chip under the reference, with no remove button.
  - **Pool filtering:**
    - `filterPool(cases, {...defaults, poolLabel: multiStateId})` returns only cases carrying it;
    - `poolLabel:"none"` returns only cases with `labels.length === 0`;
    - `poolCounts` follows it.
  - **Pool filter options:** the dropdown labelled "Label" reads, in order, `Any label`, `City Tax`, `MFS`, `Multi-state`, `No label`.
  - **Clearing:** choosing a label makes "Clear filters" appear.
  - **Unknown id:** `poolFilters({poolLabel:"unknown-id"}, labels).poolLabel === "all"`.
  - **History:** an `ADD_CASE_LABEL` entry with `{name:"City Tax"}` by Alex reads "Alex added label City Tax"; `REMOVE_CASE_LABEL` reads "removed label".
- [ ] **Step 2: Run, and expect FAIL:** `node --test tests/staff-views.test.mjs tests/pool-views.test.mjs`.
- [ ] **Step 3: Implement it.** Add the filter with `filterSelect("Label", "poolLabel", …)` after "Service". Chips go under the reference button in `poolRow` and in the board row. Update the call in `src/views.mjs` (around line 388) to pass `labels: state.labels`.
- [ ] **Step 4: Run, and expect PASS.** Then run `npm test` (the whole unit suite).
- [ ] **Step 5: Commit:** "Case labels: work board, case pool filter, history".

### Task 9: Seed data

**Files:**
- Modify: `tools/admin/seed-cases.mjs`
- Test: `tests/seed.test.mjs`, `tests/database-seed.mjs`

**Interfaces:**
- **Consumes:** `vitally_set_case_label` (Task 3), called through the file's `callRpc(client, userId, fn, args)` as the Site Coordinator.

- [ ] **Step 1: Write the failing tests:**
  - **`tests/database-seed.mjs`:** after the seed runs, each of City Tax, MFS and Multi-state is active on at least one case, and one case has two active labels.
  - **`tests/seed.test.mjs`:** the seed plan lists those label assignments (follow its existing structure).
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement it.** Look up the label ids by name, then make the calls after the cases reach their stages. Don't label a case the seed closes.
- [ ] **Step 4: Run, and expect PASS:** `npm test` and `node --env-file=.env.test --test tests/database-seed.mjs`.
- [ ] **Step 5: Commit:** "Case labels: seed rehearsal cases".

### Task 10: Story, docs and full verification

**Files:**
- Modify: `tests/browser.mjs`, `docs/developer/database.md`, `docs/developer/frontend.md`

- [ ] **Step 1: Add the story steps** (follow the file's existing two-window pattern):
  1. The preparer opens their case, adds Multi-state from `+ Add a label`, and a second staff window on the work board shows the chip without a reload.
  2. The preparer removes it, and the second window loses it.
  3. The site coordinator types "Amended", creates it in green, and it appears on the case.
  4. The site coordinator renames it "Amended return", and the chip updates.
  5. A volunteer who is neither preparer nor reviewer opens the case: there is no `+ Add a label` and no remove button.
  6. In the case pool, Label = City Tax narrows the list, and "Clear filters" restores it.
  
  Take a screenshot at steps 3 and 6.
- [ ] **Step 2: Run** `npm run test:browser` (about 20-25 minutes). Expected: PASS. Review the screenshots.
- [ ] **Step 3: Update the docs.**
  - **`docs/developer/database.md`:**
    - the migration count and the 051 row;
    - the two tables in §Tables;
    - §Who can see what;
    - the API table and the count of browser-callable functions;
    - "Who is acting" (the two RPCs resolve the person the same way);
    - the check order for both;
    - §Realtime (the table count and the list);
    - the current-definition table (the new functions → 051);
    - §Testing (`database-labels.mjs`).
  - **`docs/developer/frontend.md`:** the label menu and the pool filter.
- [ ] **Step 4: Final checks:** `npm test`, `npm run db:migrate:test`, `npm run test:database`, `npm run test:browser`, `npx openspec validate --all`. Record:
  - which checks ran;
  - that `build:hant` isn't needed (no client text);
  - that `test:auth-browser` isn't needed (sign-in untouched).
- [ ] **Step 5: Commit:** "Case labels: story and developer docs".
