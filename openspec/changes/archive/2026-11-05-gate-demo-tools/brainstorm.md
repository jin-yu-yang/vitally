# Brainstorm: gate-demo-tools

Decision log from the verbal brainstorm (2026-11-05), recorded at propose. The user accepted all nine recommendations; they are not reopened here. A **builder's call** marks a choice the conversation left to the builder.

## Background

This is step 4 of the presenter-mode removal series. It doesn't depend on steps 1 to 3.

ViTally has three controls that fill a form with fictional data:

| Tool | Where | Shown to today | Gated by |
|---|---|---|---|
| "Auto-fill fictional data" (#117, `src/demo-fill.mjs`) | 4 office dialogs (`admin-views.mjs`) and 4 staff case forms (`staff-views.mjs`) | presenter only | `demoFillButton(principal)`, plus a presenter check in the `demo-fill` handler (`app.mjs`) |
| Client fiction toolbar: "Fill fictional details", "Generate another example", the "Fictional data only" chip (`client-views.mjs` `fictionTools`) | the client intake form | **every client, always** | nothing |
| "Fill fictional details" pill (`office-views.mjs` `renderAddCaseV2`, `ui.demoTools`) | the office's Add a case | presenter only | `views.mjs` sets `demoTools: state.principal?.access === "presenter"`, plus a presenter check in `fillAssistedIntake` (`app.mjs`) |

Two problems follow:
- **Presenter removal breaks the staff tools.** Once presenter mode is removed (steps 5 and 7), the staff and office tools would disappear for everyone, including rehearsals.
- **The client toolbar is shown to everyone.** A real client in production would see a button that fills their tax intake with made-up data.

`server.mjs`'s `publicConfig(env)` returns exactly four keys (`configured`, `supabaseUrl`, `supabasePublishableKey`, `authResendCooldownSeconds`), and `app.mjs` fetches them from `/public-config.json`. No `public-config*.json` file is committed today. The browser test fixture starts `createAppServer` in-process with its own `env`.

## Decisions

**D1. One switch for all three tools.** All three controls are shown only when the public config says `demoTools: true`. That covers the client's whole fiction toolbar, including "Generate another example" and the "Fictional data only" chip, and the office's assisted-intake pill. A real client must never see a fill-with-fictional-data button.

**D2. Who sees them when the switch is on.** Anyone who is on the screen the control lives on: clients for the client toolbar, and presenter or staff for the staff and office tools. The presenter-only rule is replaced by the switch, so with the switch off even a presenter has none of them. Nothing is lost in practice: there's no hosted project, and presenter mode is being removed.

**D3. The handlers check the switch too.** The `demo-fill`, `fill-fictional`, `regenerate-fictional`, `confirm-regenerate` and `fill-assisted-intake` actions do nothing unless the switch is on, as today's presenter checks do. A button injected into the page can't fill a form.

**D4. The server-side flag.** `VITALLY_DEMO_TOOLS=1` in `.env.local`. Any other value, or no value, means off. `.env.example` gets a commented line explaining it.

**D5. The server sends the key only on a loopback project.** `server.mjs` puts `demoTools: true` in the public config only when `VITALLY_DEMO_TOOLS=1` **and** the `SUPABASE_URL` host is loopback (`127.0.0.1`, `localhost` or `::1`). If the flag is set but the URL isn't loopback, it leaves the key out and prints a one-line warning at start-up, without the URL.

**D6. The key appears only when on.** When the switch is off, `demoTools` is absent from the config, so a production config stays exactly what it is today. The public-config contract in `docs/developer/backend.md` and the "four documented keys" test in `tests/server.test.mjs` change to allow this one optional fifth key.

**D7. A second loopback check in the browser.** `app.mjs` treats the switch as on only when `config.demoTools === true` **and** `config.supabaseUrl` is loopback. A mistakenly committed or hosted config carrying the flag still shows nothing.

**D8. Tests:**
- **Unit:**
  - each of the three tools rendered with the switch on and off;
  - the handlers refusing with it off;
  - `publicConfig` across flag and URL combinations;
  - the browser-side loopback rule;
  - a scan that fails if any tracked `public-config*.json` file contains `demoTools`.
- **Browser:** the browser test server sets `VITALLY_DEMO_TOOLS=1`, because the story uses the client fill. No new browser scenario.

**D9. Specs.** A new capability, `demo-tools`, holds the single rule, the config contract and the two loopback checks. `client-intake` keeps its "Fill fictional details" scenarios unchanged (the fill leaves consent to the client), since they still hold with the switch on. #117's Auto-fill has no spec today, so nothing else is modified.

## Builder's calls

- **One loopback helper, shared.** A small `src/loopback.mjs` exports `isLoopbackUrl(url)`, used by both `server.mjs` and `app.mjs`, so the two checks can't disagree. `server.mjs` may import from `src/`, but it still must not import admin tooling. The file is served to the browser like every other `src/<name>.mjs`.
- **The switch reaches the views through the controller.** `app.mjs` computes it once and passes `demoTools` to `createController`, which exposes it as `state.demoTools`. Views read `state.demoTools` (or `ui.demoTools`). `demoFillButton` takes a boolean instead of the principal.
- **The browser fixture refuses a non-loopback target.** Settled after the design check. The browser story needs the client fill, and D5/D7 switch the tools off for a hosted test target (`VITALLY_TEST_MODE=hosted`). So the browser fixture fails at set-up with a clear message when the target URL isn't loopback, instead of timing out on a missing button. Hosted test runs aren't used today (`docs/setup.md`: hosted testing only "if later chosen").
- **A consequence of D5 and D7, recorded, not a new decision.** The planned hosted classroom project and the GitHub Pages copy (`docs/developer/backend.md`, Environments) will never show any fill tool, because their Supabase URL isn't loopback. `docs/setup.md` §6 ("Classroom and hosted setup") says so. Classroom demos type their answers, or are run from a local stack.
- **The existing name is reused.** `renderAddCaseV2` already has `ui.demoTools`. `views.mjs` sets it from `state.demoTools` instead of the presenter check.

## Goals, non-goals, anti-goals

**Goals:**
- Fill tools work for rehearsals and the browser story whoever is signed in.
- They're impossible to switch on against a hosted project.

**Non-goals:**
- Removing presenter screens or access (steps 5 and 7).
- The other demo-only parts: simulated upload failure, the fixed file name, tick-box intake checks, simulated reminders.
- Any text change.

**Anti-goals, which would make this a failure even if it works:**
- A fill button or chip visible to a client on a hosted project.
- The flag leaking into a committed config.
- A production config that differs in any way from today's.

## Constraints

- No client text changes. The chip and button texts stay as they are, so `src/zh-hant.mjs` is unchanged.
- No database change.
- Fictional data only.
- LF line endings.

## Acceptance and checks

- **Run:**
  - `npm test`;
  - `npm run test:browser`, because views, `app.mjs` and the controller change;
  - `npm run build:hant -- --check`, as a safety net.
- **Not needed:** `test:database` and `test:auth-browser`. There's no database or sign-in change.
- **Docs:**
  - `docs/setup.md`: the line to add to `.env.local` for rehearsals;
  - `docs/developer/backend.md`: the public config contract.
