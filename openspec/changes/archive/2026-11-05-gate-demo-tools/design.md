## Context

The three fictional-fill controls, and how they're gated today:
- **Staff "Auto-fill fictional data"** (`src/demo-fill.mjs`). It's used by 4 office dialogs in `admin-views.mjs` and 4 staff case forms in `staff-views.mjs`. Gated by `demoFillButton(principal)` (presenter only) and a presenter check in `app.mjs`'s `demo-fill` handler.
- **The client fiction toolbar** (`client-views.mjs` `fictionTools`): "Fill fictional details", "Generate another example", and the "Fictional data only" chip. Always shown to every client on the draft intake. Handlers `fill-fictional`, `regenerate-fictional` and `confirm-regenerate` in `app.mjs`.
- **The office's assisted-intake pill** (`office-views.mjs` `renderAddCaseV2`, `ui.demoTools`). `views.mjs:393` sets `demoTools: state.principal?.access === "presenter"`, and `fillAssistedIntake` in `app.mjs` checks for a presenter again.

The public config:
- **Shape:** `server.mjs` `publicConfig(env)` returns `{configured:false}` or exactly four keys.
- **How it's read:** `app.mjs` fetches `./public-config.json` and passes the cooldown to `createController`.
- **What's committed:** no `public-config*.json` file.
- **In tests:** the browser fixture runs `createAppServer({ env })` in-process, against the guarded test target.

Constraints:
- No client text changes.
- No database change.
- `server.mjs` serves only an allowlist and must never expose private values.
- Staff screens stay English.

## Goals / Non-Goals

**Goals:**
- One switch, `demoTools`, shows and enables all three controls for whoever is on their screen.
- The switch can be on only when both the server and the browser agree the Supabase project is local (loopback).
- A production config is byte-for-byte unchanged.
- A committed config can never carry the switch without a test failing.

**Non-Goals:**
- Removing presenter screens or access.
- Any other demo-only part (simulated upload failure, the fixed file name, tick-box intake checks, simulated reminders).
- New text.
- A browser scenario for the switch-off case. Unit tests cover it.

## Decisions

### D1: One `demoTools` switch for all three controls, replacing the presenter checks
- **Choice:**
  - Every place that rendered a fill control behind a presenter check, or behind nothing in the client's case, renders it only when the switch is on.
  - Every fill handler (`demo-fill`, `fill-fictional`, `regenerate-fictional`, `confirm-regenerate`, `fill-assisted-intake`) returns without doing anything when it's off.
  - When the switch is on, the role doesn't matter: whoever is on the screen sees the control.
- **Why:** The user's rule is "a real client must never see a fill-with-fictional-data button". Presenter removal would otherwise take the staff tools away from rehearsals. Checking the switch in the handlers too keeps today's two layers.
- **Alternative considered:** keep the presenter checks and add the switch. Rejected: the presenter is going away, and the client toolbar has no role to check.

### D2: The server sets it only from an explicit flag, on a loopback project
- **Choice:**
  - `publicConfig(env)` adds `demoTools: true` only when `env.VITALLY_DEMO_TOOLS === "1"` and `isLoopbackUrl(SUPABASE_URL)`. Otherwise the key is absent.
  - When the flag is `"1"` but the URL isn't loopback, `createAppServer` prints once, at start-up: `VITALLY_DEMO_TOOLS is ignored: the Supabase URL is not on this machine.`, without the URL.
- **Why:** Opting in is explicit, and it's impossible against a hosted project. Leaving the key out when off keeps production configs identical to today's.
- **Alternatives considered:**
  - Always sending a boolean. Rejected: it changes every config.
  - Refusing to start. Rejected: too harsh for a mistyped development setting.

### D3: The browser checks loopback too
- **Choice:** `app.mjs` computes `demoTools = config.demoTools === true && isLoopbackUrl(config.supabaseUrl)` once, and passes it to `createController({ demoTools })`. The controller exposes it as `state.demoTools`, and views and handlers read only that.
- **Why:** A static host serves a committed `public-config.json`, not `server.mjs`. If a config carrying the flag were ever published for a hosted project, the browser still shows nothing.
- **Alternative considered:** trust the server alone. Rejected: the static-host path doesn't go through `server.mjs`.

### D4: One shared loopback helper
- **Choice:** `src/loopback.mjs` exports `isLoopbackUrl(value: string): boolean`. It returns true for an `http:` or `https:` URL whose host is `127.0.0.1`, `localhost` or `[::1]`, and false for anything else, including unparsable input. It's imported by `server.mjs` and `app.mjs`.
- **Why:** The two checks can't drift apart. `server.mjs` already reads files under `src/`. Importing a pure helper from there doesn't pull in admin tooling, which still must not be imported.
- **Alternative considered:** a copy in each place. Rejected: two copies can disagree.

### D5: Rendering through state
- **Choice:**
  - `demoFillButton(enabled: boolean)` replaces `demoFillButton(principal)`. Callers pass `state.demoTools`, or `ui.demoTools` as views already thread `ui`.
  - `intakeScreen` passes `fictionalTools` only when `state.demoTools`, and an empty string otherwise.
  - `views.mjs` sets `demoTools: state.demoTools === true` for `renderAddCaseV2`.
- **Why:** These are the smallest edits to the existing seams, and they're testable in node.

### D6: Guards in tests
- **Choice:**
  - A unit test lists tracked files (`git ls-files`) matching `public-config*.json` and fails if any contains `"demoTools"`. It passes trivially today, when there are none.
  - `tests/support/browser-fixture.mjs` sets `VITALLY_DEMO_TOOLS: "1"` in the server env. It throws at set-up with `The browser story needs a local (loopback) Supabase test target for the demo tools.` when `target.apiUrl` isn't loopback.
- **Why:** The committed-config guard is what the user asked for. The fixture message turns a confusing missing-button timeout into a clear set-up error.

## Risks / Trade-offs

- **[Risk]** A view or handler is missed and still shows or acts without the switch.
  → Mitigation: unit tests render each of the eight Auto-fill sites, the client toolbar and the office pill with the switch off and on. A handler test (in `controller.test.mjs` or `shell.test.mjs`, wherever the handlers are tested today) proves each of the five actions does nothing when off.
- **[Risk]** A developer sets the flag but points `.env.local` at a hosted project and wonders why nothing shows.
  → Mitigation: the start-up warning (D2) and the `docs/setup.md` line.
- **[Trade-off]** The planned hosted classroom project and the GitHub Pages copy will never show fill tools.
  → Accepted as a direct consequence of the loopback rule. `docs/setup.md` §6 says so.
- **[Trade-off]** Presenters on a stack without the flag lose the staff and office fills before presenter removal.
  → Accepted. Rehearsal stacks set the flag.

## Migration Plan

No deployment. A developer adds `VITALLY_DEMO_TOOLS=1` to `.env.local` to keep the fill tools when rehearsing locally. Rollback is reverting the PR.

## Open Questions

None.
