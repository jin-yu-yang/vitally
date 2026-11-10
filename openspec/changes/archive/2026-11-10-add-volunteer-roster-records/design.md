## Context

Volunteers exist only as entries in an operator's JSON roster file. `tools/admin/roster.mjs` turns each staff entry into an Auth account, a `staff` membership and a `people` row through `vitally_private.add_staff_member`. Nothing records a volunteer's phone, languages, roles or certificates.

This change is the first slice of #138, built for a PCDC review on the evening of 2026-11-11. The review runs on the user's local stack over a Zoom screen share, and there is no hosted project yet. Data is fictional only.

What the code does today, and why it matters here:

- `people` is readable by every staff member (policy `staff_people`), `listPeople` runs `select *` on it, and it is in the realtime publication and in `STAFF_TABLES`.
- `add_staff_member` always inserts a new person, and refuses a re-run with a changed name, key or capabilities. One refusal aborts the whole roster run.
- `people.capabilities` allows an empty list and `people.user_id` is nullable, so a person with no sign-in is a valid row. `personOptions` in `src/pool-views.mjs` is the only code that lists people, and it feeds the All cases "Prepared by" and "Reviewed by" filters.
- `workspaces.current_season` defaults to 2025 and nothing changes it.
- Every write in the app is an RPC with an action id, a stored receipt and, for edits, an expected revision.

## Goals / Non-Goals

**Goals:**
- An admin can list, search, filter, add and edit volunteers.
- Only admins can read or write these records.
- Roles and certificates are recorded and grant nothing. `people.capabilities` stays the only source of access, and the roster command stays the only way to change it.
- A volunteer added on the Roster and later given access by the roster command stays one person.

**Non-Goals:**
- Everything else in #138: clearance and the setup screen, uploads, Change role, Create account, deactivation, the open-work refusal, Season settings, Start next season, site coordinator, My profile, the volunteer summary, the #104 switch, returning volunteers.
- Removing a volunteer. A mistaken Add can only be edited.
- Gender, usual days, phone sharing, new and photo ID; CSV export; the Show and Works filters; resizable columns; a Schedule or Workload tab.
- Live updates of the Roster between windows.
- The "email already used by a client" check. Nothing here creates a login, and the roster command already refuses a client's address.

## Decisions

### D1: The new fields live in `volunteer_profiles`, not on `people`
- **Choice:** a new table, one row per person, holding email, phone, works, languages, other language and a revision. `roster_entries` and `certificates` are as agreed in #138.
- **Why this differs from the agreed model:** the #138 comment of 2026-11-06 adds these fields to `people`. This slice requires admin-only access, and `people` cannot give it. Row-level security filters rows, not columns, and every staff member must keep reading `people` because case screens show names from it. So columns on `people` would expose every volunteer's email and phone to every staff member, both through `select *` and through the realtime stream, which sends whole rows to staff browsers.
- **Alternatives considered:** column-level grants on `people` make `select *` fail with a permission error and leave the realtime payload unsolved. Splitting only email and phone off, with works and languages on `people`, creates two homes for one form and still needs the new table.
- **Follow-up:** the user updates the decisions doc. Later fields that everyone on the roster may see, such as the volunteer summary, can be decided in their own change.

### D2: Admin checks go through a helper in a new, unexposed schema
- **Choice:** `vitally_policy.is_workspace_admin(p_workspace_id uuid)`, `security definer`, `stable`, `search_path=''`, in a new schema `vitally_policy`. It takes no user id: it answers only for the caller (`auth.uid()`) in the given workspace, true when the caller has an active `staff` membership there and a linked person with `admin`. Execute is granted to `authenticated` only, and revoked from `public`, `anon` and `service_role`.
- **Why:** a policy on `people` that checks admin status by reading `people` fails with infinite recursion (42P17). A `security definer` function owned by the migration role reads `people` without applying its policies. Because it takes no user id, nobody can use it to find out whether another user is an admin.
- **Enforced by:** catalog checks that `vitally_policy` holds exactly this one function, with exactly these properties and grants, and that no function in the schema takes a user id.
- **Alternatives considered:**
  - `vitally_private` can't be used, because `tests/database-actions.mjs` requires that `authenticated` has no execute right on its functions.
  - A `public.vitally_*` function would be callable as an API and would have to fit the RPC receipt contract in `tests/support/rpc-signatures.mjs`.
  - PostgREST exposes only `public`, so the new schema is not an API.

### D3: Who may read a person
- **Choice:** the `staff_people` policy gains a condition: `people.user_id is not null or cardinality(people.capabilities)>0 or vitally_policy.is_workspace_admin(people.workspace_id)`. A volunteer with no sign-in has no capabilities, so only admins can read them.
- **Alternatives considered:** testing for a `roster_entries` row inside the policy gives the wrong answer, because that table's own policy hides its rows from a non-admin, so "no roster entry" would be true for everyone. Kept demonstration personas have capabilities, so they stay readable and old cases keep their names.
- `personOptions` skips people with an empty capability list, because admins can read them but they hold no case work.

### D4: One RPC writes, reads go through policies
- **Choice:** `public.vitally_save_volunteer(p_action_id uuid, p_volunteer_id uuid, p_expected_revision bigint, p_volunteer jsonb)`. A null id with a null revision adds; both present edits. The order is: membership, acting person, admin check, envelope check, workspace lock, digest, receipt, replay, then validation and the write. The admin check comes first, and a non-admin is refused before a receipt is reserved. It is written null-safely, because a client's acting person is an empty row and `not ('admin'=any(null))` is null, which an `if` does not raise on. The write takes the same workspace advisory lock as `add_staff_member`, so an Edit and a roster link can't deadlock or link on an address that has just changed. The three tables grant `select` only, to `authenticated`, under policies calling the helper; `public`, `anon` and `service_role` hold nothing on them.
- **On Add:** a `people` row with a generated key (`v_` plus 12 hex digits), no capabilities and no sign-in; a profile; a roster entry for `current_season` with `added_by_person_id`; and the certificates.
- **On Edit:** lock the profile, `NOT_FOUND` if absent, `CONFLICT` on a stale revision, then update and bump the revision. An email that differs from the stored one on a person with a sign-in is `VALIDATION`.
- **Why:** matches every other write, and replays are safe.
- **Alternatives considered:** direct table writes under RLS would put validation in the browser and need four coordinated statements with no transaction.

### D5: The roster command links a matching record
- **Choice:** replace `add_staff_member` with the same signature. Where it would insert a new person, it first looks for a volunteer with no sign-in whose stored email matches the account's email from `auth.users`. If found, it creates the membership, sets the key, capabilities and `user_id` from the file, keeps the Roster's name, and bumps the profile's revision so an open Edit drawer gets a conflict. If not found, it inserts the person as before and also creates a profile and a roster entry with no roles.
- **Re-run:** the comparison stops looking at the name, and the name in the database wins. Key and capabilities are still compared.
- **Reported to the operator:** linking trusts an email an admin typed, so a typo would attach one volunteer's name and records to another person's account. The roster command prints each link by key, and says when the Roster's name differs from the file's, never printing an address. `initializeWorkspace` finds the link in its own transaction with a small exported query.
- **Alternatives considered:** leaving the command alone would create two people for one volunteer the first time an operator gives them access. Locking names for people with a sign-in avoids the re-run problem but makes names read-only for existing staff, which the slice's Edit is meant to cover.

### D6: Existing staff are backfilled, with no inferred roles
- **Choice:** the migration inserts a profile (email from `auth.users`, lower-cased) and a roster entry for `current_season` for each person linked to a `staff` membership. Roles start empty and the table shows "No roles recorded".
- **Why:** inferring roles from capabilities would suggest the two are connected, and they aren't in this change.

### D7: Season
- **Choice:** roster entries and certificates carry `season`, set from `workspaces.current_season`. The screen shows no season label or picker. `current_season` is 2025 on every workspace today, so a label would read "2026 for TY 2025" during a review held in November 2026.

### D8: Certificates keep the agreed shape
- **Choice:** one row per certificate per roster entry, with `status` allowing `uploaded` and `confirmed`, `confirmed_at` and `confirmed_by_person_id`. This change writes only `confirmed`. Unticking deletes the row. A certificate that stays ticked keeps its original date and confirmer.

### D9: Screen
- **Choice:** a new `office-volunteers` screen, added to `OFFICE_SCREENS` and `STAFF_SCREENS`, reached from an admin-only "Volunteers" sidebar link after All cases. Table columns follow brainstorm Q9. Search (name, email, phone) and the role filter run in the browser on the loaded list. Add and Edit use one new office drawer. The list loads on opening the screen, on a restored session on that screen, and after each save. The table is not in the realtime publication or `STAFF_TABLES`.
- A duplicate email is caught in the browser against the loaded list, so the admin gets a sentence about the field. The database's unique constraint stops a race, which shows the general validation error.
- The prototype's amber missing chips, hollow role dots and ability panel are left out because they imply clearance. One line on the page says the records change nothing yet.

### D10: Tests
- **Browser test:** a new top-level `test(...)` in `tests/browser.mjs` with its own short timeout. Node applies a timeout per `test()`, so this one does not count against either story's 20-minute limit, and the CI legs skip only the story names, so it runs in both. No steps are added to the story or removed from it.
- **Seed:** the volunteers are added in `seedWorkspace`, not `seedCases`, because the browser story calls `seedCases` directly and must stay as it is. A re-run deletes people with no sign-in whose email is on the seed's list, then adds them through the RPC.

## Risks / Trade-offs

- [Risk] The helper in a new schema is a new kind of object for this codebase → Mitigation: catalog checks pin the schema's contents and grants, a database test checks that a non-admin gets false, and another exercises the `people` policy for both kinds of staff.
- [Risk] Changing `staff_people` could hide people that case screens need → Mitigation: the new condition only hides people with no sign-in and no capabilities, and a database test checks that a non-admin still reads staff and kept personas.
- [Risk] An admin sees "Preparer" on someone who can't prepare, and reads it as a bug → Mitigation: the line on the page. Clearance arrives in the rest of #138.
- [Trade-off] Two admins in different windows don't see each other's saves until they reopen the screen → accepted. A conflicting save is refused, and a site this size rarely has two admins editing at once.
- [Trade-off] A mistaken Add can't be removed → accepted for this slice. It is listed as a non-goal.
- [Trade-off] A race on a duplicate email shows a general error rather than a sentence about the field → accepted, because the browser check catches the normal case.
- [Risk] The deadline: two days, including a 20–25 minute browser suite → Mitigation: cut order from brainstorm Q20. The seed goes first, and the user is told so they can add volunteers by hand.

An independent review read D2 and D3 as a non-admin staff member and as a client. It found nothing blocking; its four points are folded into D4 and D5 above. It couldn't verify Realtime's row filtering from the repo, so a database test now checks it. Whether a sign-in email can be captured through an Auth email change depends on hosted Auth settings, which don't exist yet.

## Migration Plan

1. Migration `044_volunteer_roster_records.sql` runs in one transaction: schema and helper, three tables and policies, the changed `staff_people` policy, the RPC, the replaced `add_staff_member`, then the backfill.
2. It changes existing rows only by inserting new ones. `people`, `memberships` and cases are not rewritten.
3. Verify on a stack already at `main`'s migrations (`npm run db:migrate:test`, then `npm run test:database`), because CI starts from an empty database and would not exercise the backfill.
4. Migrations are forward-only. If the change has to be withdrawn before it reaches a shared stack, reset the local stack. After that, a new migration would drop the tables and restore the two replaced objects.

No hosted deployment exists, so there is nothing else to roll out. Wednesday's review runs from the branch's worktree if the PR is not merged by then.

## Open Questions

None block implementation. The decisions doc needs updating for D1 (owner: the user). It does not affect the build.
