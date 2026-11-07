## Why

Presenter mode was a classroom device: a demonstration account whose screens let it choose to act as Alex, Morgan or Sam, rebuild the sample cases and load a checkpoint. Real staff now sign in as themselves (#90). The seed command makes rehearsal cases (#144), and the browser story runs on role accounts (#145). Nothing needs the presenter's screens any more, and the team has agreed to remove presenter mode (#128). This step removes what a presenter sees. The database side goes in later steps, so each step can be reverted on its own.

## What Changes

**A presenter's screens**
- From: a presenter signs in to the staff screens, with a presenter panel showing:
  - the "Class workspace … sample set … sample cases" indicator;
  - a persona picker ("Acting as" Alex, Morgan or Sam);
  - Load a sample checkpoint and Reset sample cases;
  - with the demo-tools switch on, Fill fictional details.
- To: a presenter who signs in sees one plain English screen, "This account is no longer used", with "Presenter mode has been removed. Ask your site coordinator for a staff account." and Sign out. Nothing else: no board, no case data, no realtime.
- Reason: presenter mode is being removed; staff accounts and the seed replace it.
- Impact:
  - breaking for anyone still rehearsing as the presenter, who now signs in as a role account;
  - no hosted project exists;
  - the database still accepts a presenter's calls until #136.

**The chosen persona**
- From: `selectedPersonId` in the controller and the window's session storage, sent with staff actions; the sidebar shows "Acting as" or "Choose one in the presenter controls".
- To: gone. A stored `selectedPersonId` is ignored for every account.
- Impact: non-breaking for staff and clients. Staff accounts already act as their own person.

**Unchanged for now**
- The database's reset and checkpoint functions, the sample cases and the client bindings stay until #135. Nothing in the app calls them any more.
- Presenter access in the database and `p_person_id` stay until #136.

**Tests and docs**
- The browser story replaces every presenter step one for one, staying at 83 tests (see design).
- Unit tests of removed code are removed and listed in the PR. Tests that used a presenter only for ordinary staff behaviour move to a staff principal.
- The docs change:
  - `docs/setup.md` rehearses as the Site Coordinator;
  - `docs/demo-script.md` gets an out-of-date note, with the rewrite in #137;
  - `docs/developer/frontend.md` and `backend.md` lose their presenter rows.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `sign-in`: adds the requirement that a presenter account gets a plain "no longer used" screen and no staff screens.
- `staff-case-work`: the persona-picker requirement is replaced under the title "Staff screens have no persona picker or presenter controls", with "A presenter gets no staff screens" in place of "A presenter's screens are unchanged".
- `case-lifecycle`: "Screening starts when an admin first opens a case" depends on the signed-in staff member being an admin, not on a selected persona; the persona-switch clauses go.
- `screen-states`: the presenter's reset and checkpoint leave the errors, busy-button and confirmation requirements (the last replaced as "Every confirmation dialog has the same shape"); "The toast is never inert" uses the "Ask the preparer for corrections" toast.
- `demo-tools`: the presenter wording becomes a staff account.

## Impact

- **Code:**
  - `src/presenter-views.mjs` is removed;
  - `src/views.mjs` loses the panel, the "Acting as" sidebar and the presenter's screens, and gains the plain screen;
  - `src/controller.mjs` loses `selectedPersonId`, the persona selection and the presenter-only loads;
  - `src/window-state.mjs` stops saving and restoring the persona;
  - `src/app.mjs` loses the reset, checkpoint, `select-person` and panel-fill handlers;
  - CSS for the panel goes.
  - `src/ui.mjs` loses `confirmBody`'s `note.inForm` option, which only the checkpoint dialog used;
  - `src/client-text.mjs` loses the 简体 entries for the removed controller refusals, and `src/zh-hant.mjs` is regenerated with `npm run build:hant`. The client-facing "Sample cases were reset." notices stay for #135.
- **Tests:**
  - unit tests of removed code are removed;
  - presenter-principal tests of shared staff behaviour are converted;
  - new tests cover the plain screen and the ignored stored key;
  - `tests/browser.mjs` and `tests/support/story-pages.mjs` change.
- **Checks:** `npm test`, `npm run test:browser`, `npm run test:auth-browser`, `npm run build:hant -- --check` and `npx openspec validate --all`. There's no database change.
- **Systems:** none. Browser and local server only.
- **Issue:** #134, part of tracking issue #128. Settles #58's "Presenter tools" rows.
