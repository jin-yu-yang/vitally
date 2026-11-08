## Why

Presenter mode is being removed in steps (#128). #169 removed the presenter screens, and #174 removed the sample cases. Presenter access is still in the database:
- a third membership value;
- 22 policies that admit it;
- an RPC parameter (`p_person_id`) that lets a presenter act as any demo persona;
- the Alex, Morgan and Sam people that every workspace is set up with;
- in the app, a plain screen and an `inert()` guard, kept only so a presenter's window reads nothing.

Each of these is code nobody uses that still has to be kept safe. This change (#136) removes them, so that staff, who always act as themselves, and clients are the only kinds of account. #137, the demo-script rewrite, follows.

## What Changes

**Access types**
- From: an account is a client, a presenter or a staff member.
- To: an account is a client or a staff member. The database refuses any other value.
- Reason: no presenter screens or sample cases remain to use.
- Impact: breaking for any stack that still has presenter memberships. Migration 043 deletes them, refusing if real work references them.

**The six public RPCs**
- From: each takes `p_person_id`. A presenter names a persona, and staff and clients must pass null or their own person.
- To: no person parameter. The database always resolves who is acting.
- Reason: only presenters ever needed to choose a person.
- Impact: breaking RPC contract. The app, the seed tool and the tests change with it, and the browser's requests lose `personId`.

**Presenter data on existing stacks**
- From: presenter memberships, accounts and their receipts stay.
- To: 043 deletes, in order:
  - the presenter receipts (test-run history only);
  - the presenter memberships;
  - the presenter accounts, using Supabase's own auth cascade for their sessions and tokens.
- Before deleting anything, 043 refuses to run if any case, event, document, contact or other membership references a presenter account.
- Impact: a former presenter address can no longer sign in. A window still open shows "This account has no access".

**The demonstration personas**
- From: every workspace is created with Alex, Morgan and Sam, the keys `alex`, `morgan` and `sam` are reserved, and Sam is the default follow-up person.
- To:
  - New workspaces get no personas.
  - 043 deletes each existing persona that nothing references and keeps the rest.
  - The keys are no longer reserved. A kept persona's key stays taken.
- Impact: a roster must list staff and a `defaultFollowup`. A roster that still lists `presenters` gets a note and those addresses get no access.

**Policies**
- The 22 policies that admit presenters admit staff only.
- The 16 `presenter_*` policies are renamed `staff_*`.
- After this change the database catalog mentions "presenter" nowhere.

**The browser**
- Removed:
  - the presenter's plain screen;
  - `inert()`;
  - the `testing` export;
  - the store's presenter read entry and `actingPerson`.
- An account with no membership keeps today's no-access screen. It gets its first browser-story coverage, using the existing `unapproved` account.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sign-in`:
  - two access types;
  - the RPCs take no person;
  - the roster needs staff and a default follow-up person and has no presenters or reserved keys;
  - former presenter accounts and the persona clean-up;
  - the presenter plain screen and presenter requirements are removed.
- `staff-case-work`: the persona is always the staff member's own person; staff see the rows staff see (no presenter comparison); the "no presenter controls" text is removed.
- `demo-tools`: drop the presenter scenario.
- `local-seed-data`: only if its persona scenario no longer reads true after the rewrite.

## Impact

**Database**
- New migration `supabase/migrations/043_remove_presenter_access.sql`:
  - the access check and the 22 policies;
  - `acting_person`, `check_operation_authority`, `contact_person`, `lock_case` and `lock_assistance_item`;
  - the six RPCs;
  - `initialize_workspace` and `add_staff_member`;
  - the data steps.
- New functions get explicit revokes. No `CASCADE` in our SQL. No trigger is disabled.

**App**
- `src/supabase-store.mjs`, `src/controller.mjs`, `src/views.mjs`, `src/app.mjs`, `src/language.mjs`, `src/contracts.mjs`, `src/window-state.mjs`.

**Tools**
- `tools/admin/roster.mjs`, `roster.example.json`, `workspace-setup.mjs`, `seed-cases.mjs`.

**Tests**
- The database fixture and `rpc-signatures`, and the database suites (about 103 tests converted, replaced or removed).
- Unit tests (about 92).
- The browser story (83 tests and 40 phases, unchanged in number).

**Docs**
- `README.md`, `docs/setup.md`, `docs/developer/` and `docs/design/DESIGN.md`.

**Out of scope**
- `docs/demo-script.md` (#137);
- the pool's person filter;
- dated docs;
- `docs/superpowers/`.

**The classroom project** doesn't exist yet. A new project runs every migration from scratch with no presenter accounts, so 043's deletes find nothing there.
