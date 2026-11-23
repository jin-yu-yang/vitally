## Context

The Roster (044) lists the current season's `roster_entries`. Admins can save a volunteer (`vitally_save_volunteer`, latest in 057), create, resend or cancel an invitation, and deactivate or reactivate an account (047, 052). None of these takes a person off the Roster. Start next season (055) is the only thing that empties it, and it does that for the whole workspace at once.

What the code already gives this change:
- **What a current-season entry holds.** `roster_entries` has the season's roles, `is_new`, `photo_id_checked_at` and the six Form 13615 and photo ID sent/reviewed fields (053, 057). `certificates` is the only table that refers to it (044, `on delete cascade`). Uploads are links to an outside folder, so there are no stored files.
- **The capabilities mirror (052).** The trigger `roster_entries_mirror_capabilities` recomputes `people.capabilities` when a current-season entry is deleted. With no entry it is `{}`.
- **`deactivate_account(workspace, user, changed_by)` (052).**
  - It acts on `invited` or `active` accounts and raises `INVALID_TRANSITION` on any other status.
  - It refuses with `OPEN_WORK`.
  - It refuses the last active site coordinator with `LAST_SITE_COORDINATOR`, and records the removal of any other site coordinator's mark.
- **`open_work` (055).** It lists the person's open work.
- **The returning-volunteer picker (#267).** It offers anyone with a profile and no current-season entry. Saving the person recreates their entry.
- **Reactivate (047).** It brings a deactivated account back.
- **The Roster is not live.**
  - The roster tables aren't in realtime.
  - `handleChange` ignores `people` changes for the Roster.
  - A wake re-reads only the uploads count.

Stakeholders: Hailey (owner), Zeye (reviewer, approves before hosted deploy), Jinyu. The issues are #232 and #269, both part of #138.

## Goals / Non-Goals

**Goals:**
- A workspace admin can remove a person from the current season's Roster in one confirmed step. Their account is deactivated in the same step, unless they are a site coordinator.
- Case history, the person and their profile are kept, so the person can be added back through the existing picker.
- The rules that already protect roles, site coordinators and open work hold for removal too.
- After re-adding someone whose account is deactivated, the drawer points the admin to Reactivate (#269).

**Non-Goals:**
- Deleting a person or their profile, or removing anyone from a past season's roster.
- Listing people removed this season in the picker (see D9).
- Any UI for the removal record.
- Reactivating automatically on re-add.
- Making the Roster live (realtime or re-read on wake).
- Shifts (#140, not built; see the forward note).

## Decisions

### D1: Delete the current-season entry, and deactivate in the same transaction
- **Choice:** `vitally_remove_from_roster` deletes the person's current-season `roster_entries` row, so its certificates cascade and the sent/reviewed fields go with it. It keeps `people` and `volunteer_profiles`, including usual days. When the account is `invited` or `active` and isn't a site coordinator's, it calls `vitally_private.deactivate_account(workspace, user, caller)` in the same transaction.
- **Why:** this is one action for the admin, it matches what Start next season does to people who aren't on the new roster, and it reuses the deactivation rules unchanged.
- **Alternatives considered:**
  - Allow removal only once the account is cancelled or deactivated (#232's first proposal). That makes it two steps, and an active account would block removal. Replaced on Nov 21.
  - A "removed" flag on the entry. Every reader of `roster_entries` would have to filter on it: the mirror, clearance, the Roster, the picker, the CSV and Start next season. The entry's unique key would also block re-adding the person.

### D2: Deactivate invited accounts too, rather than cancelling the invitation
- **Choice:** `deactivate_account` handles both `invited` and `active`. `cancel_invitation` is never called.
- **Why:** it's one path, the same one Start next season uses. Adding the person back means Reactivate, which gives `invited` with a new seven days and Resend for someone who never signed in.
- **Alternative considered:** `cancel_invitation`. It deletes the account and membership and frees the email, so adding back would mean Create account. It can also refuse with `IN_USE`. An admin who wants the email freed can still press Cancel invitation before removing.

### D3: Who may remove
- **Choice:**
  - The caller must be a workspace admin (`is_workspace_admin`). Anyone else gets `FORBIDDEN`.
  - If the person holds the Admin role this season and the caller isn't a site coordinator: `ADMIN_ROLE` (VT001), checked before the receipt, as Save does.
  - If the person is a site coordinator and the caller isn't one: `FORBIDDEN`.
  - The caller's own row: `VALIDATION` (`SELF`).
- **Why:** removal takes the Admin role away, and 052 rule 3 lets only site coordinators change that role. The site coordinator rule copies Deactivate's. Removing yourself would be refused by `deactivate_account` for an admin who isn't a site coordinator anyway, and for a site coordinator it would only drop them to the setup screen. One rule is simpler.
- **Alternative considered:** letting any admin remove a site coordinator who doesn't hold the Admin role, since Save already lets them untick that person's other roles. Rejected so that Remove and Deactivate follow the same rule.

### D4: The RPC's order of checks and its lock order
- **Choice:** `vitally_remove_from_roster(p_action_id uuid, p_volunteer_id uuid, p_expected_revision bigint)`, `security definer`, granted to `authenticated`. In this order:
  1. `require_membership`, `acting_person`, then `FORBIDDEN` unless the caller is staff with a person and is a workspace admin.
  2. `VALIDATION` for a null argument, then `VALIDATION` (`SELF`) for the caller's own row.
  3. The workspace advisory lock (`hashtextextended(workspace_id::text, 0)`).
  4. `ADMIN_ROLE` (from D3).
  5. `reserve_receipt` with operation `REMOVE_FROM_ROSTER` and a digest of the arguments and the caller. A replay returns the stored receipt.
  6. `expire_invitations`.
  7. Lock the profile `FOR UPDATE`. `NOT_FOUND` if there is none in the caller's workspace. `CONFLICT` if the revision differs.
  8. Lock the current-season entry `FOR UPDATE`. `NOT_FOUND` if there is none.
  9. The site coordinator rule from D3 (`FORBIDDEN`).
  10. `OPEN_WORK` from the full `open_work` list, with the labels as detail. The SC exception that Save makes for the default follow-up person doesn't apply here.
  11. Delete the entry.
  12. Lock the account `FOR UPDATE`. If it is `invited` or `active` and not a site coordinator's, call `deactivate_account`.
  13. Raise the profile revision.
  14. Insert into `roster_removals`.
  15. Store the receipt: `{actionId, volunteerId, revision, accountDeactivated}`.
- **Why:**
  - The order of locks is the same as Save's: the workspace lock, then the profile, then the entry, then the account. Save, Deactivate and Remove all take the workspace lock first, so none of them can deadlock with another.
  - The receipt is reserved before the `CONFLICT` check, so a retry after a lost reply is answered, not refused.
  - `OPEN_WORK` is checked before anything is written. `deactivate_account` checks it again, which costs nothing.
- **Alternative considered:** the account revision as the expected revision, as Deactivate uses. Rejected, because the Edit drawer that Save uses holds the profile revision (D5).

### D5: The expected revision is the profile's, and removal raises it
- **Choice:** the drawer sends the profile revision it holds, and a successful removal raises it.
- **Why:** `vitally_save_volunteer` inserts or updates the current-season entry. If removal didn't raise the revision, a second admin's open drawer could save afterwards and quietly put the person back on the roster. With the raise, that save gets `CONFLICT`.

### D6: Skip deactivation when there is nothing to deactivate
- **Choice:** with no account, or an account already `deactivated`, only the entry is deleted.
- **Why:** `deactivate_account` raises `INVALID_TRANSITION` on a deactivated account. A Remove racing a Deactivate in another window must either succeed or get `CONFLICT`. Deactivate doesn't change the profile revision. So if Deactivate runs first, Remove succeeds and skips the deactivation. If Remove runs first, it raises the account revision through `deactivate_account`, so Deactivate's existing revision check answers `CONFLICT`.
- `LAST_SITE_COORDINATOR` can't be reached from this RPC, because a site coordinator's account is never passed to `deactivate_account`.

### D7: Record every removal
- **Choice:** a new table `public.roster_removals`:
  - `id`, `workspace_id` (references workspaces, on delete cascade), `season`, `person_id`, `removed_by_person_id`, `removed_at` (default now()) and `account_deactivated` (boolean).
  - Row security on, no policy, and `revoke all` from public, anon, authenticated and service_role.
  - Person ids are historical scalars, as in `season_starts`.
- **Why:** removal destroys the season's certificates and sent/reviewed dates, and receipts have no timestamp.
- **Alternative considered:** relying on receipts. Rejected, because they don't record when.

### D8: The drawer and the confirmation
- **Choice:**
  - **The button.** "Remove from this season's roster…" in the Edit drawer, for a volunteer already saved.
  - **Who sees it.** A caller who isn't a site coordinator, opening a site coordinator's drawer, sees "Only site coordinators remove a site coordinator from the roster." instead. One opening someone with the Admin role sees the existing Admin role sentence.
  - **Your own row.** A caller opening their own drawer sees "You can't remove yourself from the roster." instead, before any role sentence; the server refuses it anyway (`VALIDATION`, `SELF`), and the dialog shows the same sentence if it ever comes back.
  - **The dialog.**

    > **Remove <name> from this season's roster?**
    > <name> (<email>) comes off this season's roster, with their roles, certificates and the record of what they sent this season.
    > *[invited or active, not a site coordinator]* Their account is deactivated, so they can no longer sign in.
    > *[site coordinator]* Their account stays active because they are a site coordinator, but they will have no roles this season.
    > *[already deactivated]* Their account is already deactivated.
    > *[no account]* (no account line)
    > Their cases and contact details are kept. To add them back, search for <email> in Add a volunteer.
    >
    > [Remove from roster] [Cancel]

  - **A refusal** keeps the dialog open with its sentence:
    - `OPEN_WORK`: the existing "<name> still has open work: …. Finish it or hand it over first."
    - `ADMIN_ROLE`: the existing sentence.
    - `FORBIDDEN` for a site coordinator: the sentence above.
    - `CONFLICT` and anything unreadable: the banner, as other account actions do.
  - **On success** the dialog and drawer close and the list is re-read.
  - **An unknown outcome** keeps its action id, so pressing again sends the same id.
- **Why:** the email in the dialog lets the admin see it before removing. A person removed in their first season comes back only by typing it (D9).

### D9: Known limit: first-season removals come back only by email
- **Choice:** the picker isn't changed. A person who wasn't on last season's roster is offered only when their full email is typed. That includes anyone removed in their first season.
- **Why:** listing people removed this season would be cheap: a select policy on `roster_removals`, one read, one label and about three tests. But it reverses D7's "no grants" and opens a new read of who removed whom, which is a compliance boundary. The people it would add are mostly test volunteers and people added by mistake, who shouldn't be offered anyway.
- **Mitigation:** the email is shown in the confirmation (D8).

### D10: Pointing to Reactivate after a re-add (#269)
- **Choice:**
  - **Right after the save.** When a save of a picked earlier volunteer succeeds and the re-read list shows their account `deactivated`, the drawer stays open on that person's Edit view. The Account section shows the info notice "<name> is back on this season's roster. Their account is deactivated. Reactivate it so they can sign in."
  - **Later.** When the drawer is opened for someone on this season's roster with a deactivated account, and there is no notice, a field note under Reactivate says "Reactivate so they can sign in."
  - Only one of the two shows at a time. Every other save closes the drawer as now, and nothing is reactivated automatically.
- **Why:** the drawer already has the Account notice (`volunteerAccountNotice`) and the Reactivate button. Keeping it open puts the hint next to the button. The Roster page has no notice area.

### D11: How another admin's open Roster learns of a removal
- **Choice:** no new mechanism. Another admin's Roster learns when the Roster is opened again or the page is reloaded. It also learns when that admin acts on the person: a Save gets `CONFLICT`, a Remove gets `NOT_FOUND` or `CONFLICT`, and either refusal re-reads the list.
- **Why:** this is how every Roster change already reaches other windows.

### Forward note: Schedule (#140)
When shifts exist, removing someone from this season's roster must also remove or refuse their future shifts. Nothing to build now.

## Risks / Trade-offs

- [Risk] A removal destroys that season's certificates and sent/reviewed dates. → Mitigation: a confirmation that says so, a `roster_removals` row for every removal, and the person and their profile are kept.
- [Risk] A second admin's stale drawer could re-add the person. → Mitigation: D5. Their save gets `CONFLICT`, and a test pins it.
- [Risk] A Remove races a Deactivate. → Mitigation: D6, and a test pins that Remove never answers `INVALID_TRANSITION`.
- [Risk] Locks could deadlock with Save, the account RPCs or Start next season. → Mitigation: the workspace lock comes first and the lock order is Save's (D4).
- [Trade-off] `open_work` counts every current-season case not in stage closed, Accepted included, as it does for Deactivate. Mid-season, a volunteer who has touched a case can be removed only once those cases are Closed or handed over. Kept as is, the same rule as Deactivate.
- [Trade-off] Other admins' open Rosters go stale until a reopen or reload (D11). Accepted, because that is the existing Roster behaviour.
- [Trade-off] First-season removals can't be found from the picker's list (D9). Accepted, with the email shown in the dialog.
- [Trade-off] A removed site coordinator keeps their admin screens with no roles. That's the same state Start next season leaves the starter in.

## Migration Plan

- **The migration.** `058_remove_from_roster.sql` adds the table and the function, and changes no existing function or row. It's hand-written and final once applied.
- **While iterating.** Database tests run through `gh workflow run database-quick.yml --ref <branch> -f files="tests/database-remove-from-roster.mjs"`. No local Docker or stack on this machine.
- **The final check.** The PR's full CI: `checks`, `database`, `sign-in` and both `story` legs.
- **Deploy.** Once the migration is final and Zeye has approved, apply 058 to the hosted database from the worktree, then merge. If the migration changes after approval, ask Zeye to look again first.
- **Rollback.** A follow-up migration drops `vitally_remove_from_roster` and `roster_removals`. Removals already made stay made, since the entries are deleted. The people can be re-added through the picker and reactivated.

## Open Questions

None. The known limit (D9) and the Schedule forward note are recorded above. Neither affects this build.
