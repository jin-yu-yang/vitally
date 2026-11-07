# Brainstorm: remove-sample-case-tools

This is the decision log from the brainstorm with the user, held in conversation on 2026-11-06 and recorded at propose. The decisions are not reopened here. A **builder's call** marks a choice the conversation left to the builder.

## Background

Presenter mode is being removed in steps (#128). Merged so far:
- #142: the database tests act as role accounts;
- #144: the local seed command;
- #145: the browser story on role accounts and the seed;
- #143: the demo-tools gate;
- #168: the browser story's 20-minute limit;
- #169: the presenter screens are gone.

This change is **#135**. #136 (presenter access) and #137 (the demo-script rewrite) follow.

**What's left is the database's sample-case machinery:**
- `public.vitally_reset_fixtures`, which rebuilds ten sample cases and one sample help request;
- `public.vitally_load_checkpoint`, which puts a sample case back at a story point;
- the private seeding helpers;
- `cases.fixture` / `fixture_key`, `assistance_items.fixture`, `workspaces.fixture_generation` and `vitally_private.fixture_client_bindings`;
- the roster's `sampleCaseOwners`;
- in the browser, the store's wrappers and the "Sample cases were reset." notice.

Since #169, nothing in the app calls the reset or the checkpoints.

The notes #169's retrospective left for #135 are all in scope:
- the store wrapper and its test;
- the database suites that call the functions through `f.presenter`;
- `docs/developer/README.md:162`;
- the stale "Presenter-only" comment;
- the orphaned `CHECKPOINTS`.

The historical design `docs/superpowers/specs/2026-09-15-vitally-shared-demo-design.md` introduced the sample set. Two of its rules still hold and are carried into the specs:
- action receipts survive deletions, because their targets are historical values;
- realtime never publishes a deletion.

## Scope

**In:** remove the sample-case machinery everywhere:
- the reset;
- the checkpoints;
- the sample cases and the sample help request;
- the client bindings and `sampleCaseOwners`;
- the "Sample cases were reset." notice.

That takes one new migration (040), plus the app, tools, tests and docs that use them.

**Out:** for #136:
- presenter access;
- `p_person_id` and the persona rule;
- the Alex, Morgan and Sam people, with Sam as the old default;
- the roster's `presenters`;
- the presenter's plain screen and `inert()`;
- the store's presenter read entry.

## Decisions

### Q1. What migration 040 drops (agreed)

These are the 13 functions whose source mentions fixture, read from the local catalog at 039 (`pg_proc.prosrc`), plus 5 sample-only functions whose bodies don't mention it:

| Function | Fate |
|---|---|
| `public.vitally_reset_fixtures(uuid)` | drop |
| `public.vitally_load_checkpoint(uuid,uuid,bigint,text)` | drop |
| `vitally_private.seed_fixtures(uuid,bigint)` | drop |
| `vitally_private.apply_fixture_scenario(public.cases,text,uuid)` | drop |
| `vitally_private.fixture_contact_v2(text)` | drop |
| `vitally_private.backfill_client_numbers(uuid)` | drop (a one-time backfill run in 010) |
| `vitally_private.version_one_blockers()` | drop (an obsolete 023 cleanup helper) |
| `vitally_private.version_one_blocks(smallint,boolean,boolean)` | drop |
| `vitally_private.version_one_disposable(smallint,boolean,boolean)` | drop |
| `vitally_private.filing_notes_append_only()` | **rewrite** (Q2) |
| `vitally_private.reserve_receipt(public.memberships,uuid,text,text,uuid)` | **rewrite** (Q2) |
| `public.vitally_create_case(uuid,text,uuid,jsonb)` | **rewrite** (Q2) |
| `vitally_private.initialize_workspace(uuid,uuid[],uuid[],jsonb)` | **rewrite** as `(uuid,uuid[],uuid[])` (Q5) |
| `vitally_private.fixture_keys()` | drop |
| `vitally_private.fixture_answers_v2(text)` | drop |
| `vitally_private.fixture_history(text)` | drop |
| `vitally_private.checkpoint_scenario(text)` | drop |
| `vitally_private.new_reference()` | drop (its only caller is `seed_fixtures`) |

**Also dropped:**
- the table `vitally_private.fixture_client_bindings`;
- the columns `cases.fixture`, `cases.fixture_key`, `assistance_items.fixture`, `workspaces.fixture_generation` and `action_receipts.generation`;
- the constraints `cases_fixture_key` and `workspaces_fixture_generation_check`;
- the index `cases_one_fixture_key`.

The value `'fixture'` leaves `cases.origin`: `cases_origin_check` and `cases_origin_owner` are recreated without it.

### Q2. What 040 rewrites, because live code reads these columns (agreed)

- **`filing_notes_append_only`:** today it allows a delete when the case row is gone, or when the transaction names the case in `vitally.clearing_case` and the case is a fixture. Postgres doesn't track dependencies inside a function body, so dropping `cases.fixture` would make every delete of a filing note fail at runtime, cascades included.
  - The rewrite allows a delete only when the case row is gone. The fixture and `clearing_case` branch, and its comment, go.
- **`reserve_receipt` and `vitally_create_case`:** both fill `action_receipts.generation`, which is NOT NULL, from `fixture_generation`.
  - The user checked that replay protection is the unique key `(workspace_id, actor_user_id, action_id)`. Nothing reads `generation`: no migration, nothing in `src/` or `tools/`, and only tests that this change removes or converts.
  - So both stop writing it, and the column is dropped. `vitally_create_case` also stops inserting `fixture`.

### Q3. Rows already in a database (agreed)

Demo leftovers are deleted by 040, as decided earlier. **The rows deleted:**
- `cases where fixture or origin = 'fixture'`: the samples, with every per-case child row by cascade;
- `assistance_items where fixture`: the sample help request;
- any help request linked to a sample case, although no code creates one.

**The foreign-key check** (catalog and migrations):
- Every foreign key into `cases` is `(workspace_id, case_id) → cases(workspace_id, id) ON DELETE CASCADE`. There are 19 tables:
  - `preparation_participants`, `document_requests`, `documents`, `admin_followups`, `contact_attempts`;
  - `case_events`, `client_events`, `assistance_items`, `reviews`, `case_contacts`;
  - `case_materials`, `case_document_cards`, `contact_log`, `preparer_questionnaires`, `reviewer_questionnaires`;
  - `filing_attempts`, `filing_returns`, `filing_notes`, `preparer_shaded_fields`.

  `contact_log_versions` hangs off `contact_log`.
- Second-level keys include their own case's id.
- There is no case-to-case key, and nothing points at `assistance_items`.

**So no row of a real case is deleted:**
- memberships and users are untouched;
- receipts aimed at samples remain as historical values, and the `RESET_FIXTURES` / `LOAD_CHECKPOINT` receipts stay as history;
- the client numbers the samples used leave gaps, and are never reused.

**Hosted projects:** there are none. The user checked the README and `setup.md`. The migration does the same on any database.

**Order within 040:**
1. delete the rows;
2. rewrite the functions and trigger;
3. drop the constraints and index by name;
4. drop the columns, the functions and the table;
5. recreate the origin checks.

### Q3a. No CASCADE (user rule)

No `DROP` in 040 uses `CASCADE`: not on a column, function, table or constraint. If a policy, view, constraint, index or trigger depends on something being dropped, the migration must fail until 040 rewrites or drops that dependency explicitly, by name.

**The dependencies, read from `pg_depend` on the local stack at 039:**

| Dropped | Depends on it | Handled by name in 040 |
|---|---|---|
| `cases.fixture` | index `cases_one_fixture_key`; constraints `cases_fixture_key` and `cases_origin_owner`; its own default | drop the index and both constraints first. The column's own default goes with the column. |
| `cases.fixture_key` | `cases_one_fixture_key`, `cases_fixture_key` | as above |
| `cases.origin` (kept; its check is recreated) | `cases_origin_check`, `cases_origin_owner`, and 21 RLS policies that test `origin <> 'client'` | drop and recreate only `cases_origin_check` and `cases_origin_owner`. The policies depend on the column, which stays, so they're untouched. |
| `assistance_items.fixture` | its own default | drop the column |
| `workspaces.fixture_generation` | `workspaces_fixture_generation_check`; its own default | drop the check, then the column |
| `action_receipts.generation` | none | drop the column after the two rewrites |
| `vitally_private.fixture_client_bindings` | only its own primary key and `fixture_client_bindings_fixture_key_check` | drop the table |
| function bodies (not tracked) | trigger `filing_notes_append_only`, `reserve_receipt`, `vitally_create_case`, `initialize_workspace` | rewritten before the drops. No surviving function calls a dropped one. |

No view, and no RLS policy expression, mentions `fixture`.

### Q4. The realtime signal (agreed)

- `workspaces` stays in the realtime publication, because the office's settings live there.
- With `fixture_generation` gone, the controller still re-reads on a workspace update.
- Its "a reset happened" notice goes (Q6).
- Deletions were never published, and still aren't. The publication doesn't change.

### Q5. `initialize_workspace` and `sampleCaseOwners` (agreed)

- `initialize_workspace` loses its `p_bindings` parameter. The old signature is dropped by name.
- `tools/admin/workspace-setup.mjs` stops sending the bindings, and `tools/admin/roster.mjs` stops building them.
- `roster.example.json` loses `sampleCaseOwners`.
- When an existing local roster still has `sampleCaseOwners`, the roster command **ignores it and prints one line**: "sampleCaseOwners is no longer used and was ignored.". It does not refuse the file.

### Q6. The client notice goes now (agreed)

`FIXTURES_GONE_NOTICE` is the only thing that ever sets `state.notice`, so the whole notice banner goes:
- `noticeBanner`, `state.notice`, its dismiss and its CSS;
- both "Sample cases were reset." entries in `src/client-text.mjs`, followed by `npm run build:hant` and `npm run build:hant -- --check`;
- the test "a reset somebody else ran is said plainly, and dismissed", since its code goes.

When an open case disappears, the window forgets it quietly.

### Q7. The store and the rest of the app (agreed)

- `src/supabase-store.mjs` loses the `resetFixtures` / `loadCheckpoint` wrappers, the `fixture` field on cases and help items, and `fixtureGeneration`.
- `src/contracts.mjs` loses `CHECKPOINTS`, and `fixture` from the Case shape.
- The stale "Presenter-only" comment at `src/controller.mjs:298`, deferred from #134, is fixed.

### Q8. Tests (agreed, with the user's standing rule: a test goes only if its code goes)

| Test | Its code | Fate |
|---|---|---|
| `database-fixtures.mjs` (27 tests): reset, checkpoints, sample contents, bindings, entry-point refusals, private helpers unreachable | all removed | **Remove the file.** Its properties that stay true are replaced elsewhere: "receipts outlive the fixtures they targeted" becomes **receipts outlive a deleted case** (seed re-run); "a reset removes no record that is not a fixture" is already covered by `database-seed`'s "leaves other cases alone"; "the private helpers are unreachable" is kept for the functions that remain (Q11). |
| `database-client-numbers`: "a sample reset never reuses a number" | reset gone | **replace:** "a seed re-run never reuses a number" |
| `database-client-numbers`: "a checkpoint keeps the sample" | gone | remove |
| `database-client-numbers`: "the backfill numbers submitted cases only…" | `backfill_client_numbers` dropped | remove |
| `database-contacts`: "RECORD_CONTACT refuses new requests" | live; uses a sample as setup | **convert** to a case built by actions |
| `database-contacts`: "the sample follow-up seeds a log entry" | sample seeding gone | remove |
| `database-contacts`: a direct `action_receipts` insert that sets `generation` (setup) | column gone | **convert:** the insert drops `generation` |
| `database-intake-default`: "a reset seeds version-2 samples", "ten version-2 samples whose answers pass the field checks", "each sample has its own name, language and a contact row", "a checkpoint reload clears materials and card marks" | gone | remove. One replacement: **"the seed's case answers pass the field checks"**. |
| `database-intake-default`: "the new private functions are not executable by clients" | live | **keep**, without the dropped names |
| `database-intake-v1-removed`: "a reset seeds ten version-2 samples whose submit history has no screening detail" | reset gone | **replace** with the same check on the seed's submitted client case. The `version_one_*` existence asserts go with those helpers. |
| `database-realtime`: "the shared generation signal reaches every member" | generation gone | remove |
| `database-realtime`: "a reset publishes no deletion an applicant could read" | reset gone; the rule is live | **replace:** "a seed re-run publishes no deletion an applicant could read" |
| `database-realtime`: "the production adapter draws the same line" | live; uses a reset as setup | **convert** |
| `database-shaded`: "seeded samples with a preparer questionnaire carry a shaded row" | sample seeding gone | remove; the requirement goes too (Q10) |
| `database-staff-identity`: "a staff member cannot reset sample cases or load checkpoints" | RPCs gone | remove |
| `database-store`: "the adapter resets fixtures and loads a checkpoint" | wrappers gone | remove |
| `database-actions`: two tests that list the entry points | live | **keep**, without the two dropped RPCs |
| `database-seed`: "a second run replaces the first…" | live; makes samples first | **keep**, without the sample setup |
| `store.test`: "a staff member cannot reset fixtures or load a checkpoint", "the workspace read carries the fixture generation" | gone | remove |
| `controller.test`: "a staff start reads the workspace the fixture generation lives on", "the shared generation signal refetches everything it could have replaced", "a generation signal with the open case still there keeps the selection" | live: the workspace-update re-read stays | **convert and rename** to workspace-update wording |
| `roster.test`: the `sampleCaseOwners` tests | gone | remove. **Add** "an old roster's `sampleCaseOwners` is ignored with a note". |
| `tests/support/database-fixture.mjs` helpers: `seedFixtures`, `readFixture*`, `fixtureKeys`, `boundFixtureKey`, bindings in setup | gone | remove once nothing calls them |
| browser story: the `fixture = false` and "0 fixture cases" asserts | column gone | remove those asserts; "0 cases" and the 11 seeded cases keep their meaning |

### Q8a. New tests (user additions)

1. **Catalog test**, in the database suite, after migration:
   - no function in `public` or `vitally_private` has `fixture`, `fixture_key` or `fixture_generation` in its source (`pg_proc.prosrc`), and none has `fixture` in its name;
   - no constraint definition (`pg_get_constraintdef`) and no view definition mentions `fixture`;
   - **the RLS policies per table are exactly those at 039:** 24 policies, one on each of `admin_followups`, `assistance_items`, `case_contacts`, `case_document_cards`, `case_events`, `case_materials`, `cases`, `client_events`, `contact_attempts`, `contact_log`, `contact_log_versions`, `document_requests`, `documents`, `filing_attempts`, `filing_notes`, `filing_returns`, `memberships`, `people`, `preparation_participants`, `preparer_questionnaires`, `preparer_shaded_fields`, `reviewer_questionnaires`, `reviews` and `workspaces`.

   The names are pinned too:
   - `presenter_admin_followups`, `presenter_assistance_items`, `visible_case_contacts`, `visible_case_document_cards`, `presenter_case_events`, `presenter_case_materials`;
   - `visible_cases`, `visible_client_events`, `presenter_contact_attempts`, `presenter_contact_log`, `presenter_contact_log_versions`, `visible_document_requests`;
   - `visible_documents`, `presenter_filing_attempts`, `presenter_filing_notes`, `presenter_filing_returns`, `own_membership`, `presenter_people`;
   - `presenter_preparation_participants`, `presenter_preparer_questionnaires`, `presenter_preparer_shaded_fields`, `presenter_reviewer_questionnaires`, `presenter_reviews`, `member_workspace`.

   These counts and names are read from the catalog at 039, and the catalog wins over this document. This design names no exceptions.
2. **Filing-notes tests:**
   - deleting a case that has filing notes succeeds;
   - a direct delete of one filing note is still refused;
   - a delete of one filing attempt, which would cascade to its notes, is still refused.

   Existing equivalents are kept, and only the missing ones are added.

### Q8b. Row counts on the local stack (user addition)

A read-only scratch script, not committed, uses the tooling's privileged connection.

**Before 040,** for non-sample data, it counts:
- `cases where not fixture`;
- each of the 19 case child tables plus `contact_log_versions`, joined to non-sample cases;
- `assistance_items where not fixture`.

**After 040,** it takes the same counts, all rows now being non-sample.

**Every count must match.** If one doesn't, the work stops and the user sees the numbers before anything else runs. The before/after table goes in the PR.

### Q8c. Test counts (user addition)

The PR gives, before and after:
- the unit count: 1498 on `main` `a724def`;
- the database-suite count, recorded by a `test:database` run at the start of apply.

Every removed test is listed next to the code it tested, and the converted and replaced ones are listed separately.

### Q9. What stays for #136 (agreed)

- presenter memberships and their access checks;
- `p_person_id` and the persona rule;
- the demo people, Alex, Morgan and Sam;
- the roster's `presenters`;
- the plain screen and `inert()`;
- the store's presenter read entry;
- the `presenter_*` RLS policies.

### Q10. Specs (agreed)

**REMOVED**, because they describe only the sample machinery:
- sign-in, "Sample cases and checkpoints stay presenter-only";
- client-intake's reset-seeds-version-2-samples requirement, and "The sample cases include their Form 14446 answers";
- review-and-corrections, the requirement that applying a fixture scenario clears a sample case's earlier records;
- shaded-section, the requirement that seeded samples with a preparer questionnaire carry a shaded section.

**case-lifecycle:** its scenario "WHEN the sample cases are reset" sits inside a filing requirement. A MODIFIED block can't drop a scenario, so it is reworded under the same name, or the requirement is replaced as REMOVED + ADDED, whichever keeps every other scenario.

**local-seed-data:** ADDED scenarios. A seed re-run publishes no deletion. Receipts outlive the cases a re-run deletes.

### Q11. Private functions after the change (agreed)

The private-schema revoke still covers what remains. The kept test "the new private functions are not executable by clients" checks it. There's no new grant work.

### Q12. Docs (agreed)

- `docs/setup.md`: sample cases, the reset, and `sampleCaseOwners` in the roster steps.
- `docs/developer/backend.md`: the privileged tooling, the roster format, and the reset and checkpoint paragraph.
- `docs/developer/frontend.md`: the notice banner.
- `docs/developer/README.md:162`: the line about the counter a reset moves.
- the production roadmap.

The demo script stays with #137. `docs/superpowers/` is never touched.

### Q13. Checks (agreed)

1. `npm test`;
2. `npm run db:migrate:test`, then `npm run test:database`;
3. `npm run test:browser`, plain, alone on the local stack;
4. `npm run test:auth-browser`, alone on the stack (user agreed to add it);
5. `npm run build:hant -- --check`;
6. `npx openspec validate --all`.

The row-count comparison (Q8b) runs immediately around `db:migrate:test`.

## Dependencies

- **Ready:**
  - #169: the screens are gone, and nothing in the app calls the reset;
  - #144: the seed;
  - #168: the time limit;
  - the local stack.
- **Hosted projects:** none.
- **After this change:** #136.

## Acceptance

- Migration 040 applies on the local stack, with no CASCADE.
- The row counts match before and after.
- The catalog test passes: function sources and names, constraints and views, and the RLS policy count per table.
- The filing-notes tests pass.
- The checks in Q13 pass.
- The PR has the unit and database test counts before and after, with the removed and replaced lists, and the row-count table.

## Builder check (answers recorded at propose)

1. **Policy counts:** the catalog at 039 is the authority. It has 24 policies, exactly one per table, with the names listed in Q8a. The `presenter_*` names are historical; those policies serve staff too. 21 of them depend on `cases.origin`, which stays.
2. **The seed and 040:** `tools/admin/seed-cases.mjs` and `seed-values.mjs` use none of `origin`, `new_reference` or `fixture`. The values are copied from the test fixture, not imported. Every seeded case is made by `vitally_create_case` as `client` or `assisted`, which the recreated origin checks allow. Removing the fixture helpers doesn't touch the seed.
3. **Triggers:** the only BEFORE DELETE trigger on any case child table is `filing_notes_append_only`. A cascade from a deleted case passes its "the case row is gone" branch, so 040 can delete the samples before rewriting it.
4. **The local stack's state:** at propose it held 10 sample cases and 11 non-sample cases in 3 workspaces. So 040's delete path and the row-count comparison are exercised for real.
5. **Replay protection:** live tests cover it and are kept, for example `database-contacts` "a replay returns the same receipt", plus tests in `database-assistance`, `database-intake` and `database-season-close`. Only `database-fixtures`' reset-replay tests go, with their code. No new replay test (**builder's call**).
6. **`initialize_workspace` callers:** only `tools/admin/workspace-setup.mjs` calls it. `tests/database.mjs` calls it through the API with `{}` and expects a refusal, which still holds. `tests/support/database-fixture.mjs` reaches it through `workspace-setup.mjs`.
