# Brainstorm: add-volunteer-clearance

The second slice of #138 (under #129). The first slice, `add-volunteer-roster-records` (#187), recorded roles and certificates without letting them grant anything. This slice makes them matter: a staff member works on case data only when cleared for the current season, and their roles decide what they can do.

The design was agreed with the user in conversation on Nov 10 and 11, 2026, after a check of the decisions against the code. Merge target: after M5 (Mon Nov 16). The PCDC review on Wed Nov 11 and M5 run on `main` without this change.

## Background: what PCDC does today (from the user, for PCDC)

- Each volunteer uploads one signed **Form 13615** (Volunteer Standards of Conduct Agreement) through PCDC's own upload link. It lists the certifications they passed, and signing it is the VSC.
- Nobody works without it, not even as a Greeter.
- Site coordinators check every file in the two weeks before opening, because work is assigned from opening day. Late uploads are fine.
- A volunteer can upload a new 13615 at any time after passing a higher certification. The admin then changes their roles.
- **Photo ID is checked for new volunteers only**, all before the season opens.

## Decision chain

### D1. A role exists only once its certificates are confirmed
- A role can be saved only when its certificates are confirmed. The database refuses otherwise and names what is missing. So every recorded role is in effect, and no role is ever "not active".
- **Principle (user, Nov 10): a role never exists before its certificates.**
  - It is enforced in the database by a constraint trigger, deferred to commit, on `roster_entries` and `certificates`.
  - The app, the seed, the roster command and direct SQL all obey it.
  - Checking at commit lets one transaction write certificates and roles in either order.
- Unticking a certificate removes the roles that need it, in the same save. It is refused while the person holds open work (D9).
- "Change role" from the earlier decisions is dropped, because no role can be stuck.
- **Upgrade:** a new 13615 is uploaded, then the admin ticks the new certificate and adds the role in one save. The role is in effect at once.
- **Returning volunteers** start the new season with **no roles** and nothing pre-ticked. This replaces "suggest last season's roles". Certificates are never copied.

| Role | Needs | Capabilities |
| --- | --- | --- |
| Greeter | VSC | none |
| Intaker | VSC + IT&QR | receive_documents, assist |
| Preparer | VSC + IT&QR + Basic or Advanced | prepare |
| Reviewer | VSC + IT&QR + Basic or Advanced | prepare, review |
| Admin | VSC + IT&QR | admin, followup, assist, receive_documents |

- Reviewer includes prepare and needs the same certificates as Preparer. Independent review is unchanged: `require_review_eligibility` still refuses a preparation participant with VT005 SELF_REVIEW (rule from 006).
- SC is not checked for an Admin in this slice. It comes with the site coordinator role.

### D2. Cleared
- A person is **cleared** when they have:
  - a roster entry for the workspace's current season with at least one role;
  - if the entry is marked new, a photo ID check.
- A staff member with no roles is **not** cleared (ruling 1).
- "Usable sign-in" means the caller's active staff membership, until the accounts table (Create account) exists.

### D3. Effective capabilities
- **Effective capabilities** = the union of the roles' capabilities ∩ `people.capabilities`.
- The roster command's capabilities become only a ceiling, until that command is retired. With no roles, the effective capabilities are empty.

### D4. Where it is enforced

**Reading case data.** The 21 case-data SELECT policies change their "is staff" check to "is staff and cleared":
- admin_followups, assistance_items, case_contacts, case_document_cards, case_events, case_materials, cases;
- client_events, contact_attempts, contact_log, contact_log_versions, document_requests, documents;
- filing_attempts, filing_notes, filing_returns;
- preparation_participants, preparer_questionnaires, preparer_shaded_fields, reviewer_questionnaires, reviews.

**`people.staff_people` is not gated** (ruling 2). An uncleared person must still read their own row and the site coordinator's name.

**Evaluated once per statement (ruling on option 1).**
- The helper is a no-argument `vitally_policy.cleared_workspace_id()`. It answers for the caller only, takes no user id, and is `security definer stable` with `search_path=''`, like `is_workspace_admin`.
- Policies use it as `workspace_id = (select vitally_policy.cleared_workspace_id())`.
- Being uncorrelated, it becomes an InitPlan and runs once per statement. That includes each realtime change check: 19 of the gated tables are in the publication, and RLS runs per change event per subscriber (relates to #165).
- A database test proves it runs once (EXPLAIN shows an InitPlan, or the function's call count is 1 for a multi-row read).
- This replaces the decisions doc's `caller_cleared(workspace)` shape. One account has one active membership, so no argument is needed.

**Actions.**
- `acting_person` stays shared (clients, `vitally_save_volunteer`) and does **not** refuse. It returns the person with effective capabilities.
- **Correction found in the code check:** the capability checks after `acting_person` do not all use its record.
  - `check_operation_authority` reloads the person from `public.people` by id. Its result feeds the per-case prepare and review checks through `check_authority` (used by `vitally_apply_action`, `vitally_assistance_action` and `vitally_close_unsigned`).
  - `vitally_create_case` reads `people.capabilities` directly.
  - So one effective-capabilities function must feed `acting_person`, `check_operation_authority` and `vitally_create_case`. After that, the per-case checks and `require_review_eligibility` need no change.
  - `vitally_log_contact` and `vitally_edit_contact` already use `acting_person`'s record.
- **The clearance refusal is a separate check in the six case RPCs:** `vitally_apply_action`, `vitally_assistance_action`, `vitally_close_unsigned`, `vitally_create_case`, `vitally_log_contact` and `vitally_edit_contact`.
  - It applies to staff callers only. Clients act through `vitally_create_case` and `vitally_apply_action` too, and are unaffected.
  - **Placement (ruling on option 2):** right after `acting_person`, before any case or receipt lookup. An uncleared caller then learns nothing about which ids exist, and a replay of an old action id also gets VT009.
- `vitally_save_volunteer` does not check clearance, so an uncleared admin can still edit the Roster and tick their own certificates (ruling 3). That is the bootstrap for the first site coordinator.

**New error code: VT009 `NOT_CLEARED`.** VT008 is taken by 043's guard. The app treats VT009 as "show the setup screen".

**Roster access stays on the ceiling.**
- `is_workspace_admin` and `vitally_save_volunteer`'s admin check keep reading `people.capabilities`.
- A person with the `admin` ceiling but only, say, an Intaker role still opens the Roster.
- Kept for now; revisit with the site coordinator change (user, Nov 11).

**Other functions:**
- `cleared(person, season)`, for admin screens;
- `vitally_my_clearance()`, for the caller's own setup screen: cleared or not, the missing items, and the effective capabilities.

**Catalog test:** every policy on a case-data table calls the clearance helper, so a new table can't skip it. "Case-data table" means a table with a staff-access policy, except `people`.

### D5. Photo ID (ruling 4)
- Add `is_new` and `photo_id_checked_at` to `roster_entries`.
- The Edit drawer gets "New volunteer" and "Photo ID checked".
- **`is_new` defaults (ruling on option 7):**
  - `false` for the backfill of existing entries and for `add_staff_member` (existing and bootstrap accounts);
  - **Add a volunteer** opens with "New volunteer" ticked;
  - the seed sets it explicitly.

### D6. Cases held by someone who is not cleared (ruling 5, as amended Nov 11)
- They are not unassigned automatically.
- In normal use the open-work rule (D9) prevents it.
- On the day this lands, holders get their cases back once cleared, and an admin can reassign them (#139).
- **The migration does not report holders** (amended Nov 11). The Roster and the setup screen show who isn't cleared.

### D7. Becoming or losing clearance in an open window (ruling 6)
- The roster tables are not in realtime.
- The setup screen re-checks `vitally_my_clearance()` when "Check again" is pressed and when the window regains focus.
- When clearance is lost mid-session, RLS hides the data at once, an RPC returns VT009, and the app switches to the setup screen.

### D8. #187 rows that have roles without confirmed certificates (ruling 7, with option 3 = C)
- #187 recorded roles freely. In practice only seed data is affected: Lucy Fong (Intaker and Greeter, no certificates) and Hana Moretti (Preparer with only VSC).
- The migration:
  - removes roles that a person's certificates don't support, silently, for people with **no sign-in**;
  - **refuses**, like 043's VT008 guard and with counts, if a person **with a sign-in** would lose a role;
  - then adds the constraint trigger, so such rows can't come back.
- No report table (user, Nov 11): a one-time cleanup doesn't earn one.
- The migrator prints no NOTICEs, which is another reason for refusing rather than reporting.

### D9. The open-work rule is built in this change (ruling on option 5)
- It was decided in #187's design (`admin-volunteers-decisions.md`) but never built.
- It applies to a save that removes a role or unticks a certificate. Such a save is refused while the person:
  - holds an open case as preparer or reviewer (`cases.preparer_id` or `cases.reviewer_id`, stage not closed);
  - has an open follow-up assigned (`admin_followups.assignee_person_id`, status open);
  - holds a claimed help request (`assistance_items.assignee_person_id`, status assigned);
  - is the workspace's default follow-up person.
- The alert lists the open work: "<name> still has open work: <list>. Finish it or hand it over first."

### D10. The default follow-up person (option 6, changed by the user, Nov 11)
- Never refuse because of the default follow-up person: not when it is set, and not when a follow-up is assigned. Since #178 any follow-up holder works any follow-up, and a refusal could block a client's own action.
- Being the default counts only as open work under D9.
- This replaces the decisions doc's "An uncleared person may not be set as the default follow-up person". It also avoids breaking the roster command, which sets the default before anyone has roles.

### D11. Test fixtures (ruling on option 4)
- `fixture.staff({capabilities})` and the fixture initializer's role accounts derive the smallest set of roles covering the capabilities. Examples: `[prepare, review]` → Reviewer; `[admin, followup, …]` → Admin; `[assist]` or `[receive_documents]` → Intaker; `[prepare]` → Preparer.
- They write confirmed certificates and those roles by SQL in one transaction. The constraint trigger checks it at commit.
- `cleared: false` opts out, for the tests of uncleared callers.
- This one place serves the database, auth and browser suites. The browser story's staff come from this fixture.

### D12. Screens in this slice
- **Edit drawer:**
  - a role save is refused with the missing certificates named;
  - "New volunteer" and "Photo ID checked";
  - the open-work alert of D9.
- **Minimal setup screen,** titled **"Finish your setup for this season"**, with no year until Season settings brings the season label (user, Nov 11). It shows:
  - upload your signed Form 13615;
  - photo ID if new;
  - the site coordinator's contact;
  - a "Check again" button.
- Buttons elsewhere follow the effective capabilities.
- An uncleared admin sees the setup screen plus Volunteers: the Roster only, no client data.

### D13. Keep main green and the demo working
- Fixtures clear the role accounts by default (D11). Separate tests cover uncleared callers.
- `seed:local` records certificates before roles. It gives the four role accounts roles, confirmed certificates and photo ID through `vitally_save_volunteer` as the Site Coordinator account. An uncleared admin may do that.

| Account | Role | Certificates |
| --- | --- | --- |
| Sky Chen | Admin | VSC, IT&QR |
| Rowan Diaz | Preparer | VSC, IT&QR, Basic |
| Ari Novak | Reviewer | VSC, IT&QR, Advanced |
| Kai Mensah | Intaker | VSC, IT&QR |

- Each account's effective capabilities equal today's. Ari stays review-only because the ceiling is `[review]`. So the demo script's steps still run.
- The seed's fictional volunteers are corrected so every role is backed by its certificates. The seed keeps one volunteer with no roles ("waiting for Form 13615") for the demo.
- The demo script's Roster section and setup.md's "Before a review or demo" checklist are updated. They currently say roles "don't change what anyone can do".

## Corrections to the decisions doc found in the code check
1. `check_operation_authority` and `vitally_create_case` re-read `people.capabilities`. They must use effective capabilities too (D4).
2. The "existing open-work rule" did not exist, so it is built here (D9).
3. Hana Moretti's seed row breaks as well as Lucy Fong's (D8).
4. Refusing an uncleared default follow-up person would break the roster command, so that rule is dropped (D10).
5. `is_new` had no default (D5).
6. The clearance refusal must skip clients (D4).
7. The migrator shows no notices, so the migration refuses rather than reports (D8).

## Calls made while writing this up (for the user to check)
- **A save with no roles is allowed.** Today's Roster spec says "at least one of Greeter… Admin" is required on every save. That conflicts with D1, since a new volunteer whose 13615 hasn't arrived can have no role. It also conflicts with the seed's volunteer "waiting for Form 13615". So the rule is removed, and a save may leave roles empty.
- **Spec drift to fix in the delta:** the `sign-in` spec's catalog scenario says `public` holds "exactly these six RPCs". #187 added `vitally_save_volunteer`, and this change adds `vitally_my_clearance`, so the scenario is updated to list them.
- The Roster's sentence "They don't change what anyone can do in ViTally yet" and its "Nothing suggests clearance" scenario are replaced. The Roster now shows whether each person is cleared, and what is missing.
- `vitally_policy` currently holds exactly one function. It will hold `is_workspace_admin` and `cleared_workspace_id`, and the "no function takes a user id" rule still holds.

## Builder check (Nov 11): the user's answers
- **Site coordinator on the setup screen:**
  - The screen names the workspace's default follow-up person ("Ask <name>, your site coordinator"), read from `people` as today.
  - It shows no email or phone. `vitally_my_clearance()` returns no profile data, so admin-only `volunteer_profiles` stays admin-only.
- **The open-work rule is narrow.** A save is refused only when it would:
  - take away a capability that the person's open work needs: `prepare` or `review` for a held case (whichever is held), `followup` for an open follow-up or for being the default follow-up person, `assist` for a claimed help request;
  - or leave them uncleared while holding any open work.
  - Otherwise, dropping Greeter or unticking Advanced while Basic still covers Preparer is allowed.
- **Hosted data:** only the local and CI stacks matter. A refusing migration there is acceptable, and no fix-up tool is needed.

## Builder check: calls made from existing rulings
- **The caller's capabilities are effective; the assignee checks stay on the ceiling.** Checks of another person's capability keep reading `people.capabilities`. An example is "the follow-up assignee must have `followup`" (033/036). This follows from D10, since a refusal there could block a client's own action. Only the acting caller's capabilities become effective.
- **Other people's capabilities in the browser stay the ceiling.** Pickers, filters and follow-up-holder lists keep reading `people.capabilities`. Only the signed-in person's own buttons use the effective capabilities from `vitally_my_clearance()`. Showing others' effective capabilities would need a staff-readable copy of roster data. That is out of this slice.
- **The policy edit goes in the staff branch only.** The case-data policies are combined client/staff `visible_*` policies, so the clearance condition is added only to their staff branch. The catalog test checks every policy whose staff branch exists.

## Assigning work to others (user, Nov 11)
- **The rule:** when a staff member assigns work to someone else, that person must be cleared. Pickers list only cleared people, and the database refuses an uncleared assignee. When the system or a client assigns work (the default follow-up person), it is never refused, as already ruled. Filters keep the ceiling.
- **What the code does today:** no staff action assigns work to another person.
  - The only staff-initiated assignments are self-claims: claim preparation, claim review, claim a help request. The caller is checked by the VT009 gate.
  - Follow-ups from escalating, approving a review, closing a case and a client's withdrawal all go to the default follow-up person, which the system chooses.
  - `set_default_followup` is the roster command's.
  - No screen has an assignment picker.
- **So** the rule goes into the volunteer-clearance spec for #139's Reassign to inherit, with:
  - a ready-made check, `vitally_private.require_cleared_assignee`;
  - a catalog test pinning today's list of assigning functions, so a new path fails until it is classified.

## Out of this slice
- Uploads and "I've uploaded it" (one 13615 item, later).
- Create account and the accounts table.
- Season settings and Start next season.
- The site coordinator role and SC.
- The returning-volunteer picker.
- The #104 switch.
