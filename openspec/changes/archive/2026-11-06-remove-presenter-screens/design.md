## Context

Presenter mode is being removed in steps (#128):
- the database tests act as role accounts (#142);
- a local seed replaces "Reset sample cases" for rehearsals (#144);
- the browser story's main path runs as the role accounts (#145);
- the fill buttons are gated by the demo-tools switch, not by presenter access (#143).

What's left of presenter mode in the app is the **presenter's screens**:
- **The presenter panel,** `src/presenter-views.mjs`, which holds:
  - the "Class workspace … sample set … sample cases" indicator;
  - a connection line;
  - the persona picker ("Acting as");
  - Load a sample checkpoint;
  - Reset sample cases;
  - the office's Fill fictional details, when the demo-tools switch is on.
- **The chosen persona,** `selectedPersonId`, in the controller's state and in the window's session storage (`src/window-state.mjs`). The controller sends it as `p_person_id` for a presenter, and the sidebar shows "Acting as" for it.
- **A presenter counted as a staff window.** `isStaffWindow` (`src/contracts.mjs`) and `staffWindow()` in the controller both treat a presenter as one, so a presenter gets the work board, the case pages and the office screens.

**Constraints:**
- Staff screens stay English.
- No database change: the reset and checkpoint functions, the sample cases and the client bindings stay until #135. Presenter access and `p_person_id` stay until #136.
- The browser story's standing rule: no check is removed silently, and nothing is trimmed to fit the time limit.
- Fictional data only.

## Goals / Non-Goals

**Goals:**
- A presenter who signs in sees one plain screen and nothing else.
- No screen offers a persona, a reset, a checkpoint or the class-workspace indicator.
- `selectedPersonId` no longer exists in the app. A stored value is ignored.
- Every browser-story step that used these screens is replaced one for one. The story stays at 83 tests.

**Non-Goals:**
- Database changes, including the reset, checkpoint and sample-case functions (#135) and presenter access (#136).
- The roster command's presenter support (#136).
- Rewriting the demo script (#137).
- Changing `PERMUTATION_TIMEOUT_MS` (#126).

## Decisions

### D1: A presenter gets one plain screen
- **Choice:**
  - When the signed-in principal's access is `presenter`, `app.mjs` renders a single screen: the heading "This account is no longer used", the text "Presenter mode has been removed. Ask your site coordinator for a staff account.", and a Sign out button using the existing sign-out action.
  - The controller loads no cases, people, assistance requests or workspace row for a presenter, and starts no realtime subscription.
  - The screen is English only, like other staff screens. It has no `client-text` entries.
- **Why:** issue #134 asks for a plain message. Loading nothing keeps a presenter from seeing any case data through the app.
- **Alternatives considered:**
  - Refusing the sign-in. Rejected: sign-in and access belong to #136, and the sign-in gate tests would change.
  - Sending the presenter to the client screens. Rejected: wrong, and confusing.

### D2: A presenter is no longer a staff window
- **Choice:**
  - `isStaffWindow` (`src/contracts.mjs`) and the controller's `staffWindow()` return true for `staff` only. The controller's `presenter()` helper and every branch that depends on it go: persona selection, the persona sent with actions, `requirePresenter`, the reset and checkpoint requests, and the presenter-only workspace-row load.
  - `src/supabase-store.mjs` keeps its `presenter` entry in the read tables. It is unused once the controller loads nothing for a presenter, and it goes with presenter access in #136. That's the builder's call: it limits this change to the screens.
- **Why:** this is the one switch that takes a presenter out of every staff screen.
- **Alternatives considered:** checking the presenter at each screen. Rejected: too many places, and too easy to miss one.

### D3: The presenter panel, the persona picker and the indicator go
- **Choice:**
  - `src/presenter-views.mjs` is removed: the panel, the persona picker, the reset and checkpoint dialog bodies and `CHECKPOINT_LABELS`.
  - In `src/views.mjs`, the panel's placement goes, as do the sidebar's "Acting as" / "Choose one in the presenter controls" block and the presenter branch of the staff frame.
  - In `src/app.mjs`, these handlers go: `select-person`, `open-reset-fixtures`, `confirm-reset-fixtures`, `open-checkpoint`, `confirm-checkpoint`, and the panel's `fill-assisted-intake` placement. The office's own Add a case fill stays.
  - `src/styles.css`: the `.presenter-panel` and `.persona-*` rules go.
  - `src/ui.mjs` `confirmBody`: the `note.inForm` option goes. Only the checkpoint dialog used it, and a note now always comes before the form (screen-states).
  - `src/client-text.mjs`: the 简体 entries go for each controller sentence this change removes:
    - "Choose a volunteer persona to act as.";
    - "This checkpoint is not available.";
    - "Checkpoints belong to the sample cases only.";
    - "This sample case is no longer on screen.";
    - the two "Only the person running the session can …" refusals.

    Each is removed only if its sentence no longer appears anywhere in `src/` after the change. Then `npm run build:hant` regenerates `src/zh-hant.mjs`, and both files are committed.
  - **Kept for #135:** the client-facing "Sample cases were reset." notices, because the reset itself still exists in the database until then.
- **Why:** nothing can reach them once a presenter is not a staff window (D2). Leaving them would be dead code.
- **Alternatives considered:** a reset-only presenter page until #135. Rejected: it contradicts the plain message, and the seed replaces the reset.

### D4: `selectedPersonId` goes, and a stored one is ignored
- **Choice:**
  - The controller's `selectedPersonId` state, `selectPerson`, the linked-persona drop and the persona restored on reload all go.
  - `window-state.mjs` drops the key from what it saves. When it restores, it ignores a `selectedPersonId` left in session storage by any earlier window, for every access. Today it is dropped only for staff.
  - The controller always sends `p_person_id: null`. Staff already do: the database derives the acting person from the account (migration 038).
- **Why:** a persona is meaningless without the picker. Ignoring a leftover keeps an old tab from acting oddly.
- **Alternatives considered:** clearing session storage on sign-in. Rejected: it would also wipe a window's other saved place, the open case and the filters.

### D5: Canonical specs change only where behaviour changes
- **Choice:** delta specs for five capabilities:
  - **sign-in:** ADDED, a presenter gets the plain screen.
  - **staff-case-work:** REMOVED "A staff account's screens have no persona picker or presenter controls" and ADDED "Staff screens have no persona picker or presenter controls". The staff rules are unchanged. The scenario "A presenter's screens are unchanged" becomes "A presenter gets no staff screens".
  - **case-lifecycle:** MODIFIED, screening starts for an admin staff member; the persona clauses go.
  - **screen-states:**
    - MODIFIED, the errors requirement (the checkpoint refusal and the "person running the session" refusal go; "A refusal inside a dialog" now uses the corrections dialog), the busy-button list and the inert-toast scenario;
    - REMOVED "Every confirmation has the same shape" and ADDED "Every confirmation dialog has the same shape", without the reset and checkpoint dialogs and with a note always before the form.
  - **demo-tools:** MODIFIED, the presenter wording. "A presenter without the switch" now says the presenter sees only the plain screen, and "Staff without the switch" is added.
- **Why REMOVED + ADDED twice:** OpenSpec 1.14 refuses a MODIFIED block that drops a scenario. Two scenarios can't stay true under their names: "A presenter's screens are unchanged" and "A note inside the form". Their requirements are replaced under a new title.
- **Left alone:**
  - review-and-corrections' checkpoint scenario, a database behaviour that goes in #135;
  - the loose "office persona" wording in office-follow-up and review-and-corrections, whose behaviour is unchanged.
- **Why:** CLAUDE.md says specs cover what a change touches, and no more.

### D6: The browser story replaces each presenter step one for one
Each step below is replaced, so the count stays at 83.

| Step today | Replacement |
|---|---|
| Sign-in: the presenter in its own window | The presenter signs in through the real form and gets the plain screen. It has no board, no picker, no reset, no checkpoint and no indicator, and Sign out works. |
| "the presenter's reset leaves exactly the ten sample cases" | "the board starts with no cases" |
| "staff persona switches and a staff reload leave the client window where it was" | "a staff reload leaves the client window where it was" |
| Contact log: switching persona drops someone else's open edit form | In one window, the Site Coordinator opens Edit on the Preparer's entry, signs out, and the Reviewer signs in in that window. No edit form is left, and the Reviewer has no Edit. |
| "two presenter windows in one browser keep their own persona" | "two windows of one staff account in one browser keep their own place": two Preparer tabs in one context, each on a different case, each surviving its own reload. |
| "a reset rebuilds the samples and leaves the class's own work alone" | "a second seed run replaces its set and leaves the class's own work alone" |
| "two staff accounts…": the presenter window keeps its controls | That window shows the plain screen. The staff windows' "no picker, reset or checkpoint" checks and the leftover-persona check stay. |

Where the moved checks land:
- **"the board starts with no cases":**
  - the toast-outside-inert check moves to the "Ask the preparer for corrections" toast (D7);
  - the version-2 check moves to the seed step;
  - the "eight cases" screenshot moves to the seed step.
- **The staff reload step:** the reload, the client window's isolation and the office half (screening, the second admin window) stay. "The staff window forgot its own persona" becomes "the staff window kept its own case and tab".
- **The second seed run:** it keeps the reset step's live-update, keyboard-focus and refusal checks. It also hands "a claim unlocks the phone on the board in another window" its fresh unclaimed `preparation_ready` case.

**The seed step:**
- Its "board counts 10 first" check becomes **0**. The story's workspace gets no sample cases from setup. The initializer records bindings only; the reset was the only source, as confirmed in the brainstorm (Q6).
- The help-request step finds only the seed's help row.

**Why:** the standing rule, and the user's explicit agreement to each row.

### D7: "The toast is never inert" uses the corrections toast
- **Choice:**
  - With the reset gone, the earliest confirmation in the story that ends in a toast is the Reviewer's **"Ask the preparer for corrections"**. Its toast reads "The preparer was asked for corrections." (`STAFF_NOTICES.REQUEST_CORRECTIONS`).
  - The story checks the toast's live region is outside anything inert right after that dialog closes.
  - The screen-states scenario names that toast.
- **Why:** it is early, it exists, and screen-states already counts it among its confirmations.

### D8: Unit tests
- **Choice:**
  - Tests of removed code are removed. For example, `tests/presenter.test.mjs` and the presenter cases in `tests/shell.test.mjs`, `tests/controller.test.mjs`, `tests/window-state.test.mjs` and `tests/office-views.test.mjs`, wherever they test the panel, the picker, `selectedPersonId` or the reset and checkpoint handlers.
  - Tests that use a presenter principal only to exercise ordinary staff behaviour are converted to a staff principal.
  - New tests cover:
    - the presenter's plain screen and that nothing loads for it;
    - `isStaffWindow` for presenter and staff;
    - a stored `selectedPersonId` ignored for every access.
- **Why:** the user agreed. Removals are visible because the PR lists each removed test, with the code it tested, and the unit count before and after.

## Risks / Trade-offs

- [Risk] The browser story is close to its 900 s per-order limit.
  - The presenter steps saved about 38–53 s per Chrome-client order. The second seed run (17–48 s) and the contact log's sign-out and sign-in (about 5 s) add about that much back.
  - Mitigation: if the run happens while the limit is still 900 s and an order goes over, stop and show the user the per-step timings. Trim nothing. The user's proposal to raise it to 1200 s (#126) is a separate PR.
- [Risk] A presenter's calls are still accepted by the database until #136, for someone who makes them by hand.
  - Accepted: the data is fictional, nothing in the app sends them, and #136 removes the access.
- [Risk] Someone rehearsing as the presenter loses the screens.
  - Mitigation: `docs/setup.md` rehearses as the Site Coordinator with the seed, and the presenter screen says to ask for a staff account.
- [Trade-off] The reset and checkpoint database functions stay with no app caller until #135.
  - Accepted: they keep their database tests, and removing them is #135's scope.
- [Trade-off] The contact log's "person changes in one window" check now costs a sign-out and sign-in.
  - Accepted, as the only way to keep that check without personas.

## Migration Plan

- No deployment or database migration. The change is browser code, tests and docs.
- People rehearsing locally re-run nothing. They sign in as the role accounts from the example roster, and seed with `npm run seed:local`.
- **Rollback:** revert the PR. The database still supports the presenter fully until #135 and #136, so the old screens work again after a revert.
- **Acceptance:**
  - `npm test`, with the unit count before and after and the removed tests listed;
  - `npm run test:browser`, alone on the local stack, at 83 tests with nothing trimmed and the count before and after;
  - `npm run test:auth-browser`;
  - `npm run build:hant -- --check`;
  - `npx openspec validate --all`.

## Open Questions

- (none) The time limit (#126) is the user's. It decides only whether a slow run stops for the user (Risks).
