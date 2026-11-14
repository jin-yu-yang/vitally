## Context

- **The gap:** the office announces IRS policy changes, office notices and the yearly Standards of Conduct reminder in Slack. ViTally has no way to do this (#150).
- **The rule from PCDC:** ViTally should add a platform, not replace one. So this is announcements only: no chat, channels, direct messages or replies.
- **Starting point (from `add-volunteer-clearance`, migration 045):**
  - Each workspace has a current season.
  - Each person's `roster_entries` row for that season holds their roles.
  - A role exists only once its certificates are confirmed. Every role needs VSC (the signed Form 13615).
  - A staff member is cleared when the entry has a role (plus a photo ID check if new).
  - Uncleared staff see only the setup screen, and have no realtime channel. Their window re-reads its clearance on focus, `online` and Check again.
  - A ceiling admin (`people.capabilities` has `admin`, checked by `vitally_policy.is_workspace_admin`) can use the Roster while uncleared.
- **Realtime:** a cleared window keeps one channel over the 19 tables in `STAFF_TABLES`.
  - On each INSERT or UPDATE it re-reads through the same RLS-scoped paths, using identifiers only.
  - #165 asks to keep this load measured.
- **Catalogue tests pin the database surface.** Each one is updated deliberately in this change:
  - the exact policies;
  - the exact public RPCs (`tests/database-catalog.mjs`, `tests/support/rpc-signatures.mjs`);
  - the `personId` digest check;
  - the exact `vitally_policy` functions;
  - the published tables equal `SUBSCRIBED_TABLES.staff` (`tests/database-store.mjs`);
  - Riley reads every row of the subscribed tables (`tests/database-staff-identity.mjs`);
  - the count of 21 gated staff policies (`tests/database-clearance.mjs`).
- **Design reference:** `docs/design/screens/admin-post-update-full-page.png`.
- **Where the decisions came from:** `brainstorm.md` records them, including those made without the user.

## Goals / Non-Goals

**Goals:**
- Ceiling admins write, post, edit, unpublish and (for drafts) delete updates, each with a type, title, message, optional IRS link, audience, pin date and confirmation request.
- Every staff member, cleared or not, sees the updates addressed to them in a Notifications panel, with an unread badge, and confirms when asked.
- Admins see live read and confirmed counts against the live audience, and who has read and confirmed.
- One feed item contract that later system notifications can join without changing the panel.
- No case data reaches uncleared staff. No extra realtime channel.

**Non-Goals:**
- System notifications, email, replies, chat, channels, direct messages and the design's Messages entry.
- A "Not yet cleared" audience.
- Seed data.
- Client screens. No Chinese text: staff screens stay English.

## Decisions

### D1: Two tables, RPC-only reads and writes, one SELECT policy for realtime
- **Choice:**
```
posted_updates
 id uuid pk default gen_random_uuid()
 workspace_id uuid not null -> workspaces on delete cascade
 kind text not null check in ('irs_policy','office_notice')
 title text not null check (title = btrim(title) and length between 1 and 120)
 message text not null check (message = btrim(message) and length between 1 and 2000)
 irs_link text null check (length <= 500 and ~* '^https://([a-z0-9-]+\.)*irs\.gov(/[^[:space:]]*)?$')
   check (irs_link is null or kind = 'irs_policy')
 audience text not null check in ('everyone','roles')
 audience_roles text[] not null default '{}' check (<@ the five roles)
   check ((audience = 'roles') = (cardinality(audience_roles) > 0))
 keep_top_until date null
 ask_confirm boolean not null default false
 status text not null check in ('draft','posted','unpublished')
 created_by_person_id uuid not null   -- (workspace_id, ...) -> people, deferrable initially deferred
 posted_by_person_id uuid null        -- same
 created_at timestamptz not null default now()
 posted_at timestamptz null, edited_at timestamptz null, unpublished_at timestamptz null
 revision bigint not null default 1
 check ((status = 'draft') = (posted_at is null))
 check ((status = 'unpublished') = (unpublished_at is not null))
 unique (workspace_id, id)

update_reads
 workspace_id uuid not null
 update_id uuid not null, (workspace_id, update_id) -> posted_updates(workspace_id, id) on delete cascade
 person_id uuid not null, (workspace_id, person_id) -> people(workspace_id, id) on delete cascade
 read_at timestamptz not null default now()
 confirmed_at timestamptz null
 primary key (update_id, person_id)
```
- **Access:**
  - Both tables: row security enabled; `revoke all ... from public, anon, authenticated, service_role`.
  - `posted_updates`: `grant select ... to authenticated`, with two policies:
    - `admin_posted_updates`: `using (vitally_policy.is_workspace_admin(workspace_id))`;
    - `audience_posted_updates`: `using (status <> 'draft' and vitally_policy.in_update_audience(workspace_id, audience, audience_roles))`.
  - `update_reads`: no grant and no policy.
- **Rationale:**
  - The feed and the counts need live audience logic and a join with reads. RPCs compute both in one place.
  - The SELECT policy exists so realtime can deliver `posted_updates` changes to the right windows.
  - Unpublished rows stay readable to their audience (the feed leaves them out). Realtime checks RLS against the new row, so a row that became unreadable would never tell an open window it was unpublished.
- **Alternatives:**
  - Direct table reads in the browser: the counts would need roster tables that only admins can read.
  - Broadcast-only realtime: a second mechanism.

### D2: Live audience = active staff membership + current-season roster entry (+ role overlap)
- **Choice:** `vitally_private.audience_member(workspace_id, person_id, audience, audience_roles)` is true when:
  - the person's `people.user_id` has an active `staff` membership in the workspace;
  - **and** the person has a `roster_entries` row for `workspaces.current_season`;
  - **and** either `audience = 'everyone'` or the entry's `roles && audience_roles`.
- `vitally_policy.in_update_audience(workspace_id, audience, audience_roles)` applies it to the caller's own person. It is security definer, stable, `search_path=''`, and executable by `authenticated` only.
- **Note for later:** once add-account-invitations' accounts table lands, replace "active staff membership" with "active account" in `audience_member`. This is the only place to change.
- **Rationale:** it is resolved live, as the user decided. Someone added to the roster later sees earlier updates, and denominators follow the roster.
- **The policy text never contains `access = 'staff'`.** So `database-clearance.mjs`'s count of 21 still holds. The canonical scenario is reworded (delta spec) to name `posted_updates` as excluded.

### D3: RPCs
Each RPC:
- is security definer, `search_path=''`;
- resolves the caller with `require_membership()` and `acting_person()`;
- refuses a non-staff caller, or a caller with no person, with `FORBIDDEN`;
- has `revoke all` / `grant execute to authenticated`;
- takes no person parameter;
- skips the clearance check. A ceiling admin is checked with `vitally_policy.is_workspace_admin`.

| RPC | Who | Receipt | What it does |
|---|---|---|---|
| `vitally_save_update(p_action_id uuid, p_update_id uuid, p_expected_revision bigint, p_update jsonb)` | ceiling admin | yes (`SAVE_UPDATE`, digest keeps `'personId', v_person.id`) | Creates a draft (id and revision null) or edits a draft or posted update. `p_update` = `{kind, title, message, irsLink, audience, roles, keepTopUntil, askConfirm, post, askAgain}`. Validates (VT007 `VALIDATION`, detail = field). `post:true` on a new update or a draft posts it (`status='posted'`, `posted_at`, `posted_by`). Editing a posted update sets `edited_at`; `askAgain:true` deletes that update's `update_reads`. Editing an unpublished update gives VT004. A stale revision gives VT003; an unknown id or one in another workspace gives VT002. Returns `{actionId, updateId, revision, status}`. |
| `vitally_update_action(p_action_id uuid, p_update_id uuid, p_expected_revision bigint, p_type text)` | ceiling admin | yes (`UPDATE_ACTION`) | `POST`: draft to posted. `UNPUBLISH`: posted to unpublished (`unpublished_at`). `DELETE`: a draft only; the row is deleted. Any other state gives VT004; an unknown type gives VT007. Returns `{actionId, updateId, revision, status}` (`status: 'deleted'` for a delete). |
| `vitally_mark_updates(p_update_ids uuid[], p_confirm boolean)` | staff | none (naturally idempotent) | At most 200 ids, else VT007. For each id that is in the caller's feed (posted, caller in audience), upserts `update_reads`: keeps an existing `read_at`. With `p_confirm` and `ask_confirm`, sets `confirmed_at` if null. Other ids are ignored silently. Returns `{marked: n}`. |
| `vitally_my_updates()` | staff (cleared or not) | none | The feed: `{items: [...], unread: n}`. Items are the posted updates the caller is in the audience of, in this order: pinned (`keep_top_until >= today in New York`) first, then the rest, `posted_at desc` within each group. |
| `vitally_posted_updates()` | ceiling admin | none | Every update in the workspace, `coalesce(posted_at, created_at) desc`. Each row has its fields, `audienceSize`, `readCount`, `confirmedCount`, and `people: [{personId, name, readAt, confirmedAt}]` for the live audience. Counts count only current audience members. |

- **The feed item contract** (the panel and badge depend only on this):
  - `{source: 'posted_update', id, kind, title, message, irsLink, postedAt, postedByName, edited, pinned, askConfirm, readAt, confirmedAt}`.
- **The badge:** `unread` = the number of items with `readAt` null, or with `askConfirm` true and `confirmedAt` null.
- **A later `person_notices`** adds items with `source: 'person_notice'` to the same function.
- **The catalogue:**
  - `RPCS` and `RPC_SIGNATURES` grow to 13.
  - The digest test exempts the three receipt-less RPCs, as it exempts `vitally_my_clearance`, with a comment why.
  - The `vitally_policy` list gains `in_update_audience(uuid,text,text[])`.

### D4: Realtime
- **Choice:**
  - `posted_updates` is added to the `supabase_realtime` publication, with the usual guarded `do $$` block.
  - It is added to `STAFF_TABLES`, not to `CLIENT_TABLES`. `update_reads` is not published.
  - In `controller.handleChange`, `table === 'posted_updates'` re-reads the feed, and the admin list when the Post an update screen is open.
  - Uncleared windows read the feed in `holdForClearance` and on every `checkClearance`.
  - The admin list is read on opening the screen, on refresh (focus or `online`), and after each of the admin's own saves or actions.
- **Rationale:**
  - Posts are rare, so this adds a few re-reads per post (#165).
  - Reads and confirmations are frequent. Publishing them would wake every admin window on every panel open.
- **Alternative:** a separate channel per feature. That means more connections.

### D5: Browser structure
- **`src/posted-updates.mjs` (pure):**
  - `validateUpdate(form)`, mirroring the database checks with the same messages;
  - `AUDIENCE_LABELS`, `KIND_LABELS`, `audienceLabel(update)`;
  - `badgeCount(items)`, which mirrors `unread`;
  - `isPinned(date, todayNY)`;
  - `toUpdateRequest(form)`.
- **`src/update-views.mjs`:**
  - `renderNotificationsPanel(feed)`: drawer content, using the item renderer `renderFeedItem(item)` shared with the preview;
  - `renderPostUpdatePage(state)`: form, preview, table;
  - `renderUpdatePeople(update)`: the "who" dialog;
  - confirm bodies for Unpublish and Delete, using `confirmBody`.
- **`src/views.mjs`:**
  - `staffSidebar` adds the Notifications button (bell, badge, `aria-label="Notifications, N unread"`) for every staff window, setup screen included;
  - it adds Post an update (megaphone) after Volunteers for a ceiling admin;
  - routing adds screen `office-updates`, allowed for a ceiling admin cleared or not, as `office-volunteers` is.
- **`src/controller.mjs`:**
  - state: `updates` (feed), `updatesUnread`, `postedUpdates`, `lists.updates`, `lists.postedUpdates`, `updateForm` (draft form values and edit target), `updateFormError`;
  - methods: `loadFeed`, `openNotifications` (marks unread shown items as read, then re-reads), `confirmUpdate(id)`, `loadPostedUpdates`, `saveUpdate(form, {post})`, `updateAction(id, type)`, `editUpdate(id)`, `cancelUpdateEdit()`;
  - the same offline and retry pattern as `saveVolunteer` (keep the request and its action id for an idempotent retry);
  - state is reset on sign-out.
- **`src/app.mjs`:**
  - the actions `open-notifications`, `open-post-update`, `confirm-update`, `edit-update`, `post-draft`, `open-unpublish-update`, `open-delete-update`, `open-update-people`, plus submit of `update-form`;
  - the preview re-renders on form input, without a store round trip.
- **Dates:** New York "today" comes from the existing `contact-log.mjs` helpers (`nowInput().slice(0,10)`). The date input's `min` is today.

### D6: Tests
- **`tests/database-posted-updates.mjs`** (new), using `createDatabaseFixture`, for every scenario in the delta spec:
  - audience rules (live, roles, an uncleared person with a roster entry, no roster entry, an inactive membership);
  - the lifecycle and its refusals;
  - receipts and replay;
  - reads and confirms;
  - `askAgain`;
  - realtime visibility through RLS;
  - `update_reads` not readable directly.
  - Asserts only on its own workspace.
- **The catalogue tests above** are updated.
- **Unit tests:** `posted-updates.test.mjs`, `update-views.test.mjs`, and additions to `controller.test.mjs`, `store.test.mjs`, `shell.test.mjs` / `volunteer-views.test.mjs` (sidebar), and `confirm-dialogs.test.mjs` (golden file).
- **Browser:** a new top-level test, Chrome only, with its own fixture and timeout. It doesn't touch the main story or its 900 s limit.

## Risks / Trade-offs

- [Risk] **The per-subscriber RLS check runs `in_update_audience` for every open staff window on each posted-update change.** → Mitigation: writes are rare (admin actions). The function is one indexed lookup (`roster_entries` primary key, `memberships` primary key).
- [Risk] **A volunteer whose role audience was narrowed by an edit doesn't get the realtime event** (the new row fails RLS). → Mitigation: their feed re-reads on focus and `online`. That is acceptable for an announcement.
- [Trade-off] **Admin counts are not live.** → Acceptable: they refresh on screen open, focus and the admin's own actions, and the alternative wakes every admin window on each read.
- [Trade-off] **The read count means "shown in an open panel".** → Confirmation is the stronger signal, and the copy says so.
- [Risk] **The catalogue tests break in several files at once.** → Mitigation: each update is listed in the plan, and CI's database job is the check.
- [Risk] **Migration number collision with parallel changes (#138 accounts, #139 Workload).** → Mitigation: merge `main` before the PR, and renumber if 046 is taken.

## Migration Plan

- **Forward:** `046_posted_updates.sql` only creates objects. Nothing existing changes except the publication, which gains one table. No backfill.
- **Rollback:** a new migration that drops the five RPCs, the policy helper, both tables, and removes the table from the publication. Applied migrations are never edited.
- **Acceptance:**
  - `npm test`, `npm run build:hant -- --check` and `npx openspec validate --all` pass locally.
  - The CI jobs `checks`, `database`, `sign-in` and `story` (both legs) pass on the branch head.

## Open Questions

- **System notifications (`person_notices`).** Owner: the user, in a later change. It affects only the feed function's union and a new table. The panel and the badge are fixed by the contract.
- **Switching `audience_member` to "active account" once add-account-invitations lands.** Owner: whichever change lands second. It affects one function.
