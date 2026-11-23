# Brainstorm: remove a volunteer from this season's Roster (#232, with #269)

Raw capture of the design agreed in conversation on 2026-11-22. Decisions marked
"Hailey" were settled by Hailey (in #232's body, on Nov 21, or in this
conversation); the rest were proposed in the brainstorm and approved by her.

## Background

There is no way to take a volunteer off the Roster. Removal was left out of the
first roster slice (`add-volunteer-roster-records`). Today an admin can only:
- **Cancel invitation** (047) for an invited account never activated: the
  account and membership go, the Roster shows "Not created", and the email can
  be edited. The person stays on the Roster.
- **Deactivate** (047, 052) for an invited or active account: the membership
  goes inactive and the Roster shows "Deactivated". The person stays on the
  Roster.

So test volunteers, people added by mistake and volunteers who leave mid-season
stay on this season's Roster for good. Found while testing invitations on the
hosted test environment (Nov 19). Part of #138. Wanted before Dec 21; the first
Dec 21 item to cut (it can move to Before the pilot), since Deactivate already
removes all access.

#269 (from Zeye's review of #267) is folded in: after an admin re-adds someone
whose account is deactivated, the drawer gives no hint that Reactivate is
needed.

## What the code does today (checked)

- `roster_entries` holds the season's roles, `is_new`, `photo_id_checked_at`
  and all six sent/reviewed fields for Form 13615 and photo ID (053, 057).
  `certificates` is the only table that refers to it (044:68, `on delete
  cascade`). Uploads are links to an outside folder; ViTally stores no files.
- 052's trigger `roster_entries_mirror_capabilities` fires on a delete from the
  current season and touches the person's `people` row, so
  `people.capabilities` is recomputed. With no current-season entry,
  `effective_capabilities` is `{}`.
- `vitally_private.deactivate_account(workspace, user, changed_by)` (052)
  accepts `invited` or `active`, refuses `OPEN_WORK` from `open_work`, refuses
  `LAST_SITE_COORDINATOR` for the last active site coordinator, and removes the
  site coordinator mark of any other. It raises `INVALID_TRANSITION` for an
  account already `deactivated`.
- `vitally_private.open_work` (055) lists open current-season cases as preparer
  or reviewer, open follow-ups, being the default follow-up person, and a
  claimed help request.
- `vitally_save_volunteer` (057) checks the profile revision and upserts the
  current-season roster entry. A save from a stale drawer for a removed person
  would therefore put them back on the roster unless the remove raises the
  profile revision.
- The returning-volunteer picker is on main (#267, ffb2e16).
  `listEarlierVolunteers` offers anyone with a profile and no current-season
  entry: last season's people in the list, anyone else when their full email
  is typed ("Earlier volunteer"). Typing such an email without picking says
  "That email belongs to an earlier volunteer. Pick them above."
- Reactivate (047, 052) gives `active` if the person signed in before, else
  `invited` with a new seven days and Resend.
- `action_receipts` record operation, actor and target but no time.
- Realtime does not carry the roster tables. `people` is in staff realtime, but
  `handleChange` doesn't re-read the Roster for it, and a wake re-reads only the
  uploads count. The drawer closes after every successful save.

## Decision chain

**Q0 (Hailey, #232 + Nov 21). What does Remove do?** It deletes the person's
current-season `roster_entries` row. Certificates go with it via the cascade.
`people` and `volunteer_profiles` (including usual days) are kept, so case
history stays intact and the person can be added back. It also deactivates the
account in the same step through `deactivate_account`, except a site
coordinator's, as Start next season does. It's refused while the person holds
open work (`OPEN_WORK`, VT004, the existing "<name> still has open work: …"
sentence), and it needs a confirmation. Current season only; past seasons'
rosters are unchanged.

**Q1. Who may remove?**
- Any workspace admin (`is_workspace_admin`); anyone else gets `FORBIDDEN`.
- A person holding the Admin role this season: site coordinators only, refused
  `ADMIN_ROLE` (VT001) as Save does (052 rule 3), since removal takes the role
  away.
- A site coordinator: site coordinators only, refused `FORBIDDEN`, mirroring
  Deactivate. The drawer says "Only site coordinators remove a site coordinator
  from the roster." (Hailey: agreed, (a).)
- Nobody removes themselves: `VALIDATION` (`SELF`).

**Q2. Invited accounts: deactivate or cancel the invitation?** (Hailey: agreed,
(b).) `deactivate_account`, for invited and active alike. Cancel would delete
the account and membership and free the email (so adding back means Create
account and a new invitation); deactivate keeps them (so adding back means
Reactivate, then Resend). One path, matching Start next season and the Nov 21
decision. An admin who wants the email freed can press Cancel invitation first.

**Q3. No account (not created).** Only the roster entry is deleted.

**Q4. Capabilities and sent fields.** The 052 trigger recomputes the mirror to
`{}`. The 13615 and photo ID fields are roster-entry columns and go with the row;
certificates cascade; nothing else refers to the entry.

**Q5. Adding back.** Through the existing picker (#267): last season's people in
the list, anyone else by typing their full email. The account is still
deactivated, so the admin presses Reactivate.

**Q6. The RPC:** `vitally_remove_from_roster(p_action_id, p_volunteer_id,
p_expected_revision)`, in this order:
1. `FORBIDDEN` checks (staff, acting person, workspace admin).
2. `VALIDATION` for missing arguments.
3. The workspace advisory lock.
4. `ADMIN_ROLE` for a non-site-coordinator caller when the person holds the
   Admin role this season, before the receipt, as in Save.
5. Reserve the receipt; a replay returns it before anything else.
6. Expire old invitations (as every account RPC does).
7. Lock the profile `FOR UPDATE`; `NOT_FOUND` if none. `CONFLICT` if its
   revision differs.
8. Lock the current-season roster entry; `NOT_FOUND` if none.
9. `SELF`; `FORBIDDEN` if the person is a site coordinator and the caller isn't.
10. `OPEN_WORK` from the full `open_work` list.
11. Delete the entry.
12. Call `deactivate_account(…, caller)` only if the account is `invited` or
    `active` and not a site coordinator's. Skip it when the account is already
    `deactivated` or there is none, so a remove racing a Deactivate never gets
    `INVALID_TRANSITION`.
13. Raise the profile revision, record the removal, store the receipt.

Lock order as Save: workspace lock, profile, roster entry, account.
`LAST_SITE_COORDINATOR` is unreachable from this RPC, since a site
coordinator's account is never deactivated by it. Expected revision is the
profile's, the one the Edit drawer already holds; raising it makes a stale Save
from another drawer get `CONFLICT` instead of re-adding the person. (Hailey:
approved.)

**Q7. UI.** "Remove from this season's roster…" in the Edit drawer. A refusal
keeps the dialog open with the reason. A removed person's window shows "This
account has no access" on its next wake; a removed site coordinator keeps admin
screens through the flag, has no roles, and sees the setup screen. Staff text is
English only.

The confirmation (Hailey's wording changes applied):

> **Remove Nadia Kerr from this season's roster?**
> Nadia Kerr (nadia.kerr@example.org) comes off this season's roster, with their
> roles, certificates and the record of what they sent this season.
> *[invited or active]* Their account is deactivated, so they can no longer sign in.
> *[site coordinator]* Their account stays active because they are a site
> coordinator, but they will have no roles this season.
> *[already deactivated]* Their account is already deactivated.
> *[no account]* (no account line)
> Their cases and contact details are kept. To add them back, search for
> nadia.kerr@example.org in Add a volunteer.
>
> [Remove from roster] [Cancel]

The email is in the dialog so the admin can see it before removing, because a
person removed in their first season comes back only by typing it.

**Q8. Audit.** (Hailey: agreed, (c).) A `roster_removals` table: workspace,
season, person, removed by, removed at, whether the account was deactivated.
Row security on, no grants, no UI, like `season_starts`. Person ids are
historical scalars.

**Q9. #269: point to Reactivate.** (Hailey: approved, with "one or the other".)
- After a successful save of a picked earlier volunteer whose account is
  deactivated, the drawer stays open on that person's Edit view (every other
  save still closes it), with an info notice in the Account section:
  **"Nadia Kerr is back on this season's roster. Their account is deactivated.
  Reactivate it so they can sign in."**
- Whenever the drawer is opened later for someone on this season's roster with
  a deactivated account, a short note sits under Reactivate: *"Reactivate so
  they can sign in."*
- Only one at a time: the notice right after the save, the note otherwise.
  Nothing is reactivated automatically (#267's decision).

**Q10. Listing removed people in the picker?** Cheap (a select policy on
`roster_removals` for admins, one read, one label, about three tests) but it
reverses (c) and opens a new read of who removed whom, a compliance boundary.
The people it would add are mostly first-season removals: test volunteers and
mistakes. Left out; recorded as a known limit. (Hailey: agreed.)

**Q11. Forward note for #140 (Schedule, not built).** When shifts exist,
removing someone must also remove or refuse their future shifts. Note only.
(Hailey.) *Nov 22: the Schedule merged as 058 first, so Hailey asked for it
now: removal marks the person's shifts from today on removed and keeps
earlier ones. See design D12.*

**Q12. How another admin's open Roster learns.** Not on a wake and not by
realtime (existing behaviour for every Roster change). It learns when the
Roster is opened again or the page is reloaded, or when that admin acts on the
person: a Save gets `CONFLICT`, a Remove gets `NOT_FOUND`, and either refusal
re-reads the list. Recorded, nothing added.

## Approaches considered

1. **Delete the current-season entry and deactivate in one step (chosen).**
   Matches Start next season; one action; keeps people and profiles; the picker
   already brings people back.
2. **Allow removal only once the account is cancelled or deactivated** (#232's
   first proposal). Two steps for the admin, and an active account blocks
   removal. Replaced on Nov 21.
3. **A "removed" flag on the roster entry instead of deleting it.** Keeps the
   certificates and sent fields, but every reader of `roster_entries` (the
   mirror, clearance, the Roster, the picker, the CSV, Start next season) would
   need to filter it, and the entry's unique key would block re-adding. Rejected
   as too wide for a tidy-up.

## Acceptance (agreed)

- Migration 059 and `vitally_remove_from_roster` with `FORBIDDEN`,
  `ADMIN_ROLE`, `VALIDATION` (`SELF`), `NOT_FOUND`, `CONFLICT`, `OPEN_WORK`;
  receipt replay before `CONFLICT`; profile revision raised; removal recorded;
  capabilities `{}`; certificates and sent fields gone; past seasons unchanged.
- A stale Save from a second admin's open drawer after the remove gets
  `CONFLICT` and doesn't put the person back.
- Remove racing a Deactivate: the second either succeeds (deactivation skipped)
  or gets `CONFLICT`, never `INVALID_TRANSITION`.
- The removed person's window shows "This account has no access" on its next
  wake; a removed site coordinator's shows the setup screen.
- `LAST_SITE_COORDINATOR` stays unreachable from this RPC; a test pins that
  removing a site coordinator never calls `deactivate_account`.
- The drawer action and dialog; the #269 notice and note, one at a time.
- Delta specs: volunteer-roster, sign-in-accounts, site-coordinators,
  volunteer-clearance.
- Checks: `npm test`; database tests through `database-quick.yml` while
  iterating; the browser test in its own `test(...)` block with its own
  workspace (not the story, at 731/741 s of 900 s); the PR's full CI as the
  final check. `build:hant` isn't needed (staff text is English);
  `test:auth-browser` isn't needed (sign-in itself doesn't change).
- No local Docker or stack on this machine.

## Deploy and PR

- Once the migration is final and Zeye has approved, apply 059 to hosted from
  the worktree, then merge. If the migration changes after approval, ask Zeye
  to look again first.
- PR body: "Closes #232", "Closes #269", "Part of #138"; "Refs #N" for others.
