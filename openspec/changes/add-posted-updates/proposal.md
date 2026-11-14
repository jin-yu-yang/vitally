## Why

The PCDC office posts announcements and reminders in Slack: IRS policy changes, hours and closures, the yearly Standards of Conduct. At the meeting, PCDC said ViTally adds a platform instead of replacing one. This change takes over that part of Slack inside ViTally, with no chat. Admins post an update to the season's volunteers, or to chosen roles. Volunteers see it in a Notifications panel behind a bell with an unread badge, and confirm it when asked. The office sees who has read and confirmed. Uncleared volunteers see updates too, because the Standards of Conduct reminder is meant for them (issue #150).

## What Changes

**New: Post an update (admin)**
- A screen for a ceiling admin, cleared or not, with these fields:
  - type: IRS policy update or Office notice;
  - title and message;
  - an optional `irs.gov` link, for IRS updates only;
  - who sees it: All volunteers, or chosen roles;
  - an optional "keep at the top until" date;
  - an optional "ask volunteers to confirm they have read it".
- Save draft or Post update. A live preview shows the update as volunteers will see it.
- A Posted updates table lists every update:
  - draft, posted or unpublished;
  - type, posted date and audience;
  - read and confirmed counts with bars, which open a list of who has read and confirmed;
  - Edit, and Unpublish with a confirmation;
  - Post and Delete for drafts, Delete with a confirmation.
- Editing a posted update keeps reads, unless "Ask everyone to read it again" is ticked.

**New: Notifications (every staff member)**
- A Notifications entry with a bell and an unread badge in every staff sidebar, the setup screen's included.
- It opens a panel: pinned updates first, then the rest, newest first in each group.
- Opening the panel marks what it shows as read. "I've read this" appears when confirmation is asked.
- The badge counts unread updates and updates still waiting for confirmation. Replies are off.

**Audience resolved live**
- "All volunteers" = every person with a current-season roster entry and an active staff membership, cleared or not.
- A role audience = those whose current-season entry holds a chosen role.
- People added to the roster later see earlier updates, and the counts' denominators follow the roster.

**Database**
- Migration `046_posted_updates.sql`:
  - tables `posted_updates` and `update_reads`;
  - policy helper `vitally_policy.in_update_audience`;
  - five public RPCs: `vitally_save_update`, `vitally_update_action`, `vitally_mark_updates`, `vitally_my_updates`, `vitally_posted_updates`.
- `posted_updates` joins the realtime publication. `update_reads` does not.

**Modified: the public RPC list**
- From: exactly eight public RPCs.
- To: thirteen, adding the five above. Each takes no person parameter, and execute is granted to `authenticated` only.
- Reason: the feature's writes and reads go through RPCs.
- Impact: non-breaking. The catalogue tests are updated.

**Modified: what an uncleared staff member sees**
- From: only the setup screen (plus the Roster for a ceiling admin). Every staff-branch policy except `people` is gated by clearance.
- To: also the Notifications bell and panel, and Post an update for a ceiling admin. `posted_updates`' audience policy is not gated by clearance, because updates are not case data.
- Reason: the Standards of Conduct reminder must reach volunteers before they are cleared.
- Impact: non-breaking. No case data is exposed.

## Capabilities

### New Capabilities
- `posted-updates`: posting, editing, unpublishing and deleting updates; live audiences; the Posted updates table and its counts; the Notifications panel, the badge, read and confirm; the feed item contract that later system notifications will share; realtime and access rules.

### Modified Capabilities
- `volunteer-clearance`: the setup screen also offers Notifications, and Post an update for a ceiling admin. The case-data gating scenario excludes `posted_updates`.
- `sign-in`: the list of public RPCs grows from eight to thirteen.

## Impact

- **Database:** `supabase/migrations/046_posted_updates.sql`; tests `tests/database-posted-updates.mjs` (new), `tests/database-catalog.mjs`, `tests/support/rpc-signatures.mjs`, `tests/database-clearance.mjs`, `tests/database-store.mjs`, `tests/database-staff-identity.mjs`.
- **Browser:** `src/posted-updates.mjs` (new; rules and helpers), `src/update-views.mjs` (new), `src/supabase-store.mjs`, `src/controller.mjs`, `src/app.mjs`, `src/views.mjs` (sidebar and routing), `src/styles.css`; unit tests beside them; a new top-level test in `tests/browser.mjs`.
- **Docs:** `docs/developer/database.md`, `README.md`, `architecture.md`, `backend.md` and `frontend.md`, where they list RPCs, tables or realtime.
- **No change to:** client screens, client text, the intake catalogue, the seed, Supabase or library versions.
