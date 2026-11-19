# Brainstorm: recheck-clearance-while-cleared (#190)

Raw capture of the design agreed in conversation on 2026-11-19. Part of #138; the last
clearance follow-up from `add-volunteer-clearance` (retrospective §5, final review Minor 2).

## Background: what happens today

- A staff window reads `vitally_my_clearance()` at sign-in (`load`) and re-reads it only
  while the person is **uncleared**: Check again, and `refresh()`'s uncleared branch (focus,
  `online`, reconnect). Once cleared it never reads it again.
- After an admin changes that person's roles mid-session:
  - an **added** role shows no new buttons until a reload;
  - a **narrowed** role keeps showing buttons the server refuses with `FORBIDDEN` or
    `INELIGIBLE`.
  - **every role removed:** the work board stays up, RLS quietly returns empty lists on the
    next refresh, and only the next action (refused `NOT_CLEARED`) switches to the setup
    screen.
- The server is always right; only the window goes stale. The volunteer-clearance spec says
  nothing about a cleared window re-reading.

What the code already gives us (read in `src/controller.mjs`, `src/clearance.mjs`,
`src/views.mjs`, `src/staff-views.mjs`):

- The buttons and the frame follow the person's own `people` entry. `staffEligibility`
  reads its `capabilities`, and `isAdmin(person)` picks between the office frame and the
  work board. `recheckClearance` already rewrites that entry with `withOwnCapabilities`.
  So a fresh answer plus a redraw shows the right buttons.
- Nothing the window **reads** depends on effective capabilities. Case policies are gated
  by clearance only, and `screenAllowed` checks only the ceiling, for Post an update. A
  role change means a redraw, never a list re-read.
- `checkClearance()` is single-flight and never rejects. `recheckClearance()` already
  handles uncleared → cleared (`loadWork`) and cleared → uncleared (`dropWork`). Its
  cleared → cleared path falls through to an extra `readFeed()` that a refresh already does.
- `refresh()` runs on wake events (focus, `online`, reconnect) **and** after every
  successful action (`controller.mjs` ~2930).
- `recheckAfterOwnSave` (#217) re-checks after an admin saves their own Roster row, but
  only while uncleared.
- Roster tables are not in the realtime publication.

## Decision chain

### Q1. When does a cleared window re-read clearance?

Approaches considered:

1. **Inside every `refresh()`.** Simplest. But it adds one RPC to every successful action,
   while a role change in the middle of a run of actions is rare.
2. **On wake events, plus after a `FORBIDDEN`/`INELIGIBLE` refusal.** Wake catches an added
   role the next time the person comes back to the window. The refusal is the evidence of a
   narrowed role, at the moment it matters.
3. **Polling on a timer.** Rejected. It costs something even when the window is idle, and
   nothing else in the app polls.
4. **Realtime** (see Q4). Rejected.

**Decision: approach 2.**

- **Wake events:** window focus, `visibilitychange` when the tab becomes visible (added at
  the user's request), `online`, and reconnecting. These call `refresh` with a "wake" flag.
  The refresh after an action doesn't set it.
- **Order in a wake refresh, cleared branch:** `await checkClearance()` first.
  - If the window is no longer cleared, the existing cleared → uncleared path drops the
    work and the refresh stops there. It doesn't read lists that RLS would answer empty.
    This closes the "every role removed" gap.
  - If it's still cleared, the normal re-read follows.
- **After a refusal:** a `FORBIDDEN` or `INELIGIBLE` refusal in a cleared staff window also
  starts `void checkClearance()`.
  - The refusal stays on screen, and the buttons underneath catch up.
  - `INELIGIBLE` also comes from assigning someone who isn't cleared (`ASSIGN_CASE`).
    There the re-check is expected and harmless: one call, and nothing changes.
- **Single-flight:** everything goes through `checkClearance()`. A focus, a
  `visibilitychange` and a refusal arriving together send one request.
- **Cleared → cleared with nothing changed:** no redraw and no extra `readFeed()`. "The
  same" means the same effective capabilities and the same `isAdmin`.
- **Cost:**
  - one small RPC per wake event, on top of the 5 to 6 reads a refresh already makes
    (about 15% more);
  - one RPC per `FORBIDDEN`/`INELIGIBLE` refusal;
  - the answer is a few hundred bytes;
  - Supabase's free tier caps egress and compute, not request count;
  - nothing is added to #165's realtime load: no channel or publication changes.

### Q2. Saving your own Roster row while cleared

**Decision: always re-check.** `recheckAfterOwnSave` drops its `awaitingClearance`
condition: wait for any check already out, then check once more.
- If the admin removes every one of their own roles, the window goes cleared → uncleared.
  `dropWork` keeps a ceiling admin on the Roster.
- If they remove only Admin, they move from the office frame to the work board and keep
  the Roster link, because the Roster follows the ceiling.

### Q3. Capabilities change while a drawer, dialog or form is open

Options offered: close the drawer with a notice, or leave it open and let the server
refuse. **The user chose neither:**

- **Drawers stay open.** In a drawer or dialog whose action needs a capability the person
  no longer has, the submit button is replaced by an explanation line: "Your roles changed,
  so you can't send this any more." This is the same pattern the case page uses when it
  swaps a form for its explanation line.
- **Typed text stays.**
- **If a refusal triggered the check, the refusal stays visible too.**
- **The case page** keeps its existing behaviour. A form the person can no longer use is
  replaced by its existing explanation line (for example "Needs preparation eligibility.").
  The draft stays in `state`, neither discarded nor saved, and comes back if the role does.

Which drawers are capability-gated was checked against each RPC in the migrations:

- **Ceiling drawers: these never swap.** Their RPCs check `vitally_policy.is_workspace_admin`
  (044), which reads `people.capabilities`, or no capability at all.
  - **Volunteer drawer:** `vitally_save_volunteer` (045), plus the 047 account RPCs
    `prepare_account`, `record_account`, `deactivate_account`, `reactivate_account` and
    `cancel_invitation`.
  - **Send invitation** (volunteer and client) and **Cancel invitation:** the accounts
    edge function calls `prepare_account` or `record_account` as the user.
  - **Deactivate account.**
  - **Who has read it, Unpublish, Delete draft:** `vitally_posted_updates` and
    `vitally_update_action` (049).
  - **Notifications:** `vitally_my_updates` and `vitally_mark_updates`. These check for
    staff only, with no capability.
- **Effective-capability drawers: these swap.** Their RPCs go through `acting_person` or
  `contact_person`, which replace `people.capabilities` with the effective ones (045).
  - **Assign:** `ASSIGN_CASE`, needs `admin`.
  - **Log call:** needs **`followup`**. Every form in the drawer belongs to an open
    follow-up task. A linked contact checks `followup` in `vitally_log_contact`
    (045:689), and Resolve sends `RESOLVE_FOLLOWUP`, which also checks `followup`.
  - **Resolve help:** `ASSISTANCE:RESOLVE`, needs `assist`.
  - **Ask for corrections:** `REQUEST_CORRECTIONS`, as the case's reviewer, needs
    `review`.
  - **Close unsigned:** needs `admin`.
  - **Case-action confirmations that need `admin`:** Close case, Put on hold, Resume from
    hold, Mark ready to e-file, Mark e-filed, Record filing result, Return to signing,
    Request documents (at intake).
- **Need no capability, so they never swap:**
  - Help, Regenerate, Print and Withdraw are client dialogs.
  - Leave-add-case calls no RPC.
  - These are listed in the table as needing no capability, not left out of it. Every
    dialog then has to pick a category, and a new one fails the classification test until
    it does (the user's call at plan review).

### Q4. Realtime instead?

**No, agreed with the user.** The roster tables would have to join the publication, and
that is the load #165 is about. Role changes are rare and come from an admin, and wake plus
refusal covers both directions. Instant delivery, if anyone wants it, belongs in #165's
measurement work.

### Q5. Where a person lands when losing Admin moves them out of the office frame

Settled at the user's request. The office frame and the work board share screens, so most
screens stay put and change how they look:

- **Follow-ups** (screen `staff` in the office frame) stays on the same screen, which
  becomes the **Work board**. Nothing navigates.
- **All cases** (`office-cases`) moves to the **Work board**, with keyboard focus moved to
  it like any screen change.
  - The controller sets `state.screen` itself. Today only the view falls back, and a stale
    `office-cases` would jump them back there if Admin returned.
- **An office case page** (`staff-case`) stays on the **same case**, shown as the volunteer
  page.
  - Its buttons follow the person's roles.
  - Contact details hide unless they're the case's preparer or reviewer (`works_on_case`).
- **Add a case** (`office-add-case`) keeps **the page and its typed draft**. Its Save
  draft and Send to the office buttons are replaced by the explanation line, as in a
  drawer. The page has no button called Create; on a new draft, both of these start with
  `vitally_create_case`. Cancel stays.
  - That swap is based on the capability `vitally_create_case` actually checks: effective
    `admin`, read through `acting_person` (045:598, 609). It is not based on the view's
    `isAdmin`.
  - Leaving the page goes through the existing "Leave without saving?" question.
  - Today the view would silently show the work board instead and lose the draft.
- **Roster and Post an update** follow the ceiling, so nothing changes.
- **Gaining Admin** is the same in reverse: the Work board becomes Follow-ups, and the case
  page becomes the office view.

## Scope

- **In:**
  - a cleared staff window re-reads `vitally_my_clearance()` on wake events
    (focus, visibility, online, reconnect), after a `FORBIDDEN`/`INELIGIBLE` refusal, and
    after saving your own Roster row;
  - it redraws by effective capabilities;
  - drawers and Add a case swap their submit for an explanation line when its capability
    is gone;
  - All cases falls back to the work board;
  - a delta spec for `volunteer-clearance`.
- **Out:**
  - realtime for roster tables;
  - polling;
  - any migration, RPC, policy or catalogue change;
  - client screens.

## Dependencies

- `vitally_my_clearance()` exists and is **ready**.
- The store's `getClearance` is **mockable** in controller tests, through the existing
  fake store.
- No migration is needed. If the design turns out to need one, stop and tell the user.

## Acceptance

- A cleared window shows the buttons of its current roles without a reload, on wake and
  after a refusal.
- Delta spec scenarios:
  - an added role;
  - a narrowed role;
  - every role removed, noticed on focus;
  - saving your own row while cleared;
  - a refusal triggering a re-check;
  - a drawer swapping its submit;
  - losing Admin on Follow-ups, All cases, an office case page and Add a case.
- Controller tests for each scenario, plus single-flight: wake plus refusal while a check
  is out means one `getClearance` call.
- View tests for the swapped submit lines.
- Checks:
  - `npm test`;
  - the browser story, because the views change: run by the PR's CI `story` jobs rather
    than the local stack (the user's call at plan review), with the run linked and its
    screenshots reviewed.
- Fictional data only. Do not merge.

## Builder's calls (not discussed; open to correction)

- `visibilitychange` is a `document` event, not a `window` event. The controller's
  `windowEvents` hook needs the document too, or an adapter in `app.mjs`, so tests can fake
  it.
- How the wake flag reaches `refresh`. A parameter on `refresh` and a separate `onWake` are
  both fine.
- The explanation line is staff text, so it's English only. Nothing is added to
  `client-text.mjs` or to 繁體.
