## Context

The Volunteers page has one tab, the Roster (change add-volunteer-roster-records), which a
ceiling admin opens even when not cleared. Migration 045 (add-volunteer-clearance) gave the
system:
- effective capabilities (`vitally_private.effective_capabilities`);
- the cleared test (`vitally_private.cleared`);
- `vitally_private.require_cleared_assignee`, which has no caller yet;
- a guard test pinning the functions that write `preparer_id`, `reviewer_id` or assignees, or
  insert reviews and preparation participants.

Today a case's preparer and reviewer are set only by the person's own claim:
- `act_claim_preparation` moves `preparation_ready` to `preparing` and inserts the claimer
  into `preparation_participants`, which is permanent.
- `act_claim_review` moves `review_ready` to `reviewing` and inserts an active `reviews`
  row.
- `hand_to_review` and `act_request_corrections` clear the reviewer.
- `lock_active_review` lets only `reviews.reviewer_person_id` decide the active review.

Every case write goes through `vitally_apply_action`, in this order: membership, acting
person, `require_cleared`, receipt, case lock, `check_operation_authority` (effective
capabilities), revision, payload checks, the handler, then `commit_action`, which writes
`case_events`, an optional `client_events` line, the revision and `updated_at`.

The staff browser already loads every case through `listCases`, with participants and open
document request counts. The admin's Roster read gives volunteers with roles, languages and
cleared status, and `people` gives each person's ceiling.

Every cleared staff member can already read taxpayer names (the case page's answers). The
board, the pool and the office queue deliberately show none.

## Goals / Non-Goals

**Goals:**
- Show a cleared admin each preparer's and reviewer's current load, what waits on clients
  and what has stalled.
- Let that admin assign an unassigned case or reassign a held one before approval, to
  someone who can act on it, without breaking independent review.
- Keep every assignment audited and visible in the case history.

**Non-Goals:**
- Hours this week and the Schedule (#140).
- Follow-up load or reassigning follow-ups and help requests.
- Notices to people (#150).
- "Last season's preparer first" (#146).
- Narrowing who reads case data.
- Extending the browser story.

## Decisions

### D1: Workload visibility
- **Choice**: the Workload tab shows only when the signed-in staff member is cleared and has
  effective `admin`. An uncleared ceiling admin sees the Roster tab alone, as today. A
  non-admin never sees the Volunteers link.
- **Why**: the Workload reads case data, which only cleared staff may read. Volunteers'
  languages come from `volunteer_profiles`, which only admins read.
- **Alternatives**: follow the Roster's ceiling admin. Rejected: an uncleared admin reads no
  cases, so the tab would be empty and misleading.

### D2: Taxpayer names
- **Choice**: full primary taxpayer name (`tp_first_name tp_last_name`) beside the case # in
  the Workload's case lists and in the drawer's heading. The board, the pool and the office
  queue are unchanged.
- **Why**: the page is admin-only, and admins already see names in dialogs and the
  close-unsigned list. The user confirmed there is no class projection; this is live
  testing.
- **Alternatives**: masked until hover; first name plus initial; narrowing row access with
  row-level security. The last would be its own compliance change.

### D3: Rows and counts (computed in the browser)
- **Rows**: every volunteer on the current-season roster whose effective capabilities (role
  capabilities ∩ `people.capabilities`) include `prepare` or `review`. A volunteer who is not
  cleared still gets a row, tagged "Not cleared".
- **Counts** per volunteer:
  - **Preparing** = cases where they are preparer and the stage is `preparing` or
    `corrections_required`.
  - **Review** = cases where they are reviewer and the stage is `reviewing`.
  - **Open** = Preparing + Review.
  - **Waiting on client** = their Preparing cases with at least one open document request.
  - **Stalled** = their Open cases whose last activity is 5 or more calendar days ago. Last
    activity = the later of `cases.updated_at` and the case's newest `contact_log.logged_at` (when it was logged; `contacted_at` is when the contact happened).
    Editing an existing contact does not count.
- **Breakdown**: a bar split into Preparing and Review, with the numbers in text for screen
  readers.
- **Sorting and search**: sort by name or by any count; the default is Open, highest first,
  then name. Search matches the volunteer's name.
- **Why in the browser**: the data is already loaded and Realtime keeps it live. One grouped
  read is added to `listCases` for each case's newest contact time. No new read RPC is
  needed, and no new grant on case data.
- **Alternatives**: a SQL view or RPC returning the counts. Rejected: it duplicates logic
  the browser needs anyway for the expanded rows, and needs its own Realtime refresh.
- **Unchanged**: the Roster's open-work rule ("preparer of any case not closed"), which
  protects the Roster save.

### D4: The Unassigned row
- **Choice**: the first row, labelled "Unassigned". It lists:
  - cases at `preparation_ready` with no preparer (slot: preparer);
  - cases at `review_ready` with no reviewer (slot: reviewer).

  Each has Open and Assign. Its counts show how many of each.
- **Alternatives**: Reassign only; Assign from the case page. Rejected in the brainstorm.

### D5: One action, `ASSIGN_CASE`
- **Choice**: `vitally_apply_action(..., 'ASSIGN_CASE', {slot, personId})` dispatches to
  `vitally_private.act_assign_case`.
  - `check_operation_authority` requires effective `admin` (FORBIDDEN otherwise).
  - `check_payload` requires `slot` in `preparer|reviewer` and `personId` a UUID, and no other
    keys (VALIDATION).
  - The handler checks, in order:
    1. The stage allows the slot:
       - preparer, empty: `preparation_ready`;
       - preparer, full: `preparing`, `corrections_required`, `review_ready`, `reviewing`;
       - reviewer, empty: `review_ready`;
       - reviewer, full: `reviewing`.

       Anything else is `INVALID_TRANSITION`, including assigning the current holder again.
    2. The person exists in the workspace (`FORBIDDEN` otherwise, as `contact_person` does).
    3. `require_cleared_assignee` (`INELIGIBLE`).
    4. The effective capability: `prepare` for preparer, `review` for reviewer (`INELIGIBLE`).
    5. Independence (`SELF_REVIEW`):
       - for reviewer, the person is not a preparation participant (`require_review_eligibility`
         with the effective capabilities);
       - for preparer, the person is not the case's current reviewer.
- **Effects**:
  - Preparer, Assign: stage → `preparing`, `preparer_id` set, participant inserted. The
    client line is "A volunteer has started preparing your return."
  - Preparer, Reassign: `preparer_id` set, participant inserted (`on conflict do nothing`),
    stage unchanged, no client line. The old preparer stays a participant.
  - Reviewer, Assign: stage → `reviewing`, `reviewer_id` set, an active `reviews` row
    inserted at the current preparation version. The client line is "An independent reviewer
    is checking your return."
  - Reviewer, Reassign: `reviewer_id` set, and the active review's `reviewer_person_id` set to
    the new reviewer. Its preparation version, start time and id are kept, and no client line
    is sent.
- **Event**: `commit_action` writes `case_events(action='ASSIGN_CASE', actor = the admin,
  detail={slot, personId, previousPersonId})`. The history reads "<admin> assigned <person>
  as preparer|reviewer", followed by " (was <previous>)" when there was one. Names are
  resolved from `people` the way the actor's name is.
- **Why one action**: one set of checks, one guard-list entry, and receipts, the revision
  check and the event come from the pipeline.
- **Alternatives**: a separate RPC, which would duplicate the pipeline; direct table writes,
  which would bypass the audited path.

### D6: Handover keeps work in progress
- **Choice**: a reviewer reassignment moves the existing active review rather than
  superseding it. A preparer reassignment during corrections leaves the findings on the
  case's review record, which every staff member reads, so the new preparer continues and
  resubmits from the last preparer submission.
- **Limit (in the spec)**: a reviewer questionnaire the old reviewer had filled in but not
  sent exists only in their browser and does not carry over.
- **Alternative**: supersede the review and start fresh. The user rejected it.

### D7: Candidate rule = effective capabilities (MODIFIED clearance requirement)
- **Choice**: the drawer and the database use the same rule: cleared, the slot's effective
  capability, and independence. The volunteer-clearance requirement "Staff assign work only
  to a cleared person" is MODIFIED to add `act_assign_case` to the list and to say that it
  reads the assignee's effective capabilities. The follow-up assignee check, the default
  follow-up person check and filters keep `people.capabilities`.
- **Alternative**: `people.capabilities`. Rejected: it can assign work the person is then
  refused on every action.

### D8: Drawer ordering
- **Choice**: candidates in three groups:
  1. speaks the client's preferred language;
  2. speaks another of the client's languages;
  3. the rest.

  Within each group: fewest Open cases, then name.
  - English counts like any language.
  - "Other" matches only when both texts are equal, ignoring case and surrounding spaces.
  - Each candidate shows their name, languages, roles and Open count.
  - Search filters by name.
  - The current holder is listed, marked "Current", and has no Choose button.
  - People who are not cleared, lack the effective capability, or are excluded by
    independence are not listed. When any were excluded by independence, one line says "N
    person(s) who prepared this case isn't/aren't shown."
- **Client languages**: the same source the board's Language column uses (the intake
  answers: preferred language first, then the others).

### D9: Previous holder and clients
- **Choice**: no new notice. Realtime updates the previous holder's board, and a stale press
  gets the existing refusal. Clients get the claim's line on Assign and nothing on Reassign.
  "A case was assigned to you" is noted as a first notice for #150.

## Risks / Trade-offs

- [Risk] The guard test's regex catches `act_assign_case`. → That is intended. The test's
  list gains it, and the clearance delta records it.
- [Risk] Two admins assign the same case at once. → The case lock and the revision check
  make the second a `CONFLICT`, and the drawer shows the existing conflict message.
- [Risk] The browser's counts drift from the database's view. → Both read the same rows
  under the same row-level security, Realtime refreshes the list, and the database check is
  authoritative at Assign.
- [Risk] A reviewer reassignment rewrites `reviews.reviewer_person_id`, so the row no longer
  names who started it. → The case event keeps the previous reviewer. The questionnaire,
  written at the decision, names who decided.
- [Trade-off] Names on an admin page could appear on a shared screen. → Accepted by the
  user: live testing only, no projection.
- [Trade-off] Not cleared volunteers have rows but cannot be chosen. → They show their tag,
  so the admin sees why.
- [Risk] Migration-number collision with #138/#150 in parallel. → Sync with main before the
  PR and renumber.

## Migration Plan

- One new migration (046, or the next free number at PR time). It adds
  `act_assign_case`, re-creates `vitally_apply_action`'s dispatch,
  `check_operation_authority` and `check_payload` (and `check_related` if needed) from their
  latest definitions with `ASSIGN_CASE` added, and re-applies the revokes. It writes no data.
- Rollback: a later migration that removes the action's branches and drops the function.
  Case events already written stay as history.
- Deploy: apply the migration, then ship the browser code. An old browser never sends
  `ASSIGN_CASE`.

## Open Questions

None blocking. Owner: implementation. Confirm whether `check_related` needs an
`ASSIGN_CASE` branch, or whether the handler's own person lookup suffices; this affects only
where the `FORBIDDEN` for an unknown person is raised.
