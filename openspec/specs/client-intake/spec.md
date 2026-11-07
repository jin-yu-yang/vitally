# client-intake Specification

## Purpose
How a tax-season application's intake form is chosen and kept, and what it asks. It covers which intake version a new application gets, whether the client starts it or the office enters it for a walk-in client. It covers that an application keeps its version for life. It also covers what the form asks and requires before it can be submitted, whoever fills it: a household member's name, the Form 15080 signatures, and the Form 14446 signatures, whose dates fill themselves. It covers the virtual-process consent (Form 14446) that a client gives before the rest of the form opens, and that fictional details leave the client's own 14446 answers alone. And it covers how the form's wording and options follow the client's marital status, so that a client who can't file with a spouse is never asked about one, and how a recently widowed client gives their late spouse's details, with the year of the death checked. It covers the client's service languages: the preferred one and any others they can be helped in, and how the progress page lists them. Finally, it covers how the client reviews and submits the application: the review step's alerts, which must be fixed before its summary and Submit pages appear, and the summary page itself, with its tools, collapsible sections and printout.

## Requirements

### Requirement: New applications use intake version 2
Version 2 SHALL be the only intake version a workspace or an application accepts. A workspace's default intake version SHALL be 2, and setting it to any other value SHALL be refused. Every new application SHALL be version 2, whether a client starts their own or the office starts one for a walk-in client with Add a case.

#### Scenario: A new workspace defaults to version 2
- **WHEN** a workspace is created without naming an intake version
- **THEN** its default intake version is 2

#### Scenario: An existing workspace is switched to version 2
- **WHEN** version 1 is removed from a database where a workspace is still set to version 1
- **THEN** every workspace's default intake version is 2

#### Scenario: Setting a workspace to version 1 is refused
- **WHEN** a workspace's default intake version is set to 1
- **THEN** the change is refused and the workspace stays at version 2

#### Scenario: A client's new application is version 2
- **WHEN** a client starts a new application
- **THEN** the application's intake version is 2

#### Scenario: The office's new application is version 2
- **WHEN** the office starts an assisted application for a walk-in client
- **THEN** the application's intake version is 2

### Requirement: An application's intake version never changes
An application's intake version SHALL be fixed when the application is created. It SHALL NOT change when the application is updated, and a direct change of an application's version SHALL be refused.

#### Scenario: Updating an application does not change its version
- **WHEN** a version-2 application's answers are saved
- **THEN** its intake version is still 2

#### Scenario: Changing an application's version directly is refused
- **WHEN** an application's intake version is changed directly
- **THEN** the change is refused and the version stays 2

### Requirement: A household member may have a middle name
A household member SHALL have an optional middle name (`hh[i].middle_name`), asked between the first and last name in both the standard and senior versions of the form. Leaving it empty SHALL NOT block the member or the application. The member's summary line, shown in the client's review summary, the office's review and the staff answers panel, SHALL read first, middle and last name, separated by single spaces, skipping any part that is empty. Document cards SHALL keep the member's first and last name, as the taxpayer's and spouse's cards do.

#### Scenario: A member is saved with a middle name
- **WHEN** a client adds a household member with first name "Ana", middle name "Mei" and last name "Lin", and saves
- **THEN** the member's answers include `middle_name` "Mei", and the member's summary line reads "Ana Mei Lin"

#### Scenario: A member without a middle name is complete
- **WHEN** a household member has every required field answered and no middle name
- **THEN** no missing answer is reported for that member, and the member's summary line reads "Ana Lin"

### Requirement: A client who consents to Form 15080 signs it
When the client answers "I consent" to Form 15080 (`gcf_consent = yes`), the primary taxpayer signature SHALL be required to submit. If the client is also married (`marital_status = married`), the spouse signature SHALL be required too. Consent itself and both signature dates SHALL stay optional. The same rule SHALL apply whoever fills the application, the client or the office. The Form 15080 sub-step SHALL NOT be marked done while a required signature is missing.

#### Scenario: Consent without the primary signature is refused
- **WHEN** an application with `gcf_consent = yes` and no primary signature is submitted
- **THEN** submission is refused with a validation error, and `gcf_tp_signature` is listed as missing

#### Scenario: A married client's consent needs the spouse signature
- **WHEN** a married client consents, signs as the primary taxpayer, and leaves the spouse signature empty
- **THEN** submission is refused, `gcf_sp_signature` is listed as missing, and the Form 15080 sub-step is not marked done

#### Scenario: An unmarried client's consent needs only the primary signature
- **WHEN** a client who is not married consents and signs as the primary taxpayer
- **THEN** no 15080 answer is missing, and the dates may stay empty

#### Scenario: Declining consent needs no signature
- **WHEN** the client answers "I do not consent", or leaves the consent unanswered
- **THEN** no 15080 signature is required

#### Scenario: An office-filled application meets the same rule
- **WHEN** office staff submit an application they filled, with `gcf_consent = yes` and no primary signature
- **THEN** submission is refused the same way as for a client

### Requirement: An unmarried client isn't asked about a spouse
A client for whom filing with a spouse isn't possible SHALL see wording that names no spouse. That is a client whose marital status is anything other than married, including not yet answered, except a widowed client whose spouse died in 2025. The wording without a spouse applies in:
- the questions Q5.2 (`claimed_by_other`), Q9.1a (`inc_wages_job_count`) and Q12.4 (`opt_veteran`);
- the leads of the income, expense and event sub-steps;
- section 6's household intro;
- the direct-deposit document card's hint, and its office version.

Married clients, and widowed clients whose spouse died in 2025, SHALL see the wording that names the spouse. The rule SHALL be "filing with the spouse possible": married, or widowed with `spouse_death_year` 2025. It SHALL be the same rule that decides whether the "My spouse" option is offered. Every screen that shows one application SHALL use that application's answers to choose: the client's form, review, the office's form and the staff answers panel. The senior version's married leads SHALL name the spouse as 您爱人 in Chinese.

For a widowed client whose spouse died in 2025, the direct-deposit hint SHALL instead read "The account must be in the name of one of the taxpayers on this return: your own account, or a joint account with your late spouse." (账户必须在该税单任一纳税人名下：您本人的账户，或您与已故配偶的联名账户。). Its office version SHALL read "The account must be in the name of one of the taxpayers on this return: the client's own account, or a joint account with their late spouse."

#### Scenario: A never-married client
- **WHEN** a client whose marital status is never married, and who answered yes to wages, opens the wages sub-step
- **THEN** its lead reads "Did you receive any of these in 2025?" and Q9.1a reads "How many jobs did you have in 2025?"

#### Scenario: A married client
- **WHEN** a married client who answered yes to wages opens the wages sub-step
- **THEN** its lead reads "Did you or your spouse receive any of these in 2025?" and Q9.1a reads "How many jobs did you and your spouse have in 2025?"

#### Scenario: A client whose spouse died in 2025
- **WHEN** a widowed client whose spouse died in 2025, and who answered yes to wages, opens the wages sub-step
- **THEN** its lead reads "Did you or your spouse receive any of these in 2025?"

#### Scenario: A client whose spouse died in 2023
- **WHEN** a widowed client whose spouse died in 2023, and who answered yes to wages, opens the wages sub-step
- **THEN** its lead reads "Did you receive any of these in 2025?"

#### Scenario: Marital status not answered yet
- **WHEN** a client who hasn't answered marital status opens Q5.2
- **THEN** it reads "Can anyone else (such as a parent or adult child) claim you as a dependent on their tax return?"

#### Scenario: The direct-deposit card for an unmarried client
- **WHEN** a never-married client chooses direct deposit for their refund
- **THEN** the bank card's hint reads "The account must be in your name." (账户必须是您名下的账户。), and the office's version reads "The account must be in the client's name."

#### Scenario: The direct-deposit card for a married client
- **WHEN** a married client chooses direct deposit for their refund
- **THEN** the bank card's hint reads "The account must be in your name (or your spouse's).", and the office's version reads "The account must be in the client's or spouse's name."

#### Scenario: The direct-deposit card after a spouse died in 2025
- **WHEN** a widowed client whose spouse died in 2025 chooses direct deposit for their refund
- **THEN** the bank card's hint reads "The account must be in the name of one of the taxpayers on this return: your own account, or a joint account with your late spouse."

#### Scenario: Staff see the wording the client saw
- **WHEN** staff open the answers panel of a divorced client's application
- **THEN** Q12.4's row reads "Are you a veteran of the U.S. Armed Forces?"

#### Scenario: The senior married lead in Chinese
- **WHEN** a married client using the senior version reads the wages lead in Simplified Chinese
- **THEN** it reads "2025 年，您或您爱人是否有以下收入？"

### Requirement: An unmarried client answers the "who" questions with Yes or No
For a client for whom filing with a spouse isn't possible, by the same rule ("filing with the spouse possible"):
- Q5.3–Q5.9 (`us_citizen`, `on_visa`, `fulltime_student`, `legally_blind`, `disabled`, `ippin`, `digital_assets`) SHALL ask about the client directly, for example "Are you a U.S. citizen?" / 您是美国公民吗？
- Every "who" question (Q5.3–Q5.9, Q8.1 `irs_language_pref`, Q8.3 `pecf`) SHALL offer **Yes** and **No** as radio buttons, using the yes/no labels.

Yes SHALL save the answer the client's own option saves (`["me"]`), and No SHALL save the "No one" answer (`["none"]`). So the saved answers, the document cards and the draft 13614-C SHALL be unchanged.

A married client, and a widowed client whose spouse died in 2025, SHALL keep today's questions, with Me, My spouse and No one as check boxes. When filing with the spouse stops being possible, the "who" answers SHALL drop the spouse. That happens when marital status changes, or when a complete, valid year of the spouse's death is entered. A partly typed or cleared year SHALL NOT drop the spouse.

Every screen that shows one application's answers SHALL label such a client's "who" answers Yes or No: the review summary, the office's form, the staff answers panel, and the document cards' "Asked by:" lines.

#### Scenario: An unmarried client's citizenship question
- **WHEN** a never-married client opens Q5.3
- **THEN** it reads "Are you a U.S. citizen?", with radio buttons Yes and No, and choosing Yes saves `["me"]`

#### Scenario: In Chinese
- **WHEN** a never-married client reads Q5.3 in Simplified Chinese on the standard form
- **THEN** it reads "您是美国公民吗？", with the options 是 and 否

#### Scenario: A married client keeps the "who" question
- **WHEN** a married client opens Q5.3
- **THEN** it reads "Who is a U.S. citizen?", with check boxes Me, My spouse and No one

#### Scenario: A spouse who died in 2025
- **WHEN** a widowed client whose spouse died in 2025 opens Q5.3
- **THEN** it reads "Who is a U.S. citizen?", with check boxes Me, My spouse and No one

#### Scenario: The year changes to an earlier death
- **WHEN** a widowed client who ticked My spouse in Q5.3, with the death year 2025, changes the death year to 2020
- **THEN** Q5.3 asks "Are you a U.S. citizen?" with Yes and No, and the saved answer no longer includes the spouse

#### Scenario: Retyping the year keeps the spouse
- **WHEN** a widowed client who ticked My spouse in Q5.3, with the death year 2025, deletes the year and types 2025 again
- **THEN** the saved answer to Q5.3 still includes the spouse

#### Scenario: Section 8's "who" questions
- **WHEN** a never-married client opens Q8.3
- **THEN** its options are radio buttons Yes and No

#### Scenario: Staff and the office see Yes or No
- **WHEN** staff open the answers panel of a never-married client who answered Q5.4 with No
- **THEN** the row reads "Were you in the U.S. on a visa in 2025?" with the answer "No"

### Requirement: 9.1's Continue waits for the alerts to be fixed
On the review step's first page (9.1, `review.check`), Continue SHALL be disabled while the application has any alert. An alert is a required answer that is missing, or an answer that is invalid. Next to the disabled Continue, the page SHALL say "Fix the items above to continue." (请先修正上面的问题，然后继续。). Open documents (Needed or Maybe needed cards that are Not done or Later) SHALL NOT disable Continue.

#### Scenario: A required answer is missing
- **WHEN** a client whose application has no city opens 9.1
- **THEN** Continue is disabled, and the page says "Fix the items above to continue."

#### Scenario: Only documents are open
- **WHEN** a client whose answers are complete and valid, with a Needed card marked Later, opens 9.1
- **THEN** Continue is enabled, and the card is listed under "You can still submit"

### Requirement: The summary and Submit pages appear only after the alerts are fixed
The summary (9.2, `review.summary`) SHALL be visible only while the application has no alerts. The Submit page (9.3, `review.submit`) SHALL be visible only while the application has no alerts and after the client has pressed Continue on 9.2. That Continue SHALL be saved with the application as a visit to `review.submit`, so it holds on another device and in a later session. A sub-step that isn't visible SHALL NOT be listed on the rail or counted in the form's progress, and no move SHALL reach it.

When an alert returns, 9.2 and 9.3 SHALL hide again. A client on either page, or pressing "Back to summary", SHALL land on 9.1. When the alert is fixed, 9.2 SHALL return, and so SHALL 9.3 if it was earned, without another Continue.

#### Scenario: 9.2 and 9.3 are hidden while an alert exists
- **WHEN** a client's application has a missing required answer
- **THEN** the rail's review step lists only 9.1

#### Scenario: Continue on 9.1 opens the summary
- **WHEN** a client with no alerts, who hasn't pressed Continue on 9.2 before, presses Continue on 9.1
- **THEN** the form opens 9.2, and the rail lists 9.1 and 9.2 but not 9.3

#### Scenario: Continue on 9.2 opens the Submit page
- **WHEN** a client with no alerts presses Continue on 9.2
- **THEN** the form opens 9.3, and the application's saved visits include `review.submit`

#### Scenario: Leaving 9.2 another way doesn't earn 9.3
- **WHEN** a client on 9.2 chooses a Change link, or a step on the rail, without pressing Continue
- **THEN** 9.3 is still not listed on the rail

#### Scenario: An alert returns after 9.3 was earned
- **WHEN** a client who has reached 9.3 changes an answer so that a required answer is missing, then returns to the review step
- **THEN** the form shows 9.1, and the rail lists neither 9.2 nor 9.3

#### Scenario: "Back to summary" with a new alert
- **WHEN** a client opens a part from the summary's Change link, clears a required answer there, and presses "Back to summary"
- **THEN** the form shows 9.1

#### Scenario: Submit pressed on a page drawn before an alert came back
- **WHEN** a client on 9.3, with the box ticked, presses Submit after another device has cleared a required answer, before the page has redrawn
- **THEN** nothing is submitted, any invalid answer is shown, and the form shows 9.1 with its alerts

#### Scenario: The fix brings both pages back
- **WHEN** that client fixes the answer
- **THEN** the rail lists 9.1, 9.2 and 9.3 again, without another Continue on 9.2

### Requirement: The summary page explains itself and puts its tools first
The summary page SHALL show, in this order:
1. Three paragraphs of introduction:
   - "Here is a summary of everything you told us in your application." (以下是您在申请中填写的全部信息。)
   - "Before you submit, make sure you have answered everything that applies to you. To change an answer, choose **Change** next to that part, or choose that part in the list of steps." (提交之前，请确认所有适用于您的问题都已回答。如需修改，请点击相应部分旁边的“修改”，或在步骤列表中选择该部分。)
   - "With the buttons below, you can print this summary, or view and download a draft Form 14446 made from your answers." (您可以用下方的按钮打印这份汇总，或查看并下载根据您的回答生成的 14446 表草稿。)
2. The Print button, and View Draft Form 14446 with its 繁體中文版. The summary page SHALL NOT offer the draft Form 13614-C in any language.
3. "Expand all" (全部展开) and "Collapse all" (全部收起), aligned to the right.
4. The application's details and its sections, one per step.

#### Scenario: The page's order
- **WHEN** a client opens 9.2 in English
- **THEN** the intro's three paragraphs come first, then Print and View Draft Form 14446, then Expand all and Collapse all, then the sections
- **AND** no View Draft 13614-C button is on the page, and the intro's third paragraph doesn't mention Form 13614-C

#### Scenario: In Chinese
- **WHEN** a client opens 9.2 in Simplified Chinese
- **THEN** the buttons read 全部展开 and 全部收起, the intro's second paragraph names the Change link as “修改”, and its third paragraph names only the 14446 表草稿
- **AND** no draft 13614-C button is offered, in Simplified or Traditional Chinese

### Requirement: Each summary section can collapse
Each section of the summary (one per step, including the documents section) SHALL collapse and expand from its heading. The heading SHALL be a button that reports whether its section is expanded, named for screen readers "Show or hide {section}" (显示或隐藏{section}). Every section SHALL start expanded. "Collapse all" SHALL collapse every section, and "Expand all" SHALL expand every section. The keyboard SHALL stay on the button that was pressed. Which sections are collapsed SHALL be kept for that browser window as the client moves through the form.

#### Scenario: Collapse one section
- **WHEN** a client presses the "About you" heading on 9.2
- **THEN** that section's answers are hidden, the heading reports collapsed, and the other sections stay expanded

#### Scenario: Collapse all, then Expand all
- **WHEN** a client presses Collapse all, then Expand all
- **THEN** every section is collapsed after the first press and expanded after the second, and the keyboard stays on the button pressed

#### Scenario: The state is kept while moving
- **WHEN** a client collapses "About you", opens a part with its Change link, and goes back to the summary
- **THEN** "About you" is still collapsed

### Requirement: The printed summary shows every section
Printing the summary with its Print button SHALL print every section with its answers, including sections that are collapsed on screen. The printout SHALL NOT include the section toggles' icons, the Expand all and Collapse all buttons, the Change links, the Print button or the draft buttons.

#### Scenario: Printing with a collapsed section
- **WHEN** a client collapses "About you" and prints the summary with its Print button
- **THEN** the printout includes "About you" with its answers

### Requirement: A client can name other languages we can help them in
After the preferred service language (Q0.3 `language`, unchanged, required) and its "Please specify" box (Q0.4), the intake SHALL ask Q0.5 `language_also`, "Any other languages we can help you in?" (我们还可以用哪些语言为您服务？). It is optional and multi-select, with the same options as Q0.3: English, Cantonese, Mandarin and Other. Its tip is "Choose all that apply. Leave this blank if only your preferred language works for you." (可多选。如果只能使用首选语言，请留空。).

When Q0.5 includes Other, the intake SHALL ask Q0.6 `language_also_other`, "Please specify" (请说明), an optional text answer. The standard and senior versions SHALL use the same wording. Leaving Q0.5 empty SHALL NOT block the application. The preferred language SHALL stay a single, required answer, and existing applications' answers SHALL keep working without any change.

#### Scenario: A client who also speaks Mandarin
- **WHEN** a client chooses Cantonese as their preferred language and ticks Mandarin in Q0.5
- **THEN** the application's answers hold `language` "cantonese" and `language_also` ["mandarin"]

#### Scenario: Another language not on the list
- **WHEN** a client ticks Other in Q0.5
- **THEN** Q0.6 "Please specify" appears, and what they type is saved as `language_also_other`

#### Scenario: Only the preferred language
- **WHEN** a client leaves Q0.5 empty
- **THEN** no missing answer is reported for it, and the application can be submitted

#### Scenario: An application saved before the change
- **WHEN** a client opens an application saved before Q0.5 existed
- **THEN** their preferred language is still chosen, and Q0.5 is empty

### Requirement: The progress page lists every language the client named
The client's progress page SHALL list every language the client named, by full name in the screen language:
- the preferred language first, then the others, in the order of the options;
- no language listed twice;
- for Other, the name the client typed, or "Other" when they typed nothing.

It SHALL NOT use letter abbreviations.

#### Scenario: Preferred and other languages
- **WHEN** a client who prefers Cantonese and also named Mandarin opens their progress page in English
- **THEN** the Language row reads "Cantonese, Mandarin"

#### Scenario: In Chinese, with a typed language
- **WHEN** a client who prefers Mandarin and also named Other, typing "Vietnamese", opens their progress page in Simplified Chinese
- **THEN** the Language row reads "普通话、Vietnamese"

### Requirement: A recently widowed client gives their late spouse's details
A widowed client whose spouse died in 2023 or later SHALL be asked about the spouse, under two rules defined once in the catalogue:
- **"Spouse on the return"** (married, or widowed with `spouse_death_year` from 2023 to 2025) SHALL ask the spouse's first, middle and last name and date of birth.
- **"Filing with the spouse possible"** (married, or widowed with `spouse_death_year` 2025) SHALL also ask the spouse's job title and the spouse's optional race question. It SHALL also give the spouse's Photo ID and Social Security card or ITIN letter document cards, and name the spouse in the who-question owners and the "For you and your spouse" owner line.

These SHALL stay married only:
- the spouse's phone;
- the Form 15080 spouse signature and its date;
- `married_last_day`;
- `lived_apart_last_6mo`.

The custody document card (Form 8332) SHALL be offered on its usual condition to any client who isn't married, widowed clients of any year included. For a widowed client, the spouse sub-step's title SHALL read "Your late spouse" (已故配偶). The browser and the server SHALL evaluate both rules identically, for both visibility and the answers missing before submission.

#### Scenario: A spouse who died in 2024
- **WHEN** a widowed client enters 2024 as the year of the spouse's death
- **THEN** the "Your late spouse" sub-step asks the spouse's name and date of birth, but not the job title or phone, and no spouse document card is listed

#### Scenario: A spouse who died in 2025
- **WHEN** a widowed client enters 2025 as the year of the spouse's death
- **THEN** the "Your late spouse" sub-step asks the spouse's name, date of birth and job title, but not the phone, and the spouse's Photo ID and Social Security card are listed

#### Scenario: The rail follows the year
- **WHEN** a widowed client on the marital status sub-step enters 2025 as the year of the spouse's death and leaves the field
- **THEN** the rail lists "Your late spouse" at once, without a move to another sub-step

#### Scenario: A spouse who died in 2015
- **WHEN** a widowed client enters 2015 as the year of the spouse's death
- **THEN** no spouse sub-step is shown

#### Scenario: No spouse signature after a 2025 death
- **WHEN** a widowed client whose spouse died in 2025 answers "I consent" to Form 15080 and signs as the primary taxpayer
- **THEN** no spouse signature is asked or required, and the application can be submitted

#### Scenario: The server agrees
- **WHEN** a widowed client whose spouse died in 2025 submits without the spouse's last name
- **THEN** the server refuses the submission, naming the spouse's last name as missing

#### Scenario: The custody card for a widowed client
- **WHEN** a widowed client whose spouse died in 2025 lists a child who lived with them less than 6 months
- **THEN** the custody card (Form 8332) is offered as maybe needed

### Requirement: The year of a spouse's death is checked
`spouse_death_year` SHALL accept a four-digit year from 1900 to 2025, in the browser and on the server. Any other value SHALL be shown as "Enter a year from 1900 to 2025." (请输入 1900 至 2025 之间的年份。), SHALL NOT be saved, and SHALL switch neither spouse rule on, even while it is still in the form.

#### Scenario: A year after the tax year
- **WHEN** a widowed client enters 2205 as the year of the spouse's death
- **THEN** the field shows "Enter a year from 1900 to 2025.", and no spouse sub-step appears

#### Scenario: The boundary years
- **WHEN** a widowed client enters 1900, and then 2025
- **THEN** both are accepted

### Requirement: A client consents to the virtual process before the rest of the form
"Before you start" SHALL end with a fourth sub-step, 0.4 "Virtual VITA consent (Form 14446)" (虚拟 VITA 纳税人同意书). It SHALL show the Form 14446 page text, then one required checkbox, `vc_agree`: "I agree to use PCDC's Virtual VITA/TCE process" (本人同意使用此服务处的虚拟 VITA/TCE 流程).

Until the box is ticked:
- 0.4's Continue SHALL be disabled, with the line "We need this consent to prepare your return. If you'd rather not give it, please call PCDC at 215-922-6156." (我们需要您的同意才能为您报税。如您不愿同意，请致电 PCDC：215-922-6156。);
- the rail SHALL list the steps after "Before you start", each shown as locked and not selectable;
- no move SHALL reach a sub-step after "Before you start". A form opened, or returned to, at such a sub-step SHALL show 0.4.

Unticking the box SHALL lock those steps again and keep every answer. The submission SHALL be refused without the box ticked, whoever fills the application. The office's Add a case form SHALL ask the box but SHALL NOT lock its parts.

#### Scenario: A new client sees the whole form, locked
- **WHEN** a client who hasn't ticked the box opens 0.4
- **THEN** Continue is disabled with the line about PCDC's phone, and the rail lists "About you" through "Review & submit" as locked

#### Scenario: Ticking unlocks the form
- **WHEN** the client ticks "I agree to use PCDC's Virtual VITA/TCE process" and presses Continue
- **THEN** the form opens "About you", and the rail's steps are no longer locked

#### Scenario: A saved place past the gate
- **WHEN** a client whose draft is at "Mailing address" but who never ticked the box opens the form
- **THEN** the form shows 0.4

#### Scenario: Unticking after a Change from the summary
- **WHEN** a client who opened 0.4 through the summary's Change link unticks the box
- **THEN** the page shows Continue disabled with the line about PCDC's phone, not "Back to summary"

#### Scenario: Unticking locks it again
- **WHEN** a client who has filled "About you" unticks the box
- **THEN** the steps after "Before you start" are locked again, and the answers in "About you" are kept

#### Scenario: The server refuses without consent
- **WHEN** an application without `vc_agree` is submitted
- **THEN** the submission is refused, naming `vc_agree` as missing

#### Scenario: The office's form
- **WHEN** the office opens Add a case for a walk-in client
- **THEN** every part can be opened, and the case can't be sent until `vc_agree` is ticked

### Requirement: Every client signs Form 14446
"About you" SHALL have a sub-step after "Your spouse", 1.5 "Sign Form 14446" (签署 14446 表). It SHALL first show, read-only, the details the form will print for each signer: the full name, date of birth, phone and email. It SHALL then ask:
- `vc_review`, required: "If our site is chosen at random, may an IRS employee review your return for accuracy?", with "I consent" and "I do not consent";
- `vc_tp_signature`, the client's typed full name, required;
- `vc_tp_date`, the date, optional, shown once the client's signature is filled.

While filing with the spouse is possible (rule `joint_possible`: married, or widowed with the spouse's death in 2025), 1.5 SHALL also ask:
- `vc_sp_signature`, the spouse's typed full name, optional;
- `vc_sp_date`, its date, optional, shown once the spouse signature is filled.

For a widowed client, the spouse signature SHALL carry the tip "Type your late spouse's full name. You sign for them because a joint return is possible for 2025." For a married client, it SHALL carry the tip "Leave this empty if you won't file a joint return." (如不合并申报，请留空。), and 1.5 SHALL also ask the spouse's email, `vc_sp_email`, optional.

A client for whom filing with the spouse isn't possible SHALL NOT be asked any spouse part of 1.5. The same rules SHALL apply whoever fills the application, the client or the office.

#### Scenario: A never-married client
- **WHEN** a never-married client opens 1.5
- **THEN** it shows the client's own details and asks the IRS-review question and the client's signature, with no spouse part

#### Scenario: A married client
- **WHEN** a married client opens 1.5
- **THEN** it also asks the spouse's signature, with the tip "Leave this empty if you won't file a joint return.", and the spouse's email, and the application can be submitted without them

#### Scenario: A spouse who died in 2025
- **WHEN** a widowed client whose spouse died in 2025 opens 1.5
- **THEN** it asks the spouse's signature with the late-spouse tip, but not the spouse's email

#### Scenario: A spouse who died in 2024
- **WHEN** a widowed client whose spouse died in 2024 opens 1.5
- **THEN** no spouse part is shown

#### Scenario: The required answers
- **WHEN** a client submits without the IRS-review answer or their own signature
- **THEN** the submission is refused, naming `vc_review` or `vc_tp_signature` as missing

### Requirement: The Form 14446 dates fill themselves
When the client's 14446 signature (`vc_tp_signature`) goes from empty to filled and its date (`vc_tp_date`) is empty, the date SHALL be set to today. The spouse's signature and date (`vc_sp_signature`, `vc_sp_date`) SHALL behave the same. A date that is already filled SHALL NOT change, and either date SHALL stay editable. Form 15080's dates SHALL NOT be filled this way.

#### Scenario: Signing fills the date
- **WHEN** a client with an empty 14446 date types their signature
- **THEN** the date reads today's date

#### Scenario: A typed date is kept
- **WHEN** a client who typed their own 14446 date then signs
- **THEN** the date they typed is kept

### Requirement: A client page never makes a draft 13614-C
A draft Form 13614-C SHALL be made only for staff. When anyone who is not staff asks for one, for example with a button added to a client page, the page SHALL open no tab, build no draft, offer no link and show no error. A client SHALL still be able to make the draft Form 14446.

#### Scenario: A forged button on the summary page
- **WHEN** a View Draft 13614-C button is added to a client's summary page and pressed
- **THEN** no tab opens, no draft link appears, and no error is shown

#### Scenario: Staff are unaffected
- **WHEN** the case's preparer presses View Draft 13614-C on the case page after the claim
- **THEN** the draft 13614-C opens in its own tab, as before

### Requirement: Fictional details leave the client's 14446 answers alone
"Fill fictional details" SHALL NOT tick 0.4 or sign 1.5 for the client, and regenerating the fictional details SHALL keep the client's own 14446 answers.

#### Scenario: Regenerate keeps the consent
- **WHEN** a client who ticked 0.4 and signed 1.5 regenerates the fictional details
- **THEN** 0.4 is still ticked, and 1.5's answers are unchanged

#### Scenario: Fill leaves the consent to the client
- **WHEN** a client who hasn't ticked 0.4 uses "Fill fictional details"
- **THEN** 0.4 is still unticked and 1.5's signatures are still empty
