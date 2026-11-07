## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Every confirmation has the same shape
**Reason**: Its scenario "A note inside the form" is about the presenter's "Load a sample checkpoint" dialog, which is removed, and no other dialog puts its note inside the form. A modified requirement can't drop a scenario.
**Migration**: Replaced by "Every confirmation dialog has the same shape" below. The rules are unchanged except that the reset and checkpoint dialogs leave the list, and a note always comes before the form.

## ADDED Requirements

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
