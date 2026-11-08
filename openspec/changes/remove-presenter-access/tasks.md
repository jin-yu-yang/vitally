## 1. Baselines

- [ ] 1.1 Record these counts at the branch base, for the PR:
  - unit: `npm test`, `ℹ tests` (expected 1496);
  - database: `npm run test:database` alone on the stack, `ℹ tests` (re-counted; #174 reported 440);
  - browser story: `npm run test:browser` (83 tests, 40 phases);
  - auth-browser: `npm run test:auth-browser` (20).

## 2. Migration 043

- [ ] 2.1 Write `supabase/migrations/043_remove_presenter_access.sql` as design D1–D6 describe.
  - **The refusal, which runs first:** SQLSTATE `VT008`, giving per-kind counts. It covers the seven membership-keyed columns, `cases.created_by_user_id`, and any other membership of a presenter account.
  - **The data steps, in this order:**
    1. presenter receipts;
    2. presenter memberships;
    3. presenter `auth.users` rows;
    4. unreferenced personas, using reference columns derived from `pg_constraint` plus `action_receipts.actor_person_id`;
    5. re-add `memberships_access_check` with `applicant` and `staff`.
  - **Policies:** 22 `ALTER POLICY … USING` with `'staff'`, and 16 `ALTER POLICY … RENAME TO staff_<table>`.
  - **New functions** (`acting_person(memberships)`, the six RPCs without `p_person_id`, `initialize_workspace(uuid, uuid[])`), with the old signatures dropped by name:
    - every new function: `revoke all … from public, anon, authenticated, service_role`;
    - the six RPCs: `grant execute … to authenticated`.
  - **`CREATE OR REPLACE`, same signatures:** `check_operation_authority`, `contact_person`, `lock_case`, `lock_assistance_item`, `act_close_case` (its comment), and `add_staff_member` (no reserved keys).
  - **Constraints:** no `CASCADE` in our SQL, and no trigger disabled.
- [ ] 2.2 Write the read-only scratch scripts, which are not committed:
  - the refusal pre-check: presenter references in the eight columns, and other memberships of presenter accounts;
  - the count script (brainstorm Q13): every `public` table, people by key and link, memberships by access, receipts in total and by presenter actor, the default follow-up person per workspace, and every `auth` table in the cascade.

## 3. Apply 043 to the user's local stack (the test stack)

`npm run db:migrate:test` targets this stack. Applying 043 can't be undone, and from then on other branches' database and browser suites fail on this stack until #136 merges. 043 is applied to this stack only through these steps, before any database suite runs on this branch.

- [ ] 3.1 Tell the user the before-counts are starting, so they stay off the local app until 3.5. Run the refusal pre-check. If it isn't zero, stop and show the user before going further.
- [ ] 3.2 Take the before-counts. Take a backup (`pg_dump` of the stack's database, kept in the scratchpad).
- [ ] 3.3 **Restore check, and the throwaway database:** restore the backup into a new database in the same container (for example `vitally_throwaway`), never the stack's own database. Run the count script there; it must equal the before-counts. Then verify the refusal on that copy:
  1. seed a presenter membership and a `case_events` row that references it;
  2. apply main's 041 and 042 to the copy, then run 043's file and confirm it fails with `VT008` and the per-kind counts;
  3. confirm the copy's counts are unchanged;
  4. delete the seeded reference, run 043 again, and confirm it succeeds.

  Keep the commands and output for the PR, then drop the throwaway database.
- [ ] 3.4 Apply 043 to the stack (`npm run db:migrate:test`, which also applies main's 041 and 042 first; 041 repairs no rows, and any rows 042 changes are added to the expected differences). Take the after-counts. Compare them with the expected differences computed from the before-counts. Any other difference stops the work, and the numbers go to the user.
- [ ] 3.5 Tell the user the after-counts are done.

## 4. Database test support and suites

- [ ] 4.1 `tests/support/database-fixture.mjs`: make every change in brainstorm Q8's fixture list:
  - no presenter account and no `presenterUserIds`;
  - workspaces set up with role staff and `defaultFollowup` `site_coordinator`;
  - `initializeVerified` without personas;
  - no `f.alex`, `f.morgan` or `f.sam`, and no `…AsPersona` helpers;
  - no `staffReader` fallback;
  - no `roleAccounts` or `siteCoordinatorFollowsUp` (grep first to confirm they're unused);
  - a foreign staff person;
  - arg builders without `personId`;
  - `insertShaded` and `seedWorkflow` without personas.
- [ ] 4.2 `tests/support/rpc-signatures.mjs`: the six new signatures, without the person argument.
- [ ] 4.3 Database suites:
  - remove the 2 tests whose code goes (staff-identity "a presenter chooses a demo persona", "a presenter tries a staff member's person");
  - make the replacements in brainstorm Q8, including "a call carrying `p_person_id` matches no function and writes nothing";
  - convert the rest (~90).

  Each test removed or replaced is named with the code it tested, and a grep shows that code gone.
- [ ] 4.4 Catalog tests (`tests/database-catalog.mjs`):
  - no `presenter` in function sources, constraints, policy names or expressions, or views;
  - the 24 policy names by table, with `staff_*` in place of `presenter_*`;
  - exactly six `public` functions, with their signatures and ACLs;
  - `acting_person(memberships, uuid)` and the old `initialize_workspace` signature are gone;
  - the new `acting_person` and `initialize_workspace` can't be executed by `anon`, `authenticated` or `service_role`.
- [ ] 4.5 Reserved-key tests:
  - a freed `sam` key can be added as staff;
  - a key held by a kept persona is refused, and the persona stays unlinked.
- [ ] 4.6 Run `npm run test:database`, all passing. Record the count after, and the remove/replace/convert lists.

## 5. Tools and roster

- [ ] 5.1 `tools/admin/workspace-setup.mjs`: call `initialize_workspace($1,$2::uuid[])` with no `presenterUserIds`.
- [ ] 5.2 `tools/admin/roster.mjs`:
  - require staff and `defaultFollowup`;
  - remove `RESERVED_PERSON_KEYS`;
  - ignore `presenters`, printing "presenters is no longer used and was ignored; those addresses get no access.";
  - drop the presenter count from the summary and the presenter word from the header comment.

  `tools/admin/roster.example.json` loses `presenters`.
- [ ] 5.3 `tools/admin/seed-cases.mjs`: drop `p_person_id`.
- [ ] 5.4 `tests/roster.test.mjs`:
  - remove only the "at least one presenter" assertion;
  - convert the presenter-shaped rosters;
  - add "an old roster's `presenters` is ignored with a note" and "a roster with no `defaultFollowup` is refused";
  - convert the reserved-key test to "any valid key is accepted by the parser".
- [ ] 5.5 `tests/` for the seed: any envelope assertion loses `p_person_id`.

## 6. The browser

- [ ] 6.1 `src/supabase-store.mjs`:
  - remove `SUBSCRIBED_TABLES.presenter`, the presenter half of `isStaffAccess`, and `actingPerson`;
  - remove `p_person_id` from the six RPC calls;
  - remove `mapPerson.linked` (grep for readers first).
- [ ] 6.2 `src/controller.mjs`:
  - remove `inert()` and its seven call sites, the presenter screen choice, and the `testing` export;
  - remove `personId` from every request.

  `src/contracts.mjs`: the Action shape loses `personId`, and its presenter comments go. `src/window-state.mjs`: fix its comment.
- [ ] 6.3 Remove `presenterScreen` and the bare-frame `page()` branch from `src/views.mjs`, the presenter branch from `src/language.mjs`, and the presenter route from `src/app.mjs`.
- [ ] 6.4 Unit tests, following brainstorm Q9:
  - remove `store.test` "a presenter's call still names the person";
  - replace the six controller presenter-window tests with no-membership window tests, which allow only `getPrincipal` repeats;
  - replace the two shell presenter tests with `noAccessScreen` tests: Sign out only, the client frame, follows the language;
  - convert the rest: `fakeClient` defaults to `staff`, envelopes have no `p_person_id`, and requests have no `personId` key.

  Record the lists.
- [ ] 6.5 Browser story (`tests/browser.mjs`):
  - replace `signInPresenter`/`assertPresenterScreen` and the presenter sections with the `unapproved` actor and "This account has no access", with the same zero counts;
  - drop `personId` from R62 and the other forged requests.

  The count stays at 83 tests and 40 phases, with no check trimmed.
- [ ] 6.6 `grep -rn -i presenter src tools tests` and `grep -rn "p_person_id\|personId" src tools tests`: neither prints anything. Persona words are allowed only where they mean the staff member's own person or a kept row.

## 7. Docs

- [ ] 7.1 Update:
  - `README.md`;
  - `docs/setup.md`: the roster, presenters, personas, and what `VT008` means, with a read-only query for its counts;
  - `docs/developer/`: `README`, `architecture`, `backend`, `database`, `frontend`, `production-roadmap` (mark presenter access done in #136);
  - `docs/design/DESIGN.md`.
- [ ] 7.2 Grep all of `docs/` and `README.md` for presenter and persona wording beyond 7.1's list. Leave `docs/demo-script.md` (#137), the dated docs, binary files and `docs/superpowers/` alone.

## 8. Verification

- [ ] 8.1 `npm test` passes. Record the count after.
- [ ] 8.2 `npm run test:database` passes. Record the count after.
- [ ] 8.3 `npm run test:auth-browser`, alone on the stack: all pass.
- [ ] 8.4 `npm run test:browser`, plain, alone on the local stack: 83/83.
- [ ] 8.5 `npm run build:hant -- --check` passes.
- [ ] 8.6 `npm run build:intake` leaves nothing to commit.
- [ ] 8.7 `npx openspec validate --all` passes.

## 9. After archive

- [ ] 9.1 Fix the stale `## Purpose` line of `openspec/specs/sign-in/spec.md`, which deltas can't change. Then full-text grep `openspec/specs/` for `presenter`: nothing remains.
- [ ] 9.2 In `retrospective.md` and the PR description, note that the user's `.vitally-roster.local.json` is out of date (riley/jordan only, with `presenters` and `sampleCaseOwners`). Suggest the replacement based on `roster.example.json`. Don't edit the file or print its addresses.
