## MODIFIED Requirements

### Requirement: The office records the screening checks
At Screening in progress, an admin SHALL record the screening checks before the case moves to Pending intake / filing. The panel SHALL be titled "Screening checks" and SHALL show these checks, each a box to tick, with these words:

| Key | Check | Shown |
|---|---|---|
| `phone` | The client can be reached at the phone number on the application. | every case |
| `documents` | The basic documents are present (photo ID, Social Security or ITIN cards, the income documents on the list). | every case |
| `in_scope` | The return is within VITA scope. | every case |
| `identity` | Identity confirmed: the client's face matches their photo ID (in person or on video), checked by a certified volunteer. | only when the intake answer `service` is `online` |

The button SHALL read "Record the screening checks" and SHALL stay disabled, with the hint "Tick every check before recording them.", until every check shown is ticked. No text in the panel or its notice, and no history line recorded after this change, SHALL call the checks simulated.

The database SHALL accept `VERIFY_INTAKE` only with exactly the checks shown for the case, each `true`: `phone`, `documents` and `in_scope`, plus `identity` if and only if the case's `service` is `online`. It SHALL refuse a missing, extra or false check, the removed `interview` and `consent` checks, and `identity` on a case that is not online, with `VALIDATION`, and nothing SHALL change. The stored record SHALL be the checks themselves, with no simulated flag. Records stored before this change SHALL keep their four checks and still render in the case's history.

#### Scenario: A drop-off case shows three checks
- **WHEN** an admin opens a drop-off case at Screening in progress
- **THEN** the Screening checks panel shows the phone, documents and VITA-scope checks, and no identity check

#### Scenario: An online case shows four checks
- **WHEN** an admin opens an online case at Screening in progress
- **THEN** the panel shows the identity check as well

#### Scenario: The button waits for every check
- **WHEN** the admin has ticked two of the three checks on a drop-off case
- **THEN** "Record the screening checks" is disabled and the hint reads "Tick every check before recording them."
- **AND WHEN** the third is ticked and the admin records them
- **THEN** the case moves to Pending intake / filing and the notice reads "The screening checks are recorded."

#### Scenario: The database refuses a wrong set
- **WHEN** `VERIFY_INTAKE` is sent with a missing check, an extra key, a `false` check, the old `interview` or `consent` keys, or `identity` on a drop-off case
- **THEN** each is refused with `VALIDATION`, and the case stays at Screening in progress

#### Scenario: An online case needs identity
- **WHEN** `VERIFY_INTAKE` is sent for an online case with only phone, documents and in_scope
- **THEN** it is refused with `VALIDATION`

#### Scenario: An old record still renders
- **WHEN** staff open a case whose checks were recorded with the four simulated checks
- **THEN** its history reads "… recorded the screening checks" for that event, and nothing fails to render

#### Scenario: The online sample
- **WHEN** the seed builds its cases (capability `local-seed-data`)
- **THEN** each seeded case's recorded checks are phone, documents and in_scope, plus identity for a case whose service is online

### Requirement: Admins record each return's filing result
A case SHALL have two returns: the federal return and the Pennsylvania (state) return. At Mark e-filed, each SHALL get a filing method, `efile` or `paper` (see "Admins record signing and e-filing, with a confirmation").

PCDC SHALL never mail a return. At Mark e-filed, each return filed on paper SHALL be recorded as **given to the client** (stored result `given_to_client`), with no date, by the admin who marked it: PCDC gives the printed return to the client, or to someone they send, who mails it. The result `given_to_client` SHALL belong only to a paper return, and `accepted` and `rejected` only to an e-filed one; the database SHALL refuse any other result. After Mark e-filed, the case SHALL be Accepted when every return it filed is accepted or given to the client, and otherwise E-filed.

At E-filed, an admin SHALL be offered **Record filing result…**, on the case page and on that case's Follow-ups row. It SHALL record the answer for one or both of the e-filed returns still waiting, as **accepted** or **rejected**, with the acknowledgment date. A rejected return SHALL also have a reject code: free text, 1 to 40 characters after trimming. It SHALL offer no choice for a paper return.

Every date SHALL be no later than today and no earlier than the day the return was filed. When the case is at Rejected, or the move takes it there, the admin MAY add a fix note (at most 1000 characters) saying what needs fixing in TaxSlayer. Its prompt SHALL read "Fix note (only when a return is rejected): what needs fixing in TaxSlayer". That includes recording the second return's answer at Rejected. A fix note SHALL be refused on any other move. Fix notes SHALL be append-only: each note SHALL be kept with who recorded it and when, and no note SHALL ever be changed, or deleted on its own, not even by the database's own service role. A note is removed only together with its case, when the case is deleted, for example by a seed re-run or a workspace teardown.

Its confirmation dialog SHALL:
- name the client (as Mark e-filed's does) and the application ID;
- say what each return is being recorded as;
- require a confirmation box to be ticked.

The database SHALL refuse the move without that confirmation. It SHALL also refuse, with `VALIDATION` and with nothing recorded:
- a return that already has an answer, a paper return among them;
- a result other than `accepted` or `rejected`;
- a missing or misplaced reject code;
- a date outside the window;
- an empty move.

After the move, the case SHALL be:
- **Rejected**, if any return is rejected;
- otherwise **Accepted**, if every return is accepted or given to the client;
- otherwise still **E-filed**.

A rejection SHALL move the case to Rejected at once, even while the other return is still waiting. While a case at Rejected still has an e-filed return waiting, Record filing result SHALL stay offered for that return, and the case SHALL stay at Rejected. Accepted SHALL be the end: no move SHALL leave it.

The move SHALL be admin-only, and SHALL have no undo. A case e-filed before filing methods existed SHALL be treated as both returns e-filed.

Results recorded as `mailed` before this change SHALL be stored as `given_to_client`, with no date. A paper return filed before this change and still waiting SHALL be shown as given to the client and SHALL never be waited for. Such a case may stay at E-filed.

#### Scenario: Both accepted
- **WHEN** an admin records the federal and the state return of a both-e-filed case as accepted, with dates after the filing day, and confirms
- **THEN** the case is Accepted, its staff name is "Accepted", and it shows in the case pool's Done tab

#### Scenario: One answer at a time
- **WHEN** an admin records only the federal return of a both-e-filed case as accepted
- **THEN** the case stays at E-filed, and its Follow-ups row reads "Waiting for Pennsylvania's answer."

#### Scenario: A rejection doesn't wait
- **WHEN** an admin records the federal return as rejected with code IND-031-04, while the state return is still waiting
- **THEN** the case is Rejected at once, and Record filing result… is still offered for the state return

#### Scenario: A note with the second answer
- **WHEN** a case is Rejected for its federal return with the fix note "Site coordinator to correct the dependent's SSN", and an admin then records the state return as accepted with the fix note "Client to bring the corrected SSN card"
- **THEN** the case stays Rejected, both notes are kept in the order recorded, and the Rejected row shows the second

#### Scenario: A note with nothing rejected
- **WHEN** an admin records the federal return of an E-filed case as accepted, with a fix note
- **THEN** the database refuses it with `VALIDATION`, and nothing is recorded

#### Scenario: A note can't be changed
- **WHEN** anyone, the database's service role included, tries to change or delete a recorded fix note on its own
- **THEN** it is refused, and the note stays as recorded

#### Scenario: A note goes with its sample
- **WHEN** a case with fix notes is deleted, for example by a seed re-run that replaces its previous set
- **THEN** its notes are removed with it, and no other case's notes change

#### Scenario: A rejection needs a code
- **WHEN** an admin records a return as rejected with an empty reject code
- **THEN** the database refuses it with `VALIDATION`, and nothing is recorded

#### Scenario: A paper return is given to the client at Mark e-filed
- **WHEN** an admin marks a case e-filed with the federal return e-filed and the state return on paper
- **THEN** the state return is recorded as given to the client with no date, and Record filing result offers only the federal return
- **AND WHEN** the admin records the federal return as accepted
- **THEN** the case is Accepted, with the staff name "Accepted, PA on paper"

#### Scenario: A paper return is mailed, not accepted
- **WHEN** the database receives Record filing result naming a paper return as accepted, or any return with the result `mailed` or `given_to_client`
- **THEN** it refuses it with `VALIDATION`, and nothing is recorded: the client mails a paper return, and PCDC records no answer for it

#### Scenario: A date before the filing
- **WHEN** an admin records an acknowledgment date earlier than the day the return was filed
- **THEN** it is refused with `VALIDATION`

#### Scenario: A volunteer can't record a result
- **WHEN** a preparer or reviewer tries to record a filing result
- **THEN** it is refused as forbidden, and nothing is recorded

#### Scenario: Nothing leaves Accepted
- **WHEN** an admin tries to record a result, return to signing, mark e-filed or close a case at Accepted
- **THEN** each is refused as not available

#### Scenario: An older e-filed case
- **WHEN** an admin records both returns as accepted on a case that was e-filed before filing methods existed
- **THEN** the case is Accepted, as a both-e-filed case

#### Scenario: A stored mailed result is renamed
- **WHEN** the migration runs on a stack where a paper return was recorded as mailed with a date
- **THEN** that return's result is `given_to_client` with no date, and its case keeps its stage
