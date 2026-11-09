# Brainstorm: remove-presenter-access

The user and I held this brainstorm in conversation on 2026-11-07, starting from main at 81f2cd8. This file records the decisions at propose and doesn't reopen them. **User ruling** marks a decision the user made explicitly. **Builder's call** marks a choice the conversation left to the builder.

## Background

Presenter mode is being removed in steps (#128):
- #169 removed the presenter screens.
- #174 (#135) removed the sample-case tools.
- This change is **#136**. #137, the demo-script rewrite, follows.

**What #169's and #174's retrospectives left for #136:**
- presenter access;
- `p_person_id` and the persona rule;
- the Alex, Morgan and Sam people, with Sam as the old default;
- the roster's `presenters`;
- the presenter's plain screen and the `inert()` guard from #134;
- the store's presenter read entry;
- the `presenter_*` policies.

**Lessons from those retrospectives that this change follows:**
- Search the full text of every canonical spec, not only requirement titles. #174 missed sentences that mentioned the feature in passing.
- Test counts come from the runner's output, not from the source. #174's brainstorm count was wrong.
- Test whole-page frames, and global sign-out across windows (#169).
- Search the docs beyond the plan's file list (#169).

**Baselines on 81f2cd8:**

| Suite | Count | Source |
|---|---|---|
| unit | 1496 / 1496 pass | re-run during this brainstorm |
| database | 440 | #174's retrospective; re-count at the start of apply |
| browser story | 83 / 83, 40 phases | #174's retrospective |
| auth-browser | 20 / 20 | #174's retrospective |

**The local stack** is container `supabase_db_vitally-hailey.*`, migrated to 040. Main has since added `041_resolve_go_over_during_hold.sql` (#176), and #172 (let-follow-up-holders-work-any-follow-up) takes 042 and merges first, so this change's migration is **043** (renumbered at propose, then again during apply). #172 also redefines `add_staff_member` (it refuses `followup` without `admin`), so 043 copies that function from #172's 042 and changes only the reserved keys. I read it read-only during the brainstorm. The user has used the app since then, so every count below is illustrative. **User ruling:** apply re-takes every count fresh and doesn't reset the stack.

| Workspace | What it is | Memberships | Cases | People |
|---|---|---|---|---|
| `160fc95a-f1bf-426d-96ab-7ee8bbc8b1af` | the user's rehearsal workspace (named in `.vitally-roster.local.json`) | 2 applicant, 1 presenter, 6 staff | 11 | 9 |
| `fd2bd812-…` | the database fixture's main workspace (`@vitally.invalid` addresses) | 2 applicant, 1 presenter, 4 staff | 0 | 7 |
| `d3c53ee2-…` | the database fixture's foreign workspace | 1 applicant | 0 | 3; default follow-up is Sam |

The People counts include Alex, Morgan and Sam (unlinked) in each workspace.

## Scope

**In:**
- **Presenter access in the database:**
  - the `memberships_access_check` value;
  - 22 RLS policy expressions, with 16 policy names;
  - the presenter checks in four helpers and `acting_person`;
  - `p_person_id` on the six public RPCs;
  - `initialize_workspace`'s presenter list and persona creation;
  - the reserved person keys.
- **Data:** deleting the presenter receipts, memberships and accounts, and deleting every persona row that nothing references.
- **App, tools, tests and docs:** removing `personId`, the presenter's plain screen, `inert()`, the store's presenter entry and the roster's `presenters`.

**Out:**
- the demo script (#137);
- the case pool's "Prepared by" / "Reviewed by" person filter;
- "persona" in specs, where it already means the staff member's own person;
- fictional names such as Alex and Sam in spec scenarios;
- dated records (`docs/m4-tradeoffs.md`, `docs/design/redesign-review.md`);
- `.docx` and `.png` files;
- `docs/superpowers/`;
- the user's local `.vitally-roster.local.json` (not edited; see Q12).

## Decisions

### Q1. Policies, the access check and helpers

**The access check.** `memberships_access_check` is `CHECK (access = ANY (ARRAY['applicant','presenter','staff']))`. 043 drops it and re-adds it by name as `applicant` and `staff` only, after deleting the presenter memberships (Q4).

**The 24 RLS policies.** Each table has one, a SELECT for `authenticated`.
- 22 of them test `m.access = ANY (ARRAY['presenter','staff'])`. 043 changes each to `m.access = 'staff'` with `ALTER POLICY … USING`, with no DROP.
- `own_membership` and `member_workspace` don't mention presenter and stay.
- The 6 `visible_*` policies keep their applicant-owner branch: `case_contacts`, `case_document_cards`, `cases`, `client_events`, `document_requests` and `documents`.

**User ruling: rename the 16 `presenter_*` policies to `staff_*`** with `ALTER POLICY … RENAME`:
- `admin_followups`, `assistance_items`, `case_events`, `case_materials`;
- `contact_attempts`, `contact_log`, `contact_log_versions`;
- `filing_attempts`, `filing_notes`, `filing_returns`;
- `people`, `preparation_participants`;
- `preparer_questionnaires`, `preparer_shaded_fields`, `reviewer_questionnaires`;
- `reviews`.

**Private helpers:**

| Function | What happens to it |
|---|---|
| `acting_person(memberships, uuid)` | **Replaced** by `acting_person(memberships)`: staff → their linked person, else FORBIDDEN; applicant → null; anything else → FORBIDDEN. The old signature is dropped by name. The new one gets `revoke all … from public, anon, authenticated, service_role`, with no grant: only the SECURITY DEFINER RPCs call it. |
| `check_operation_authority`, `contact_person`, `lock_case`, `lock_assistance_item` | `CREATE OR REPLACE` with the same arguments, so their ACLs stay. `in ('presenter','staff')` becomes `= 'staff'`. The comments mentioning presenter or persona are rewritten. |
| `act_close_case`, `vitally_log_contact` | Only comments change ("presenter-only", "persona"). The bodies are otherwise unchanged. |
| `check_authority`, `reserve_receipt`, `receive_document` | Unchanged. |

**After 043, nothing in the catalog mentions `presenter`:** no function source, constraint, policy name, policy expression or view.

**The request digest keeps its `'personId'` key,** filled with the resolved person, so receipts stored before 043 still match their replays.

### Q2. The six RPCs lose `p_person_id` (user ruling: also drop `personId` from the browser)

Each old signature is dropped by name. Each new one gets `revoke all on function … from public, anon, authenticated, service_role;` then `grant execute on function … to authenticated;`. That matches today's ACL: the owner and `authenticated`.

| RPC | New signature |
|---|---|
| `vitally_apply_action` | `(p_action_id uuid, p_case_id uuid, p_expected_revision bigint, p_type text, p_payload jsonb)` |
| `vitally_assistance_action` | `(p_action_id uuid, p_item_id uuid, p_expected_revision bigint, p_type text, p_note text)` |
| `vitally_close_unsigned` | `(p_action_id uuid, p_cases jsonb, p_confirmed boolean)` |
| `vitally_create_case` | `(p_action_id uuid, p_mode text, p_answers jsonb)` |
| `vitally_log_contact` | `(p_action_id uuid, p_case_id uuid, p_followup_id uuid, p_entry jsonb)` |
| `vitally_edit_contact` | `(p_action_id uuid, p_contact_id uuid, p_expected_revision bigint, p_entry jsonb)` |

These are the only six functions in `public`. Nothing in the catalog calls them.

**Callers:**

| Where | Calls |
|---|---|
| App | `src/supabase-store.mjs`: six RPC calls (~670, 680, 690, 700, 711, 734) and `actingPerson` (~387). |
| Controller | Every request it builds carries `personId: null`. **User ruling:** the key goes from every request and from the Action shape in `src/contracts.mjs`. The 19 controller tests that assert `personId === null` become "the request has no `personId` key". |
| Tools | `tools/admin/seed-cases.mjs` (~44–48, ~232–235): `p_person_id: null` goes. |
| Test support | `tests/support/database-fixture.mjs`: `applyArgs`, `assistanceArgs`, `contactArgs`, `editContactArgs`, `createCase`, `act`, `logContact`, `closeUnsigned` and the `…AsPersona` helpers. `tests/support/rpc-signatures.mjs`: its six signatures and their args. |
| Database tests | ~75 call sites pass a non-null person. The largest groups are staff-identity (15), actions (25) and assistance (13). |
| Browser story | `tests/browser.mjs` ~3994–4001 and ~4019–4027 (R62, an applicant forging a staff `personId`) and ~7995–8002. |

### Q3. Alex, Morgan and Sam (user ruling: option (b), delete what nothing references)

The user first chose to keep the persona rows, then changed the ruling once the presenter receipts were going.

**Rule:** 043 deletes each person with `person_key in ('alex','morgan','sam') and user_id is null` that nothing references, and keeps the rest. A reference is any of:
- the 23 foreign-key columns that point at `people` (listed in Q11);
- `action_receipts.actor_person_id`, which has no foreign key, counted after the presenter receipts are deleted (Q4).

Keeping referenced rows means 043 never fails on a teammate's stack where a persona acted on a hand-made case.

**On the user's stack at brainstorm time:**
- The only persona references were 52 presenter receipts with `actor_person_id` = Sam in `160fc95a`, and `d3c53ee2`'s default follow-up (Sam).
- Receipts from other accounts never reference a persona: staff record their own person and clients record none.
- So 043 would delete 8 persona rows and keep 1: Sam in `d3c53ee2`.

**Follow-ons:**
- A kept persona stays as it is. `d3c53ee2`'s default stays Sam. The seed already refuses a workspace whose default is a persona.
- `mapPerson`'s `linked` field has no reader in `src`, so it goes (**builder's call**: confirm by grep).
- The pool's person filter is out of scope.

### Q4. Presenter receipts, memberships and accounts (user rulings)

**Foreign keys from `public`/`vitally_private` into `auth`.** There are two, both ON DELETE NO ACTION:
- `memberships.user_id` → `auth.users`;
- `cases.created_by_user_id` → `auth.users`.

**Foreign keys into `memberships(workspace_id, user_id)`.** There are seven, all NO ACTION:
- `cases.owner_user_id`;
- `case_events.actor_user_id`;
- `documents.submitted_by_user_id`;
- `contact_attempts.actor_user_id`;
- `contact_log.logged_by_user_id`;
- `contact_log_versions.edited_by_user_id`;
- `people.user_id` (deferrable).

**`action_receipts`** has no foreign key on its actor columns; its only foreign key is `workspace_id` → `workspaces` (CASCADE). The presenters had 82 receipts on the user's stack. **User ruling:** those receipts came from test runs, so 043 deletes them.

**043's data steps, in this order:**
1. **Refusal (user ruling).** If any presenter membership is referenced by the seven columns above, or by `cases.created_by_user_id`, raise an exception that gives the count per table, and change nothing. There is no ban path.
2. Delete every `action_receipts` row whose `actor_user_id` belongs to a presenter membership.
3. Delete the `access = 'presenter'` memberships.
4. Delete those accounts from `auth.users`. **User ruling:** Supabase's own `auth` cascade is acceptable; the no-CASCADE rule is about our DROP statements. It removes, from `auth.users`: identities, sessions, `mfa_factors`, `one_time_tokens`, `oauth_authorizations`, `oauth_consents`, `webauthn_credentials` and `webauthn_challenges`. Through sessions it removes `refresh_tokens` and `mfa_amr_claims`; through factors, `mfa_challenges`.
5. Delete the unreferenced persona rows (Q3).
6. Re-add `memberships_access_check` (Q1).

**What a former presenter sees afterwards.** The deleted address gets `otp_disabled` at sign-in, which `src/auth.mjs` already maps to an unknown address. A session that is still open finds no membership in `getPrincipal`, so the window shows `noAccessScreen` and reads nothing.

**Verifying the refusal (user ruling).** No database test covers it:
- The suite runs on a database past 043, where the access check forbids presenter memberships, so a test has nothing to seed.
- Moving the refusal into a callable function would leave a presenter mention, which the catalog check forbids.

Instead, it is verified once during apply on a throwaway database, never on the user's stack:
1. Start from a copy at 040, and apply main's 041 and 042 first.
2. Seed a presenter membership and a `case_events` row that references it.
3. Run 043 and confirm it fails with per-table counts.
4. Confirm the row counts are unchanged.
5. Remove the reference, run 043 again, and confirm it succeeds.

The PR records this evidence.

### Q5. Workspace setup without presenters

`initialize_workspace(p_workspace_id uuid, p_presenters uuid[], p_applicants uuid[])` is replaced by `initialize_workspace(p_workspace_id uuid, p_applicants uuid[])`:
- The old signature is dropped by name. The new one is revoked from `public, anon, authenticated, service_role`, with no grant; the admin tools call it as the owner.
- It no longer creates Alex, Morgan and Sam, and it drops the "exactly three unlinked people" check.
- It keeps the existing-workspace check that the default follow-up person has `followup`.
- A new workspace's default is null until `set_default_followup` runs in the same transaction; the roster always runs it (Q7).

`tools/admin/workspace-setup.mjs` loses `presenterUserIds`.

**Reserved keys (user asked; recommendation accepted with the ruling to propose).** `alex`, `morgan` and `sam` stop being reserved, in both `add_staff_member` and `roster.mjs`:
- `add_staff_member` already refuses a key held by any person who isn't exactly the staff member being added. In a workspace that kept a persona, that key still fails with VALIDATION, and a kept persona can never be linked to an account.
- Elsewhere a freed key gets a new person id, so it can't merge with history.
- `add_staff_member` is changed with `CREATE OR REPLACE` and the same signature, so its ACL stays.
- **What we give up:** the roster can no longer warn about a kept persona's key before it creates accounts.
- New database tests: a freed key can be added as staff; a key held by a kept persona is refused.

### Q6. The plain screen and `inert()` are replaced by `noAccessScreen`

After 043 no membership can hold `presenter`, so the value never reaches the browser.

**Removed:**
- `presenterScreen` (`src/views.mjs` ~170–173);
- the bare-frame branch in `page()` (~127–129);
- the presenter branch of `viewLang` (`src/language.mjs` ~41–44);
- `src/app.mjs` ~220;
- `inert()` (`src/controller.mjs` ~731, with its comment ~725–730) and its seven call sites (~462, 719, 740, 755, 763, 876, 937);
- the presenter screen choice (~1017–1024);
- the `testing` export (~2810), which exists only for `inert()`;
- `SUBSCRIBED_TABLES.presenter` and the presenter half of `isStaffAccess` (`src/supabase-store.mjs` ~46–54);
- presenter comments in `src/contracts.mjs` (~122–140) and `src/window-state.mjs` (~132).

**Replacement tests, so no check is lost:**
- **Controller:** "a presenter's window loads nothing / on focus / on online / on Try again / makes no store call" becomes the same checks for an account with no membership. `refresh()` asks `getPrincipal` again on focus, online and Try again (~779–781), so the tests expect only those `getPrincipal` repeats, not zero calls.
- **Shell:** the two presenter tests become `noAccessScreen` tests: Sign out is its only action, it uses the client frame, and it follows the chosen language. No unit test of `noAccessScreen` exists today.
- **Browser story:** the presenter window becomes the fixture's existing `unapproved` actor (no membership), checked against "This account has no access" with the same zero counts. This is the first browser coverage of `noAccessScreen`. The story stays at 83 tests and 40 phases.

`build:hant` should be unchanged, because the plain screen's text was hard-coded English.

### Q7. The roster command and the example file (user ruling: ignore `presenters` with a note)

**`tools/admin/roster.example.json`:** drop the `"presenters"` line. It keeps the four role accounts, `defaultFollowup: "site_coordinator"` and the client.

**`parseRoster`:**
- It requires at least one staff entry and always requires `defaultFollowup`.
- The duplicate check covers staff and applicants.
- `RESERVED_PERSON_KEYS` goes (Q5).

**`rosterNotes`:** a roster that still has `presenters` gets one line: "presenters is no longer used and was ignored; those addresses get no access." This sits beside the existing `sampleCaseOwners` note.

**Elsewhere in the roster code:**
- `applyRoster` drops `presenterUserIds` and the presenter count.
- The summary line reads "N staff, N applicant(s)".
- The header comment drops "presenter".

### Q8. Database tests that depend on the presenter or the personas

**Fixture first.** `createDatabaseFixture` always provisions a presenter (~713) and sets `presenterUserIds` (~728). `initializeVerified` (~760–779) requires exactly Alex, Morgan and Sam with Sam as the default. The fixture also sets `f.alex`/`f.morgan`/`f.sam` (~783), and its foreign workspace (~804) uses personas.

**After the change:**
- No presenter account. Each workspace is initialized with role staff and `defaultFollowup` = site_coordinator.
- `f.alex`/`f.morgan`/`f.sam` and the `…AsPersona` helpers go.
- `staffReader` no longer falls back to the presenter (~275).
- `roleAccounts` and `siteCoordinatorFollowsUp` go; they already have no caller. **Builder's call:** confirm by grep.
- A foreign staff person replaces `f.foreignPeople`.
- `insertShaded` stops defaulting to `f.morgan`.
- `seedWorkflow` stops using personas.

**The agent inventory found 103 dependent tests: 7 remove, 6 replace, 90 convert.** By the user's rule ("no test removed while its code survives") the fates are:

| Test | Code it tested | Fate |
|---|---|---|
| staff-identity ~463 "a presenter chooses a demo persona"; ~470 "a presenter tries a staff member's person" | the presenter branch of `acting_person`, which goes | **remove** |
| staff-identity ~221 "naming its own person is the same as null"; ~228 "naming someone else is FORBIDDEN"; ~486 "a client names a person"; ~529 "a tampered request"; database-store ~324 "a client who forges a staff person" | the `p_person_id` comparison, which goes. What they protect still holds: the browser can't choose its actor. | **replace** with one test: a call carrying `p_person_id` matches no function (PostgREST no-matching-function error), and nothing is written. The existing "every entry point records the staff member" test stays. |
| staff-identity ~149 "the three access types" | the access check | **replace:** two access types, and inserting `presenter` is refused |
| staff-identity ~246 "every entry point resolves the person" | `acting_person` in the six RPCs | **replace:** keep the "no person given, records the staff member" half |
| staff-identity ~398 "a replay keeps its actor" | the digest | **replace:** an identical replay keeps its actor |
| staff-identity ~419 "a staff member reusing a presenter's action id" | receipts are per account | **replace:** two staff accounts share one action id |
| staff-identity ~565 "staff read the same rows as a presenter" | the staff policies | **replace:** staff rows equal a privileged read of the workspace, minus private drafts |
| database ~396 "the initializer preserves people…" | `initialize_workspace` | **replace:** a re-run is idempotent, people are staff only, and the default is unchanged |
| The other ~90 | live code | **convert:** the presenter becomes `f.siteCoordinator` or a role account, persona ids become role ids, `p_person_id` is dropped, and names containing "presenter" are reworded. Includes database ~1125 (the policy expressions become `'staff'`) and catalog ~66/~126 (policy names and RPC signatures). |

**New database tests:**
- catalog checks after 043: no function source, constraint, policy name or expression, or view mentions `presenter`;
- the 24 policy names, one per table;
- the exact six RPC signatures and their ACLs;
- the old signatures and `acting_person(memberships, uuid)` are gone;
- the new `acting_person` and `initialize_workspace` can't be run by `anon`, `authenticated` or `service_role`;
- reserved keys are freed (Q5).

**No test disables a trigger** or uses `session_replication_role`. filing ~685 drops two constraints inside a rolled-back transaction, which is unrelated.

**Line numbers are approximate.** The plan names each test by its title.

### Q9. Unit tests and the browser story

92 unit tests are affected:
- **Remove (2):**
  - `store.test` ~541 "a presenter's call still names the person": `actingPerson` goes.
  - The "at least one presenter" assertion in `roster.test` ~46. The rest of that test is converted.
- **Replace (9):** controller ~6257, 6296, 6300, 6304, 6309 and 6337, and shell ~1297 and ~1306, as in Q6. In 6337, only the direct-load half goes, with `testing`.
- **Convert (the rest):**
  - `store.test`'s `fakeClient` defaults to `access: "presenter"` (~334); 36 tests switch to `staff`. Envelopes lose `p_person_id`.
  - language ~44 (drop ~46); shaded-editor ~397.
  - staff-views ~583, ~1507, ~2589; admin-views ~771, ~783; office-views ~903; shell ~1291.
  - roster tests ~25, 35, 128, 171, 191, 221, 234, 249, 261, 283, 304, 324, 364 and 381.
  - the 19 controller `personId === null` assertions (Q2).

**Browser story.** These sections are replaced with the `unapproved` actor:
- `signInPresenter`/`assertPresenterScreen` (~294–338);
- ~935–963, ~1035–1059, ~7827–7830 and ~8117–8146.

`personId` is dropped at ~3994–4001 and ~4019–4027. R62 still proves an applicant can't act as staff, through the database's refusal. `windowState:false` stays. The story stays at 83 tests and 40 phases. **User rule:** never trim checks to fit the time limit.

### Q10. Specs (full-text search done)

**sign-in:**
- **MODIFIED** "A signed-in account acts as a client, a presenter or a staff member": two access types. The scenarios "The three access types" and "A person cannot be linked to a presenter" are reworded.
- **MODIFIED** "A staff account always acts as its own person": the RPCs take no person parameter, and the new signatures are listed. This drops "signatures SHALL NOT change" and the `p_person_id` scenarios.
- **MODIFIED** "A client acts as themselves": no `p_person_id`.
- **REMOVED** "A presenter cannot act as a staff member's person".
- **REMOVED** "A presenter account gets a plain screen".
- **REMOVED** "A workspace can have staff and no presenter", and **ADDED** "A roster needs staff and a default follow-up person".
- **MODIFIED** the roster requirement: no presenter address and no reserved keys. "The demonstration personas stay" becomes "a new workspace has no unlinked people".
- **MODIFIED** "The roster can choose the default follow-up person": always required, and the Sam scenarios are reworded.
- **ADDED** "A former presenter account has no access": its receipts and membership are deleted, it can't sign in, and an open session sees the no-access screen.
- **ADDED** (or folded into MODIFIED; **builder's call**) the persona clean-up rule: unreferenced personas are deleted and referenced ones kept.

**staff-case-work:**
- the persona-means-own-person requirement and its presenter sentence;
- the "tampered request" scenario;
- "Staff see the same cases and rows as presenters" becomes REMOVED, plus ADDED without "presenter";
- the "no presenter controls" requirement and its presenter scenario.

**demo-tools:** drop the scenario "A presenter without the switch".

**local-seed-data:** "The default follow-up person is still a persona" still describes kept personas (Q3). Keep it if it still reads true after the rewrite, else MODIFIED (**builder's call**, checked against the final text).

**Unchanged:** "persona" in case-lifecycle, office-follow-up and review-and-corrections, and Alex/Morgan as fictional names in shaded-section.

### Q11. Persona-reference columns (for Q3 and the count script)

The 23 foreign-key columns that point at `people`:
- `admin_followups.assignee_person_id`, `admin_followups.created_by_person_id`;
- `assistance_items.assignee_person_id`;
- `case_events.actor_person_id`, `case_materials.recorded_by_person_id`;
- `cases.created_by_person_id`, `cases.last_reminded_by_person_id`, `cases.preparer_id`, `cases.reviewer_id`;
- `contact_attempts.actor_person_id`, `contact_log.logged_by_person_id`, `contact_log_versions.edited_by_person_id`;
- `document_requests.requested_by_person_id`, `documents.submitted_by_person_id`;
- `filing_attempts.filed_by`, `filing_notes.recorded_by`, `filing_returns.recorded_by`;
- `preparation_participants.person_id`;
- `preparer_questionnaires.submitted_by_person_id`, `preparer_shaded_fields.updated_by_person_id`, `reviewer_questionnaires.answered_by_person_id`;
- `reviews.reviewer_person_id`;
- `workspaces.default_followup_person_id` (a composite foreign key with `workspaces.id`).

The column without a foreign key: `action_receipts.actor_person_id`.

**Builder's call:** 043 should derive this list from `pg_constraint` at run time rather than hard-coding it, so a missed column can't delete a referenced row; a NO ACTION foreign key would block the delete anyway.

### Q12. Docs, and the user's local roster

**Update** these current-state docs:
- `README.md`;
- `docs/setup.md` (~112, 159, 505, 595, 615, 684, 701–708);
- `docs/developer/`: `README`, `architecture`, `backend`, `database`, `frontend`, `production-roadmap`;
- `docs/design/DESIGN.md`.

Then grep the whole of `docs/` and `README.md` for presenter and persona wording beyond this list.

**Leave alone:**
- `docs/demo-script.md` (#137);
- `docs/m4-tradeoffs.md` and `docs/design/redesign-review.md` (dated records);
- binary files;
- `docs/superpowers/`.

**User ruling on the local roster.** The PR description and `retrospective.md` note that `.vitally-roster.local.json` is out of date:
- it lists only riley and jordan as staff, while the stack's rehearsal workspace has six;
- it still has `presenters` and `sampleCaseOwners`.

They suggest a replacement based on `roster.example.json`: keep `workspaceId` `160fc95a-…`, list the staff wanted, set `defaultFollowup`, and drop `presenters` and `sampleCaseOwners`. The file is not edited and its addresses are never printed.

### Q13. Data safety on the user's stack

As in #135:
1. **Backup.** Take a verified backup and restore check first.
2. **Before-counts.** Tell the user when they start; **user ruling:** the user stays off the local app until the after-counts are done.
3. **Count script.** It is read-only and counts:
   - every `public` table;
   - people by key and linked/unlinked;
   - memberships by access;
   - `action_receipts`, and those by presenter actors;
   - each workspace's default follow-up person;
   - `auth.users`, identities, sessions, `refresh_tokens`, `mfa_factors`, `one_time_tokens`, `mfa_amr_claims`, `mfa_challenges`, `oauth_authorizations`, `oauth_consents`, `webauthn_credentials` and `webauthn_challenges`.
4. **Expected differences.** They are computed from the fresh before-counts and are the only differences allowed. Any other difference stops the work and the numbers go to the user.
   - `action_receipts`: minus the presenter receipts (~−82 at brainstorm);
   - memberships: minus the presenter memberships (−2);
   - `auth.users`, identities and sessions: minus the presenter rows (−2 each);
   - `refresh_tokens`: minus theirs (−20);
   - `mfa_factors` and `one_time_tokens`: minus theirs (0);
   - `mfa_amr_claims`, `mfa_challenges`, OAuth and WebAuthn tables: minus the presenter rows found;
   - people: minus the unreferenced personas (−8);
   - every other table: 0.

### Q14. Checks and test counts

**Checks:**
1. `npm test`;
2. `npm run db:migrate:test`, then `npm run test:database`;
3. `npm run test:auth-browser` (sign-in is touched);
4. `npm run test:browser`, plain, alone on the stack;
5. `npm run build:hant -- --check`;
6. `npx openspec validate --all`;
7. the build:intake no-diff check that CI runs.

**Counts before and after,** for unit, database and browser, go in the PR. Removed, replaced and converted tests are listed separately, each naming the code it tested. A removed test's code is shown gone by grep.

**User rules carried in:**
- no `CASCADE` in our SQL;
- explicit revokes on every new function;
- no test removed while its code survives;
- no test disables a trigger;
- every task and every fix round gets an independent reviewer.

## Dependencies

| Dependency | Status |
|---|---|
| the user's local stack (migrated to 040) | ready |
| the database fixture and throwaway database for the refusal check | ready |
| Supabase auth's own foreign-key cascade | ready (observed in the catalog) |
| teammates' stacks and the classroom target | unknown: the refusal and keeping referenced personas cover them |
| #137 demo script | not needed; it follows this change |

## Acceptance

- 043 applies on the user's stack, and the before/after differences equal the expected differences and nothing else.
- The refusal is verified on a throwaway database, with the evidence in the PR.
- The catalog has no `presenter` mention.
- The six RPCs have the exact new signatures and ACLs, and the old signatures are gone.
- `src`, `tools` and `tests` have no `presenter` mention, `p_person_id` and `personId` are gone, and grep shows it.
- Every check in Q14 passes, and the PR states test counts before and after, with each removal named.
- The canonical specs, after archive, have no presenter requirement, and their full-text search is clean.

## Builder check (answers recorded at propose)

A fresh reviewer read this document as the builder and raised three questions.

1. **Could the refusal fire on the user's own stack?** This is answered already.
   - During the brainstorm I counted presenter user ids in all eight refusal columns: the seven membership-keyed columns plus `cases.created_by_user_id`. Every count was 0.
   - The count misses no rows: a presenter acting with a null person still writes its `actor_user_id`, and those columns are exactly the ones counted.
   - Because the user has used the app since then, apply's read-only before-count script **also counts the refusal condition before the backup is taken**. If it is not zero, apply stops before 043 runs and shows the user the counts. 043 is never edited after it is applied.
2. **A presenter account that also holds another membership.** **Builder's call:** the refusal also fires, with a count, when any presenter account holds a membership other than its presenter one, active or not. This keeps the fail-closed design: 043 never deletes another workspace's membership, and never hits a raw foreign-key error on `auth.users`. On the user's stack each presenter account holds exactly one membership.
3. **The classroom project, and whether the operator can read why 043 refused.**
   - **Readability (builder's call):** the refusal raises its own SQLSTATE, `VT008`: the next code after the `VT001`–`VT007` already in use, and not tied to a migration number (user ruling at propose). The message gives the counts per table, and so does the DETAIL. `tools/admin/migrate.mjs` prints only the code, so it shows `Migration failed (VT008).`, and `docs/setup.md` gains a read-only query that shows the counts. `migrate.mjs` is unchanged. The throwaway verification reads the full message through `psql`.
   - **Privilege:** on the local stack, `postgres` (the migration role) holds DELETE on `auth.users`, which `supabase_auth_admin` owns. 043 runs in one transaction, so if a hosted project denies it, 043 fails with 42501 and changes nothing.
   - **The classroom project doesn't exist yet (user, at propose).** A new project runs every migration from scratch with no presenter accounts, so 043's deletes find nothing there.
   - Account deletion stays in SQL. Moving it to the admin API would split the delete across two systems, so it could no longer happen in one transaction.

The reviewer also confirmed two claims. The digest already uses the resolved person (from 038), so keeping its `'personId'` key is safe. `workspaces.default_followup_person_id` is nullable.
