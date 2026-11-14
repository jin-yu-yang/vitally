<!--
Raw capture of the brainstorm for add-volunteer-workload (#139), held in the
conversation on 2026-11-13 (CLAUDE.md lifecycle steps 1-2). Every decision below
was agreed by the user in that conversation unless it is marked "my call".
-->

# Brainstorm: add-volunteer-workload (#139)

## Background

Issue #139 (part of #129): a Workload tab with open cases, a breakdown, stalled cases and
hours this week; Reassign and Assign with same-language volunteers first and then fewest
open cases; and the decision on who may see taxpayer names. Cases show case # plus the
primary taxpayer's name.

The user brought these decisions to the brainstorm:

- Volunteers gets a Workload tab next to Roster. Schedule comes later as a third tab (#140).
- One row per volunteer, with Open, a breakdown, Preparing, Review, Waiting on client,
  Stalled (no movement for 5 days) and Hours this week. The table is sortable and searchable.
- Expanding a row lists that volunteer's cases, each with Open and Reassign. The Reassign
  drawer has search and puts same-language volunteers first, then those with the fewest
  open cases. A "last season's preparer first" rule waits for client profiles (#146).
- A staff-chosen assignee must be cleared: `vitally_private.require_cleared_assignee`
  (migration 045, refuses with `INELIGIBLE`), and pickers list only cleared people. The new
  assigning function joins 045's guard test of assigning functions.
- Independent review still holds: Reassign never makes a preparation participant the
  reviewer (`VT005 SELF_REVIEW` via `require_review_eligibility`).
- Fictional data only. Staff screens stay in English.

## What exploring the code found

- **The Roster is admin-only.** An uncleared admin still gets it (volunteer-clearance spec).
  Volunteers' languages live in `volunteer_profiles`, which only admins can read.
- **Every cleared staff member can already read every case**, including the intake answers
  with the taxpayer's name ("Staff see every case except a client's private draft"). The
  staff case page shows them under "What the client told us". The work board, the case pool
  and the office queue all say they show "workflow only: no taxpayer names". The only list
  that shows names is the admin's close-unsigned-cases list (`office-views.mjs`).
- **The slots.** `cases.preparer_id` and `cases.reviewer_id`. Claiming preparation (stage
  `preparation_ready` to `preparing`) inserts the claimer into `preparation_participants`,
  which is permanent. Claiming review (`review_ready` to `reviewing`) inserts an active
  `reviews` row. `hand_to_review` and `act_request_corrections` clear the reviewer.
  `lock_active_review` checks `reviews.reviewer_person_id` against the caller.
- **The review's in-progress state.** Findings and the reviewer questionnaire are written
  only at a decision. During a review, the only persisted state is the active `reviews` row
  and the case-level contact log, which the go-over prefill reads.
- **Document requests.** A volunteer can ask for documents only while the case is at
  `preparing` or `corrections_required` (`act_request_document`). A request with status
  `open` waits on the client.
- **Case events.** `commit_action` writes a `case_events` row for every accepted action,
  with the actor and the action's detail. It writes a `client_events` row when the action
  returns a client message. It moves `cases.updated_at` and the revision.
- **The contact log.** `vitally_log_contact` writes `contact_log` and
  `contact_log_versions` only. It does not move `cases.updated_at`.
- **Capabilities.** The roster ceiling is `people.capabilities`. Effective capabilities are
  the current-season roles' capabilities intersected with the ceiling. Today,
  `act_claim_preparation` and `require_review_eligibility` read `people.capabilities`, and
  the clearance spec says checks of *another* person keep doing so.
- **The roster's open-work rule** counts "preparer of a case that is not closed". That rule
  protects the Roster save and is a different question from workload.
- The office queue's ageing uses calendar days, amber at 3 and red at 5.

## Decision chain

**Q1. Who may see taxpayer names?** Options:
- A. Full names on an admin-only page.
- B. Names masked until hover, like phones.
- C. First name plus last initial.
- D. Narrow data access with row-level security.

**Decided: A.** Full names appear on the admin-only Workload: in its expanded rows and in
its Assign/Reassign drawer. The board, the pool and the office queue stay nameless. Who can
read case data does not change in this change (D would be its own change). The user said
there is no class projection any more; this is for live testing.

**Q2. Assign for unassigned cases.** Options:
- 1. Reassign only.
- 2. An Unassigned row on the Workload.
- 3. Assign from the case page.

**Decided: 2, with one action for both.** An Unassigned row at the top of the Workload
expands like a volunteer row. It lists cases at Pending intake / filing with no preparer and
at Pending review with no reviewer, each with Assign.

`ASSIGN_CASE {slot: preparer|reviewer, personId}` assigns an empty slot and reassigns a full
one. Assign has the same effect as the person's own claim: the stage moves, and they become
a preparation participant or get the active review.

The action writes a case event recording who assigned whom (and the previous holder), so the
case history shows it.

For later, not a dependency: "a case was assigned to you" is a good first system notice once
add-posted-updates (#150) adds person notices.

**Q3. When can each slot be reassigned, including mid-review?** Options:
- 1. Anything before approval.
- 2. No mid-review reassignment.
- 3. Also after approval.

**Decided: 1.**
- Preparer: reassignable at preparing, corrections, Pending review and reviewing.
- Reviewer: assignable at Pending review, reassignable at reviewing.
- Nothing after approval.

The user refined it:
- **Reviewer reassigned mid-review.** The review's existing work stays on the case and the
  new reviewer continues it. There is no fresh review. Concretely, the active `reviews` row
  moves to the new reviewer. A reviewer questionnaire that the old reviewer had filled in but
  not sent exists only in their browser window and does not carry over. The spec says so
  (the user agreed).
- **Preparer reassigned during corrections.** Open corrections go to the new preparer.
- **A previous preparer stays a preparation participant,** so they can never be assigned as
  reviewer later.

**Q4. Whose capability counts for a candidate?** Options:
- 1. Effective capabilities.
- 2. Keep `people.capabilities`.

**Decided: 1, for both the picker and the database check.** The volunteer-clearance
requirement "Staff assign work only to a cleared person" is MODIFIED in this change's delta.
Its line "filters keep `people.capabilities`" was written before Assign existed. The default
follow-up person and the follow-up assignee check stay as they are.

**Q5. What counts as Open, and are there admin-only rows?** The Open definition was
accepted:
- Preparing: the person is the preparer, and the stage is preparing or corrections.
- Review: the person is the reviewer, and the stage is reviewing.
- Open: Preparing plus Review.
- Waiting on client: the person's Preparing cases that have an open document request.
- Stalled: the person's Open cases with no activity for 5 calendar days.

Admin rows, options:
- A. Keep the rows with zeros.
- B. Add a Follow-ups column.
- C. Rows only for prepare or review.

**Decided: C.** Rows are only for people whose effective capabilities include `prepare` or
`review`. An admin who also prepares or reviews still appears. "Prepare, review or admin" in
the earlier note was not a deliberate choice. Follow-up load stays on the Follow-ups page.

**Q6. Drawer ordering.** Options:
- 1. Preferred language, then any, then none.
- 2. Any language, then none.
- 3. Preferred language only.

**Decided: 1.**
- The order: speaks the client's preferred language, then speaks any other language the
  client speaks, then the rest. Within each group: fewest open cases, then name.
- English counts like any other language.
- "Other" matches only when both texts are the same, ignoring case.
- Each candidate shows their languages, open-case count and roles. Search filters by name.
- The current holder is listed, marked "Current", and cannot be chosen.
- People who cannot take the slot are left out: anyone not cleared, without the slot's
  effective capability, or blocked by independent review.
- When someone was left out for independent review, a one-line note says so, e.g. "1 person
  who prepared this case isn't shown." (The user asked to keep it.)

**Q7. Hours this week.** Options:
- 1. Leave the column out.
- 2. Show it empty.

**Decided: 1.** #140 adds it with the Schedule tab.

**Q8. Who is told what.** Clients, options:
- 1. Same as a claim.
- 2. Nothing ever.
- 3. Always a line.

**Decided: 1.** An Assign of an empty slot sends the claim's existing client line ("A
volunteer has started preparing your return." / "An independent reviewer is checking your
return."). A Reassign sends nothing, because nothing changed from the client's side.

The previous holder (agreed): the case leaves their "My cases" live and their buttons go
away. A press of a button still on screen gets the normal refusal. There is no notice until
notifications (#150).

**Q9. Smaller defaults (confirmed by the user).**
1. A volunteer whose roles give prepare or review but who is not cleared still gets a row,
   tagged "Not cleared" as on the Roster, but no picker offers them.
2. Search matches the volunteer's name. Columns sort by name and by each count; the default
   is Open, highest first.
3. The browser story is not extended. Assign and Reassign get database and view tests, and
   the story runs as a regression. This keeps it clear of the 900 s limit (#126).

**Q10. Stalled and the contact log.** The user decided that a contact-log entry counts as
activity. The code check found that logging a contact does not move `cases.updated_at`. So
Stalled measures from the later of `cases.updated_at` and the case's most recently logged
contact. Editing an existing contact does not count (my call: an edit corrects a record; it
is not new activity).

## Who can open the Workload

The Workload reads case data, so it shows only to a **cleared** staff member with effective
`admin`. An uncleared admin keeps the Roster tab alone, as today.

## Scope

**In:**
- the Workload tab;
- rows for volunteers with prepare or review, with Open, the Preparing/Review breakdown,
  Waiting on client and Stalled, sortable and searchable;
- expandable rows of cases (case # and full name) with Open and Reassign;
- the Unassigned row with Assign;
- the Assign/Reassign drawer;
- `ASSIGN_CASE` and its case event;
- the MODIFIED clearance requirement;
- one migration: 046, or the next free number at PR time, because accounts (#138) and
  notifications (#150) are being built in parallel.

**Out:**
- Hours this week (#140);
- follow-up load and follow-up reassignment;
- notices to people (#150);
- "last season's preparer first" (#146);
- any change to who can read case data;
- extending the browser story.

## Dependencies

- **Ready:** `require_cleared_assignee` and the guard test (045), `require_review_eligibility`,
  `commit_action` and case events, and the Roster's data and Volunteers page.
- **Not depended on:** #140, #150.
- **At PR time:** sync with main and renumber the migration if 046 is taken.

## Acceptance (checks)

- Database tests for each refusal (`NOT_CLEARED`, `FORBIDDEN` for a non-admin,
  `INELIGIBLE` for an uncleared assignee or one without the effective capability,
  `SELF_REVIEW` both ways, `INVALID_TRANSITION` outside the allowed stages, `CONFLICT` on a
  stale revision).
- Database tests for both handovers (the review row moves, participants are kept), the
  claim-equivalent effects of Assign, the case event and the client line, and the guard test
  updated with `act_assign_case`.
- Unit tests for the counts, Stalled, the drawer ordering and the views.
- Checks: `npm test`, `npm run db:migrate:test` with `npm run test:database`, and
  `npm run test:browser` as a regression run. There is no sign-in change, so
  `test:auth-browser` is not needed. There is no Chinese client text, so `build:hant` is not
  needed (it still runs in CI).

## Approaches considered for the database side (my call, stated here for review)

- **A. A new action inside `vitally_apply_action`** (chosen). It gets receipts, the
  revision check, the case lock, `NOT_CLEARED` first, `commit_action`'s case event and the
  client line for free, in the same shape as every other case action, and the controller's
  existing action path.
- **B. A separate RPC, `vitally_assign_case`.** It would duplicate the receipt, lock and
  revision machinery that `vitally_apply_action` already has.
- **C. Direct table updates under row-level security.** Ruled out: every case write in this
  project goes through an audited SECURITY DEFINER function.

## Builder's calls (minor, settled by me)

- The action is `ASSIGN_CASE`, handled by `vitally_private.act_assign_case`. The admin check
  uses the caller's effective `admin`, as other admin-only actions do.
- Assigning the same person who already holds the slot is refused as `INVALID_TRANSITION`.
  The drawer never offers it.
- The case event's detail is `{slot, personId, previousPersonId}`, with `previousPersonId`
  null for an Assign.
- For Assign, the case event action is `ASSIGN_CASE` whether the slot was empty or full; the
  detail tells them apart. The history wording comes from the detail.
- The Workload's counts are computed in the browser from what the staff screens already load.
  `listCases` gives every case with its participants, its open document request count,
  `updated_at` and the answers (name and languages), and the Roster read gives the
  volunteers. The one addition is a grouped read of each case's latest `contact_log` time in
  `listCases`, for Stalled. The Workload therefore needs no new read RPC.
