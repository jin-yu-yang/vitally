## ADDED Requirements

### Requirement: A presenter account gets a plain screen and no staff screens
When an account whose membership has access `presenter` signs in, the app SHALL show one screen in English with:
- the heading "This account is no longer used";
- the text "Presenter mode has been removed. Ask your site coordinator for a staff account.";
- a Sign out button.

It SHALL show nothing else: no work board, case page, office screen, persona picker, sample reset, checkpoint or class-workspace indicator. The app SHALL load no cases, people, help requests or workspace details for a presenter, and SHALL start no live updates for one. Sign out SHALL work as it does for any account. This SHALL hold until presenter access is removed from the database.

#### Scenario: A presenter signs in
- **WHEN** the presenter signs in through the sign-in form
- **THEN** the screen says "This account is no longer used" and "Presenter mode has been removed. Ask your site coordinator for a staff account.", with Sign out, and shows no board, no case and no presenter controls

#### Scenario: Nothing is loaded for a presenter
- **WHEN** a presenter's window is open on the plain screen and a case changes in the workspace
- **THEN** the window shows no case data and its screen does not change

#### Scenario: A presenter signs out
- **WHEN** a presenter on the plain screen presses Sign out
- **THEN** the window returns to the sign-in form

#### Scenario: A staff member and a client are unchanged
- **WHEN** a staff member or a client signs in
- **THEN** they get their own screens as before
