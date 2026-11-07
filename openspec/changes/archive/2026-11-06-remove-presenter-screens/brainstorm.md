# Brainstorm: remove-presenter-screens

This is the decision log from the brainstorm with the user, held in conversation on 2026-11-06 and recorded at propose. The decisions aren't reopened here. A **builder's call** marks a choice the conversation left to the builder.

## Background

Presenter mode is coming out in steps, so that each pull request keeps `main` green (#128):

1. **#130 / PR #142:** the database tests act as role-named staff accounts. Merged.
2. **#131 / PR #144:** `npm run seed:local`, a seed command for the local stack only. Merged.
3. **#132 / PR #145:** the browser story signs in as the role accounts and gets its cases from the seed. Merged.
4. **#133 / PR #143:** `gate-demo-tools`, the fill buttons only on local demo stacks. Merged.
5. **#134, this change:** remove the presenter screens.
6. **#135:** `remove-sample-case-tools`, which removes the database side of the reset, the checkpoints, the sample cases and the client bindings.
7. **#136:** `remove-presenter-access`, which takes `presenter` out of access checks, along with `p_person_id` and the persona rule.
8. **#137:** a docs-only rewrite of the demo script.

#138 is the volunteer roster, part of the separate admin-side work.

**Today:** a presenter account signs in to the staff screens with a **presenter panel** (`src/presenter-views.mjs`). The panel holds:
- the "Class workspace … sample set … sample cases" indicator;
- a connection line;
- the **persona picker** ("Acting as", choosing Alex, Morgan or Sam);
- **Load a sample checkpoint**;
- **Reset sample cases**;
- with the demo-tools switch on, the office's "Fill fictional details".

The chosen persona is `selectedPersonId`. It lives in the controller's state and the window's session storage (`window-state.mjs`), and it is sent with every staff action as `p_person_id`. The sidebar shows "Acting as" or "Choose one in the presenter controls".

## Scope

**In:** everything a presenter sees in the app goes:
- the presenter panel, including its reset, checkpoint and fill buttons;
- the persona picker;
- `selectedPersonId`;
- the "Class workspace" wording.

A presenter who signs in gets a plain message instead.

**Out:**
- the database side of the reset and checkpoints, the sample cases, the client bindings and `sampleCaseOwners` (#135);
- presenter access in the database, `p_person_id` and the persona rule (#136).

## Decisions

**Q1. The reset and checkpoint buttons go now.** They exist only inside the presenter panel, so they go with it.
- Their database functions stay until #135 and are still covered by the database suite (`tests/database-fixtures.mjs` and the others that call them). Nothing in the app calls them any more.
- The seed (`npm run seed:local`) replaces the reset for rehearsals.
- Rejected: keeping a reset-only presenter page until #135. It contradicts "a presenter login gets a plain message".

**Q2. What a presenter sees.**
- After a presenter signs in, the app shows a plain English screen headed **"This account is no longer used"**, with the text **"Presenter mode has been removed. Ask your site coordinator for a staff account."** and **Sign out**.
- Nothing else: no board, no case data loaded, no realtime subscription.
- Staff screens stay English, so this screen has no 简体 or 繁體 version.
- Until #136, the database would still accept a presenter's calls if someone made them by hand. That's acceptable on fictional data, and the design records it.

**Q3. Canonical specs change only where behaviour changes:**
- **sign-in:** ADDED: a presenter account gets the plain message and no staff screens.
- **staff-case-work:** the requirement "A staff account's screens have no persona picker or presenter controls" loses its scenario "A presenter's screens are unchanged". That scenario becomes "a presenter gets the plain message". The rest stays, including "a leftover persona in storage is ignored".
- **case-lifecycle,** "Screening starts when an admin first opens a case":
  - "its selected persona is an admin" becomes "the signed-in staff member is an admin";
  - the clauses about switching the persona to an admin, and about a window acting as a volunteer persona, go.
- **screen-states:**
  - the presenter's reset and checkpoint come out of the busy-button list and the confirmation-shape list;
  - the checkpoint-dialog refusal scenario goes;
  - the checkpoint note-placement scenario goes;
  - "The toast is never inert" moves to another toast (Q8).
- **demo-tools:**
  - the scenario "A presenter without the switch" becomes a staff account;
  - "a presenter included" is reworded.
- **Not touched:**
  - review-and-corrections' checkpoint scenario and the database side, which stay for #135;
  - the loose "office persona" wording in office-follow-up and review-and-corrections, whose behaviour doesn't change.

**Q4. App internals that go:**
- `src/presenter-views.mjs` as a whole;
- the panel, sidebar and "Acting as" pieces in `views.mjs`;
- `selectedPersonId` in the controller and `window-state.mjs`: choosing a persona, sending one, and dropping a linked persona;
- the workspace-row load that exists only for the presenter's sample-set indicator;
- the presenter branches in `app.mjs`'s handlers: reset, checkpoint, `select-person`, and the panel's fill.

A stored `selectedPersonId` is ignored for every account from then on.

**Unit tests:**
- Unit tests of removed code go with it, for example `tests/presenter.test.mjs`. The user agreed.
- New unit tests cover the plain screen and the ignored stored key.
- **Builder's call:** many unit tests use a presenter principal only to exercise ordinary staff behaviour, which a staff account shares. They are **converted to a staff principal**, not removed, and the PR counts them as converted. Only tests of removed code are removed. (`staffWindow()` in the controller accepts a presenter today; after this change it doesn't.)
- The PR lists every unit test removed, names the code it tested, and gives the unit count before and after, so a reviewer can match each removal to removed code.

**Q5. The browser story: every presenter step is replaced, none dropped.** The standing rule is that no check is removed silently. Each step below is replaced one for one, so the browser test count stays at **83**.

| Step today | What goes | Replacement |
|---|---|---|
| Sign-in: the presenter in its own window | the presenter's work board | The presenter signs in through the real form and gets the plain message. It has no board, no picker, no reset and no checkpoint, and Sign out works. |
| "the presenter's reset leaves exactly the ten sample cases" | the reset, the indicator, the ten sample keys | **"the board starts with no cases"**. The toast-outside-inert check moves to the corrections toast (Q8). The version-2 check and the "eight cases" screenshot move to the seed step. |
| "staff persona switches and a staff reload leave the client window where it was" | the persona switches; "the staff window forgot its own persona" | **"a staff reload leaves the client window where it was"**. The reload, the client window's isolation and the office half (screening, the second admin window) stay. "Forgot its own persona" becomes "kept its own case and tab". |
| Contact log: switching persona drops someone else's open edit form | the persona switch | In one window, the Site Coordinator opens Edit on the Preparer's entry, **signs out, and the Reviewer signs in in that window**. No form is left open, and the Reviewer gets no Edit. That keeps "the person changes in one window", at the cost of one sign-in. |
| "two presenter windows in one browser keep their own persona" | personas | **"two windows of one staff account in one browser keep their own place"**: two tabs of the Preparer, each on a different case, and each surviving its own reload. That's the same per-tab session storage, without personas. |
| "a reset rebuilds the samples and leaves the class's own work alone" | the reset | **"a second seed run replaces its set and leaves the class's own work alone"**, keeping the same live-update, keyboard-focus and refusal checks. It also gives "a claim unlocks the phone…" a fresh unclaimed case (Q9). |
| "two staff accounts…": the presenter window keeps its controls | the presenter's controls | That window shows the plain message. The staff windows' "no picker, reset or checkpoint" checks and the leftover-persona check stay. |

**Q6. The seed step's "board counts 10 first" check becomes 0.**
- The user asked for this to be confirmed first. Before the change it was:
  - the database initializer (`vitally_private.initialize_workspace`, last redefined in migration 038) records the client bindings but inserts no cases or help requests;
  - neither the browser fixture nor the story calls `seedFixtures` or the reset function directly;
  - the only sample sources are the story's two `resetSampleCases` calls;
  - in the last run (#145, run 6) the presenter's indicator read "sample set 0 · 0 sample cases" just before the first reset.
- With the reset gone, the story never makes sample cases.
- The help-request step's "first help row" then sees only the seed's row.
- #135 has nothing left to change in the story.

**Q7. The time budget.**
- **Saved:** the presenter-only steps took about 38–53 s per Chrome-client order in #145's run 6, and about 27–38 s per Firefox-client order.
- **Added:** the second seed run (17–48 s) and the contact log's sign-out and sign-in (about 5 s).
- **Net:** roughly zero, with the Chrome-client order still at about 790–870 s.
- **The limit:** the user has proposed raising it to 1200 s in #126, in a separate direct PR after Sunday.
- **The rule:** if this change's browser run happens while the limit is still 900 s and an order goes over, stop and show the user the per-step timings. **No trimming.** This change never changes the limit itself.

**Q8. The toast for "The toast is never inert": "Ask the preparer for corrections".**
- The user asked for an early confirmation toast that exists, named in the design.
- With the reset gone, the earliest confirmation in the story that ends in a toast is the Reviewer's **"Ask the preparer for corrections"**. Its toast reads "The preparer was asked for corrections." (`STAFF_NOTICES.REQUEST_CORRECTIONS` in `src/app.mjs`).
- screen-states already counts that dialog among its confirmations.

**Q9. A fresh unclaimed case for "a claim unlocks the phone on the board in another window".** It comes from the second seed run (Q5). The seeded `preparation_ready` case from the first run is already claimed by the race step. No `tools/` change.

**Q10. Docs:**
- **`docs/setup.md`:**
  - "Use them" signs in as the Site Coordinator, not the presenter;
  - the presenter account is described as showing the plain message;
  - "Reset sample cases" is described as gone from the screens.
- **`docs/demo-script.md`:** an out-of-date note. The rewrite is #137.
- **`docs/developer/frontend.md`** and **`docs/developer/backend.md`:** the presenter panel and persona rows.

**Q11. #58.** This change settles #58's "Presenter tools" rows. The PR says so and links #58 without closing it, because #135 settles its sample-case rows.

## Dependencies

- **Ready:**
  - the seed module (`tools/admin/seed-cases.mjs`, #144);
  - the story on role accounts (#145);
  - the demo-tools switch (#143).
- **Unknown timing:** the time limit (#126). It doesn't block this change, but it decides whether a slow run stops for the user (Q7).
- **After this change:** #135 and #136. Nothing here waits on them.
- **No hosted systems.**

## Acceptance

- **`npm test`:** the unit count before and after is in the PR, with every removed test listed.
- **`npm run test:browser`:** run alone on the local stack, nothing else using `127.0.0.1:54321`. It stays at 83 tests with nothing trimmed, and the PR gives the count before and after. Q7's rule applies to the time limit.
- **`npm run test:auth-browser`:** the sign-in screens change for a presenter.
- **`npm run build:hant -- --check`.**
- **`npx openspec validate --all`.**
- **No database suite:** the change has no database change.
