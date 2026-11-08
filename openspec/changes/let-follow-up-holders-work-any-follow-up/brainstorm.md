# Brainstorm: let-follow-up-holders-work-any-follow-up

Decision log from the explore and brainstorm conversation of 2026-11-07. The user agreed every decision below before propose.

## Background

- **Where this comes from.**
  - Issue #172: follow-up tasks can end up with someone who can't work them. A roster that lists a presenter and sets no `defaultFollowup` keeps the persona Sam as the default follow-up person, and since #169 nobody can act as Sam. Sam's tasks can't be resolved, and an open go-over task blocks Mark ready to e-file. A default person who holds only `followup` hits the same trap, because the office screens are admin-only.
  - The decision comment on #172 (Hailey, 11/7, which the user agreed to): any staff person with `followup` may log contacts on and resolve any open office follow-up. The assignee stays as display only. The approach: a new migration redefines `vitally_private.lock_open_followup` without the assignee check, and `followupWork()` in `src/admin-views.mjs` drops the matching check. Who resolved is already in `case_events.actor_person_id`, so there is no new column. Out of scope: help requests keep their claim model, and there is no reassign UI.
- **Why the rule was there.** The historical design (`docs/superpowers/specs/2026-09-15-vitally-shared-demo-design.md`, "Admin follow-up") says contact attempts and resolution "require that assigned person and capability", and defers reassignment and claiming. The contact-log change (`openspec/changes/archive/2026-10-18-add-contact-log/`, design and brainstorm) kept the rule unchanged for task-linked contacts. A contact not linked to a task was already open to anyone, and an entry's logger or an admin could edit it. So "only the assignee" was a demo simplification, not a PCDC policy.
- **The code today** (a read-only survey on `main` d8ad003, checked by a second agent):
  - **One database function ties the work to the assignee:** `lock_open_followup` (`004_documents_followup.sql:349-363`, never redefined). It finds the task, refuses anyone but the assignee (`VT001`), then refuses a task that isn't open (`VT004`). Its comment says the order keeps a non-assignee from telling an open task from a resolved one.
  - **Two live callers:** `act_resolve_followup` (041:26) for `RESOLVE_FOLLOWUP`, and `vitally_log_contact` (038:574) for a contact linked to a task. `RECORD_CONTACT` has refused every call since 031. Both callers check `followup` first: `RESOLVE_FOLLOWUP` through `check_authority` and `check_operation_authority` (039:457-460), the contact RPC inline (038:570-572).
  - **Nothing else checks the assignee.** Row-level security on `admin_followups`, `contact_log`, `contact_log_versions` and `case_events` is SELECT-only and has no assignee condition. Realtime already sends these rows to every staff window. `vitally_edit_contact` depends on the logger or `admin` (038:638-640).
  - **The browser repeats the check once:** `followupWork()` (`src/admin-views.mjs:296-308`, the test at 300-301, "The office assigned this task to someone else."). The case page's Follow-up tab and the Log contact drawer both get it through `followupForms`. The controller has no assignee check.
  - **Who can act in the app:** the office screens are admin-only (`src/views.mjs:184-186, 232-234`), so in practice only staff holding both `admin` and `followup` can work a task. In the example roster only the Site Coordinator holds `followup`, together with `admin`. The roster accepts any mix of capabilities, so nothing enforces this.
  - **Task creators assign to the default person:** `act_escalate_contact` (004), `act_approve_review` (033), `act_withdraw` and `act_close_case` (036). Each requires the default person to hold `followup`. A new workspace's default is Sam (040:205-207).
  - **The local test stack** (`vitally-task2`) is at 041.
- **Neighbouring work.**
  - #177 (Follow-ups lists one go-over twice) rewrites the same `office-follow-up` requirement, "The office works a go-over follow-up like any other". It comes after this change.
  - #136 (`remove-presenter-access`, Hailey) is already planned on `origin/remove-presenter-access`. It also numbers its migration 042, redefines `add_staff_member` (no reserved keys), and rewrites the `sign-in` roster requirements. In `staff-case-work` it modifies three requirements, none of them the one this change touches. It doesn't touch `office-follow-up`.

## Decision chain

**Q1. Scope.** The user agreed:

> Any staff person holding `followup` may log task-linked contacts on, and resolve, any open office follow-up of every purpose. The assignee stays as a label. `followup` now requires `admin`. Out of scope: help requests, reassigning or claiming, presenters and Sam (#136), and the Follow-ups row layout (#177).

- **Every purpose:** `request_documents`, `go_over_return` and `withdrawal_notice`. "Any open office follow-up" in the decision comment means all of them, and no canonical requirement covers document or withdrawal tasks today.
- **Roster and default-person rules for presenters** stay with #136, which makes `defaultFollowup` required and removes Sam.
- **The Follow-ups row layout** stays with #177. The two changes must not run at the same time, or their copies of the same `office-follow-up` requirement clash when the second is archived.

**Q2. The name.** The first name, `let-any-admin-work-follow-ups`, overpromised: an admin without `followup` is still refused ("Needs office follow-up access."), and the name becomes the archive folder's. The user chose `let-follow-up-holders-work-any-follow-up`.

**Q3. Who may act: `followup`, which now requires `admin`.** The user asked whether "the roster accepts any mix" meant (1) the roster refuses `followup` without `admin`, or (2) the capability disappears into `admin`. Neither was in the first scope. Compared:

| | 1. `followup` requires `admin` | 2. Fold `followup` into `admin` |
|---|---|---|
| Changes | The roster and `add_staff_member` refuse `followup` without `admin`; a check on `people` makes it impossible to store | 10 live SQL functions (11 checks), 2 browser checks, the roster, the capability list on `people`, a data migration, and the `sign-in` rule for `defaultFollowup` |
| Data | None on the stack: nobody holds `followup` without `admin`, and nobody holds `admin` without `followup` either; only test fixtures do | Every person row is rewritten |
| Decides | A guard; the two capabilities stay | A role model: ends an admin who doesn't do follow-ups |

The user chose **option 1, folded into this change**. With it, the default follow-up person (who must hold `followup`) always holds `admin` too, so they can always reach Follow-ups and work their tasks. That closes the staff side of #172; only Sam, an unlinked persona, is left, and #136 removes Sam. Option 2 is a question about PCDC's roles (does anyone make follow-up calls who isn't a site coordinator?) and belongs with #138.

- **The roster** refuses a staff entry with `followup` and no `admin`, before any account is created, so the operator gets a clear message.
- **`add_staff_member`** refuses it with `VALIDATION`.
- **A check on `people`** refuses any row with `followup` and no `admin`. It is a plain check: no row on the stack breaks it. A teammate's stack fails the migration only if an aborted test run left a follow-up-only person behind; the migration header says how to clear that.
- **The database rule stays "holds `followup`"**, as the existing capability gate checks. With option 1 every `followup` holder is also an admin.

**Q4. The lock.** A new migration 042 redefines `lock_open_followup` without the assignee check. It keeps `for update` and the open-status check. Defaults the user accepted with the summary:

- **A task that is missing, or on another case,** is still refused as `FORBIDDEN` (`VT001`). Without an explicit "not found" step, dropping the assignee check would turn this into `INVALID_TRANSITION` (the missing row's null status), which tells the caller something about other cases and changes `tests/database-contacts.mjs:319-327`. Only "who is asking" stops mattering.
- **A task that isn't open** is `INVALID_TRANSITION` for anyone who may act. The old comment's reason for ordering (a non-assignee couldn't tell open from resolved) is moot: every staff member can already read the status through row-level security.
- **Two admins on one task:** the case lock is `for update` and the action checks the revision, so a stale second resolve gets `CONFLICT`, then `INVALID_TRANSITION` after the re-read. Logging a contact has no revision check, so two entries for the same call are both kept, as the contact log already allows. A contact sent after the other admin resolved gets `INVALID_TRANSITION` in the drawer. The lock order (case, then task) is the same everywhere.
- **The callers stay as they are.** `act_resolve_followup` (041) and `vitally_log_contact` (038) pick up the new lock. A go-over resolve still switches the signing plan (041), so any `followup` holder now triggers the client's Ready to exit message change, as the assignee did before.

**Q5. What staff see.** The user agreed:

- **"Assigned to <name>" stays** on the case page's task card and in the Log contact drawer, as a label.
- **The panel note** on the case page's Follow-up tab changes from "The office raises a task when a preparer asks it to contact a client. ViTally assigns it; there is no way to hand it to someone else here." to:

  > The office raises a task when a preparer asks it to contact a client, when a reviewer didn't go over the return with the client, or when a case is withdrawn or closed before its return is filed. Anyone in the office with follow-up access can log contacts on it and resolve it.

  The old first sentence was already stale (tasks also come from go-overs and withdrawals).
- **No "Resolved by" on the task.** The History tab already reads "<name> resolved the office follow-up.", and there is no new column.
- **The Follow-ups row** "2 open tasks · waiting on Sam, Jo" becomes "2 open tasks · assigned to Sam, Jo". The user pointed out that "· waiting on <name>" had no owner (#177 is about one go-over showing as two rows, not this text), and this change is the one that turns the assignee into a label.
- **The volunteer case page** shows each task's assignee as a bare name in the task heading (`src/staff-views.mjs:1918`). It becomes "Assigned to <name>", matching the office card.
- **Help requests' "Helper: <name>"** stays (out of scope).

**Q6. Withdrawal notices.** The user caught a case the first note wording missed. A `withdrawal_notice` opens in two situations, and both stay open on a case that is already closed:

| When | Follow-ups text | Code |
|---|---|---|
| The client withdraws during preparation, corrections or review | "The client withdrew; tell <name> to stop work." | `act_withdraw` (036:572) |
| An admin closes before filing: Withdrawn at Ready to exit or Ready to e-file, or any reason from a Hold that came from Ready to exit | "The client withdrew; make sure the return is not transmitted in TaxSlayer." or "The case was closed before filing; make sure the return is not transmitted in TaxSlayer." | `act_close_case` (036:519) |

The season-end close opens none (037). The note wording in Q5 covers both, and a database test has a non-assignee resolve a withdrawal notice on a closed case.

**Q7. Where the rules go in the specs.**

- **`office-follow-up`:**
  - ADDED: a general requirement that anyone holding `followup` logs contacts on and resolves any open office follow-up, of every purpose, with the assignee as a label.
  - MODIFIED: "The office works a go-over follow-up like any other". "The assignee SHALL log contacts on it" and the scenario "Only the assignee works it" change to the general rule, and the Call the client row's text becomes "assigned to".
- **`staff-case-work`:** MODIFIED "Office follow-up contacts are logged in the contact log", which today says "Only the task's assignee, holding `followup`, SHALL be able to log a contact linked to an open task", with its scenario "Someone else cannot log on the task". It also covers the panel note and the volunteer page's "Assigned to".
- **`sign-in`:** the user's idea: ADD a new requirement, "A staff member with follow-up access also has admin", instead of editing the roster requirements #136 rewrites. A separate requirement survives either archive order. The roster requirement "The roster can choose the default follow-up person" stays as it is: "Follow-ups already open SHALL keep their assignee" is still true as a label.

**Q8. Order and coordination with #136.** The user checked with Hailey:

- This change lands first, and #136 (which also names 042) follows.
- The proposal names #136 as a dependency, with the rule: **whichever change merges second renumbers its migration and copies `add_staff_member` from the latest migration that defines it.**
- Before applying 042 to the local stack, check whether #136 has merged; if it has, renumber first. Before opening the PR, confirm there's only one `042`.
- 042 is written so it can be re-run, as 039 is (`create or replace`, and the check dropped if it exists before it is added). If #136 merges after 042 is on the local stack, renumbering is then harmless, and the stale ledger row is deleted as `docs/developer/database.md` describes.
- Expect small merge conflicts in `tools/admin/roster.mjs`, `tests/roster.test.mjs` and `tests/database-staff-identity.mjs`, which both changes edit. Whoever merges second resolves them after merging `main`.
- The user had a comment posted on #136 saying all this (https://github.com/jin-yu-yang/vitally/issues/136#issuecomment-6714899041).

**Q9. Data.** No rows are repaired or moved. Open tasks assigned to Sam, or to anyone, become workable at once by every `followup` holder. No follow-up-only person exists on the stack, so the new check fits the data.

**Q10. Tests and checks.**

- **No new browser story step.** The story has one `followup` holder (the Site Coordinator), so a non-assignee step would need fixture SQL. Non-assignees are covered by unit and database tests, and the story still runs because the drawer and the Follow-up tab change.
- **Checks:** `npm test`; `npm run db:migrate:test` (after a dry run of 042) then `npm run test:database`; `npm run test:browser`; `npx openspec validate --all`.
- **Not needed:** `npm run test:auth-browser`, because sign-in itself doesn't change, only the roster command; and `npm run build:hant -- --check`, because only English staff text changes.

## Consequences found while checking

- **Database tests that assert the rule being removed** flip to success, or change because the new check refuses their setup:
  - `tests/database-documents.mjs:945-969` ("Step 7: the capability alone is not the assignment") gives the reviewer `["followup","review"]` with a SQL update, which the new check refuses, and expects `FORBIDDEN`. It becomes a capable non-assignee who succeeds (with `admin` too).
  - `tests/database-documents.mjs:1065-1090` uses the same update on a resolved task; it becomes `INVALID_TRANSITION`.
  - `tests/database-staff-identity.mjs:752-792` hires Frankie with only `followup`, which `add_staff_member` now refuses, and its "Review Focus 5" expects Frankie to be refused on the Site Coordinator's task. Frankie gets `admin` too, and resolving succeeds.
  - `tests/database-actions.mjs:944` hires Dana with only `followup`; Dana gets `admin` too.
  - `tests/database-contacts.mjs:308-343` keeps its `VT001` for a task on another case (Q4) and its `VT001` for the preparer (no `followup`).
- **Unit tests:** `tests/admin-views.test.mjs` (around 42-48, 317 and 319-328: the "someone else" refusal and the old note) and `tests/office-views.test.mjs` (231 for "waiting on", 444-453 for the non-assignee) change, and the snapshot fixture `tests/fixtures/empty-states.json` holds the old note. The roster tests gain the new refusal.
- **Docs that become false:** `docs/developer/database.md` (the migration table, the latest-definition table, the `RECORD_CONTACT` and `RESOLVE_FOLLOWUP` rows at 490-491, and the log-contact rule at 621-623), `docs/developer/backend.md` (why `defaultFollowup` is required: "Sam … would get work nobody can act on"), `docs/setup.md` (the migration table and count), the migration ranges in `README.md` and `docs/developer/README.md`, and the test counts.
- **Stale comments inside live code:** `src/admin-views.mjs` (293-295, 371-372, 549) and the comment inside `vitally_log_contact` (038:567-568). The browser comments change; `vitally_log_contact` is not redefined just for its comment.

## Open items, with owners

- **The group's wording review** may adjust the panel note or "assigned to" later, as a wording fix.
- **Sam as the default follow-up person** for a roster with a presenter: #136.
- **The Follow-ups row layout for a go-over:** #177, after this change.
- **Whether anyone at PCDC does follow-up calls without being a site coordinator** (option 2): #138.
