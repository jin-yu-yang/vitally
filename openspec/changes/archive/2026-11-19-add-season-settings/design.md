## Context

Today `people.capabilities` is a **ceiling**:
- The roster command writes it.
- Invitation activation writes a fixed `{assist, prepare, receive_documents, review}` to it (`047_accounts.sql:813`).
- Effective capabilities are `role_capabilities(current-season roles) ∩ ceiling` (`045 effective_capabilities`).
- The Roster's admin check, `vitally_policy.is_workspace_admin` (044), reads the ceiling directly.

So an Admin role ticked in the app never takes effect, and only the roster command makes admins.

Season settings is the root of the rest of #138:
- the upload link for the 13615 / photo ID upload;
- the client documents link for #157;
- the future Start next season;
- the SIDN. 047 says "a later Season settings change owns it".

The site coordinator, an account-level role kept across seasons, governs that page and the Admin role.

**What the code already gives us** (read during propose, 2026-11-19):
- `acting_person`, `check_operation_authority` and `contact_person` (045/046) already swap in effective capabilities. So the case RPCs, the 051 label check and the 046 assignee check follow role capabilities with no change.
- `is_workspace_admin` already needs an active staff membership and no clearance.
  - It gates the Roster records (044), every accounts RPC (047), and posted updates (049).
  - It also gates the `accounts` and `certificates` read policies.
- `vitally_my_clearance` (047) returns `isAdmin = 'admin' = any(people.capabilities)` and `siteCoordinatorName` (the default follow-up person's name). `src/clearance.mjs` `ceilingAdmin` gates the Roster, Post an update and the setup-screen admin links on `isAdmin`.
- #190 re-reads `vitally_my_clearance` on wake and after a refusal, so an access change reaches an open window on its next focus without realtime.
- The default follow-up person is checked for `followup` in seven places:
  - the setters `set_default_followup` (038) and `initialize_workspace` (047 re-run check);
  - the assignee checks in `act_escalate_contact` (004), `act_approve_review` (033), `act_withdraw` (036) and `act_close_case` (048);
  - `open_work`'s "default follow-up person" row (045).

  `open_work` already refuses deactivating the default follow-up person (OPEN_WORK).
- `staff_people` (044 (c)) hides a person with no sign-in and empty capabilities from non-admin staff. `cancel_invitation` writes `capabilities='{}'` when it unlinks.
- Tests write `people.capabilities` directly to shape a ceiling, in:
  - `database-actions`, `database-assistance`, `database-documents` and `database-staff-identity`;
  - `add_staff_member` callers in `database-accounts`, `database-staff-identity` and `database-clearance`.

Constraints:
- Fictional data only.
- Migrations are final once applied.
- Staff screens are English.
- The browser story is at about 550–600 s per leg against 900 s.
- 052 changes existing rows, so it also needs a local `db:migrate:test` on a stack that already has main's migrations.

The decision log is in `brainstorm.md`.

## Goals / Non-Goals

**Goals:**
- A role given in the app is what a person can do. The Admin role makes an admin.
- A site coordinator role that lasts across seasons, governs the Admin role and Season settings, and always has at least one holder.
- A Season settings page that stores the two upload links and owns the SIDN.
- Clearance asks a rostered site coordinator for the SC certificate.
- A safe hosted migration: refuse rather than silently drop anyone's admin.

**Non-Goals:**
- Site hours (#140).
- The uploads themselves and "I've uploaded it".
- Start next season.
- The returning-volunteer picker.
- Roster CSV.
- The #104 switch.
- Realtime delivery of site coordinator changes. Wake re-reads are enough.
- Recomputing the mirror on `current_season` change. That belongs to Start next season.

## Decisions

### D1: `people.capabilities` is a mirror of this season's roles (sign-in only)
- **Choice:**
  - A `BEFORE INSERT OR UPDATE` trigger on `people` sets `capabilities` to `role_capabilities(current-season roster roles)` when `user_id` is not null, and to `{}` otherwise. A direct write to the column is therefore replaced.
  - An `AFTER INSERT OR UPDATE OF roles, season, person_id OR DELETE` trigger on `roster_entries` touches the affected person's `people` row for a current-season entry, so the `BEFORE` trigger recomputes it.
  - `effective_capabilities` becomes the role capabilities alone, with no intersection.
  - The column stays, with 042's `followup ⇒ admin` check. Admin's role capabilities hold both.
  - The roster command, `add_staff_member` and `vitally_record_account` no longer write capabilities. Linking a sign-in (activation, `add_staff_member`'s link) recomputes them through the trigger.
- **Why:**
  - Every existing reader (`is_workspace_admin`, 044's visibility, the follow-up checks, the front end's realtime `people`) keeps working with no rewrite.
  - Role changes now reach open windows through `people` realtime (helps #236).
  - "Sign-in only" keeps 044 (c): a Roster volunteer with roles and no sign-in stays invisible to non-admin staff, and `cancel_invitation` stays as it is (user ruling).
- **Alternatives considered:**
  - Rewrite every reader to compute from roles: about 15 functions plus policies.
  - Drop the column: breaks the realtime contract.
  - A pure mirror including people with no sign-in: exposes them to all staff.
  - Refusing a direct write instead of replacing it: would break `cancel_invitation` and `add_staff_member`'s writes for no gain.

### D2: Workspace admin = site coordinator or the Admin role this season
- **Choice:** `is_workspace_admin(ws)` = the caller has an active `staff` membership and either `'admin' = any(people.capabilities)` (the mirror, so the Admin role this season) or an active account with `is_site_coordinator`. There is no clearance check.
  - `vitally_my_clearance.isAdmin` returns `is_workspace_admin`, and a new `isSiteCoordinator` is added.
  - `vitally_save_volunteer`'s admin check uses `is_workspace_admin`.
  - The posted-updates RPCs already do.
- **Why:** an uncleared admin or site coordinator can still tick their own certificates, and a site coordinator who isn't on this season's roster still reaches the Roster and Season settings.
- **Alternatives considered:**
  - Requiring clearance: deadlocks a new site coordinator.
  - Site coordinator only: every admin would need the flag.

### D3: Only a site coordinator changes the Admin role
- **Choice:** in `vitally_save_volunteer`, if `'admin'` is in exactly one of (stored roles, requested roles), the caller must be a site coordinator. Otherwise the save is refused with `FORBIDDEN` (detail `ADMIN_ROLE`) before any write. Other roles stay with any workspace admin.
  - On the Roster form, the Admin tick is disabled for a non-site-coordinator, with the hint "Only site coordinators change the Admin role."
- **Why:** the user's decision. Admin grants roster access, so it is the one role an admin must not hand out.

### D4: Site coordinator flag, audit and the at-least-one rule
- **Choice:**
  - Add `accounts.is_site_coordinator boolean not null default false`.
  - Add `public.site_coordinator_changes(id, workspace_id, person_id, granted boolean, changed_by_person_id null, changed_at)`. A null `changed_by_person_id` means the roster command.
  - Writes go through `vitally_set_site_coordinator(p_action_id, p_volunteer_id, p_expected_revision, p_granted)`, with a receipt and the account revision.
  - Refusals:

    | Condition | Code (detail) |
    |---|---|
    | Caller is not a site coordinator | `FORBIDDEN` |
    | Target has no active account | `VALIDATION` (`NO_ACTIVE_ACCOUNT`) |
    | No change | `INVALID_TRANSITION` |
    | Target is the last site coordinator | `INVALID_TRANSITION` (`LAST_SITE_COORDINATOR`) |
    | Target is the default follow-up person | `INVALID_TRANSITION` (`DEFAULT_FOLLOWUP`) |
    | Stale revision | `CONFLICT` |

  - "Site coordinators" means active accounts with the flag.
  - `deactivate_account` refuses the last site coordinator (`INVALID_TRANSITION`, `LAST_SITE_COORDINATOR`). It already refuses the default follow-up person through `open_work` (OPEN_WORK).
  - *My call:* deactivating any other site coordinator also clears their flag, with an audit row (changed_by = the deactivating admin), so no hidden site coordinator comes back on reactivation.
  - The roster command grants through `vitally_private.grant_site_coordinator(ws, user_id)`, writing an audit row with a null `changed_by`. It never removes.
- **Why:** the user's decision D4. Clearing on deactivation keeps "who is a site coordinator" visible in one list.
- **Alternatives considered:**
  - Keep the flag through deactivation: a reactivated account would silently regain the power.

### D5: Season settings storage and API
- **Choice:**
  - Add `public.season_settings(workspace_id, certificate_upload_url, client_documents_url, revision, updated_at, updated_by_person_id)`, primary key `workspace_id`: one row per workspace, kept across seasons. It has no grants to signed-in users and is not in realtime.
  - The SIDN stays where 047 put it, `vitally_private.site_numbers`, one per workspace.
  - Nothing about the season is stored here; the label comes from `workspaces.current_season`.
  - *User ruling at plan review:* per workspace, not per season. The SIDN is the site's number and doesn't change by year. Per-season links would leave Start next season with empty links and broken upload buttons until someone refilled them.
  - Links are null or `https://` URLs: trimmed, at most 500 characters, validated with `^https://[^\s]+$` (`VALIDATION`, naming the field).
  - `vitally_season_settings()`, for a workspace admin:
    - `season` (the number), the two links and `revision`;
    - `siteNumber: {set: boolean, updatedAt}`, never the number;
    - `siteCoordinators: [{volunteerId, name, email, since, onRoster, accountRevision}]`;
    - `history` (newest first, at most 50);
    - `canEdit` (caller is a site coordinator);
    - `candidates`: active staff accounts who are not site coordinators, for the picker.
  - `vitally_save_season_settings(p_action_id, p_expected_revision, p_settings)`: site coordinator only, with a receipt, a revision check and `CONFLICT`.
  - `vitally_set_site_number(p_action_id, p_sidn)`: site coordinator only. It reuses `normalize_sidn`'s rule (`VALIDATION`, `SIDN_FORMAT`) and returns only `{set: true, updatedAt}`.
  - The season label is drawn in the browser: "<season> for TY <season − 1>".
- **Why:** the SIDN stays write-only (decision 7): `vitally_private.site_numbers` is unchanged, and only `vitally_complete_site_check` compares against it. One read RPC keeps the page to one request.
- **Alternatives considered:**
  - Keyed by season: rejected by the user (see above).
  - Columns on `workspaces`: every staff member reads `workspaces`.
  - Row security on `season_settings`: harder to keep the SIDN out.

### D6: The SC certificate is part of clearance for a rostered site coordinator
- **Choice:**
  - `cleared()` adds: the person is not a site coordinator, or `'sc'` is among their confirmed certificates this season.
  - `vitally_my_clearance.missing` adds `{kind: 'siteCoordinator', certificates: ['SC']}` after the role items. The setup screen shows "Site coordinators need the SC certificate."
  - The Roster's "Ready for the season" applies the same rule. `combineVolunteers` reads `is_site_coordinator` from `accounts`, and the missing label is "SC certificate missing".
  - Roster and settings access are unaffected (D2).
- **Why:** the user's decision D6.

### D7: The default follow-up person is a site coordinator (user ruling A)
- **Choice:**
  - A helper, `vitally_private.can_be_default_followup(ws, person)`: the person has a sign-in and is a site coordinator, or has `followup` in the mirror.
  - It replaces the `followup` test in all seven places listed in Context:
    - `set_default_followup` and the `initialize_workspace` re-run check;
    - the four act_* assignee checks;
    - `open_work`'s default row, which the open-work rule now counts as met for a site coordinator. So a site coordinator who is the default may lose the Admin role, but `deactivate_account` still refuses them.
  - Clearance is never asked of the default (unchanged).
  - The roster file's `defaultFollowup` must name a `siteCoordinator: true` entry.
  - `vitally_set_site_coordinator` refuses removing the default (D4).
  - The four act_* functions are copied verbatim from their latest definitions. The one changed line in each carries `-- 052`.
- **Why:**
  - Under D1 the roster command can't give `followup`, so a fresh workspace (roster on a new stack, `seed:local`, the fixture) could not otherwise set a default.
  - The site coordinator flag survives role and season changes.
  - The user named three places; the same rule covers the four case actions and `open_work`, which make the same check.
- **Alternatives considered:**
  - (B) Keep `followup` and let the roster command stop setting the default. Rejected by the user.

### D8: Migration 052 guard and order
- **Choice:**
  - The 043/045-style guard refuses, with counts (`VT008`), if any person with an active staff membership has `'admin'` in `people.capabilities` but no `'admin'` role in their current-season entry.
  - *My call:* only active memberships are counted, since an inactive one already has no admin.
  - Then the migration:
    1. snapshots `(workspace_id, person_id, capabilities)` into `vitally_private.capabilities_before_052`, for rollback;
    2. adds the columns, tables and triggers;
    3. recomputes every person with `update public.people set capabilities = capabilities`;
    4. replaces the functions.
  - It marks nobody as site coordinator.
  - Its `vitally_save_volunteer` header says it replaces both 045 copies (Part 3's and Part 6's), closing #193 item 3.
- **Why:** refusing keeps the hosted classroom from losing an admin silently. The snapshot is cheap insurance, because the old ceiling can't be rebuilt from roles.

### D9: Roster command and tools
- **Choice:**
  - `siteCoordinator: true` is optional per staff entry and grants the flag after `add_staff_member`, in the same transaction.
  - `capabilities` and `siteNumber` are accepted, ignored, and reported ("… is no longer used and was ignored; …"), as `presenters` is.
  - `add_staff_member` becomes `(ws, user, key, name)`. The 5-argument form is dropped, and the identical-values re-run check no longer compares capabilities.
  - `workspace-setup.initializeWorkspace` takes `siteCoordinator` per staff entry, and grants before `set_default_followup`. It keeps `siteNumber` for tests and the seed only.
  - `roster.example.json` loses `capabilities` and gains `siteCoordinator: true` on `site_coordinator`.
  - `seed:local` requires the `site_coordinator` account to be a site coordinator. It sets the fictional SIDN `S00000000` when none is set.
  - The database fixture marks `site_coordinator` as a site coordinator, and adds `sc` to the certificates it confirms for a site coordinator. `clearStaff` keeps turning fixture capabilities into roles.
- **Why:** decision 9. Ignoring the old keys lets the hosted roster file re-run at deploy step 3 with only `siteCoordinator` added, and a re-run can't overwrite the SIDN set in the app.

### D10: Front end
- **Choice:**
  - A new screen, `office-settings`, "Season settings". It is in `CEILING_SCREENS` and `ADMIN_SETUP_SCREENS`. The sidebar link follows Post an update, with the `settings` icon, for a workspace admin, cleared or not.
  - A view module `src/season-settings-views.mjs` follows the approved sketch (`brainstorm.md`, Q1):
    - the season card with both links and Save;
    - the SIDN row with "Set · updated <date>" or "Not set", and Change… opening a small dialog with one input;
    - the Site coordinators card with Remove, the "Make someone a site coordinator…" picker with Add, and History in a `<details>`.
  - A non-site-coordinator sees values as text, no controls, and "Only site coordinators can change these settings."
  - Refusals show in the card: `LAST_SITE_COORDINATOR` "At least one site coordinator must remain. Make someone else a site coordinator first."; `DEFAULT_FOLLOWUP` "<name> is the default follow-up person, so they stay a site coordinator."
  - The page reads on open and after each of its writes.
  - The deactivate drawer maps `LAST_SITE_COORDINATOR` to the same sentence.
  - `clearance.mjs`: a new `siteCoordinator` export reads `isSiteCoordinator`, and `missingLines` gains the SC line. The Roster's Admin tick follows D3.
- **Why:** the user picked "Settings page only" as the one place to grant. Re-reads on open and wake (#190) are enough. There is no realtime for a low-traffic page.

## Risks / Trade-offs

- **[Risk]** Tests that write `people.capabilities` directly now do nothing, because the trigger replaces the value, and they could pass for the wrong reason. **Mitigation:** convert each one listed in Context to roles (`clearStaff` / roster writes), and add a test that a direct write is replaced by the mirror. Per the test-removal rule, convert rather than delete, and name the code each test covered.
- **[Risk]** `database-shaded` and `database-client-numbers` change `current_season` directly, which leaves the mirror stale for the rest of their run. **Mitigation:** they don't assert capabilities. Note it in the test, and record "recompute on season change" as Start next season's dependency.
- **[Risk]** Hosted deploy window: between 052 and the roster re-run there is no site coordinator. Nobody can edit Season settings, grant site coordinator or change the Admin role, and escalations pass only through "`followup` this season". **Mitigation:** deploy step 1 gives every admin the Admin role, so they keep the Roster and the follow-up checks pass. Steps 2–3 run back to back.
- **[Risk]** Copying four large case-action functions into 052 can drift. **Mitigation:** the implementing task diffs `pg_get_functiondef` for each one before and after migrating. Only lines marked `-- 052` may differ, and the reviewer checks that diff. The existing follow-up and close tests cover the rest of their behaviour.
- **[Trade-off]** A site coordinator who isn't on this season's roster has Roster and settings access but no case access. That is accepted: it is the prototype's Dana case.
- **[Trade-off]** Site coordinator changes reach the target's other windows on wake, not instantly. That is accepted (#190 pattern).
- **[Risk]** The story budget. **Mitigation:** *my call*, following the Roster's precedent ("An admin adds, finds and edits a volunteer on the Roster" runs outside the story and its time limit). The Season settings walk is its own Chrome test beside it, not a phase in either leg. The Site Coordinator opens Season settings, saves the upload link, sets the SIDN and takes a screenshot, and the Preparer sees no link. Both legs' times are measured before and after to show they are unchanged. CI runs it in both `story` jobs: each leg skips only the other browser order (`--test-skip-pattern`), so like the Roster test it runs once per leg, inside the job's 45-minute limit.

## Migration Plan

**Hosted (classroom) deploy order. Put this in the PR body.**
1. In the current Roster, give every admin VSC, IT&QR and the Admin role. Without this, 052's guard refuses, listing the count.
2. Run migration 052: `tools/admin/migrate.mjs --target classroom`, with `NODE_EXTRA_CA_CERTS` set.
   - From here until step 3, there is no site coordinator.
   - The Admin role keeps every admin on the Roster.
   - Escalations, approvals, withdrawals and closes reach the default follow-up person through "`followup` this season", which step 1 gave them.
   - Season settings is read-only to everyone.
3. Re-run the roster command with `siteCoordinator: true` on Hailey Zheng's entry, and `defaultFollowup` naming her key. That makes her both site coordinator and the default follow-up person.
   - The file's old `capabilities` / `siteNumber` are ignored and reported.
   - `initialize_workspace`'s re-run check passes, because the current default holds `followup` from step 1.
4. Hailey ticks her own SC certificate on the Roster. She stays uncleared but can still reach the Roster.

**No-sign-in persons:** under the sign-in-only mirror, a person with no sign-in has no capabilities and is hidden from non-admin staff. On the hosted database, `select count(*) from public.people where user_id is null and cardinality(capabilities) > 0;` returned 0 on 2026-11-19, so 052 hides nobody there and no pre-check step is needed.

**Local:** run `npm run db:migrate:test` on a stack that already has main's migrations, then `npm run test:database`. Then re-run the roster command and `seed:local` with the updated example roster.

**Rollback:** migrations are forward-only. A follow-up migration can restore the old ceiling from `vitally_private.capabilities_before_052` and drop the triggers. **Start next season** (the later #138 change) drops the snapshot table. Once a season has rolled over, the old ceiling has nothing left to restore. That change's proposal must list the drop next to its mirror-recompute dependency.

## Open Questions

- None blocking. Recorded dependencies for Start next season:
  - recompute the mirror when `current_season` changes;
  - keep site coordinators' accounts active;
  - drop `vitally_private.capabilities_before_052`.
