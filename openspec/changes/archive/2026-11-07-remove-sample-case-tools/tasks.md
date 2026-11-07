## 1. Baselines

- [x] 1.1 Record the unit count (`npm test`, `ℹ tests`) and the database-suite count (`npm run test:database` alone on the stack, `ℹ tests`) at the branch base, for the PR.

## 2. Migration 040

- [x] 2.1 Write the read-only scratch row-count script (design D8), not committed. Run it on the local stack before 040, and keep the output.
- [x] 2.2 Write `supabase/migrations/040_remove_sample_case_tools.sql` in design D1's five steps:
  - delete the demo rows;
  - rewrite `filing_notes_append_only`, `reserve_receipt`, `vitally_create_case` and `initialize_workspace` (D2–D4);
  - drop `cases_one_fixture_key`, `cases_fixture_key`, `cases_origin_owner`, `cases_origin_check` and `workspaces_fixture_generation_check` by name;
  - drop the 14 functions (D5), the bindings table and the five columns, with no CASCADE anywhere;
  - recreate the origin checks.
- [x] 2.3 Run `npm run db:migrate:test`, then the row-count script again. Every count must match. If one doesn't, stop and show the user.

## 3. Database tests

- [x] 3.1 Add `tests/database-catalog.mjs`:
  - no function source or name mentions fixture, and no constraint or view definition does;
  - the 24 RLS policies are pinned by table and name;
  - the origin checks allow `client` and `assisted` only.
- [x] 3.2 Add the filing-notes delete tests, keeping any existing equivalent:
  - a case delete succeeds;
  - a direct note delete is refused;
  - a filing-attempt delete is refused.
- [x] 3.3 Remove `tests/database-fixtures.mjs`. Remove, convert or replace every other database test as brainstorm Q8 lists, including the seed-based replacements in design D7.
- [x] 3.4 Remove the sample helpers from `tests/support/database-fixture.mjs`. Drop the two RPCs from `tests/support/rpc-signatures.mjs`. Update the fixture's workspace setup for the new `initialize_workspace` signature.
- [x] 3.5 Run `npm run test:database`, all passing. Record the count after, with the lists of removed, converted and replaced tests.

## 4. Tools and roster

- [x] 4.1 `tools/admin/workspace-setup.mjs` calls `initialize_workspace(uuid, uuid[], uuid[])`.
- [x] 4.2 `tools/admin/roster.mjs` drops `sampleCaseOwners`, and ignores it with the note "sampleCaseOwners is no longer used and was ignored.". `tools/admin/roster.example.json` loses the key. Update `tests/roster.test.mjs`: remove the `sampleCaseOwners` tests and add "an old roster's `sampleCaseOwners` is ignored with a note".

## 5. The browser

- [x] 5.1 `src/supabase-store.mjs` loses the reset and checkpoint wrappers, `fixture` on cases and help items, and `fixtureGeneration`. `src/contracts.mjs` loses `CHECKPOINTS` and `fixture`.
- [x] 5.2 `src/controller.mjs` loses `FIXTURES_GONE_NOTICE`, `state.notice` and its dismiss; the workspace-update re-read stays. Fix the stale "Presenter-only" comment. `src/views.mjs` loses `noticeBanner`, and `src/styles.css` loses its rule.
- [x] 5.3 `src/client-text.mjs` loses both "Sample cases were reset." entries. Run `npm run build:hant`, then `npm run build:hant -- --check`, and commit `src/zh-hant.mjs`.
- [x] 5.4 Unit tests:
  - remove the tests of removed code, including "a reset somebody else ran is said plainly, and dismissed" and the two `store.test` tests;
  - convert and rename the three `controller.test` workspace-update tests;
  - record the removed and converted lists.
- [x] 5.5 Browser story: remove the `fixture = false` and "0 fixture cases" asserts, whose column is gone.

## 6. Docs

- [x] 6.1 Update:
  - `docs/setup.md`;
  - `docs/developer/backend.md`;
  - `docs/developer/frontend.md`;
  - `docs/developer/README.md` (line ~162);
  - `docs/developer/production-roadmap.md`.

  Remove the sample cases, the reset, the checkpoints and `sampleCaseOwners`, and mark the roadmap's sample-case parts done in #135.

## 7. Verification

- [x] 7.1 `npm test` passes. Record the count after.
- [x] 7.2 `npm run test:database` passes. Record the count after.
- [x] 7.3 `npm run test:browser`, plain, alone on the local stack: 83/83.
- [x] 7.4 `npm run test:auth-browser`, alone on the stack: all pass.
- [x] 7.5 `npm run build:hant -- --check` passes.
- [x] 7.6 `npx openspec validate --all` passes.
