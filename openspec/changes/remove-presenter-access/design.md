## Context

ViTally has three kinds of membership: `applicant`, `presenter` and `staff`.

**What still serves presenters.** #169 removed the presenter's screens and #174 removed the sample cases. A presenter is still:
- admitted by 22 of the 24 RLS policies;
- resolved by `vitally_private.acting_person`, which lets it name any unlinked persona through `p_person_id` on the six public RPCs;
- given workspaces that `initialize_workspace` creates with three personas (Alex, Morgan and Sam, where Sam is the default follow-up person).

In the browser, a presenter account gets a plain screen. `inert()` stops its window from loading, subscribing or retrying, and the store keeps a presenter read entry.

**State observed on the user's local stack** (migrated to 040; read-only, 2026-11-07; main's 041 (#176) is not yet applied there, and #172's 042 merges to main before this change):

| What | Count |
|---|---|
| presenter memberships (one account each, no other membership) | 2 |
| presenter receipts | 82, of which 52 name Sam as the actor |
| rows in the eight refusal columns that point at a presenter | 0 |
| persona rows referenced by anything other than presenter receipts | 1 (Sam in workspace `d3c53ee2`, as its default follow-up) |

These numbers are illustrative. Apply re-takes them all.

**Constraints from the project and the user:**
- Applied migrations are never edited; this is 043.
- No `CASCADE` in our SQL.
- Every new function gets an explicit revoke.
- No test is removed while its code survives.
- No test disables a trigger.
- The user's stack is never reset. Its row counts are taken before and after, and the difference must equal the expected one.
- Test counts are reported before and after, from the runners.

## Goals / Non-Goals

**Goals:**
- After 043, `presenter` appears nowhere in the database catalog, and nowhere in `src`, `tools` or `tests`.
- Staff always act as their own person and clients as no person, with no way for a request to name one.
- Existing stacks lose presenter accounts, their test-run receipts and every persona nothing references. Any history that still references them stays.
- Every check that guarded presenter behaviour is converted, or replaced by a check on the same property for an account with no membership.

**Non-Goals:**
- Rewriting the demo script (#137).
- Filtering kept personas out of the pool's "Prepared by" / "Reviewed by" options.
- Changing "persona" wording in specs where it already means the staff member's own person.
- Editing dated docs, `docs/superpowers/`, or the user's local roster file.
- Running 043 on the classroom project.

## Decisions

### D1: The access value goes through the check constraint, not just the code
- **Choice:** delete presenter memberships, then drop and re-add `memberships_access_check` by name with `applicant` and `staff` only.
- **Why:** once the constraint is in, no presenter state can exist. That lets the browser, the store and the policies drop their presenter branches instead of guarding them.
- **Alternative considered:** leaving the value allowed but unused. Rejected, because every presenter branch would have to stay and be tested.

### D2: Change the policies in place and rename them
- **Choice:** 22 × `ALTER POLICY … USING (… m.access = 'staff' …)`, keeping each expression's other branches, then 16 × `ALTER POLICY presenter_<t> ON <t> RENAME TO staff_<t>`. This is a user ruling.
- **Why:** there is no DROP, so nothing depends on recreating the policies. Renaming takes the last catalog mention of presenter.
- **Alternative considered:** drop and recreate. Rejected as a larger, riskier statement set for the same result.

### D3: The RPCs lose `p_person_id`, and the database resolves the actor
- **Choice:**
  - A new `vitally_private.acting_person(memberships)`: staff gets their linked person, otherwise FORBIDDEN; an applicant gets null; anything else is FORBIDDEN.
  - The six RPCs are recreated with the person parameter removed (signatures in brainstorm Q2).
  - Old signatures and `acting_person(memberships, uuid)` are dropped by name.
  - Every new function gets `revoke all … from public, anon, authenticated, service_role`. The six RPCs then get `grant execute … to authenticated`.
  - The four helpers that test presenter keep their signatures and are changed with `CREATE OR REPLACE`.
  - The request digest keeps its `'personId'` key, filled with the resolved person, so receipts stored before 043 replay identically.
- **Why:** only presenters ever chose a person. Removing the parameter means no request can claim another person. A call that still sends `p_person_id` matches no function and writes nothing.
- **Alternative considered:** keep the parameter and require null. Rejected, because it keeps a contract that has no use.
- **Browser (user ruling):** `personId` goes from every request and from the Action shape in `src/contracts.mjs`.

### D4: 043's data steps refuse rather than guess
- **Choice:** in this order, all in 043's single transaction:
  1. **Refuse** with SQLSTATE `VT008`, giving per-table counts, if a presenter account is referenced by:
     - `cases.owner_user_id`, `case_events.actor_user_id`, `documents.submitted_by_user_id`, `contact_attempts.actor_user_id`, `contact_log.logged_by_user_id`, `contact_log_versions.edited_by_user_id`, `people.user_id` or `cases.created_by_user_id`;
     - any other membership of that account (builder's call; see the builder check in brainstorm.md).
  2. Delete presenter receipts (user ruling: test-run history).
  3. Delete presenter memberships.
  4. Delete those `auth.users` rows. Supabase's own auth foreign keys cascade to identities, sessions, tokens, factors, OAuth and WebAuthn rows; the user ruled this acceptable.
  5. Delete unreferenced personas (D5).
  6. Re-add the constraint (D1).
- **Why:** NO ACTION foreign keys would otherwise fail with an unexplained error, and the user ruled out a ban path. Refusing leaves a stack with real presenter history unchanged, for its owner to decide.
- **Alternatives considered:**
  - Ban referenced accounts: rejected by the user.
  - Repoint the referencing rows: rejected, because it rewrites history.
  - Delete accounts through the admin API: rejected, because the delete would no longer be atomic with the migration.
- **Verification:** a database test can't reach the refusal, because past 043 the constraint forbids the state it needs, and a callable presenter-aware function is forbidden. It is verified once on a throwaway database (user ruling).
- **Error code:** `VT008`, the next code after `VT001`–`VT007`, not tied to a migration number.
- **Readability:** `migrate.mjs` prints only the SQLSTATE, so `docs/setup.md` documents what `VT008` means and gives a read-only query that shows the counts.

### D5: Personas are deleted only when nothing references them
- **Choice (user ruling, option (b)):** delete each `people` row with `person_key in ('alex','morgan','sam') and user_id is null` that has no reference. A reference is any foreign-key column that points at `people`, derived from `pg_constraint` when 043 runs, or `action_receipts.actor_person_id`, which has no foreign key. Rows that are referenced are kept.
- **Why:** this cleans up stacks without ever failing on a teammate's stack where a persona acted on a hand-made case. Deriving the columns means a missed column can't make the delete fail, or lose a row that is still referenced.
- **Alternatives considered:**
  - Keep all personas: the user's first ruling, changed once the receipts were going.
  - Delete all personas: rejected, because it would break references.

### D6: Workspace setup creates no personas, and the reserved keys go
- **Choice:**
  - `initialize_workspace(p_workspace_id uuid, p_applicants uuid[])` replaces the three-argument form, which is dropped by name. The new form is revoked from every client role, with no grant.
  - It creates no personas and drops the "exactly three unlinked people" check. A new workspace's default follow-up stays null until `set_default_followup` runs in the same transaction.
  - `add_staff_member` (with `CREATE OR REPLACE`) and `roster.mjs` stop reserving `alex`, `morgan` and `sam`. `add_staff_member` is copied from #172's migration 042, its newest definition, and keeps #172's refusal of `followup` without `admin`.
- **Why:** `add_staff_member` already refuses a key held by anyone other than exactly that staff member. A kept persona's key stays unusable in its workspace, and a freed key gets a new person id.
- **Trade-off:** the roster can't warn about a kept persona's key before creating accounts.

### D7: The roster always needs staff and a default follow-up person
- **Choice:**
  - `parseRoster` requires at least one staff entry and `defaultFollowup`.
  - A roster that still lists `presenters` is accepted, with the note "presenters is no longer used and was ignored; those addresses get no access." This is a user ruling, alongside the existing `sampleCaseOwners` note.
  - `roster.example.json` drops `presenters`.

### D8: The no-access screen replaces the plain screen
- **Choice:** remove `presenterScreen`, the bare-frame `page()` branch, the presenter `viewLang` branch, `inert()` with its call sites and the `testing` export, `SUBSCRIBED_TABLES.presenter` and the presenter half of `isStaffAccess`.
- **What a former presenter sees:**
  - A deleted address gets `otp_disabled`, which the app already shows as an unknown address.
  - An open session finds no membership and gets `noAccessScreen`, which returns before any load or subscription.
- **Tests:** the presenter tests are replaced by the same checks for an account with no membership.
  - `refresh()` legitimately repeats `getPrincipal` on focus, online and Try again, so the tests allow only that call.
  - The browser story uses the fixture's `unapproved` actor.

### D9: Test fates follow the user's removal rule
A test is removed only when its code is gone, named and shown by grep. Otherwise it is converted or replaced. The per-test table is in brainstorm Q8 and Q9.

| Suite | Remove | Replace | Convert |
|---|---|---|---|
| Database | 2 | 11, collapsing into fewer new tests | ~90 |
| Unit | 2 | 9 | the rest |
| Browser | 0 | 5 sections | — |

**New tests:**
- database: the catalog has no presenter mention; exact signatures and ACLs; old signatures gone; freed and kept persona keys;
- unit: `noAccessScreen`.

## Risks / Trade-offs

- **[Risk] The refusal fires on the user's stack because the user created presenter-referenced rows after the brainstorm** → Mitigation: the before-count script checks the refusal condition first. If it isn't zero, apply stops before 043 runs and shows the user.
- **[Risk] 043 on the classroom project** → None to decide now. The classroom project doesn't exist yet. A new project runs every migration from scratch with no presenter accounts, so 043's refusal check and deletes find nothing there.
- **[Risk] The persona delete misses a reference column** → Mitigation: the columns are derived from `pg_constraint` when 043 runs, and every reference is NO ACTION, so a miss would make 043 fail rather than lose data.
- **[Risk] The Action shape change breaks a stored or replayed browser request** → Mitigation: requests are built per action and not persisted across versions. The digest is computed in the database from resolved values.
- **[Risk] Renaming policies breaks a test that pins names** → Mitigation: the catalog test is converted to the new names in the same task as 043.
- **[Trade-off] Kept personas still appear in the pool's person filter on older stacks** → Accepted. This is out of scope, and only stacks with real persona history have them.
- **[Trade-off] `migrate.mjs` shows only `VT008`** → Accepted. The fix is documented, and `migrate.mjs` stays unchanged.

## Migration Plan

1. In the change's worktree, write 043 and convert the fixture and tests. Run `npm run db:migrate:test` and the database suite on the test stack.
2. Verify the refusal once on a throwaway database:
   1. restore a copy at 040, and apply main's 041 and 042;
   2. seed a referenced presenter;
   3. confirm 043 fails with `VT008` and the counts, and that the row counts are unchanged;
   4. remove the reference and confirm 043 succeeds.
3. On the user's stack:
   1. tell the user before-counts are starting;
   2. run the refusal pre-check; if it isn't zero, stop;
   3. take a verified backup and restore check;
   4. take the read-only before-counts;
   5. apply 043;
   6. take the after-counts;
   7. compare against the expected differences (brainstorm Q13). Any other difference stops the work.
4. Run every check in brainstorm Q14, and record test counts before and after.
5. **Rollback:** restore the verified backup. 043 is final once applied anywhere; any fix is a new migration.

## Open Questions

- **Whether `local-seed-data`'s "default is still a persona" scenario still reads true.** Owner: the builder, at the specs step. It affects only whether that capability gets a delta.
