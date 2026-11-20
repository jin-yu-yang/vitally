## Why

Season settings is the root of the rest of #138: the 13615 / photo ID upload needs its upload link, #157 needs the client documents link, Start next season will live on this page, and the SIDN moves here from the roster command. It also closes a gap: invitation activation writes a fixed `people.capabilities` ceiling without `admin`, and effective capabilities are roles ∩ ceiling. So an Admin role ticked in the app never takes effect, and only the roster command can make an admin. Doing this now unblocks the upload, client-documents and new-season changes.

## What Changes

**Where capabilities come from**
- From: `people.capabilities` is a ceiling written by the roster command (and fixed to `{assist, prepare, receive_documents, review}` by invitation activation); effective capabilities = current-season role capabilities ∩ ceiling.
- To: `people.capabilities` is a mirror kept by triggers: the capabilities of the person's current-season roles while they have a sign-in, `{}` otherwise. Effective capabilities = role capabilities. Neither the roster command nor activation writes the column.
- Reason: an Admin role given in the app must take effect; role changes then reach open windows through `people` realtime.
- Impact: breaking for anyone who relied on a ceiling wider or narrower than their roles. Roster files keep working, but their `capabilities` no longer do anything.

**Roster and settings access**
- From: `is_workspace_admin` = `admin` in `people.capabilities`.
- To: `is_workspace_admin` = site coordinator, or holds the Admin role this season. Clearance is still not required.
- Impact: Roster, accounts, posted updates and Season settings follow it.

**Site coordinator (new)**
- `accounts.is_site_coordinator`, kept across seasons, audited in `site_coordinator_changes`.
- Only site coordinators grant or remove it, on Season settings. It is granted only to an active account. The last site coordinator can't be removed or deactivated. Neither can the default follow-up person lose site coordinator.
- Only site coordinators add or remove the Admin role on the Roster.
- A site coordinator on this season's roster is cleared only with the SC certificate confirmed.

**Season settings page (new)**
- Shows the current season label, the certificate and photo ID upload link, the client documents upload link (both `https://` only), the SIDN (write-only: "Set · updated <date>" and Change), and the site coordinators with their history.
- Site coordinators edit; other admins see it read-only.

**Default follow-up person**
- From: must hold `followup` in `people.capabilities`.
- To: must be a site coordinator in the roster file. Every check of the default follow-up person accepts "site coordinator, or `followup` this season".

**Roster command**
- Gains `siteCoordinator: true`, which grants and never removes.
- Stops setting capabilities and the SIDN. Following the `presenters` precedent, a file that still has `capabilities` or `siteNumber` is accepted, the keys are ignored, and the command says so. A re-run can then never overwrite what the app now owns.
- `defaultFollowup` must name a `siteCoordinator: true` entry.
- `seed:local` sets a fictional SIDN when the workspace has none, so local invitations keep working.

**Migration 052**
- Refuses, with counts, if a person with an active sign-in holds admin through the old ceiling but has no Admin role this season.
- Then recomputes every person's mirror.
- Its `vitally_save_volunteer` replaces both 045 copies (#193 item 3).

## Capabilities

### New Capabilities
- `season-settings`: the Season settings page and its stored values (upload links, SIDN ownership), who reads and who writes them.
- `site-coordinators`: the account-level site coordinator flag, its audit history, who grants and removes it, the at-least-one and default-follow-up rules, and its place in clearance.

### Modified Capabilities
- `volunteer-clearance`: effective capabilities are the role capabilities (the ceiling goes); `people.capabilities` is the mirror; SC is needed to clear a site coordinator; `vitally_my_clearance` answers workspace admin and site coordinator; ceiling wording becomes workspace admin.
- `volunteer-roster`: `is_workspace_admin` is site coordinator or Admin role; only site coordinators change the Admin role; the Roster's "Ready for the season" applies the SC rule; the open-work rule uses role capabilities, and a site coordinator meets the default follow-up need.
- `sign-in-accounts`: activation and account linking recompute the mirror instead of writing a fixed ceiling; deactivating the last site coordinator is refused; the SIDN is set on Season settings.
- `sign-in`: the roster file's `siteCoordinator`, no `capabilities`, and a `defaultFollowup` that must be a site coordinator; checks on the default follow-up person accept a site coordinator.
- `office-follow-up`: the approval's office person may be a site coordinator or hold `followup` this season.
- `posted-updates`: "ceiling admin" becomes workspace admin (site coordinator or Admin role).
- `volunteer-workload`: scenarios that rely on a ceiling wider than the roles are restated.
- `local-seed-data`: the seed's Site Coordinator account is a site coordinator; the example roster has no capabilities.

## Impact

- **Database:** new migration `supabase/migrations/052_season_settings.sql`. It adds `accounts.is_site_coordinator`, `site_coordinator_changes`, a season settings table, and the mirror triggers on `people` and `roster_entries`. It rewrites `effective_capabilities`, `is_workspace_admin`, `cleared`, `vitally_my_clearance`, `vitally_save_volunteer`, `add_staff_member`, `vitally_record_account`, `deactivate_account`, `set_default_followup`, `initialize_workspace`, and the four case actions that check the default follow-up person. It also adds new RPCs for Season settings and site coordinators.
- **Front end:** `src/views.mjs` (sidebar, routing), `src/controller.mjs` (new screen, actions, clearance flag), `src/supabase-store.mjs`, `src/clearance.mjs`, `src/volunteer-roster.mjs`, `src/volunteer-views.mjs` (Admin role tick for non-site-coordinators), and a new view module for Season settings plus CSS.
- **Tools:** `tools/admin/roster.mjs`, `tools/admin/workspace-setup.mjs`, `tools/admin/roster.example.json`, `tools/admin/seed*.mjs`.
- **Tests:** new and converted database tests. Tests that write `people.capabilities` directly move to roles. The fixture gains a site coordinator, and the browser story gains a short Season settings walk.
- **Docs:** `docs/developer/` database and roster notes, and the hosted deploy order in the PR body.
- **Later dependency:** Start next season must recompute the mirror when `current_season` changes.
