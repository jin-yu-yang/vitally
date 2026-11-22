# ViTally roadmap

Where ViTally stands and what comes next, as of **Nov 21, 2026**. Dates are targets, not promises.
Update this page when a row's state changes; the [README](../README.md) only links here.

## Where ViTally stands

The core workflow is built and has been tried by experienced PCDC volunteers, the admin team and
the program manager. The next stage is about three things:

| | Goal | How we get there |
| --- | --- | --- |
| **Trust** | PCDC can see for itself that its data is safe. | Much of the protection is already built in: the database checks every action, uncleared volunteers read no case data, and no uploaded files are stored. Next we make it visible: a plain-language security summary, an export PCDC keeps in SharePoint, and a rollout PCDC controls step by step. |
| **Adoption** | ViTally replaces tools instead of adding one. | Volunteer management moves over from Airtable (roster, certificates, workload, schedule), and team updates from Slack (posted updates and notifications, then a note for the team). |
| **Maintenance** | ViTally keeps running after this season. | Clear handoff documentation so other developers can step in, and a support model agreed with PCDC. Once features settle, upkeep is mostly security updates and yearly form changes. |

### What works today

- **Clients:** sign in with an emailed code (office-invited addresses); fill the intake at home
  in English, 简体 or 繁體 (switchable at any moment), in standard or senior wording; sign
  Forms 15080 and 14446; follow their case; withdraw.
- **Office:** screening checks, Add a case for walk-ins, Follow-ups, the case pool, waiting for
  documents and Hold, same-day signing, e-filed / accepted / rejected for federal and
  Pennsylvania, Return to signing, close, case history and contact log.
- **Volunteers:** work board, claim preparation or review, questionnaires at each hand-off, the
  shaded section of Form 13614-C, auto-generated 13614-C and 14446 drafts, PCDC's Exit Form at
  signing. The database stops anyone reviewing their own preparation.
- **Volunteer management (admin):** Roster with roles and certificates per season; a role exists
  only once its certificates are confirmed; an uncleared volunteer reads no case data and sees
  "Finish your setup" with Upload and "I've uploaded it" for the Form 13615 and photo ID, which
  admins mark reviewed; Season settings and site coordinators; Start next season; Workload with Assign and Reassign;
  account invitations by email.
- **Updates:** admins post updates to the team, with notifications.

Behaviour is specified in [`openspec/specs/`](../openspec/specs/).

## 1. Before Dec 21 (end of the semester)

**Outcome:** ViTally is deployed to a hosted test environment, ready to send magic links to
testers, and covers volunteer management (instead of Airtable) and team updates (instead of
Slack). Screening stays in Airtable. Dates are targets.

| | Work | Issue | Target | State |
| --- | --- | --- | --- | --- |
| Adoption | Roster: Form 13615 and photo ID uploads to PCDC's OneDrive link with "I've uploaded it" | [#138](https://github.com/jin-yu-yang/vitally/issues/138) | Nov 29 | **Done** (#243, Nov 21) |
| Adoption | Season settings, site coordinator role, Start next season | [#138](https://github.com/jin-yu-yang/vitally/issues/138) | Nov 29 | **Done**: Season settings and site coordinators (#237, Nov 20), Start next season (#255, Nov 21) |
| Adoption | My profile, with the reason an upload came back | [#242](https://github.com/jin-yu-yang/vitally/issues/242) [#246](https://github.com/jin-yu-yang/vitally/issues/246) | Nov 29 | Decided; next (`add-my-profile`) |
| Adoption | Returning-volunteer picker; Roster CSV export | [#138](https://github.com/jin-yu-yang/vitally/issues/138) | Nov 29 | Decided; picker can be cut |
| Adoption | Remove a volunteer from this season's roster | [#232](https://github.com/jin-yu-yang/vitally/issues/232) | Nov 29 | Decided; first to cut |
| Adoption | Client documents through PCDC's OneDrive upload link | [#157](https://github.com/jin-yu-yang/vitally/issues/157) | Nov 29 | In review (#245) |
| Adoption | Clearance fixes: role changes without a reload, a self-cleared admin, screen-reader announcement | [#190](https://github.com/jin-yu-yang/vitally/issues/190) #191 #192 | Nov 22 | **Done**: #191 and #192 (Nov 18), #190 (#234, Nov 19) |
| Adoption | Workload and Reassign | #139 | — | **Done** |
| Adoption | Hourly volunteer schedule with a role per shift | [#140](https://github.com/jin-yu-yang/vitally/issues/140) | Dec 6 | Decided |
| Adoption | Volunteer check-in and check-out | [#257](https://github.com/jin-yu-yang/vitally/issues/257) | Dec 13 | Decided; after #140, can move to the pilot |
| Adoption | Posted updates and notifications | #150 | — | **Done** |
| Adoption | Case labels (City Tax, MFS, Multi-state) | #148 | — | **Done** (Nov 17) |
| Adoption | One account reaches both the office and the work board | [#104](https://github.com/jin-yu-yang/vitally/issues/104) | Dec 13 | Partly decided; can be cut |
| Adoption | Mobile layouts: setup and check-in, Follow-ups and office case page, work board and case page, and a real-phone pass over client intake and status | [#147](https://github.com/jin-yu-yang/vitally/issues/147) | Dec 20 | Decided |
| Trust | **Export this season's data** as a ZIP of CSVs, so PCDC can keep it in SharePoint | [#256](https://github.com/jin-yu-yang/vitally/issues/256) | Dec 13 | Decided |
| Trust | **Plain-language security summary:** where data lives, who sees what, when it's deleted, compared with Airtable | [#259](https://github.com/jin-yu-yang/vitally/issues/259) | Dec 13 | Drafted |
| Testing | **Hosted test environment**: project, email, migrations, Edge Function, Auth settings, custom domain, tester roster | #159 | — | **Done** (Nov 17) |
| Testing | Keep the test environment on current `main`: redeploy as features land, invite testers, final deploy | — | Dec 20 | Ongoing |

If we run late, we cut in this order: removing a volunteer, the #104 switch, the returning-volunteer
picker, check-in. The note for the team moved to the pilot.

## 2. Before the pilot (tax season 2027)

**Outcome:** PCDC volunteers use ViTally for real cases, one step at a time, and someone is
responsible for it after the student team. The season opens in late January 2027; nothing here is
scheduled week by week yet. Real-client prerequisites are collected in
[#167](https://github.com/jin-yu-yang/vitally/issues/167).

**Trust**
- **Step-by-step rollout:** fictional data, then a little low-risk real data, then full use. PCDC
  decides each step; real data only when PCDC agrees. *(not filed)*
- **A plan for when things go wrong**, with a "Pause service" switch that any site coordinator
  or developer can use ([#258](https://github.com/jin-yu-yang/vitally/issues/258)).
- **A volunteer sees only the cases they work on**, plus a short list of cases waiting to be taken,
  enforced in the database ([#162](https://github.com/jin-yu-yang/vitally/issues/162)).
- **Staff sign-in and reads:** two-step sign-in for admins and site coordinators, 12-hour staff
  sessions, a log of who opened which case; hosting headers and IRS confidentiality rules
  ([#160](https://github.com/jin-yu-yang/vitally/issues/160)).
- **Production:** a backup-and-restore drill, Supabase Pro (paid by the team during the pilot,
  then handed to PCDC), a paid email plan, replies going to PCDC
  ([#215](https://github.com/jin-yu-yang/vitally/issues/215)).
- **Season data:** export (#256), then a separate "Delete last season's data" button that keeps
  client records and visit history ([#161](https://github.com/jin-yu-yang/vitally/issues/161)).
  It needs client records first ([#146](https://github.com/jin-yu-yang/vitally/issues/146), slice 1).
- **Tax year follows the season**, with a yearly review of the forms
  ([#250](https://github.com/jin-yu-yang/vitally/issues/250)), before the hosted rollover to 2027.

**Adoption**
- Magic links to more volunteers and to PCDC's board; improve from their feedback.
- Note for the team on the case page ([#151](https://github.com/jin-yu-yang/vitally/issues/151)).
- Mobile client intake: the full phone design ([#153](https://github.com/jin-yu-yang/vitally/issues/153)).
- Clients get accounts by office invitation during the pilot; self-registration is decided after it
  ([#158](https://github.com/jin-yu-yang/vitally/issues/158)).
- Remove the remaining demo wording ([#58](https://github.com/jin-yu-yang/vitally/issues/58)); rename
  "senior version" to "conversational version" (tester suggestion).
- Exit Form and drafts: long Remarks cut off, font downloads ([#122](https://github.com/jin-yu-yang/vitally/issues/122),
  [#121](https://github.com/jin-yu-yang/vitally/issues/121)); the 2026 revision of Form 13614-C
  ([#42](https://github.com/jin-yu-yang/vitally/issues/42)).
- May follow during the season: same-day service ([#163](https://github.com/jin-yu-yang/vitally/issues/163)),
  amendments ([#155](https://github.com/jin-yu-yang/vitally/issues/155)), the client's place in the
  queue ([#164](https://github.com/jin-yu-yang/vitally/issues/164)), a volunteer's own cases
  ([#110](https://github.com/jin-yu-yang/vitally/issues/110)).

**Maintenance**
- **Handoff documentation** so volunteer developers can step in, including the yearly
  October–November form review. *(not filed)*
- **A long-term support model:** for example seasonal support from the original team. The upkeep
  after features settle is mostly security updates and yearly form changes. *(not filed;
  unresolved)*

### Later

The rest of client profiles: matching returning clients, the summary, prefill and the
same-preparer hint ([#146](https://github.com/jin-yu-yang/vitally/issues/146)),
season analytics ([#141](https://github.com/jin-yu-yang/vitally/issues/141)), groups and pinned
cases ([#149](https://github.com/jin-yu-yang/vitally/issues/149)), case location
([#152](https://github.com/jin-yu-yang/vitally/issues/152)), staff Settings
([#154](https://github.com/jin-yu-yang/vitally/issues/154)), a second state return
([#116](https://github.com/jin-yu-yang/vitally/issues/116)), scale
([#165](https://github.com/jin-yu-yang/vitally/issues/165)). Not planned: chat and SMS,
appointment booking, storing documents in ViTally.

## Deployment

The test environment runs under Hailey's accounts, inside a Supabase organization so it can be
handed to PCDC later.

- **Done (Nov 17):** Supabase project with custom SMTP (Resend, sender `ViTally <help@govitally.org>`);
  the `govitally.org` domain at Cloudflare, with `help@govitally.org` forwarded; migrations on the
  hosted database; the `accounts` Edge Function and its secrets; Auth Site URL / Redirect URLs, a
  raised email rate limit and public sign-up off; the front end on the custom domain with
  [`public-config.json`](../public-config.json); the tester roster and the site's SIDN.
- **Ongoing:** redeploy migrations and the front end as features land on `main`. The seed never
  runs against the hosted project.
- **Before real data:** backup-and-restore drill, ownership and billing, production accounts
  ([#215](https://github.com/jin-yu-yang/vitally/issues/215)).

Step by step: [`docs/setup.md` §6–7](setup.md#6-classroom-and-hosted-setup-pending). Free
tiers cover the December test; for the season, Supabase Pro (about $25 a month, no pausing, daily
backups) is recommended.
