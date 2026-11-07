## Why

ViTally has three controls that fill a form with fictional data:
- the staff "Auto-fill fictional data";
- the client intake's fiction toolbar;
- the office's assisted-intake fill.

The staff and office ones are tied to the presenter account, which is being removed, so rehearsals would lose them. The client one is shown to every client, always, so a real client in production would see a button that fills their tax intake with made-up data. One switch, possible only on a local stack, fixes both.

## What Changes

**Who sees the fill tools**
- From: the staff and office fills for a presenter only; the client toolbar for every client.
- To: all three are shown, and act, only when the public config carries `demoTools: true`. When it does, they're shown to whoever is on that screen.
- Reason: rehearsals keep the tools after presenter removal, and real clients never see them.
- Impact: on any stack without the switch, presenters lose the staff and office fills and clients lose the toolbar. No hosted project exists yet. The planned classroom project will have no fill tools.

**The public config**
- From: exactly four keys.
- To: an optional fifth key, `demoTools: true`. `server.mjs` sends it only when `.env.local` sets `VITALLY_DEMO_TOOLS=1` and `SUPABASE_URL` is loopback. If the flag is set but the URL isn't loopback, it warns at start-up and leaves the key out.
- Also: the browser ignores the key unless its `supabaseUrl` is loopback, and a unit test fails if any committed `public-config*.json` contains it.
- Impact: non-breaking. A config without the switch is unchanged.

**Tests and docs**
- The browser test server sets the flag, and refuses a non-loopback target.
- Docs: `docs/setup.md` (rehearsal flag; classroom note) and `docs/developer/backend.md` (config contract).
- No client text changes. No database change.

## Capabilities

### New Capabilities
- `demo-tools`: the fictional-fill controls (staff, client and office), the single `demoTools` switch that shows and enables them, how the server sets it (flag plus loopback), the browser's own loopback check, and the guard against a committed config carrying it.

### Modified Capabilities
- `staff-case-work`: the requirement "A staff account's screens have no persona picker or demo tools" is renamed to "…no persona picker or presenter controls", because staff now see the fill tools when the demo-tools switch is on; its text is unchanged.

## Impact

- **Code:**
  - `server.mjs` (`publicConfig`, start-up warning);
  - a new `src/loopback.mjs`;
  - `src/app.mjs` (reading the switch, handler checks);
  - `src/controller.mjs` (exposing `state.demoTools`);
  - `src/demo-fill.mjs`, `src/views.mjs`, `src/client-views.mjs`, `src/admin-views.mjs` and `src/staff-views.mjs` (rendering);
  - `.env.example`.
- **Tests:**
  - `tests/server.test.mjs`, `tests/demo-fill.test.mjs`, `tests/client-views.test.mjs`, `tests/office-views.test.mjs`, `tests/admin-views.test.mjs`, `tests/staff-views.test.mjs`, `tests/presenter.test.mjs` and `tests/controller.test.mjs`, where they pin presenter-only buttons;
  - a new committed-config scan;
  - `tests/support/browser-fixture.mjs`.
- **Checks:** `npm test`, `npm run test:browser`, `npm run build:hant -- --check`.
- **Systems:** none. Browser and local server only.
- **Issue:** #133, part of tracking issue #128.
