## 1. Database: migration 042

- [x] 1.1 Before writing 042, check that #136 (`remove-presenter-access`) hasn't merged and that `main` has no `042_*.sql`; if it has, renumber this change's migration and copy `add_staff_member` from the latest migration that defines it (design D6)
- [x] 1.2 Write `supabase/migrations/042_let_follow_up_holders_work_any_follow_up.sql`: `lock_open_followup` without the assignee check, with "not found" → `FORBIDDEN` and not open → `INVALID_TRANSITION` (D1); `add_staff_member` copied from 038 with the `followup`-without-`admin` refusal (D2); the check `people_followup_needs_admin`, re-runnable (D2, D6); the schema-wide revoke; a header that says how to clear a stray follow-up-only test row
- [x] 1.3 Check the stack has no follow-up-only person, dry-run 042 in a rolled-back transaction, then apply it with `npm run db:migrate:test`

## 2. Database tests

- [x] 2.1 Convert the tests that assert the old rule or store a follow-up-only person: `tests/database-documents.mjs` (step 7 removed; the resolved-task check becomes `INVALID_TRANSITION` for a capable non-assignee with `admin`), `tests/database-staff-identity.mjs` (Frankie gets `admin`, and "Review Focus 5" becomes a success), `tests/database-actions.mjs` (Dana gets `admin`; the replay test strips `admin` and `followup` from Sam together)
- [x] 2.2 Add database tests for the new rule: a non-assignee with `admin` and `followup` logs on and resolves a document task, and history names them; another case's task gets `FORBIDDEN` for a contact and `VALIDATION` for a resolve; two holders' contacts are both kept, a stale resolve is a conflict and a re-read one is not available; a task assigned to Sam is worked by the Site Coordinator; another holder resolves a go-over and Mark ready to e-file is allowed; another holder logs on and resolves a withdrawal notice on a Closed case
- [x] 2.3 Add database tests for the capability rule: `add_staff_member` refuses `followup` without `admin` and creates nothing; a direct update or insert of a follow-up-only person is refused by `people_followup_needs_admin`; `admin` without `followup` is still accepted
- [x] 2.4 Run `npm run test:database`

## 3. Roster

- [x] 3.1 `tools/admin/roster.mjs`: refuse a staff entry with `followup` and no `admin`, with "staff[<n>].capabilities must include admin when they include followup.", before any account is created
- [x] 3.2 `tests/roster.test.mjs`: the refusal, the accepted `admin` + `followup` and `admin`-only entries, and the `riley()` helper and its expectations moved to `["prepare", "admin", "followup"]`

## 4. Browser

- [x] 4.1 `src/admin-views.mjs`: `followupWork()` drops the assignee refusal; the comments that say only the assignee acts are reworded (also in `src/staff-views.mjs`, `src/supabase-store.mjs` and `tests/database-store.mjs`); the Follow-up panel note uses the agreed wording
- [x] 4.2 `src/office-views.mjs`: the Call the client row reads "· assigned to <names>"
- [x] 4.3 `src/staff-views.mjs`: the volunteer page's task heading shows "Assigned to <name>"
- [x] 4.4 Unit tests: `tests/admin-views.test.mjs` (a non-assignee holder gets the forms; the new note), `tests/office-views.test.mjs` ("assigned to"; the drawer offers the forms on someone else's task), `tests/staff-views.test.mjs` (the volunteer page's "Assigned to"), and `tests/fixtures/empty-states.json` with its header comment in `tests/empty-states.test.mjs`
- [x] 4.5 Run `npm test`

## 5. Docs

- [x] 5.1 `docs/developer/database.md` (042 in the migration table; `lock_open_followup` and `add_staff_member` in the latest-definition table; the `RECORD_CONTACT` and `RESOLVE_FOLLOWUP` rows; the log-contact rule), `docs/developer/backend.md` (why `defaultFollowup` is required), `docs/setup.md` (042 and the migration count), the migration ranges in `README.md` and `docs/developer/README.md`; grep `docs/` for other claims that only the assignee works a task, or that any capability mix is accepted
- [x] 5.2 Update the test counts in `docs/setup.md`, `docs/developer/README.md` and `docs/developer/database.md` from real runs

## 6. Final checks

- [x] 6.1 Run `npm run test:browser` and `npx openspec validate --all`
- [x] 6.2 Sync with `main`; confirm there is only one `042_*.sql` and that #136 hasn't merged in between (D6)
