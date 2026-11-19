# Season settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make roles the only source of capabilities, add the account-level site coordinator, and add a Season settings page that stores the upload links and owns the SIDN (migration 052).

**Architecture:**
- One hand-written migration, `052_season_settings.sql`:
  - a guard;
  - a snapshot;
  - a `people.capabilities` mirror kept by triggers;
  - new tables and columns;
  - rewritten policy, clearance, account, roster and default-follow-up functions;
  - new RPCs.
- The front end gains one screen (`office-settings`) and follows the existing ceiling-screen pattern. The tools stop writing capabilities.

**Tech Stack:**
- Supabase Postgres (plpgsql, RLS, Realtime);
- plain ES modules in `src/`;
- `node:test`;
- Playwright (`tests/browser.mjs`).

**Spec:** `openspec/changes/add-season-settings/` holds `design.md` (decisions D1–D10), `specs/*/spec.md` (the deltas) and `brainstorm.md` (rulings and the approved page sketch). Read `design.md` and the delta specs for your task before starting.

## Global Constraints

**No-hang rules** (every command):
- Put `timeout <s>` on the command and also set the Bash tool's `timeout` parameter.
- Never leave a server, `--watch` or dev mode in the foreground.
- Wait on CI in bounded steps under 10 minutes.
- If a command hangs or times out, find out why before retrying it unchanged.
- If anything needs the user's approval, stop and report BLOCKED, naming it.

**Local stack:**
- Never run `supabase start` from the repo root. The test stack lives in `$VITALLY_STACK` (`docs/setup.md`).
- While 052 is being built, use a throwaway stack only. To re-apply an edited 052: `supabase db reset --workdir "$VITALLY_STACK"`, then `npm run db:migrate:test`, because `migrate.mjs` refuses a changed applied migration (`MIGRATION_CHANGED`).
- Never touch the user's persistent stack without asking. Before anything runs against it, run a read-only query and take a `pg_dump` backup.

**Migrations:**
- Never edit 001–051. All new SQL goes in `supabase/migrations/052_season_settings.sql`.
- Every `create table`, `alter table` and `create trigger` goes in §3, before the §4 recompute.
- Functions copied from an earlier migration are copied verbatim, with each changed line marked `-- 052`.

**Data:**
- Fictional data only.
- The fixture SIDN is `S00000000` (`TEST_SITE_NUMBER`).
- Never print an email address from tools.

**Tests:**
- Database tests assert only on their own fixture workspace's rows.
- Convert a test that relied on the old ceiling; don't delete it. If one is removed, name the removed code it covered and confirm with grep that the code is gone.
- Never shorten or drop story phases or assertions to meet the 900 s limit. If a leg goes over, stop and report the per-phase timings.

**Error shapes** (store codes: `FORBIDDEN`=VT001, `CONFLICT`=VT003, `INVALID_TRANSITION`=VT004, `VALIDATION`=VT007):

| Refusal | Raised as |
|---|---|
| Admin role changed by a non-site-coordinator | `raise sqlstate 'VT001' using message='ADMIN_ROLE'` |
| Last site coordinator | `raise sqlstate 'VT004' using message='LAST_SITE_COORDINATOR'` |
| Default follow-up person | `raise sqlstate 'VT004' using message='DEFAULT_FOLLOWUP'` |
| No change | `raise sqlstate 'VT004' using message='INVALID_TRANSITION'` |
| Validation | `raise sqlstate 'VT007' using message='VALIDATION', detail=<reason>` |

Validation reasons: `NO_ACTIVE_ACCOUNT`, `SIDN_FORMAT`, `certificateUploadUrl`, `clientDocumentsUrl`.

**Copy** (staff English, exact):
- "Season settings"; overline "OFFICE · ADMIN";
- "Certificate and photo ID upload link"; "Client documents upload link";
- "Volunteers open this from \"Finish your setup\". Use a folder only site coordinators can see."; "Clients open this to send documents.";
- "Enter a link that starts with https://."; "Season settings saved"; "Someone else changed these settings. Check them and save again.";
- "Set · updated <date>"; "Not set"; "Volunteers type it at their first sign-in."; "Change…"; "Change the SIDN"; "Enter the site's SIDN: S followed by eight digits."; "SIDN updated";
- "Site coordinators"; "Kept across seasons · at least one"; "You"; "since <date>"; "not on this season's roster";
- "Make someone a site coordinator…"; "Add"; "Remove"; "History";
- "<who> made <name> a site coordinator"; "<who> removed <name> as site coordinator"; "The roster command made <name> a site coordinator";
- "<name> is now a site coordinator"; "<name> is no longer a site coordinator";
- "At least one site coordinator must remain. Make someone else a site coordinator first."; "<name> is the default follow-up person, so they stay a site coordinator.";
- "Only site coordinators can change these settings."; "Only site coordinators change the Admin role.";
- "Site coordinators need the SC certificate."; "SC certificate missing".

**Season label:** `${season} for TY ${season - 1}`.

## Review Focus

1. **Moving the default follow-up person between site coordinators.** The roster command sets a new default, then a site coordinator removes the old one. That must succeed once they're no longer the default. Owner: Task 4, step "default moved".
2. **A link with surrounding spaces or a capital `HTTPS://`.** Trim it. Accept `https://` case-insensitively and store it as typed after trimming. Owner: Task 7, test `links trim and accept HTTPS`.
3. **A site coordinator who removes themselves while another remains.** It succeeds. Their open Season settings page drops to read-only on its next read, and their window keeps the Roster only if they hold the Admin role. Owner: Task 4 (database) and Task 10 (view after the write re-read).
4. **The fixture Reviewer now also has `prepare`** (Reviewer role = `prepare`, `review`). Tests that assumed a review-only reviewer must not silently pass for the wrong reason. Owner: Task 3, step "reviewer audit".
5. **Re-running the hosted roster file unchanged after the deploy.** No second history row, no change to the SIDN, capabilities still mirror the roles. Owner: Task 8, test `re-run is a no-op`.

---

### Task 1: Migration 052 skeleton, guard, snapshot and the capabilities mirror

**Files:**
- Create: `supabase/migrations/052_season_settings.sql`
- Create: `tests/database-capabilities-mirror.mjs`

**Interfaces:**
- Produces:
  - file sections, in order:
    - `-- 052 §1 begin` … `-- 052 §1 end` (the guard);
    - §2 (the snapshot);
    - §3 (schema: tables, columns, triggers);
    - §4 (recompute);
    - §5 onwards (functions; later tasks append);
  - `vitally_private.mirror_capabilities(p_workspace_id uuid, p_person_id uuid, p_user_id uuid) returns text[]`: role capabilities of the current-season entry when `p_user_id` is not null, else `'{}'`;
  - `vitally_private.effective_capabilities(uuid, uuid)`: same signature, now role capabilities only;
  - table `vitally_private.capabilities_before_052(workspace_id uuid, person_id uuid, capabilities text[])`, revoked from every client role.

- [ ] **Step 1: Write the failing tests** in `tests/database-capabilities-mirror.mjs`, using `createDatabaseFixture` and the shapes in `tests/database-clearance.mjs`:
  - `the 052 guard refuses an admin without the Admin role`: inside a rolled-back transaction, give a fixture staff member `admin` in `people.capabilities` bypassing the mirror trigger with `set local session_replication_role=replica`, or `alter table public.people disable trigger <name>` inside the same rolled-back transaction, and strip their Admin role. Running the §1 section SQL (split on the markers) rejects with VT008, and the message matches `/^052 refused: .*\(1\)$/`.
  - `the guard ignores people with no sign-in`: the same with `user_id` null. §1 succeeds.
  - `the mirror follows role changes`: add Reviewer to a signed-in Preparer's entry. Their `people.capabilities` deep-equal `["prepare","review"]`. Remove all roles, and they equal `[]`.
  - `a direct write is replaced`: `update public.people set capabilities='{prepare}'` on a Greeter leaves `[]`.
  - `no sign-in means no capabilities`: a person with roles and `user_id` null has `[]`, and the non-admin `f.preparer` client's `people` read omits them. After linking them to a new staff membership (`f.enrich` / the account path), the read returns them with `["prepare"]`.
  - `the people realtime message carries the mirror`: subscribe as an admin, as `tests/database-realtime.mjs` does, then change a role. The received row's `capabilities` equal the new role capabilities.

- [ ] **Step 2: Run the tests to verify they fail.** Run: `timeout 600 node --env-file=.env.test --test tests/database-capabilities-mirror.mjs`. Expected: FAIL, because 052 doesn't exist.

- [ ] **Step 3: Write 052 §1–§4 and `effective_capabilities`.**
  - §1 guard: the count is over active `staff` memberships joined to `people` with `'admin'=any(capabilities)` and no current-season entry whose `roles` contains `admin`. Raise `VT008` with message `'052 refused: people with a sign-in hold admin without the Admin role ('||n||')'`.
  - §2: the snapshot.
  - §3: the `BEFORE INSERT OR UPDATE` trigger on `people` setting `new.capabilities := mirror_capabilities(new.workspace_id, new.id, new.user_id)`, and the `AFTER INSERT OR UPDATE OF roles, season, person_id OR DELETE` trigger on `roster_entries` running `update public.people set capabilities=capabilities` for OLD and NEW person rows whose season is the current one.
  - §4: `update public.people set capabilities=capabilities`.

  Header comments follow 045's style: change name, design refs, section list.

- [ ] **Step 4: Apply and run.** Reset the throwaway stack, then run `timeout 300 npm run db:migrate:test` and Step 1's command. Expected: PASS. Other database files may fail until Task 3, which is expected; list them in the report.

- [ ] **Step 5: Commit:** `git add supabase/migrations/052_season_settings.sql tests/database-capabilities-mirror.mjs && git commit -m "052: guard, snapshot and the role capabilities mirror"`

### Task 2: Site coordinator flag, workspace admin and clearance

**Files:**
- Modify: `supabase/migrations/052_season_settings.sql` (§3 schema; new §5)
- Create: `tests/database-site-coordinators.mjs`

**Interfaces:**
- Consumes: Task 1's sections.
- Produces:
  - `public.accounts.is_site_coordinator boolean not null default false`;
  - `public.site_coordinator_changes(id uuid pk default gen_random_uuid(), workspace_id uuid, person_id uuid, granted boolean not null, changed_by_person_id uuid null, changed_at timestamptz not null default now())`, with FKs to `people(workspace_id,id)` deferred as in 047 and no client grants;
  - `vitally_private.is_site_coordinator(p_workspace_id uuid, p_person_id uuid) returns boolean` (active account with the flag);
  - `vitally_private.grant_site_coordinator(p_workspace_id uuid, p_user_id uuid) returns void`: idempotent; grants only to an active staff account, else VALIDATION `NO_ACTIVE_ACCOUNT`; writes an audit row with null `changed_by` only when the flag changes;
  - `vitally_policy.is_workspace_admin(uuid)`: same signature and grants, new body (design D2);
  - `vitally_private.cleared(uuid, uuid)`: adds the SC rule;
  - `vitally_my_clearance()`: `isAdmin`, `isSiteCoordinator`, and `missing` item `{"kind":"siteCoordinator","certificates":["SC"]}` after the role items, only when the person is a site coordinator with a current-season entry and no confirmed `sc`.

- [ ] **Step 1: Write the failing tests** in `tests/database-site-coordinators.mjs`:
  - `a site coordinator with no roles is a workspace admin`: grant through `grant_site_coordinator` to a new staff member with no roles. Their client's `rpc("vitally_my_clearance")` gives `isAdmin: true`, `isSiteCoordinator: true`, `cleared: false`, `capabilities: []`. A `volunteer_profiles` read returns rows (admin policy).
  - `the Admin role makes an admin`: a non-site-coordinator with the Admin role (VSC + IT&QR), uncleared because new with no photo ID. `isAdmin: true`, `isSiteCoordinator: false`.
  - `an invited volunteer given the Admin role has admin`: run the account path to active (`vitally_record_account` then `vitally_complete_site_check`, as `tests/database-accounts.mjs` does). Then save VSC, IT&QR and Admin as the fixture site coordinator. `people.capabilities` deep-equal `["admin","assist","followup","receive_documents"]`, and `isAdmin: true`.
  - `a site coordinator without SC is not cleared`: Admin role with VSC + IT&QR, not new. `cleared: false`, and `missing` contains `{kind:"siteCoordinator",certificates:["SC"]}`. Confirm `sc`, and `cleared: true`.
  - `grant_site_coordinator refuses an invited account` with `NO_ACTIVE_ACCOUNT`, and writes one history row per real change only.

- [ ] **Step 2: Run to verify they fail.** Run: `timeout 600 node --env-file=.env.test --test tests/database-site-coordinators.mjs`. Expected: FAIL.

- [ ] **Step 3: Implement** the column and table in §3, and the functions in §5 (`create or replace`, keeping signatures and grants; copy `vitally_my_clearance` from 047 with `-- 052` lines).

- [ ] **Step 4: Run Step 2's command after reset + migrate.** Expected: PASS.

- [ ] **Step 5: Commit:** `git commit -m "052: site coordinator flag, workspace admin and SC in clearance"`

### Task 3: Staff setup without capabilities, and the ceiling tests converted

**Files:**
- Modify: `supabase/migrations/052_season_settings.sql` (new §6: `add_staff_member`, `vitally_record_account`)
- Modify: `tools/admin/workspace-setup.mjs`
- Modify: `tests/support/database-fixture.mjs`
- Modify (convert):
  - `tests/database-actions.mjs`, `tests/database-assistance.mjs`, `tests/database-documents.mjs`;
  - `tests/database-staff-identity.mjs`, `tests/database-accounts.mjs`, `tests/database-clearance.mjs`;
  - `tests/database-posted-updates.mjs`, `tests/database.mjs`, `tests/database-catalog.mjs`;
  - any other `tests/database*.mjs` that fails for the same reason.

**Interfaces:**
- Consumes: `grant_site_coordinator` (Task 2).
- Produces:
  - `vitally_private.add_staff_member(p_workspace_id uuid, p_user_id uuid, p_person_key text, p_name text) returns uuid`. The 5-argument form is dropped. The link and insert no longer write capabilities, and the identical re-run check compares key and link only.
  - `vitally_record_account`, copied from 047, with line 813's capability write removed (`-- 052`).
  - `initializeWorkspace({ staff: [{ userId, personKey, name, siteCoordinator? }], defaultFollowup, siteNumber })`. It grants site coordinators after `add_staff_member` and before `set_default_followup`; `capabilities` on an entry is ignored.
  - Fixture changes:
    - `ROLE_ACCOUNTS` keeps its capabilities column only to feed `rolesFor`, and `site_coordinator` is marked as a site coordinator;
    - `clearStaff(personId, capabilities, workspaceId, { siteCoordinator })` adds `sc` to the confirmed certificates when the person is a site coordinator;
    - `f.staff({ key, name, capabilities, cleared, siteCoordinator })` passes `siteCoordinator` through.

- [ ] **Step 1: Run the whole database suite on the Task 2 tree.** Run: `timeout 1800 npm run test:database 2>&1 | tail -80`. Record every failing test name; this is the conversion list.

- [ ] **Step 2: Implement §6 and the `workspace-setup.mjs` / fixture changes.**

- [ ] **Step 3: Convert each failing test.**
  - A direct `people.capabilities` write that shaped a ceiling becomes a roster role change. Use `f.clearStaff` or a roles update in a transaction with certificates.
  - A 5-argument `add_staff_member` call becomes 4 arguments.
  - Tests of removed behaviour are converted to the new requirement's scenarios, or removed with the removed code named in the commit message:
    - `add_staff_member refuses what the roster must refuse`, the capability part;
    - the followup-without-admin `add_staff_member` refusal;
    - "Changed capabilities on a re-run".
  - Keep `No follow-up-only person can be stored`. Under the mirror it shows the write being replaced; assert the capabilities stay the mirror.

- [ ] **Step 4: Reviewer audit (Review Focus 4).** `grep -n "f.reviewer\|reviewer" tests/database*.mjs` for assertions that the fixture Reviewer cannot prepare or claim preparation. Each one either moves to a person who holds no role with `prepare` (for example an Intaker), or keeps the Reviewer and restates its expectation, with a one-line comment that the Reviewer role gives `prepare`.

- [ ] **Step 5: Run the whole suite.** Run: `timeout 1800 npm run test:database`. Expected: PASS (all files).

- [ ] **Step 6: Commit:** `git commit -m "052: staff setup takes no capabilities; tests move from the ceiling to roles"`, listing converted and removed tests in the body.

### Task 4: Granting and removing site coordinators, and deactivation

**Files:**
- Modify: `supabase/migrations/052_season_settings.sql` (new §7)
- Modify: `tests/database-site-coordinators.mjs`, `tests/database-accounts.mjs`

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces:
  - `public.vitally_set_site_coordinator(p_action_id uuid, p_volunteer_id uuid, p_expected_revision bigint, p_granted boolean) returns jsonb`, returning `{actionId, volunteerId, isSiteCoordinator, accountRevision}`. Receipts go in `action_receipts` as `vitally_deactivate_account` does. Check order:
    1. FORBIDDEN unless the caller is a site coordinator;
    2. NOT_FOUND for a person outside the workspace;
    3. `NO_ACTIVE_ACCOUNT`;
    4. CONFLICT on the revision;
    5. INVALID_TRANSITION for no change;
    6. on removal, `DEFAULT_FOLLOWUP`, then `LAST_SITE_COORDINATOR`.
  - `vitally_private.deactivate_account(p_workspace_id uuid, p_user_id uuid, p_changed_by uuid)`, copied from 047. First `drop function vitally_private.deactivate_account(uuid,uuid)`: a defaulted extra parameter would make 2-argument calls ambiguous. After the OPEN_WORK check, it raises `LAST_SITE_COORDINATOR` when the account is the last active site coordinator. Otherwise it clears the flag with an audit row whose `changed_by` is `p_changed_by`. Also redefine `public.vitally_deactivate_account` (from 047, `-- 052` lines) to pass the acting person's id, and `grep -n "deactivate_account(" supabase/migrations tests tools` for any other caller to update.

- [ ] **Step 1: Write the failing tests** for every scenario in `specs/site-coordinators/spec.md` "Only a site coordinator grants or removes site coordinator", "Every site coordinator change is recorded" and "Deactivating a site coordinator", plus `specs/sign-in-accounts/spec.md` "Deactivating the default follow-up person" and "Deactivating the last site coordinator". Add:
  - `default moved` (Review Focus 1): run `set_default_followup` to a second site coordinator; removing the first then succeeds;
  - `removing yourself while another remains` (Review Focus 3).

- [ ] **Step 2: Run to verify they fail.** Run: `timeout 600 node --env-file=.env.test --test tests/database-site-coordinators.mjs tests/database-accounts.mjs`.

- [ ] **Step 3: Implement §7.**

- [ ] **Step 4: Run Step 2's command after reset + migrate.** Expected: PASS.

- [ ] **Step 5: Commit:** `git commit -m "052: grant and remove site coordinators; deactivation keeps one"`

### Task 5: The default follow-up person may be a site coordinator

**Files:**
- Modify: `supabase/migrations/052_season_settings.sql` (new §8)
- Test: `tests/database-site-coordinators.mjs`

**Interfaces:**
- Produces: `vitally_private.can_be_default_followup(p_workspace_id uuid, p_person_id uuid) returns boolean`: the person has a sign-in, and is a site coordinator or has `followup` in `people.capabilities`. It is used by:
  - `set_default_followup` (from 038);
  - `initialize_workspace` (from 047, re-run check);
  - `act_escalate_contact` (from 004);
  - `act_approve_review` (from 033);
  - `act_withdraw` (from 036);
  - `act_close_case` (from 048).

  Each is copied verbatim, with the one changed line marked `-- 052`.

- [ ] **Step 1: Write the failing tests:**
  - `a site coordinator with no roles is accepted as default`: `set_default_followup` succeeds.
  - `escalate, approve-no, close-before-filing and withdraw assign to a roleless site coordinator default`: use the fixture's `readyCase` / `approvedCase({ wentOver: false })` / withdraw helpers. Each creates its follow-up assigned to that person.
  - `a default with the Admin role and no site coordinator still works`: clear every flag inside a transaction.
  - `a default who is neither is refused`: VALIDATION.

- [ ] **Step 2: Run to verify they fail** (same command as Task 4, this file).

- [ ] **Step 3: Implement §8.** Then record the diff for review: on the stack before 052 and after, run `select pg_get_functiondef('vitally_private.act_close_case(public.memberships,public.cases,public.people,jsonb)'::regprocedure)` for each of the four, and diff. Only `-- 052` lines may differ. Paste the diff into the task report.

- [ ] **Step 4: Run** this file plus `tests/database-hold.mjs tests/database-review.mjs tests/database-closed-after-filing.mjs tests/database-contacts.mjs`. Expected: PASS.

- [ ] **Step 5: Commit:** `git commit -m "052: a site coordinator can be the default follow-up person"`

### Task 6: `vitally_save_volunteer` for the Admin-role rule (replaces both 045 copies)

**Files:**
- Modify: `supabase/migrations/052_season_settings.sql` (new §9)
- Test: `tests/database-volunteer-roster.mjs`

**Interfaces:**
- Produces: `public.vitally_save_volunteer(uuid, uuid, bigint, jsonb)`, same signature and grants, copied from 045 Part 6 (line 1042), with these changes:
  - the admin check is `vitally_policy.is_workspace_admin`;
  - after validation and before the receipt, the save raises `ADMIN_ROLE` when `'admin'` is in exactly one of stored and requested roles (for an add, requested only) and the caller is not a site coordinator;
  - the open-work rule uses `role_capabilities(stored roles)` → `role_capabilities(requested roles)`, with no `v_ceiling`;
  - the `default follow-up person` row of `open_work` counts as met when the target is a site coordinator, for both the capability and the clearance part.

  The header comment says: "Replaces both definitions in 045 (Part 3, ~786, and Part 6, ~1042); Part 3's was dead code (#193 item 3)."

- [ ] **Step 1: Write the failing tests** for `specs/volunteer-roster/spec.md`:
  - "Only a site coordinator changes the Admin role" (all scenarios except the UI one);
  - "Only an admin can save a volunteer": "An uncleared site coordinator ticks their own certificates";
  - "A save cannot take away…": "A site coordinator who is the default".

- [ ] **Step 2: Run to verify they fail.** Run: `timeout 600 node --env-file=.env.test --test tests/database-volunteer-roster.mjs`.

- [ ] **Step 3: Implement §9.**

- [ ] **Step 4: Run** this file plus `tests/database-clearance.mjs tests/database-workload.mjs`. Expected: PASS.

- [ ] **Step 5: Commit:** `git commit -m "052: only site coordinators change the Admin role (#193 item 3)"`

### Task 7: Season settings storage and RPCs

**Files:**
- Modify: `supabase/migrations/052_season_settings.sql` (§3 table; new §10)
- Create: `tests/database-season-settings.mjs`

**Interfaces:**
- Produces:
  - `public.season_settings(workspace_id uuid primary key references public.workspaces(id) on delete cascade, certificate_upload_url text, client_documents_url text, revision bigint not null default 1, updated_at timestamptz not null default now(), updated_by_person_id uuid)`: one row per workspace, kept across seasons, with no season column. Row security is on, with no policy and no client grants. The SIDN stays in `vitally_private.site_numbers` (047), unchanged.
  - `public.vitally_season_settings() returns jsonb`, for a workspace admin, else FORBIDDEN. It returns `{season` (read from `workspaces.current_season`, not stored)`, certificateUploadUrl, clientDocumentsUrl, revision, siteNumber:{set, updatedAt}, canEdit, siteCoordinators:[{volunteerId, name, email, since, onRoster, accountRevision}], candidates:[{volunteerId, name}], history:[{personName, granted, changedByName, changedAt}]}`. An absent row reads as nulls with `revision: 0`. `history` is newest first, at most 50.
  - `public.vitally_save_season_settings(p_action_id uuid, p_expected_revision bigint, p_settings jsonb) returns jsonb`. `p_settings` is `{certificateUploadUrl, clientDocumentsUrl}`, each null, empty, or matching `^https://\S+$` case-insensitively after trim, at most 500 characters. Empty is stored as null, else stored trimmed. The save returns the same shape as the read's settings part. With `p_expected_revision 0` and no row, it inserts.
  - `public.vitally_set_site_number(p_action_id uuid, p_sidn text) returns jsonb`, returning `{set:true, updatedAt}`. It reuses `normalize_sidn`; `SIDN_FORMAT` otherwise.
  - All three are execute-granted to `authenticated` only.

- [ ] **Step 1: Write the failing tests** for every scenario in `specs/season-settings/spec.md` that the database can check. Add:
  - `links survive a season change`: save the links, update `workspaces.current_season` inside a rolled-back transaction, and the read returns the same links with the new `season`;
  - `links trim and accept HTTPS` (Review Focus 2);
  - `no answer contains the SIDN`: set the SIDN to `S12345678`, then JSON-stringify the answers of `vitally_season_settings`, `vitally_set_site_number` and `vitally_my_clearance`, and every row readable by the site coordinator's client from `accounts`, `workspaces`, `people`, `volunteer_profiles` and `season_settings`. None contains `12345678`;
  - the site check passes with the new SIDN.

- [ ] **Step 2: Run to verify they fail.** Run: `timeout 600 node --env-file=.env.test --test tests/database-season-settings.mjs`.

- [ ] **Step 3: Implement.** Add the new functions and table to the catalog tests' expected lists in `tests/database-catalog.mjs`.

- [ ] **Step 4: Run** this file and `tests/database-catalog.mjs`. Expected: PASS. Then run the whole suite: `timeout 1800 npm run test:database`. Expected: PASS.

- [ ] **Step 5: Commit:** `git commit -m "052: Season settings storage and RPCs"`

### Task 8: Roster command and seed

**Files:**
- Modify: `tools/admin/roster.mjs`, `tools/admin/roster.example.json`, `tools/admin/seed.mjs` (and `seed-values.mjs` if the checks live there)
- Test: `tests/roster.test.mjs`, `tests/seed.test.mjs`, `tests/database-seed.mjs`

**Interfaces:**
- Consumes: `initializeWorkspace` with `siteCoordinator` (Task 3).
- Produces:
  - `parseRoster(raw)` (existing name) returns staff entries `{email, name, personKey, siteCoordinator: boolean}` and `notices: string[]`;
  - notices: "capabilities is no longer used and was ignored; roles on the Roster decide what each person can do." (once) and "siteNumber is no longer used and was ignored; set the SIDN on Season settings.";
  - errors: "staff[<n>].siteCoordinator must be true or false." and "defaultFollowup must name a staff entry with siteCoordinator: true.";
  - the command no longer passes `siteNumber`.

- [ ] **Step 1: Write the failing unit tests** in `tests/roster.test.mjs` for each `specs/sign-in/spec.md` scenario on the file: the two notices, the two errors, an old file with `capabilities` accepted, and `siteCoordinator` passed through. In `tests/database-seed.mjs` / `tests/seed.test.mjs`, add "The Site Coordinator is not a site coordinator" (refusal naming `siteCoordinator: true`) and "No SIDN yet" (sets `S00000000`, leaves a set one alone). Add `re-run is a no-op` (Review Focus 5): running the same roster twice adds no `site_coordinator_changes` row and keeps the SIDN.

- [ ] **Step 2: Run to verify they fail.** Run: `timeout 300 npm test` and `timeout 600 node --env-file=.env.test --test tests/database-seed.mjs`.

- [ ] **Step 3: Implement.** In `roster.example.json`, remove every `capabilities` and `siteNumber`, and add `"siteCoordinator": true` to `site_coordinator`.

- [ ] **Step 4: Run Step 2's commands.** Expected: PASS.

- [ ] **Step 5: Commit:** `git commit -m "Roster command: siteCoordinator; capabilities and siteNumber ignored"`

### Task 9: Store, clearance helpers and the Roster form

**Files:**
- Modify: `src/supabase-store.mjs`, `src/clearance.mjs`, `src/volunteer-roster.mjs`, `src/volunteer-views.mjs`, `src/controller.mjs` (refusal sentences only)
- Test: `tests/clearance.test.mjs`, `tests/volunteer-roster.test.mjs`, `tests/volunteer-views.test.mjs`, `tests/controller.test.mjs`, `tests/store.test.mjs`

**Interfaces:**
- Produces:
  - store: `getSeasonSettings()`, `saveSeasonSettings({actionId, expectedRevision, settings})`, `setSiteNumber({actionId, sidn})`, `setSiteCoordinator({actionId, volunteerId, expectedRevision, granted})`. The accounts select adds `is_site_coordinator`.
  - `clearance.mjs`: `export const siteCoordinator = (principal) => principal?.clearance?.isSiteCoordinator === true`. `missingLines` maps `kind: "siteCoordinator"` to "Site coordinators need the SC certificate."
  - `combineVolunteers` row gains `isSiteCoordinator`, and its cleared and missing rule adds `"scCertificate"` after `photoId`, labelled "SC certificate missing" in `volunteer-views.mjs`.
  - The volunteer form takes `{ canChangeAdmin }`. When false, the Admin tick is `disabled` and keeps its saved state, with the hint "Only site coordinators change the Admin role." The controller sends `canChangeAdmin: siteCoordinator(state.principal)`.
  - Controller sentences:
    - save refusal `FORBIDDEN` with `cause.message === "ADMIN_ROLE"` → "Only site coordinators change the Admin role." in the form;
    - deactivate refusal `cause.message === "LAST_SITE_COORDINATOR"` → "At least one site coordinator must remain. Make someone else a site coordinator first." in the drawer.

- [ ] **Step 1: Write the failing unit tests:** `missingLines` SC line; `siteCoordinator()`; `combineVolunteers` SC rule (cleared false, missing `["scCertificate"]`); the disabled tick and hint; the two controller sentences; the store's RPC names and argument shapes (as `tests/store.test.mjs` does for existing calls).

- [ ] **Step 2: Run:** `timeout 300 npm test`. Expected: FAIL in those tests.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run:** `timeout 300 npm test`. Expected: PASS.

- [ ] **Step 5: Commit:** `git commit -m "Roster: SC rule, Admin tick for site coordinators, store calls"`

### Task 10: The Season settings screen

**Files:**
- Create: `src/season-settings-views.mjs`, `tests/season-settings-views.test.mjs`
- Modify: `src/role-gates.mjs`, `tests/role-gates.test.mjs`
- Modify: `src/views.mjs` (sidebar link after Post an update with `icon("settings")`, action `open-season-settings`; `CEILING_SCREENS`; page frame), `src/controller.mjs` (`STAFF_SCREENS`, `ADMIN_SETUP_SCREENS`, `screenAllowed`, actions, reads), the staff stylesheet used by `src/views.mjs` pages
- Test: `tests/controller.test.mjs`

**Interfaces:**
- Consumes: Task 9's store calls and `siteCoordinator()`.
- Produces:
  - `renderSeasonSettings(view, { canEdit, ui })` returns HTML following the brainstorm Q1 sketch. `view` is the `vitally_season_settings()` answer. `ui` holds `{ notice, fieldErrors, sidnDialogOpen, sidnError, busy }`.
  - Screen id `office-settings`.
  - Controller actions:
    - `open-season-settings` (reads, then shows);
    - `save-season-settings`;
    - `open-change-sidn` / `save-sidn` / `close-dialog`;
    - `add-site-coordinator` (picker value);
    - `remove-site-coordinator` (`data-volunteer-id`).

    Each write re-reads the page afterwards. `CONFLICT` on the links save re-reads and shows "Someone else changed these settings. Check them and save again."
  - The Change the SIDN dialog is added to `CEILING_DIALOGS` in `src/role-gates.mjs`, with its test in `tests/role-gates.test.mjs` (volunteer-clearance "Every dialog is classified by the capability it needs") as a ceiling dialog that is never replaced when effective capabilities change.

- [ ] **Step 1: Write the failing view tests:**
  - `the editable page`: the season heading "2027 for TY 2026" with "Current"; both labelled inputs with their help text; Save; "Set · updated" and "Change…"; the site coordinators list with "You", "since", "not on this season's roster"; the picker "Make someone a site coordinator…" offering only `candidates`; Add; Remove; a closed `<details>` "History" with the three line forms.
  - `the read-only page`: no `input`, `select` or action buttons, and the note.
  - `"Not set"` when `siteNumber.set` is false.
  - `field errors render beside their field`.
  - Escaping: names with `<` render as text.

- [ ] **Step 2: Write the failing controller tests:**
  - the link is offered to a workspace admin, cleared or not, and not to a Preparer;
  - a restored `office-settings` screen for a Preparer goes home;
  - each action calls its store function and re-reads;
  - `LAST_SITE_COORDINATOR` and `DEFAULT_FOLLOWUP` show their sentences, with `<name>` filled from the page's list;
  - a successful Add shows "<name> is now a site coordinator".

- [ ] **Step 3: Run:** `timeout 300 npm test`. Expected: FAIL.

- [ ] **Step 4: Implement.** CSS reuses the existing panel and field classes. Add only what the cards need (`settings-card`, `sc-list`, `sc-add`), with layout at phone width and no horizontal scroll.

- [ ] **Step 5: Run:** `timeout 300 npm test`. Expected: PASS. Run `timeout 120 npm run build:hant -- --check`. Expected: PASS (no client text changed).

- [ ] **Step 6: Commit:** `git commit -m "Season settings screen"`

### Task 11: Browser coverage

**Files:**
- Modify: `tests/browser.mjs`

**Interfaces:**
- Consumes: the fixture's `site_coordinator` site coordinator (Task 3) and the screen (Task 10).

- [ ] **Step 1: Record the baseline.**
  - Run `timeout 3600 npm run test:browser` on the Task 10 tree. Record the two story legs' durations and the total test and assertion counts from the run's evidence.
  - Any test that fails because a ceiling-only admin no longer reaches the Roster (for example "an uncleared admin records their own Admin role", which creates `uncleared_admin` with `capabilities: ["admin","followup"]`) is converted to `siteCoordinator: true`. Keep its steps.

- [ ] **Step 2: Add the test `"A site coordinator changes Season settings"`.**
  - It is a separate `test(...)` next to "An admin adds, finds and edits a volunteer on the Roster": outside both story legs and their 900 s limit, Chrome only, on its own fixture, `{ timeout: 300_000 }`. That follows the Roster test's precedent.
  - CI runs it in both `story` legs, as it does the Roster test: each leg skips only the other browser order.
  - Steps, as the Site Coordinator:
    1. Open "Season settings".
    2. Save the fictional certificate link `https://example.org/certificates` and see "Season settings saved".
    3. Change the SIDN to `S00000001` and see "Set · updated".
    4. Take a screenshot into the evidence folder.
  - Then sign in as the Preparer: no "Season settings" link.
  - Keep the console-quiet asserts the Roster test uses.

- [ ] **Step 3: Run:** `timeout 3600 npm run test:browser`. Expected: PASS. Both legs stay under 900 s with durations within noise of Step 1, and the test count is Step 1's plus 1 (state it). Review the new screenshot.

- [ ] **Step 4: Commit:** `git commit -m "Browser: Season settings walk"`

### Task 12: Docs, final checks and the local migration rehearsal

**Files:**
- Modify: `docs/developer/` pages that describe the roster file, capabilities and the database (find them with `grep -rln "capabilities\|siteNumber\|roster command" docs/developer docs/setup.md`); `docs/setup.md` where the roster file is shown.

- [ ] **Step 1: Update the docs:**
  - capabilities mirror roles;
  - the site coordinator and how the first one is made (`siteCoordinator: true`);
  - Season settings owns the SIDN;
  - the old keys are ignored;
  - the hosted deploy order from `design.md` Migration Plan.

- [ ] **Step 2: Run the full checks:**
  - `timeout 300 npm test`;
  - `timeout 120 npm run build:hant -- --check`;
  - `timeout 120 npx openspec validate --all`;
  - reset + `timeout 300 npm run db:migrate:test` + `timeout 1800 npm run test:database`;
  - `timeout 900 npm run test:auth-browser`.

  Expected: all PASS. Record outputs.

- [ ] **Step 3: Local rehearsal on a populated stack** (052 changes existing rows).
  - Ask the user before touching their persistent stack; report BLOCKED until they agree.
  - With agreement: read-only query of admins without the Admin role, then `pg_dump`, then `timeout 300 npm run db:migrate:test`.
  - If the guard refuses, report the count and stop. Don't change data to pass it without the user.
  - Then re-run the roster command with the updated example and `timeout 600 npm run seed:local`.

- [ ] **Step 4: Commit:** `git commit -m "Docs: Season settings, site coordinators and the capabilities mirror"`
