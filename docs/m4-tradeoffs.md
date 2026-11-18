# M4 trade-offs: what we cut, what we refused to cut, and why

M4 is graded as feature-complete: the planned feature set is merged into `main` by Wed Nov 4
([#94](https://github.com/jin-yu-yang/vitally/issues/94)). This page records
the scope decisions behind that. It names what we cut for the semester, what we refused to cut,
and the reason for each. Everything we cut goes on the roadmap for the **February PCDC pilot**
(Dec–Jan work), not to M5 or M6, which are for testing and hardening.

The goal for M4 was:

> A client submits intake and uploads documents; a case goes to Accepted or Rejected and is closed
> with a reason; staff sign in as themselves; the preparer completes the 13614-C shaded section
> inside ViTally.

## Where M4 stands

| M4 goal | Status (Oct 31) | Where |
| --- | --- | --- |
| A client submits intake | Merged | Intake version 2, steps 0–9 (migration 023 onward) |
| A client uploads documents | Not built; February roadmap | Did not reach the Oct 29 go / no-go. Meanwhile online clients send documents to PCDC's own storage and the case keeps the link |
| A case goes to Accepted or Rejected | Merged | Change 2, #95; adjusted to PCDC's answers in #97 |
| A case is closed with a reason | Merged | Change 3, #96 |
| Staff sign in as themselves | Merged (Oct 29) | #90 |
| The preparer completes the 13614-C shaded section | Merged (Oct 29) | #98: in a form, in the pdf.js editor, or by download and upload |

**Go / no-go rule.** On Oct 29, whichever of document upload and the 13614-C section was behind
became "stretch, not reached" and moved to the February roadmap. Document upload was behind, so it
moved. We chose a dated rule over "finish both if we can" so that nothing half-built is left in a
branch at the deadline: M4 counts only what is merged.

**Staff identity fallback.** The fallback (presenter personas, with the talk saying so) was not
needed: #90 merged on Oct 29. The persona picker stays for the demo account only.

## What we cut

Each of these is out of the semester's scope. None is in M4, M5 or M6.

| Cut | Why | Where it lands |
| --- | --- | --- |
| **Document upload** | Real tax documents need private storage, virus scanning, retention and automatic deletion, per-volunteer visibility, a paid Supabase tier, and PCDC's security plan updated. None of that fit before the Oct 29 gate, and an upload without it would only ever hold fictional files. It still matters: in the pre-survey ([`docs/spec.md`](spec.md) §4) Ms. Xu says the hotline is never reachable and walking to the office is hard, and Eunice says many clients have mobility issues. If it slips again, the pilot uses PCDC's OneDrive, with the case storing the folder link. | Feb pilot, before any real document |
| **Amendment loop** (changing a return after it is accepted) | PCDC hasn't tracked amendments before, and they happen after the season. Rejected → Return to signing is already the mechanism an amendment will reuse, so adding it later is a new value, not a redesign. | Feb pilot |
| **Same-day service path** and **FSA** (Facilitated Self Assistance) | These are our cuts; we did not ask PCDC about either. Each is a separate service model with its own flow, and neither is in the four M4 goals. Same-day *signing* (an in-person client signs before leaving) is built; what is cut is the same-day *service path* as a tracked model. The assisted intake staff already use for walk-ins is its starting point. | Same day: Feb pilot. FSA: after the pilot |
| **Who sees which case** (a volunteer sees only the cases they prepare or review) | #90 makes each staff member sign in as themselves; changing every visibility rule at the same time would touch every policy in the database at once. | Feb pilot |
| **Hosting, real accounts, backup-restore drill, security review** | See [Hosting moved to February](#hosting-moved-from-november-to-february) below. | Feb pilot |
| **Importing the IRS's and Pennsylvania's answers** from TaxSlayer, and **reassignment** of a case's preparer or reviewer | The office records each answer by hand; nothing is sent to or read from the IRS or Pennsylvania. Reassignment must keep the self-review block, which the database already enforces, so it can be added safely later. | Feb pilot |
| **The client's place in the queue** | A real need we did not reach. Ms. Liu (pre-survey) saw a later case finish before hers and was told only to wait. The progress page shows the stage, not the queue position or the volunteers' contact. | Feb pilot |
| **A plain-language rejection reason for the client** | The client is told their return needs a correction and that PCDC will contact them. A reason table is left until PCDC says it wants one. | If PCDC asks |
| **13614-C extras**: the reviewer's field-by-field comparison, version history | The preparer's answers are saved as data and filled into the existing 13614-C generator, so the M4 goal is met without them. | After the pilot |
| **Email and text notifications** | Clients ask for them and distrust them. Mr. Li wants texts, but promised texts never come; Eunice says clients don't trust texts or voicemails from an unfamiliar number. Sending them also needs a service beside the database. The contact log covers day one: staff record every call and message on the case. | After the pilot |
| **Appointment scheduling** | PCDC's reason: clients forget their appointments, and the reminders and rescheduling land on the front desk as phone calls, so scheduling would add load rather than remove it. The reviewer records the signing time by hand. | After the pilot |

### Hosting moved from November to February

The M3 slides said ViTally would be hosted in November, and change 2's proposal still says "real
clients use ViTally from November 2026". We moved it to the February pilot.

The rule in [`docs/developer/production-roadmap.md`](developer/production-roadmap.md) is: **do not
put real client data into any environment until staff identity, documents, and security and
privacy are done.** In November at most one of those three would have been true: #90 merged on
Oct 29, document upload is not built (see the February roadmap), and there has been no security
review. Hosting without them would mean either real data on an unsafe system, or a hosted system
nobody can use.

Three more things kept it off the semester's critical path:

- **There is no hosted Supabase project yet.** Task 10B in [`docs/setup.md`](setup.md) §6 needs
  Jinyu's account, a sender domain and an approved test address.
- **Cost.** Hosting plus the paid Supabase tier that document storage needs would mean paying
  before there is a real user, so that starts in Dec–Jan.
- **PCDC's season starts in February.** A pilot before then has no real cases to run on.

## What we refused to cut

These stayed in even under the deadline, because cutting them would make the demo misleading or
unsafe to build on.

- **All four M4 goals, end to end, merged into `main`.** Ugly screens, missing edge cases and thin
  tests were acceptable. Work left in a branch was not.
- **Real staff accounts (#90).** The presenter persona picker lets any presenter act as anyone. A
  system for tax data has to know who did each thing, so this was not traded away for more
  features. It merged on Oct 29.
- **No front-end-only buttons.** A case changes stage only through guarded database functions, so
  nobody can skip review by clicking.
- **The independence rule.** A preparer can never review their own case. The database enforces
  it, not the screen, and it carries over unchanged to real staff accounts.
- **Clients cannot print an unfinished 13614-C.** A half-finished form at the site is worse than
  none.
- **What the client never sees.** Reject codes, fix notes and staff notes stay staff-only; the
  client is told what is happening in plain words. Phone numbers are masked on staff screens.
- **A signature after every fix.** PCDC confirmed that a corrected return is signed again before it
  is filed again, so Return to signing has no shortcut.
- **A return is not transmitted after a withdrawal.** When a client withdraws late, the office gets
  a notice to make sure the return is not transmitted in TaxSlayer.
- **Bilingual client screens.** Every client screen is in English, 简体 and 繁體, including the
  new filing and closing messages. Serving English- and Chinese-speaking clients is one of the
  product's goals ([`docs/proposal.md`](proposal.md)), not a finishing touch.
- **Fictional data only.** Every environment, test and screenshot uses fictional people until the
  February items above are done.
- **Every change specified and tested.** Each feature went through an OpenSpec change with its own
  specs, and CI runs the unit tests, the 繁體 check, the catalogue check and spec validation on
  every pull request.

## Where scope grew instead

Scope did not only shrink. Three things #94 put on the February roadmap were built, and one goal
grew past its plan:

- **Waiting for documents and Hold** (#96). Pulled forward because a failed screening check had
  nowhere to go, and a client who stopped answering at signing stayed at Ready to exit forever.
- **The client's own withdrawal** (#96), with the stop-work notice above. Pulled forward with Hold.
- **Paper returns** (#97). A correction from PCDC's answers to our filing questions on Oct 23
  ([`brainstorm.md`](../openspec/changes/archive/2026-10-23-adjust-filing-to-pcdc/brainstorm.md)):
  PCDC uses all four combinations of federal and state, e-filed or on paper, never mails a return,
  and hands the paper return to the client.
- **The 13614-C pdf.js editor** (#98). #94 scoped the shaded section as a form only. The editor
  stayed at the gate because the form alone did not survive contact with the real PDF.

## The February pilot roadmap

Day one of the pilot needs, in Dec–Jan:

1. Document upload with its hardening (or the OneDrive fallback).
2. Hosting, real accounts, a backup-restore drill and a security review.
3. The same-day service path.
4. The amendment loop.
5. Who sees which case, and the client's place in the queue.

After the pilot: email and text notifications, appointment scheduling, and FSA.

The longer list of what separates the demo from a production system is in
[`docs/developer/production-roadmap.md`](developer/production-roadmap.md).
