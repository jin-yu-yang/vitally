## Why

Presenter mode is being removed in small steps. Its "Reset sample cases" tool is how rehearsals and the browser story get known cases today, and a later step removes it. This change gives the local test stack a replacement first: one command that fills a workspace with fictional cases at known stages. It builds them through the product's own RPCs, acting as role-named staff accounts. Nothing it creates can bypass the case rules, and the command can never run against a hosted project.

## What Changes

**A local seed command (new)**
- `npm run seed:local` fills the rehearsal workspace named in the local roster file with:
  - client A's one just-submitted case;
  - ten office-entered scenario cases, from "ready for preparation" to "accepted", "on hold" and "withdrawn";
  - one open help request.
- It refuses unless the target is the **local** test stack and `VITALLY_ALLOW_LOCAL_SEED=1` is set. A hosted test project is refused too.
- It builds every case by calling the public RPCs as the Site Coordinator, Preparer, Reviewer and client A accounts. Each case is held by the account its stage needs.
- Running it again deletes the previous run's cases (ids kept under `.vitally-runs/`) and seeds a fresh set.
- It never prints an email address.
- An importable module does the same work for the database tests and, later, the browser story.

**The example rehearsal roster**
- From: one presenter, one example staff member (Riley Park, preparer), clients A and B.
- To: the presenter (until a later step removes it), four role-named staff accounts (Site Coordinator, Preparer, Reviewer, Intaker), with the Site Coordinator as the default follow-up person, and client A only.
- Reason: test and rehearsal accounts are named by role, and the seed acts as them.
- Impact: non-breaking. An existing local roster keeps working, and re-running the roster command adds the new accounts.

**Docs:** `docs/setup.md` (rehearsal accounts, seeding, reload after re-seeding) and `docs/developer/backend.md` (privileged tooling).

Out of scope, in other steps:
- removing the sample-case tools;
- changing the browser story;
- a full fictional season for analytics;
- any presenter removal.

There is no migration and no change to what clients or staff see.

## Capabilities

### New Capabilities
- `local-seed-data`: the local-only seed command and module. It covers:
  - the guard, local test stack plus an explicit flag;
  - the seeded set and who holds each case;
  - building through the public RPCs;
  - replacing the previous run;
  - never printing an address.

### Modified Capabilities
_None._ The roster command's rules (`sign-in`) don't change. Only the example file and docs do.

## Impact

- **New code:** `tools/admin/seed.mjs` (command) and a seed module beside it. A new `npm` script, `seed:local`.
- **Changed files:**
  - `tools/admin/roster.example.json`;
  - `docs/setup.md`;
  - `docs/developer/backend.md`.
- **Tests:** a unit test for arguments and the guard, and a new database suite that seeds a throwaway workspace twice. It builds on the role-named fixture accounts from the preceding tests-only PR.
- **Dependencies:** none new. It uses `pg`, `@supabase/supabase-js` and the existing target guard.
- **Systems:** the local Supabase test stack only. Hosted projects can't be reached by design.
- **Issue:** #131, part of tracking issue #128.
