## Why

PCDC lets nobody work a season until their signed Form 13615 is on file, with the certifications their role needs, and a new volunteer's photo ID has been checked. ViTally records roles and certificates since #187, but they grant nothing. Today any staff account with roster capabilities sees and changes client data whatever its paperwork says. This second slice of #138 makes the Roster the gate: a staff member works on case data only when cleared for the current season, and their roles decide what they can do. It lands after M5 (Nov 16), so the Nov 11 review and M5 run on today's behaviour.

## What Changes

**A role needs its certificates**
- From: roles and certificates are recorded freely and are independent of each other.
- To: a role can exist only when its certificates are confirmed. A deferred constraint trigger enforces this on `roster_entries` and `certificates` for every writer. Unticking a certificate removes the roles that need it.
- Reason: no role is ever "recorded but not in effect".
- Impact: breaking for #187 rows that have unsupported roles. The migration strips them from people with no sign-in, and refuses if a person with a sign-in would lose one.

**Clearance gates case data**
- From: every active staff member reads all case data and can call the six case RPCs within their roster capabilities.
- To: only a **cleared** staff member does. Cleared means a current-season roster entry with at least one role, plus a photo ID check if the volunteer is new.
  - The 21 case-data SELECT policies gain a once-per-statement clearance check.
  - The six case RPCs refuse uncleared staff with new error **VT009 `NOT_CLEARED`**, before any lookup.
  - `people` and the Roster stay readable, so an uncleared admin can set themselves up.
- Reason: PCDC's rule that nobody works without their paperwork.
- Impact: breaking for staff with no roles, which today is every staff account. Fixtures and `seed:local` clear the role accounts.

**Roles grant capabilities**
- From: what a staff member can do depends only on `people.capabilities` from the roster command.
- To: the caller's **effective capabilities** are the union of their roles' capabilities ∩ `people.capabilities`. That ceiling is kept for now, and checks of other people stay on it.
- Reason: the role decides the work, and the old command can't widen it.
- Impact: non-breaking for the seeded role accounts, whose roles match their current capabilities.

**Other changes**
- **Open-work rule:** a Roster save that would take away a capability the person's open work needs, or leave them uncleared while holding open work, is refused with a list of that work.
- **Photo ID:** `roster_entries.is_new` and `photo_id_checked_at`, with "New volunteer" and "Photo ID checked" in the Edit drawer. Add a volunteer opens with New volunteer ticked.
- **A save may have no roles,** for a volunteer still waiting for their 13615.
- **Setup screen:** an uncleared staff member sees "Finish your setup for this season". It lists what's missing, names the site coordinator (the default follow-up person, name only) and has a Check again button that also runs on window focus. An uncleared admin also gets Volunteers. VT009 from any action switches to it.
- **New functions:** `vitally_policy.cleared_workspace_id()`, `cleared(person, season)` and `vitally_my_clearance()`.
- **Seed and docs:** `seed:local` gives the four role accounts roles and certificates, and corrects the fictional volunteers so every role is backed. It keeps one volunteer with no roles. The demo script and the setup checklist are updated.

## Capabilities

### New Capabilities
- `volunteer-clearance`: what it means to be cleared for a season, effective capabilities, the case-data gate (policies and RPCs, VT009), the role-needs-certificates rule and its migration, the open-work rule, photo ID, and the setup screen.

### Modified Capabilities
- `volunteer-roster`: roles no longer grant nothing. The save allows no roles, refuses an unsupported role, and applies the open-work rule. The drawer gains New volunteer and Photo ID checked. The Roster text changes. `vitally_policy` holds a second function.
- `sign-in`: the public RPC catalog lists `vitally_save_volunteer` and `vitally_my_clearance`. "Capabilities still apply" now uses effective capabilities.
- `staff-case-work`: "Staff see every case" applies to cleared staff only.
- `local-seed-data`: the seed clears the four role accounts and backs every volunteer's roles with certificates.

## Impact

- **Database:** a new migration (045) with the trigger, the columns, the helper functions and their grants, the edits to the 21 policies, the six RPC entry checks, and the effective capabilities used by `acting_person`, `check_operation_authority` and `vitally_create_case`. `vitally_save_volunteer` gets new validation and the open-work rule.
- **App:** `src/` error mapping for VT009, the setup screen, effective capabilities for the signed-in person's own buttons, and the drawer fields.
- **Tools and tests:** `tools/admin/seed-values.mjs` and `seed-cases.mjs`; `tests/support/database-fixture.mjs` clears role accounts by default (`cleared: false` opts out); new database tests, auth-browser and browser story updates.
- **Docs:** `docs/demo-script.md` and `docs/setup.md`.
- **No new dependencies.** Only local and CI stacks are affected.
