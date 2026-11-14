# Posted Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ceiling admins post updates (IRS policy or office notice) to All volunteers or chosen roles. Every staff member, cleared or not, reads them in a Notifications panel with an unread badge and confirms when asked. Admins see live read and confirmed counts.

**Architecture:**
- **Database:** one hand-written migration, `046_posted_updates.sql`, adds:
  - `posted_updates` (SELECT for realtime through an admin policy and an audience policy) and `update_reads` (RPC-only);
  - a live-audience helper;
  - five RPCs.
- **App:**
  - a pure rules module, `src/posted-updates.mjs`;
  - new store methods;
  - controller state for the feed and the admin screen;
  - a new view module, `src/update-views.mjs`;
  - sidebar entries for Notifications (everyone) and Post an update (ceiling admin).
- **Realtime:** `posted_updates` joins the existing staff channel.

**Tech Stack:** Supabase Postgres (plpgsql, RLS, Realtime), plain ES modules in `src/`, `node:test`, Playwright (`tests/browser.mjs`).

**Spec:** `openspec/changes/add-posted-updates/`: `design.md` (D1–D6) and `specs/{posted-updates,volunteer-clearance,sign-in}/spec.md`. `brainstorm.md` holds the user's decisions and those made without the user.

## Global Constraints

- **Fictional data only** in code, tests and fixtures.
- **Migrations:** never edit 001–045. Everything goes in `supabase/migrations/046_posted_updates.sql`.
- **No local database or browser runs.** Other sessions share the local Supabase stack. Do NOT run `npm run db:migrate:test`, `npm run test:database`, `npm run test:auth-browser`, `npm run test:browser`, `supabase start`, `supabase stop` or `supabase db reset`.
  - Database and browser tests are proven in CI: push the branch, then run `gh workflow run ci.yml --ref add-posted-updates`.
  - Locally run only `npm test`, `npm run build:hant -- --check` and `npx openspec validate --all`.
- **No-hang rules** (every command):
  - Put `timeout <s>` on the command **and** set the Bash tool's `timeout`.
  - Never leave a server, `--watch` or dev mode running in the foreground.
  - Wait for CI in bounded loops of under 10 minutes each (`gh run view <id> --json status,conclusion`, until-loop with `sleep 30` inside a single bounded command). Never end the turn waiting on a background notification.
  - If a command hangs or times out, find out why before retrying it unchanged.
  - If anything needs the user's approval, stop and report BLOCKED, naming it.
- **CI failures:** read the failing job's log (`gh run view <id> --log-failed`) before changing anything. Never rerun blind.
- **Database tests assert only on their own fixture workspace,** or on catalog facts. Never scan other workspaces.
- **Error codes** (existing only): VT001 `FORBIDDEN`, VT002 `NOT_FOUND`, VT003 `CONFLICT`, VT004 `INVALID_TRANSITION`, VT007 `VALIDATION` (detail = the field name).
- **Field names (jsonb and the browser):** `kind` (`irs_policy` | `office_notice`), `title`, `message`, `irsLink`, `audience` (`everyone` | `roles`), `roles` (subset of `greeter`, `intaker`, `preparer`, `reviewer`, `admin`), `keepTopUntil` (`YYYY-MM-DD` or null), `askConfirm`, `post`, `askAgain`.
- **Limits:**
  - title 1–120, message 1–2000, both trimmed;
  - `irsLink` ≤ 500, matching `^https://([a-z0-9-]+\.)*irs\.gov(/[^[:space:]]*)?$` case-insensitively, `irs_policy` only;
  - `vitally_mark_updates` takes ≤ 200 ids.
- **"Today"** is New York: SQL `(now() at time zone 'America/New_York')::date`, browser `nowInput().slice(0,10)` from `src/contact-log.mjs`.
- **Feed item fields, exactly:** `source` (`'posted_update'`), `id`, `kind`, `title`, `message`, `irsLink`, `postedAt`, `postedByName`, `edited`, `pinned`, `askConfirm`, `readAt`, `confirmedAt`.
- **Staff screens stay English.** No `client-text.mjs` change.
- **The main browser story is untouched.** The new browser test is a separate top-level test. Never drop, merge or shorten existing checks.
- **Never remove a test** unless the code it covers is removed in the same change.
- **Exact copy:**
  - **Sidebar:** "Notifications"; the badge's accessible name "Notifications, N unread"; "Post an update".
  - **Page:**
    - overline "OFFICE · ADMIN"; title "Post an update"; intro "Post IRS policy updates and office notices to volunteers. Replies are turned off.";
    - form heading "New update", or "Edit update" when editing.
  - **Type:**
    - "IRS policy update" (hint "Rules and guidance from the IRS, summarized by the office");
    - "Office notice" (hint "Hours, closures, supplies, shift changes").
  - **Fields:**
    - "Title";
    - "Message" (note "Plain language works best. Volunteers read this in the Notifications panel and cannot reply.");
    - "Link to the IRS source (optional)";
    - "Who sees it": "All volunteers" / "Chosen roles", with role checkboxes "Greeter", "Intaker", "Preparer", "Reviewer", "Admin";
    - "Keep at the top until".
  - **Checkboxes:**
    - "Ask volunteers to confirm they have read it" (hint "Adds an \"I've read this\" button, and you can see who has confirmed.");
    - "Ask everyone to read it again" (hint "Clears every read and confirmation, so everyone sees it as new.").
  - **Buttons:** "Save draft", "Post update", "Save changes" (editing a posted update), "Cancel".
  - **Preview:** heading "Preview" with "as volunteers see it"; line "Shown to: <audience>", plus " · asks them to confirm" when asked.
  - **Audience text:**
    - "All volunteers";
    - otherwise the plural role names in the order Greeters, Intakers, Preparers, Reviewers, Admins, joined "A", "A and B", "A, B and C".
  - **Table:**
    - "Posted updates"; columns "Update", "Type", "Posted", "Audience", "Read", "Confirmed";
    - type tags "IRS policy" and "Office";
    - status "Draft" / "Unpublished"; "Not asked";
    - actions "Edit", "Unpublish", "Post", "Delete";
    - footnote "Read and confirmed counts show who has not seen an update yet, so you can remind them at the next shift.";
    - empty "No updates yet. Posted updates and drafts appear here.".
  - **Panel:**
    - "Notifications"; "I've read this"; "Confirmed <Mon D>"; "Edited"; "Pinned";
    - footer "Office admins relay IRS policy updates here. Replies are turned off.";
    - empty "No updates yet.".
  - **Who dialog:** title "Who has read “<title>”"; columns "Name", "Read", "Confirmed"; "Not yet".
  - **Unpublish confirm:** lead "Unpublish “<title>”?"; note "Volunteers will no longer see it. It stays in your table with its counts."; buttons "Unpublish" / "Keep it".
  - **Delete confirm:** lead "Delete the draft “<title>”?"; note "Nobody has seen it. This can't be undone."; buttons "Delete draft" / "Keep it".
  - **Toasts:** "Update posted.", "Draft saved.", "Changes saved.", "Update unpublished.", "Draft deleted.".
  - **Validation messages** (same in browser and the form):
    - title "Enter a title of up to 120 characters.";
    - message "Enter a message of up to 2000 characters.";
    - irsLink "Use an https link on irs.gov." / "Only IRS policy updates link to the IRS.";
    - roles "Choose at least one role.";
    - kind "Choose a type.".

## Review Focus

1. **An admin edits a posted update while a volunteer has the panel open.** The volunteer's panel re-renders with the new text and "Edited", and must not mark it unread unless `askAgain` was set. Test in Task 1 (`askAgain` false keeps `read_at`), and in Task 4 (a `posted_updates` change re-reads the feed while the panel is open, without calling `markUpdates` again unless new unread items are shown).
2. **A person with two memberships in other workspaces, or a stale inactive one.** Only the active staff membership in this workspace counts. Test in Task 1: an inactive membership plus a current roster entry gives no feed and no policy row.
3. **Delete of a draft is replayed after it succeeded.** The receipt returns `status: 'deleted'`, not NOT_FOUND. Test in Task 1.
4. **The admin presses Post update twice quickly, or retries after OFFLINE.** One update is created, because the same action id is reused. Test in Task 4 (the retry keeps the request object's action id) and Task 1 (replay).
5. **A title or message with HTML or quotes** (`<b>`, `"`, `&`) shows as text everywhere: panel, preview, table, who dialog and confirm. Test in Task 5 with the title `Office <closed> & "early"`.

---

### Task 1: Migration 046 and database tests

**Files:**
- Create: `supabase/migrations/046_posted_updates.sql`
- Create: `tests/database-posted-updates.mjs`
- Modify: `tests/database-catalog.mjs` (`POLICIES`, `RPCS`, digest exemptions, the `vitally_policy` list)
- Modify: `tests/support/rpc-signatures.mjs` (five entries)
- Modify: `tests/database-store.mjs` (published tables now include `posted_updates`; this follows `SUBSCRIBED_TABLES.staff` once Task 3 lands; to keep this task green in CI, add `posted_updates` to `STAFF_TABLES` in `src/supabase-store.mjs` here, and Task 3 adds its tests)
- Modify: `tests/database-staff-identity.mjs` (subscribed-table read check: leave `posted_updates` out of `STAFF_READ_TABLES`, with a comment that its rows are audience-scoped and covered by `database-posted-updates.mjs`)
- Modify: `tests/database-clearance.mjs` (keep the 21 count; update the test name and comment to name the `people` and `posted_updates` exceptions)

**Interfaces:**
- Produces the SQL surface in design D1–D3:
  - **Tables:** `public.posted_updates`, `public.update_reads`.
  - **Helpers:** `vitally_private.audience_member(p_workspace_id uuid, p_person_id uuid, p_audience text, p_roles text[]) returns boolean`; `vitally_policy.in_update_audience(p_workspace_id uuid, p_audience text, p_roles text[]) returns boolean`.
  - **Write RPCs:**
    - `public.vitally_save_update(p_action_id uuid, p_update_id uuid, p_expected_revision bigint, p_update jsonb) returns jsonb` → `{actionId, updateId, revision, status}`;
    - `public.vitally_update_action(p_action_id uuid, p_update_id uuid, p_expected_revision bigint, p_type text) returns jsonb` → `{actionId, updateId, revision, status}`, with `status` one of `posted`, `unpublished`, `deleted`.
  - **Other RPCs:**
    - `public.vitally_mark_updates(p_update_ids uuid[], p_confirm boolean) returns jsonb` → `{marked}`;
    - `public.vitally_my_updates() returns jsonb` → `{items, unread}`;
    - `public.vitally_posted_updates() returns jsonb` → `{updates: [{id, kind, title, message, irsLink, audience, roles, keepTopUntil, askConfirm, status, createdAt, postedAt, postedByName, editedAt, unpublishedAt, revision, audienceSize, readCount, confirmedCount, people: [{personId, name, readAt, confirmedAt}]}]}`.

- [ ] **Step 1: Write the failing tests** in `tests/database-posted-updates.mjs`.
  - Use `createDatabaseFixture()`, `f.siteCoordinator` (admin), `f.preparer`, `f.reviewer`, `f.staff({key, name, capabilities, cleared:false})` and `applicantA`.
  - Follow `database-volunteer-roster.mjs`'s `refusedWith` and receipt helpers.
  - One test per scenario in `specs/posted-updates/spec.md`, at least:
    - `audience: an uncleared staff member with a current-season entry and no roles is in All volunteers` (an `f.staff({cleared:false})` with a roles-empty entry gets the item from `vitally_my_updates`);
    - `audience: added to the roster after posting sees the update`;
    - `audience: an earlier-season entry only gives no items`;
    - `audience: an inactive staff membership gives no items and no rows`;
    - `audience: a Reviewer update reaches the reviewer and not the preparer`;
    - `write: a preparer, a client and an anonymous caller get FORBIDDEN from both write RPCs`;
    - `write: an admin with no roles can post`;
    - `write: no direct insert into posted_updates or update_reads`;
    - `validation`: one assert per field (title of spaces, message of 2001 characters, `https://example.org/irs`, `http://www.irs.gov/x`, link on `office_notice`, `roles` with `[]`, unknown kind), each VT007 with detail = field, and no rows;
    - `lifecycle: save draft → POST → UNPUBLISH`, with `posted_at`, `posted_by_person_id` and `unpublished_at` set; the draft is absent from the preparer's feed and select;
    - `lifecycle: DELETE removes a draft; DELETE and save on posted/unpublished give VT004; UNPUBLISH on a draft gives VT004`;
    - `lifecycle: a stale revision gives VT003; an unknown id gives VT002`;
    - `receipts: replaying save, POST and DELETE returns the stored result` (DELETE replay → `status:'deleted'`);
    - `edit: a posted update edited without askAgain keeps read_at and confirmed_at and sets edited_at; with askAgain it has no update_reads rows`;
    - `feed: order is pinned (keep_top_until >= NY today) newest first, then the rest newest first; yesterday's pin is not pinned`;
    - `feed: drafts and unpublished updates are absent; item keys are exactly the contract`;
    - `feed: unread counts unread items plus askConfirm items without confirmedAt`;
    - `mark: keeps the first read_at; confirm only where askConfirm; another role's id gives marked 0; 201 ids give VT007`;
    - `posted list: counts only the current audience (add a roster entry → audienceSize+1); people list names and times; a preparer gets FORBIDDEN`;
    - `rls: a preparer selecting posted_updates gets no draft and no other-role row; an applicant gets none; an unpublished row in the audience stays selectable`;
    - `rls: select on update_reads is refused for an admin`.
- [ ] **Step 2: Write the migration** (design D1–D4).
  - **Header:** a comment listing sections (a) to (e).
  - **Tables:** foreign keys to `people` are `deferrable initially deferred` (fixture cleanup cascades from the workspace).
  - **Indexes:** `posted_updates(workspace_id, status)` and `update_reads(workspace_id, person_id)`.
  - **Helpers:** `audience_member` joins `people` → `memberships` (`active and access='staff'`, same workspace) → `workspaces.current_season` → `roster_entries`. Add a comment that "active staff membership" switches to "active account" when add-account-invitations lands.
  - **RPCs:**
    - Each starts `v_member = vitally_private.require_membership(); v_person = vitally_private.acting_person(v_member);` and refuses `access<>'staff' or v_person.id is null` with VT001.
    - The two write RPCs then check `vitally_policy.is_workspace_admin(v_member.workspace_id)`, digest with `'personId', v_person.id`, and use `vitally_private.reserve_receipt(...)`, as `vitally_save_volunteer` does (`045:1042-1235`).
    - `vitally_posted_updates` checks `is_workspace_admin`.
  - **Grants:** `revoke all ... from public,anon,authenticated,service_role; grant execute ... to authenticated` for every public and policy function.
  - **Publication:** the guarded block for `posted_updates`, copied from `039_preparer_shaded_fields.sql:101-116`.
- [ ] **Step 3: Update the catalogue tests** listed under Files.
  - `RPCS` gains the five signatures.
  - The digest test's exemption list becomes `vitally_my_clearance`, `vitally_my_updates`, `vitally_posted_updates`, `vitally_mark_updates`, with a comment: no receipt, so no digest.
  - `vitally_policy` expects three functions.
  - `RPC_SIGNATURES` entries: give each `authorized` (staff for the three reads and marks, the site coordinator for the writes), `receiptKeys` (writes: `['actionId','updateId','revision','status']`; others none, following the entry style for `vitally_my_clearance`) and `args(context)`.
- [ ] **Step 4: Local checks.**
  - Run: `timeout 600 npm test`.
  - Expected: PASS. The unit suite includes `store.test.mjs`, which reads `STAFF_TABLES`.
- [ ] **Step 5: Commit, push and run CI.**
  ```bash
  git add supabase/migrations/046_posted_updates.sql tests/database-posted-updates.mjs tests/database-catalog.mjs tests/support/rpc-signatures.mjs tests/database-store.mjs tests/database-staff-identity.mjs tests/database-clearance.mjs src/supabase-store.mjs
  git commit -m "Posted updates: migration 046, tables, audience, RPCs and database tests"
  git push -u origin add-posted-updates
  gh workflow run ci.yml --ref add-posted-updates
  ```
  - Expected: the `database` and `checks` jobs pass.
  - If they fail: read `gh run view <id> --log-failed`, fix, push and rerun. The same failure after 3 fix attempts → report BLOCKED.

### Task 2: Browser rules module

**Files:**
- Create: `src/posted-updates.mjs`
- Test: `tests/posted-updates.test.mjs`

**Interfaces:**
- Produces:
  - `KINDS = ['irs_policy','office_notice']`;
  - `KIND_LABELS = {irs_policy:'IRS policy update', office_notice:'Office notice'}`;
  - `KIND_TAGS = {irs_policy:'IRS policy', office_notice:'Office'}`;
  - `ROLES = ['greeter','intaker','preparer','reviewer','admin']`;
  - `ROLE_LABELS` (singular, title case), `ROLE_PLURALS`;
  - `audienceLabel({audience, roles}) → string`;
  - `validateUpdate(form) → {field: message} | null` (form uses the Global Constraints field names);
  - `toUpdateRequest(form, {post, askAgain}) → p_update object` (trimmed; `irsLink` null for office notices or when empty; `roles` `[]` when `audience==='everyone'`; `keepTopUntil` null when empty);
  - `badgeCount(items) → number`;
  - `isPinned(keepTopUntil, today) → boolean`;
  - `emptyUpdateForm() → form`.

- [ ] **Step 1: Write failing tests:**
  - `audienceLabel` returns "All volunteers", "Reviewers", "Preparers and Reviewers", "Greeters, Intakers and Admins" (order follows `ROLES`, whatever the input order);
  - `validateUpdate` returns each exact message from Global Constraints for each bad field, and null for a valid IRS update with link `https://www.irs.gov/individuals/volunteer`;
  - `toUpdateRequest` trims, nulls the link on an office notice, empties roles for everyone, and carries `post`/`askAgain`;
  - `badgeCount` counts `[{readAt:null},{readAt:'x',askConfirm:true,confirmedAt:null},{readAt:'x',askConfirm:true,confirmedAt:'y'}]` as 2;
  - `isPinned('2026-11-13','2026-11-13')` is true; `isPinned('2026-11-12','2026-11-13')` is false; `isPinned(null, …)` is false.
- [ ] **Step 2: Run to fail.** `timeout 300 node --test tests/posted-updates.test.mjs` → FAIL (module missing).
- [ ] **Step 3: Implement** the functions above. The irs.gov check uses `new URL()`: protocol `https:`, hostname `irs.gov` or ending `.irs.gov`, length ≤ 500.
- [ ] **Step 4: Run to pass.** Same command → PASS. Then `timeout 600 npm test` → PASS.
- [ ] **Step 5: Commit.** `git commit -m "Posted updates: browser rules module"`

### Task 3: Store methods

**Files:**
- Modify: `src/supabase-store.mjs` (near `listVolunteers` and `saveVolunteer`, `:685-709`)
- Test: `tests/store.test.mjs`

**Interfaces:**
- Consumes: the Task 1 RPCs.
- Produces store methods:
  - `getUpdates() → {items, unread}` (calls `vitally_my_updates`);
  - `markUpdates({ids, confirm}) → {marked}`;
  - `listPostedUpdates() → updates[]`;
  - `saveUpdate(request) → result`, where `request = {updateId, expectedRevision, update}` and the action id is minted once via `actionId(request)`;
  - `updateAction(request) → result`, where `request = {updateId, expectedRevision, type}`.
  - Errors pass through `createAppError` as for the other methods.

- [ ] **Step 1: Write failing tests** with the fake client:
  - each method calls its RPC with the exact `p_*` arguments;
  - a second `saveUpdate` with the same request object reuses the action id;
  - `SUBSCRIBED_TABLES.staff` contains `posted_updates` and `SUBSCRIBED_TABLES.applicant` does not;
  - an RPC error with code VT004 becomes `INVALID_TRANSITION`.
- [ ] **Step 2: Run to fail.** `timeout 300 node --test tests/store.test.mjs` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass**, then `timeout 600 npm test` → PASS.
- [ ] **Step 5: Commit.** `git commit -m "Posted updates: store methods"`

### Task 4: Controller: feed and admin screen

**Files:**
- Modify: `src/controller.mjs`
- Test: `tests/controller.test.mjs` (a new `describe` block after the Roster tests, `:6499-6850`; extend `fakeStore` with the Task 3 methods)

**Interfaces:**
- Consumes: Task 2 (`validateUpdate`, `toUpdateRequest`, `badgeCount`, `emptyUpdateForm`) and Task 3 store methods.
- Produces controller API:
  - feed: `loadFeed()`, `openNotifications()`, `closeNotifications()`, `confirmUpdate(id)`;
  - admin list: `loadPostedUpdates()`;
  - admin writes: `saveUpdate(form, {post})` → boolean landed; `updateAction(id, type)` → boolean;
  - form: `editUpdate(id)`, `cancelUpdateEdit()`, `setUpdateForm(form)`.
- Produces state:
  - feed: `updates` (items), `updatesUnread` (number), `notificationsOpen` (boolean), `lists.updates`;
  - admin: `postedUpdates`, `lists.postedUpdates`;
  - form: `updateForm`, `updateEditing` (`{id, revision, status}` or null), `updateFormError` (`{field: message}` or null).
- Screen `office-updates` is added to `STAFF_SCREENS`. It is allowed for a ceiling admin (`ceilingAdmin(state.principal)`), cleared or not.

- [ ] **Step 1: Write failing tests:**
  - **Feed loading:**
    - a cleared staff load calls `getUpdates` and sets `updatesUnread`;
    - an uncleared load (`holdForClearance`) and each `checkClearance` call `getUpdates`;
    - a `handleChange({table:'posted_updates'})` re-reads the feed, and also `listPostedUpdates` when `state.screen==='office-updates'`.
  - **The panel:**
    - `openNotifications()` calls `markUpdates({ids:[unread ids shown], confirm:false})` once, then re-reads;
    - with no unread items it doesn't call `markUpdates`;
    - a `posted_updates` change while the panel is open re-reads the feed and marks only newly shown unread items (Review Focus 1).
  - **Confirm:** `confirmUpdate(id)` calls `markUpdates({ids:[id], confirm:true})`, then re-reads.
  - **Saving:**
    - `saveUpdate` with an invalid form sets `updateFormError` and calls nothing;
    - a valid post calls `saveUpdate` with `post:true`, clears the form, re-reads the list and returns true;
    - OFFLINE keeps the request, and the retry reuses it (same object, so same action id; Review Focus 4);
    - CONFLICT re-reads the list and keeps the form.
  - **Actions:** `updateAction(id,'UNPUBLISH')` passes the row's revision and re-reads the list.
  - **Editing:**
    - `editUpdate(id)` fills `updateForm` from the list row and sets `updateEditing`;
    - `cancelUpdateEdit()` resets both.
  - **Screen access:** a non-admin window restored on `office-updates` lands on the board.
  - **Sign-out:** sign-out resets every new state field.
- [ ] **Step 2: Run to fail.** `timeout 600 node --test tests/controller.test.mjs` → FAIL.
- [ ] **Step 3: Implement.**
  - Follow `readVolunteers` / `loadVolunteers` (`:980-1002`) for the list states.
  - Follow `saveVolunteer` (`:2831-2905`) for busy state, retry and conflict.
  - Add a `posted_updates` branch to `handleChange` (`:923-958`).
  - Load the admin list on `refresh()` when the screen is open.
- [ ] **Step 4: Run to pass**, then `timeout 600 npm test` → PASS.
- [ ] **Step 5: Commit.** `git commit -m "Posted updates: controller feed and admin screen"`

### Task 5: Views, sidebar, app wiring and styles

**Files:**
- Create: `src/update-views.mjs`
- Modify: `src/views.mjs` (`staffSidebar` `:197-237`; `staffScreen` routing `:273-409`; `OFFICE_SCREENS`; `dialog()` branches; `DRAWERS`)
- Modify: `src/app.mjs` (`EXITS` / `runNavigation` actions; form submit dispatch `:2512`; input listener for the preview)
- Modify: `src/styles.css`
- Test: `tests/update-views.test.mjs` (new), `tests/volunteer-views.test.mjs` or `tests/shell.test.mjs` (sidebar), `tests/confirm-dialogs.test.mjs` with `tests/fixtures/confirm-dialogs.json`

**Interfaces:**
- Consumes: the Task 4 state and API, and the Task 2 labels.
- Produces renderers:
  - `renderFeedItem(item, {preview}) → html`;
  - `renderNotificationsPanel(state) → html`;
  - `renderPostUpdatePage(state) → html`;
  - `renderUpdatePeople(update) → html`;
  - `unpublishConfirm(update)` and `deleteDraftConfirm(update)`, built with `confirmBody`.
- `app.mjs` actions:
  - navigation and panel: `open-notifications`, `open-post-update`;
  - feed: `confirm-update` (`data-id`);
  - table rows: `edit-update`, `post-draft`, `open-unpublish-update`, `open-delete-update`, `open-update-people` (each `data-id`);
  - form: `cancel-update-edit`; submit of `#update-form`, where the submitter's value is `draft` or `post`.

- [ ] **Step 1: Write failing tests:**
  - **Sidebar (cleared preparer):**
    - Notifications has a bell, no badge at 0;
    - a badge "3" with `aria-label="Notifications, 3 unread"` at 3;
    - no Post an update link.
  - **Sidebar (others):**
    - a ceiling admin gets Post an update after Volunteers;
    - the setup screen (uncleared) still has Notifications;
    - a client has none.
  - **Panel:**
    - items in the given order;
    - an unread item has the highlight class;
    - "I've read this" only for `askConfirm && !confirmedAt`;
    - "Confirmed Dec 2" when confirmed;
    - "Edited" and "Pinned" when set;
    - the IRS link with `rel="noopener"` and `target="_blank"`;
    - the footer copy;
    - "No updates yet." when empty;
    - no textarea or reply control.
  - **Page (form):**
    - the link field only when `kind==='irs_policy'`;
    - role checkboxes only for Chosen roles;
    - "Ask everyone to read it again" only when `updateEditing.status==='posted'`;
    - "Save changes" instead of "Save draft"/"Post update" when editing a posted update;
    - field errors shown next to their fields;
    - the date input has `min` = today.
  - **Page (preview and table):**
    - the preview shows the form's title and the "Shown to:" line;
    - table rows show the counts as "7/8" with a bar (`<meter>` or a styled bar with an `aria-label` like "7 of 8 read");
    - "Not asked" when `askConfirm` is false;
    - actions per status as in the spec;
    - "Draft" / "Unpublished".
  - **Escaping:** the title `Office <closed> & "early"` is escaped in the panel, preview, table, who dialog and both confirms (Review Focus 5).
  - **Confirm golden file:** add the two confirm bodies to the fixture.
- [ ] **Step 2: Run to fail.** `timeout 600 npm test` → FAIL in the new tests.
- [ ] **Step 3: Implement.**
  - The panel is a drawer (in the `DRAWERS` list) opened by `open-notifications`. Opening calls `controller.openNotifications()`.
  - The preview re-renders only its own container on `input` events in `#update-form`, through `controller.setUpdateForm`, without a full redraw that would lose focus.
  - Toasts per Global Constraints after landed saves and actions.
  - Unpublish and Delete open confirm dialogs, and only the confirm button calls `updateAction`.
  - CSS: badge on the nav link, the panel's item cards with a tinted unread state, the two-column form and preview that stack below 900 px, count bars. No horizontal overflow at 390 px.
- [ ] **Step 4: Run to pass.** `timeout 600 npm test` → PASS.
- [ ] **Step 5: Commit.** `git commit -m "Posted updates: Notifications panel, Post an update screen, sidebar"`

### Task 6: Browser test and developer docs

**Files:**
- Modify: `tests/browser.mjs` (a new top-level test after the Roster test, `:8768`, following its fixture, sign-in and screenshot pattern)
- Modify: `docs/developer/database.md`, `docs/developer/README.md`, `docs/developer/architecture.md`, `docs/developer/backend.md`, `docs/developer/frontend.md`

**Interfaces:**
- Consumes: the whole feature.

- [ ] **Step 1: Write the test** "An admin posts an update and volunteers read and confirm it".
  - Chrome only, its own fixture, timeout 300 s.
  - Windows: site coordinator, cleared preparer, and an uncleared staff member with a current-season entry and no roles (the fixture's uncleared helper, as in the Roster test's nested uncleared-admin test, `:9108`).
  - Steps, each asserted:
    1. The admin opens Post an update and fills an IRS update: title "Sign this year's Volunteer Standards of Conduct", the design's message text, link `https://www.irs.gov/individuals/irs-tax-volunteers`, All volunteers, keep-at-top = today + 7 days, ask to confirm. The preview shows the title. The admin presses Post update; the toast says "Update posted.".
    2. The preparer's sidebar shows "Notifications, 1 unread" without reload (realtime).
    3. The preparer opens the panel and sees the item with "I've read this". After closing, the badge still shows 1 (needs confirmation).
    4. The preparer presses "I've read this". "Confirmed …" shows, and the badge is gone.
    5. The admin's table (after focus or reopening the screen) shows read and confirmed "1/N". Pressing the confirmed count opens the who dialog listing the preparer with a date.
    6. The admin edits the update with "Ask everyone to read it again". The preparer's badge returns.
    7. The admin posts an office notice to Reviewers. The preparer's feed doesn't include it.
    8. The admin unpublishes the IRS update and confirms. The toast says "Update unpublished.". The preparer's panel no longer lists it, without reload.
    9. The admin posts an office notice to All volunteers: "Bring your signed Form 13615 to Saturday's training". The uncleared window (setup screen) regains focus and shows "Notifications, 1 unread". Its panel lists that notice only (not the Reviewers notice), and the window shows no case.
  - Screenshots: `posted-updates-admin`, `posted-updates-panel`, `posted-updates-setup`, using the existing `shoot()` (which also asserts no horizontal overflow).
- [ ] **Step 2: Update the docs.**
  - The RPC count becomes thirteen, listing the five.
  - The tables `posted_updates` and `update_reads` with their visibility.
  - The Realtime section: twenty tables, `posted_updates` added, `update_reads` deliberately not.
  - Migration 046 in the migration table.
  - A frontend note on `update-views.mjs` and `posted-updates.mjs`.
- [ ] **Step 3: Local checks.** `timeout 600 npm test`, `timeout 300 npm run build:hant -- --check`, `timeout 300 npx openspec validate --all` → all pass.
- [ ] **Step 4: Commit, push and run CI.**
  - `git commit -m "Posted updates: browser test and developer docs"`, `git push`, `gh workflow run ci.yml --ref add-posted-updates`.
  - Wait in bounded steps. Expected: `checks`, `database`, `sign-in` and both `story` legs pass.
  - On failure: read the logs and the recorded page errors first, then fix. The same failure after 3 attempts → BLOCKED.
  - Report the story's per-phase timings if the 900 s limit is hit, and do not shorten anything.
