## Why

The database still carries the classroom's sample-case machinery: a reset that rebuilds ten sample cases and a help request, checkpoints that put a sample back at a story point, client bindings, and the columns and private helpers behind them. Since #169 nothing in the app calls any of it. Rehearsal cases come from the seed (#144). Keeping it means dead code in every function that still reads a `fixture` column, and demo rows in every workspace. This change removes it (#135), so that #136 can remove presenter access next.

## What Changes

**The database (new migration 040)**
- From:
  - `vitally_reset_fixtures`, `vitally_load_checkpoint` and 12 private helpers;
  - `cases.fixture` and `cases.fixture_key`, `assistance_items.fixture`, `workspaces.fixture_generation`, `action_receipts.generation`;
  - the `fixture_client_bindings` table;
  - `'fixture'` as a case origin;
  - ten sample cases and one sample help request in each workspace that ran a reset.
- To:
  - all of these dropped, and the existing sample rows deleted;
  - four live functions rewritten so they no longer read the dropped columns: the filing-notes guard, `reserve_receipt`, `vitally_create_case`, and `initialize_workspace` (which loses its bindings parameter);
  - no `CASCADE` anywhere, with every dependency dropped or rewritten by name.
- Reason: nothing uses these any more, and they keep demo state in every workspace.
- Impact:
  - breaking for anything that called the two RPCs or `initialize_workspace` with bindings. Only the tools and tests do, and they change here;
  - no row of a real (non-sample) case is deleted;
  - no hosted project exists.

**The roster**
- From: `sampleCaseOwners` binds a sample case to a client.
- To: gone from the example roster and the command. An old local roster that still has it is accepted, and the command prints "sampleCaseOwners is no longer used and was ignored.".

**The browser**
- From: the store wraps the reset and checkpoint RPCs, reads `fixture` and `fixtureGeneration`, and a client sees "Sample cases were reset." when a reset removes their open case.
- To: the wrappers, the fields, the notice banner and its two client-text entries are gone. A window still re-reads when its workspace changes.

**Tests and docs**
- Tests of removed code are removed. Tests that used samples only as setup are converted. The properties that stay true are re-tested through the seed.
- New database tests:
  - a catalog check that no function, constraint or view mentions `fixture`, and that every table keeps its RLS policies;
  - filing-note delete rules.
- Docs: `docs/setup.md`, the developer docs and the roadmap.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `sign-in`: the requirement that the reset and checkpoints stay presenter-only is removed, and the staff-only-workspace requirement drops its sentence pointing at it.
- `client-intake`:
  - the sample-cases-are-version-2 requirement is removed;
  - the Form 14446 sample requirement is replaced by one that keeps only its live rule, that regenerating fictional details keeps the client's own 14446 answers.
- `review-and-corrections`: the requirement that samples carry fictional answers is removed.
- `shaded-section`: the requirement that samples carry a shaded section is removed.
- `case-lifecycle`:
  - the filing-result requirement's scenario "A note goes with its sample" now describes a note going with its deleted case;
  - the screening-checks scenario "The online sample" now describes the seed's cases: phone, documents and in_scope, plus identity for an online case.
- `local-seed-data`: a seed re-run publishes no deletion, receipts outlive the cases it deletes, and a re-run in the same season never reuses a client number.

## Impact

- **Database:** a new `supabase/migrations/040_remove_sample_case_tools.sql`. No applied migration is edited.
- **Code:**
  - `src/supabase-store.mjs`, `src/controller.mjs`, `src/views.mjs`, `src/contracts.mjs`, `src/client-text.mjs`, `src/zh-hant.mjs` and `src/styles.css`;
  - `tools/admin/roster.mjs`, `tools/admin/workspace-setup.mjs` and `tools/admin/roster.example.json`.
- **Tests:**
  - `tests/database-fixtures.mjs` is removed;
  - eleven other database suites, `tests/support/database-fixture.mjs` and `tests/support/rpc-signatures.mjs` change;
  - `tests/store.test.mjs`, `tests/controller.test.mjs`, `tests/shell.test.mjs`, `tests/roster.test.mjs` and `tests/browser.mjs` change;
  - a new catalog test is added.
- **Checks:**
  - `npm test`;
  - `npm run db:migrate:test` then `npm run test:database`, with a before/after row-count comparison of non-sample data around the migration;
  - `npm run test:browser` and `npm run test:auth-browser`, each alone on the stack;
  - `npm run build:hant -- --check`;
  - `npx openspec validate --all`.
- **Issue:** #135, part of tracking issue #128. Settles #58's sample-case rows.
