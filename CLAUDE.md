# CLAUDE.md

ViTally is a classroom demonstration of a VITA (Volunteer Income Tax Assistance) workflow for the PCDC community: client intake, volunteer preparation, independent review, office follow-up and assistance, with real email sign-in and shared state across browsers. Start with [README.md](README.md). The developer guide is [docs/developer/](docs/developer/README.md), and local setup is [docs/setup.md](docs/setup.md).

## Specs: where the source of truth lives

- **Canonical specs live in `openspec/specs/<capability>/spec.md`.** They describe the system's current, testable behaviour, one folder per capability.
- **Canonical specs start with the first change.** Nothing is back-filled. Each change proposes delta specs (`ADDED` / `MODIFIED` / `REMOVED`) for only the slice it touches, and archiving the change merges those deltas into `openspec/specs/`. The specs fill in as the work does.
- **Capabilities are named by feature area, in the words the team already uses.** Create a capability folder only when a change first needs it. Do not design the whole taxonomy up front. Likely examples: `client-intake`, `document-checklist`, `draft-13614c`, `staff-case-work`, `office-follow-up`, `review-and-corrections`, `sign-in`, `client-languages`.
- **Do not write specs for code you are not changing,** and do not bulk-convert old documents into specs. Such specs become large and stale, and nobody trusts them.

### Historical documents

- **`docs/superpowers/specs/` contains historical design documents.** Use them for design rationale and historical context only.
- **The same goes for `docs/superpowers/plans/`, `docs/superpowers/reviews/` and `docs/superpowers/notes/`.** They record how parts 1–4d were designed and built.
- **Do not remove, move or rewrite them, and do not write new documents under `docs/superpowers/`.** New design work and plans belong to an OpenSpec change (section 7 below).
- **When a change touches an area that a historical document covers,** read that document during `/opsx:explore`. Carry the behaviour that still holds into the change's delta specs as testable requirements.

### Authority order

When sources disagree, use this order:

1. Explicit user instructions for the current task
2. The active OpenSpec change artifacts, for the scope of that change
3. Canonical specifications under `openspec/specs/`
4. Current code and tests as implementation evidence
5. Historical documents under `docs/superpowers/`

Code or tests that disagree with a canonical specification indicate possible specification drift or an implementation defect. Do not silently change either side to match the other; surface the conflict.

If no canonical spec covers an area yet, the current code and tests are the reference for that area. The historical documents explain why it was built that way, but they do not override the code.

## Workflow routing (read at session start)

This repo uses [`superpowers-bridge`](https://github.com/JiangWay/openspec-schemas/tree/main/superpowers-bridge) to connect OpenSpec and Superpowers. It is the default schema (`openspec/config.yaml`). The schema is in `openspec/schemas/superpowers-bridge/`. Its README has the full rationale.

The schema's instructions, the Superpowers skills and this file all describe the workflow. If they disagree, follow this file.

### 0. Check the tools first

Before you start a change or implement anything, check that the workflow's tools are in place:
- **OpenSpec:** `npx openspec --version` runs (the CLI is a pinned dev dependency, so `npm ci` installs it), and the six `/opsx` commands (section 4) are in your available skills.
- **Superpowers:** these skills are in your available skills: `superpowers:brainstorming`, `superpowers:writing-plans`, `superpowers:using-git-worktrees`, `superpowers:subagent-driven-development` and `superpowers:finishing-a-development-branch`.
- **The schema:** `openspec/config.yaml` says `schema: superpowers-bridge`, and `openspec schema which superpowers-bridge` resolves it from the project (`openspec/schemas/superpowers-bridge/`).

If any of these is missing, do not start implementing. Tell the user what is missing and suggest how to install it: the [OpenSpec](https://github.com/Fission-AI/OpenSpec) README for OpenSpec and its commands, the [Superpowers](https://github.com/obra/superpowers) README for the plugin, and the [`superpowers-bridge` README](https://github.com/JiangWay/openspec-schemas/tree/main/superpowers-bridge) for the schema. Do not install them yourself, and do not change the schema setting. Wait until the user has installed them.

### 1. Decide: change or direct PR

Open a change for:
- a new capability;
- a change to behavior or to a contract;
- an architecture change;
- a database schema change;
- a change to the RPCs, row-level security policies or realtime messages between the database and the browser;
- a change to the question catalogue, the document map or other values that change what clients are asked or what staff see;
- an upgrade of Supabase (the CLI, the local stack, or `@supabase/supabase-js`), `pdf-lib` or `opencc-js`;
- a cross-system integration;
- a breaking change;
- a compliance boundary, for example who can see a client's data.

Use a direct PR only when the work keeps the intended behavior and is one of these:
- a bug fix with no contract change;
- a test backfill;
- a linter or build-tool tweak;
- a non-breaking upgrade of any other dependency;
- a typo or documentation update;
- a wording fix in client text or catalogue text that keeps its meaning, for example from the group's wording review;
- a config value tweak that does not change what clients or staff see or can do, for example a port number or a local path.

If you are not sure, ask the user.

### 2. Lifecycle of a change

Do the steps in this order. The schema's apply instruction also lists verify, retrospective, archive and finish steps, and subagent-driven development ends with its own finish. Do them as steps 6 to 9 below, not as part of apply.

1. **Explore (optional).** Run `/opsx:explore`. If the change touches an area that a historical document covers, read that document now.
2. **Brainstorm in the conversation.** Follow the method of `superpowers:brainstorming`: ask questions, compare alternatives, and get the user's approval of the design. Do not invoke the skill in this step, and do not write files. Propose invokes the skill in step 3. Continue until all 5 promotion criteria hold (section 6). Then ask: "Ready to `/opsx:propose`?" Wait for the user to agree. Never start propose without that agreement.
3. **Propose.** Run `/opsx:propose <change-name>`. It creates `openspec/changes/<change-name>/` and every artifact that apply needs, in this order: `brainstorm.md`; `proposal.md` and `design.md`; `specs/<capability>/spec.md`; `tasks.md`; `plan.md`.
   - `brainstorm.md` records the design that the user agreed to in step 2. Do not ask again about decisions settled in step 2.
   - The schema runs `superpowers:brainstorming` for `brainstorm.md` and `superpowers:writing-plans` for `plan.md`. Both write into the change folder (section 7). If a skill tries to write outside the change folder, or to start another skill before its turn, stop it. Continue in the artifact order above.
   - Propose can stop to ask the user a question. Answer it, then continue.
   - Propose never starts apply.
4. **Complete the planning artifacts.** If propose stops before `plan.md` is done:
   - Run `openspec status --change "<change-name>" --json` to find the next ready artifact.
   - Run `openspec instructions <artifact> --change "<change-name>" --json` to get its rules and template.
   - Write the artifact. Repeat until `plan.md` is done.

   Then ask the user to review the planning artifacts. Do not start apply until the user agrees.

   When the user agrees, commit the change folder. Commit it on a branch, not on `main`. If the current branch is `main`, create a branch first. Apply creates its worktree from this commit, so the commit must contain `plan.md`.
5. **Apply.** Run `/opsx:apply <change-name>`. It creates a git worktree and runs `plan.md` with subagent-driven development. It checks off `tasks.md`. Do steps 6 to 9 in the same worktree.
   - Every apply works in a worktree, so `superpowers:using-git-worktrees` does not need to ask whether to create one.
   - When subagent-driven development reaches its own finish, list the rulings it asks for, but do not delete its workspace and do not start `superpowers:finishing-a-development-branch`. Step 7 needs the ledger, and step 9 finishes the branch.
6. **Verify.** `openspec status` shows `verify` as ready once `plan.md` exists. Do not write it before apply is complete.
   - Get the rules with `openspec instructions verify --change "<change-name>" --json`.
   - Follow its PRECHECK and all of its checks. The `openspec-verify-change` skill is not installed, so do its checks directly.
   - Write `verify.md`. If a blocking check fails, fix the problem and verify again.
7. **Retrospective.** Get the rules with `openspec instructions retrospective --change "<change-name>" --json`. Write `retrospective.md`. Include the summary of the ledger findings (section 7, last bullet). Then delete the subagent-driven development workspace.
8. **Archive.** Merge `main` into the change branch, so that archive merges the delta specs into the latest `openspec/specs/`. If the merge has conflicts in `openspec/specs/`, stop and show them to the user. Then run `/opsx:archive <change-name>`. It merges the delta specs into `openspec/specs/` and moves the folder to `openspec/changes/archive/YYYY-MM-DD-<change-name>/`.
9. **Finish.** Use `superpowers:finishing-a-development-branch`. When it offers choices, choose to push the branch and create a PR, unless the user asks for a different choice. Open the PR last, so that it contains the complete archived change. Never merge the PR yourself.

### 3. Resume a change

At the start of a session, or when the user is in the middle of a change:
1. Run `git worktree list`. If the change has a worktree, run all the commands below in that worktree. After apply starts, the main checkout does not show the current state of the change.
2. Run `openspec list` to find active changes.
3. Run `openspec status --change "<change-name>" --json`.
4. Read the change's artifacts. If apply has started, read its ledger too (section 7).
5. Judge whether apply is complete from the `tasks.md` checkboxes and the commits on the change branch. Do not judge it from `openspec status`.
6. Continue from the first lifecycle step that is not complete. Do not create a new change for the same work.

### 4. Commands

This project installs six OpenSpec commands: `/opsx:propose`, `/opsx:explore`, `/opsx:apply`, `/opsx:update`, `/opsx:sync` and `/opsx:archive`.

Use `/opsx:sync` and `/opsx:update` only when the user asks.
- `/opsx:sync` merges delta specs into `openspec/specs/` before archive, which conflicts with step 8.
- `/opsx:update` revises a change's planning artifacts. Suggest it when the user changes a decision after propose, or when an artifact no longer agrees with the others.

The bridge README uses four commands that are not installed. Use these replacements:

| README command   | Use instead |
|------------------|-------------|
| `/opsx:new`      | `/opsx:propose` |
| `/opsx:ff`       | `/opsx:propose` |
| `/opsx:continue` | `openspec status` and `openspec instructions` (lifecycle steps 4 and 7) |
| `/opsx:verify`   | `openspec instructions verify` (lifecycle step 6) |

Do not run `openspec config profile`. It changes each developer's global OpenSpec config (decision 2026-10-05).

### 5. Change names and scope

- Name a change in kebab-case, starting with a verb, for example `add-office-follow-up-reminders`. Do not add a date. Archive adds it.
- One change has one clear result. If an architecture change is too large, split it into several changes.
- Write delta specs only for the capabilities that the change touches.

### 6. Promotion criteria (verbal brainstorm → propose)

All 5 must hold before you suggest propose. If one is missing, continue to brainstorm.

If the user asks to propose before all 5 hold, tell the user which criteria are missing. Then do what the user decides.

1. **Scope is fixed.** One sentence states what is in the change and what is out.
2. **Major design choices are made.** You compared the alternatives and chose one. Each open question has an owner and a statement of what it can affect.
3. **Dependencies on other systems are known.** Mark each dependency as ready, mockable, or unknown.
4. **Acceptance criteria are clear.** You can state concrete pass conditions: the deliverables of the change, plus the checks that cover what it touches (Project rules, Verification).
5. **The conversation converges.** The last turns confirm decisions. They do not add new alternatives.

### 7. Where the output goes

Durable output goes into the change folder, `openspec/changes/<change-name>/`. That includes the brainstorm and the plan.

- The `superpowers:brainstorming` and `superpowers:writing-plans` skills default to `docs/superpowers/`. In a change, redirect them to `brainstorm.md` and `plan.md`.

Working notes from apply are scratch:
- Subagent-driven development keeps its ledger (`progress.md`), task briefs, reports and review packages in `.superpowers/sdd/plan/` inside the change's worktree. The folder is named after `plan.md`. `.superpowers/` is in `.gitignore`; keep it there.
- Never commit these files. Never copy them into the change folder or `docs/superpowers/`.
- Every change's plan file is named `plan.md`, so all changes share the folder name `plan`. Run apply for one change per worktree. If the ledger's first line names another change's `plan.md`, stop and ask the user.
- The ledger does not survive the change: it is never committed, and step 7 deletes it. Before that, in step 7, write a summary in `retrospective.md` of every ruling, parked finding and deferred minor finding that the ledger records. Do not copy the ledger files.

## Project rules

- **Data and branding:**
  - Use fictional data only, in code, tests, fixtures and screenshots.
  - Never substitute, redraw or generate PCDC logos (`src/pcdc-logo.png`).
- **Database:**
  - Migrations in `supabase/migrations/` are hand-written and final once applied. Never edit an applied migration; add a new one.
  - Changes to the question catalogue go through `docs/intake-questions/` and `npm run build:intake`, which writes a new catalogue migration when the catalogue changes.
- **Local test stack:**
  - It runs from its own work directory (`$VITALLY_STACK`; see [docs/setup.md](docs/setup.md)).
  - Never run `supabase start` from the repo root.
- **Versions:** version 2 is the only intake version (migration 023). Workspaces and applications accept no other value.
- **Client text:**
  - Screen text lives in `src/client-text.mjs` (English and 简体), and catalogue text in the catalogue.
  - 繁體 is generated: after any 简体 change, run `npm run build:hant` and commit `src/zh-hant.mjs`.
  - Staff screens stay English.
- **Verification:** run the checks that cover what the change touches, not every suite every time.
  - **Always:** `npm test` (unit).
  - **Migrations, SQL functions or other database behaviour:** `npm run db:migrate:test`, then `npm run test:database`.
  - **Sign-in:** `npm run test:auth-browser`.
  - **Anything a browser shows or does** (views, `app.mjs`, the controller, CSS, the story): `npm run test:browser` (Playwright, about 20–25 minutes locally).
  - **Client text in Chinese:** `npm run build:hant -- --check`.
  - **Server-only changes** (for example `server.mjs` or `tools/`): their unit tests, plus any suite whose behaviour they reach.
  - Say which checks you ran and why the others weren't needed.
  - **CI** (`.github/workflows/ci.yml`) runs on every pull request, every push to `main`, and on demand:
    - `checks`: `npm test`, `npm run build:hant -- --check`, a check that `npm run build:intake` leaves nothing to commit, and `npx openspec validate --all`. It is the only job `main` requires.
    - `database`, `sign-in` and `story` (two legs, one per browser order): each starts a fresh local Supabase stack, applies the migrations, and runs `npm run test:database`, `npm run test:auth-browser` or the story, in New York time.
  - **A passing CI run can stand in for the local database, sign-in and story runs** when all of these hold:
    - it ran on the commit you are verifying: the pull request's run, or `gh workflow run ci.yml --ref <branch>` on a pushed branch;
    - every job that covers the change passed. A skipped or cancelled job doesn't count. A job that passes on a re-run counts, but say that it failed first;
    - you link the run wherever you say which checks you ran (the PR body, `verify.md`), and review the story's screenshots from the run's artifacts (kept 7 days).
  - **CI starts from an empty database.** A migration that changes existing rows still needs a local `npm run db:migrate:test` and `npm run test:database` on a stack that already has `main`'s migrations.
- **Git:**
  - Teammates merge into `main`, so sync with `main` before pushing.
  - Leave the untracked `VITA-Management-System-Demo/` directory, `.claude/worktrees/` and `.stitch/captures` alone.
