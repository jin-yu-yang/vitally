## ADDED Requirements

### Requirement: The seed runs only against the local test stack
The local seed SHALL do nothing unless the target passes the test-target guard **and** is the local test stack. A hosted test project SHALL be refused. The `seed:local` command SHALL also require `VITALLY_ALLOW_LOCAL_SEED=1`, checked before it reads any file or opens any connection. A refusal SHALL report only that the target was rejected or that the flag is missing, without saying which target check failed, and SHALL change nothing.

#### Scenario: The flag is missing
- **WHEN** an operator runs `npm run seed:local` without `VITALLY_ALLOW_LOCAL_SEED=1`
- **THEN** the command exits with an error saying the flag is required, and no file is read and no connection is opened

#### Scenario: A hosted test project
- **WHEN** the flag is set but the test configuration points at a hosted test project
- **THEN** the seed is refused as a rejected target, and nothing in that project changes

#### Scenario: A non-test target
- **WHEN** the configuration fails the test-target guard (for example a non-loopback address)
- **THEN** the seed is refused as a rejected target, and nothing changes

#### Scenario: The module called by a test fixture
- **WHEN** a test fixture calls the seed module on its own workspace on the local test stack, without the flag
- **THEN** the module seeds that workspace, because the flag gates only the command

### Requirement: The seed acts as role-named accounts found from the roster file
The command SHALL read the workspace id from the roster file (`--roster`, default `.vitally-roster.local.json`). In that workspace it SHALL find the people with person keys `site_coordinator`, `preparer` and `reviewer`, each linked to an active staff membership. Client A SHALL be the roster file's first applicant. The workspace's default follow-up person SHALL be the `site_coordinator` person. If any of these is missing or different, the seed SHALL refuse before creating or deleting anything, with a message that names the missing role key or setting and never an email address.

#### Scenario: All accounts are present
- **WHEN** the rehearsal workspace has the Site Coordinator, Preparer and Reviewer staff accounts, client A, and the Site Coordinator as the default follow-up person
- **THEN** the seed proceeds

#### Scenario: A role account is missing
- **WHEN** the workspace has no person with key `reviewer`
- **THEN** the seed refuses with a message naming `reviewer`, and nothing is created or deleted

#### Scenario: The default follow-up person is still a persona
- **WHEN** the workspace's default follow-up person is Sam, as on a stack set up from the old example roster
- **THEN** the seed refuses, saying the default follow-up person must be the `site_coordinator` account and that the roster command should be re-run, and nothing is created or deleted

### Requirement: Every seeded case is built through the public RPCs
The seed SHALL create and advance every case only by calling the public RPCs as the acting account: client A for the client's case, and the Site Coordinator, Preparer or Reviewer for staff steps. It SHALL NOT write a case's stage, holder or history directly. The one help request SHALL be inserted directly, because no action creates help requests. Every seeded value SHALL be fictional.

#### Scenario: Seeded history comes from the actions
- **WHEN** the seed has run
- **THEN** each seeded case's internal history and client progress lines are exactly those the actions wrote, and its receipts name the acting account's person

#### Scenario: A step the rules refuse
- **WHEN** a seeding step is refused by the RPC (for example because a rule changed)
- **THEN** the seed stops with an error naming the scenario and step, and the cases created so far are listed in the run file so the next run removes them

### Requirement: The seed creates one client case, ten office scenarios and one help request
In the target workspace the seed SHALL create:
- **Client A's case:** owned by client A, submitted, at `received`.
- **Ten office-entered cases with no client owner:**
  - one at `preparation_ready`, with no preparer;
  - one at `preparing`, held by the Preparer, with one open document request;
  - one at `preparing`, held by the Preparer, whose document request has been escalated into an open follow-up assigned to the Site Coordinator;
  - one at `review_ready`, held by the Preparer, with no reviewer;
  - one at `corrections_required`, held by the Preparer, whose correction round was written by the Reviewer (the case has no current reviewer until it is resubmitted);
  - one at `review_approved`, with the Preparer and Reviewer named;
  - one at `rejected`, with the state return rejected;
  - one at `accepted`, with both returns accepted;
  - one at `on_hold`, put on hold from Waiting for documents;
  - one at `closed`, with closing reason `withdrawn`.
- **One open, unassigned help request** linked to client A's case.

#### Scenario: The seeded set
- **WHEN** the seed runs on a workspace with no earlier seed
- **THEN** the workspace has exactly these eleven new cases and one new help request, with the stages, owners, preparers, reviewers and follow-up assignee listed above

#### Scenario: Each login has its own work
- **WHEN** the Preparer, the Reviewer and the Site Coordinator each read their cases after a seed
- **THEN** the Preparer holds the cases in preparation and corrections, the Reviewer is the named reviewer on the cases from review approved on and wrote the correction round on the corrections case, and the Site Coordinator has the escalated follow-up and the help request waiting

### Requirement: Running the seed again replaces the previous set
Each run SHALL record the ids of the cases and help request it creates in a run file under `.vitally-runs/`, named by workspace, writing it as each item is created. A run SHALL first delete exactly the rows listed in that workspace's run file, limited to that workspace, and then seed a fresh set. Rows not listed in the run file SHALL NOT be deleted.

#### Scenario: A second run
- **WHEN** the seed runs twice on the same workspace
- **THEN** after the second run the workspace has exactly one seeded set, none of the first run's cases or its help request remain, and the run file lists only the second run's ids

#### Scenario: Other cases are left alone
- **WHEN** a case created in the app exists in the workspace and the seed runs again
- **THEN** that case and everything attached to it is unchanged

#### Scenario: The run file is missing
- **WHEN** the seed runs and the workspace's run file does not exist
- **THEN** it deletes nothing and seeds a fresh set

### Requirement: The seed never prints an email address
The seed's output, error messages and run file SHALL NOT contain an email address. Output SHALL report counts (cases removed, cases created) and refusals by role key or setting.

#### Scenario: Output of a successful run
- **WHEN** the seed completes
- **THEN** its output states how many cases were removed and created, and contains no email address

#### Scenario: A refusal about client A
- **WHEN** the roster file's first applicant has no account on the stack
- **THEN** the seed refuses with a message that refers to the roster's first applicant, not to the address
