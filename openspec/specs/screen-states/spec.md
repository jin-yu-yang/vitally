# screen-states Specification

## Purpose
How every screen tells a person what is happening: where an error is shown (inside the open dialog, in place on the case page, in the client's save chip, or in the problem banner; one at a time, never as a toast) and what Try again does; the toast's kinds, timing, Dismiss and position; lists that are loading or couldn't load; the pressed button while its press runs; and the connection notice, including "You're back online.".

## Requirements

### Requirement: Errors are shown where the person is looking, never as a toast
Every failure SHALL be recorded and shown once, with `role="alert"`, in the first of these places that applies:
- inside the dialog that is open, when one is;
- in place, beside the action, on the staff case page;
- in the client's save chip, for a save that failed;
- otherwise, in the problem banner, which SHALL step aside while a dialog is open.

The error SHALL offer Try again when it can be retried, and Dismiss. It SHALL stay until it is dismissed, retried, or replaced. One error SHALL show at a time: a newer error replaces an older one. When it replaces a failed save, the save chip SHALL say the answers are unsaved, and the draft SHALL be kept and sent with the next move or save. An error SHALL NOT appear as a toast.

This SHALL hold for:
- **a refusal** the window makes itself, for example "Open an application first.", "This step is not available.", or "This request is no longer on screen.". These offer Dismiss only.
- **a draft 13614-C or Form 14446 that couldn't be built.** The error says "The draft could not be made. Try again." (or, for the font check, "The draft font could not be checked. Try again later."), and Try again builds the same draft again, in the same form and language. A draft that is then built clears that error.
- **a shaded-section editor that couldn't be opened** (capability `shaded-section`). The error says "The editor could not be opened. Try again, or use Download to fill elsewhere.", in place on the staff case page, and Try again opens the editor again.
- **an uploaded copy of the shaded section that couldn't be read or saved** (capability `shaded-section`). The error is in place beside the upload control, names the problem or the field, and offers Dismiss only.
- **any other failed press** that nothing else recorded: a general error, the press's own message when it is a known sentence, otherwise "Something went wrong.". This SHALL NOT apply on the sign-in screens, whose form states its own failures.

On a client screen the error SHALL be in the screen's language.

#### Scenario: A failed claim is announced once
- **WHEN** a volunteer presses Claim and the server refuses it
- **THEN** the case page shows the error in place with Try again and Dismiss, and no toast appears

#### Scenario: A refusal inside a dialog
- **WHEN** a send from "Ask the preparer for corrections" is refused while the dialog is open
- **THEN** the dialog shows the error itself, the problem banner shows nothing behind it, and no toast appears

#### Scenario: A draft that couldn't be built
- **WHEN** a client presses View Draft Form 14446 and the draft can't be built
- **THEN** the problem banner says, in the screen's language, that the draft could not be made, with Try again and Dismiss
- **AND** pressing Try again builds the same draft again, and the error goes once it is built

#### Scenario: An editor that couldn't be opened
- **WHEN** the case's preparer presses "Fill the shaded section" and the editor can't be opened
- **THEN** the case page says "The editor could not be opened. Try again, or use Download to fill elsewhere." in place, with Try again and Dismiss, and no toast appears

#### Scenario: An upload that couldn't be read
- **WHEN** the case's preparer uploads a PDF with no form fields
- **THEN** the error is shown beside the upload control with Dismiss and no Try again, and no toast appears

#### Scenario: A failure nothing else recorded
- **WHEN** a press fails with an error the window did not record
- **THEN** the problem banner says "Something went wrong." with Dismiss

#### Scenario: A sign-in failure
- **WHEN** sending a sign-in code fails
- **THEN** the sign-in form states the failure, and neither a toast nor the problem banner repeats it

#### Scenario: A newer error replaces a failed save
- **WHEN** a client's save has failed and then a draft can't be built
- **THEN** the problem banner shows the draft error, the save chip says the answers are unsaved, and the next move sends the draft

### Requirement: A toast confirms, informs or warns, and can be dismissed
A toast SHALL be one of three kinds, each with its own icon and coloured edge:
- **success**: something the person did happened (saved, sent, started, copied, rebuilt, moved);
- **information**: nothing failed, but the person should know something (for example "Fictional details filled in. Nothing is saved yet.");
- **warning**: something the person can fix or should note, including the nudges ("Confirm that you have checked your answers first.", "Some answers still need a change before you can send.", "Say what you helped with before resolving this request.", "Confirm that you have checked these answers with the client first.") and "Traditional Chinese couldn't load…".

**Behaviour:**
- One toast SHALL show at a time; a new one replaces the current one.
- Every toast SHALL have a Dismiss button, at least 44 × 44 px, labelled for screen readers and carrying no visible text. It SHALL hide the toast at once, and so SHALL Escape while focus is inside the toast.
- A success or information toast SHALL leave after 5 seconds, a warning after 8 seconds.
- The timer SHALL stop while the pointer is over the toast or focus is inside it, and start again from the full time when both have left.
- The toast's text SHALL be announced politely (`role="status"`). The Dismiss SHALL sit outside that live region.
- A hidden toast SHALL leave the Tab order. If focus was inside it when it hides, focus SHALL return to where it came from.
- A redraw of the page SHALL neither remove the toast nor announce it again.

**Position:**
- On client screens the toast SHALL sit at the bottom centre; on staff screens at the bottom right, 24px from the edges.
- On Add a case, while the sticky bar with Save and Send is on screen, the toast SHALL sit above that bar.

#### Scenario: A save confirms itself
- **WHEN** a client's answers are saved
- **THEN** a success toast says "Your answers are saved." and leaves after 5 seconds

#### Scenario: A nudge is a warning
- **WHEN** a client presses Submit before confirming they checked their answers
- **THEN** a warning toast says "Confirm that you have checked your answers first." and leaves after 8 seconds

#### Scenario: Reading a toast keeps it
- **WHEN** the pointer rests on a toast, or focus is on its Dismiss
- **THEN** the toast stays, and it leaves 5 seconds (8 for a warning) after the pointer and focus have left

#### Scenario: Dismissing a toast
- **WHEN** the person presses the toast's Dismiss, or Escape while on it
- **THEN** the toast hides at once, its Dismiss leaves the Tab order, and focus returns to where it was before

#### Scenario: A newer toast replaces the current one
- **WHEN** a second toast appears while one is showing
- **THEN** only the second shows, and it leaves after its own time

#### Scenario: A toast on Add a case
- **WHEN** a toast appears on Add a case while its sticky bar is on screen
- **THEN** the toast sits above the bar and covers neither Save nor Send

#### Scenario: A redraw keeps the toast
- **WHEN** the page is redrawn while a toast shows
- **THEN** the toast is still there, with the same text, and is not announced again

### Requirement: A list says when it is loading or couldn't load
The case list, behind the work board, the case pool, Follow-ups and the client's applications, SHALL show one of four things:
- **before its first load:** a loading line, a spinner and a sentence ("Loading cases…", or for a client "Loading your applications…"), announced as a status;
- **when its first load failed:** a line saying it couldn't load ("The cases couldn't load.", or for a client "Your applications couldn't load."), with the problem banner's Try again reloading everything the first load reads;
- **when loaded and empty:** its empty state;
- **otherwise:** its content.

While a staff list isn't loaded, its panel SHALL show its heading and that line only, without tabs, filters or counts. Follow-ups SHALL treat its list of help requests the same way. A list that has loaded once SHALL keep what it shows when a later reload fails, with the problem banner above it. Signing out SHALL return each list to its loading state. Add a case's wait for the workspace SHALL use the same loading line.

#### Scenario: A failed first load isn't an empty board
- **WHEN** a volunteer signs in and the first load of the cases fails
- **THEN** the work board says "The cases couldn't load." and not "Nothing to claim right now.", without tabs or counts, and the problem banner offers Try again

#### Scenario: Try again loads the list
- **WHEN** the volunteer then presses Try again and the load succeeds
- **THEN** the work board shows its cases, or its empty state if there are none, and the people and the workspace are loaded too

#### Scenario: A client's applications
- **WHEN** a client signs in and the first load of their applications fails
- **THEN** the page says "Your applications couldn't load." in the screen's language, not "No applications yet"

#### Scenario: A later reload fails
- **WHEN** the cases have loaded once and a later reload fails
- **THEN** the board keeps showing the cases it had, with the problem banner above it

### Requirement: The pressed button shows it is working
While a press is running, every action SHALL stay disabled as today. The button that was pressed SHALL also show a spinner beside its label and carry `aria-busy="true"`. This SHALL hold for:
- the staff case actions and the client's Submit;
- the office's help-request actions;
- Add a case's Save and Send.

When the press ends, the spinner and `aria-busy` SHALL go. A client's move between sub-steps, and any other press, SHALL show no button spinner (the save chip says Saving). If the pressed button is no longer on screen after a redraw, no spinner SHALL be shown.

#### Scenario: Claiming a case
- **WHEN** a volunteer presses Claim on a case
- **THEN** that Claim button shows a spinner and `aria-busy="true"` while the claim runs, the other actions are disabled, and the spinner goes when the claim ends

#### Scenario: Sending from Add a case
- **WHEN** the office presses Send on Add a case
- **THEN** Send shows a spinner and `aria-busy="true"` until the send ends

#### Scenario: Moving between sub-steps
- **WHEN** a client presses Continue and the move saves their answers
- **THEN** Continue shows no spinner, and the save chip says Saving

### Requirement: The connection notice says when the app is offline or reconnecting
While the connection is offline or reconnecting, the frame SHALL show the connection notice in the attention colours, as a status. "Reconnecting…" SHALL show a spinning icon; offline SHALL show a still one. When the connection returns after being offline or reconnecting, an information toast SHALL say "You're back online." It SHALL say nothing on the first connection. Every spinner (connection, loading, busy) SHALL stay still when the person's system asks for reduced motion.

#### Scenario: The connection drops and returns
- **WHEN** the connection is lost and then returns
- **THEN** the connection notice shows while it is lost, and an information toast says "You're back online." when it returns

#### Scenario: The first connection
- **WHEN** a window connects for the first time after sign-in
- **THEN** no "You're back online." toast appears

#### Scenario: Reduced motion
- **WHEN** the person's system asks for reduced motion
- **THEN** the reconnecting, loading and busy spinners don't move

### Requirement: A dialog takes the keyboard and gives it back
When a dialog opens, the keyboard SHALL move into it: to its first control that isn't the close button, or to the close button when it has no other, or to the dialog itself when it has no control. Escape SHALL close the dialog, except during an IME composition, and except in the shaded-section editor (capability `shaded-section`) while it holds unsaved changes. There, Escape SHALL ask "Discard your changes?" and close the editor only when the person confirms. When a dialog closes, focus SHALL return to the control that opened it. If that control is no longer on the page, focus SHALL go to the screen's fallback: for a drawer, the queue's heading.

#### Scenario: First focus skips the close button
- **WHEN** the client opens the "Replace the fictional answers?" dialog
- **THEN** the keyboard is on "Replace with another example", not on the close button

#### Scenario: Escape closes and returns focus
- **WHEN** a dialog opened from a button is open and Escape is pressed
- **THEN** the dialog closes and the keyboard is back on that button

#### Scenario: Escape in an editor with unsaved changes
- **WHEN** the shaded-section editor holds a change that isn't saved and Escape is pressed
- **THEN** the editor asks "Discard your changes?" and stays open with the change, unless the person confirms
- **AND** once the person confirms, the editor closes and the keyboard is back on "Fill the shaded section"

#### Scenario: The opener is gone
- **WHEN** a Resolve a help request drawer closes after another window resolved its row
- **THEN** the keyboard goes to the queue's heading

### Requirement: The keyboard stays inside an open dialog
While a dialog is open, Tab and Shift+Tab SHALL move only among the dialog's controls. Tab from the last control SHALL go to the first, and Shift+Tab from the first SHALL go to the last. When the keyboard is on the dialog itself or on anything in it that isn't a control, Tab SHALL go to the first control and Shift+Tab to the last.

#### Scenario: Wrapping at the ends
- **WHEN** the keyboard is on a dialog's last control and Tab is pressed
- **THEN** the keyboard moves to the dialog's first control

#### Scenario: From the dialog itself
- **WHEN** the person clicks a dialog's text, so the dialog itself holds the keyboard, and presses Shift+Tab
- **THEN** the keyboard moves to the dialog's last control and stays inside the dialog

### Requirement: The page behind an open dialog is inert, and its live regions stay announced
While a dialog is open, everything on the page behind it SHALL be inert: it can't be focused, clicked or read in a screen reader's browse mode. The toast, the connection notice, the notice banner and the problem banner SHALL NOT be inert, so a message they announce while a dialog is open, or right after it closes, still reaches screen readers. When the dialog closes, nothing on the page SHALL stay inert, before the keyboard returns to the opener.

#### Scenario: The page behind is inert
- **WHEN** a dialog is open
- **THEN** the header, the page body and the footer are inert, and the dialog is not

#### Scenario: The toast is never inert
- **WHEN** a reviewer confirms "Ask the preparer for corrections" and the toast "The preparer was asked for corrections." appears
- **THEN** the toast's live region is not inside anything inert

#### Scenario: A notice while a dialog is open
- **WHEN** a dialog is open and the connection notice says the app is reconnecting
- **THEN** the connection notice is not inert

#### Scenario: Closing clears inert
- **WHEN** a dialog closes
- **THEN** nothing on the page is inert, and the opener holds the keyboard

### Requirement: An empty list says what is empty, in one of two shapes
Once a list has loaded and has nothing to show, it SHALL show its empty state, built by one of two shared helpers:
- **a panel list** (the work board, Follow-ups, the case pool, the client's applications) SHALL show an empty panel: an icon, an optional heading, one sentence, and the actions that apply;
- **a section inside a case or a drawer** (documents requested, review attempts, office follow-up, history, requests waiting, calls so far, open follow-ups in Log a call, and the client's history) SHALL show one muted line.

The sentence SHALL say what is empty, and where it helps, what fills the list. A list narrowed by a filter or a search SHALL say that nothing matches, never that the list itself is empty, and SHALL offer the action that undoes the narrowing: in the empty state, or beside it when the list already shows that action. The empty state SHALL NOT appear while the list is loading or after its first load failed. Moving a list onto the shared helpers SHALL NOT change its words, its actions or their `data-*` values, except where a requirement here says so.

#### Scenario: An empty tab on the work board
- **WHEN** a volunteer opens the Available tab and no case is available
- **THEN** the board shows the empty panel with "Nothing to claim right now. New work appears here once the office has checked its intake." and no Clear filters

#### Scenario: A filtered queue offers the undo
- **WHEN** the office narrows Follow-ups to one kind of task and nothing of that kind is waiting
- **THEN** Follow-ups shows "Nothing here matches these filters." with "Show every task", which shows every task again

#### Scenario: A section with nothing in it
- **WHEN** a volunteer opens a case on which no document has been requested
- **THEN** the documents section shows the one muted line "No documents have been requested on this case."

#### Scenario: Loading is not empty
- **WHEN** the work board's first load is still running
- **THEN** it shows "Loading cases…" and not its empty sentence

### Requirement: The case pool says whether nothing exists or nothing matches
The case pool's empty state SHALL show the folder icon and say "No cases yet this season." when no filter is set, and "No case matches these filters." when a filter is set. When a filter is set, Clear filters SHALL stay in the line above the list, and the empty state SHALL NOT repeat it.

#### Scenario: An empty season
- **WHEN** an admin opens the case pool, no filter is set, and the workspace has no cases
- **THEN** the pool says "No cases yet this season." with the folder icon

#### Scenario: Nothing matches
- **WHEN** an admin filters the case pool by a language no case speaks
- **THEN** the pool says "No case matches these filters." with the folder icon, and Clear filters shows once, in the line above

### Requirement: Every confirmation dialog has the same shape
Every confirmation dialog SHALL be built from one shared body. Its parts SHALL come in this order:
- the dialog's own refusal, when it states one itself (the corrections dialog does);
- a sentence saying what will happen;
- an optional note, with an icon, saying what will not happen. The note SHALL come before the form;
- an optional form, holding its fields and the confirm control;
- one confirm control, which sends the dialog's action;
- one text button, outside any form, that closes the dialog without sending anything ("Keep it open", "Keep reviewing", "Keep them as they are", and so on).

This SHALL hold for close case, ask the preparer for corrections, replace the fictional answers, leave Add a case without saving, ask for documents, put on hold, got in touch, and the client's withdraw. Building a dialog from the shared body SHALL NOT change its words, its action, the action's payload, or its controls' ids. The close-case dialog's own fields are set by capability `case-lifecycle` ("A closed case records why it closed").

#### Scenario: Close case keeps its action and payload
- **WHEN** the office confirms Close this case with the reason Duplicate, no note, and the "I understand" box ticked
- **THEN** the action sent is `CLOSE_CASE` with that reason, no note and the confirmation, and the case closes

#### Scenario: A refusal comes first
- **WHEN** a send from "Ask the preparer for corrections" is refused
- **THEN** the dialog's own error comes before its sentence, and the form, the confirm control and "Keep reviewing" follow as before

#### Scenario: The keep button sends nothing
- **WHEN** the office presses "Keep it open" in the close-case dialog
- **THEN** the dialog closes, no action is sent, and the keyboard returns to "Close this case…"
