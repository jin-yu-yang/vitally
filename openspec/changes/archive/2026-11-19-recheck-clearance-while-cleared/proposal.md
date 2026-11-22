## Why

A staff window reads `vitally_my_clearance()` at sign-in, and re-reads it only while the
person is uncleared. When an admin changes a cleared person's roles mid-session, that
person's window goes stale until a reload:
- an added role shows no new buttons;
- a narrowed role keeps buttons the server refuses with `FORBIDDEN` or `INELIGIBLE`;
- losing every role leaves an empty work board until the next action.

The server is always right; only the window lags. This is the last clearance follow-up for
#138 (#190).

## What Changes

**When a cleared window re-reads clearance**
- From: never, once cleared. Only an uncleared window re-checks, on Check again and on
  window focus.
- To: a cleared window re-reads `vitally_my_clearance()` (single-flight, through
  `checkClearance`):
  - on wake events: window focus, the tab becoming visible, `online`, reconnecting;
  - after any `FORBIDDEN` or `INELIGIBLE` refusal;
  - after the signed-in admin saves their own Roster row.

  The refresh after a successful action does not re-read. On wake, the clearance is read
  before the lists, so a window that is no longer cleared goes straight to the setup screen.
- Reason: buttons should follow current roles without a reload, for a small RPC that
  isn't on every action.
- Impact: non-breaking. One extra small RPC per wake event or refusal. No realtime change.

**What the window shows when its capabilities change**
- From: buttons update only after a reload. Drawers are not checked against capabilities.
  Losing Admin on All cases or Add a case silently shows the work board, with the screen
  kept in session and the Add a case draft hidden.
- To:
  - the buttons, frame and screens redraw from the new effective capabilities;
  - a drawer, dialog or Add a case page whose action needs a capability the person lost
    keeps its typed text, and replaces its submit button with "Your roles changed, so you
    can't send this any more.";
  - All cases falls back to the work board;
  - Follow-ups and an office case page stay put and redraw as the work board and the
    volunteer case page.
- Reason: the staff screens must not offer what the server will refuse, and must not
  throw away what the person typed.
- Impact: non-breaking. Staff screens only, English text only.

No migration, RPC, policy, realtime publication or catalogue change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `volunteer-clearance`:
  - a cleared staff window re-reads its clearance on wake events, after a
    `FORBIDDEN`/`INELIGIBLE` refusal, and after saving its own Roster row;
  - its buttons, drawers and screens follow the new effective capabilities without a
    reload.

## Impact

- **Code:**
  - `src/controller.mjs`: `refresh`, the wake listeners (adds `visibilitychange`),
    `recheckClearance`, `recheckAfterOwnSave`, `noteFailure`, and the screen fallback;
  - `src/app.mjs`: passes the document for `visibilitychange`;
  - the views that render drawer submits and the Add a case Save draft and Send to the office buttons:
    `src/views.mjs`, `src/office-views.mjs`, `src/staff-views.mjs`, `src/pool-views.mjs`,
    `src/ui.mjs` as needed.
- **Tests:**
  - `tests/controller.test.mjs` for the re-check moments, single-flight and the screen
    fallback;
  - view tests for the swapped submit lines;
  - the browser story only if it needs updating.
- **Server:** no change. `vitally_my_clearance()` is used as it is.
- **Load:** a few hundred bytes per wake event or refusal. Nothing added to realtime (#165).
