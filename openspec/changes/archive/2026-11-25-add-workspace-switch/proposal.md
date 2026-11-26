## Why

The staff frame picks one workspace from effective `admin` alone (Ruling R55). An Admin who also prepares or reviews, like PCDC's site coordinator, is held in the office and cannot reach the work board, the pool or Claim review (#104). An Intaker (`receive_documents`, `assist`) lands on the work board, where there is nothing they can do. Roles (#194, #237) made both cases normal, and #104 is in scope for the Dec 21 milestone. A switch between the two existing workspaces, plus an office for Intakers, fixes both without granting anything: the database still checks every action.

## What Changes

**Which workspace a staff member works in**
- From: effective `admin` → the office; everyone else → the work board.
- To: two sides. **Office** is for anyone with any of `admin`, `followup`, `assist` or `receive_documents`. **Cases** is for anyone with `prepare` or `review`. Someone with both gets an **Office / Cases** switch at the top of the sidebar, defaulting to Office. Someone with one side gets that side and no switch. Someone with neither gets the work board, as today.
- Reason: #104.
- Impact: non-breaking. Admin-only and Preparer/Reviewer-only accounts see exactly what they see today. Intakers move from the work board to the office.

**Remembering the side**
- The last side chosen is kept per user id in this browser's localStorage, read and written like the language, and it survives sign-out. Blocked storage falls back to Office.

**The case page**
- Only the current side's actions show.
- On the office case page, someone with the switch sees at most one line pointing to Cases: "You can claim this case", "You can review this case", "You're preparing this case" or "You're reviewing this case", each followed by "— switch to Cases". The **Switch to Cases** button keeps the same case open.

**The Intaker's office**
- Follow-ups for someone with an office side but no `admin` lists only the rows they can act on:
  - help requests that are open or assigned to them;
  - documents to receive on office-owned cases with an open document request.
- It gets its own empty state and no Add a case button. There is no All cases, Workload or Volunteers.

**Where things land**
- Pressing the switch keeps the person on the same case, or on the other side's home. All cases goes to the Work board. Add a case asks first if answers are unsaved, then goes to the Work board. Screens that show in both modes stay put.
- Links never change the side.
- Gaining a side mid-session shows the switch and moves nothing. Losing one lands on the side that remains.

**Capability, not side**
- The Workload tab (admin), Add a case (admin) and screening on open (admin, and only in Office) follow the capability.
- Volunteers, Schedule, Post an update, Season settings, My profile and Notifications follow the ceiling or the schedule viewer, as today, in both modes.

**Not changing:** the database (no migration, RPC, read rule or realtime change), which panels each case page shows, the uncleared setup screen, and mobile layout (#147).

## Capabilities

### New Capabilities
- `staff-workspaces`: which side (Office or Cases) a cleared staff member works in, the switch and its remembered choice, where a switch lands, which screens each side holds, and the Intaker's Follow-ups.

### Modified Capabilities
- `staff-case-work`: the office case page's hint toward Cases.
- `case-lifecycle`: "Screening starts when an admin first opens a case" now requires the office side.
- `volunteer-clearance`:
  - "Losing or gaining effective Admin keeps the person in place" becomes a rule about sides: gaining a side moves nothing.
  - The scenario "Gaining a role with a form in view" in "A form whose capability is gone keeps its text and drops its submit" now starts on the office case page.

## Impact

- **Code:**
  - `src/contracts.mjs`: the side rule.
  - A new small module for the remembered side, beside `src/language.mjs`.
  - `src/views.mjs`: `staffScreen`, `staffSidebar`, `rosterPage`'s Workload flag.
  - `src/office-views.mjs`: the Follow-ups filter, kind chips and empty state.
  - `src/admin-views.mjs`: the hint on `renderAdminCase`.
  - `src/controller.mjs`: side state, `setWorkspaceSide`, the landings, `actingAdmin`, `recheckClearance`.
  - `src/app.mjs`: the action wiring and the leave-first check.
  - `src/styles.css`: the switch.
- **Tests:**
  - unit (`tests/*.test.mjs` for contracts, the store, views, the controller);
  - one browser `test(...)` block in its own workspace, outside the story.
- **Docs:** the developer guide's frontend page and the staff guide's workspace wording, where they describe R55.
- **Dependencies:** none in the database. PR #278 (check-in strip) may touch `staffSidebar` too, and whichever merges second resolves the conflict.
