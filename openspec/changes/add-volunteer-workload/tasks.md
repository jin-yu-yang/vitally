## 1. Database: the ASSIGN_CASE action

- [x] 1.1 Write failing database tests (`tests/database-workload.mjs`, own fixture workspace only) for every `ASSIGN_CASE` refusal: `NOT_CLEARED`, `FORBIDDEN` (non-admin caller, unknown person), `INVALID_TRANSITION` (each disallowed stage, same holder), `INELIGIBLE` (uncleared, missing effective capability under a wider ceiling), `SELF_REVIEW` (participant as reviewer, current reviewer as preparer), `CONFLICT`, `VALIDATION` (bad payload); each leaves the case and receipts unchanged
- [x] 1.2 Write failing database tests for the effects: Assign preparer and Assign reviewer (stage, slot, participant / active review, client line); Reassign preparer during corrections (participants kept, new preparer resubmits); Reassign reviewer mid-review (same review row moves, new reviewer approves, old reviewer refused); the case event's actor and detail; no client line on Reassign
- [x] 1.3 Add the next free migration (046 at the time of writing): `vitally_private.act_assign_case`; `ASSIGN_CASE` in `check_operation_authority` (effective `admin`), `check_payload` (slot, personId, no other keys) and `vitally_apply_action`'s dispatch, each re-created from its latest definition; revokes re-applied
- [x] 1.4 Add `act_assign_case` to the guard test's list in `tests/database-clearance.mjs` and add the narrower-role reviewer scenario

## 2. Browser data

- [x] 2.1 `listCases`: add one grouped read of each case's newest `contact_log.logged_at` (`lastContactAt`), with a unit test of the mapping
- [x] 2.2 Add `ASSIGN_CASE` to `src/contracts.mjs` and `src/case-actions.mjs` (payload builder), with unit tests
- [x] 2.3 New module `src/volunteer-workload.mjs` (pure): effective capabilities of a volunteer, rows, the counts and Stalled (last activity, 5 calendar days), sorting and search, the Unassigned list, drawer candidates (eligibility, the independence-hidden count, Current) and the language ordering; unit tests for every spec scenario of counts, sorting and ordering

## 3. Views and controller

- [x] 3.1 Volunteers tabs: Roster and Workload, the Workload only for a cleared effective admin; an uncleared ceiling admin keeps the Roster alone (unit tests of the views and the sidebar)
- [x] 3.2 The Workload table: rows, the breakdown bar with screen-reader text, the Not cleared tag, sortable headers, search, the Unassigned row first, expandable rows listing cases (case #, full name, stage, slot, Stalled, Open, Reassign/Assign); the footnote that names show only to admins
- [x] 3.3 The Assign/Reassign drawer: heading with case # and name, search, the ordered candidates with languages, roles and Open count, Current marked, the hidden-for-independence note, Choose sends `ASSIGN_CASE`; refusals shown with the existing dialog error handling
- [x] 3.4 Controller and `app.mjs`: the tab state, loading the Roster's volunteers for the Workload, opening and closing the drawer, sending the action with the case's revision, Realtime refresh of the counts
- [x] 3.5 History sentence for `ASSIGN_CASE` ("<admin> assigned <person> as preparer|reviewer (was <previous>)"), names resolved from people, with unit tests
- [x] 3.6 Styles for the tabs, table, bar and drawer in `src/styles.css`

## 4. Checks and docs

- [x] 4.1 `npm test`, `npm run build:hant -- --check`, `npx openspec validate --all`
- [ ] 4.2 `npm run db:migrate:test` and `npm run test:database` (or a passing CI `database` job on the commit)
- [ ] 4.3 `npm run test:browser` as a regression run (or passing CI `story` jobs on the commit, screenshots reviewed)
- [x] 4.4 Update `docs/developer/` where it describes the Volunteers page, the case actions or the production roadmap's reassignment line
