## ADDED Requirements

### Requirement: A close after a filing says what was filed
A closed case SHALL tell the client what happened to each return when at least one return was filed before the close. Each return SHALL have one outcome, from the case's filing method and result:

| Method and result | Outcome |
|---|---|
| any method, result accepted | accepted |
| e-filed, no result yet | waiting |
| given to the client (or on paper with no result) | paper |
| rejected, or no method | not filed |

A case has a filed return when either return is accepted, waiting or paper. The case's filing methods are both set or both unset; a case with no methods has no filed return. The system SHALL NOT tell "no Pennsylvania return needed" apart from "not filed".

When a case closed with reason `dismissed`, `withdrawn`, `out_of_scope` or `no_need_to_file` has a filed return, its closed message and its close history line SHALL be the reason's sentence, then the federal return's sentence, then the Pennsylvania return's sentence. In English the sentences SHALL be joined by one space, in 简体 with nothing between them.

| Reason | English | 简体 |
|---|---|---|
| `dismissed` | PCDC could not reach you, so this application was closed. | PCDC 无法联系到您，因此此申请已关闭。 |
| `withdrawn` | You withdrew this application. | 您已撤回此申请。 |
| `out_of_scope` | This application was closed because the return is outside what VITA volunteers can prepare. | 此申请已关闭，因为该报税表超出了 VITA 志愿者可以准备的范围。 |
| `no_need_to_file` | A PCDC volunteer confirmed with you that nothing more needs to be prepared this year, so this application was closed. | PCDC 志愿者已与您确认，今年没有其他需要准备的报税表，因此此申请已关闭。 |

| Return and outcome | English | 简体 |
|---|---|---|
| federal, accepted | Your federal return was filed and accepted. Do not file it again. | 您的联邦报税表已递交并被接受。请勿再次递交。 |
| federal, waiting | Your federal return was e-filed and is waiting for an answer. Do not file it again. | 您的联邦报税表已电子递交，正在等待回复。请勿再次递交。 |
| federal, paper | PCDC gave you your federal return on paper. It is filed only after you mail it. | PCDC 已将纸质的联邦报税表交给您。您寄出后才算递交。 |
| federal, not filed | Your federal return was not filed. | 您的联邦报税表未递交。 |
| Pennsylvania, accepted | Your Pennsylvania return was filed and accepted. Do not file it again. | 您的宾州报税表已递交并被接受。请勿再次递交。 |
| Pennsylvania, waiting | Your Pennsylvania return was e-filed and is waiting for an answer. Do not file it again. | 您的宾州报税表已电子递交，正在等待回复。请勿再次递交。 |
| Pennsylvania, paper | PCDC gave you your Pennsylvania return on paper. It is filed only after you mail it. | PCDC 已将纸质的宾州报税表交给您。您寄出后才算递交。 |
| Pennsylvania, not filed | Your Pennsylvania return was not filed. | 您的宾州报税表未递交。 |

When no return was filed, and for reasons `duplicate` and `other` and a case closed before reasons existed, the closed message and history line SHALL be exactly the ones in "Clients are told at each new step". This SHALL hold for Close, at every stage it allows, and for the season-end close. The status panel and the history line SHALL give the same text for the same case. Every line this requirement can produce, for every pair of outcomes with a filed return, SHALL have its 简体 translation, and 繁體 SHALL be generated from it. History lines already stored SHALL keep their words.

#### Scenario: Closed at Rejected with the other return accepted
- **WHEN** the federal return was rejected and the Pennsylvania return accepted, and an admin closes the Rejected case with reason Withdrawn
- **THEN** the client's status panel and new history line read "You withdrew this application. Your federal return was not filed. Your Pennsylvania return was filed and accepted. Do not file it again."

#### Scenario: The same in 简体
- **WHEN** a client reading in 简体 opens that case
- **THEN** the status panel and the history line read "您已撤回此申请。您的联邦报税表未递交。您的宾州报税表已递交并被接受。请勿再次递交。"

#### Scenario: Closed while the other return waits
- **WHEN** the federal return was rejected while the e-filed Pennsylvania return is still waiting, and an admin closes the case with reason Dismissed
- **THEN** the client reads "PCDC could not reach you, so this application was closed. Your federal return was not filed. Your Pennsylvania return was e-filed and is waiting for an answer. Do not file it again."

#### Scenario: A paper return must still be mailed
- **WHEN** the federal return was rejected and the Pennsylvania return was given to the client on paper, and an admin closes the case with reason Out of scope
- **THEN** the client reads "This application was closed because the return is outside what VITA volunteers can prepare. Your federal return was not filed. PCDC gave you your Pennsylvania return on paper. It is filed only after you mail it."

#### Scenario: Season-end close after Return to signing
- **WHEN** a case with an accepted Pennsylvania return and a rejected federal return is returned to signing, and an admin closes it with the season-end close
- **THEN** the client reads "PCDC could not reach you, so this application was closed. Your federal return was not filed. Your Pennsylvania return was filed and accepted. Do not file it again."

#### Scenario: No need to file, after a filing
- **WHEN** a case with an accepted federal return and a rejected Pennsylvania return is closed with reason No need to file
- **THEN** the client reads "A PCDC volunteer confirmed with you that nothing more needs to be prepared this year, so this application was closed. Your federal return was filed and accepted. Do not file it again. Your Pennsylvania return was not filed."

#### Scenario: Both returns rejected
- **WHEN** both returns were rejected and an admin closes the Rejected case with reason Dismissed
- **THEN** the client reads "PCDC could not reach you, so this application was closed. Your return was not filed.", as today

#### Scenario: A duplicate after a filing
- **WHEN** a case with an accepted Pennsylvania return is closed with reason Duplicate
- **THEN** the client reads "This application was closed. Your return continues under your other application with PCDC.", as today

#### Scenario: Every combination is translated
- **WHEN** the database's closed line is computed for every reason and every pair of return outcomes
- **THEN** each line equals the status panel's English for the same case, and each has a 简体 translation equal to the status panel's 简体

## MODIFIED Requirements

### Requirement: The lists and the case page show every stage
**The work board** SHALL keep its three tabs:
- **Available:** Pending intake / filing with no preparer.
- **Waiting for preparation:** Filing in progress and Corrections in progress.
- **Waiting for review:** Pending review and Review in progress.

Its search SHALL reach a case in any stage.

**The case pool** SHALL have these tabs, in this order: All, Intake (Draft, Request sent, Screening in progress), Available, Waiting for preparation, Waiting for review, Waiting on client (Waiting for documents, Ready to exit), Filing (Ready to e-file, E-filed), Needs attention (Hold, Rejected), Done (Accepted), and Closed. Its stage filter SHALL list every stage. The Closed tab SHALL have a reason filter: All, each of the six reasons, and No reason (cases closed before reasons existed). The pool, Follow-ups and the case page SHALL show E-filed and Accepted by their staff name for the case's filing method.

**Follow-ups** SHALL show an admin **Close unsigned cases…** above its rows (see "An admin closes unsigned cases at season end"), and:
- a row for each case at Request sent ("New application: open it to start screening."), with **Open**;
- a row for each case at Screening in progress ("Finish screening."), with **Open**;
- a **Waiting for documents** row for each case at Waiting for documents ("Waiting for the client's documents."), with **Put on hold…**;
- a **Hold** row for each case on Hold: "Can't reach the client about documents." for a Hold that came from Waiting for documents, or "Can't reach the client to sign." for one that came from Ready to exit. It has **Got in touch…** and **Close…**;
- a **Withdrawn** row for each open `withdrawal_notice` follow-up, with **Resolve**. It reads "The client withdrew; tell <name> to stop work." for a client's own withdrawal during preparation or review, "The client withdrew; make sure the return is not transmitted in TaxSlayer." for an admin's withdrawn close at Ready to exit, a Hold from Ready to exit, or Ready to e-file, "The case was closed before filing; make sure the return is not transmitted in TaxSlayer." for an admin's individual close of a Hold from Ready to exit with any other reason when no return was filed, or "The case was closed after a return was filed; make sure the rejected return is not transmitted again in TaxSlayer." for that close when a return was already filed;
- a row for each case at Ready to exit ("Waiting for the client to sign."), with **Mark ready to e-file…**. While the reviewer's call with the client is still pending, the row SHALL read "Waiting for the reviewer's call with the client." instead, with the call-pending explanation in place of the button. For a case returned to signing after a rejection, the row SHALL read "Waiting for the client to sign again.";
- a row for each case at Ready to e-file ("Ready to e-file."), with **Mark e-filed…**;
- a **Filing result** row for each case at E-filed, and for each case at Rejected with an e-filed return still waiting, with **Record filing result…**. It SHALL read "Waiting for the IRS and Pennsylvania." while both returns wait, or "Waiting for Pennsylvania's answer." or "Waiting for the IRS's answer." while one e-filed return waits. A return on paper SHALL never be waited for;
- a **Rejected** row for each case at Rejected ("Rejected: contact the client to fix and sign again."), followed by the latest fix note, as typed, if there is one. It has **Return to signing…**, or, while an e-filed return still waits, "Waiting for Pennsylvania's answer before the return can go back to signing." (or "…the IRS's answer…") in its place;

alongside today's rows. A case at Accepted SHALL have no row. Follow-ups' filter SHALL list every kind. A row's waiting time SHALL count from the case's last move or recorded result.

The amber (3 days) and red (5 days) colouring SHALL apply to a Waiting for documents row and to a Filing result row. A Hold row, a Withdrawn row and a Rejected row SHALL never be coloured.

**The case page:**
- Its lifecycle bar SHALL show Request sent, Screening in progress, Pending intake / filing, Filing in progress, Pending review, Review in progress, Ready to exit, Ready to e-file, E-filed and Accepted. Accepted SHALL be the bar's last step: the bar SHALL NOT show Closed after Accepted for any case that is not closed. At Accepted every step SHALL be shown done, and no step SHALL be shown as the current one. A closed case's bar SHALL show Closed after Accepted as its only current step, and every step before it SHALL be shown neutral: neither done nor still to come. Where a closed case stopped SHALL be read in its History tab. Corrections in progress SHALL show on Filing in progress, and Rejected on E-filed. Waiting for documents SHALL show on the stage it was asked from. Hold SHALL show on the stage it came from: Ready to exit, or the stage the documents were asked from.
- For an admin, the intake-check form SHALL show at Screening in progress only.
- For an admin, the office actions panel SHALL offer Ask for documents…, Put on hold…, Got in touch… and Close… at the stages their moves allow. Close… SHALL offer the six reasons and the note.
- For an admin, the signing panel SHALL be headed "Signing". At a Hold that came from Ready to exit it SHALL say "The office could not reach the client to sign.", and before Ready to e-file it SHALL say "This is recorded once the client has signed.".
- At Request sent, the case page SHALL say that screening starts when an admin opens the case.
- A volunteer's "Your next step" SHALL say what each new stage is waiting for:
  - Waiting for documents: "The office is waiting for the client's documents.";
  - Hold: "The office is trying to reach the client.";
  - E-filed: "The office records the answers from the IRS and Pennsylvania.";
  - Rejected: "A return was rejected. The site coordinator fixes it in TaxSlayer, and the office contacts the client.";
  - Accepted: "The returns are accepted or given to the client on paper. Nothing more is needed here.".
- The case's history SHALL name each new move. Mark ready to e-file SHALL read "recorded the client's signature".

#### Scenario: The pool's Filing tab
- **WHEN** an admin opens the case pool's Filing tab
- **THEN** it lists the cases at Ready to e-file and E-filed, and no other

#### Scenario: Needs attention and Done
- **WHEN** an admin opens the case pool's Needs attention tab, then its Done tab
- **THEN** the first lists only cases on Hold and Rejected cases, and the second only Accepted cases

#### Scenario: Waiting on client
- **WHEN** an admin opens the case pool's Waiting on client tab
- **THEN** it lists the cases at Waiting for documents and Ready to exit, and no other

#### Scenario: Closed by reason
- **WHEN** an admin filters the Closed tab by Withdrawn
- **THEN** it lists only cases closed with reason `withdrawn`

#### Scenario: Follow-ups shows signing
- **WHEN** a case is approved by its reviewer, and the reviewer has recorded the conversation with the client
- **THEN** Follow-ups shows its row, "Waiting for the client to sign.", with Mark ready to e-file…

#### Scenario: Waiting for documents turns amber
- **WHEN** a case has waited three days at Waiting for documents
- **THEN** its row is amber, and reads "Waiting for the client's documents."

#### Scenario: A hold is never coloured
- **WHEN** a case has been on Hold for ten days
- **THEN** its Hold row is not coloured

#### Scenario: A late acknowledgment turns amber
- **WHEN** a both-e-filed case has waited three days at E-filed with no answer recorded
- **THEN** its Filing result row is amber, and reads "Waiting for the IRS and Pennsylvania."

#### Scenario: A mailing row is never coloured
- **WHEN** a case was filed with the federal return on paper and the state return e-filed, and has waited six days at E-filed
- **THEN** no row waits for a mailing: its Filing result row reads "Waiting for Pennsylvania's answer.", is coloured red for Pennsylvania's wait, and mentions nothing about the paper return

#### Scenario: The Rejected row shows the fix note
- **WHEN** a case is Rejected with the fix note "Site coordinator to correct the dependent's SSN in TaxSlayer"
- **THEN** its Rejected row reads "Rejected: contact the client to fix and sign again." followed by that note, with Return to signing…

#### Scenario: Accepted leaves the queue
- **WHEN** the last waiting return of a case is recorded as accepted
- **THEN** the case has no Follow-ups row

#### Scenario: The bar of an Accepted case
- **WHEN** a staff member opens a case at Accepted
- **THEN** its lifecycle bar shows every step from Request sent to Accepted as done, no step as current, and no Closed

#### Scenario: The bar of a closed case
- **WHEN** a staff member opens a case that was closed from Pending review
- **THEN** its lifecycle bar shows Closed after Accepted as the current step, and every step from Request sent to Accepted as neutral, neither done nor still to come

#### Scenario: The bar of an open case ends at Accepted
- **WHEN** a staff member opens a case at Pending review
- **THEN** its lifecycle bar shows the steps before Pending review as done, Pending review as current, the steps from Review in progress to Accepted as still to come, and no Closed

#### Scenario: Rejected and Corrections in progress are unchanged
- **WHEN** a staff member opens a case at Rejected, and another at Corrections in progress
- **THEN** the first bar shows Rejected on the E-filed step and the second shows Corrections in progress on the Filing in progress step, each as the current step with the steps before it done

### Requirement: Clients are told at each new step
The client's status panel SHALL show the message for their case's stage, in their language:

| Stage | English | 简体 |
|---|---|---|
| Request sent | Your application is with PCDC. The office will review it soon and may call you. | PCDC 已收到您的申请。办公室会尽快查看，并可能致电您。 |
| Screening in progress | PCDC is reviewing your application. We may call you to confirm your information and documents. | PCDC 正在审核您的申请。我们可能会致电您，核对您的信息和文件。 |
| Waiting for documents | PCDC needs more documents from you before your return can be prepared. See the requests below. | PCDC 需要您提供更多文件，才能准备您的报税表。请查看下方的文件请求。 |
| Hold, from Waiting for documents | PCDC has been trying to reach you about the documents we need. Please upload them below or contact PCDC. | PCDC 一直在设法联系您，询问所需的文件。请在下方上传，或联系 PCDC。 |
| Hold, from Ready to exit | PCDC has been trying to reach you to sign your return. Please contact PCDC. Your return can't be filed until you sign. | PCDC 一直在设法联系您签署报税表。请联系 PCDC。您签署后才能递交报税表。 |
| Pending intake / filing | Your application has been checked. It is waiting for a volunteer to start preparing your return. | 您的申请已核对完毕，正在等待志愿者开始准备您的报税表。 |
| Pending review | Your return is prepared and is waiting for an independent reviewer. | 您的报税表已准备好，正在等待审核志愿者检查。 |
| Ready to exit | Your return has been checked. PCDC will contact you to sign it. Your return can't be filed until you sign. | 您的报税表已检查完毕。PCDC 会联系您签署报税表。您签署后才能递交报税表。 |
| Ready to e-file | Your return is ready. PCDC will take the next step. | 您的报税表已准备好。PCDC 会进行下一步。 |

At Ready to exit, the message above SHALL be shown only for a case approved without a reviewer questionnaire (before the questionnaires existed). A case approved with one SHALL show the variant for the signing plan the approval chose (capability `review-and-corrections`):

| Signing plan | Chosen when | English | 简体 |
|---|---|---|---|
| Appointment | in person, and the visit was not same-day | Your return has been checked. Please come to PCDC on {when} to sign it. Your return can't be filed until you sign. | 您的报税表已检查完毕。请于 {when} 到 PCDC 签署报税表。您签署后才能递交报税表。 |
| Same day | in person, on a same-day visit | Your return has been checked. Please sign it with a volunteer before you leave today. Your return can't be filed until you sign. | 您的报税表已检查完毕。请在今天离开前与志愿者一起签署报税表。您签署后才能递交报税表。 |
| Customer Portal | e-sign in the TaxSlayer Customer Portal | Your return has been checked. Please e-sign Form 8879 in the TaxSlayer Customer Portal. Your return can't be filed until you sign. | 您的报税表已检查完毕。请在 TaxSlayer 客户门户（Customer Portal）以电子方式签署 8879 表。您签署后才能递交报税表。（门户为英文页面，可用浏览器翻译） |
| Go over first | the reviewer did not go over the return with the client, whatever the signing method, until the office resolves its go-over follow-up | Your return has been checked. PCDC will contact you to go over your return together. After that, you will sign it. Your return can't be filed until you sign. | 您的报税表已检查完毕。PCDC 会联系您，先和您一起查看报税表，再请您签署。您签署后才能递交报税表。 |

The Customer Portal variant SHALL be the only client message that names Form 8879. `{when}` SHALL be the appointment's date and time as the reviewer entered it, in the screen's language, with the weekday and no year. It SHALL never be shifted by the viewer's time zone. The variant SHALL be set at approval and SHALL change only once: when the office resolves the go-over follow-up of a Go over first case, with either outcome, the client SHALL from then on see the variant for the reviewer's signing method (Appointment with the stored date and time, Same day, or Customer Portal), chosen by the same rules as at approval. The client SHALL read only the signing plan and the appointment, never an answer of either questionnaire.

A case at Ready to exit after Return to signing SHALL show the re-sign message instead of any variant above:

| English | 简体 |
|---|---|
| PCDC corrected your return. Please sign it again so PCDC can file it. PCDC will contact you to arrange this. | PCDC 已更正您的报税表。请再次签名，以便 PCDC 递交。PCDC 会联系您安排签名。 |

At E-filed, Rejected and Accepted, the message SHALL be built from one sentence about each return, federal first, then the stage's closing sentence. When both returns are in the same state, the combined sentence SHALL replace the two. A return's sentence SHALL depend on its method and answer: e-filed and waiting, accepted, rejected, or given to the client on paper. A paper return SHALL be told as given to the client from Mark e-filed on.

| Return's state | Federal | Pennsylvania | Both |
|---|---|---|---|
| E-filed, waiting | Your federal return was e-filed. The IRS will confirm whether it is accepted. / 您的联邦报税表已电子递交。国税局会确认是否接受。 | Your Pennsylvania return was e-filed. Pennsylvania will confirm whether it is accepted. / 您的宾州报税表已电子递交。宾州税务局会确认是否接受。 | Your federal and Pennsylvania returns were e-filed. The IRS and Pennsylvania will each confirm whether they are accepted. / 您的联邦和宾州报税表已电子递交。国税局和宾州税务局会分别确认是否接受。 |
| Accepted | The IRS accepted your federal return. / 国税局已接受您的联邦报税表。 | Pennsylvania accepted your Pennsylvania return. / 宾州税务局已接受您的宾州报税表。 | The IRS and Pennsylvania accepted your returns. / 国税局和宾州税务局都已接受您的报税表。 |
| Rejected | Your federal return needs a correction before it can be accepted. / 您的联邦报税表需要更正后才能被接受。 | Your Pennsylvania return needs a correction before it can be accepted. / 您的宾州报税表需要更正后才能被接受。 | Your federal and Pennsylvania returns need a correction before they can be accepted. / 您的联邦和宾州报税表需要更正后才能被接受。 |
| Given to the client | PCDC gave your federal return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it. / PCDC 已将您的联邦报税表纸本交给您或您委托的人。如果还没有签名，请先签名，然后自行邮寄。邮寄后可能需要约 3 个月才会有回复。 | PCDC gave your Pennsylvania return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it. / PCDC 已将您的宾州报税表纸本交给您或您委托的人。如果还没有签名，请先签名，然后自行邮寄。邮寄后可能需要约 3 个月才会有回复。 | PCDC gave your federal and Pennsylvania returns on paper to you or the person you sent. If they aren't signed yet, sign them, then mail them yourself. A reply can take about 3 months after you mail them. / PCDC 已将您的联邦和宾州报税表纸本交给您或您委托的人。如果还没有签名，请先签名，然后自行邮寄。邮寄后可能需要约 3 个月才会有回复。 |

| Stage | Closing sentence (en / 简体) |
|---|---|
| E-filed | none |
| Rejected | PCDC will contact you about the correction. / PCDC 会就更正事宜联系您。 |
| Accepted | If you are due a refund, you can check on it with "Where's My Refund?" at irs.gov/refunds for your federal return, and with myPATH at mypath.pa.gov for your Pennsylvania return. / 如果您有退税，可以在 irs.gov/refunds 使用 "Where's My Refund?" 查询联邦退税，在 mypath.pa.gov 使用 myPATH 查询宾州退税。（网站为英文页面，可用浏览器翻译） |

A case at E-filed whose returns have no filing method (e-filed before filing methods existed) SHALL show "Your return was e-filed. The IRS will confirm whether it is accepted." / "您的报税表已电子递交。国税局会确认是否接受。". The websites SHALL appear as plain text, not links.

A closed case SHALL show the message for its reason, unless a return was filed before the close (see "A close after a filing says what was filed"):

| Reason | English | 简体 |
|---|---|---|
| `out_of_scope` | This application was closed because the return is outside what VITA volunteers can prepare. Your return was not filed by PCDC. | 此申请已关闭，因为该报税表超出了 VITA 志愿者可以准备的范围。PCDC 未递交您的报税表。 |
| `no_need_to_file` | A PCDC volunteer confirmed with you that you don't need to file a return this year, so this application was closed. | PCDC 志愿者已与您确认，您今年无需递交报税表，因此此申请已关闭。 |
| `duplicate` | This application was closed. Your return continues under your other application with PCDC. | 此申请已关闭。您的报税表将在您在 PCDC 的另一份申请中继续处理。 |
| `dismissed` | PCDC could not reach you, so this application was closed. Your return was not filed. | PCDC 无法联系到您，因此此申请已关闭。您的报税表未递交。 |
| `withdrawn` | You withdrew this application. Your return was not filed. | 您已撤回此申请。您的报税表未递交。 |
| `other`, or no reason (closed before reasons existed) | This application was closed by the office. This does not change any return filed elsewhere. | 此申请已由办公室关闭。这不影响在其他地方递交的任何报税表。 |

The `duplicate` message SHALL never name the other application. No closed message SHALL show the staff note.

Draft, Filing in progress, Corrections in progress and Review in progress SHALL keep today's messages.

Each new move SHALL add one line to the client's history, in their language:

| Move | English | 简体 |
|---|---|---|
| Start screening, and the office's submit | PCDC started reviewing your application. We may call you. | PCDC 已开始审核您的申请。我们可能会致电您。 |
| Ask for documents | PCDC asked for these documents: {titles}. | PCDC 请您提供以下文件：{titles}。 |
| Put on hold | PCDC is trying to reach you. | PCDC 正在设法联系您。 |
| Got in touch, and the return after the last verified document | PCDC is working on your application again. | PCDC 已继续处理您的申请。 |
| Withdraw | You withdrew your application. Your return was not filed. | 您已撤回申请。您的报税表未递交。 |
| Close, and the season-end close | the closed message for its reason, from the table above, or the line from "A close after a filing says what was filed" when a return was filed; for `other`, today's line | the same, in 简体 |
| Mark ready to e-file | PCDC recorded that your return is ready. PCDC will take the next step. | PCDC 已记录您的报税表已准备好。PCDC 会进行下一步。 |
| Mark e-filed, both e-filed | PCDC e-filed your return. | PCDC 已电子递交您的报税表。 |
| Mark e-filed, federal e-filed and state on paper | PCDC e-filed your federal return and gave your Pennsylvania return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it. | PCDC 已电子递交您的联邦报税表，并将您的宾州报税表纸本交给您或您委托的人。如果还没有签名，请先签名，然后自行邮寄。邮寄后可能需要约 3 个月才会有回复。 |
| Mark e-filed, federal on paper and state e-filed | PCDC gave your federal return on paper to you or the person you sent, and e-filed your Pennsylvania return. If the federal return isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it. | PCDC 已将您的联邦报税表纸本交给您或您委托的人，并电子递交了您的宾州报税表。如果联邦报税表还没有签名，请先签名，然后自行邮寄。邮寄后可能需要约 3 个月才会有回复。 |
| Mark e-filed, both on paper | PCDC gave your returns on paper to you or the person you sent. If they aren't signed yet, sign them, then mail them yourself. A reply can take about 3 months after you mail them. | PCDC 已将您的报税表纸本交给您或您委托的人。如果还没有签名，请先签名，然后自行邮寄。邮寄后可能需要约 3 个月才会有回复。 |
| Mark e-filed, after Return to signing, one return | PCDC e-filed your federal return. / PCDC gave your federal return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it. / PCDC e-filed your Pennsylvania return. / PCDC gave your Pennsylvania return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it. | PCDC 已电子递交您的联邦报税表。/ PCDC 已将您的联邦报税表纸本交给您或您委托的人。如果还没有签名，请先签名，然后自行邮寄。邮寄后可能需要约 3 个月才会有回复。/ PCDC 已电子递交您的宾州报税表。/ PCDC 已将您的宾州报税表纸本交给您或您委托的人。如果还没有签名，请先签名，然后自行邮寄。邮寄后可能需要约 3 个月才会有回复。 |
| Record filing result | for the returns recorded in the move: their Accepted or Rejected sentences from the table above, combined when both are the same, federal first | the same sentences in 简体 |
| Return to signing | PCDC corrected your return. You need to sign it again. | PCDC 已更正您的报税表，您需要再次签名。 |
| The screening checks | PCDC finished screening your application. A volunteer will start preparing your return next. | PCDC 已完成对您申请的审核。接下来会有志愿者开始准备您的报税表。 |

A Mark e-filed that takes the case to Accepted SHALL add only its own line above.

`{titles}` SHALL be every title requested in the move, as the office typed it, joined with ", ". The titles SHALL stay as typed in every language, as a preparer's request title does today.

Every history line the system can store SHALL have its 简体 translation. Earlier history lines SHALL keep their words and translations. That includes "PCDC recorded that you signed Form 8879. Your return is ready to e-file.", the earlier Mark e-filed lines that say "mailed", and the Record filing result lines that say a return "was mailed" and that a reply "can take several weeks". The screening checks' line SHALL replace "Simulated intake checks are recorded. Your application is waiting for a volunteer to start preparation." for every new record; lines already stored SHALL keep that sentence and its translation. No client message or history line SHALL name a phone number, a hold note or a close note.

#### Scenario: A history line in 简体
- **WHEN** a client reading in 简体 opens a case an admin marked ready to e-file
- **THEN** its history shows "PCDC 已记录您的报税表已准备好。PCDC 会进行下一步。"

#### Scenario: An old signing line keeps its words
- **WHEN** a client reading in 简体 opens a case marked ready to e-file before this change
- **THEN** its history still shows "PCDC 已记录您签署了 8879 表。您的报税表可以电子递交了。" for that line

#### Scenario: No phone number
- **WHEN** a client reads any new stage message or history line, in any language, including each Ready to exit variant with an appointment, the Accepted message, the Hold messages and every closed message
- **THEN** none of them contains a phone number

#### Scenario: An appointment to sign
- **WHEN** the reviewer approves a drop-off case with in person and an appointment of 2026-11-02 14:30, and the client opens their progress page in English
- **THEN** the status panel reads "Your return has been checked. Please come to PCDC on Monday, November 2 at 2:30 PM to sign it. Your return can't be filed until you sign."

#### Scenario: The same appointment in 简体
- **WHEN** that client opens the page in 简体, in a browser set to any time zone
- **THEN** the status panel reads "您的报税表已检查完毕。请于 11月2日星期一 下午2:30 到 PCDC 签署报税表。您签署后才能递交报税表。"

#### Scenario: Signing on site the same day
- **WHEN** the reviewer approves a same-day case with in person
- **THEN** the client's status panel shows the Same day message

#### Scenario: Signing in the Customer Portal
- **WHEN** the reviewer approves a case with the Customer Portal and yes
- **THEN** the client's status panel shows the Customer Portal message, which names Form 8879

#### Scenario: Not yet gone over
- **WHEN** the reviewer approves with "no" to going over the return and the Customer Portal
- **THEN** the client's status panel shows the Go over first message, not the Customer Portal one

#### Scenario: After the go-over is resolved the client sees the signing variant
- **WHEN** the reviewer approved with "no" to going over the return and the Customer Portal, and the office then resolves the go-over follow-up, with either outcome
- **THEN** the client's status panel shows the Customer Portal message instead of the Go over first message, while the case is still at Ready to exit
- **AND WHEN** the reviewer had chosen in person with an appointment on a drop-off case
- **THEN** after the resolve the client sees the Appointment message with that appointment's date and time

#### Scenario: A case approved before this change
- **WHEN** a client opens a case that was approved before the questionnaires existed
- **THEN** the status panel shows "Your return has been checked. PCDC will contact you to sign it. Your return can't be filed until you sign."

#### Scenario: Ready to e-file doesn't claim a signature
- **WHEN** a client opens a case at Ready to e-file
- **THEN** the status panel reads "Your return is ready. PCDC will take the next step."

#### Scenario: The screening checks' line
- **WHEN** an admin records the screening checks and the client opens their history in English, then in 简体
- **THEN** it shows "PCDC finished screening your application. A volunteer will start preparing your return next." and "PCDC 已完成对您申请的审核。接下来会有志愿者开始准备您的报税表。", and no history line says "Simulated"

#### Scenario: An old line keeps its words
- **WHEN** a client reading in 简体 opens a case whose checks were recorded before this change
- **THEN** its history still shows "模拟的登记核查已记录。…" for that line

#### Scenario: Both returns waiting
- **WHEN** a client opens a both-e-filed case at E-filed
- **THEN** the status panel reads "Your federal and Pennsylvania returns were e-filed. The IRS and Pennsylvania will each confirm whether they are accepted."

#### Scenario: One accepted, one waiting
- **WHEN** the federal return is accepted and the e-filed state return still waits
- **THEN** the status panel reads "The IRS accepted your federal return. Your Pennsylvania return was e-filed. Pennsylvania will confirm whether it is accepted."

#### Scenario: Rejected, in 简体
- **WHEN** a client reading in 简体 opens a case whose federal return was accepted and state return rejected
- **THEN** the status panel reads "国税局已接受您的联邦报税表。您的宾州报税表需要更正后才能被接受。PCDC 会就更正事宜联系您。", and no reject code appears

#### Scenario: E-filed with the state return on paper
- **WHEN** a client opens a case at E-filed whose federal return was e-filed and state return given to them on paper
- **THEN** the status panel reads "Your federal return was e-filed. The IRS will confirm whether it is accepted. PCDC gave your Pennsylvania return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it."

#### Scenario: Mailed
- **WHEN** a client opens a case whose returns were both given to them on paper, to sign and mail themselves
- **THEN** the case is Accepted, the status panel reads "PCDC gave your federal and Pennsylvania returns on paper to you or the person you sent. If they aren't signed yet, sign them, then mail them yourself. A reply can take about 3 months after you mail them." followed by the refund sentence, and the history has one line for the filing

#### Scenario: Complete
- **WHEN** a client opens a both-e-filed case whose returns were both accepted
- **THEN** the status panel reads "The IRS and Pennsylvania accepted your returns." followed by the refund sentence naming irs.gov/refunds and mypath.pa.gov, as plain text

#### Scenario: Sign again
- **WHEN** an admin returns a rejected case to signing and the client opens their progress page
- **THEN** the status panel shows the re-sign message instead of the approval's signing variant, and the history gains "PCDC corrected your return. You need to sign it again."

#### Scenario: Waiting for documents, in 简体
- **WHEN** a client reading in 简体 opens a case at Waiting for documents
- **THEN** the status panel reads "PCDC 需要您提供更多文件，才能准备您的报税表。请查看下方的文件请求。", and the requests are listed below it

#### Scenario: Closed, not filed
- **WHEN** a client opens a case closed with reason Dismissed before any return was filed
- **THEN** the status panel reads "PCDC could not reach you, so this application was closed. Your return was not filed."

#### Scenario: A duplicate doesn't name the other application
- **WHEN** a client opens a case closed with reason Duplicate
- **THEN** the status panel reads "This application was closed. Your return continues under your other application with PCDC.", and no reference or client number of another case appears

### Requirement: A client may withdraw their own application
The client SHALL be offered **Withdraw this application** / 撤回此申请 on their progress page while the case is at Request sent, Screening in progress, Waiting for documents, a Hold that came from Waiting for documents, Pending intake / filing, Filing in progress, Corrections in progress, Pending review or Review in progress.

Its dialog SHALL require the box "I want to withdraw this application. My return will not be filed." / "我要撤回此申请。我的报税表将不会被递交。" to be ticked. The database SHALL refuse the move without it.

The move SHALL:
- close the case with reason `withdrawn`, cancelling open document requests and follow-ups as Close does;
- add the client's history line "You withdrew your application. Your return was not filed." / "您已撤回申请。您的报税表未递交。";
- add the staff history sentence "the client withdrew the application".

It SHALL have no undo. Only the case's own client SHALL be able to withdraw it, and no staff persona SHALL withdraw on a client's behalf through this move.

At Draft the button SHALL not be offered. At Ready to exit, a Hold that came from Ready to exit, Ready to e-file and Rejected, the client SHALL have no Withdraw button. The button SHALL be replaced by "To withdraw now, contact PCDC." / "如需撤回，请联系 PCDC。". After the client contacts PCDC, an admin closes the case with reason `withdrawn`. At E-filed, Accepted and Closed, the client SHALL see neither the button nor the line.

When the client withdraws a case at Filing in progress, Corrections in progress or Review in progress, an office follow-up with purpose `withdrawal_notice` SHALL open (capability `office-follow-up`). Follow-ups SHALL show it as "The client withdrew; tell <name> to stop work.", naming the case's preparer (or, at Review in progress, its reviewer). Withdrawing at any other stage SHALL open no follow-up.

When an admin closes a case before filing with Close, an office follow-up with purpose `withdrawal_notice` SHALL open, because a reviewed return that hasn't been transmitted is left in TaxSlayer. Closing before filing means with reason `withdrawn` at Ready to exit or Ready to e-file, or with any reason at a Hold that came from Ready to exit. Follow-ups SHALL show it as:
- "The client withdrew; make sure the return is not transmitted in TaxSlayer." for reason `withdrawn`;
- "The case was closed before filing; make sure the return is not transmitted in TaxSlayer." for any other reason when no return was filed;
- "The case was closed after a return was filed; make sure the rejected return is not transmitted again in TaxSlayer." for any other reason when a return was already filed before the case went back to signing (see "A close after a filing says what was filed").

Each notice SHALL stay open until someone resolves it, like any other follow-up. Closing a Hold that came from Waiting for documents SHALL open no notice. The season-end close of unsigned cases SHALL open no notice: its confirmation states once that none of the returns will be transmitted.

#### Scenario: Withdrawing before preparation
- **WHEN** a client at Pending intake / filing withdraws, ticking the box
- **THEN** the case is Closed with reason `withdrawn`, the client reads "You withdrew this application. Your return was not filed.", and no follow-up opens

#### Scenario: Withdrawing during preparation
- **WHEN** a client whose case Alex Rivera is preparing withdraws
- **THEN** the case is Closed, and Follow-ups shows "The client withdrew; tell Alex Rivera to stop work." until the office resolves it

#### Scenario: Too late for the button
- **WHEN** a client opens a case at Ready to exit
- **THEN** there is no Withdraw button, and the page says "To withdraw now, contact PCDC."

#### Scenario: Only the client
- **WHEN** a staff persona tries to withdraw a case
- **THEN** it is refused as forbidden, and nothing is recorded
- **AND WHEN** a different client tries to withdraw it
- **THEN** it is refused as not found, because that client can't see the case, and nothing is recorded

#### Scenario: Withdrawn after signing
- **WHEN** the client of a case at Ready to e-file contacts PCDC and an admin closes the case with reason Withdrawn
- **THEN** the case is Closed with reason `withdrawn`, and Follow-ups shows "The client withdrew; make sure the return is not transmitted in TaxSlayer." until the office resolves it

#### Scenario: A signer who can't be reached is closed before filing
- **WHEN** an admin closes a Hold that came from Ready to exit with reason Dismissed
- **THEN** the case is Closed, and Follow-ups shows "The case was closed before filing; make sure the return is not transmitted in TaxSlayer." until the office resolves it

#### Scenario: No line once filed
- **WHEN** a client opens a case at E-filed or Accepted
- **THEN** there is neither a Withdraw button nor "To withdraw now, contact PCDC."

#### Scenario: Closed before the second filing
- **WHEN** a case whose Pennsylvania return was accepted and federal return rejected is returned to signing, put on hold, and an admin closes the Hold with reason Dismissed
- **THEN** the case is Closed, and Follow-ups shows "The case was closed after a return was filed; make sure the rejected return is not transmitted again in TaxSlayer." until the office resolves it
