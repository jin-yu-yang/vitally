# ViTally demonstration script

This is the script for demonstrating ViTally with the local role accounts. It describes only what
the application does today. Before a review or a demo, work through
[Before a review or demo](setup.md#before-a-review-or-demo) in `docs/setup.md`: it gets the roster,
the seeded cases and the Roster's volunteers in place, and signs each window in.

**Use fictional names only.** The seeded cases and accounts are fictional. Never type a real name,
address, phone number or ID into any screen during a demonstration: the software does not stop you.

Rehearsed on 2026-11-10 on `main` (802aa5f), on the local stack, with the example roster and
`npm run seed:local`.

## The accounts and the windows

The demo uses the example roster's role accounts
([Signing in locally](setup.md#signing-in-locally)). Each account is one fictional person, and
everything it does is recorded as that person:

| Window | Signs in as | Sees |
| --- | --- | --- |
| Office | `site-coordinator@example.org`, Sky Chen (site coordinator) | Follow-ups, All cases, Volunteers |
| Preparer | `preparer@example.org`, Rowan Diaz (preparer) | Work board |
| Reviewer | `reviewer@example.org`, Ari Novak (reviewer) | Work board |
| Client | `client-a@example.org`, client A (Lena Okafor in the seeded case) | My applications |

`intaker@example.org` (Kai Mensah) is on the roster too. The demo doesn't need that account.

**Use one browser profile per account.** A browser keeps one sign-in for each site, shared by all
its tabs and windows, and all of its private windows share another one. So four accounts need four
separate profiles. On Windows, for example: Chrome, a Chrome Incognito window, Edge and an Edge
InPrivate window. A new tab in the same profile is the same account, and signing out in one tab
signs out all of them.

Sign every window in before the audience joins. A code for the same address can be requested about
once a minute, and the local stack's codes arrive in Mailpit (<http://127.0.0.1:54324>), not in a
real inbox.

The staff screens show no taxpayer names: cases are listed by client number and Application ID
(`#345`, `VT-XXXX-XXXX`). The IDs change every time the seed runs, so read them off the screen on
the day. The client's name appears only in the client's own window and in the office's
confirmation dialogs.

## What is simulated, and what is real

| | Simulated | Real |
| --- | --- | --- |
| Sign-in | — | A real one-time code, sent by the stack and really verified. Locally it lands in Mailpit; live email delivery is not set up yet (Task 10B) |
| Staff accounts | — | Each roster account is one person. The database decides who is acting on every action, so the history, receipts and the rule that a reviewer never reviews their own preparation name that person |
| Shared state | — | Every action is a database write, delivered to the other windows live |
| Seeded cases | Built by `npm run seed:local` for the rehearsal, through the same actions the screens use | — |
| Tax preparation | Recorded by hand as milestones; no tax software is connected | — |
| Documents | The only file the demo accepts is the fictional `demo-mileage-record-2025.pdf`; client uploads are not built yet | — |
| Reminders and contacts | ViTally sends no email, letter or text. A reminder or a logged contact is a record only | — |
| Filing results | The IRS's and Pennsylvania's answers are entered by hand by the office; nothing is sent to either | — |
| The 13614-C shaded section | — | The preparer's answers are saved as data and filled into the IRS form by the same generator that makes the draft |
| Roster roles and certificates | Staff must be cleared (a role this season, its confirmed certificates and, if new, the photo ID check) before they can act | The Roster is real data, readable only by an admin |

Say this plainly: **"The tax preparation, documents and filing answers you see are simulated. The
sign-in, the accounts, the shared updates between these windows and the review rules are real."**

## The seeded cases

`npm run seed:local` builds eleven cases, one help request and eight Roster volunteers. The client
names are fictional:

| Client | Where the case is | Whose move |
| --- | --- | --- |
| Lena Okafor (client A's own application) | Request sent, with the open help request | Office: Intake checks |
| Marcus Delgado | Pending intake / filing, no preparer | Preparer: Claim |
| Priya Sandoval | Filing in progress (preparing), a document requested | Preparer |
| Theo Nakamura | Filing in progress (preparing), document request escalated | Office: Call the client |
| Ines Whitford | Pending review | Reviewer: Claim review |
| Gabriel Osei | Corrections in progress | Preparer |
| Hana Kowalski | Ready to exit (review approved) | Office: Signing |
| Rafael Lindqvist | Rejected (Pennsylvania) | Office: Return to signing |
| Nora Achterberg | Accepted | Done |
| Diego Fairbanks | Hold | Office: Got in touch, or Close |
| Yuki Morrow | Closed, withdrawn | Closed |

Only Lena Okafor's case has a client account. The others were entered by the office, so no client
window shows them.

After a fresh seed, the office's Follow-ups queue says **8 open**: Intake checks, Hold, Signing,
Rejected, Call the client, Help request, and two Unclaimed work rows.

## The main story: one case from application to Accepted

About 12 minutes with all four windows. It follows Lena Okafor's case (client A) the whole way.

1. **Client window.** My applications lists one application, with its Application ID. Open it:
   "Hello, Lena." and *Your progress*: "Sent to PCDC". Leave this window on the case; it updates
   by itself at every step below, in the client's own words: Being reviewed, Waiting for a
   volunteer, Being prepared, Waiting for review, Being checked, Ready to sign.
2. **Office window: the queue.** Follow-ups lists everything waiting on the office, most urgent
   first, and shows no taxpayer names. Point at the kinds along the top (Intake checks, Hold,
   Signing, Rejected, Call the client, Help request, Unclaimed work).
3. **Office: screening.** On the **Intake checks** row, press **Open**. Opening it starts
   screening: wait until the stage reads *Screening in progress* (the page redraws, and a box
   ticked before that is cleared). The client window now says "Being reviewed". Under *Screening
   checks*, tick the three checks and press **Record the screening checks**. The case moves to
   *Pending intake / filing*, and the client window says "Waiting for a volunteer".
4. **Preparer window: claim.** The Work board shows the case under *Available*, with the phone
   masked ("Claim this case to see the full number"). Press **Claim**. The case opens with
   "Signed in as Rowan Diaz (preparer)." and the stage *Filing in progress (preparing)*.
5. **Preparer: the shaded section.** On the **Intake answers** tab, press **Fill the shaded
   section**. The 13614-C opens full-screen with only the grey "certified volunteer" fields
   editable. Fill a household cell, press **Save** ("Saved"; the editor stays open), then
   **Close**. **View Draft 13614-C** now carries that value in the shaded cell. This is the point:
   the volunteer's half of the form is data, filled into the real PDF.
6. **Preparer: hand off to review.** On **Overview**, answer *Who confirmed the intake information*
   (Client) and *How* (Phone), tick "I have completed the shaded parts of the 13614-C." and the State
   Forgiveness line, enter today's date, and press **Record that preparation is complete in
   TaxSlayer**. The case moves to *Pending review*. Where a review button would be, the page says
   "You prepared this case, so you cannot review it." The database refuses it too, whatever the
   screen shows.
7. **Reviewer window: claim the review.** On the Work board's **Waiting for review** tab, the case
   has **Claim review**. Press it.
8. **Reviewer: approve.** In *Before you approve*: today's date, PA forgiveness, *Did you go over
   the return with the taxpayer/spouse?* **Yes** (then the date and how), and *How will the client
   sign Form 8879?* **E-sign in the TaxSlayer Customer Portal**. The Exit Form is optional. Press
   **Approve this review**. The case is *Ready to exit*. (If you answer **No** to going over the
   return, the office gets a go-over task in Follow-ups first, and **Mark ready to e-file** waits
   for it.)
9. **Client window.** The case now reads **Ready to sign**: "Your return has been checked. Please
   e-sign Form 8879 in the TaxSlayer Customer Portal." Nothing about a refund amount or bank
   details, and nothing from the reviewer's notes.
10. **Office: signing and filing.** The case is on the **Signing** row.
    - **Mark ready to e-file…**: the dialog names the client ("for Lena Okafor"). Tick "The client
      signed Form 8879…" and press **Mark ready to e-file**.
    - On the **E-filing** row, **Mark e-filed…**: choose **Both returns e-filed**, tick "Each
      return was e-filed, or given to the client on paper, as chosen above.", press **Mark
      e-filed**.
    - On the **Filing result** row, **Record filing result…**: for the federal and the Pennsylvania
      return set **Answer** to Accepted and **Date of the answer** to today, tick "These results are
      correct.", press **Record the result**.

    The case is **Accepted**, the end of the chain.
11. **Office: History.** Open **All cases** (the case is under *Done*), open the case, and choose
    **History**. Every line names the account that did it: Sky Chen started screening and recorded
    the checks, Rowan Diaz claimed preparation, saved the shaded section and recorded preparation
    complete, Ari Novak claimed and approved the review, and Sky Chen recorded the signature, the
    e-filing and the result. Below it, *What the client sees* is the client's own history, in plain
    words.

## The short story (about 3 minutes)

When there's no time for the whole case, use the seeded cases directly:

1. **Office: Follow-ups.** One screen shows all the office's work. On the **Call the client** row
   (Theo Nakamura's case, escalated by the preparer), press **Log contact**. The task is assigned
   to Sky Chen, while Rowan Diaz stays the preparer: a follow-up never takes the case from its
   preparer. Log a call (We contacted, Phone, Reached, Client) and press **Log contact**. Logging
   never resolves the task: **Resolve this task** is the separate step below it.
2. **Reviewer: claim and approve.** Ines Whitford's case is under **Waiting for review**, prepared
   by Rowan Diaz. Claim the review and approve it, as in steps 7 and 8 above.
3. **Office.** The case appears on the **Signing** row without a reload.
4. **The Roster** (below), if the audience is PCDC staff.

## The Roster

Admins only. In the office window, choose **Volunteers** in the sidebar (a preparer or reviewer has
no such link). The seed's eight fictional volunteers are there, with no account (the Account column reads **Not created**, and the drawer's Account section says **Status: Not created**):

| Volunteer | Works | Languages | Roles | Certificates | Cleared |
| --- | --- | --- | --- | --- | --- |
| Maya Lindgren | On site | English | Preparer | VSC, IT&QR, Basic | Cleared |
| Tomas Abara | Remote | English, Spanish | Reviewer | VSC, IT&QR, Advanced | Cleared |
| Wen Tao Liu | On site | Mandarin, English | Preparer, Reviewer | VSC, IT&QR, Basic, Advanced | Cleared |
| Priya Venkat | On site and remote, no phone | English | Intaker | VSC, IT&QR | Cleared (new, photo ID check recorded) |
| Jordan Reyes | On site | English | Greeter | VSC | Not cleared: Photo ID check missing (new) |
| Hana Moretti | Remote | Cantonese, Mandarin | Preparer | VSC, IT&QR, Basic | Cleared |
| Samir Haddad | On site, no phone | English, Arabic | Admin | VSC, IT&QR, SC | Cleared |
| Lucy Fong | On site and remote | Cantonese, English | No roles recorded | None recorded | Not cleared: Form 13615 missing |

Each staff account also has a row. The seed clears the four role accounts first, so they show as
**Cleared**: Sky Chen as Admin (VSC, IT&QR), Rowan Diaz as Preparer (VSC, IT&QR, Basic), Ari Novak
as Reviewer (VSC, IT&QR, Advanced) and Kai Mensah as Intaker (VSC, IT&QR). That makes **12 of 12
volunteers** on a stack whose only staff are the four role accounts. A stack that also has older
accounts shows one more row for each of them, with "No roles recorded" and Not cleared.

What to show:

1. **Search.** Type `0143`: only Wen Tao Liu (search matches name, email and phone).
2. **Role filter.** Clear the search and choose **Reviewer**: Tomas Abara, Wen Tao Liu and the reviewer account, Ari Novak.
3. **Add a volunteer.** The drawer asks for name, email, phone (optional), how they work,
   languages, roles and certificates. Saving adds a person with no sign-in and no access. Press
   **Cancel** unless you want the new row to stay: a re-seed removes only the eight seeded
   volunteers, never one added by hand.
4. **Say how clearance works.** A person is **Cleared** when they have at least one role this
   season, and, if they are new, their photo ID check is recorded. Each role needs its confirmed
   certificates. Staff who are not cleared (no role yet, or a new volunteer without the photo ID
   check) get no staff actions until an admin clears them. Lucy Fong has no roles, so she is waiting
   for her Form 13615. Jordan Reyes is new and his photo ID check is missing. Samir Haddad is
   recorded as Admin and has no sign-in, so he can do nothing in ViTally.

## Accounts

Admins only, on the local stack. Open the local mail catcher (Mailpit) at the URL the stack's
status output prints as `MAILPIT_URL` (`http://127.0.0.1:54324` with the default ports). It shows
every email the stack would have sent.

1. **Create account.** On the Roster, open Maya Lindgren, whose Account section says **Status:
   Not created**, and press **Create account**. The result reads "Account created and sign-in code sent",
   and the Account column now reads **Invited**. The volunteer's email is a fictional
   `@example.org` address.
2. **The code email.** In the mail catcher, open the new message to that address: "Your ViTally
   code is" followed by six digits. Type the address on the sign-in screen in a second window,
   then the code. The volunteer lands on the staff screen, and the account turns **Active**.
   (The sign-in screen also sends a code of its own; use the newest one.)
3. **Invite a client.** On the office screen, under **Invite a client**, type a fictional client
   address and press **Invite**. The list shows it as **Invited**, with **Resend** while it is.
   The client signs in with the emailed code and sees **My applications**; the list then shows
   **Active**. If the email didn't go out, the notice says to use Resend in a minute.
4. **Deactivate and Reactivate.** In Maya's drawer, press **Deactivate** and confirm: her open window loses
   access (the no-access screen), and the Account column reads **Deactivated**. Signing in again
   doesn't bring her back. **Reactivate** restores the account. An admin can't deactivate their
   own account.

## What the browser test covers

`npm run test:browser` (see [Tests](setup.md#5-tests)) runs this story and much more, twice, with
Chrome and Firefox swapped between the windows. It uses its own throwaway workspace and its own
role accounts (Avery Lin, Taylor Brooks and Jamie Ellis), not the rehearsal workspace. Among its
phases: a new application reaching the staff board; a document request, an escalation and the
office's call; a correction round and resubmission; the short claim-and-approve path; signing,
e-filing and a rejection filed again; a walk-in taken in on **Add a case** with its document
received at the desk; a Hold, a withdrawal and the season-end **Close unsigned cases…**; two staff
accounts working one case; the Chinese intake; and the refusals below. Run it before a presentation
if anything has changed since the last run.

## Known behaviors to expect and narrate, not treat as bugs

- **A stale-revision refusal** can happen if two windows act on the same case within about a
  second of each other. It is required behavior (a stale write must never succeed silently), and
  the message stays until dismissed. Press the button again.
- **An action can produce more than one live update** for the same case. When showing "watch it
  update", point at the case's stage, not at a counter.
- **Most rows show "—" under Contact preference.** The demo stores a contact preference only on a
  help request, and the seed makes one ("Prefers calls from the main office").
- **The resend countdown belongs to the browser window**, not to the address. Reloading doesn't buy
  another send. The stack's own minimum interval between emails (60 seconds) is what actually
  governs sending.
- **Chrome's date fields follow the browser's own language.**

## What to say when someone asks about their own data

- **Only approved addresses can sign in.** There is no public sign-up. An address that is not on
  the roster gets the same neutral message as anyone else, "If this address is eligible, check your
  inbox for a sign-in code.", with the same countdown, so the screen reveals nothing about who has
  an account.
- **A client sees only their own applications.** My applications lists every application started
  with that address. Looking up someone else's Application ID finds nothing ("We could not find that
  Application ID").
- **A client cannot act as staff,** whatever they type or click. The database checks the account's
  membership and capabilities on every action; the browser test proves that a client's forged staff
  action on their own case is refused, with nothing recorded.
- **Re-seeding never touches anyone's own work.** `npm run seed:local` replaces only the cases and
  volunteers it made itself.
- **There is no demo code.** Any guessed code, including the old `246810`, is refused with "That
  code is invalid or has expired. Request a new code." Every code must be one the server really
  sent.
