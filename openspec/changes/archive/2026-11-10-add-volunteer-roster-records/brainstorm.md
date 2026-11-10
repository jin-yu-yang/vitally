# Brainstorm: add-volunteer-roster-records

Raw capture of the design conversation of 2026-11-09. The user approved every recommendation below ("All as recommended") and confirmed the five promotion criteria.

## Background

Issue #136 (remove presenter access) merged as #182, migration 043. This change is the first slice of #138, for a PCDC review on the evening of Wednesday 2026-11-11, and has to be finished by that afternoon.

The slice as the user set it: Volunteers > Roster (table, search, role filter), Add a volunteer and Edit (name, email, phone, languages, works, roles, certificate ticks). Admin-only RLS. Roles are recorded only and grant no capability; access still comes from the roster command. Fictional data only. Everything else in #138 waits.

Sources read: `D:\dev\admin-volunteers-decisions.md`, the #138 issue and its Nov 6 comment (the three-layer data model), the Roster screen in `D:\dev\vitally-office-prototype.html`, the `sign-in` and `local-seed-data` specs, and migrations 001, 007, 038, 042, 043 on `origin/main`. `vitally-profiles-prototype.html`, named in the #138 comment, was not found in `D:\dev` and was not read.

## Findings that shaped the decisions

- `people` is readable by every staff member (policy `staff_people`, 043), the app runs `select *` on it (`listPeople`), and it is in the realtime publication and in the staff subscription list. Row-level security cannot hide some of its columns from some staff.
- `add_staff_member` inserts a new person every time and refuses a re-run with a changed name, key or capabilities, aborting the whole roster run.
- `people.capabilities` allows an empty list, so a person with no sign-in and no capabilities is a valid row. `personOptions` in `src/pool-views.mjs` lists every person.
- `workspaces.current_season` defaults to 2025 and nothing changes it.
- `docs/setup.md` says there is no hosted Supabase project yet.

## Decisions

### Q1. Where do email, phone, works and languages live?
The agreed model (#138 comment) adds them to `people`. That cannot be admin-only, for the reasons above.
**Decision:** a separate one-to-one `volunteer_profiles` table with admin-only access. `people` keeps its columns. `roster_entries` and `certificates` stay as agreed. The user asked that the design record why this differs from the agreed model; the user updates the decisions doc.

### Q2. How does someone added on the Roster get access?
Today the roster command would create a second person, leaving a record without a login and a login without a record.
**Decision:** when the emails match, `add_staff_member` links the existing record and takes the key and capabilities from the roster file. Delta on `sign-in`.

### Q3. Editing a name
A re-run currently refuses a changed name.
**Decision:** name is editable for everyone. The database name wins, and re-runs stop comparing it. Same function, same delta.

### Q4. Existing staff on the Roster
**Decision:** yes. The migration creates a profile and a roster entry for each staff person, copying email from `auth.users`. `add_staff_member` does the same for new staff. Roles start empty and show "No roles recorded"; they are not inferred from capabilities, because roles are record-only.

### Q5. Non-admin visibility of volunteers with no sign-in
**Decision:** tighten the `people` policy so only admins can read a person who has a roster entry and no login, and leave those people out of the All cases "Anyone" filter.

### Q6. Email editing
**Decision:** locked once the person has a sign-in, because changing it would not change their login. Otherwise editable, required, and unique per workspace ignoring case.

### Q7. Season
**Decision:** entries are stored against `current_season`. No season label and no Event picker until Season settings exists, because the label would read "2026 for TY 2025" in front of PCDC.

### Q8. Certificate and role display
The prototype's amber "missing" chips, hollow role dots and "What X can do" panel all imply clearance.
**Decision:** leave them out. Plain role labels and neutral chips for ticked certificates, plus one line on the page: "Roles and certificates are recorded here. They don't change what anyone can do in ViTally yet."

### Q9. Table columns
**Decision:** Volunteer (name, Remote badge, email · phone), Roles, Certificates, Languages, Edit. No Account column.

### Q10. Toolbar and navigation
**Decision:** role filter, and search on name, email and phone. A "Volunteers" sidebar link for admins only. No tab bar until a second tab exists.

### Q11. Form rules
**Decision:** at least one role to save. Works is one choice, defaulting to On site. Languages are English, Mandarin, Cantonese and Other, and Other requires naming the language. Certificates are five independent ticks.

### Q12. Rules that wait
**Decision:** defer the "refused while holding open work" check and the "email already used by a client" check. Roles grant nothing yet, and the roster command already refuses a client's address.

### Q13. Also out
Gender, usual days, phone sharing, New and photo ID, summary and topics, removing a volunteer, CSV, Show and Works filters, resizable columns. A mistaken Add can only be edited, not removed.

### Q14. Writes
**Decision:** one RPC, `vitally_save_volunteer`, for both Add and Edit, with action receipts and a revision check like every other write. Reads go directly through the admin-only policies.

### Q15. `certificates.status`
**Decision:** create it with both agreed values (`uploaded`, `confirmed`) but only ever write `confirmed`. Unticking deletes the row.

### Q16. Live updates
**Decision:** none. The list loads on open and after save. If two admins collide, the second gets the existing "someone else changed this" conflict.

### Q17. Tests
**Decision:** unit tests; database tests including a non-admin being refused on every table and RPC; one short browser test separate from the story, so the story's time limit is not touched; `test:browser`; and a local migration onto a stack already at `main`'s migrations, because this migration changes existing rows. No Chinese text is involved.

### Q18. Where the review runs
**Decision (user):** the user's local stack over a Zoom screen share, from the branch's worktree if the PR is not merged by then. The user wants to be told on Wednesday morning how to start it.

### Q19. Review data
**Decision:** extend `seed:local` with about 8 fictional volunteers, using a delta on `local-seed-data`.

### Q20. If time runs short
**Decision:** cut the seed first and add volunteers by hand; the user must be told so they can add them before the review. Cut the separate browser test only if the user agrees. Admin-only access and the database tests stay regardless. Aim: PR open by Wednesday midday.

### Q21. Names
**Decision:** the change is `add-volunteer-roster-records`, with a new `volunteer-roster` capability. The rest of #138 keeps `add-volunteer-roster`.

## Promotion criteria, as confirmed

1. Scope: Volunteers > Roster (table, search, role filter), Add and Edit, admin-only access, roster-command linking; roles and certificates recorded only. Everything else in #138 is out.
2. Design choices made. Open: how the browser test is kept clear of the story's time limit (settled in the plan; affects only where the test lives).
3. Dependencies: local Supabase stack, roster command, migration 043 on `origin/main`, the user's Zoom setup — all ready. No hosted project or merged PR needed.
4. Acceptance: an admin can add and edit a volunteer and find them by search and role filter; existing staff appear with "No roles recorded"; a non-admin is refused on every new table and RPC and cannot read a volunteer with no sign-in; a roster run on a matching email links the existing record, and a renamed person no longer aborts a re-run; roles change no one's capabilities. Checks: `npm test`, `db:migrate:test` onto a stack at `main`'s migrations, `test:database`, `test:browser`, the new Roster browser test.
5. Converged.
