# Clearance Uploads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rostered volunteer can open the upload link and say their Form 13615 or photo ID was sent. Workspace admins see what is waiting, filter to it, and clear it. `vitally_my_clearance()` returns no capabilities to an uncleared caller (#193 item 7).

**Architecture:**
- **Database:** migration 053 adds two sent-date columns on `roster_entries`, a caller-only RPC that sets them, and an admin RPC that clears them. It also gives new bodies to `vitally_my_clearance()` (with `sentAt`, `uploadUrl` and empty capabilities when uncleared) and `vitally_save_volunteer` (which clears the dates when it acts on them).
- **App:** the setup screen, the Roster (row text, a Show filter, drawer lines with Mark reviewed) and the admin sidebar read the dates. The Roster reads them through the existing admin-only table reads. The sidebar uses a head count read on the existing refresh points. There is no new realtime table.

**Tech Stack:** Postgres/Supabase (hand-written SQL migration, plpgsql security-definer RPCs), plain ES modules (`src/*.mjs`), `node:test` unit tests, the database suites against the local stack, and Playwright (`tests/browser.mjs`).

**Spec:** `openspec/changes/add-clearance-uploads/`:
- `design.md` (D1–D9);
- `brainstorm.md` (the agreed decisions Q1–Q9, and the calls C1–C8);
- `specs/volunteer-clearance/spec.md`, `specs/volunteer-roster/spec.md` and `specs/season-settings/spec.md`.

Executors read the design and the specs alongside this plan.

## Global Constraints

- **Migrations:** `supabase/migrations/053_clearance_uploads.sql` is new and hand-written. Never edit 045–052. Copy the function bodies from 052 and mark each changed line with `-- 053`.
- **Function signatures** (exact):
  - `vitally_mark_upload_sent(p_action_id uuid, p_document text)`;
  - `vitally_mark_upload_reviewed(p_action_id uuid, p_volunteer_id uuid, p_expected_revision bigint, p_document text)`.
- **Values:**
  - Documents are exactly `'form13615'` and `'photoId'`.
  - Receipt operations are `'MARK_UPLOAD_SENT'` and `'MARK_UPLOAD_REVIEWED'`.
  - Refusal details are `NO_ROSTER_ENTRY` and `PHOTO_ID_NOT_NEEDED` (both `VT007 VALIDATION`).
- **Privileges:** each new function gets `revoke all … from public,anon,authenticated,service_role;` and then `grant execute … to authenticated;`.
- **Staff text, English only (exact):**
  - "I've uploaded it"
  - "Upload"
  - "Ask your site coordinator how to send it."
  - "Waiting for review · sent <date>"
  - "Form 13615 to review"
  - "Photo ID to review"
  - "Show", "Everyone", "Uploads to review"
  - "Form 13615 sent <date>"
  - "Photo ID sent <date>"
  - "Mark reviewed"
  - "Volunteers · <n>", with aria-label "Volunteers, <n> uploads to review", singular at 1: "Volunteers, 1 upload to review"
- **Dates:** `<date>` is New York time, `{ month: "short", day: "numeric" }` (for example "Nov 20"), as in `src/update-views.mjs` `DAY`.
- **Data:** fictional data only. Tests stay in their own workspace and never assert on other workspaces' rows.
- **Machine memory:** about 1 GB free. Run the database suite at concurrency 1, run no full local `npm run test:browser`, stop stacks when done, and kill orphaned test runners. Every command gets a timeout. Never run a foreground dev server.
- **Git:** never `supabase start` from the repo root (the stack is in `$VITALLY_STACK`). Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A lost answer, or a double press on I've uploaded it.**
   - Expected: the button is disabled while busy, and a retry after an unknown outcome reuses the same action id, so one send is recorded.
   - Test: Task 5 Step 1 `retries a lost send with the same action id`.
2. **A sent date late in the evening in New York.**
   - `2026-11-21T03:30:00Z` must show "Nov 20", not "Nov 21".
   - Test: Task 5 Step 1 `shows the New York day` and Task 6 Step 1 `drawer date is the New York day`.
3. **The season changes.**
   - An earlier season's entry with a sent date must not appear in the clearance, the Roster or the count.
   - Test: Task 1 Step 1 `a past season's sent date is not reported` and Task 7 Step 1 `the count ignores other seasons` (database part in Task 3).
4. **The admin presses Mark reviewed with typed but unsaved drawer edits.**
   - The edits must survive the redraw, and the later Save must not conflict.
   - Test: Task 6 Step 5 `Mark reviewed keeps the drawer's unsaved edits`.
5. **An upload link with characters that need escaping** (`&`, `"`).
   - The link must open as is, and the attribute must not break.
   - Test: Task 5 Step 1 `escapes the upload link`.

---

### Task 1: 053: the columns and the new clearance answer

**Files:**
- Create: `supabase/migrations/053_clearance_uploads.sql`
- Create: `tests/database-clearance-uploads.mjs`
- Modify: `tests/database-clearance.mjs` (the `vitally_my_clearance` block, about lines 981–1110)

**Interfaces:**
- Produces:
  - the columns `roster_entries.form_13615_sent_at timestamptz` and `roster_entries.photo_id_sent_at timestamptz`, both nullable with no default;
  - a `vitally_my_clearance()` answer with every 052 key, plus `uploadUrl: string|null`. A `form13615` or `photoId` item is now `{kind, sentAt: string|null}`, and `capabilities` is `[]` when `cleared` is false.

- [ ] **Step 1: Write the failing tests** in `tests/database-clearance-uploads.mjs`.
  - Use the same imports and fixture shape as `tests/database-clearance.mjs`: `createDatabaseFixture`, a `myClearance(client)` helper that calls `client.rpc("vitally_my_clearance")`, `f.staff({key, name, capabilities, cleared})`, and `f.sql`.
  - Set the link with `f.sql("insert into public.season_settings(workspace_id,certificate_upload_url) values($1,$2) on conflict(workspace_id) do update set certificate_upload_url=excluded.certificate_upload_url", [f.workspaceId, "https://example.org/certificates"])`. Restore null in a `finally`.
  - Put the tests under `test("vitally_my_clearance uploads against real Supabase", …)`:
    - `an uncleared volunteer's items carry a null sentAt`: a staff member with no roles gets `missing` deepEqual `[{ kind: "form13615", sentAt: null }]`.
    - `a set sent date is reported`: set `form_13615_sent_at` with `f.sql`, and the item's `sentAt` parses to that instant.
    - `uploadUrl is the certificate link for a rostered caller`: equals `"https://example.org/certificates"` for both a cleared Preparer and the uncleared member.
    - `uploadUrl is null with no link`: after setting the link to null.
    - `uploadUrl is null with no current-season entry`: delete the member's current-season entry in a transaction, read, then roll back.
    - `roles but not cleared reports no capabilities`: Preparer with certificates, `is_new=true`, no photo check, so `cleared` false, `missing` `[{kind:"photoId",sentAt:null}]` and `capabilities` `[]`.
    - `a past season's sent date is not reported`: insert an entry for `current_season - 1` with `form_13615_sent_at=now()`, and the answer's `sentAt` is still null.
- [ ] **Step 2: Update the existing shape assertions** in `tests/database-clearance.mjs`.
  - Every exact `missing` deepEqual on a `form13615` or `photoId` item gains `sentAt: null`.
  - The key list assertion (about line 1025) gains `"uploadUrl"` in sorted position.
  - Convert the test `a new volunteer without a photo ID check is not cleared`: the `unchecked` half asserts `assert.deepEqual(unchecked.capabilities, [])`, with the comment `// Not cleared: no capabilities (#193 item 7), whatever the roles.`. The `checked` half still asserts `["prepare"]`. Do not delete the test.
- [ ] **Step 3: Confirm that no uncleared path reads capabilities.** Run `git grep -n "clearance\.capabilities\|clearance?.capabilities\|withOwnCapabilities\|sameStanding" src`. Expected: only `src/clearance.mjs` `withOwnCapabilities` and `src/controller.mjs`'s uses (`recheckClearance`, `sameStanding`, lines about 1162 and 2097). If any other reader appears, stop and report it.
- [ ] **Step 4: Run the tests to verify they fail.**
  - Run: `npm run db:migrate:test`, then `node --env-file=.env.test --test --test-concurrency=1 tests/database-clearance-uploads.mjs tests/database-clearance.mjs` (timeout 15 min).
  - Expected: FAIL on `sentAt`, `uploadUrl` and the capabilities assertions.
- [ ] **Step 5: Write 053 §1–§2.**
  - §1: `alter table public.roster_entries add column form_13615_sent_at timestamptz, add column photo_id_sent_at timestamptz;`
  - §2: `create or replace function public.vitally_my_clearance()`, copied from 052 lines 262–319, with these changes marked `-- 053`:
    - the `form13615` item is built with `'sentAt',v_entry.form_13615_sent_at`, and the `photoId` item with `'sentAt',v_entry.photo_id_sent_at` (null when there is no entry);
    - `'capabilities'` is `case when v_cleared then to_jsonb(effective_capabilities(...)) else '[]'::jsonb end`, with `v_cleared` computed once from `vitally_private.cleared`;
    - `'uploadUrl'` is `(select s.certificate_upload_url from public.season_settings s where s.workspace_id=v_person.workspace_id)` when `v_entry.person_id is not null`, else null.
  - Keep the revoke and grant.
- [ ] **Step 6: Run the tests to verify they pass.** Run the Step 4 commands. Expected: PASS.
- [ ] **Step 7: Commit.**

```bash
git add supabase/migrations/053_clearance_uploads.sql tests/database-clearance-uploads.mjs tests/database-clearance.mjs
git commit -m "053: sent dates on roster entries; clearance answer gains sentAt and uploadUrl, no capabilities when uncleared (#193 item 7)"
```

### Task 2: 053: `vitally_mark_upload_sent`

**Files:**
- Modify: `supabase/migrations/053_clearance_uploads.sql` (§3)
- Test: `tests/database-clearance-uploads.mjs`

**Interfaces:**
- Consumes: Task 1's columns.
- Produces: `vitally_mark_upload_sent(p_action_id uuid, p_document text) returns jsonb` → `{actionId, document, sentAt}`.

- [ ] **Step 1: Write the failing tests** under `test("vitally_mark_upload_sent against real Supabase", …)`.
  - Use `send = (client, document, actionId = randomUUID()) => client.rpc("vitally_mark_upload_sent", { p_action_id: actionId, p_document: document })`, and the fixture's `rejected(code)` predicate for refusals.
  - The tests:
    - `marks only the caller's own entry`: member A sends `form13615`. A's `form_13615_sent_at` is set, and B's, read with `f.sql`, is still null.
    - `sending again updates the date`: a second send with a new id gives a later `form_13615_sent_at`.
    - `a repeated action id returns the same answer`: the same id twice gives deepEqual answers, and the stored date equals the first answer's `sentAt`.
    - `photoId is refused when the entry is not new`: `is_new=false` → `VALIDATION`, `cause.details` `PHOTO_ID_NOT_NEEDED`, and no `action_receipts` row for that id.
    - `photoId is refused when already checked`: `is_new=true` and `photo_id_checked_at=now()` → the same refusal.
    - `photoId is accepted for a new unchecked entry`.
    - `refused with no current-season entry`: the entry is removed inside a transaction → `VALIDATION`, `NO_ROSTER_ENTRY`.
    - `an unknown document is refused`: `"w9"` → `VALIDATION`.
    - `a client is refused`: `f.applicantA` → `FORBIDDEN`.
    - `a cleared caller may send a 13615`: `f.preparer` succeeds.
    - `the send appears in vitally_my_clearance`: the item's `sentAt` equals the answer's `sentAt`.
    - `the send raises the volunteer revision`: `volunteer_profiles.revision` goes up by 1.
    - `an admin's stale save is refused`: an admin reads the revision, the volunteer sends, and the admin's `vitally_save_volunteer` with the old revision → `CONFLICT`. Copy the `save(client, args)` helper and payload builder from `tests/database-volunteer-roster.mjs:51`.
- [ ] **Step 2: Run the tests to verify they fail.** Run: `node --env-file=.env.test --test --test-concurrency=1 tests/database-clearance-uploads.mjs`. Expected: FAIL, with function not found.
- [ ] **Step 3: Write §3 of 053:** `create function public.vitally_mark_upload_sent(p_action_id uuid, p_document text) returns jsonb language plpgsql security definer set search_path=''`.
  - The order, following design D2:
    1. `require_membership`, then `FORBIDDEN` unless `access='staff'` and there is a person row;
    2. `VALIDATION` for a null id or an unknown document;
    3. lock the current-season entry `for update`; `NO_ROSTER_ENTRY` when there is none;
    4. `PHOTO_ID_NOT_NEEDED` when the document is `photoId` and `not is_new or photo_id_checked_at is not null`;
    5. reserve the receipt (`MARK_UPLOAD_SENT`, with a sha256 digest of `{operation, document, personId}`);
    6. `update` the column to `now()`;
    7. `update volunteer_profiles set revision=revision+1, updated_at=now()`;
    8. store the result `{actionId, document, sentAt}` on the receipt and return it.
  - Add the revoke and grant.
- [ ] **Step 4: Run the tests to verify they pass.** Run the Step 2 command after `npm run db:migrate:test`. Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add supabase/migrations/053_clearance_uploads.sql tests/database-clearance-uploads.mjs
git commit -m "053: vitally_mark_upload_sent, a volunteer marks their own 13615 or photo ID sent"
```

### Task 3: 053: Save clears the dates; `vitally_mark_upload_reviewed`

**Files:**
- Modify: `supabase/migrations/053_clearance_uploads.sql` (§4, §5)
- Test: `tests/database-clearance-uploads.mjs`

**Interfaces:**
- Consumes: Task 2's RPC, used to set the dates in tests.
- Produces:
  - `vitally_mark_upload_reviewed(p_action_id uuid, p_volunteer_id uuid, p_expected_revision bigint, p_document text) returns jsonb` → `{actionId, personId, revision}`;
  - an unchanged `vitally_save_volunteer` signature and payload.

- [ ] **Step 1: Write the failing tests** under `test("reviewing sent uploads against real Supabase", …)`. Use a site coordinator admin from `f.staff({…, siteCoordinator: true})`.
  - Save:
    - `a role change clears the 13615 date`;
    - `a certificate change clears the 13615 date`: tick VSC only;
    - `confirming an uploaded certificate clears it`: insert an `uploaded` VSC row, then tick VSC;
    - `a phone-only save keeps it`;
    - `ticking Photo ID checked clears the photo ID date`;
    - `unticking New volunteer clears the photo ID date`: a new volunteer sends `photoId`, and a save with `isNew:false` leaves `photo_id_sent_at` null;
    - `a save that keeps Photo ID checked keeps a later photo date`: it was checked earlier, and the date is set directly with SQL.
  - Mark reviewed:
    - `clears the Form 13615 date and keeps roles and certificates`;
    - `clears the photo ID date`;
    - `raises the revision`: the answer's `revision` equals the stored value, which is the old value + 1;
    - `nothing waiting succeeds and changes nothing`: the revision is unchanged;
    - `a stale revision is refused CONFLICT`;
    - `an unknown volunteer is refused NOT_FOUND`;
    - `a non-admin is refused FORBIDDEN with no receipt`: `f.preparer`;
    - `a repeated action id returns the same answer`;
    - `an unknown document is refused VALIDATION`.
  - Reads:
    - `a non-admin reads no roster entries`: `f.preparer.client.from("roster_entries").select("*")` returns `[]`;
    - `the count ignores other seasons`: an admin's `select count` on the current season, with either date set, excludes a past-season entry that has one.
- [ ] **Step 2: Run the tests to verify they fail.** Run the Task 2 Step 2 command. Expected: FAIL.
- [ ] **Step 3: Write §4 of 053:** `create or replace function public.vitally_save_volunteer(...)`, copied from 052 lines 907–1125.
  - The only change is in the `insert … on conflict … do update` of `roster_entries`. It adds `form_13615_sent_at` and `photo_id_sent_at` to the `set` list:
    - `form_13615_sent_at` becomes null when the saved roles differ from `v_entry.roles` as sets, or the confirmed certificate set before the save differs from `v_certificates` (as sets) or contains an `uploaded` row now being ticked. Otherwise it is `roster_entries.form_13615_sent_at`.
    - `photo_id_sent_at` becomes null when `v_entry.photo_id_checked_at is null and v_photo_checked_at is not null`, or when `v_entry.is_new and not v_is_new`. Otherwise it keeps its value.
  - Compute the "before" certificate set (`confirmed_certificates`) and the uploaded-ticked flag before the delete and insert, and mark the lines `-- 053`.
- [ ] **Step 4: Write §5 of 053:** `vitally_mark_upload_reviewed`, as design D3.
  - Use Save's opening checks (`require_membership`, `acting_person`, `is_workspace_admin` → `FORBIDDEN`).
  - Then: validation; receipt `MARK_UPLOAD_REVIEWED` (digest over `{operation, volunteerId, expectedRevision, document, personId}`); lock the profile `for update` (`NOT_FOUND`, `CONFLICT`); clear the column and raise the revision only if it was set; return `{actionId, personId, revision}`.
  - Add the revoke and grant.
- [ ] **Step 5: Run the tests to verify they pass.**
  - Run: `npm run db:migrate:test`, then `npm run test:database -- --test-concurrency=1` (timeout 40 min).
  - Expected: all pass. If an unrelated suite fails, read its recorded error before rerunning.
- [ ] **Step 6: Commit.**

```bash
git add supabase/migrations/053_clearance_uploads.sql tests/database-clearance-uploads.mjs
git commit -m "053: Save clears sent dates it acts on; vitally_mark_upload_reviewed"
```

### Task 4: Store calls and the Roster's data

**Files:**
- Modify: `src/supabase-store.mjs` (beside `saveVolunteer`, about line 800)
- Modify: `src/volunteer-roster.mjs` (`combineVolunteers`, about line 67)
- Test: `tests/volunteer-roster.test.mjs`, `tests/store.test.mjs`

**Interfaces:**
- Produces:
  - `store.markUploadSent({actionId, document})` → `{actionId, document, sentAt}`;
  - `store.markUploadReviewed({actionId, volunteerId, expectedRevision, document})` → `{actionId, personId, revision}`;
  - `store.countUploadsToReview()` → `number` (a head count on the current season's `roster_entries` with `or("form_13615_sent_at.not.is.null,photo_id_sent_at.not.is.null")`);
  - the volunteer objects from `combineVolunteers` gain `form13615SentAt: string|null` and `photoIdSentAt: string|null`.

- [ ] **Step 1: Write the failing unit tests.**
  - `combineVolunteers carries the sent dates`: an entry with `form_13615_sent_at: "2026-11-20T15:00:00Z"` gives `form13615SentAt` that value and `photoIdSentAt` null.
  - In `tests/store.test.mjs`, follow its existing fake-client pattern for `saveVolunteer`:
    - `markUploadSent calls vitally_mark_upload_sent`, with `p_action_id` and `p_document`;
    - `markUploadReviewed sends the four arguments`;
    - `countUploadsToReview counts the current season`, asserting the filter and that it returns `count`.
- [ ] **Step 2: Run the tests to verify they fail.** Run: `node --test tests/volunteer-roster.test.mjs tests/store.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement the three store methods and the two fields.** Reuse `call`, `actionId` and `requireStaffAccess`. The count reads `current_season` the way `listVolunteers` does.
- [ ] **Step 4: Run the tests to verify they pass.** Run the Step 2 command. Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add src/supabase-store.mjs src/volunteer-roster.mjs tests/volunteer-roster.test.mjs tests/store.test.mjs
git commit -m "Store: mark upload sent/reviewed, count uploads to review; Roster rows carry sent dates"
```

### Task 5: The setup screen

**Files:**
- Modify: `src/setup-views.mjs`, `src/clearance.mjs`, `src/controller.mjs`, `src/app.mjs` (the action switch near `case "check-clearance":`, about line 2685)
- Test: `tests/setup-views.test.mjs`, `tests/clearance.test.mjs`, `tests/controller.test.mjs`

**Interfaces:**
- Consumes: `store.markUploadSent` (Task 4), and the clearance answer (Task 1).
- Produces:
  - `controller.markUploadSent(document)`, where `document` is `"form13615"` or `"photoId"`;
  - the button `data-action="mark-upload-sent"` with `data-document="<document>"`.

- [ ] **Step 1: Write the failing view tests** in `tests/setup-views.test.mjs`. Use a clearance whose `missing` is `[{kind:"form13615",sentAt:null}]` and whose `uploadUrl` is `"https://example.org/certificates"`.
  - `offers Upload and I've uploaded it`: an `<a` with `href="https://example.org/certificates"`, `target="_blank"` and `rel="noopener"`, text "Upload", and a button with `data-action="mark-upload-sent"` and `data-document="form13615"`, text "I've uploaded it".
  - `shows the waiting state once sent`: with `sentAt` `"2026-11-20T15:00:00Z"`, it contains "Waiting for review · sent Nov 20", has no `mark-upload-sent` button, and still has Upload.
  - `asks the site coordinator with no link`: with `uploadUrl` null, it contains "Ask your site coordinator how to send it.", has no `<a`, and has the button.
  - `no link and sent`: the ask line plus the waiting state.
  - `shows the New York day`: `sentAt` `"2026-11-21T03:30:00Z"` gives "sent Nov 20".
  - `escapes the upload link`: `uploadUrl` `"https://example.org/a?x=1&y=\"2\""` renders `href="https://example.org/a?x=1&amp;y=&quot;2&quot;"`.
  - `role and SC items are unchanged`: the existing lines, with no buttons.
  - The existing `missingLines` tests in `tests/clearance.test.mjs` still pass, so keep `missingLines` returning strings. Add a sibling `uploadItems(clearance)` in `src/clearance.mjs` returning `[{document, line, sentAt}]` for the two kinds.
- [ ] **Step 2: Write the failing controller tests** in `tests/controller.test.mjs`, using its fake store pattern:
  - `markUploadSent sends and re-checks the clearance`: `store.markUploadSent` is called with `{document:"form13615", actionId}`, then `store.getClearance` once more;
  - `retries a lost send with the same action id`: the first call rejects with an unknown-outcome code, and the second call carries the same `actionId`;
  - `a refusal is said on the setup screen`: `VALIDATION`/`PHOTO_ID_NOT_NEEDED` sets a notice and no banner;
  - `busy blocks a second press`.
- [ ] **Step 3: Run the tests to verify they fail.** Run: `node --test tests/setup-views.test.mjs tests/clearance.test.mjs tests/controller.test.mjs`. Expected: FAIL.
- [ ] **Step 4: Implement it.**
  - `setupScreen` renders the role and SC lines as today. For each `uploadItems` entry it renders the line, then Upload or the ask line, then the button or the waiting text.
  - The date formatter is a module-level `Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",month:"short",day:"numeric"})`.
  - `controller.markUploadSent` keeps a `pendingUploadSend` request on an unknown outcome, the way `pendingVolunteerSave` does. It uses `state.busy`, calls `checkClearance()` after success, and puts the refusal sentence in `state.error` through `noteFailure`.
  - `app.mjs` maps `mark-upload-sent` to `controller.markUploadSent(target.dataset.document)`.
- [ ] **Step 5: Run the tests to verify they pass.** Run the Step 3 command and then `npm test`. Expected: PASS.
- [ ] **Step 6: Commit.**

```bash
git add src/setup-views.mjs src/clearance.mjs src/controller.mjs src/app.mjs tests/setup-views.test.mjs tests/clearance.test.mjs tests/controller.test.mjs
git commit -m "Setup screen: Upload, I've uploaded it, and waiting for review"
```

### Task 6: The Roster: the Show filter, row text, and the drawer's Mark reviewed

**Files:**
- Modify: `src/volunteer-roster.mjs` (`filterVolunteers`, about line 126), `src/volunteer-views.mjs` (`toolbar` about line 76, the row about line 57, `volunteerDrawerBody` about line 233), `src/controller.mjs` (`setVolunteerFilter`, about line 1218), `src/app.mjs`
- Test: `tests/volunteer-roster.test.mjs`, `tests/volunteer-views.test.mjs`, `tests/controller.test.mjs`

**Interfaces:**
- Consumes: Task 4's fields and `store.markUploadReviewed`.
- Produces:
  - `export const SHOW_VIEWS = Object.freeze([{value:"all",label:"Everyone",keep:()=>true},{value:"uploads",label:"Uploads to review",keep:(v)=>v.form13615SentAt!=null||v.photoIdSentAt!=null}])` in `src/volunteer-roster.mjs`;
  - `filterVolunteers(list, {search, role, show = "all"})`;
  - `controller.markUploadReviewed(document)`;
  - the button `data-action="mark-upload-reviewed"` with `data-document`.

- [ ] **Step 1: Write the failing tests.**
  - `filterVolunteers keeps uploads to review`;
  - `show combines with role and search`;
  - `an unknown show value keeps everyone`;
  - `the toolbar has a Show select`: `id="volunteer-show-filter"`, `data-volunteer-filter="show"`, options from `SHOW_VIEWS` in order, with the chosen one selected;
  - `a row says Form 13615 to review` and `a row says Photo ID to review`, both for an uncleared row and for a cleared row with a date;
  - `the drawer shows Form 13615 sent Nov 20 with Mark reviewed`: the button has `data-document="form13615"`;
  - `drawer date is the New York day`;
  - `no sent line when nothing is waiting`;
  - `no sent line in Add a volunteer`.
- [ ] **Step 2: Run the tests to verify they fail.** Run: `node --test tests/volunteer-roster.test.mjs tests/volunteer-views.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - The filter and the views.
  - `setVolunteerFilter` accepts `"show"`.
  - `rosterPage` already passes `state.volunteerFilters`.
  - The Show select sits after the Role select in the same `volunteer-toolbar`, styled like it (`field pool-filter`).
- [ ] **Step 4: Run the tests to verify they pass.** Run the Step 2 command. Expected: PASS.
- [ ] **Step 5: Write the failing controller tests:**
  - `Mark reviewed sends the drawer volunteer's revision`: `store.markUploadReviewed` is called with `{volunteerId, expectedRevision: Number(current.revision), document, actionId}`;
  - `Mark reviewed re-reads the Roster and the count`;
  - `Mark reviewed keeps the drawer's unsaved edits`: with the drawer open and its form values held where the controller keeps them across a redraw (follow how a failed `saveVolunteer` re-reads and redraws without losing the form, and `src/redraw-hold.mjs`), the field values after the call equal those before. A following `saveVolunteer` uses the re-read revision.
  - `a CONFLICT says VOLUNTEER_CONFLICT_MESSAGE`.
- [ ] **Step 6: Implement `controller.markUploadReviewed(document)`.**
  - It finds the drawer's volunteer from `state.dialogContext.volunteerId` in `state.volunteers`.
  - It calls the store, then `readVolunteers()`. Task 7 adds the count re-read here.
  - It shows a `"Marked reviewed"` toast, using the existing toast helper.
  - `app.mjs` maps `mark-upload-reviewed`.
- [ ] **Step 7: Run the tests to verify they pass.** Run `node --test tests/controller.test.mjs`, then `npm test`. Expected: PASS.
- [ ] **Step 8: Commit.**

```bash
git add src/volunteer-roster.mjs src/volunteer-views.mjs src/controller.mjs src/app.mjs tests/volunteer-roster.test.mjs tests/volunteer-views.test.mjs tests/controller.test.mjs
git commit -m "Roster: Show filter (Uploads to review), to-review row text, Mark reviewed in the drawer"
```

### Task 7: The sidebar count

**Files:**
- Modify: `src/views.mjs` (the Volunteers nav link, about line 235), `src/controller.mjs` (`loadData`, `recheckClearance`, `runRefresh`, `readVolunteers`, `saveVolunteer`, `markUploadReviewed`), `src/styles.css` (`.nav-count`, if needed)
- Test: `tests/staff-views.test.mjs` (or the test file that covers the sidebar: grep `open-volunteers` in `tests/`), `tests/controller.test.mjs`

**Interfaces:**
- Consumes: `store.countUploadsToReview` (Task 4).
- Produces:
  - `state.uploadsToReview: number` (default 0);
  - `readUploadsCount()` inside the controller, which returns whether the count changed and never throws.

- [ ] **Step 1: Write the failing tests.**
  - `the Volunteers link shows the count`: with `state.uploadsToReview = 3`, the link's text is "Volunteers · 3", it has `aria-label="Volunteers, 3 uploads to review"`, and the ` · 3` sits in an `aria-hidden="true"` span.
  - `singular at one`: with `state.uploadsToReview = 1`, `aria-label="Volunteers, 1 upload to review"`.
  - `plain at zero`: no `aria-label` and no span.
  - `absent for a non-admin`: no `open-volunteers` link at all, as today.
  - Controller tests:
    - `an admin window reads the count with its data`;
    - `the clearance check re-reads the count for an admin`, including for an uncleared admin;
    - `a cleared check with the same standing still redraws when the count changed`;
    - `a cleared window's wake refresh re-reads the count`;
    - `a non-admin window never reads the count`;
    - `a failed count read keeps the last count`;
    - `Save and Mark reviewed re-read the count`.
- [ ] **Step 2: Run the tests to verify they fail.** Run: `node --test tests/staff-views.test.mjs tests/controller.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - `readUploadsCount` runs only when `staffWindow() && ceilingAdmin(state.principal)`, catches every error, and returns `changed`.
  - Call it:
    - in `loadData`;
    - at the end of `recheckClearance` on every answered path, calling `show()` when it changed, including the quiet same-standing path;
    - in the cleared branch of `runRefresh`;
    - after `readVolunteers` succeeds;
    - in `saveVolunteer` and `markUploadReviewed`.
  - Render as in Step 1.
- [ ] **Step 4: Check the browser tests' lookups.** Run: `git grep -n "Volunteers" tests/browser.mjs tests/auth-browser.mjs`. Fix any lookup by exact accessible name that the count would change. Expected: none; they use `data-action="open-volunteers"`.
- [ ] **Step 5: Run the tests to verify they pass.** Run `npm test`. Expected: PASS.
- [ ] **Step 6: Commit.**

```bash
git add src/views.mjs src/controller.mjs src/styles.css tests/staff-views.test.mjs tests/controller.test.mjs
git commit -m "Sidebar: Volunteers shows the uploads to review count for workspace admins"
```

### Task 8: Browser test

**Files:**
- Modify: `tests/browser.mjs` (a new top-level `test(...)` right after "A site coordinator changes Season settings", about line 9548)

**Interfaces:**
- Consumes everything above, through the UI.

- [ ] **Step 1: Write the test** `"A volunteer says their uploads were sent, and an admin reviews them"`, with `{ timeout: 300_000 }`, Chrome only, on its own `createBrowserFixture()`, with the same toast and alert helpers as the Season settings test.
  - **Setup:**
    - Set the certificate link to `https://example.org/certificates` with `fixture.database.sql` (the same upsert as in Task 1).
    - Create two staff with `fixture.database.staff`, both `capabilities: []` and `cleared: false`, as the uncleared admin test does (about line 9402):
      - `key: "uploads_volunteer"`, name "Robin Vale", not new;
      - `key: "uploads_new_volunteer"`, name "Sasha Kerr", `is_new=true`, with no photo check set by SQL.
  - **Flow:**
    1. Robin signs in to "Finish your setup for this season". The Form 13615 item's Upload link has `href` equal to the link and `target="_blank"`. Robin presses I've uploaded it, and "Waiting for review · sent" appears.
    2. The site coordinator signs in. The `open-volunteers` link's `aria-label` is "Volunteers, 1 upload to review". On the Roster, Show → Uploads to review lists only Robin, with "Form 13615 to review".
    3. The site coordinator opens Edit for Robin, sees "Form 13615 sent", ticks VSC and IT&QR and the Intaker role, and saves. The row is gone from the filter, and the link is plain "Volunteers".
    4. Robin's window regains focus (`page.bringToFront()` plus a dispatched `focus`), and the work board heading appears.
    5. Sasha signs in and presses I've uploaded it on the photo ID item. The site coordinator's window regains focus, and the count shows 1. The site coordinator opens Edit for Sasha, presses Mark reviewed beside "Photo ID sent", and the line goes. Under Uploads to review, nobody matches.
  - **Finish:** `assertConsoleQuiet` on each window. Restore the link to null in `finally`.
- [ ] **Step 2: Run only this test, if memory allows.** First stop other stacks and check that about 1.5 GB is free. Run: `node --env-file=.env.test --test --test-name-pattern="uploads were sent" tests/browser.mjs` (timeout 10 min). Expected: PASS. If memory is short, skip the local run and say so; the PR's CI story legs cover it, and their screenshots are reviewed.
- [ ] **Step 3: Commit.**

```bash
git add tests/browser.mjs
git commit -m "Browser: a volunteer's uploads are sent, filtered and reviewed (outside the story)"
```

### Task 9: Checks and docs

**Files:**
- Modify: `docs/developer/` (only where it lists migrations or the clearance and Roster RPCs: grep `vitally_my_clearance\|052_season_settings` in `docs/developer/`)

- [ ] **Step 1: Update the docs** that list migrations or these RPCs. Add 053, the two RPCs, and the two columns, in the docs' existing style.
- [ ] **Step 2: Run the checks.**
  - `npm test`: PASS.
  - `npx openspec validate --all`: 0 failed.
  - `npm run build:hant -- --check`: unchanged.
  - `npm run build:intake` then `git status --porcelain`: empty.
- [ ] **Step 3: Draft the PR body notes** in the scratch ledger, not the repo. It needs:
  - the checks run and why the others were not;
  - "Refs #193 (item 7 done)";
  - "Part of #138";
  - the hosted step, run after merge on the same day: `node --env-file=.env.admin tools/admin/migrate.mjs --target classroom` with `NODE_EXTRA_CA_CERTS` set.
- [ ] **Step 4: Stop the local stack** and kill orphaned `node --test` runners.
- [ ] **Step 5: Commit.**

```bash
git add docs/developer
git commit -m "Docs: migration 053, clearance uploads RPCs"
```
