# ViTally redesign

- [Review, DESIGN.md proposal and implementation plan](redesign-review.md)
- [Design system (DESIGN.md)](DESIGN.md)

## Current screens (Nov 21, 2026)

What the app looks like on `main` today: 1280 px wide unless the table says otherwise, the local test stack with `seed:local`'s fictional data. The demo tools (the "Fill fictional details" buttons, which only a local server with `VITALLY_DEMO_TOOLS=1` shows) are hidden, as on govitally.org. Also used on the landing page (#218).

| Screen | Image |
|---|---|
| Volunteer work board: a preparer's Waiting for preparation, and a reviewer's Available tab (1440) | [preparer](screens/current/work-board-preparer.png) · [reviewer](screens/current/work-board-reviewer.png) |
| Office case pool: every case this season, by stage, with labels | [case-pool.png](screens/current/case-pool.png) |
| Office Follow-ups queue (1440) | [follow-ups.png](screens/current/follow-ups.png) |
| Client progress: just sent (1280), and ready to sign (720, from the browser story) | [sent](screens/current/client-progress.png) · [ready to sign](screens/current/client-progress-ready-to-sign-720.png) |
| Client intake: Before you start, desktop and phone (390) | [desktop](screens/current/client-intake.png) · [phone](screens/current/client-intake-390.png) |

## Final screens

The design-stage screens and the screenshots taken as each part was built. Some show things that have changed since (for example Presenter controls, removed in #128).

| Screen | Image |
|---|---|
| Volunteer dashboard: your claimed cases by phase, waiting on you, contribution graph | [volunteer-dashboard-v4-full-page.png](screens/volunteer-dashboard-v4-full-page.png) |
| Volunteer work board: Available, Waiting for preparation, Waiting for review; masked phones; claim | [staff-board-v7-full-page.png](screens/staff-board-v7-full-page.png) |
| Implemented (part 1, PR 1): work board on today's stages, rendered from test fixtures | [implemented-staff-board.png](screens/implemented-staff-board.png) |
| Admin case pool: every case, phase tabs, stage/language/service/location/people filters | [admin-work-board-full-page.png](screens/admin-work-board-full-page.png) |
| Add a case: returning-client search, filled from last season, D9 materials checklist | [add-case-v6-full-page.png](screens/add-case-v6-full-page.png) · [review a match](screens/add-case-v6-returning-client.png) |
| Case page, preparer view: next step, labels, contact card, household | [case-preparer-view-v3-full-page.png](screens/case-preparer-view-v3-full-page.png) |
| Case page tabs: Intake answers, Documents, Follow-up, History | [case-tabs-overview.png](screens/case-tabs-overview.png) |
| Request corrections dialog (reviewer) | [case-corrections-dialog-lav-full-page.png](screens/case-corrections-dialog-lav-full-page.png) |
| Implemented (part 1, PR 2): case page with tabs and next step, rendered from test fixtures | [implemented-case-page.png](screens/implemented-case-page.png) · [corrections dialog](screens/implemented-corrections-dialog.png) |
| Client intake, desktop: step 1, standard wording with the senior-version question | [intake-step1-v2-general.png](screens/intake-step1-v2-general.png) |
| Client intake, desktop: step 2, standard and senior wording, best time to reach | [standard](screens/intake-step2-v2-general.png) · [senior](screens/intake-step2-v2-senior.png) |
| Client intake, desktop: step 4 (Who multi-select), standard and senior | [standard](screens/intake-step4-v2-general.png) · [senior](screens/intake-step4-v2-senior.png) |
| Client intake, desktop: step 6 (income), standard and senior | [standard](screens/intake-step6-v2-general.png) · [senior](screens/intake-step6-v2-senior.png) |
| Client intake, desktop: step 5 in Simplified Chinese, standard and senior | [standard](screens/intake-step5-zh-v2-general.png) · [senior](screens/intake-step5-zh-v2-senior.png) |
| Client intake, mobile (after the MVP): all 9 steps | [intake-mobile-all-steps.png](screens/intake-mobile-all-steps.png) |
| Implemented (part 1, PR 3): client screens on today's 4-step intake, rendered from test fixtures | [intake](screens/implemented-client-intake.png) · [progress](screens/implemented-client-progress.png) · [sign-in](screens/implemented-client-sign-in.png) |
| Implemented (parts 4b and 4b2): the client's version-2 intake by sub-step, from the browser story (the default since migration 020) | [rail tree](screens/implemented-intake-v2-rail-tree.png) · [documents](screens/implemented-intake-v2-documents.png) · [review](screens/implemented-intake-v2-review-check.png) · [summary](screens/implemented-intake-v2-summary.png) · [senior](screens/implemented-intake-v2-senior.png) |
| Implemented (part 4d): the client side in 简体, from the browser story | [intake](screens/implemented-zh-intake.png) · [review](screens/implemented-zh-review.png) · [progress](screens/implemented-zh-progress.png) |
| Admin office overview: unclaimed cases by age and language, volunteers and their cases, office activity | [admin-dashboard-v2-full-page.png](screens/admin-dashboard-v2-full-page.png) |
| Admin Follow-ups queue | [admin-followups-full-page.png](screens/admin-followups-full-page.png) |
| Admin Post an update | [admin-post-update-full-page.png](screens/admin-post-update-full-page.png) |
| Admin Season settings | [admin-season-settings-full-page.png](screens/admin-season-settings-full-page.png) |
| Admin People | [admin-people-full-page.png](screens/admin-people-full-page.png) |
| Implemented (part 1, PR 4): office screens on today's data, rendered from test fixtures | [follow-ups](screens/implemented-office-followups.png) · [log a call](screens/implemented-office-log-call.png) · [add a case](screens/implemented-office-add-case.png) · [case pool](screens/implemented-office-case-pool.png) |
| Implemented (part 2): client numbers on the work board, office queue, case pool, case header and the client's progress page (case header rendered from test fixtures; the rest from the browser story) | [board](screens/implemented-client-numbers-board.png) · [queue](screens/implemented-client-numbers-queue.png) · [pool](screens/implemented-client-numbers-pool.png) · [case](screens/implemented-client-numbers-case.png) · [progress](screens/implemented-client-numbers-progress.png) |

All names, phone numbers and data in these screens are fictional. The logo is PCDC's own file (`docs/media/Shao-Transparent BLUE.png`).
