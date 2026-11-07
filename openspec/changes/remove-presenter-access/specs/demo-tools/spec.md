## REMOVED Requirements

### Requirement: Fictional-fill controls appear only with the demo-tools switch

**Reason**: Its scenario "A presenter without the switch" no longer applies: no presenter account can exist.

**Migration**: Replaced by "Fictional-fill controls appear only with the demo-tools switch, for clients and staff", with the same rule and every other scenario.

## ADDED Requirements

### Requirement: Fictional-fill controls appear only with the demo-tools switch, for clients and staff
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

#### Scenario: Staff without the switch
- **WHEN** an admin opens the office's Add a case, or a staff member opens a staff questionnaire, and the switch is off
- **THEN** neither the assisted-intake fill pill nor the Auto-fill button is shown
