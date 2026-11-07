## ADDED Requirements

### Requirement: Fictional-fill controls appear only with the demo-tools switch
The app SHALL show the fictional-fill controls only when the browser's demo-tools switch is on:
- the staff "Auto-fill fictional data" button on every staff questionnaire and office dialog that carries it;
- the client intake's fiction toolbar ("Fill fictional details", "Generate another example" and the "Fictional data only" chip);
- the office's assisted-intake "Fill fictional details" pill.

When the switch is on, each control SHALL be shown to whoever is on its screen, whatever their access. When the switch is off, none of them SHALL be shown to anyone, a presenter included.

#### Scenario: A client without the switch
- **WHEN** a client opens their draft intake and the switch is off
- **THEN** the page has no "Fill fictional details" button, no "Generate another example" button and no "Fictional data only" chip

#### Scenario: A client with the switch
- **WHEN** a client opens their draft intake and the switch is on
- **THEN** the fiction toolbar is shown, in the client's language, as before

#### Scenario: Staff with the switch
- **WHEN** a staff member opens a preparer questionnaire, a reviewer questionnaire or an office filing dialog and the switch is on
- **THEN** the "Auto-fill fictional data" button is shown, although the account is not a presenter

#### Scenario: A presenter without the switch
- **WHEN** a presenter opens the office's Add a case, or a staff questionnaire, and the switch is off
- **THEN** neither the assisted-intake fill pill nor the Auto-fill button is shown

### Requirement: Fill actions do nothing without the switch
The fill actions SHALL change nothing on the page and send nothing when the switch is off, even if their button is present in the page:
- `demo-fill`;
- `fill-fictional`;
- `regenerate-fictional`;
- `confirm-regenerate`;
- `fill-assisted-intake`.

#### Scenario: An injected button
- **WHEN** a page without the switch receives a click on an element with `data-action="fill-fictional"`
- **THEN** no answer in the draft changes, and no toast is shown

### Requirement: The server sends the switch only for a local project and an explicit flag
The local server's public configuration SHALL contain `demoTools: true` only when `VITALLY_DEMO_TOOLS` is exactly `1` **and** `SUPABASE_URL` is a loopback URL (host `127.0.0.1`, `localhost` or `::1`). Otherwise the configuration SHALL NOT contain a `demoTools` key, and SHALL be exactly what it was before this change. When the flag is `1` but the URL is not loopback, the server SHALL print one warning at start-up that does not contain the URL.

#### Scenario: Flag set, loopback project
- **WHEN** `VITALLY_DEMO_TOOLS=1` and `SUPABASE_URL=http://127.0.0.1:54321`
- **THEN** `/public-config.json` has the four usual keys plus `demoTools: true`

#### Scenario: Flag set, hosted project
- **WHEN** `VITALLY_DEMO_TOOLS=1` and `SUPABASE_URL=https://abcd.supabase.co`
- **THEN** `/public-config.json` has no `demoTools` key, and the server printed one warning without the URL

#### Scenario: Flag absent or another value
- **WHEN** `VITALLY_DEMO_TOOLS` is unset, or set to `true` or `yes`
- **THEN** `/public-config.json` has no `demoTools` key

#### Scenario: Not configured
- **WHEN** `SUPABASE_URL` or the publishable key is missing
- **THEN** `/public-config.json` is `{"configured": false}`, whatever the flag

### Requirement: The browser turns the switch on only for a local project
The browser SHALL treat the demo-tools switch as on only when the fetched configuration has `demoTools: true` **and** its `supabaseUrl` is a loopback URL. Any other configuration SHALL leave the switch off.

#### Scenario: A hosted config carrying the flag
- **WHEN** the browser loads a configuration with `demoTools: true` and `supabaseUrl` `https://abcd.supabase.co`
- **THEN** the switch is off, and no fictional-fill control is shown

#### Scenario: A local config carrying the flag
- **WHEN** the browser loads a configuration with `demoTools: true` and `supabaseUrl` `http://localhost:54321`
- **THEN** the switch is on

### Requirement: No committed configuration carries the switch
The repository SHALL NOT contain a committed `public-config*.json` file that includes a `demoTools` key, and a unit test SHALL fail if one does.

#### Scenario: A committed config with the flag
- **WHEN** a tracked file named `public-config.json` (or matching `public-config*.json`) contains `"demoTools"`
- **THEN** `npm test` fails and names the file
