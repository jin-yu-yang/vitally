## Why

Only a follow-up's assignee may log contacts on it and resolve it. Tasks go to the workspace's default follow-up person, so a task assigned to someone who can't act stays open for good (#172): the persona Sam, whom nobody can act as since #169, or a person with `followup` but no `admin`, who can't open the office screens. An open go-over task then blocks Mark ready to e-file. The team decided (#172, 11/7) that anyone with `followup` may work any open office follow-up, with the assignee shown as a label only. This change makes that the rule, and makes `followup` require `admin`, so that the default person can always reach the screens where the work is done.

## What Changes

**Who may work an office follow-up (new migration 042)**
- From: `lock_open_followup` refuses anyone but the task's assignee, for `RESOLVE_FOLLOWUP` and for a contact logged on the task.
- To: anyone holding `followup` may log a contact on, and resolve, any open office follow-up of every purpose: document requests, go-overs and withdrawal notices. A contact linked to a task that is missing or on another case is still refused as forbidden (a resolve naming one stays invalid, as today), and a task that isn't open is "not available" to anyone. The `followup` check that runs before the lock stays.
- Reason: a task must never wait on someone who can't act.
- Impact: non-breaking for callers; the refusal for a non-assignee becomes a success. Open tasks already assigned to Sam or anyone else become workable at once. No rows change.

**`followup` requires `admin`**
- From: the roster and `add_staff_member` accept any mix of capabilities, so a follow-up-only person can be stored and made the default follow-up person.
- To: the roster refuses a staff entry with `followup` and no `admin` before creating any account, `add_staff_member` refuses it, and a check on `people` refuses to store it.
- Reason: the office screens are admin-only, so a follow-up-only person can't work tasks in the app.
- Impact: breaking only for a roster with such an entry; none exists in the example roster or on the local stack.

**What staff see**
- The task card's "Assigned to <name>" stays, as a label.
- The case page's Follow-up note says when the office raises a task (a preparer asks, a reviewer didn't go over the return, or a case is withdrawn or closed before filing) and that anyone in the office with follow-up access can work it.
- The Follow-ups row's "· waiting on <names>" becomes "· assigned to <names>", and the volunteer case page's bare assignee name becomes "Assigned to <name>".
- The browser no longer refuses a non-assignee ("The office assigned this task to someone else.").

**Tests and docs**
- Database tests that expect a non-assignee to be refused, or that hire a follow-up-only person, are converted. New tests cover every purpose, a withdrawal notice on a closed case, Mark ready to e-file after a non-assignee's go-over, and the new refusals.
- Developer docs, setup, and the test counts.

**Out of scope**
- Help requests keep their claim model.
- No reassigning or claiming.
- Presenters, Sam, and the roster's `defaultFollowup` rule (#136).
- The Follow-ups row layout for a go-over (#177).

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `office-follow-up`: a new requirement that anyone holding `followup` works any open office follow-up, of every purpose, with the assignee as a label and "assigned to" in the Call the client row. "The office works a go-over follow-up like any other" is replaced by "…like any other task", without "The assignee SHALL log contacts on it" and its scenario "Only the assignee works it".
- `staff-case-work`: "Office follow-up contacts are logged in the contact log" is replaced by "…by anyone with follow-up access", which lets any `followup` holder log a contact on an open task and states the Follow-up tab's note and the volunteer page's "Assigned to".
- `sign-in`: a new requirement, "A staff member with follow-up access also has admin", for the roster, `add_staff_member` and the stored people. The roster requirements that #136 rewrites are not edited.

## Impact

- **Database:** a new `supabase/migrations/042_let_follow_up_holders_work_any_follow_up.sql` redefining `vitally_private.lock_open_followup` and `vitally_private.add_staff_member`, and adding a check on `public.people`. No applied migration is edited. Teammates apply it with `npm run db:migrate:test`.
- **Code:** `src/admin-views.mjs` (`followupWork`, the panel note, comments), `src/office-views.mjs` (the Call the client row), `src/staff-views.mjs` (the volunteer page's task heading, a comment), `src/supabase-store.mjs` (comments), `tools/admin/roster.mjs`.
- **Tests:** `tests/database-documents.mjs`, `tests/database-staff-identity.mjs`, `tests/database-actions.mjs`, `tests/database-review.mjs`, `tests/database-hold.mjs`, `tests/admin-views.test.mjs`, `tests/office-views.test.mjs`, `tests/staff-views.test.mjs`, `tests/roster.test.mjs`, `tests/fixtures/empty-states.json` with `tests/empty-states.test.mjs`; comments in `tests/database-store.mjs`. `tests/database-contacts.mjs` must pass unchanged.
- **Docs:** `docs/developer/database.md`, `docs/developer/backend.md`, `docs/setup.md`, `README.md`, `docs/developer/README.md`.
- **Dependency: #136 (`remove-presenter-access`).** This change merges first. Both use migration 042 and both redefine `add_staff_member`: whichever merges second renumbers its migration and copies `add_staff_member` from the latest migration that defines it. Before applying 042 to the local stack, check whether #136 has merged; before opening the PR, confirm there is only one `042`. Both also edit `tools/admin/roster.mjs`, `tests/roster.test.mjs` and `tests/database-staff-identity.mjs`.
- **Then #177,** which rewrites the same `office-follow-up` requirement, starts after this change merges.
