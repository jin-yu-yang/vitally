# Remove from this season's roster: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A workspace admin can remove a volunteer from the current season's Roster in one confirmed step. Their account is deactivated except a site coordinator's, and the removal is recorded. After re-adding someone whose account is deactivated, the drawer points to Reactivate (#232, #269).

**Architecture:** One new `security definer` RPC, `vitally_remove_from_roster`, and one private table, `roster_removals`, in migration 058. The RPC reuses `vitally_private.deactivate_account` and `open_work` unchanged. The browser adds a store call, a drawer button, a confirmation dialog, a controller action, and the #269 notice/note in the existing Account section.

**Tech Stack:**
- Postgres/Supabase SQL migrations;
- plain ES modules (`src/*.mjs`);
- `node --test` unit and database tests;
- Playwright (`tests/browser.mjs`).

**Spec:** `openspec/changes/add-remove-from-roster/`:
- `design.md` (D1–D11);
- `specs/volunteer-roster/spec.md`;
- `specs/sign-in-accounts/spec.md`;
- `specs/site-coordinators/spec.md`;
- `specs/volunteer-clearance/spec.md`;
- `brainstorm.md` for rationale.

## Global Constraints

- **The migration:** `supabase/migrations/058_remove_from_roster.sql`, hand-written. Never edit 001–057.
- **No local Docker or Supabase stack on this machine.** Database tests run only through CI: `gh workflow run database-quick.yml --ref <branch> -f files="tests/database-remove-from-roster.mjs ..."`, then `gh run watch` with a bounded timeout. Never `supabase start`.
- **Every command gets a timeout.** Never run a server in the foreground. Bounded CI waits (`timeout 1500 gh run watch <id> --exit-status`). If an action needs the user's approval, stop and report BLOCKED.
- **Test runners:** `node --test` runs with `--test-concurrency=1` where a suite is heavy. Kill orphaned test runners.
- **Fictional data only:** Nadia Kerr, `nadia.kerr@example.org`, the fixture's Avery Lin, Taylor Brooks, and so on.
- **Staff text is English only.** No `client-text.mjs` change and no `build:hant`.
- **Error codes as existing:**
  - `FORBIDDEN` / `ADMIN_ROLE` are VT001;
  - `NOT_FOUND` is VT002;
  - `CONFLICT` is VT003;
  - `OPEN_WORK` is VT004 with `detail` = the JSON array of labels;
  - `VALIDATION` is VT007, with `detail='SELF'` for the caller's own row.
- **Operation name for the receipt:** `REMOVE_FROM_ROSTER`.
- **Exact copy** (from `specs/volunteer-roster/spec.md`):
  - Button: `Remove from this season's roster…`
  - Dialog title: `Remove ${name} from this season's roster?`
  - Lead: `${name} (${email}) comes off this season's roster, with their roles, certificates and the record of what they sent this season.`
  - Account lines:
    - `Their account is deactivated, so they can no longer sign in.`
    - `Their account stays active because they are a site coordinator, but they will have no roles this season.`
    - `Their account is already deactivated.`
    - (none with no account)
  - Last line: `Their cases and contact details are kept. To add them back, search for ${email} in Add a volunteer.`
  - Buttons: `Remove from roster` (confirm) and `Cancel` (keep).
  - Site coordinator sentence: `Only site coordinators remove a site coordinator from the roster.`
  - Admin role sentence: the existing `Only site coordinators change the Admin role.` (`src/controller.mjs:136`).
  - #269 notice: `${name} is back on this season's roster. Their account is deactivated. Reactivate it so they can sign in.`
  - #269 note: `Reactivate so they can sign in.`
- **Browser test:** in its own `test(...)` block with its own workspace, never inside the story.
- **Commit messages** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A second admin's open drawer saves after the removal.** It must get `CONFLICT` and create no current-season entry. Pinned in Task 1.
2. **Remove and Deactivate race in two windows.** Neither may answer `INVALID_TRANSITION`. Pinned in Task 1, both orders.
3. **A volunteer in another workspace, or one with no current-season entry** (removed already, or a past-season-only person): `NOT_FOUND`, nothing changed, nothing leaked. Pinned in Task 1.
4. **A lost reply then a second press.** The same action id returns the stored receipt, even though the revision has since moved. Pinned in Task 1 (database) and Task 4 (the controller keeps the id).
5. **Things the removal must not leave behind.** The sidebar's uploads count still counting the removed person's sent documents, and the removed person still offered in Edit lists. After a successful removal the controller re-reads the Roster and the uploads count. Pinned in Task 4.

---

### Task 1: Migration 058 and its database tests

**Files:**
- Create: `tests/database-remove-from-roster.mjs`
- Create: `supabase/migrations/058_remove_from_roster.sql`
- Modify: `tests/database-catalog.mjs` (add `vitally_remove_from_roster(p_action_id uuid, p_volunteer_id uuid, p_expected_revision bigint)` to the list where `vitally_start_next_season(...)` is, line ~86)

**Interfaces:**
- Produces:
  - `public.vitally_remove_from_roster(p_action_id uuid, p_volunteer_id uuid, p_expected_revision bigint) returns jsonb`, granted to `authenticated`. On success it returns `{actionId, volunteerId, revision, accountDeactivated}`, where `revision` is the new profile revision.
  - `public.roster_removals(id uuid pk default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade, season smallint not null, person_id uuid not null, removed_by_person_id uuid not null, removed_at timestamptz not null default now(), account_deactivated boolean not null)`, with RLS enabled, no policy, and `revoke all ... from public,anon,authenticated,service_role`.

- [ ] **Step 1: Write the failing database tests.** Follow `tests/database-start-next-season.mjs`: `createDatabaseFixture()`, `f.staff({...})` for extra volunteers, `f.sql` for row reads, a fresh fixture where a scenario is one-way, and `f.close()` in `after`. Call the RPC as `client.rpc("vitally_remove_from_roster", {p_action_id, p_volunteer_id, p_expected_revision})`, reading the profile revision from `volunteer_profiles`. Tests and their assertions:
  - `removes the current-season entry and deactivates an active account`:
    - no current-season `roster_entries` row and no current-season `certificates`;
    - `accounts.status='deactivated'` and the membership `active=false`;
    - the profile revision +1, and the `people` and `volunteer_profiles` rows still exist, with `usual_days` unchanged;
    - `people.capabilities` is `{}`;
    - one `roster_removals` row with `account_deactivated=true` and `removed_by_person_id` = the caller;
    - the receipt equals `{actionId, volunteerId, revision: before+1, accountDeactivated: true}`.
  - `sent and reviewed fields go with the entry`: set `form_13615_sent_at` and `photo_id_sent_at` first. After removal no row holds them, and the uploads count read (`vitally_my_clearance`, or the query the sidebar uses) no longer counts the person.
  - `no account: only the entry is deleted`: a volunteer saved with `vitally_save_volunteer` and no account. The entry is gone, no account row exists, and `account_deactivated=false`.
  - `invited account is deactivated, not cancelled`: after Create account (as `tests/database-accounts.mjs` does), the status is `deactivated`, the membership row still exists, and `people.user_id` is still set.
  - `already deactivated: entry deleted, account unchanged`: the account row (status, revision, `deactivated_at`) is identical before and after, and `account_deactivated=false`.
  - `earlier seasons and case history are kept`: insert a past-season entry and certificate with `f.sql`, and an accepted case naming the volunteer as preparer. Both are unchanged afterwards.
  - `refuses a caller who is not a workspace admin`: `f.preparer` gets `FORBIDDEN`, and `f.receiptsFor(actionId)` is 0.
  - `refuses ADMIN_ROLE for a non-site-coordinator caller`: an admin made with `f.staff({capabilities:["admin","followup"]})` removing another Admin-role person gets `ADMIN_ROLE`, with no receipt.
  - `a site coordinator removes an Admin-role person`: succeeds.
  - `refuses SELF`: `VALIDATION` with details `SELF`.
  - `refuses NOT_FOUND`: for a person in `f.foreignWorkspaceId`, for a person with no current-season entry, and for a random uuid.
  - `refuses CONFLICT for a stale profile revision`.
  - `refuses a site coordinator's removal by a non-site-coordinator admin`: `FORBIDDEN`. The entry, the account, `is_site_coordinator` and the `site_coordinator_changes` count are unchanged.
  - `a site coordinator removes another without deactivating`:
    - workspace with two site coordinators: the entry is gone, the account is `active` and `is_site_coordinator=true`, and the `site_coordinator_changes` count is unchanged;
    - `people.capabilities` is `{}`, and `account_deactivated=false`.

    This pins that `deactivate_account` is never called. It would have recorded a removal and cleared the mark. The removed site coordinator's own `vitally_my_clearance()` then answers not cleared, which gives the setup screen, while `vitally_policy.is_workspace_admin` is still true for them.
  - `refuses OPEN_WORK`, one case each:
    - an open current-season case as preparer;
    - the default follow-up person.

    Both get `OPEN_WORK` with the label in `details`, and nothing changes.
  - `a stale Save after removal gets CONFLICT and does not re-add`: `vitally_save_volunteer` with the pre-removal profile revision gets `CONFLICT`, and there is still no current-season entry.
  - `Deactivate first, then Remove`: Remove succeeds, `account_deactivated=false`, and the account stays `deactivated`. Never `INVALID_TRANSITION`.
  - `Remove first, then Deactivate`: `vitally_deactivate_account` with the pre-removal account revision gets `CONFLICT`.
  - `a replay returns the stored receipt`: the same action id, after success, returns an equal result. There is one `roster_removals` row, even though the expected revision is now stale.
  - `roster_removals has no grant`: `select`, `insert`, `update` and `delete` from an admin client are refused with a permission error.
  - `re-adding through Save keeps the account deactivated`: `vitally_save_volunteer` with the removed person's id and the new revision creates a current-season entry with no roles. The account is still `deactivated`.

- [ ] **Step 2: Push and run the tests to see them fail.**
  Run: `timeout 60 gh workflow run database-quick.yml --ref <branch> -f files="tests/database-remove-from-roster.mjs tests/database-catalog.mjs"`, then `timeout 1500 gh run watch <id> --exit-status`.
  Expected: FAIL. The function `vitally_remove_from_roster` does not exist, and the catalog is missing an entry.

- [ ] **Step 3: Write `058_remove_from_roster.sql`.**
  - **The header comment:** names the change and design D1–D11, as 055's does.
  - **§1, the table:** as in Interfaces.
  - **§2, the function:** follows design D4 exactly, step for step.
  - **Locks and lookups:** the workspace lock is `pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_member.workspace_id::text,0))`. The current-season entry is found by joining `public.workspaces w on w.current_season=r.season`.
  - **The `ADMIN_ROLE` check:** reads the stored roles before `reserve_receipt`, as 057's Save does.
  - **The site coordinator rule:** `vitally_private.is_site_coordinator(workspace, p_volunteer_id)`.
  - **The deactivation:** lock the account with `select ... from public.accounts where workspace_id=... and person_id=p_volunteer_id for update`. Call `vitally_private.deactivate_account(v_member.workspace_id, v_account.user_id, v_person.id)` only when `v_account.status in ('invited','active') and not v_account.is_site_coordinator`.
  - **The order of writes:** delete the entry, then deactivate, then `update volunteer_profiles set revision=revision+1, updated_at=now()`, then insert `roster_removals`, then store the receipt with `target_id=p_volunteer_id`.
  - **Comments:** follow the house style. Explain why the profile revision is raised (D5) and why deactivation is skipped (D6).
  - **The grants:** `revoke all` on the function, then grant execute to `authenticated`.

- [ ] **Step 4: Run the new tests and the suites they reach until they pass.**
  Run: `timeout 60 gh workflow run database-quick.yml --ref <branch> -f files="tests/database-remove-from-roster.mjs tests/database-catalog.mjs tests/database-accounts.mjs tests/database-volunteer-roster.mjs tests/database-site-coordinators.mjs tests/database-capabilities-mirror.mjs"`, then `timeout 1500 gh run watch <id> --exit-status`.
  Expected: PASS.

- [ ] **Step 5: Commit.**
  ```bash
  git add supabase/migrations/058_remove_from_roster.sql tests/database-remove-from-roster.mjs tests/database-catalog.mjs
  git commit -m "Roster: remove a volunteer from this season's roster (058)"
  ```

### Task 2: The store call

**Files:**
- Modify: `src/supabase-store.mjs` (beside `deactivateAccount`, line ~945)
- Test: `tests/store.test.mjs` (follow the `vitally_start_next_season` / `vitally_deactivate_account` cases, line ~2455)

**Interfaces:**
- Produces: `store.removeFromRoster({actionId, volunteerId, expectedRevision}) -> Promise<{actionId, volunteerId, revision, accountDeactivated}>`. Refusals arrive as the existing `call()` errors (`error.code`, `error.cause.message`, `error.cause.details`).

- [ ] **Step 1: Write the failing test.** Name it `removeFromRoster sends vitally_remove_from_roster with the action id, volunteer and profile revision`. Assert the RPC name and the args `{p_action_id, p_volunteer_id, p_expected_revision}`. If the file has an RPC list test, add the RPC to that list.
- [ ] **Step 2: Run the test to see it fail.** Run: `timeout 300 node --test tests/store.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement `removeFromRoster(request)`.** Mirror `deactivateAccount`.
- [ ] **Step 4: Run the test to see it pass.** Run: `timeout 300 node --test tests/store.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: "Roster: store call for removal".

### Task 3: The drawer button, the confirmation and the #269 note (views)

**Files:**
- Modify: `src/volunteer-views.mjs`:
  - `accountSection`, line ~216, or the Edit drawer's action row beside it;
  - a new exported `removeFromRosterDialogBody`.
- Modify: `src/views.mjs` (a `state.dialog === "remove-from-roster"` branch, beside `"deactivate-account"`, line ~665)
- Test: `tests/volunteer-views.test.mjs`
- Test: `tests/confirm-dialogs.test.mjs`, and `tests/confirm-dialogs.states.mjs` if dialogs are listed there.

**Interfaces:**
- Consumes the volunteer object from `combineVolunteers`: `name`, `email`, `roles`, `isSiteCoordinator`, `account?.status` (`"none" | "invited" | "active" | "deactivated"`) and `revision`.
- Consumes the drawer option `viewerIsSiteCoordinator`, which is already passed as `canChangeAdmin`.
- Produces:
  - **The drawer button:** `data-action="volunteer-remove"` with `data-volunteer-id`.
  - **The dialog:**
    - `removeFromRosterDialogBody({volunteer}) -> string`;
    - its confirm button is `data-action="confirm-remove-from-roster"`;
    - its keep button is "Cancel";
    - a refusal sentence is shown in an element `#remove-from-roster-error` (`role="alert"`) when `state.removeFromRosterError` is set.
  - **The #269 note:** `<p class="field-note" id="volunteer-reactivate-note">`, rendered only when the status is `deactivated`, the volunteer is on the current roster, and there is no `ui.accountNotice`.

- [ ] **Step 1: Write the failing view tests.**
  - `the Edit drawer offers Remove from this season's roster…`: the button is present for a saved volunteer, and absent in Add.
  - `a non-site-coordinator sees the site coordinator sentence instead of Remove`: with `viewerIsSiteCoordinator:false, isSiteCoordinator:true`, no button, and the exact sentence.
  - `a non-site-coordinator sees the Admin role sentence instead of Remove`: with `roles:["admin"]`.
  - `the confirmation for an active account`: the exact title, the lead with the name and email, the deactivated line, the add-back line with the email, and the buttons "Remove from roster" and "Cancel".
  - `the confirmation's account line follows the account`: four cases (invited/active, site coordinator, deactivated, none), with exact lines. None has no account line.
  - `the confirmation escapes the name and email`: a name with `<b>` is rendered escaped.
  - `a deactivated volunteer's drawer shows the Reactivate note`: the exact note text.
  - `the notice and the note never show together`: with an `accountNotice` set, the note is absent.
- [ ] **Step 2: Run the tests to see them fail.** Run: `timeout 300 node --test tests/volunteer-views.test.mjs tests/confirm-dialogs.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use `confirmBody({lead, confirm, keep:"Cancel"})` as `deactivateAccountDialogBody` does. The title is set in `src/views.mjs` from the volunteer found in `state.volunteers` by `state.dialogContext.volunteerId`.
- [ ] **Step 4: Run the tests to see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** Message: "Roster: remove button, confirmation and Reactivate note".

### Task 4: The controller action, the #269 save path and the app wiring

**Files:**
- Modify: `src/controller.mjs`:
  - a new `removeFromRoster()` near `runAccountAction`, line ~4660;
  - `saveVolunteer`, line ~4519;
  - the exports, line ~5170.
- Modify: `src/app.mjs` (cases `volunteer-remove` and `confirm-remove-from-roster`, beside `account-deactivate`, line ~2336)
- Test: `tests/controller.test.mjs`

**Interfaces:**
- Consumes `store.removeFromRoster` (Task 2), and the dialog and action names from Task 3.
- Produces:
  - `controller.removeFromRoster() -> Promise<boolean>`;
  - `state.removeFromRosterError` (string or null), shown by the dialog.

- [ ] **Step 1: Write the failing controller tests.** Follow the existing Deactivate tests with a fake store.
  - `removeFromRoster sends only from its confirmation, with the profile revision`: with `state.dialog !== "remove-from-roster"` it returns false and sends nothing. From the dialog it sends `{actionId, volunteerId, expectedRevision: volunteer.revision}`.
  - `a successful removal closes the dialog and drawer, and re-reads the Roster and the uploads count`: `state.dialog` is null, `listVolunteers` is called again, and the uploads count read is called again.
  - `OPEN_WORK keeps the dialog open with the open-work sentence`: `state.dialog === "remove-from-roster"`, and `state.removeFromRosterError` equals `openWorkMessage(name, details)`.
  - `ADMIN_ROLE and a site coordinator's FORBIDDEN keep the dialog open with their sentences`.
  - `CONFLICT goes to the banner and re-reads the list`: it throws, and `state.error` holds `VOLUNTEER_CONFLICT_MESSAGE`.
  - `an unknown outcome keeps the action id for the next press`: the second press sends the same `actionId`.
  - `a volunteer gone from the list is refused as gone`: `STAFF_VOLUNTEER_GONE_MESSAGE`.
  - `after saving a picked earlier volunteer whose account is deactivated, the drawer stays open with the notice`:
    - `saveVolunteer` resolves true;
    - `state.dialog === "volunteer"`, `state.dialogContext.volunteerId` is the picked id, and `returning` is no longer set;
    - `state.volunteerAccountNotice` equals `{kind:"info", text:"Nadia Kerr is back on this season's roster. Their account is deactivated. Reactivate it so they can sign in."}`. Use the `kind` the Account section renders as info.
  - `any other save still closes the drawer`: a picked earlier volunteer with no account, and a plain Edit.
- [ ] **Step 2: Run the tests to see them fail.** Run: `timeout 600 node --test tests/controller.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement `removeFromRoster()` and the save path.**
  - **The action id:** keep it in a `pendingRemoval = {key, actionId}`, keyed `remove:${volunteerId}:${revision}`, as `pendingAccountAction` is.
  - **On a refusal with a sentence:** set `state.removeFromRosterError`, re-read the list, and return false, leaving the dialog open.
  - **On success:** close the dialog (`state.dialog = null`, `state.dialogContext = null`), then `readVolunteers()` and `readUploadsCount()`.
  - **In `saveVolunteer`:** after the successful `readVolunteers()`, if `returning` and the re-read volunteer's `account.status === "deactivated"`, set `state.dialog = "volunteer"`, set `dialogContext` to that volunteer's Edit, and set the notice. Find out how the caller in `app.mjs` closes the drawer on `true`, and adjust it so that it doesn't close in this case. For example, return `"kept-open"` or check `state.dialog` after the call. Keep the change minimal and covered by the test.
  - **In `app.mjs`:**
    - `volunteer-remove` → `openDialog("remove-from-roster", {volunteerId}, describeFocus(target))`;
    - `confirm-remove-from-roster` → `await controller.removeFromRoster()`.
  - **Clearing the error:** `state.removeFromRosterError` is cleared whenever the dialog opens or closes.
- [ ] **Step 4: Run the tests to see them pass.** Run: `timeout 600 node --test tests/controller.test.mjs`, then `timeout 900 npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: "Roster: remove action and Reactivate notice after a re-add".

### Task 5: The browser test (its own block)

**Files:**
- Modify: `tests/browser.mjs` (a new top-level `test(...)` after the existing ones, line ~10787 onward, with its own workspace set up the way the other non-story blocks do)

**Interfaces:**
- Consumes the UI from Tasks 3 and 4, and migration 058.

- [ ] **Step 1: Write the test.** Name it `removing a volunteer from this season's roster`. Steps:
  1. An admin (a site coordinator) creates a fictional volunteer Nadia Kerr (`nadia.kerr@example.org`), gives her an account, and has her sign in in a second page. She is cleared as a Greeter.
  2. The admin opens her drawer and presses "Remove from this season's roster…". The dialog shows her email and "Their account is deactivated, so they can no longer sign in."
  3. The admin presses "Remove from roster". The Roster no longer lists her.
  4. Her page is focused (a wake) and shows "This account has no access".
  5. The admin opens Add a volunteer, types her full email in the search, and sees her offered as "Earlier volunteer". The admin picks her and saves. The drawer stays open with the exact #269 notice.
  6. The admin closes and reopens her drawer. It shows "Reactivate so they can sign in." and not the notice.
- [ ] **Step 2: Run it through CI.** There is no local stack. Push, then `timeout 60 gh workflow run ci.yml --ref <branch>`, then `timeout 2400 gh run watch <id> --exit-status`. Expected: both `story` legs pass, including the new block. Read the leg's per-test timing and confirm the story itself didn't grow.
- [ ] **Step 3: Commit,** before Step 2's push. Message: "Roster: browser test for removal".

### Task 6: Docs and the final checks

**Files:**
- Modify: `docs/developer/database.md` (migration 058, `vitally_remove_from_roster` with its refusals and lock order, `roster_removals`)
- Modify: `docs/developer/frontend.md` (the remove confirmation, the #269 notice and note, and the fact that other Roster windows learn of a removal only when they read it again)

- [ ] **Step 1: Update both docs,** in the style of the existing entries for 055 and 057.
- [ ] **Step 2: Run the local checks.** Run each of these:
  - `timeout 900 npm test`;
  - `timeout 120 npx openspec validate --all`;
  - `timeout 300 npm run build:intake && git status --porcelain`.

  Expected: all pass, and `git status --porcelain` prints nothing from `build:intake`.
- [ ] **Step 3: Commit and push, then run the full CI on the pushed head.** Run `timeout 60 gh workflow run ci.yml --ref <branch>`, then `timeout 2400 gh run watch <id> --exit-status`. Expected: `checks`, `database`, `sign-in` and both `story` legs pass. Record the run link for `verify.md`, and review the story screenshots in the run's artifacts.
