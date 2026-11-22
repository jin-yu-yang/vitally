# Verification Report

> The `openspec-verify-change` skill is not installed in this repository, so the controller ran its PRECHECK and checks directly (CLAUDE.md, lifecycle step 6).

**Change**: `add-my-profile`
**Verified at**: `2026-11-22` (America/New_York)
**Verifier**: Claude Opus 5.5 (subagent-driven-development controller)

PRECHECK:
- commits on the branch since `origin/main` (4ab301e, which carries #245's 056): 29 at 4d8c26f;
- ticked tasks in `tasks.md`: 23.

Both are positive.

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`.

**Result**:

```text
23 items, 0 invalid (1 change, 22 specs). Warnings only: long requirement texts, as elsewhere in the repo.
```

| Item | Type | Issues |
|---|---|---|
| — | — | none |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (23/23).

| Task | Why not done | Blocks archive? |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

Archive merges the deltas (lifecycle step 8). Nothing is synced before then, by design. #245 changed none of these three capabilities.

| Capability | Sync state | Note |
|---|---|---|
| my-profile | ✗ needs sync | new capability, ADDED 7: the caller's own read and save (both refuse an invited account before the site check), revision and receipt, the sidebar link, the office's records read-only, editing details, sending a new Form 13615 |
| volunteer-clearance | ✗ needs sync | MODIFIED 2: the clearance answer carries `reviewedAt`/`reviewReason` and withholds `uploadUrl` while `siteCheck`; sending again clears the review. ADDED 1: the setup screen says why a document came back |
| volunteer-roster | ✗ needs sync | MODIFIED 3: Mark reviewed requires a reason; its refusals; the drawer's reason row and "Last returned". ADDED 2: a save clears the review it acts on; usual days |

---

## 4. Design / Specs Coherence Spot Check

| Sample | design | specs | Gap |
|---|---|---|---|
| D1/D2 caller-only RPCs | read and save answer only for the caller; refused FORBIDDEN while the account is invited, before any other check, no receipt | my-profile read and save requirements, each with "An invited account before the site check" | none |
| D3 review pair | reviewed time + reason per document; cleared by sending again and by an admin save under 053's sent-date conditions | volunteer-clearance "can be repeated…", volunteer-roster "A save clears the review it acts on" | none |
| D6 Mark reviewed | five arguments, reason trimmed 1–120, admin check first, old signature dropped | volunteer-roster Mark reviewed requirements, "The four-argument call" scenario | none |
| D7/R1 quick picks | 13615: four + "Already on file" with a role; photo ID: "Can't read it", "Expired", "Not a photo ID" | volunteer-roster drawer requirement and "Photo ID quick picks" | none |
| D8/R5 lines | already-on-file line only for a 13615 with that exact reason | volunteer-clearance setup-screen requirement and the photo ID scenario | none |
| D9/R3 sidebar | "My profile" with the name as a second line, cleared only | my-profile sidebar requirement | none |

**Drift warnings** (non-blocking):
- Added after the final review, at the user's decision (Nov 22): the invited-account refusal in D1/D2 and both read/save requirements. Design, specs, migration, tests and docs were all updated together.
- Added at the final review: design.md's Risks now say that every Roster Save and Add a volunteer fails between the merge and hosted running 057 (the drawer always sends `usualDays`; 053's save refuses an eleventh key).

---

## 5. Implementation Signal

- [x] The worktree has no unstaged files (checked at 4d8c26f).
- [ ] Every relevant commit is pushed. The code and the merge are pushed at 4d8c26f. This report, the retrospective and the archive are pushed with the PR at lifecycle step 9.

**Commit range**: `601b650..4d8c26f`, including the merge of `main` (4ab301e, #245). Migration: `supabase/migrations/057_my_profile.sql`. It adds columns with defaults and replaces functions, and rewrites no existing rows, so CI's empty-database run covers it.

**Checks run and why**:
- **`npm test`** (always): 2322/2322 locally on the merged tree, and CI `checks` 2322 (main 4ab301e: 2270).
- **`build:hant -- --check`**: locally and CI `checks`. No client text changed (staff screens only).
- **`openspec validate --all`**: locally (section 1) and CI `checks`.
- **Database** (057: new columns, four replaced functions, two new RPCs): no local stack, at the user's instruction. While iterating, quick runs went through `database-quick.yml` (44972563864, 44973121117, 44974116281, 44974620915, 44985875245). Final check: CI `database` passed **907/907** (main 4ab301e, run 44984606706: 866).
- **Sign-in** (the account row and the clearance gate): CI `sign-in` passed 28/28.
- **Browser** (views, controller, `app.mjs`, CSS, the drawer, a new screen test): CI story legs, below.

**CI evidence**: run [44989061530](https://github.com/jin-yu-yang/vitally/actions/runs/44989061530) on the merged commit `4d8c26f`.
- **Jobs:** `checks`, `database`, `sign-in`, `story (chrome-client)` and `story (firefox-client)` all succeeded on the first attempt.
- **Earlier failure on this branch:** run 44980299716 on 1d77d77 failed the new test's last step in the firefox leg ("Enter in the note dropped the typed phone"). The cause was the test: the drawer moves focus to its first field on the next animation frame, and the test typed the phone before that, so the keys could land in the name field. It was fixed in the test (308d9b6; `openDrawer` waits for focus inside the drawer, and step 7 asserts both fields right after typing). The acceptance rule was fixed before the rerun: run 44982172310 was green on every job, and a rerun of its firefox story job was green too. No assertion was weakened. Issue #254 (an earlier intermittent "Mark reviewed dropped the typed phone" in the uploads test) has the same symptom; this diagnosis is a lead for it, not a fix.
- **Story legs:**
  - chrome-client: 720 s; firefox-client: 721 s (main: 702 s and 694 s). The limit is 900 s.
  - browser tests per leg went from 52 to 53. The added test is "A volunteer edits My profile and re-sends a Form 13615": 14.7 s and 16.1 s, marks `1 opened` … `7 sent back by Enter` at about 12 s. "A volunteer says their uploads were sent, and an admin reviews them" was extended (a reason on Send back, the setup screen's reason line): 12.6 s and 14.4 s. None was removed.
- **Screenshots** (from the run's artifacts, chrome-client): the new and extended tests take none. The sidebar's account row shows in existing shots:
  - `chrome-client-firefox-staff--staff-board-eight-cases-720`: a cleared Preparer's row reads "My profile" with "Taylor Brooks" on the smaller second line;
  - `posted-updates-setup-720`: an uncleared volunteer's row stays "Signed in as Jordan Vale".

  The names are fictional fixture data.

**Hosted step** (right after merging, and after 056 is on hosted): `node --env-file=.env.admin tools/admin/migrate.mjs --target classroom` (with `NODE_EXTRA_CA_CERTS`) applies 057. Until it runs, the new RPCs fail, and so do Roster Save and Add a volunteer.

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md 2>/dev/null
```

- [x] The 8 files there are historical design documents from before the schema. This change added none.

| File | Captured in the change? | Action |
|---|---|---|
| — | — | none |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no `[~]` rows, so this section is empty.

---

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS:
  - there was no local database or browser run, at the user's instruction; CI's `database` (907/907) and both story legs on the merged commit stand in for them;
  - one intermittent failure of the new test was diagnosed as test timing and fixed in the test, under an acceptance rule set in advance;
  - the deploy needs 057 on hosted right after the merge (Roster Save and Add a volunteer fail until then).
- [ ] ❌ FAIL

**Next step**: retrospective (lifecycle step 7), then archive.
