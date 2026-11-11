## Context

**What #187 left behind**
- Change `add-volunteer-roster-records` (#187, migration 044) added the admin-only Roster.
- It stores data in three tables: `volunteer_profiles`, `roster_entries` (one row per person per season, `roles text[]`) and `certificates` (one row per person, season and certificate, `status ∈ uploaded/confirmed`).
- It added one write RPC, `vitally_save_volunteer`, and recorded roles and certificates without any effect.
- What a staff member can do still comes only from `people.capabilities`, which the roster command sets.

**What PCDC requires (from the user)**
- Nobody works a season without a signed Form 13615 listing their certifications.
- New volunteers also need a photo ID check.
- Site coordinators check the files in the two weeks before opening.

**How the code enforces access now**
- **Reads:** 22 SELECT policies give a staff member access through an inline `exists(select 1 from public.memberships m … m.access='staff')`. 21 cover case data; the 22nd is `people.staff_people`. Several are combined client/staff `visible_*` policies. 19 of these tables are in the realtime publication, where RLS runs per change event per subscriber.
- **Writes:** six `security definer` case RPCs: `vitally_apply_action`, `vitally_assistance_action`, `vitally_close_unsigned`, `vitally_create_case`, `vitally_log_contact` and `vitally_edit_contact`.
  - Each resolves the caller with `vitally_private.acting_person(member)`.
  - Then `check_operation_authority` and `check_authority` do the capability checks. **They reload the person from `public.people`.**
  - `vitally_create_case` also reads `people.capabilities` directly.
- **Self-review:** `require_review_eligibility` (rule from 006) refuses a preparation participant with VT005.
- **Error codes:** VT001 to VT008 are taken. VT008 is 043's migration guard.

**Who this affects**
- PCDC admins and volunteers.
- The Nov 11 review and M5 (Nov 16) run on `main` without this change.

The agreed design and the user's rulings are in `brainstorm.md`.

## Goals / Non-Goals

**Goals:**
- An active staff member reads case data and calls the six case RPCs only when cleared for the workspace's current season.
- Cleared means at least one role on the current-season roster entry, plus a photo ID check if the entry is new.
- A role can exist only once its certificates are confirmed. This holds for every writer.
- The acting caller's capabilities become their roles' capabilities ∩ `people.capabilities`.
- An uncleared admin can still use the Roster, which is the bootstrap. An uncleared person can see what is missing.
- A save that takes away what a person's open work needs is refused.
- Fixtures and `seed:local` clear the role accounts, so `main`, the story and the demo script keep working.

**Non-Goals:**
- Uploads inside ViTally and "I've uploaded it".
- The accounts table and Create account.
- Season settings and Start next season.
- The site coordinator role and the SC check.
- The returning-volunteer picker.
- Reassigning work (#139).
- The #104 switch.
- Effective capabilities of *other* people in the browser.
- Retiring `people.capabilities`.

## Decisions

### D1: A role needs its certificates, enforced by a deferred constraint trigger
- **Choice:**
  - A `vitally_private.role_certificates_check()` trigger function runs as `constraint trigger … deferrable initially deferred for each row` on `roster_entries` (insert, update) and `certificates` (insert, update, delete).
  - At commit, for the affected `(workspace, person, season)`, it checks every role's needs against the confirmed certificates of that season.
    - Greeter needs VSC. Intaker and Admin need VSC and IT&QR. Preparer and Reviewer need VSC, IT&QR and Basic or Advanced.
  - It raises VT007 `VALIDATION`, naming the role and the missing certificates.
  - The needs table lives in one SQL function, `vitally_private.role_needs(role)`, so the trigger, `vitally_save_volunteer` and `vitally_my_clearance` share it.
- **Why:** the user ruled that a role never exists before its certificates, whoever writes. Deferring the check lets one transaction write certificates and roles in either order (save, seed, fixtures).
- **Alternatives:**
  - A check only inside `vitally_save_volunteer`: direct SQL, the seed and fixtures could bypass it.
  - A non-deferred trigger: it would depend on the order of writes within a transaction.

### D2: Cleared and effective capabilities in one place
- **Choice:**
  - `vitally_private.effective_capabilities(person_id, workspace_id) returns text[]` gives the union of the current-season roles' capabilities, intersected with `people.capabilities`.
  - `vitally_private.cleared(person_id, season)`, or a workspace-scoped equivalent, is true when the season's entry has a role and either `not is_new` or `photo_id_checked_at is not null`.
  - Role capabilities: Greeter none; Intaker `receive_documents, assist`; Preparer `prepare`; Reviewer `prepare, review`; Admin `admin, followup, assist, receive_documents`.
- **Why:** one definition, used by the policies, the RPCs and the setup screen.
- **Alternative:** a stored `cleared` column. It would drift as certificates and seasons change.

### D3: The policy helper is a no-argument InitPlan
- **Choice:**
  - `vitally_policy.cleared_workspace_id() returns uuid`: the workspace of the caller's active `staff` membership when the caller's person is cleared, else null. It is `security definer stable`, `search_path=''`, takes no user id, and execute is granted to `authenticated` only.
  - Each of the 21 policies keeps its current expression. Its staff branch gains `and <table>.workspace_id = (select vitally_policy.cleared_workspace_id())`.
  - The combined `visible_*` policies change only their staff branch, so the client branch is untouched. `people.staff_people` is not changed.
  - The migration re-states each policy with `alter policy`, as 043 did, from the 043 and 044 definitions.
- **Why:** an uncorrelated scalar subquery is planned as an InitPlan and runs once per statement, including per realtime change check. One account has one active membership, so no argument is needed.
- **Alternatives:**
  - `caller_cleared(t.workspace_id)`: correlated, so it runs once per row.
  - Caching in a session GUC: fragile, and wrong after a mid-session change.

### D4: The RPCs use effective capabilities and refuse uncleared staff first
- **Choice:**
  - `acting_person` keeps its signature and its no-refusal behaviour. For a staff caller it returns the `people` row with `capabilities` replaced by `effective_capabilities(...)`.
  - `check_operation_authority` and `vitally_create_case` stop re-reading `people.capabilities` for the caller and use the effective value. The per-case checks and `require_review_eligibility` then need no change.
  - A new `vitally_private.require_cleared(p_member)` raises VT009 `NOT_CLEARED` for an uncleared `staff` member and does nothing for an applicant. Each of the six case RPCs calls it right after `acting_person`, before any case, receipt or replay lookup.
  - `vitally_save_volunteer` does not call it.
  - Checks of *another* person's capability, such as "the follow-up assignee has `followup`" (033/036) and the default follow-up person, keep reading `people.capabilities`.
- **Why:**
  - Refusing first leaks nothing about which ids exist, and replays are refused too.
  - Keeping `acting_person` from refusing lets the Roster RPC serve an uncleared admin.
  - Leaving assignee checks on the ceiling avoids blocking a client's own action (ruling on the default follow-up person).
- **Alternatives:**
  - Refusing inside `acting_person`: it would lock an uncleared admin out of the Roster.
  - Refusing after the case lookup: it would leak which ids exist.

### D5: VT009 `NOT_CLEARED`
- **Choice:**
  - Add VT009 to the error mapping in `src/contracts.mjs`.
  - When any call returns `NOT_CLEARED`, the controller switches the window to the setup screen and doesn't show an inline error.
- **Why:** VT008 is taken. This is a state change, not a failed action.

### D6: The migration strips #187's unsupported roles, or refuses
- **Choice:** migration 045, in order:
  1. Find every current-season roster entry whose roles its confirmed certificates don't support.
  2. If any belongs to a person with a linked account (`people.user_id` not null), raise VT008-style (`errcode 'VT008'`, the message "045 refused", counts in detail).
  3. Otherwise remove the unsupported roles from the people with no sign-in.
  4. Add the columns, functions, trigger, policies and RPC changes.
- No report table. The migrator prints no notices.
- **Why:** the user ruled the cleanup is one-time and fictional-data-only, and only local and CI stacks matter. The four role accounts have empty roles, so a seeded stack migrates.
- **Alternatives:** a report table; teaching the migrator to print notices. The user rejected both.

### D7: The open-work rule lives in `vitally_save_volunteer`
- **Choice:** before writing, the RPC compares the person's old and new effective capabilities and clearance. It refuses with VT004 `INVALID_TRANSITION`, with the open work listed, if the save:
  - removes `prepare` while they are preparer of a case that isn't closed;
  - removes `review` while they are reviewer of a case that isn't closed;
  - removes `followup` while they have an open follow-up assigned or are the default follow-up person;
  - removes `assist` while they hold a claimed help request;
  - or leaves them uncleared while they hold any of these.
- The drawer shows "<name> still has open work: <list>. Finish it or hand it over first."
- **Why:** narrow, as the user chose. A Preparer can still drop Greeter or untick Advanced while Basic still covers Preparer.
- **Alternative:** refusing any removal while open work exists. The user rejected it.
- **Left to the builder:** whether the code is VT004 or VT003, and the exact detail payload. The plan picks one and the spec names it.

### D8: Photo ID columns and defaults
- **Choice:**
  - `roster_entries.is_new boolean not null default false` and `photo_id_checked_at timestamptz null`.
  - The backfill and `add_staff_member` leave `false`. Add a volunteer sends `true` by default.
  - The save accepts `isNew` and `photoIdChecked`. A tick keeps its original timestamp while it stays ticked, like a certificate.
- **Why:** existing and bootstrap accounts aren't new; a volunteer added in the drawer usually is.

### D9: The save may have no roles
- **Choice:** remove "at least one role" from the save's validation.
- **Why:** a volunteer waiting for their 13615 can't have one (D1), and the seed keeps one such volunteer.

### D10: `vitally_my_clearance()` and the setup screen
- **Choice:**
  - A public `security definer` RPC with no arguments. For the caller's staff membership it returns:
    - `cleared`;
    - `missing`: a list of `form13615` (no roles), `photoId` (new and unchecked) and `role:<name>` items naming certificates, if any;
    - `capabilities` (effective);
    - `isAdmin` (ceiling);
    - `siteCoordinatorName`: the default follow-up person's display name, no contact details.
  - It is execute-granted to `authenticated` only. For an applicant it raises FORBIDDEN.
  - The app calls it after sign-in for a staff account. Then:
    - **Uncleared:** the staff shell shows only "Finish your setup for this season" with the missing items, "Ask <name>, your site coordinator", and Check again. An uncleared admin also gets the Volunteers link.
    - **Re-checks:** Check again and `window` focus re-call it. A cleared result loads the normal shell.
    - **Cleared:** the signed-in person's own buttons and links use the returned effective capabilities instead of their `people.capabilities`.
  - Other people's capabilities in pickers and filters keep reading `people`.
- **Why:** the roster tables aren't in realtime, so the screen re-checks. Returning no profile data keeps `volunteer_profiles` admin-only.

### D11: Fixtures clear the role accounts by default
- **Choice:**
  - `tests/support/database-fixture.mjs` gets a `clearStaff(workspaceId, personId, capabilities)` helper. In one SQL transaction it writes:
    - the smallest role set covering the capabilities: `prepare+review` → Reviewer; `prepare` → Preparer; `review` alone → Reviewer, since the ceiling keeps them review-only; `admin`/`followup` → Admin; `assist`/`receive_documents` without admin → Intaker;
    - confirmed certificates for those roles.
  - `f.staff(...)` and the initializer's role accounts call it unless `cleared: false`.
- **Why:** it is one place, fast, and serves the database, auth and browser suites.
- **Alternative:** going through `vitally_save_volunteer`. It needs a cleared-admin bootstrap per suite, and is slower.

### D12: Seed
- **Choice:**
  - `seed:local` first saves the four role accounts' entries (roles, confirmed certificates, `is_new=false`) through `vitally_save_volunteer` as the Site Coordinator account, then the fictional volunteers.
  - `SEED_VOLUNTEERS` is corrected so every role is backed:
    - Hana Moretti gets IT&QR and Basic;
    - Lucy Fong becomes the volunteer with no roles and no certificates ("waiting for Form 13615").
  - At least one volunteer is new with photo ID checked, and one is new without it.
  - The run file and the "deletes by email" re-run stay as they are.
- **Why:** M5-safety and the demo script.

### D13: Staff assign work only to a cleared person
- **Choice:**
  - Add `vitally_private.require_cleared_assignee(p_workspace_id uuid, p_person_id uuid) returns void`. It raises `sqlstate 'VT006' using message='INELIGIBLE'` when the person isn't cleared. Today it has no caller, so it is tested directly. #139's Reassign calls it, and its picker lists only people that `vitally_private.cleared` accepts. That picker needs a staff-readable source, which #139 provides.
  - A catalog test pins the functions that write `cases.preparer_id`, `cases.reviewer_id`, `admin_followups.assignee_person_id`, `assistance_items.assignee_person_id` or `workspaces.default_followup_person_id`, or that insert into `admin_followups`, `assistance_items`, `reviews` or `preparation_participants`. Today these are:
    - self-claims: `act_claim_preparation`, `act_claim_review`, `act_assistance_claim`;
    - the default follow-up person: `act_escalate_contact`, `act_approve_review`, `act_close_case`, `act_withdraw`;
    - the roster command: `set_default_followup`;
    - clearing the reviewer: `hand_to_review`, `act_request_corrections`.
  - Assignments to the default follow-up person stay unrefused, and their `followup` check stays on the ceiling.
- **Why:** user ruling, Nov 11. No staff action assigns work to someone else today, so the rule is set up now for #139 to inherit.
- **Alternative:** writing the rule in #139 only. A new path could then skip it.

## Risks / Trade-offs

- [Risk] Editing 21 policies by hand could miss one, or change a client branch. → Mitigation:
  - a catalog test that every policy with a staff branch, except `people`, calls `cleared_workspace_id`;
  - database tests that clients' reads are unchanged.
- [Risk] Realtime cost if the helper runs per row. → Mitigation: a database test asserts an InitPlan, or one call per statement.
- [Risk] An RPC left on `people.capabilities` for the caller gives the ceiling. → Mitigation: database tests where the ceiling exceeds the roles (for example ceiling `[prepare, review]` with role Preparer can't claim a review), for each RPC family.
- [Risk] The migration refuses on a stack where a signed-in person has #187 roles without certificates. → Accepted: only local and CI stacks matter, and their role accounts have no roles.
- [Trade-off] `is_workspace_admin` stays on the ceiling, so an Intaker with an `admin` ceiling opens the Roster. → Accepted until the site coordinator change, so the first admin can bootstrap.
- [Trade-off] Other people's capabilities in pickers stay the ceiling, so an uncleared person may still be listed. → Accepted. Reassignment is #139.
- [Risk] The browser story runs about 20–25 min and is near its time limit. → Mitigation: no new story phases beyond a short setup-screen check, and timings shown per the project's rule.

## Migration Plan

1. Migration `045_volunteer_clearance.sql`, hand-written: the refusal guard, the strip, the columns, the functions, the trigger, the 21 policy edits, the RPC changes and the grants.
2. Run `npm run db:migrate:test` on a stack that already has `main`'s migrations and a `seed:local` run. That checks the strip on the seeded Hana and Lucy rows, then `npm run test:database`.
3. **Rollback:** applied migrations are final; a fix is a new migration. Before merge, rebuild the local stack from scratch.
4. **Deploy order:** merge after M5 (Nov 16). Afterwards, before a demo, run the setup checklist (roster command, then `seed:local`). The seed clears the role accounts.

## Open Questions

- None blocking. The VT code and the detail shape for the open-work refusal are left to the plan (D7). The plan owns the choice, and it affects only the drawer's message mapping.
