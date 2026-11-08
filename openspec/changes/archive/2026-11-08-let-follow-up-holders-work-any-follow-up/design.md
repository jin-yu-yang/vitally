## Context

An office follow-up is a task in `public.admin_followups` with one of three purposes:
- `request_documents`, opened when a preparer escalates an unanswered document request (004);
- `go_over_return`, opened when a reviewer approves without going over the return (033);
- `withdrawal_notice`, opened when a client withdraws during preparation, corrections or review, or when an admin closes a case before filing (036).

Each task is assigned to the workspace's default follow-up person when it opens. The office logs contacts on it and resolves it.

Today only the assignee may do either. One function enforces this, `vitally_private.lock_open_followup` (`004_documents_followup.sql:349-363`). It serves `RESOLVE_FOLLOWUP` (through `act_resolve_followup`, latest in 041) and contacts logged on a task (`vitally_log_contact`, latest in 038). Both check the `followup` capability before they call it. The browser repeats the check in `followupWork()` (`src/admin-views.mjs:296-308`). Row-level security, Realtime and the contact log's edit rule never look at the assignee.

The rule came from the classroom design (2026-09-15), which deferred reassignment, and the contact-log change kept it as it was. Since #169, nobody can act as the persona Sam, the default in any workspace whose roster names no `defaultFollowup`. Separately, a person with `followup` but no `admin` can be the default, but can't open the office screens, which are admin-only (`src/views.mjs:184-186, 232-234`). Either way a task can stay open for good, and an open go-over task blocks Mark ready to e-file (#172).

The team decided (#172, 11/7) that anyone with `followup` may work any open office follow-up, and the assignee becomes a label. The user added that `followup` must require `admin`.

**Constraints:**
- Migrations are hand-written and final once applied, so this is a new migration, 042.
- #136 (`remove-presenter-access`, already planned) also numbers its migration 042, also redefines `add_staff_member`, and rewrites the `sign-in` roster requirements. This change merges first (agreed with Hailey).
- Staff screens stay English, and only English staff text changes here.
- Fictional data only. The local stack is at 041 and has no follow-up-only person.

## Goals / Non-Goals

**Goals:**
- Anyone holding `followup` can log a contact on, and resolve, any open office follow-up of every purpose. The database and the browser agree.
- `followup` without `admin` cannot be configured or stored: the roster, `add_staff_member` and a check on `people` all refuse it.
- What a missing, other-case or closed task gets back stays as it is.
- Staff text no longer says the assignment is fixed, or that a task waits on its assignee.

**Non-Goals:**
- Help requests: they keep their claim model.
- Reassigning or claiming a task, or any new column recording who resolved it.
- Presenters, Sam, and the roster's `defaultFollowup` rule: #136.
- The Follow-ups row layout for a go-over (one go-over shown as two rows): #177.
- Folding `followup` into `admin`: a roles question for #138.

## Decisions

### D1: `lock_open_followup` checks only that the task exists here and is open
- **Choice:** migration `042_let_follow_up_holders_work_any_follow_up.sql` redefines `vitally_private.lock_open_followup(p_case, p_person, p_payload)` with the same signature:
  1. select the task by `workspace_id`, `case_id` and the payload's `followupId`, `for update`;
  2. `if not found` → `VT001 FORBIDDEN`. Only `vitally_log_contact` reaches this branch: for `RESOLVE_FOLLOWUP`, `check_related` (023) already refuses a task that is missing or on another case with `VT007 VALIDATION` before the action runs, and that stays;
  3. status not `open` → `VT004 INVALID_TRANSITION`;
  4. return the task.

  `p_person` stays in the signature, unused, so both callers stay as they are. It is `security definer` with `search_path=''`, and the file ends with the schema-wide revoke, as 041 does. The function's header comment drops the old reason for the order (a non-assignee couldn't tell open from resolved) and says the capability is checked by the caller.
- **Why:**
  - It is the only place the assignee is checked. Both entry points keep their `followup` check, which runs first.
  - The explicit "not found" keeps today's answer for a contact linked to a task on another case or a missing one (`VT001`), so callers and `tests/database-contacts.mjs:319-327` are unchanged. `RESOLVE_FOLLOWUP` keeps its `VALIDATION` from `check_related`. Without it, dropping the assignee check would have turned that into `VT004`, which leaks that something exists and reads as "not available".
  - No information is lost by answering `VT004` to anyone who may act: every staff member can already read a task's status through row-level security.
- **Alternatives considered:**
  - Refuse a missing task with `VT007 VALIDATION`, as `check_related` does for `RESOLVE_FOLLOWUP`. Rejected: it changes an answer callers and tests already rely on, for no gain.
  - Drop `p_person` from the signature. Rejected: it would mean redefining both callers, including `vitally_log_contact`, which #136 also rewrites.

### D2: `followup` requires `admin`, enforced in three places
- **Choice:**
  - **The roster** (`tools/admin/roster.mjs`, `parseStaff`) refuses an entry whose capabilities include `followup` but not `admin`, with "staff[<n>].capabilities must include admin when they include followup." (the style of its other capability messages), before any account is created.
  - **`add_staff_member`** (redefined in 042, copied from its latest definition, `038_staff_identity.sql:901-955`) adds `('followup'=any(p_capabilities) and not 'admin'=any(p_capabilities))` to its first `VT007 VALIDATION` refusal.
  - **A check on `people`**, `people_followup_needs_admin`: `not ('followup'=any(capabilities)) or 'admin'=any(capabilities)`. It covers every writer, including direct SQL. It is added after `drop constraint if exists`, so the file can be re-run (D6).
- **Why:**
  - The office screens are admin-only, so a follow-up-only person can't work tasks in the app.
  - The default follow-up person must hold `followup`, so with this they always hold `admin` too. They can always reach Follow-ups, which closes the staff side of #172 whoever the default is. Only the persona Sam is left, and #136 removes Sam.
  - The roster refuses first so the operator gets a clear message and no half-created accounts. `add_staff_member` repeats the rule, as it repeats the roster's other rules, and the check makes the state impossible.
- **Alternatives considered:**
  - Fold `followup` into `admin`. Rejected: it touches 10 live SQL functions (11 checks), 2 browser checks, the capability list, the roster and every person row, and it decides PCDC's roles (#138).
  - Roster only. Rejected: tests and direct SQL could still store the state.
  - The check only. Rejected: the roster would create accounts before the database refused the person.

### D3: What two people working the same task see
- **Choice:** no new mechanism.
  - Resolve: `lock_case` is `for update` and the action checks the case's revision. A stale second resolve gets `CONFLICT`, and after the re-read the task is no longer open, so the form is gone (or a send gets `INVALID_TRANSITION`).
  - Log contact: no revision check, as today. Two entries for the same call are both kept. A contact sent after the other person resolved the task gets `INVALID_TRANSITION`.
  - The lock order is case, then task, everywhere.
- **Why:** the existing locks already serialise the writes. The contact log keeps every entry by design. The `office-follow-up` scenario "Two follow-up holders on one task" states it, and a database test checks it (D7).
- **Alternatives considered:** a "someone is working on this" marker. Rejected as reassign/claim UI, which is out of scope.

### D4: The browser follows the database
- **Choice:**
  - `followupWork()` (`src/admin-views.mjs`) drops the assignee refusal ("The office assigned this task to someone else."). It keeps the `followup` gate and the status checks. `recordContact`, `resolveFollowup` and `followupForms` follow, so the case page's Follow-up tab and the Log contact drawer show the forms to any `followup` holder. Comments that say only the assignee acts change.
  - The task card keeps "Assigned to <name>".
  - The Follow-up panel note becomes: "The office raises a task when a preparer asks it to contact a client, when a reviewer didn't go over the return with the client, or when a case is withdrawn or closed before its return is filed. Anyone in the office with follow-up access can log contacts on it and resolve it."
  - The Follow-ups Call the client row (`src/office-views.mjs`) reads "<n> open task(s) · assigned to <names>" instead of "· waiting on <names>".
  - The volunteer case page's task heading (`src/staff-views.mjs`, `followupPanel`) shows "Assigned to <name>" instead of the bare name.
  - No "Resolved by" on the task: History already has "<name> resolved the office follow-up.".
- **Why:** the screens must not say a task is fixed to one person, or that it waits on them, once anyone with access can do it. The labels keep who was asked.
- **Alternatives considered:**
  - Drop the names from the Follow-ups row. Rejected: the office still wants to see who was asked.
  - Add "Resolved by". Rejected: it repeats History and needs a column or a history lookup.

### D5: Where the rules go in the specs
- **Choice:**
  - **`office-follow-up`:** ADD "Anyone with follow-up access works any open office follow-up". It covers every purpose, the assignee as a label, a missing or other-case task (a contact is forbidden, a resolve invalid), a closed task (not available), two people on one task, and the "assigned to" texts. Replace "The office works a go-over follow-up like any other" with "The office works a go-over follow-up like any other task", which points at the new requirement. Its scenario "Only the assignee works it" becomes "Another follow-up holder works it".
  - **`staff-case-work`:** replace "Office follow-up contacts are logged in the contact log" with "Office follow-up contacts are logged in the contact log by anyone with follow-up access". Any `followup` holder logs a contact on an open task. A person without `followup`, or a closed task, is refused. It also states the Follow-up note and the volunteer page's "Assigned to". The Sam scenarios become the Site Coordinator's.
  - **Why replaced, not modified:** OpenSpec refuses a MODIFIED requirement that drops a scenario, and both old requirements have a scenario that states the rule being removed. Each is REMOVED (with its reason and migration) and ADDED under a new name, as `remove-presenter-screens` did. Nothing else refers to the old names.
  - **`sign-in`:** ADD "A staff member with follow-up access also has admin". It covers the roster's refusal, `add_staff_member`'s refusal and the stored check.
- **Why:**
  - A general requirement in `office-follow-up` covers document and withdrawal tasks, which no canonical requirement covers today.
  - A separate `sign-in` requirement survives either archive order with #136, which removes, re-adds and modifies the roster requirements.
  - #136's `staff-case-work` delta modifies three other requirements, so the one changed here doesn't clash.
- **Alternatives considered:** edit "The roster creates staff members as new people". Rejected: #136 removes it and adds a replacement, so the edits would clash at archive.

### D6: Coordination with #136, and a re-runnable 042
- **Choice:**
  - This change merges first, and #136 follows (agreed with Hailey, recorded in a comment on #136).
  - Whichever change merges second renumbers its migration and copies `add_staff_member` from the latest migration that defines it.
  - Before applying 042 to the local stack, check whether #136 has merged, and renumber first if it has. Before opening the PR, confirm there is only one `042` on `main` plus the branch.
  - 042 can be re-run: `create or replace` for both functions, and `drop constraint if exists` before the check is added. If the migration must be renumbered after it was applied locally, re-applying under the new number is harmless, and the stale ledger row is deleted the way `docs/developer/database.md` describes.
- **Why:** both changes need 042 and both redefine `add_staff_member`. The second to merge must carry the first one's version forward, or one change's rule is lost.

### D7: Tests
- **Choice:**
  - **Database:**
    - A non-assignee with `admin` and `followup` logs a contact on, and resolves, an open task of each purpose, including a withdrawal notice on a closed case. Resolving a go-over unblocks Mark ready to e-file.
    - Two holders on one task: both contacts are kept, a stale resolve is a conflict, and a re-read resolve is not available.
    - A contact linked to a missing or other-case task is still `VT001`, and a resolve naming another case's task is still `VT007`. A resolved task is `VT004` for anyone, and a person without `followup` is still refused.
    - `add_staff_member` refuses `followup` without `admin`, and the check refuses an insert or update of such a person.
    - Existing tests that assert the old rule, or that hire or update a follow-up-only person, are converted: `tests/database-documents.mjs:945-969` and `1065-1090`, `tests/database-staff-identity.mjs:752-792`, `tests/database-actions.mjs:315-318` and `944`.
  - **Unit:**
    - `followupWork` and the forms for a non-assignee holder (`tests/admin-views.test.mjs`); the Call the client row's "assigned to" (`tests/office-views.test.mjs`); the volunteer page's "Assigned to" (`tests/staff-views.test.mjs`).
    - The new note, including the snapshot fixture `tests/fixtures/empty-states.json`.
    - The roster's refusal (`tests/roster.test.mjs`).
  - **Story:** no new step, because it has one `followup` holder, but it runs because the drawer and Follow-up tab change.
- **Why:** the rule change is in the database, so each purpose and each refusal needs a database test. The browser changes are text and one removed check, which the unit tests cover.

## Risks / Trade-offs

- [Risk] A teammate's stack has a follow-up-only person left behind by an aborted test run, so the check fails and 042 rolls back → Mitigation: the migration header says how to find and remove such a test-workspace row. The local stack has none.
- [Risk] #136 merges first, and this branch's 042 clashes with it or loses its `add_staff_member` → Mitigation: D6's checks before apply and before the PR; copy `add_staff_member` from the latest migration when renumbering.
- [Risk] Two office people resolve or log on the same task at once → Mitigation: D3. The second resolve gets the usual conflict. Duplicate contact entries are kept, as the contact log intends.
- [Trade-off] Any `followup` holder can now resolve a go-over task, which switches the client's Ready to exit message → Accepted: that is the decision. Who resolved shows in History.
- [Trade-off] Until #136 removes presenter access, a presenter can still act as the unlinked persona Sam, who holds `followup`, so after 042 it can also log contacts on and resolve any open task, not only Sam's → Accepted: a presenter acting as Sam already holds `admin` and can close any case, and since #169 no screen lets a presenter act. #136 removes the path. This is not written into the `office-follow-up` spec, which #136 doesn't touch, so it would go stale there.
- [Trade-off] `vitally_log_contact` keeps an internal comment saying a linked contact needs "the task's assignee" (038:567-568) → Accepted: redefining the function just for a comment would clash with #136, which rewrites it. The developer docs say the current rule.
- [Trade-off] "Assigned to" may still read as if the assignee did the work → Accepted for now: the note says anyone with follow-up access can work a task, and the group's wording review may adjust it.

## Migration Plan

1. Before applying: check that #136 hasn't merged (if it has, renumber first, D6). Check that no follow-up-only person exists on the stack:

   ```
   select count(*) from public.people where 'followup'=any(capabilities) and not 'admin'=any(capabilities)
   ```

2. Dry-run 042 on the local stack in a transaction that rolls back, then apply it with `npm run db:migrate:test`.
3. Run `npm test`, `npm run test:database`, `npm run test:browser` and `npx openspec validate --all`.
4. Before the PR: sync with `main`, and confirm there is only one `042`.
5. Teammates apply 042 with `npm run db:migrate:test` after it merges.

**Rollback:** migrations are forward-only. To undo, a new migration restores the assignee check in `lock_open_followup`, drops `people_followup_needs_admin`, and redefines `add_staff_member` without the follow-up line; the roster's refusal in `tools/admin/roster.mjs` is removed with it. No data needs restoring, because 042 changes no rows.

## Open Questions

- **The group's wording review** may adjust the Follow-up note or "assigned to" later. That would be a wording fix; owner: the group.
- **Sam as default follow-up person** for a roster with a presenter: owner #136.
- **One go-over shown as two Follow-ups rows:** owner #177, after this change.
- **Whether anyone at PCDC makes follow-up calls without being a site coordinator** (folding `followup` into `admin`): owner #138, with PCDC.
