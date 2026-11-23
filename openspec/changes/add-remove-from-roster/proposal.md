## Why

There is no way to take a volunteer off this season's Roster. Cancel invitation and Deactivate both leave the person listed, so test volunteers, people added by mistake and volunteers who leave mid-season stay on the Roster for good. Testers and the first season need to tidy it before Dec 21 (#232). After an admin re-adds someone whose account is deactivated, the drawer also gives no hint that Reactivate is needed (#269).

## What Changes

**Remove from this season's roster (new)**
- A "Remove from this season's roster…" action in the Roster's Edit drawer, behind a confirmation that names the person and their email and says what will happen.
- A new RPC, `vitally_remove_from_roster`. It deletes the person's current-season roster entry, so their certificates and the record of what they sent go with it. It keeps `people` and `volunteer_profiles`, raises the profile revision, and deactivates the account in the same step, except a site coordinator's. It marks the person's shifts from today on removed, so they leave the Schedule (#140), and keeps earlier ones. It records the removal in a new `roster_removals` table.
- Refused while the person holds open work (`OPEN_WORK`), for the caller's own row (`SELF`), for a person with the Admin role unless the caller is a site coordinator (`ADMIN_ROLE`), and for a site coordinator unless the caller is a site coordinator (`FORBIDDEN`). Stale revisions get `CONFLICT`, and a repeated action id returns the stored result.
- Current season only. Past seasons' rosters are unchanged. A removed person comes back through Add a volunteer's returning-volunteer search (#267).

**Pointing to Reactivate (#269)**
- From: after saving a picked earlier volunteer whose account is deactivated, the drawer closes, and the Roster just says "Account deactivated".
- To: the drawer stays open on that person with the notice "<name> is back on this season's roster. Their account is deactivated. Reactivate it so they can sign in." When the drawer is opened later, a short note under Reactivate says "Reactivate so they can sign in." Only one of the two shows at a time.
- Impact: non-breaking. Every other save still closes the drawer.

Migration 059. No change for clients. Staff text is English only.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `volunteer-roster`: adds removal from this season's roster (the RPC, its refusals, the confirmation, the record of removals, the removal of the person's shifts from today on in `volunteer-schedule`) and the Reactivate pointer after a re-add.
- `sign-in-accounts`: removal becomes another user of the internal deactivation, alongside Deactivate and Start next season.
- `site-coordinators`: only a site coordinator removes a site coordinator from the roster, and removal never deactivates a site coordinator's account.
- `volunteer-clearance`: removal empties the person's capabilities mirror. A removed person's window shows "This account has no access" on its next wake, and a removed site coordinator's shows the setup screen.

## Impact

- **Database:** `supabase/migrations/059_remove_from_roster.sql`, with the `roster_removals` table and `vitally_remove_from_roster`. No change to existing functions; the only existing rows written are the removed person's own, their shifts from today on included.
- **Browser:**
  - `src/supabase-store.mjs`: a `removeFromRoster` request, and the Roster read learns who has shifts from today on.
  - `src/controller.mjs`: the action, its refusals, and the #269 notice.
  - `src/volunteer-views.mjs` and `src/views.mjs`: the drawer button, the confirmation dialog, and the Reactivate note.
  - `src/app.mjs`: wiring.
- **Tests:**
  - unit tests for the views, controller and store;
  - a new database test file for the RPC;
  - the RPC added to `tests/database-catalog.mjs`;
  - a browser test in its own `test(...)` block in `tests/browser.mjs`, outside the story.
- **Docs:** `docs/developer/database.md` and `docs/developer/frontend.md`.
- **Deploy:** once Zeye has approved, 059 is applied to the hosted database before merge.
- **Issues:** Closes #232 and #269. Part of #138.
