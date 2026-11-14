# Brainstorm: add-posted-updates

Issue #150, "Notifications and Post an update" (roadmap part 7, team features). Design image: `docs/design/screens/admin-post-update-full-page.png`.

The user agreed decisions D1 to D3 and the draft-delete addition in conversation on Nov 13, 2026. Before decision D4 was answered, the user told me to work on my own: pick my recommended option for each open question, record it under "Decided without the user (review)" below, and keep going through the whole lifecycle.

## Why now (from the user, for PCDC)

- At the meeting, PCDC said ViTally **adds** a platform instead of replacing one.
- This feature is meant to replace the part of Slack the office uses for announcements and reminders.
- Ruled out: chat, channels and direct messages. Replies stay off.
- The design's own example is the yearly **Standards of Conduct** reminder, Form 13615.
- In-app only. No email unless the user later agrees to it.

## What exists today (from the code)

- **Roles and clearance (`045_volunteer_clearance.sql`, capability `volunteer-clearance`):**
  - The current season's roster entry holds roles: Greeter, Intaker, Preparer, Reviewer, Admin.
  - A role exists only once its certificates are confirmed. **VSC (the signed 13615) is needed by every role.**
  - So the people a Standards of Conduct reminder is written for have **no roles**, and are not cleared.
  - An uncleared staff member sees only "Finish your setup for this season". A ceiling admin (`people.capabilities` has `admin`) also gets the Roster.
- **An uncleared window has no realtime channel.**
  - It re-reads its clearance on window focus, on `online`, and on Check again.
- **A cleared window keeps one channel over 19 tables.**
  - It re-reads on every event (#165 asks to measure this load before adding more).
  - The publication carries INSERT and UPDATE only.
- **Catalogue tests pin the database surface.** These have to be updated deliberately:
  - the exact list of policies;
  - the exact list of public RPCs ("eight", which the sign-in spec also states);
  - the `personId` digest check;
  - the exact `vitally_policy` functions;
  - the published tables equal `SUBSCRIBED_TABLES.staff`;
  - the count of 21 staff policies gated by clearance.
- **Already in place:**
  - `src/ui.mjs` already has `bell` and `megaphone` icons.
  - The confirm dialog pattern (`confirmBody`) and toasts (`notify`) exist.
  - The New York date helpers are in `src/contact-log.mjs`.
- **What the design shows that is out of scope:**
  - **Messages** in the sidebar (chat; out of scope);
  - Dashboard, Schedule, Documents, groups, pins and recent cases (other issues).

## Decision chain

### D1. The audience, and uncleared staff (user, agreed)
- An update's audience is **"All volunteers"** or **a chosen set of roles**.
  - "All volunteers" means everyone this season: every person with a current-season roster entry and a sign-in, cleared or not.
  - A role audience means everyone whose current-season entry holds one of the chosen roles.
- **Uncleared staff see the updates addressed to them.**
  - The Notifications bell is in the setup screen's sidebar too.
  - Updates are not case data, so the clearance rule (no case data before clearance) still holds.
- The admin's Post an update screen is open to an uncleared ceiling admin, as the Roster is.
- **No "Not yet cleared" audience for now** (user).
- **Resolved live, not frozen at post time** (user):
  - Someone added to the roster later still sees earlier updates, for example the Standards of Conduct reminder.
  - The read and confirmed denominators change as the roster changes, and that is fine.
- **"Has a sign-in" = an active `staff` membership today** (user), joined through `people.user_id`.
  - The parallel change add-account-invitations adds an accounts table. Once it lands, this check should switch to "an active account".
  - Note this in the design, but don't depend on it.

### D2. Posted updates only; shaped for system notifications later (user, agreed: Option 2)
- System events such as "case assigned to you" are **not** in this change.
- **Two tables now:**
  - `posted_updates`: drafts and posts;
  - `update_reads`: each person's read and confirmation.
- **One feed read in the panel's item shape:**
  - kind, title, body, link, author, posted time, edited, pinned, asks to confirm, read time, confirmed time.
  - The badge counts items in that shape.
- **A later change** adds `person_notices`, with its own clearance-gated read rule, to the same feed read. The panel and the badge don't change.
- "Shaped for both" means the feed's item contract, written into the spec. It doesn't mean one shared table.
- Rejected: one `notifications` table with a `kind` column. Its read rule would have to depend on a column (cleared if it names a case, audience otherwise), and half of each row's columns would be null.

### D3. The lifecycle (user, agreed)
```
             Post                Unpublish (confirm)
  [draft] ----------> [posted] -------------------> [unpublished]
   |  ^ Edit            |  ^ Edit (keeps reads, unless "Ask everyone
   |  +--+              +--+        to read it again" is ticked)
   v
 Delete (drafts only, confirm)
```
- **Draft:**
  - shown in the Posted updates table as "Draft", with Edit, Post and Delete;
  - nobody else sees it.
- **Delete is for drafts only** (user addition). A posted or unpublished update is never deleted, and the database refuses it.
- **Editing a posted update:**
  - It saves in place and keeps reads and confirmations by default.
  - With **"Ask everyone to read it again"** ticked, it clears every read and confirmation of that update, so it is unread again for everyone.
  - Either way the panel shows "Edited".
- **Unpublish:**
  - It needs a confirmation.
  - The update leaves every panel and the badge.
  - It stays in the table, marked "Unpublished", with its counts.
  - No re-post: to say it again, post a new one.
- Edit can change the audience. The denominator follows, because audiences are live.

### D4. Read, confirm, the badge and the order (my recommendation, taken under the user's instruction)
- **Read** = shown in an open panel. Opening the panel records a read for every update it shows that was unread.
- **Confirmed** = pressed "I've read this", only on updates that ask for it. Confirming also counts as reading.
- **The badge** counts updates that are unread, **or** that ask for confirmation and aren't confirmed. An unconfirmed Standards of Conduct reminder keeps the bell lit.
- **Order:**
  - pinned updates first, newest first;
  - then the rest, newest first.
  - Pinned means "keep at the top until" is today or later in New York time. The field is optional: blank means not pinned. A past date only stops pinning; nothing expires.
- **Highlighting:** unread and unconfirmed items are highlighted.
- Alternatives:
  - read on a click per item: an extra click each time, and it blurs read and confirmed;
  - a badge for unread only: the confirmation nudge would disappear after one look.

## Decided without the user (review)

The user asked me to make these calls and list them here, each with its alternatives and reason.

1. **D4 as above** (read, confirm, badge, order). Alternatives and reasons are in D4.

2. **Who may post: a ceiling admin, cleared or not.**
   - This matches the Roster (`vitally_policy.is_workspace_admin`, `people.capabilities` has `admin`).
   - Alternative: effective admin only (cleared with the Admin role). An admin finishing their own setup couldn't then post the Standards of Conduct reminder that everyone else needs first.
   - D1 already says the screen is open to an uncleared admin.

3. **The audience vocabulary on screen is "All volunteers"**, the design's wording, or "Chosen roles" with checkboxes for the five roles.
   - The database stores `audience` as `everyone` or `roles`, with `audience_roles text[]`.
   - Alternative: a multi-select of roles where "all five" means everyone. But someone with a roster entry and no roles is in "everyone" and in no role, so the two must stay distinct.

4. **The IRS link:**
   - It is offered only for "IRS policy update", as the design's label "Link to the IRS source" says.
   - It must be `https://irs.gov/…` or `https://www.irs.gov/…` (or another `*.irs.gov` host), up to 500 characters.
   - An office notice has no link.
   - Alternative: any https link on both types. That widens what the office can push to volunteers beyond "relay the IRS source", and makes a phishing-looking link possible in a trusted place.

5. **Field limits:**
   - title 1–120 characters, message 1–2000, both trimmed;
   - keep-at-top date optional, with no past-date refusal in the database. The form's date picker starts at today, and a past date simply doesn't pin.
   - Alternative: refuse past dates. Re-saving an old update would then fail for a reason unrelated to the edit.

6. **Data access: one SELECT policy for realtime, every read through RPCs.**
   - `posted_updates`:
     - granted SELECT, with two policies: ceiling admins read every row in their workspace, and staff in the live audience read non-draft rows;
     - the second policy calls a new `vitally_policy.in_update_audience(...)`.
   - `update_reads`:
     - row security on, with **no grants and no policies**;
     - only the security-definer RPCs touch it.
   - The feed and the admin table come from RPCs, which compute live audiences and counts.
   - **Unpublished rows stay readable to the audience**, but the feed leaves them out. Realtime checks RLS against the new row, so if an unpublished row stopped being readable, an open volunteer window would never hear about the unpublish. Its contents were already shown to that audience.
   - Alternative: no table SELECT at all, with live updates through a separate broadcast. That adds a second realtime mechanism to an app that has one.

7. **Realtime: `posted_updates` joins the existing channel. `update_reads` is not published.**
   - A posted update is written rarely (post, edit, unpublish), so the extra re-reads are rare.
   - The per-subscriber RLS check runs once per change per open staff window.
   - Reads and confirmations are frequent, and would wake every admin window. So the admin's counts refresh when the Post an update screen opens, on window focus, and after the admin's own actions, not live.
   - Uncleared windows have no channel. Their feed and badge refresh on focus, `online` and Check again, together with the clearance check.
   - Alternatives:
     - a separate channel for updates: more connections per window (#165);
     - polling: the project rule is to react to changes, not poll.

8. **Five new public RPCs (8 → 13).** This modifies the sign-in spec's list of public RPCs, a direct consequence of the agreed feature.
   - `vitally_save_update(p_action_id, p_update_id, p_expected_revision, p_update jsonb)`: create, or edit, a draft or a posted update; with `post: true`, it saves and posts in one go. It has a receipt and keeps `personId` in the digest.
   - `vitally_update_action(p_action_id, p_update_id, p_expected_revision, p_type)`: `POST`, `UNPUBLISH` or `DELETE` (drafts only). It has a receipt.
   - `vitally_mark_updates(p_update_ids uuid[], p_confirm boolean)`: record reads, or confirmations, for the caller.
     - It is naturally idempotent and keeps the first time, so it has **no receipt**.
     - Ids the caller can't see in their feed are ignored without saying why.
   - `vitally_my_updates()`: the caller's feed and badge count. Staff only, cleared or not.
   - `vitally_posted_updates()`: the admin table: every update with its live audience size, read and confirmed counts, and each audience member's read and confirmed state.
   - Alternative: fewer, overloaded RPCs, for example one "updates" RPC with a type. That mixes receipt and non-receipt calls and admin and non-admin checks.

9. **"Who has confirmed".** The design's checkbox note says "you can see who has confirmed". Pressing a row's read or confirmed count opens a small dialog listing the live audience, with each person's name, read time and confirmed time.
   - These are staff names, not client data, and every staff member can already read `people`.
   - Alternative: counts only. The design's own copy would then promise something the screen doesn't do.

10. **Preview card: included.** It re-renders from the form as the admin types, using the same item renderer as the panel.
    - Alternative: no preview. It is in the design and cheap, because it reuses the panel's renderer.

11. **Seed data: not in this change.** `seed:local` doesn't add sample updates.
    - Seeding them would modify the `local-seed-data` capability and its replace-on-rerun rule for a nice-to-have. An admin can post one live in a demo in seconds.
    - Noted as a possible follow-up.

12. **The browser test is a separate top-level test,** like the Roster's ("An admin adds, finds and edits a volunteer on the Roster"): Chrome only, its own fixture, its own timeout.
    - It doesn't touch the main story's phases or its 900 s per-order limit (#126).
    - Alternative: new phases in the main story. That would spend the story's limited time.

13. **Sidebar.**
    - **"Notifications"** (bell, with a badge when the count is more than 0) is for every staff member, cleared or not.
    - **"Post an update"** (megaphone) is for a ceiling admin, after Volunteers.
    - Clients get neither.
    - The badge's accessible name is "Notifications, N unread".

14. **The panel is a drawer.** It uses the existing dialog and drawer frame, with a close button and the design's footer: "Office admins relay IRS policy updates here. Replies are turned off."
    - Alternative: a popover anchored to the bell. A new overlay pattern, worse on a narrow screen.

15. **Error codes: no new SQLSTATE.** The existing codes cover this change:
    - `FORBIDDEN` (not a ceiling admin, or not staff);
    - `NOT_FOUND`;
    - `CONFLICT` (stale revision);
    - `INVALID_TRANSITION` (editing an unpublished update, unpublishing a draft, deleting a posted one);
    - `VALIDATION`.

16. **Migration number 046** (`046_posted_updates.sql`). Before the PR: merge `main` and renumber it if 046 is taken (the user's instruction).

## Out of scope
- System notifications (`person_notices`).
- Email or any outside delivery.
- Replies, reactions, chat, channels, direct messages, the Messages entry.
- A "Not yet cleared" audience.
- Seed data.
- Any client-facing (applicant) screen.
- Chinese text. Staff screens are English, so no `client-text.mjs` change.
