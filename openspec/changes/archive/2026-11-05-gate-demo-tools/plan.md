# Gate demo tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show and enable all three fictional-fill controls (staff Auto-fill, client fiction toolbar, office assisted-intake pill) only when a `demoTools` switch is on. The server sets the switch only from `VITALLY_DEMO_TOOLS=1` with a loopback Supabase URL, and the browser re-checks loopback.

**Architecture:**
- **The loopback helper:** a pure `isLoopbackUrl` in `src/loopback.mjs`, shared by `server.mjs` (`publicConfig`) and `app.mjs`.
- **How the switch travels:** `app.mjs` computes the switch once and gives it to the controller as `state.demoTools`. Views render from it.
- **The handler guard:** a pure guard, `demoToolsOn(state)` in `src/demo-fill.mjs`, guards the five fill handlers.

**Tech Stack:**
- plain ES modules;
- Node 24 `node:test`;
- `server.mjs` (`node:http`);
- Playwright browser story (`tests/browser.mjs`), unchanged except for its fixture.

**Spec:**
- `openspec/changes/gate-demo-tools/specs/demo-tools/spec.md`
- design: `openspec/changes/gate-demo-tools/design.md`, decisions D1 to D6
- decision log: `openspec/changes/gate-demo-tools/brainstorm.md`

## Global Constraints

- The switch is on only when the server sent `demoTools: true` (the flag `VITALLY_DEMO_TOOLS` is `"1"` after the server's existing `trim`, and `SUPABASE_URL` is loopback) **and** the browser's `isLoopbackUrl(config.supabaseUrl)` is true.
- Loopback hosts: `127.0.0.1`, `localhost`, `[::1]`. Protocol `http:` or `https:`.
- **Config shape:** when the switch is off, `publicConfig` returns exactly what it does today, with no `demoTools` key.
- **Start-up warning text:** `VITALLY_DEMO_TOOLS is ignored: the Supabase URL is not on this machine.` It never includes the URL.
- **Browser fixture refusal text:** `The browser story needs a local (loopback) Supabase test target for the demo tools.`
- **Text:** no client text changes. `src/client-text.mjs` and `src/zh-hant.mjs` are untouched.
- **Out of bounds:** no database change. `server.mjs` never imports from `tools/`.
- **Line endings:** LF only.
- **Commits:** each ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A config whose `demoTools` is the string `"true"` or the number `1`** leaves the switch off: the check is strict `=== true`. Test in Task 2.
2. **Look-alike hosts** (`http://127.0.0.1.example.org`, `http://localhost.example.org`, `http://user@localhost.evil.test`) aren't loopback. Test in Task 1.
3. **The IPv6 form `http://[::1]:54321`** is loopback, and plain `::1` without brackets or a scheme isn't a URL, so false. Test in Task 1.
4. **The staff Auto-fill when signed out, or with no state** (`demoFillButton(undefined)`) renders nothing. Test in Task 3.
5. **A fill handler reached with the switch off** (an injected button) does nothing. This is pinned by the `demoToolsOn` unit test plus a source check that each of the five `case` branches in `app.mjs` calls it. Test in Task 4.

---

### Task 1: The loopback helper and the server's config

**Files:**
- Create: `src/loopback.mjs`
- Modify: `server.mjs` (`publicConfig` near line 57, the start-up block near line 113), `.env.example`
- Test: `tests/loopback.test.mjs` (new), `tests/server.test.mjs` (the "four documented keys" test near line 108)

**Interfaces:**
- Produces:
  - `isLoopbackUrl(value: unknown): boolean` from `src/loopback.mjs`. It uses `new URL(value)` in a `try`. True only for protocol `http:` or `https:` with `hostname` in `["127.0.0.1", "localhost", "[::1]"]`.
  - `publicConfig(env)` as today, plus `demoTools: true` when `value(env, "VITALLY_DEMO_TOOLS") === "1" && isLoopbackUrl(supabaseUrl)`.
  - `demoToolsIgnored(env): boolean` from `server.mjs`: the flag is `"1"`, the config is configured, and the URL isn't loopback. It's used to print the warning once when the server starts.

- [ ] **Step 1: Write the failing tests.**
  - `tests/loopback.test.mjs`, `"loopback URLs"`: true for `http://127.0.0.1:54321`, `http://localhost:54321`, `https://localhost`, `http://[::1]:54321`.
  - Same file: false for `https://abcd.supabase.co`, `http://127.0.0.1.example.org`, `http://localhost.example.org`, `http://user@localhost.evil.test`, `ftp://localhost`, `::1`, `""`, `undefined`, `42`.
  - `tests/server.test.mjs`: replace the four-key test with `"the public config carries the four documented keys, plus demoTools only when switched on locally"`. It asserts:
    - with `SUPABASE_URL: "http://127.0.0.1:54321"` and no flag, the sorted keys equal today's four;
    - with `VITALLY_DEMO_TOOLS: "1"`, the keys are those four plus `demoTools`, and `demoTools === true`;
    - with `VITALLY_DEMO_TOOLS: "true"` there's no `demoTools`;
    - with `VITALLY_DEMO_TOOLS: "1"` and `SUPABASE_URL: "https://abcd.supabase.co"`, there's no `demoTools`, and `demoToolsIgnored` returns true;
    - with the flag and no publishable key, the result is `{ configured: false }`.
- [ ] **Step 2: Run them to see them fail.** Run `node --test tests/loopback.test.mjs tests/server.test.mjs`. Expected: FAIL, the module is missing and there's no `demoTools` key.
- [ ] **Step 3: Implement it.**
  - `isLoopbackUrl` in `src/loopback.mjs`.
  - In `server.mjs`: import it from `./src/loopback.mjs`, extend `publicConfig`, and add `demoToolsIgnored`.
  - In the direct-run block, before `listen`: `if (demoToolsIgnored(process.env)) console.warn("VITALLY_DEMO_TOOLS is ignored: the Supabase URL is not on this machine.")`.
  - Update the comment above `publicConfig` that says "Exactly four keys".
  - Add to `.env.example`:

    ```
    # Optional, local rehearsals only. 1 shows the fictional-fill buttons (staff
    # Auto-fill, the client's "Fill fictional details", the office's assisted
    # intake fill). Ignored unless SUPABASE_URL is on this machine; never set it
    # for a hosted project.
    # VITALLY_DEMO_TOOLS=1
    ```
- [ ] **Step 4: Run them to see them pass.** The same command. Expected: PASS. Then run `npm test`; expected: all pass, including the existing test that no private value appears in a response.
- [ ] **Step 5: Commit.** "Demo tools: loopback helper and the demoTools key in the public config".

### Task 2: The browser computes the switch and the controller holds it

**Files:**
- Modify: `src/app.mjs` (around lines 118–145, where `createController` is called), `src/controller.mjs` (options near line 249, `state` near line 263, `getState` near line 2891)
- Modify: `src/demo-fill.mjs`
- Test: `tests/demo-fill.test.mjs`, `tests/controller.test.mjs`

**Interfaces:**
- Consumes: `isLoopbackUrl` (Task 1).
- Produces:
  - `demoToolsFromConfig(config: object | null): boolean` from `src/demo-fill.mjs`, defined as `config?.demoTools === true && isLoopbackUrl(config?.supabaseUrl)`.
  - `demoToolsOn(state: object | null): boolean` from `src/demo-fill.mjs`, defined as `state?.demoTools === true`.
  - `createController({ ..., demoTools = false })`. `getState().demoTools` is that boolean and never changes during a session.
  - `app.mjs` passes `demoTools: demoToolsFromConfig(config)`.

- [ ] **Step 1: Write the failing tests.**
  - `tests/demo-fill.test.mjs`, `"the switch needs demoTools true and a loopback Supabase URL"`. `demoToolsFromConfig` returns:
    - true for `{ demoTools: true, supabaseUrl: "http://localhost:54321" }`;
    - false for `{ demoTools: true, supabaseUrl: "https://abcd.supabase.co" }`, `{ demoTools: "true", supabaseUrl: "http://localhost:54321" }`, `{ demoTools: 1, supabaseUrl: "http://localhost:54321" }`, `{ supabaseUrl: "http://localhost:54321" }` and `null`.
  - Same file: `demoToolsOn({ demoTools: true })` is true, and `demoToolsOn({})` and `demoToolsOn(null)` are false.
  - `tests/controller.test.mjs`, `"the controller carries the demo-tools switch it was given"`: a controller built the way the file's existing helper builds one, with `demoTools: true`, has `getState().demoTools === true`. One built without the option has `false`.
- [ ] **Step 2: Run them to see them fail.** Run `node --test tests/demo-fill.test.mjs tests/controller.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement it.** The two functions in `demo-fill.mjs`, importing `isLoopbackUrl`. The `demoTools` option in `createController`, set on `state` and included in `getState()`. The `app.mjs` call.
- [ ] **Step 4: Run them to see them pass.** Expected: PASS.
- [ ] **Step 5: Commit.** "Demo tools: the browser's switch, in controller state".

### Task 3: Render the three controls from the switch

**Files:**
- Modify: `src/demo-fill.mjs` (`demoFillButton`), `src/admin-views.mjs` (lines 780, 913, 965, 1004), `src/staff-views.mjs` (lines 1446, 1460, 1489, 1512), `src/client-views.mjs` (`intakeScreen`, line 281), `src/views.mjs` (line 393)
- Test: `tests/demo-fill.test.mjs`, `tests/admin-views.test.mjs`, `tests/staff-views.test.mjs`, `tests/client-views.test.mjs`, `tests/office-views.test.mjs`, `tests/presenter.test.mjs`, `tests/shell.test.mjs`

**Interfaces:**
- Consumes: `state.demoTools` (Task 2).
- Produces:
  - `demoFillButton(enabled: boolean): string`. The same button markup as today when `enabled === true`, and `""` otherwise.
  - Admin callers pass `state.demoTools === true`. Staff callers pass `ui.demoTools === true`. Make sure whatever builds `ui` for those staff forms carries `demoTools` from state, as it carries `principal` today.
  - `intakeScreen` passes `fictionalTools: state.demoTools === true ? fictionTools(viewLang(state)) : ""`.
  - `views.mjs` sets `demoTools: state.demoTools === true` for `renderAddCaseV2`.

- [ ] **Step 1: Write and update the failing tests.**
  - `tests/demo-fill.test.mjs`: replace `"only a presenter gets the auto-fill button…"` with `"the auto-fill button follows the switch, not the account"`. `demoFillButton(true)` matches `/data-action="demo-fill"/`, and `demoFillButton(false)` and `demoFillButton(undefined)` equal `""`.
  - `tests/client-views.test.mjs`, `"the fiction toolbar shows only with the switch"`: `intakeScreen` for a draft with `demoTools: false` doesn't match `/fill-fictional|regenerate-fictional|demo-fiction/`. With `demoTools: true` it matches all three, and in `lang: "zh-Hans"` it contains `填入虚构资料`.
  - `tests/admin-views.test.mjs` and `tests/staff-views.test.mjs`: the existing presenter-only assertions become switch assertions. A staff principal with `demoTools: true` sees `data-action="demo-fill"`. A presenter with `demoTools: false` doesn't. Cover one office dialog and one staff questionnaire, and update the rest in place.
  - `tests/office-views.test.mjs` already drives `ui.demoTools`. Keep those tests and add `"views.mjs passes the switch, not the presenter, to Add a case"` through `staffScreen`: a staff state with `demoTools: true` on screen `office-add-case` shows `fill-assisted-intake`, and a presenter state with `demoTools: false` doesn't.
  - `tests/presenter.test.mjs` and `tests/shell.test.mjs`: update any assertion that a presenter gets a fill control, so it now requires `demoTools: true`.
- [ ] **Step 2: Run them to see them fail.** Run `node --test tests/demo-fill.test.mjs tests/client-views.test.mjs tests/admin-views.test.mjs tests/staff-views.test.mjs tests/office-views.test.mjs tests/presenter.test.mjs tests/shell.test.mjs`. Expected: FAIL on the new switch assertions.
- [ ] **Step 3: Implement the rendering changes** as in the Interfaces block. Update the comments that say "for a presenter only" or "a presenter's window" to describe the switch.
- [ ] **Step 4: Run them to see them pass.** The same command, then `npm test`. Expected: all pass.
- [ ] **Step 5: Commit.** "Demo tools: the three fill controls render from the switch".

### Task 4: The fill handlers need the switch

**Files:**
- Modify: `src/app.mjs`: `fillAssistedIntake` (near line 1022), the `case "demo-fill"` branch (near line 1833), and the `fill-fictional`, `regenerate-fictional` and `confirm-regenerate` branches (near line 2168)
- Test: `tests/demo-fill.test.mjs`

**Interfaces:**
- Consumes: `demoToolsOn(state)` (Task 2).

- [ ] **Step 1: Write the failing test** `"every fill handler checks the switch"` in `tests/demo-fill.test.mjs`.
  - Read `src/app.mjs` as text. For each action name in `["demo-fill", "fill-fictional", "regenerate-fictional", "confirm-regenerate"]`, take the source from `case "<name>":` up to the next `case "` or `default:`, and assert that slice contains `demoToolsOn(`.
  - Assert that the body of `function fillAssistedIntake` contains `demoToolsOn(`.
  - Assert that `src/app.mjs` no longer contains `access !== "presenter"` inside those slices.
- [ ] **Step 2: Run it to see it fail.** Run `node --test tests/demo-fill.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - Replace the two presenter checks with `if (!demoToolsOn(controller.getState())) return;`, or `break` inside the `switch`.
  - Add the same first line to the `fill-fictional`, `regenerate-fictional` and `confirm-regenerate` branches. For `confirm-regenerate`, still close the dialog.
  - Import `demoToolsOn` from `./demo-fill.mjs`.
- [ ] **Step 4: Run it to see it pass.** Expected: PASS. Then run `npm test`; expected: all pass.
- [ ] **Step 5: Commit.** "Demo tools: fill handlers do nothing without the switch".

### Task 5: Guards, the browser fixture and docs

**Files:**
- Create: `tests/demo-tools-config.test.mjs`
- Modify: `tests/support/browser-fixture.mjs` (the `createAppServer({ env })` call near line 357), `docs/developer/backend.md` ("The public configuration contract"), `docs/setup.md` ("Signing in locally" and §6 "Classroom and hosted setup")

**Interfaces:**
- Consumes: `isLoopbackUrl` (Task 1).

- [ ] **Step 1: Write the failing test** `"no committed public config carries demoTools"` in `tests/demo-tools-config.test.mjs`.
  - It runs `git ls-files` (`execFileSync("git", ["ls-files", "-z"])`), keeps paths whose base name matches `/^public-config.*\.json$/`, and for each reads the file and asserts it doesn't contain `"demoTools"`, naming the path in the message.
  - So the test isn't vacuous, it also asserts the same check rejects a sample string: export the checker as `findDemoToolsConfigs(paths, read)` inside the test file, and call it once with a fake path whose content contains `"demoTools": true`, expecting that path back.
  - Today it passes trivially, because no such file is tracked. Run it once with a temporary untracked-then-added file, `git add -N`, to watch it fail, then remove the file. Record that in the commit message.
- [ ] **Step 2: Update the browser fixture.**
  - Add `VITALLY_DEMO_TOOLS: "1"` to the server `env`.
  - Before creating the server: `if (!isLoopbackUrl(target.apiUrl)) throw new Error("The browser story needs a local (loopback) Supabase test target for the demo tools.");`
- [ ] **Step 3: Update `docs/developer/backend.md`.**
  - The contract becomes three shapes: `{"configured": false}`, the four keys, and the four keys plus `"demoTools": true`.
  - It says when `server.mjs` adds the key and about the warning.
  - It says the browser also requires a loopback `supabaseUrl`.
  - It says a committed `public-config.json` must never carry it, and that a test enforces this.
- [ ] **Step 4: Update `docs/setup.md`.**
  - In "Signing in locally", add `VITALLY_DEMO_TOOLS=1` to `.env.local` to get the fill buttons while rehearsing.
  - In §6, say a hosted or classroom project never shows fill tools, because its Supabase URL isn't on the machine.
- [ ] **Step 5: Run `npm test`.** Expected: all pass.
- [ ] **Step 6: Commit.** "Demo tools: committed-config guard, browser fixture and docs".

### Task 6: Verification

- [ ] **Step 1:** `npm test`. Expected: all pass.
- [ ] **Step 2:** `npm run build:hant -- --check`. Expected: passes, with `src/zh-hant.mjs` unchanged.
- [ ] **Step 3:** `npm run test:browser`, about 11–16 minutes. Expected: the full story passes. The client fill steps still work, because the fixture sets the flag.
- [ ] **Step 4:** By hand:
  - `npm start` with `.env.local` pointing at the local stack and `VITALLY_DEMO_TOOLS=1`. Sign in as a client, and the draft intake shows "Fill fictional details".
  - Remove the flag, restart and reload. The toolbar is gone.
  - Set the flag with a non-loopback `SUPABASE_URL`. The start-up warning prints, without the URL.
- [ ] **Step 5:** `npx openspec validate --all`. Expected: all valid.
- [ ] **Step 6:** Tick the completed boxes in `openspec/changes/gate-demo-tools/tasks.md`, then commit "Demo tools: tasks done".
