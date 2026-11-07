## MODIFIED Requirements

### Requirement: Fictional-fill controls appear only with the demo-tools switch
The app SHALL show the fictional-fill controls only when the browser's demo-tools switch is on:
- the staff "Auto-fill fictional data" button on every staff questionnaire and office dialog that carries it;
- the client intake's fiction toolbar ("Fill fictional details", "Generate another example" and the "Fictional data only" chip);
- the office's assisted-intake "Fill fictional details" pill.

When the switch is on, each control SHALL be shown to whoever is on its screen. When the switch is off, none of them SHALL be shown to anyone.

#### Scenario: A client without the switch
- **WHEN** a client opens their draft intake and the switch is off
- **THEN** the page has no "Fill fictional details" button, no "Generate another example" button and no "Fictional data only" chip

#### Scenario: A client with the switch
- **WHEN** a client opens their draft intake and the switch is on
- **THEN** the fiction toolbar is shown, in the client's language, as before

#### Scenario: Staff with the switch
- **WHEN** a staff member opens a preparer questionnaire, a reviewer questionnaire or an office filing dialog and the switch is on
- **THEN** the "Auto-fill fictional data" button is shown

#### Scenario: A presenter without the switch
- **WHEN** a presenter signs in and the switch is off
- **THEN** the presenter sees only the plain screen set by capability `sign-in`, with no fill control on it

#### Scenario: Staff without the switch
- **WHEN** an admin opens the office's Add a case, or a staff member opens a staff questionnaire, and the switch is off
- **THEN** neither the assisted-intake fill pill nor the Auto-fill button is shown
