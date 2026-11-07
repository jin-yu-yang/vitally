---
name: ViTally Lavender
colors:
  background: '#f8f7fd'
  on-background: '#2a2745'
  surface: '#ffffff'
  surface-dim: '#efedfb'
  surface-bright: '#ffffff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f8f7fd'
  surface-container: '#f2f4f9'
  surface-container-high: '#efedfb'
  surface-container-highest: '#e8ebf4'
  surface-variant: '#efedfb'
  on-surface: '#2a2745'
  on-surface-variant: '#6c6886'
  inverse-surface: '#2f3864'
  inverse-on-surface: '#fafaf5'
  outline: '#d4cfe8'
  outline-variant: '#e7e4f2'
  surface-tint: '#6a5acd'
  primary: '#6a5acd'
  on-primary: '#ffffff'
  primary-container: '#efedfb'
  on-primary-container: '#4b3fa3'
  inverse-primary: '#b4bde0'
  secondary: '#2f8a4c'
  on-secondary: '#ffffff'
  secondary-container: '#e7f0e7'
  on-secondary-container: '#52753e'
  tertiary: '#996924'
  on-tertiary: '#ffffff'
  tertiary-container: '#faf0dd'
  on-tertiary-container: '#7c5a1c'
  error: '#a44d39'
  on-error: '#ffffff'
  error-container: '#faeee9'
  on-error-container: '#8a3b34'
  primary-fixed: '#efedfb'
  primary-fixed-dim: '#d9ddee'
  on-primary-fixed: '#2f3864'
  on-primary-fixed-variant: '#4c5a8f'
  secondary-fixed: '#e7f0e7'
  secondary-fixed-dim: '#c9d8bd'
  on-secondary-fixed: '#1f3d2f'
  on-secondary-fixed-variant: '#628366'
  tertiary-fixed: '#faf0dd'
  tertiary-fixed-dim: '#ecdcbc'
  on-tertiary-fixed: '#4a3410'
  on-tertiary-fixed-variant: '#a07c32'
typography:
  display-serif:
    fontFamily: Georgia
    fontSize: 66px
    fontWeight: '400'
    lineHeight: 72px
    letterSpacing: -0.035em
  headline-lg:
    fontFamily: System UI Sans
    fontSize: 40px
    fontWeight: '600'
    lineHeight: 46px
    letterSpacing: -0.03em
  headline-md:
    fontFamily: System UI Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 31px
    letterSpacing: -0.02em
  title-sm:
    fontFamily: System UI Sans
    fontSize: 17px
    fontWeight: '600'
    lineHeight: 24px
  body-base:
    fontFamily: System UI Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: System UI Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 20px
  label-field:
    fontFamily: System UI Sans
    fontSize: 14px
    fontWeight: '550'
    lineHeight: 20px
  label-caps:
    fontFamily: System UI Sans
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.18em
rounded:
  sm: 5px
  DEFAULT: 8px
  md: 9px
  lg: 13px
  xl: 17px
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
  gutter: 20px
  margin-mobile: 22px
  margin-desktop: 32px
---

# Design System: ViTally

ViTally is the case-management tool for the free VITA (Volunteer Income Tax Assistance)
service run by PCDC (Philadelphia Chinatown Development Corporation). It has two
audiences: **clients**, who fill in the intake form and follow their return's progress,
and **volunteers**, who take cases through preparation, independent review, office
follow-up and help requests. This document describes the UI as it is built today, from
`src/styles.css` and the view renderers under `src/`.

## 1. Visual Theme & Atmosphere

A quiet, paper-like interface in a soft lavender-slate that sits beside PCDC's slate-blue logo. The canvas is an almost white,
faintly lavender off-white (`#f8f7fd`), content sits on white panels with hairline lavender borders
and shadows so faint they barely show, and the one saturated color is the lavender-slate of
the primary buttons and brand mark. The mood is calm, trustworthy and deliberately
unhurried: it should read like a community office with good lighting, not a fintech
product. Copy carries much of the character. It is plain-language and reassuring ("A
little clarity on where things stand.", "We're here for you."), and every screen says
that the data is fictional.

The client side is warmer and more editorial. It uses a Georgia serif for greetings
and hero headlines, generous whitespace, and a two-column dashboard with a progress
stepper. The volunteer side is utilitarian: one narrow 560px column, long label/value
lists, small uppercase overlines and pill badges. Density there is high vertically but
the wide screen goes mostly unused.

## 2. Color Palette & Roles

### Primary Foundation
- **Morning Canvas** `#f8f7fd`: page background behind every screen.
- **Paper White** `#ffffff`: panels, cards, inputs, the header bar.
- **Lavender Mist** `#efedfb`: soft informational notes and "all set" callouts.
- **Hairline Lavender** `#e7e4f2`: panel borders, dividers, the header's bottom rule.
- **Field Lavender** `#d4cfe8`: input borders and secondary-button borders.

### Accent & Interactive
- **Lavender Slate** `#6A5ACD` (chosen to sit beside the PCDC 寿 logo, which stays `#546196`): primary buttons, active stepper node, links.
- **Deep Lavender** `#5646b5`: primary button hover and pressed states.
- **Pine Green** `#2f8a4c`: the presenter panel's accent border and "connected" states.
- **Lantern Amber** `#996924`: the single warm accent (the dot after "ViTally").
  Its lighter forms mark corrections and waiting states.
- **Focus Lavender** `#8a93bd`: 2px focus outline on form fields.

### Typography & Text Hierarchy
- **Lavender Ink** `#2a2745`: headings and primary text.
- **Slate Label** `#3b5158`: field labels.
- **Quiet Slate** `#6c6886`: text buttons and secondary copy.
- **Muted Slate** `#6c6886`: intro paragraphs and metadata.
- **Whisper Grey** `#8b9797` / `#82918f`: field notes and overlines.
- **Placeholder** `#a6afaf`.

### Functional States (badge pairs: background / text)
- **Info / intake**: `#e6eefa` / `#3a6690`.
- **Success / available / complete**: `#e7f0e7` / `#628366`.
- **Attention / corrections / waiting**: `#faf0dd` / `#a07c32`.
- **Error**: `#faeee9` / `#a44d39`; error banner `#fbeceb` / `#8a3b34`.

## 3. Typography Rules

### Hierarchy & Weights
- **Sans (UI)**: the system stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Arial`)
  is used for everything functional. There is no web font.
- **Serif (voice)**: Georgia at weight 400 for the client greeting ("Hello, Mei."), the
  landing hero (66px, tracking −2.3px) and warm callout titles ("We're here for you.").
- **H1**: 40px, weight 600, line-height 1.15, tracking −1.3px (32px on mobile).
- **H2**: 24px, weight 600, tracking −0.5px, used as the panel title ("Your progress",
  "Work board").
- **H3**: 17px, weight 600.
- **Body**: 16px, line-height 1.5. Field notes are 12px, line-height 1.65.
- **Overline**: 10px, weight 700, tracking 1.8px, all caps, whisper grey. It sits above
  every page title ("VOLUNTEER WORKSPACE", "YOUR APPLICATION").
- **Brand wordmark**: "ViTally" bold with an amber full stop, and a letter-spaced caps
  tagline beneath ("PCDC COMMUNITY TAX ASSISTANCE").

### Spacing Principles
Headings use tight negative tracking and short line-heights. Body and notes use
generous line-heights. Overlines use wide positive tracking so the caps read as labels.

## 4. Component Stylings

### Buttons
- **Primary**: Lavender Slate fill, white text, 8px radius, min-height 48px, 12×22px
  padding, weight 550 at 15px, a trailing arrow icon, and a very soft drop shadow.
  Full-width inside forms.
- **Secondary**: white with a Field Lavender border, lavender text and a leading icon.
  Persona chips add a small grey capability caption.
- **Text**: no border, Quiet Slate, used for "Sign out", "Back to the work board" and
  "Use a different email address".
- **Inline**: underlined link style, used for "Dismiss", "Get help from the office" and
  "Resend code".

### Cards & Case Containers
- **Panel**: white, 1px Hairline Lavender border, 13px radius, near-invisible shadow, and
  roughly 30px padding.
- **Board row (case card)**: a 9px-radius white card. It opens with the underlined case
  reference (for example `VT-5ENA-WJMV`) plus a chevron and stage badges, followed by a
  two-column grid of caps labels over values (Service, Language, Work needed, Requires,
  Preparer, Reviewer, Last reminded, Updated).
- **Presenter panel**: a panel with a Pine Green border and a 2px inset top rule. It
  holds the persona picker and the demo controls.
- **Modal**: 17px radius, 36px padding, 520px max width, a deep soft shadow, and an
  overline reading "ViTally · HERE TO HELP".

### Navigation
- A 100px-tall white header bar with a hairline bottom border. It has the brand mark on
  the left (the PCDC 寿 (longevity) logo, `docs/media/Shao-Transparent BLUE.png`, in
  its own slate blue `#546196` on a transparent background (never recolored); it replaces the earlier house-icon tile, which had an 8/8/17/8px radius, giving one rounded
  "leaf" corner). On the right sit "2025 TAX SEASON" in caps, then "Need help?", a
  divider, the signed-in role and "Sign out".
- There is no sidebar or tabs. Moving between screens is done with text buttons
  ("Back to my applications") and case references.
- A footer line carries the PCDC attribution and "Course prototype · Tax year 2025 ·
  No real taxpayer data".

### Inputs & Forms
- The label (14px, weight 550, slate) sits above the input. Inputs have a Field Lavender
  border, a 7px radius, 13×14px padding, a min-height of 49px and 16px text.
- Focus shows a 2px Focus Lavender outline. A 12px field note follows under the input.
- Errors appear as a soft terracotta block with a 7px radius.

### Domain-Specific Components
- **Stage badge**: a 5px-radius pill with a small dot, in the info, success or
  attention color pairs ("Waiting for preparation", "Corrections in progress",
  "Review complete", "Available").
- **Progress stepper**: four nodes (Intake → Preparation → Review → Next steps) joined
  by hairline connectors. A done node is a pale green circle with a check, the current
  node is a solid lavender circle with a white number, and future nodes are outlined grey.
- **Application ID pill**: a white card with a folder icon, a caps label and the
  letter-spaced reference.
- **History timeline**: small hollow dots on a vertical hairline, each entry with a
  12px date underneath. Volunteers see the internal event names and the client-facing
  lines separately.
- **Support note**: a question-mark icon with a bold title and muted help text,
  under the sign-in forms.

## 5. Layout Principles

### Grid & Structure
- **Volunteer and sign-in screens**: one centered column, `min(560px, 100%)`, with
  48px top padding. Every staff screen uses this column, including boards of six or
  more cases.
- **Client dashboard**: 1200px max width. A main column (progress, "all set" callout,
  history) sits beside a roughly 290px sidebar (service details, help card).
- **Header**: gutters of `max(32px, (100vw − 1320px) / 2)`.
- **Breakpoints**: 1500px (wide), 1150px, 800px/760px (tablet collapse), 450px (phone).

### Whitespace Strategy
Spacing sits loosely on a 4px base, with frequent odd values (13, 17, 23px) where the
original design was hand-tuned. Panels stack 20–24px apart. Page intros give the H1
plenty of room.

### Alignment & Visual Balance
Sign-in screens are centered, with an icon tile above an overline, the H1 and a lede.
Everything else is left-aligned. Label/value rows are justified: the label on the left
in muted grey, the value on the right, bold, in ink.

### Responsive Behavior & Touch
Layouts are desktop-first and collapse under 760px. Buttons and inputs are 48–49px
tall. Case cards stack their fact grid, and the stepper compresses.

## 6. Design System Notes for Stitch Generation

### Language to Use
"Calm community-service interface", "lavender-slate palette with red, green and amber accents on an off-white
canvas", "hairline-bordered white panels", "serif greeting with a sans-serif UI",
"plain-language, reassuring microcopy", "bilingual-friendly (English, Cantonese,
Mandarin)".

### Color References
Lavender Slate `#6a5acd` for primary actions (the logo itself stays `#546196`), Deep Lavender `#5646b5` for hover,
Morning Canvas `#f8f7fd` for the page, Hairline Lavender `#e7e4f2` for borders, Lavender Ink
`#2a2745` for text, and Lantern Amber `#996924` as a sparing warm accent.

### Component Prompts
- "A volunteer work board for a free tax-prep clinic. Case cards show an underlined case
  reference, stage pill badges, and a compact grid of Service, Language, Preparer,
  Reviewer and Updated. Filter chips at the top. White cards with hairline lavender borders
  on an off-white canvas, and lavender-slate primary buttons."
- "A client progress page. A serif greeting reads 'Hello, Mei.', with a four-step
  horizontal stepper (Intake, Preparation, Review, Next steps), a soft green 'You're all
  set' callout, a side card of service details, and a 'We're here for you' help card."
- "An email one-time-code sign-in card, centered, with a lock icon tile, an uppercase
  overline, a large headline, a full-width lavender button and a resend countdown."

### Incremental Iteration
Keep the palette and the reassuring tone. Wider staff layouts are fair game: multi-column
boards, a case sidebar, and a presenter panel collapsed into a compact toolbar. Show
event history in human language, and keep the "fictional data" disclaimers visible.

## 7. Accents, text colors and newer components (2026-09-27)

### Accent colors
- **You / unread (red)**: `#c53030` for the signed-in volunteer's own avatar; `#dc2626` for notification and message count badges (white text 4.8:1).
- **Progress (green)**: `#2f8a4c` for the case lifecycle bar (completed segments full, the current segment partly filled with a pulsing dot), check icons and "Saved"; tint `#dcefe3`, text `#23703d`.
- **Office (amber)**: `#b7791f` for office/admin people and their timeline dots; admin tag `#fdf1dc` / `#8a5a12`.
- **Stage badges** keep their family colors; the Preparation & review family is neutral grey (`#e7e4f2` / `#6c6886`) on the board and on case pages alike.

### Text colors
- **Volunteer screens**: ink `#2a2745`, muted `#6c6886`.
- **Client intake screens**: near-black `#1b1b1f` for headlines, questions and body; neutral grey `#5c5c66` for hints. Lavender appears only on buttons, selected answers, links, the "STEP n OF 9" overline and the current step.

### Logo
The PCDC 寿 logo (`docs/media/Shao-Transparent BLUE.png`) is embedded as an image next to the "ViTally." wordmark, never redrawn or recolored and never replaced by a generated image.

### Newer components
- **Notifications**: sidebar item above Settings with a red count; opens a read-only panel of announcements. Only office admins can post; replies are turned off.
- **Labels**: small colored chips (City Tax sky, Multi-state amber, MFS pink) on a case and under the client number on the work board; "Add a label" menu with search, checkboxes and "Create a new label" (anyone can create); a "Labels" filter on the board.
- **Teammate contact card**: clicking a person badge (Intake / Preparer / Reviewer) opens a dialog with phone (Copy, Call), best time to reach, languages, and a "Message about this case · Coming later" placeholder. A teammate may hide their phone ("Phone number hidden"); your own card shows "This is you" and a "Share my phone with teammates" toggle.
- **Client & household panel**: filing situation, language and a green "Best time to reach" tile, then one row per person (Taxpayer, Spouse, Dependents) with role tags.

### Dashboard contribution graph (2026-09-27)
- The most prominent element on the volunteer dashboard. One cell per day, weeks as columns (Sun–Sat rows), intensity in five lavender steps (`#efedfb` → `#5646b5`), cells sized to fill the card (up to 34px).
- Range: preseason start (office setting; placeholder Dec 1) through the filing deadline. The deadline is April 15, moved to the next business day when it falls on a weekend or on DC Emancipation Day (April 16; observed Fri Apr 15 or Mon Apr 17). Preseason and tax season are marked under the graph; the deadline cell has a red outline.
- Toggle: All · Preparing · Reviewing; a season selector switches filing seasons.
- Stats panel under the graph: returns handled, refunds reported by the returns you prepared (corrections requested when viewing reviews), busiest day, active days, per active day. Labelled "Only you see this. It is not a ranking."

### Notifications purpose
Office admins relay pre-season IRS policy updates (e.g. certification and the Volunteer Standards of Conduct). Read-only; replies are turned off. Case-specific nudges from admins to volunteers belong in case-based messages once messaging exists, not here.
- **Day drill-down**: every cell is a button. Selecting a day (dark outline) fills a panel under the graph: on the volunteer dashboard, one row per case (client number, prepared/reviewed, language, outcome, Open); on the admin overview, the volunteers on shift that day with what each did, each opening the teammate contact card.
- **Clients served by language**: a stacked bar (Mandarin `#6a5acd`, Cantonese `#0ea5e9`, English `#2f8a4c`, Other `#b7791f`) with counts and percentages, under the stats on both dashboards.

### Admin office overview (2026-09-27)
Same graph, counting the whole office (tooltips add volunteers on shift). Stats swap "Active days" for "Volunteers active". A roster table (name, role, certification, languages, usual days, phone or Hidden, hours) is sorted by name and labelled "for shift and language coverage, not for ranking". Admins get an "Office · Admin" sidebar section: Office overview, Follow-ups, People, Post an update, Season settings.

### Admin follow-ups queue (2026-09-27)
One prioritized list of office tasks replacing the old stacked "Office work" sections. Task types, each with its own icon and tint: Call the client (amber), Intake checks (intake blue), Help request (pink), Waiting on client (yellow), Unclaimed work (lavender), Ready to close (green); filter pills with counts. Columns: task, client (with labels), what's needed, language (green when the admin speaks it, otherwise who on the team does), best time to reach (green "Good time now" chip), waiting (amber at 3 days, red at 5), one action. "Log a call" opens a right-side drawer: phone and Call, best time to reach, outcome (reached / left a message / no answer / wrong number), note for the case team, next follow-up. Reminding a single volunteer waits for case messages.

### Admin: Post an update and Season settings (2026-09-27)
- **Post an update**: composer (type IRS policy update / Office notice as radio cards, title, message, optional IRS source link, audience, keep-at-top date, "ask volunteers to confirm they have read it") beside a sticky live preview of the Notifications panel. Posted updates list read and confirmed counts with small progress bars.
- **Season settings**: two-column sections (explanation left, controls right) for season dates (preseason start, filing opens, computed deadline with its reason and an override, a preseason/tax-season timeline), office shift days (toggle tiles) and hours, labels (rename/archive, who can create), client numbers (assigned on submit, digits, numbers left, reset per season), and phone-sharing default; a sticky Save bar.

### Admin: People (2026-09-27)
Summary tiles (ready for the season with a green bar, needs attention in amber and clickable as a filter, roles, language coverage), then the roster: person (avatar, name, email), role chips (Preparer lavender, Reviewer blue, Office admin amber), season readiness (certification level and Standards of Conduct, green check or amber warning), languages, usual days, phone Shared/Hidden, status (Active green, Invited yellow), Edit or Resend invite. Role pills, "Needs attention" and search filter the list. One right-side drawer handles invite and edit (name, email that grants sign-in, roles, certification, languages, usual days); it states that admins cannot reveal a hidden phone, and offers Deactivate (past work is kept) instead of delete.

## 8. Phases, masked phones and access (2026-09-28)

### Phases
Boards and dashboards group the ~20 lifecycle stages into phases, each with one color (used for tab dots, stacked bars and chips; stage badges keep their family colors):
Available `#a39bd8` · Waiting for preparation `#6a5acd` · Waiting on client `#b7791f` · Waiting for review `#0ea5e9` · Filing `#5fb37a` · Needs attention `#dc2626` · Done `#23703d` · Closed `#b9b4cc`.
The volunteer work board shows only three phases as tabs (Available, Waiting for preparation, Waiting for review), with a Mine / Everyone switch on the last two. The admin case pool shows every phase.

### Masked phone
- Staff screens always show a client's phone as `(•••) •••-1234` in tabular numerals first: on the case page's contact card and intake answers, and in the Phone column of the volunteer work board and the admin case pool (after Stage, the client's phone only; "—" when there is none).
- When the viewer may see the number (an admin, or a volunteer on their own case), a small lavender `visibility` icon follows; hover or keyboard focus swaps in the full number. A click keeps it shown only while the mask has focus, so it can be selected and copied; clicking elsewhere or pressing Tab hides it again. There's no copy button.
- When the viewer may not see it (a volunteer on an unclaimed or someone else's case), the mask is muted with a `lock` icon and the tooltip "Claim this case to see the full number".

### Access
- **Admins:** every case, every detail, documents included.
- **Volunteers:** every detail of cases they claimed. On available cases they can read only the intake answers (an **Intake** link); no unmasked phone and no documents.
- A preparer can never claim the review of a return they prepared.

### Waiting and aging
Days since submission: under 3 days muted, 3–6 days amber `#8a5a12`, 7 or more days red `#b42318` and bold. Aging bars use green `#5fb37a`, amber `#d69e2e` and red `#dc2626`. A case is "stalled" when it is still open with no update for 5 days.
