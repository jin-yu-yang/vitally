## Context

The database's sample-case machinery dates from the classroom design (`docs/superpowers/specs/2026-09-15-vitally-shared-demo-design.md`):
- `public.vitally_reset_fixtures` deletes and re-seeds ten sample cases and one sample help request per workspace, bumping `workspaces.fixture_generation`;
- `public.vitally_load_checkpoint` rewrites one sample case to a story point;
- the private helpers seed the rows;
- `fixture_client_bindings` gives one sample to a chosen client.

The columns `cases.fixture` / `fixture_key`, `assistance_items.fixture` and the `'fixture'` origin mark the rows.

Since #169, nothing in the app calls the reset or checkpoints, and rehearsal cases come from the seed command (#144). On the local stack at 039 there are 10 sample cases and 11 non-sample cases across 3 workspaces. There is no hosted project.

**Constraints:**
- Migrations are hand-written and final once applied, so this is a new migration, 040.
- No `CASCADE` on any `DROP`. Every dependency is dropped or rewritten by name, and the migration must fail if one is missed.
- The user's test rule: a test is removed only if its code is removed. Its other checks are converted or re-tested elsewhere.
- Fictional data only. Staff screens stay English. After any 简体 change, run `build:hant`.
- Presenter access, `p_person_id` and the persona rule stay until #136.

## Goals / Non-Goals

**Goals:**
- No function, constraint, view, column or table mentions or holds sample-case state after 040.
- The sample rows in any existing database are deleted, and no row belonging to a real (non-sample) case is deleted.
- The four live functions that read the dropped columns keep working: the filing-notes guard, receipt reservation, case creation and workspace setup.
- The browser loses the store wrappers, the fields, and the reset notice with its banner.
- Every test of removed code is removed, and every other check stays true, converted or re-tested through the seed.

**Non-Goals:**
- Presenter memberships, `p_person_id`, the persona rule, the Alex, Morgan and Sam people, the roster's `presenters`, the plain screen and `inert()`. These are #136.
- The demo script, which is #137.
- Changing the realtime publication.

## Decisions

### D1: One migration, 040, in five steps, with no CASCADE
- **Choice:** `supabase/migrations/040_remove_sample_case_tools.sql`, in this order:
  1. **Delete the demo rows:**
     - `delete from public.assistance_items where fixture or case_id in (select id from public.cases where fixture or origin='fixture')`;
     - then `delete from public.cases where fixture or origin='fixture'`.

     Every case child row cascades through the existing per-case foreign keys. The only delete trigger on a child table, `filing_notes_append_only`, lets a cascade through, because the case row is gone.
  2. **Rewrite the live functions** (D2, D3, D4).
  3. **Drop the dependent objects by name:**
     - the index `cases_one_fixture_key`;
     - the constraints `cases_fixture_key`, `cases_origin_owner`, `cases_origin_check` and `workspaces_fixture_generation_check`.
  4. **Drop, each without CASCADE:**
     - the 14 functions in D5;
     - the table `vitally_private.fixture_client_bindings`;
     - the columns `cases.fixture`, `cases.fixture_key`, `assistance_items.fixture`, `workspaces.fixture_generation` and `action_receipts.generation`.
  5. **Recreate the origin checks:**
     - `cases_origin_check` becomes `origin in ('client','assisted')`;
     - `cases_origin_owner` keeps its client and assisted branches as they are today and loses the fixture branch.

  The private-schema revoke stays in force for the functions that remain, with no grant change.
- **Why:** the user's rules. The demo rows go in the same migration that removes their machinery, and no hidden dependency can disappear through CASCADE. Deleting first means the recreated checks never meet a `'fixture'` row.
- **Alternatives considered:**
  - Keeping the rows and dropping only the functions. Rejected: the columns would stay to hold them.
  - Dropping with CASCADE. Rejected by the user.

**Every dependency on something dropped**, from `pg_depend` and the source scan at 039:

| Dropped | Depends on it | Handled in 040 |
|---|---|---|
| `cases.fixture` | index `cases_one_fixture_key`; constraints `cases_fixture_key`, `cases_origin_owner`; its own default | step 3, then step 4. The default goes with the column. |
| `cases.fixture_key` | `cases_one_fixture_key`, `cases_fixture_key` | step 3 |
| `cases.origin` (kept) | `cases_origin_check`, `cases_origin_owner`, and 21 RLS policies | the two checks are dropped (step 3) and recreated (step 5). The policies depend on the column, which stays, so they're untouched. |
| `assistance_items.fixture` | its own default | step 4 |
| `workspaces.fixture_generation` | `workspaces_fixture_generation_check`; its own default | step 3, then step 4 |
| `action_receipts.generation` | none | step 4, after D3 |
| `vitally_private.fixture_client_bindings` | its own key and `fixture_client_bindings_fixture_key_check` | step 4 |
| function bodies (not tracked by Postgres) | `filing_notes_append_only`, `reserve_receipt`, `vitally_create_case`, `initialize_workspace` | step 2. No surviving function calls a dropped one. |

No view, and no RLS policy expression, mentions `fixture`.

### D2: The filing-notes guard
- **Choice:** `vitally_private.filing_notes_append_only()` allows a `DELETE` only when the case row is gone, and refuses every other update or delete with `VT007`/VALIDATION as today. The `vitally.clearing_case` / `c.fixture` branch and its comment go. The trigger itself is unchanged.
- **Why:** dropping `cases.fixture` would otherwise make every filing-note delete fail at runtime, cascades included. Only the sample reload ever set `clearing_case`.

### D3: Receipts no longer record a generation
- **Choice:**
  - `vitally_private.reserve_receipt` stops reading `workspaces.fixture_generation` and stops writing `action_receipts.generation`.
  - `public.vitally_create_case` does the same, and stops inserting `cases.fixture`.
  - `action_receipts.generation` is dropped.
- **Why:** nothing reads it. The user confirmed that replay protection is the unique key `(workspace_id, actor_user_id, action_id)`. Live replay tests (`database-contacts`, `database-assistance`, `database-intake`, `database-season-close`) keep covering it.
- **Alternatives considered:** writing a constant 0. Rejected: it would keep a column that means nothing.

### D4: Workspace setup without bindings
- **Choice:**
  - `vitally_private.initialize_workspace(uuid, uuid[], uuid[], jsonb)` is dropped by its full signature, and `initialize_workspace(uuid, uuid[], uuid[])` is created. It does everything as today except the bindings loop and the `p_bindings` validation.
  - `tools/admin/workspace-setup.mjs` calls the new signature.
  - `tools/admin/roster.mjs` drops `sampleCaseOwners` from what it builds and validates. When an older roster still has the key, it ignores it and prints "sampleCaseOwners is no longer used and was ignored.". It does not refuse the file.
  - `tools/admin/roster.example.json` loses the key.
- **Why:** the bindings table goes, and existing local rosters keep working.

### D5: The functions dropped
`public.vitally_reset_fixtures(uuid)` and `public.vitally_load_checkpoint(uuid,uuid,bigint,text)`, plus these private functions:
- `seed_fixtures(uuid,bigint)`;
- `apply_fixture_scenario(public.cases,text,uuid)`;
- `checkpoint_scenario(text)`;
- `fixture_keys()`;
- `fixture_answers_v2(text)`;
- `fixture_contact_v2(text)`;
- `fixture_history(text)`;
- `new_reference()`;
- `backfill_client_numbers(uuid)`, a one-time backfill from 010;
- `version_one_blockers()`, `version_one_blocks(smallint,boolean,boolean)` and `version_one_disposable(smallint,boolean,boolean)`, obsolete cleanup helpers from 023.

Each is dropped by its full signature.

### D6: The browser and the store
- **Choice:**
  - `src/supabase-store.mjs` loses the `resetFixtures` / `loadCheckpoint` wrappers, `fixture` on cases and help items, and `fixtureGeneration`.
  - `src/contracts.mjs` loses `CHECKPOINTS` and `fixture` from the Case shape.
  - `src/controller.mjs` loses `FIXTURES_GONE_NOTICE`, `state.notice` and its dismiss. A workspace update still re-reads the lists and the workspace. An open case that has gone is forgotten quietly. The stale "Presenter-only" comment at line ~298 is fixed.
  - `src/views.mjs` loses `noticeBanner`, and `src/styles.css` loses its rule.
  - `src/client-text.mjs` loses "Sample cases were reset." and "Sample cases were reset. The one you had open is no longer there.". Then `npm run build:hant` regenerates `src/zh-hant.mjs`, and `npm run build:hant -- --check` passes.
  - The `workspaces` realtime publication is unchanged.
- **Why:** the reset was the only thing that ever set the notice.

### D7: Tests
- **Choice:**
  - Each test is handled as brainstorm Q8 lists it: removed only when its code is removed, otherwise converted, or replaced through the seed.
  - `tests/database-fixtures.mjs` is removed. The `tests/support/database-fixture.mjs` sample helpers go once nothing calls them. `tests/support/rpc-signatures.mjs` drops the two RPCs.
  - **New database tests:**
    - **The catalog test (`tests/database-catalog.mjs`):**
      - no function in `public` or `vitally_private` has `fixture`, `fixture_key` or `fixture_generation` in its source, and none has `fixture` in its name;
      - no constraint definition (`pg_get_constraintdef`) and no view definition mentions `fixture`;
      - the RLS policies are exactly the 24 at 039, one per table, by table and name (brainstorm Q8a);
      - the origin checks allow `client` and `assisted` only.
    - **The filing-notes rules:**
      - deleting a case with filing notes succeeds;
      - a direct delete of one filing note is refused;
      - a delete of one filing attempt is refused.
    - **Seed-based replacements:**
      - a seed re-run never reuses a client number;
      - a seed re-run publishes no deletion an applicant could read;
      - receipts outlive the cases a re-run deletes;
      - the seed's answers pass the field checks;
      - the seed's submitted client case has no screening detail in its submit history.
  - **New unit test:** an old roster's `sampleCaseOwners` is ignored with the note.
- **Why:** the user's standing rule, and their additions.

### D8: Evidence for the PR
- **Choice:**
  - **A read-only scratch script** (not committed), using the tooling's privileged connection, records counts right before `npm run db:migrate:test` applies 040 on the local stack:
    - `cases where not fixture`;
    - each of the 19 case child tables plus `contact_log_versions`, joined to non-sample cases;
    - `assistance_items where not fixture`.

    It records them again right after, when every row is non-sample. Every count must match. If one doesn't, the work stops and the user sees the numbers before anything else runs.
  - **The PR carries:**
    - the row-count table;
    - the unit count before (1498) and after;
    - the database-suite count before, from a `test:database` run at the start of apply, and after;
    - every removed test next to the code it tested;
    - the converted and replaced tests, listed separately.
- **Why:** the user's additions.

### D9: Specs
- **Choice:**
  - **REMOVED:**
    - sign-in, "Sample cases and checkpoints stay presenter-only";
    - client-intake, "Sample cases are version 2";
    - review-and-corrections, "Sample cases carry fictional answers";
    - shaded-section, "Sample cases carry a fictional shaded section".
  - **client-intake, "The sample cases include their Form 14446 answers":** REMOVED. Its live rules and both live scenarios, "Regenerate keeps the consent" and "Fill leaves the consent to the client", move unchanged to an ADDED requirement, "Fictional details leave the client's 14446 answers alone".
  - **case-lifecycle, "Admins record each return's filing result":** MODIFIED. Its scenario "A note goes with its sample" keeps its name and now describes a note removed with its case when a seed re-run deletes that case. "(non-sample)" drops from "A note can't be changed". Every other scenario is unchanged.
  - **local-seed-data:** ADDED, "A seed re-run publishes no deletion and keeps receipts".
- **Why:** specs change only where behaviour changes. A MODIFIED block can't drop a scenario.

## Risks / Trade-offs

- [Risk] **A function body reads a dropped column, and Postgres doesn't notice.** → Mitigation: the source scan (catalog test) fails on any mention. D2–D4 rewrite the known four, found by the same scan at 039.
- [Risk] **Deleting the sample cases deletes a real case's rows.** → Mitigation: every case child foreign key is per-case, and the before/after row counts on the local stack must match. The work stops if they don't.
- [Risk] **A dependency is missed and dropped silently.** → Mitigation: no CASCADE, so 040 fails instead. The catalog test also pins the 24 policies by table and name.
- [Trade-off] **The demo rows can't come back after 040.** → Accepted: they're fictional, the seed replaces them, and there's no hosted project.
- [Trade-off] **The receipts for removed samples stay** as orphaned historical rows. → Accepted: the original design requires receipts to outlive their targets.
- [Trade-off] **Client numbers the samples used leave gaps.** → Accepted: numbers are never reused.

## Migration Plan

**On the local stack:**
1. Run `test:database` at the branch base, for the baseline count.
2. Take the before counts.
3. Run `npm run db:migrate:test`, which applies 040.
4. Take the after counts and compare them. Stop on any difference.
5. Run `test:database`, then `test:browser` and `test:auth-browser`, each alone.

**Rollback:** the schema can only be restored by a new migration. The deleted sample rows can't be restored, and that is accepted (fictional data). If 040 fails partway, the whole migration rolls back as one transaction.

**Acceptance:** the checks in brainstorm Q13, the matching counts, and the PR evidence in D8.

## Open Questions

- (none)
