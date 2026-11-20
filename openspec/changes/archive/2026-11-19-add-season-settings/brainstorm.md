# Brainstorm: add-season-settings

Raw capture. The design was brainstormed with the user in an earlier session
(lifecycle step 2), where all five promotion criteria held. This session
recorded it, checked each decision against the code before writing, raised
two conflicts, and recorded the user's rulings on them. The two questions the
user left open for propose are at the end.

Part of #138. Migration 052.

## Background: why this change

Season settings is the root of the rest of #138:

- the 13615 / photo ID upload needs its upload link;
- #157 needs the client documents link;
- Start next season is a site coordinator action on this page;
- the SIDN moves here (047 recorded the roster command as its owner "for now";
  "a later Season settings change owns it").

It also fixes a gap. An invited volunteer's activation writes
`people.capabilities = {assist, prepare, receive_documents, review}`
(`047_accounts.sql:813`). Effective capabilities are roles ∩ that ceiling
(`045 vitally_private.effective_capabilities`), so an Admin role ticked in the
app never takes effect: only the roster command makes admins today.

## Scope

In:
- a Season settings page: current season label, certificate / photo ID upload
  link, client documents upload link, SIDN;
- site coordinator: a flag on `accounts`, kept across seasons, with an audit
  table, granted and removed in the app;
- Admin decided by this season's roles;
- SC certificate folded into clearance for site coordinators;
- roster command changes.

Out:
- site hours per day (moves to #140);
- uploads and "I've uploaded it";
- Start next season;
- returning-volunteer picker;
- Roster CSV;
- the #104 switch.

## Decision chain (agreed in the earlier session)

**D1. The ceiling goes; `people.capabilities` becomes a mirror of this
season's roles.**
The column stays, but neither the roster command nor invitation activation
writes it any more. A trigger keeps it equal to the capabilities of the
person's current-season roster roles. `vitally_private.effective_capabilities`
drops the intersection. Existing readers should mostly stay unchanged; check
each one:
- `is_workspace_admin`;
- 044's people visibility;
- the `vitally_save_volunteer` admin check;
- `isAdmin` in the clearance and accounts payloads;
- 051's label check;
- 047's default follow-up check in `add_staff_member` / `initialize_workspace`;
- the front end, through realtime `people`.

Role changes then reach open windows through `people` realtime, which helps
#236. This was chosen over rewriting every reader. Start next season (a later
change) must recompute the mirror when `current_season` changes; that is
recorded as its dependency.

**D2. Roster / settings access (`vitally_policy.is_workspace_admin`) = site
coordinator, or holds the Admin role this season.**
It does not require clearance, so an uncleared admin or site coordinator can
still tick their own certificates.

**D3. Only site coordinators add or remove the Admin role.**
Any admin may change the other roles, as today.

**D4. Site coordinator flag and audit.**
- The flag is `accounts.is_site_coordinator`.
- Every change is audited in `site_coordinator_changes` (person, granted,
  changed_by, changed_at).
- Only site coordinators grant or remove it.
- There is always at least one: removing or deactivating the last site
  coordinator is refused.
- It is granted only to a person with an active account.

**D5. Only site coordinators edit Season settings.**
Admins open the page read-only.

**D6. SC is part of clearance.**
A site coordinator on this season's roster is cleared only with SC confirmed,
on top of at least one role and the photo ID check if new. Roster and settings
access are unaffected. Update `cleared()`, `vitally_my_clearance()` and the
setup screen's missing items to match.

**D7. The SIDN is write-only on the page.**
The page shows "Set · updated <date>" and Change, and never reads the number
back through the API (as with 047's `vitally_private.site_numbers`). Season
settings replaces the roster command as its owner.

**D8. Upload links.**
They take `https://` only. They are stored now and used by the uploads change
and #157.

**D9. The first site coordinator.**
- The migration marks nobody: there are no real names in the repo.
- The roster command gains `siteCoordinator: true` and stops setting
  capabilities.
- `seed:local` uses a fictional site coordinator.
- Fixtures (`fixture.staff`) keep working through roles.

**D10. Migration guard (043 / 045 style).**
The migration refuses, with counts, if a person with a sign-in holds admin
through the roster command but has no Admin role this season. People with no
sign-in are not guarded.

## Hosted deploy order (agreed)

1. In the current Roster, give every admin VSC, IT&QR and the Admin role.
2. Run migration 052 (`tools/admin/migrate.mjs --target classroom`, with
   `NODE_EXTRA_CA_CERTS`).
3. Run the roster command with `siteCoordinator: true` for Hailey Zheng.
4. Hailey ticks her own SC certificate.

## Checked against the code during propose (2026-11-19)

I read every place that reads `people.capabilities` or `is_workspace_admin`
in migrations 038–051, plus the roster command, `workspace-setup.mjs`, the
database fixture and the canonical specs. Findings:

- `is_workspace_admin` (044) reads `'admin' = any(people.capabilities)`
  directly, the ceiling and not the effective capabilities. It requires an
  active staff membership and no clearance, which already matches D2's "no
  clearance". It is used by:
  - the Roster records (044);
  - the accounts RPCs (047: prepare/record/deactivate/reactivate/cancel/expire
    invitations, client invitations);
  - the posted-updates RPCs and policy (049);
  - the accounts and certificates read policies.

  With D2, a site coordinator without the Admin role reaches all of those.
  That follows from D2.
- `acting_person`, `check_operation_authority` and `contact_person` (045, 046)
  already replace `capabilities` with the effective capabilities. The case
  RPCs, 051's label check (`v_person.capabilities` from `acting_person`) and
  046's assignee check therefore follow D1 with no change, because effective
  becomes role capabilities.
- `vitally_save_volunteer` (latest is 045 line 1042; the 786 copy is the dead
  one that #193 item 3 refers to) checks admin on `v_person.capabilities`. That
  is the effective set from `acting_person`, although its comment says
  "ceiling". Its open-work rule computes the new capabilities as
  `role_capabilities(roles) ∩ v_ceiling` (`people.capabilities`). 052 rewrites
  this function for D3 anyway, so the open-work rule is moved to plain
  `role_capabilities(roles)`.
- `vitally_my_clearance` (047 line 1178) returns
  `isAdmin = 'admin' = any(people.capabilities)`. Under D2 it should answer
  `is_workspace_admin`, because `src/clearance.mjs` `ceilingAdmin` gates
  Roster access on it.
- The posted-updates canonical spec says "`people.capabilities` include
  `admin`" ("ceiling admin"), but the code uses `is_workspace_admin`. Under D2
  a site coordinator without the Admin role can post updates. The delta spec
  modifies those requirements (user: agreed).

### Conflict 1: the default follow-up person (conflicted with D9)

Three places require `followup` in `people.capabilities`:
- `set_default_followup` (038:971);
- the re-run check in `initialize_workspace` (047:264), mirrored by the roster
  file check in `roster.mjs:89` and the sign-in requirement "The roster can
  choose the default follow-up person";
- the assignee for follow-ups and withdrawal notices (048:105).

Under the mirror, `followup` comes only from this season's Admin role, which
the roster command never writes. So a fresh workspace (roster command on a new
stack, `seed:local`, the test fixture's `initializeWorkspace`, which sets the
default before `clearStaff`) could not set a default. Later, removing the
Admin role or a new season would leave escalations failing with VALIDATION.

Options put to the user:
- **(A)** The default follow-up person must be a site coordinator.
- **(B)** Keep the `followup` rule. The roster command stops setting the
  default, removing Admin from the default is refused, fixtures reorder, and a
  way to choose the default later is needed.

**User ruling: A.**
- The three checks (038 `set_default_followup`; the 047 `initialize_workspace`
  re-run plus `roster.mjs:89`; the 048 assignee) accept "site coordinator, or
  `followup` this season".
- Removing site coordinator from the default follow-up person is refused.
  Deactivating them is refused too, counted like the last-site-coordinator
  rule.
- The roster file's `defaultFollowup` must name a `siteCoordinator: true`
  entry. Update the sign-in requirement "The roster can choose the default
  follow-up person" to match.
- Keep the earlier ruling that being the default is never refused for
  clearance. A site coordinator who isn't cleared yet can still be the
  default, and since #178 any follow-up holder works any follow-up.
- The hosted deploy window: between 052 and the roster command re-run there is
  no site coordinator yet, so escalations pass only through "`followup` this
  season". Deploy step 1 gives that to every admin. Say so in the design's
  deploy section.
- The roster command re-run makes Hailey Zheng both site coordinator and the
  default follow-up person.

### Conflict 2: volunteers with no sign-in becoming visible (044 policy (c))

`staff_people` shows a person with no sign-in to every staff member when
`cardinality(people.capabilities) > 0`. A pure mirror would give a Roster
volunteer with roles and no sign-in capabilities, and so make them visible to
all staff, including through realtime. `cancel_invitation` (047:599) writes
`capabilities='{}'` when it unlinks a person.

**User ruling (agreed with my proposal):**
- The mirror holds role capabilities only while the person has a sign-in, and
  `{}` otherwise. 044's visibility rule and `cancel_invitation` stay as they
  are.
- The activation path that today writes the fixed
  `{assist, prepare, receive_documents, review}` (047 ~813) recomputes the
  mirror instead.
- Linking a sign-in in `add_staff_member` recomputes it too.
- New database test: a Roster volunteer with roles and no sign-in stays
  invisible to non-admin staff, and becomes visible with their role
  capabilities once they sign in.

## Acceptance (agreed)

Database tests:
- an invited volunteer given the Admin role (with VSC + IT&QR) has admin;
- a non-site-coordinator adding or removing the Admin role is refused;
- the last site coordinator can't be removed or deactivated;
- a site coordinator without SC is not cleared, but still reaches the Roster
  and Season settings;
- the SIDN can't be read through the API;
- only site coordinators write Season settings;
- the migration refuses when someone with a sign-in would lose admin;
- the mirror follows role changes.

Added by the rulings above:
- the default follow-up person can't lose site coordinator or be deactivated;
- the default follow-up checks accept a site coordinator;
- a volunteer with no sign-in stays invisible until they sign in.

The browser story walks Season settings. The story is at about 550–600 s per
leg against a 900 s limit, so the added steps stay short.

Checks:
- `npm test`;
- `npm run db:migrate:test` + `npm run test:database`;
- `npm run test:browser` (or the PR's CI);
- `npx openspec validate --all`;
- a local `db:migrate:test` on a stack that already has main's migrations,
  since 052 changes existing rows.

## Open questions for propose: answered

**Q1. Season settings layout and wording** (staff English), following
`vitally-office-prototype.html` (v20 "Season settings, site coordinators,
start season"), without the site hours or Start next season.

The user picked **"Settings page only"**: site coordinators are granted and
removed only on Season settings, not also through a switch in the Volunteer
drawer. One place keeps the story short. The approved sketch:

```
OFFICE · ADMIN
Season settings

┌ 2027 for TY 2026  [Current] ──────────────┐
│ Certificate and photo ID upload link       │
│ [https://…                             ]   │
│  Volunteers open this from "Finish your    │
│  setup". Use a folder only site            │
│  coordinators can see.                     │
│ Client documents upload link               │
│ [https://…                             ]   │
│  Clients open this to send documents.      │
│                                   [Save]   │
├ Site ID number (SIDN) ─────────────────────┤
│ Set · updated Nov 19, 2026     [Change…]   │
│  Volunteers type it at their first sign-in.│
├ Site coordinators ─ Kept across seasons ·  │
│                     at least one ──────────┤
│ Dana Wu  dana@…  · since Nov 19, 2026 [Remove]
│ [Make someone a site coordinator… ▾] [Add] │
│ ▸ History                                  │
└────────────────────────────────────────────┘
```

Admins who are not site coordinators see the inputs read-only, with no Save,
Change, Add or Remove, and the note "Only site coordinators can change these
settings."

The season label is derived from `workspaces.current_season`:
"<season> for TY <season − 1>", as in the prototype. Shaded fields already
treat the season as the filing year.

**Q2. #193 item 3 (dead copy of `vitally_save_volunteer` in 045).**
The user said **yes, fold it in.** 045 is applied and can't be edited, so 052's
redefinition carries a header comment saying it replaces both 045 copies (Part
3's and Part 6's), and the PR ticks the item on #193. The issue itself says
"clean it up in the next migration that touches this function, or add a
comment there".

## Plan review (2026-11-19): user rulings

- **Season settings storage: per workspace, not per season.** The upload links are one row per workspace and are kept across seasons. The SIDN stays in 047's `vitally_private.site_numbers`, one per workspace. The season label is derived from `workspaces.current_season`, never stored. Reason: the SIDN is the site's number and doesn't change by year, and per-season links would leave Start next season with empty links and broken upload buttons until someone refilled them. (Replaces my per-season call.)
- **Snapshot of the old capabilities** (`vitally_private.capabilities_before_052`): kept. Start next season drops it, and its proposal lists that drop next to its mirror-recompute dependency.
- **The Season settings Chrome test** runs outside the story legs. CI confirmed: each `story` job skips only the other browser order, so the test runs in both jobs, as the Roster test does.
- **No-sign-in persons losing visibility:** accepted. On the hosted database, `select count(*) from public.people where user_id is null and cardinality(capabilities) > 0;` returned 0 on 2026-11-19. That goes in the design's deploy section, with no pre-check step.
- **Accepted as written:**
  - the seven-place default follow-up helper;
  - the roster command ignoring `capabilities` and `siteNumber` with a notice;
  - the guard counting active staff memberships only;
  - deactivation removing the site coordinator flag;
  - the fixture Reviewer gaining `prepare`;
  - the remove-and-re-add spec workaround.
