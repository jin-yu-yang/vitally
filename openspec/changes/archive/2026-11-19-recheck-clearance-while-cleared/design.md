## Context

`add-volunteer-clearance` gave every staff window a clearance answer, from
`vitally_my_clearance()`. The answer covers: cleared, what is missing, the effective
capabilities, `isAdmin` (the ceiling), and the site coordinator's name.

The controller reads it at sign-in. After that it re-reads only from `refresh()`'s
uncleared branch and Check again. #217 added one more re-read: after an uncleared admin
saves their own Roster row. A window that is already cleared never asks again. So a role
an admin adds, narrows or removes mid-session reaches that person's window only on a reload
or, for a removal, on the next refused action (`NOT_CLEARED`).

What already exists and is reused:
- **The person's own entry.**
  - `recheckClearance()` writes the answer into `state.principal.clearance`, and rewrites
    the person's own `people` entry with the effective capabilities
    (`withOwnCapabilities`).
  - Every own-button decision reads that entry: `staffEligibility`, `adminEligibility`,
    and `isAdmin` for the office frame versus the work board.
  - So a fresh answer plus `show()` is enough to redraw.
- **Nothing the window reads depends on effective capabilities.**
  - Case policies are gated by clearance, not capability.
  - `screenAllowed` checks only the ceiling, for Post an update.
  - A capability change never needs a list re-read.
- **`checkClearance()`** is single-flight and never rejects. `recheckClearance()` already
  does uncleared → cleared (`loadWork`) and cleared → uncleared (`dropWork`).
- **`refresh()`** is called by focus, `online` and reconnecting, and also after every
  successful action.
- **The roster tables are not in the realtime publication.**

Constraints:
- No migration and no RPC change.
- Staff screens are English only.
- The realtime load is #165's concern and must not grow.

The decision log is in `brainstorm.md`.

## Goals / Non-Goals

**Goals:**
- A cleared window shows the buttons of its current roles without a reload, on wake and
  right after the server refuses something it no longer allows.
- A window whose roles are all removed goes to the setup screen the next time it wakes,
  not only on its next action.
- Saving your own Roster row re-checks whether or not you were cleared.
- When a capability goes, nothing the person typed is lost, and nothing they can no longer
  send is offered.

**Non-Goals:**
- Instant delivery of role changes through realtime. The roster tables stay out of the
  publication.
- Polling.
- Any change to what the server allows. `vitally_my_clearance()` and every RPC are used as
  they are.
- Client windows.

## Decisions

### D1: Re-read on wake events and after a refusal, not on every refresh
- **Choice:**
  - `refresh` gets a wake flag. Focus, `visibilitychange` (to visible), `online` and
    reconnecting set it; the refresh after an action doesn't.
  - In a wake refresh of a cleared window, `await checkClearance()` runs before the
    re-read. If the answer is no longer cleared, the existing cleared → uncleared path
    (`dropWork`) runs and the refresh stops, without reading lists RLS would return empty.
  - The uncleared branch is unchanged.
- **Why:** wake is when a person comes back to the window, so an added role shows up as
  they look at it. The refresh after an action would add an RPC to every action for a
  change that is rare.
- **Alternatives considered:**
  - Re-read in every refresh: about 15% more requests per action, for nothing.
  - A timer: costs something when idle, and nothing else in the app polls.
  - Realtime: see D6.

### D2: A `FORBIDDEN` or `INELIGIBLE` refusal also re-reads
- **Choice:** in `noteFailure`, a `FORBIDDEN` or `INELIGIBLE` refusal in a staff window
  that is cleared starts `void checkClearance()` after recording the error.
  - The refusal stays on screen. `recheckClearance` clears `state.error` only when the
    error was its own failed check (`localRetry === checkClearance`).
- **Why:** a refusal is the evidence that a role has narrowed, at the moment the stale
  button was pressed.
- **Expected and harmless:** `INELIGIBLE` also answers an admin's assignment of someone
  who isn't cleared (`ASSIGN_CASE`), and `FORBIDDEN` answers other refusals that have
  nothing to do with roles. There the re-check is one call, and nothing changes.
- **Alternative considered:** only refusals from specific RPCs. Rejected: it's harder to
  keep right, and saves almost nothing.

### D3: Saving your own Roster row always re-checks
- **Choice:** `recheckAfterOwnSave` drops its `awaitingClearance` guard. It waits for any
  check already out, then calls `checkClearance()` once more.
- **Why:** an admin who unticks their own certificate or role is the first to have stale
  buttons, and the save is a known moment.

### D4: Single-flight, and quiet when nothing changed
- **Choice:**
  - Every re-read goes through `checkClearance()`. A focus, a `visibilitychange` and a
    refusal arriving together share one request.
  - In `recheckClearance`, the cleared → cleared path compares the old and new effective
    capabilities (as sets) and `isAdmin`. If they're the same, it stores the answer and
    returns: no `readFeed()` (the wake refresh reads the feed anyway) and no `show()`.
  - If they differ, it updates the person's own entry, applies D5's screen fallback,
    persists the session and calls `show()`.
- **Why:** this keeps the cost to one small RPC, and avoids redrawing under the person's
  keyboard for nothing.

### D5: What the window shows when capabilities change
- **The frame and the case page** redraw from the new own entry. This already works.
- **The screen fallback is in the controller, not only the view.**
  - When the person is no longer effective admin and `state.screen` is `office-cases`,
    the controller sets `state.screen` to the work board and calls `show(true)`, because
    the page changed.
  - Follow-ups (`staff`) and an office case page (`staff-case`) keep their screen and
    redraw as the work board and the volunteer case page.
  - Roster and Post an update follow the ceiling and don't move.
  - Today only the view falls back. The stale `state.screen` would jump back if Admin
    returned, and it is persisted.
- **Add a case** (`office-add-case`) is the exception to the view's office-screen fallback:
  - the page and its typed draft stay;
  - Save draft and Send to the office (the page's "Create": both start with `vitally_create_case`) are replaced by the explanation line when the person lacks the capability
    `vitally_create_case` checks, which is effective `admin` through `acting_person`.
    The swap reads that capability as its own rule, not the frame's `isAdmin`;
  - leaving goes through the existing "Leave without saving?" question.
- **Drawers and dialogs: one rule, one table.**
  - A view helper maps each staff dialog to the capability its RPC checks. When the
    person's own entry lacks it, the dialog renders the line "Your roles changed, so you
    can't send this any more." in place of its submit or confirm button.
  - The rest of the dialog, its typed text and its error stay.
  - Effective-capability dialogs:

    | Dialog | Capability |
    |---|---|
    | `assign` | `admin` |
    | `log-call` | `followup` |
    | `resolve-help` | `assist` |
    | `request-corrections` | `review` |
    | `close-unsigned` | `admin` |
    | `close-case` | `admin` |
    | `put-on-hold` | `admin` |
    | `resume-from-hold` | `admin` |
    | `mark-ready-to-efile` | `admin` |
    | `mark-efiled` | `admin` |
    | `record-filing-result` | `admin` |
    | `return-to-signing` | `admin` |
    | `request-documents` | `admin` |

  - Ceiling dialogs, never swapped: `volunteer`, `send-invitation`, `cancel-invitation`,
    `deactivate-account`, `update-people`, `unpublish-update`, `delete-update`,
    `notifications`. Their RPCs check `is_workspace_admin` (`people.capabilities`) or no
    capability.
  - Dialogs that need no capability, never swapped: the client dialogs `help`,
    `regenerate`, `print` and `withdraw`, and `leave-add-case`, which calls no RPC. They
    are listed in the table, not left out, so every dialog has to pick a category.
- **The case page's forms** keep their existing swap to an explanation line through
  `staffEligibility`. Drafts stay in `state`.
- **Why one table:** it is the single place that says which capability a dialog needs.
  The same table drives the view test that every staff dialog is classified, so a new
  dialog fails the test until it is added.
- **Alternatives considered:**
  - Close the drawer with a notice: loses typed text.
  - Leave everything open and let the server refuse: still offers a button that can't
    work.
  - The user chose the swap.

### D6: No realtime
- **Choice:** the roster tables stay out of the realtime publication.
- **Why:** adding them is exactly the load #165 measures. Role changes are rare and come
  from an admin, and D1 and D2 cover both directions.

### D7: `visibilitychange` is a document event
- **Choice:** the controller takes an optional `documentEvents` (default
  `globalThis.document`), and listens there for `visibilitychange`. It treats it as a wake
  only when `visibilityState === "visible"`. `app.mjs` passes `document`.
  - Tests fake it the way they fake `windowEvents`.
  - It is removed in `unlisten()` alongside focus and `online`.

## Risks / Trade-offs

- [Risk] Focus and `visibilitychange` often fire together when switching back to a tab, so
  two wake refreshes run back to back.
  → Mitigation: the clearance read is single-flight (D4). The two list re-reads already
  happen today with focus plus `online`, and stay as they are. A test pins one
  `getClearance` call for focus plus visibility together.
- [Risk] A cleared → uncleared answer during a wake refresh races with the refresh's own
  list reads.
  → Mitigation: the clearance is awaited before any list read (D1). If the window is no
  longer cleared, the refresh returns before reading.
- [Risk] A `FORBIDDEN` from something unrelated to roles (a ceiling RPC, the Roster) adds
  one call.
  → Accepted: rare, cheap and harmless (D2).
- [Trade-off] An added role shows up on the next wake, not instantly.
  → Accepted: the person is usually not looking at the window while an admin edits the
  Roster, and they see it as soon as they return.
- [Trade-off] A narrowed role can still show a stale button until the next wake or
  refusal. The server refuses it, and the refusal fixes the window.
  → Accepted: the server is always right.
- [Risk] A new staff dialog added later isn't in D5's table.
  → Mitigation: the view test lists every staff dialog key and fails on any that isn't
  classified.

## Migration Plan

Not applicable: there is no database, RPC or deployment change. The change ships as a
normal front-end release. Rollback means reverting the commit.

## Open Questions

None. The builder's calls already made are in `brainstorm.md`: how the wake flag reaches
`refresh` (D1), and `documentEvents` (D7).
