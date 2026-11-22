# My Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- A cleared staff member has a My profile screen: their own details (usual days included) to edit, this season's roles and certificates read-only, and a way to send a new Form 13615.
- Mark reviewed carries a reason the volunteer sees.
- `uploadUrl` is withheld during the site check.

**Architecture:**
- **Database:** migration 057 adds reviewed time and reason columns on `roster_entries` and `usual_days` on `volunteer_profiles`. It re-creates `vitally_my_clearance`, `vitally_mark_upload_sent`, `vitally_save_volunteer` and a five-argument `vitally_mark_upload_reviewed`, and adds the caller-only `vitally_my_profile` and `vitally_save_my_profile`.
- **App:** a new `my-profile` screen in `src/profile-views.mjs`, opened from the sidebar's account row. A reason line on the setup screen and on My profile. A reason row and Usual days in the Roster drawer.

**Tech Stack:**
- Postgres/Supabase (a hand-written SQL migration; plpgsql security-definer RPCs);
- plain ES modules (`src/*.mjs`);
- `node:test` unit tests;
- database suites run in CI (`database-quick.yml`);
- Playwright (`tests/browser.mjs`).

**Spec:** `openspec/changes/add-my-profile/`:
- `design.md` (D1–D10);
- `brainstorm.md` (Q1–Q16 and the calls);
- `specs/my-profile/spec.md`, `specs/volunteer-clearance/spec.md` and `specs/volunteer-roster/spec.md`.

Executors read the design and specs alongside this plan.

## Global Constraints

- **Migration:** `supabase/migrations/057_my_profile.sql`, new and hand-written. Never edit 001–056.
  - Copy each re-created function from its latest version (053 for the four functions here; check `git grep -l "function public.vitally_save_volunteer" supabase/migrations` in case 056 re-created one, and copy from the newest). Mark every changed line `-- 057`.
  - The header comment names the change and its sections §1–§7.
- **Signatures (exact):**
  - `vitally_my_profile()`
  - `vitally_save_my_profile(p_action_id uuid, p_expected_revision bigint, p_profile jsonb)`
  - `vitally_mark_upload_reviewed(p_action_id uuid, p_volunteer_id uuid, p_expected_revision bigint, p_document text, p_reason text)`
  - Drop `vitally_mark_upload_reviewed(uuid,uuid,bigint,text)`.
- **Privileges:** each new or re-created function gets `revoke all … from public,anon,authenticated,service_role;` and then `grant execute … to authenticated;`.
- **Values:**
  - Days are `mon`, `tue`, `wed`, `thu`, `fri`, `sat` and `sun`, stored in that order.
  - A reason is trimmed and 1–120 characters.
  - The receipt operation is `SAVE_MY_PROFILE`.
  - The `vitally_save_my_profile` payload keys are exactly `languages`, `name`, `otherLanguage`, `phone`, `usualDays` and `works`.
  - The `vitally_save_volunteer` payload is the ten 053 keys, optionally plus `usualDays`.
- **Quick picks (exact text):**
  - 13615: "Not signed", "Can't read it", "Wrong form" and "Missing a certification", plus "Already on file" only when the volunteer has a role this season.
  - Photo ID: "Can't read it", "Expired" and "Not a photo ID".
- **The already-on-file line** is for a Form 13615 whose reason is exactly "Already on file". Every photo ID reason, a typed "Already on file" included, gets the generic line.
- **Staff text, English only (exact):**
  - "My profile"
  - "Your details"
  - "This season"
  - "Managed by the office"
  - "Ask <name>, your site coordinator."
  - "Passed a higher certification? Send your new Form 13615"
  - "Upload"
  - "I've uploaded it"
  - "Ask your site coordinator how to send it."
  - "Waiting for review · sent <date>"
  - "Your site coordinator says this is already on file. You don't need to send it again."
  - "Your site coordinator looked at this: <reason>. Please send it again or ask them."
  - "Last returned: <reason> · <date>" (admins, in the drawer)
  - The sidebar link: "My profile", with the signed-in name as a smaller second line
  - "Send back"
  - "Cancel"
  - "Usual days"
  - "Someone else changed these details. Here they are now."
  - "Profile saved" (the toast)
  - The email hint: "Your email is how you sign in. Only a site coordinator can change it."
- **Dates:** `<date>` uses `SENT_DAY` from `src/ui.mjs` (New York time, for example "Nov 20").
- **Escaping:** every stored string (reason, name, link) goes through `esc`.
- **Data:** fictional data only. Tests stay in their own workspace, and assert only on rows they made.
- **No local Docker or stack.**
  - Database files run with `gh workflow run database-quick.yml --ref add-my-profile -f files="<files>"`, then `gh run watch <id> --exit-status`, with a 30-minute timeout.
  - No full local `npm run test:browser`; the PR's CI runs it.
  - Every command gets a timeout. Never run a foreground server.
  - Report BLOCKED if a step needs approval you don't have.
- **Git:** commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push before each quick database run.

## Review Focus

1. **A reason with `<`, `&` or quotes**, typed as a note.
   - It must show as text on the setup screen and My profile, and not break the markup.
   - Test: Task 6 Step 1 `escapes a typed reason`, and Task 7 Step 1 `escapes the reason`.
2. **A volunteer and an admin saving the same person within seconds.**
   - Whichever saves second gets `CONFLICT`, and nothing is lost silently.
   - Test: Task 3 Step 1 `a volunteer's stale save` and `an admin's stale save`, and Task 5 Step 1 `a CONFLICT re-reads and says so`.
3. **A lost answer on Save in My profile, pressed again.**
   - One save is recorded (the same action id).
   - Test: Task 5 Step 1 `saveMyProfile retries a lost save with the same action id`.
4. **"Already on file" typed in a different case ("already on file"), or typed for a photo ID.**
   - Both are shown as the generic line with their text. Only a 13615 with the exact text gets the already-on-file line.
   - Test: Task 4 Step 1 `only the exact quick pick is already on file` and `a photo ID is never already on file`.
5. **Usual days sent out of order or repeated** (`["sat","mon"]`, `["mon","mon"]`).
   - The first is stored as `{mon,sat}`; the second is refused.
   - Test: Task 2 Step 1 and Task 3 Step 1.

---

### Task 1: 057 §1–§3: columns, the clearance answer, and sending again

**Files:**
- Create: `supabase/migrations/057_my_profile.sql`
- Create: `tests/database-my-profile.mjs`
- Modify: `tests/database-clearance-uploads.mjs` (exact `missing` deepEquals gain the two new keys)

**Interfaces:**
- Produces:
  - `roster_entries.form_13615_reviewed_at timestamptz`, `form_13615_review_reason text`, `photo_id_reviewed_at timestamptz` and `photo_id_review_reason text`;
  - the checks `roster_entries_13615_review_pair` and `roster_entries_photo_review_pair`: both null, or both set with `char_length(btrim(reason)) between 1 and 120`;
  - `volunteer_profiles.usual_days text[] not null default '{}'`, with the check `volunteer_profiles_usual_days`: `usual_days <@ array['mon','tue','wed','thu','fri','sat','sun']` and no repeats;
  - the clearance items `{kind:"form13615"|"photoId", sentAt, reviewedAt, reviewReason}`;
  - `uploadUrl` null while `siteCheck`.

- [ ] **Step 1: Write the failing tests** in `tests/database-my-profile.mjs`.
  - Same imports and fixture as `tests/database-clearance-uploads.mjs`, under `test("057 clearance answer against real Supabase", …)`:
    - `items carry null reviewedAt and reviewReason`: an uncleared member with no roles gets `missing` deepEqual `[{kind:"form13615",sentAt:null,reviewedAt:null,reviewReason:null}]`.
    - `a reviewed item reports its time and reason`: set the 13615 pair with `f.sql` to `'2026-11-18T15:30:00Z','Not signed'`, and the item carries both.
    - `uploadUrl is null while the site check is owed`: set the member's `accounts.status='invited'` in a transaction (rolled back). The answer has `siteCheck` true and `uploadUrl` null. With status `active`, `uploadUrl` is the link.
    - `sending again clears the reviewed pair`: set the pair, call `vitally_mark_upload_sent` for `form13615`. The entry has a sent date and both review columns null.
    - `the pair check refuses half a pair`: `f.sql` setting only `form_13615_review_reason` rejects with code `23514`.
    - `usual_days refuses an unknown day`: `f.sql` setting `usual_days='{monday}'` rejects with `23514`.
- [ ] **Step 2: Update `tests/database-clearance-uploads.mjs`.** Each exact item deepEqual gains `reviewedAt: null, reviewReason: null`. Change no assertions otherwise.
- [ ] **Step 3: Write 057 §1–§3.**
  - §1: the columns and checks above.
  - §2: `vitally_my_clearance()` from 053 §2.
    - Both items add `'reviewedAt',v_entry.<doc>_reviewed_at,'reviewReason',v_entry.<doc>_review_reason`.
    - Compute `v_site_check` once (the existing `exists(... status='invited')`), and use it for `'siteCheck'` and to null `'uploadUrl'`.
  - §3: `vitally_mark_upload_sent` from 053 §3. Each `update … set <doc>_sent_at=v_sent` also sets `<doc>_reviewed_at=null,<doc>_review_reason=null`.
- [ ] **Step 4: Run `npm test`** (timeout 10 min). Expected: PASS. It has no database tests, so this only checks nothing else broke.
- [ ] **Step 5: Commit, push, and run the database files.**
  - Run: `gh workflow run database-quick.yml --ref add-my-profile -f files="tests/database-my-profile.mjs tests/database-clearance-uploads.mjs tests/database-clearance.mjs"`, then `gh run watch`.
  - Expected: green. On red, read the job log before changing anything.

### Task 2: 057 §4–§5: Mark reviewed with a reason, and the admin save

**Files:**
- Modify: `supabase/migrations/057_my_profile.sql`
- Modify: `tests/database-clearance-uploads.mjs` (the `review` helper and the Mark reviewed tests)
- Modify: `tests/database-my-profile.mjs`
- Modify: any other `tests/database-*.mjs` that calls `vitally_mark_upload_reviewed` or `vitally_save_volunteer` (`git grep -l` them; the save keeps working without `usualDays`)

**Interfaces:**
- Consumes: the Task 1 columns.
- Produces:
  - the five-argument `vitally_mark_upload_reviewed`, which sets `<doc>_reviewed_at=now()` and `<doc>_review_reason=btrim(p_reason)` in the same update that clears a set sent date;
  - `vitally_save_volunteer`, which accepts `usualDays`.

- [ ] **Step 1: Write the failing tests.**
  - In `tests/database-clearance-uploads.mjs`, `review(m, document, {actionId, revision, reason = "Not signed"})` passes `p_reason: reason`. The existing Mark reviewed tests keep their assertions.
  - New tests there:
    - `Mark reviewed stores the reason and time`: after send and review with "Can't read it", the entry has a null sent date, reason `"Can't read it"`, and a `form_13615_reviewed_at` within 60 s of now.
    - `Mark reviewed trims the reason`: `"  Wrong form  "` is stored as `"Wrong form"`.
    - `Mark reviewed with no reason is refused VALIDATION with no receipt`: null, then `"   "`. Each gives error `VT007`, the sent date stays, and the `action_receipts` count for that action id is 0.
    - `a 121-character reason is refused; 120 is accepted`: `"x".repeat(121)` gives `VT007`, and `"x".repeat(120)` succeeds.
    - `nothing waiting keeps the first reason`: review with "Not signed", then review again with "Wrong form". The reason is still "Not signed".
    - `a non-admin with no reason is refused FORBIDDEN, not VALIDATION`.
    - `the four-argument call is gone`: `admin.client.rpc("vitally_mark_upload_reviewed", {p_action_id, p_volunteer_id, p_expected_revision, p_document})` returns an error with code `PGRST202`.
    - `a role change clears the review pair`: review with "Missing a certification", then `save(m, {certificates: [...current, "advanced"]})`. Both review columns are null.
    - `Photo ID checked clears the photo review pair`, and `a phone-only save keeps the review pair`.
  - In `tests/database-my-profile.mjs`, `test("usual days on the admin save", …)`:
    - `usualDays are stored in week order`: save with `["sat","tue"]` gives `{tue,sat}`.
    - `a save without usualDays keeps them`: set `{mon}`, save the ten keys, and the days are still `{mon}`.
    - `an unknown or repeated day is refused`: `["monday"]` and `["mon","mon"]` each give `VT007`, with nothing changed.
    - `an eleventh unknown key is still refused`: `{…ten, colour:"x"}` gives `VT007`.
    - `a non-admin reads no other profile's usual days`: a cleared Preparer's `from("volunteer_profiles").select("usual_days")` returns no row of another person.
- [ ] **Step 2: Write 057 §4–§5.**
  - §4: `vitally_save_volunteer` from 053 §4.
    - The key-set check accepts the ten keys, or the ten plus `usualDays`.
    - When `usualDays` is present it must be an array of strings from the seven days, with no repeats. `v_days` is `array(select d from unnest(...) d order by array_position(array['mon',…,'sun'], d))`.
    - The update sets `usual_days=coalesce(v_days, usual_days)`, and the insert uses `coalesce(v_days,'{}')`.
    - The `on conflict` set clears `form_13615_reviewed_at/_review_reason` under `v_clear_13615`, and the photo pair under the photo sent-date condition, whether or not a date was set.
  - §5: `drop function public.vitally_mark_upload_reviewed(uuid,uuid,bigint,text);`, then create the five-argument version from 053 §5.
    - The reason check joins the argument `VALIDATION` checks (after the admin check, before the digest): `p_reason is null or char_length(btrim(p_reason)) not between 1 and 120`.
    - Add `'reason',btrim(p_reason)` to the digest.
    - The two updates also set the pair.
- [ ] **Step 3: Run `npm test`.** Expected: PASS.
- [ ] **Step 4: Commit, push, and run the database files.**
  - Run: `database-quick.yml` with `tests/database-my-profile.mjs tests/database-clearance-uploads.mjs` plus every file Step 1's `git grep` found.
  - Expected: green.

### Task 3: 057 §6–§7: the caller's own profile read and save

**Files:**
- Modify: `supabase/migrations/057_my_profile.sql`
- Modify: `tests/database-my-profile.mjs`

**Interfaces:**
- Produces:
  - `vitally_my_profile()`, returning `{personId, name, email, phone, works, languages, otherLanguage, usualDays, revision, accountStatus, roles, certificates, form13615: {sentAt, reviewedAt, reviewReason} | null, uploadUrl, siteCoordinatorName}`;
  - `vitally_save_my_profile`, returning `{actionId, personId, revision}`.

- [ ] **Step 1: Write the failing tests**, under `test("my profile RPCs against real Supabase", …)`:
  - `a cleared Preparer reads their own profile`: the keys deepEqual the sorted list above. `roles` is `["preparer"]`, `certificates` equals the fixture's confirmed ones, `accountStatus` is `"active"`, `form13615` is `{sentAt:null,reviewedAt:null,reviewReason:null}`, and `revision` equals the stored one.
  - `a came-back 13615 is reported`: set the pair to "Already on file", and `form13615.reviewReason` is `"Already on file"`.
  - `uploadUrl follows the site check`: null while `invited`, and the link while active.
  - `a client is refused FORBIDDEN`, for both RPCs. The save stores no receipt.
  - `saving details writes only the caller`: send phone `"555-0142"`, languages `["english","cantonese"]`, usualDays `["sat","mon"]` and name `"Fictional Preparer"`. The profile has those values with days `{mon,sat}`, `people.name` is updated, the revision rose by 1, and roles, certificates, email and another member's profile are unchanged.
  - `another key is refused`: adding `email` gives `VT007`, and so does adding `roles`.
  - `an 81-character name is refused`, and so are `works:"sometimes"` and `otherLanguage` without `other`.
  - `a volunteer's stale save`: an admin save raises the revision, then the volunteer saves with the old one and gets `VT003`. The admin's phone stays.
  - `an admin's stale save`: the volunteer saves, then the admin saves with the old revision and gets `VT003`.
  - `a repeated action id returns the same answer and raises the revision once`.
  - `no action id or no revision is refused VALIDATION`.
- [ ] **Step 2: Write 057 §6–§7.**
  - Both start with `require_membership()`, a `staff` access check, the caller's `people` row by `user_id`, and their `volunteer_profiles` row. Any missing gives `VT001 FORBIDDEN`.
  - §6 reads like `vitally_my_clearance` for `uploadUrl` (same rule) and `siteCoordinatorName`. Roles come from this season's entry, certificates from `vitally_private.confirmed_certificates`, and `accountStatus` from `public.accounts`.
  - §7 follows `vitally_save_volunteer`'s order:
    - validate (the six keys; the same field rules and day rule as §4);
    - take the digest of `{operation:'SAVE_MY_PROFILE', expectedRevision, personId, profile}`;
    - `reserve_receipt`;
    - lock the profile `for update`, check the revision, and refuse `VT003 CONFLICT` on a mismatch;
    - update `people.name` and the profile fields with `revision=revision+1,updated_at=now()`;
    - store the receipt.
- [ ] **Step 3: Run `npm test`.** Expected: PASS.
- [ ] **Step 4: Commit, push, and run `database-quick.yml`** with `tests/database-my-profile.mjs tests/database-clearance-uploads.mjs`. Expected: green.

### Task 4: Store and clearance helpers

**Files:**
- Modify: `src/supabase-store.mjs`, `src/volunteer-roster.mjs`, `src/clearance.mjs`
- Test: `tests/store.test.mjs`, `tests/clearance.test.mjs`

**Interfaces:**
- Produces:
  - `store.getMyProfile()`, which resolves to the `vitally_my_profile` answer;
  - `store.saveMyProfile({actionId, expectedRevision, profile})`, which calls `vitally_save_my_profile` with `p_action_id`, `p_expected_revision` and `p_profile`;
  - `store.markUploadReviewed({actionId, volunteerId, expectedRevision, document, reason})`, which sends `p_reason`;
  - volunteer records from `listVolunteers` carry `usualDays: string[]`, plus `form13615ReviewedAt`, `form13615ReviewReason`, `photoIdReviewedAt` and `photoIdReviewReason` (string or null);
  - `uploadItems(clearance)` items gain `reviewedAt` and `reviewReason`;
  - `reviewLine({document, sentAt, reviewReason})` in `src/clearance.mjs`, which returns the D8 line or null. The already-on-file line only applies when `document === "form13615"`.

- [ ] **Step 1: Write the failing tests.**
  - `tests/store.test.mjs`:
    - `markUploadReviewed sends the five arguments` (convert the four-argument test: same assertions plus `p_reason`);
    - `getMyProfile calls vitally_my_profile`;
    - `saveMyProfile sends its three parameters`.
    - Add both RPC names to the documented-signature test.
  - `tests/clearance.test.mjs`:
    - `uploadItems carries the review`;
    - `reviewLine is null with a sent date or no reason`;
    - `only the exact quick pick is already on file`: for `form13615`, `"Already on file"` gives the already-on-file sentence, and `"already on file"` gives the generic sentence with that text;
    - `a photo ID is never already on file`: for `photoId`, `"Already on file"` gives "Your site coordinator looked at this: Already on file. Please send it again or ask them.";
    - `listVolunteers carries the review fields` (in `tests/store.test.mjs`): the four fields map from the entry's columns, null when unset;
    - `a note is quoted in the generic line`.
- [ ] **Step 2: Implement.** `reviewLine` returns plain text; views escape it. `src/volunteer-roster.mjs` maps `profile.usual_days ?? []`.
- [ ] **Step 3: Run** `node --test tests/store.test.mjs tests/clearance.test.mjs`. Expected: PASS. Then run `npm test`. Expected: PASS.
- [ ] **Step 4: Commit.**

### Task 5: Controller: My profile, Mark reviewed with a reason, usual days

**Files:**
- Modify: `src/controller.mjs`
- Test: `tests/controller.test.mjs`

**Interfaces:**
- Consumes: Task 4's store methods.
- Produces:
  - the screen name `"my-profile"`, in the staff screen list and allowed only while cleared, so an uncleared window's `navigate("my-profile")` lands on its home;
  - `state.myProfile` (the read or null) and `state.lists.myProfile` (`"loading"`, `"ready"` or `"failed"`);
  - `controller.saveMyProfile(values)`, which resolves to `"Profile saved"` or null;
  - `controller.markUploadReviewed(document, reason)`;
  - the existing `markUploadSent(document)`, which re-reads the profile when `state.screen === "my-profile"`;
  - `saveVolunteer` values may carry `usualDays`, which are sent when present.

- [ ] **Step 1: Write the failing tests:**
  - `navigate to my-profile reads the profile`;
  - `an uncleared window cannot open my-profile`;
  - `saveMyProfile sends the read's revision and re-reads the profile and people`;
  - `saveMyProfile retries a lost save with the same action id`;
  - `a CONFLICT re-reads and says so` (the message "Someone else changed these details. Here they are now.");
  - `a refused save keeps the typed values`;
  - `losing clearance on my-profile shows the setup screen`;
  - `markUploadSent on my-profile re-reads the profile`;
  - `markUploadReviewed sends the reason` (convert the existing test: same assertions plus `reason`);
  - `the profile is re-read on focus while on my-profile`.
- [ ] **Step 2: Implement.**
  - Model the read and write on `readSeasonSettings`, `loadSeasonSettings` and `settingsWrite`: a kept pending request matched on the JSON of the values, and `UNKNOWN_OUTCOME` to retry.
  - After a landed save, run `state.people = withOwnCapabilities(await store.listPeople(), state.principal)` and `recheckAfterOwnSave()`.
- [ ] **Step 3: Run** `node --test tests/controller.test.mjs` (timeout 10 min). Expected: PASS.
- [ ] **Step 4: Commit.**

### Task 6: Setup screen reason line, and the drawer's reason row and Usual days

**Files:**
- Modify: `src/setup-views.mjs`, `src/volunteer-views.mjs`, `src/app.mjs`, `src/styles.css`
- Test: `tests/setup-views.test.mjs`, and the drawer's view test file (`git grep -l "Mark reviewed" tests/*.test.mjs`)

**Interfaces:**
- Consumes:
  - `reviewLine(item)` from Task 4;
  - `controller.markUploadReviewed(document, reason)` and `saveVolunteer` with `usualDays` from Task 5.
- Produces:
  - `reasonRow(document, {hasRole, busy})` in `src/volunteer-views.mjs`: a fieldset with radios `name="review-reason"`, an `<input name="review-note" maxlength="120">`, and the buttons `data-action="send-back"` and `data-action="cancel-review"`;
  - the drawer's checkboxes `name="usualDays"` with values `mon`–`sun` and labels Monday–Sunday.

- [ ] **Step 1: Write the failing tests.**
  - `tests/setup-views.test.mjs`:
    - `a returned item shows the reason line`;
    - `already on file shows its own line`;
    - `a sent item shows no reason`;
    - `escapes a typed reason`: a reason of `<b>&"` appears as `&lt;b&gt;&amp;&quot;`.
  - The drawer tests:
    - `Mark reviewed opens the reason row`;
    - `photo ID picks are Can't read it, Expired and Not a photo ID` (and none of "Not signed", "Wrong form", "Missing a certification" or "Already on file");
    - `13615 picks are the four, plus Already on file with a role`;
    - `a stored reason shows Last returned in the document's place`: a 13615 reason "Not signed" reviewed `2026-11-21T03:30:00Z` shows "Last returned: Not signed · Nov 20" after Roles; a photo ID one shows beside Photo ID checked; a document with a sent date shows its sent line instead;
    - `escapes the last reason in the drawer`;
    - `Already on file only with a role this season`;
    - `Send back is disabled until a pick or a note`;
    - `usual days are ticked from the record`.
- [ ] **Step 2: Implement.**
  - In `src/app.mjs`:
    - `mark-upload-reviewed` now opens the row, held in `state.reviewReasonFor = document`, which is window-local;
    - `send-back` reads the note, or else the checked pick, and calls `controller.markUploadReviewed(document, reason)`;
    - `cancel-review` clears the row;
    - an `input` or `change` inside the row toggles Send back's `disabled`;
    - the drawer's form values gain `usualDays`.
  - Keep the unsaved drawer edits exactly as the existing Mark reviewed path does.
- [ ] **Step 3: Run `npm test`.** Expected: PASS.
- [ ] **Step 4: Commit.**

### Task 7: My profile screen and the sidebar link

**Files:**
- Create: `src/profile-views.mjs`
- Create: `tests/profile-views.test.mjs`
- Modify: `src/views.mjs` (the `staffSidebar` account row and the screen routing), `src/app.mjs` (the actions `open-my-profile` and `save-my-profile`, and `mark-upload-sent` from the profile section), `src/styles.css`

**Interfaces:**
- Consumes: `state.myProfile`, `state.lists.myProfile`, `controller.saveMyProfile` and `markUploadSent`, and `reviewLine`.
- Produces:
  - `myProfilePage(state)`, which returns the page HTML;
  - a form `id="my-profile-form"` with inputs named `name`, `phone`, `works`, `languages`, `otherLanguage` and `usualDays`.

- [ ] **Step 1: Write the failing tests** in `tests/profile-views.test.mjs`:
  - `shows the three sections`;
  - `email is read-only with its hint`;
  - `roles and certificates have no control` (no `input` inside the This season section);
  - `names the site coordinator, or leaves the ask out when there is none`;
  - `Upload opens the link in a new tab, or the ask text with no link`;
  - `a sent 13615 shows Waiting for review · sent <date>`;
  - `a returned 13615 shows the reason with I've uploaded it`;
  - `escapes the reason`;
  - `loading and failed states`.
  - In the sidebar tests (`git grep -l "Signed in as" tests/*.test.mjs`):
    - `a cleared window's account row is the My profile link`: the button's first line is "My profile", and its second, smaller line is the signed-in name;
    - `an uncleared admin's account row is plain text`: "Signed in as <name>", with no button.
- [ ] **Step 2: Implement.**
  - For a cleared window, the account row is `button(…, "open-my-profile", "nav-link account-link")`. Its content is `<span>My profile</span><small class="account-name">${esc(name)}</small>`, and it gets `aria-current="page"` on the screen. On the setup screen (`board` false) it stays the plain "Signed in as <name>".
  - Check that `readSignedInAs` in `tests/browser.mjs` still finds the name, and adjust it, not the other tests, if it read the "Signed in as" text.
  - Route `my-profile` in the cleared branch of the page switch, with the frame "MY PROFILE" / "My profile".
- [ ] **Step 3: Run `npm test`.** Expected: PASS.
- [ ] **Step 4: Commit.**

### Task 8: Browser tests

**Files:**
- Modify: `tests/browser.mjs`

**Interfaces:**
- Consumes: everything above, through the UI only.

- [ ] **Step 1: Add the block** `test("A volunteer edits My profile and re-sends a Form 13615", { timeout: 300_000 }, …)` next to "A site coordinator changes Season settings". It uses its own `createBrowserFixture()`, in Chrome only, with the comment style of that block. Steps, each with a `step(name)` timing mark:
  1. A cleared Preparer opens My profile from the account row.
  2. They change the phone to a fictional `555-0142`, tick Monday and Saturday, rename themselves "Jordan Vale", and save. The toast says "Profile saved", the account row shows "Jordan Vale", and after a reload the days are still ticked.
  3. They press I've uploaded it. The section shows "Waiting for review · sent <today>".
  4. The site coordinator opens the Preparer's drawer, presses Mark reviewed, picks "Wrong form", and presses Send back. The sent line goes, and "Last returned: Wrong form · <today>" shows in its place.
  5. The Preparer's window regains focus. My profile shows "Your site coordinator looked at this: Wrong form. Please send it again or ask them."
  6. They press I've uploaded it again. The reason line goes.
- [ ] **Step 2: Extend** "A volunteer says their uploads were sent, and an admin reviews them":
  - its photo ID Mark reviewed step picks "Can't read it" and presses Send back (if that test reviews the 13615 instead, use "Not signed");
  - after Check again, the volunteer's setup screen shows "Your site coordinator looked at this: Can't read it. Please send it again or ask them.".
- [ ] **Step 3: Run** `node --check tests/browser.mjs` and `npm test`. Expected: PASS. The blocks run in CI (Task 9).
- [ ] **Step 4: Commit.**

### Task 9: Docs and the full CI run

**Files:**
- Modify: `docs/developer/README.md` (the RPC count, thirty-one → thirty-three; `migrations/001-057`), `docs/developer/database.md` (a 057 row and a My profile section beside clearance uploads), `docs/developer/backend.md` (the RPC list, if it lists the clearance RPCs), `docs/developer/production-roadmap.md` (#242 and #246)

- [ ] **Step 1: Update the docs.** Check each count against the code with `git grep -c "create or replace function public.vitally_\|create function public.vitally_" supabase/migrations/057_my_profile.sql` and the store's RPC list; don't assume them.
- [ ] **Step 2: Run** `npm test`, `npm run build:hant -- --check` and `npx openspec validate --all`. Expected: PASS. `build:hant` should be unchanged, since no 简体 text changed.
- [ ] **Step 3: Commit, merge `main`, and push.** Get the PR's CI run, or `gh workflow run ci.yml --ref add-my-profile`, green on `checks`, `database`, `sign-in` and both `story` legs. Watch with a 45-minute timeout.
  - Record the run link and the two new blocks' timing marks for `verify.md`.
  - Download the story screenshots and look at the My profile and drawer ones.
  - If a job fails, read its log before re-running.
