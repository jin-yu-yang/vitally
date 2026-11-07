# Verification Report

**Change**: `gate-demo-tools`
**Verified at**: `2026-11-05 22:55`
**Verifier**: Claude Code (controller of the subagent-driven apply), checks run directly because the `openspec-verify-change` skill is not installed

PRECHECK: 9 commits on the branch since `main` (`9712a3a`); 17 ticked tasks in `tasks.md`. Both are positive.

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`

**Result:**

```text
Totals: 11 passed, 0 failed (11 items)
```

There was one INFO line and no failure: a long requirement text in an existing canonical spec that this change doesn't touch.

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (17 of 17)

How the verification tasks were met:
- **4.1** `npm test`: 1499 tests, all pass.
- **4.2** `npm run build:hant -- --check`: exit 0. No change to `src/client-text.mjs`, `src/zh-hant.mjs` or `supabase/`.
- **4.3** `npm run test:browser`: one run alone on the local stack, on `d05a1fd`, the last code commit. 81 tests, all pass.
- **4.4** `npm start`'s server (`server.mjs`) was started on a spare port in three ways, and `/public-config.json` was read each time:
  - flag plus loopback URL: five keys, `demoTools: true`;
  - no flag: the four keys, no `demoTools`;
  - flag plus hosted URL: the four keys, no `demoTools`, and the start-up line "VITALLY_DEMO_TOOLS is ignored: the Supabase URL is not on this machine."

  Whether the toolbar is shown follows from that key. Shown: the browser story clicks the client toolbar's fill with the flag on. Not shown: the client-views unit tests check its absence without the switch. Nobody looked at the screen by eye.
- **4.5** `npx openspec validate --all`: 11 of 11.

| Task | Not done because | Blocks archive |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

| Capability | Sync state | Notes |
|---|---|---|
| `demo-tools` | ✗ Needs sync | A new capability with 5 ADDED requirements. Archive creates `openspec/specs/demo-tools/spec.md`. |
| `staff-case-work` | ✗ Needs sync | One RENAMED requirement: "…no persona picker or demo tools" becomes "…no persona picker or presenter controls". The body is unchanged. Archive applies it. |

Both are expected before archive (CLAUDE.md lifecycle step 8).

---

## 4. Design / Specs Coherence Spot Check

| Item | Design | Spec | Gap |
|---|---|---|---|
| D1 one switch | One `demoTools` switch for the staff, client and office fills | "Fictional-fill controls appear only with the demo-tools switch" | None |
| D2 server flag plus loopback | `publicConfig` adds the key only with the flag and a loopback URL; a start-up warning otherwise | "The server sends the switch only for a local project and an explicit flag" | The warning's location (below) |
| D3 browser check | The browser ignores the key unless `supabaseUrl` is loopback | "The browser turns the switch on only for a local project" | None |
| D5 handlers via state | The handlers read `state.demoTools` | "Fill actions do nothing without the switch" | None |
| D6 committed-config guard | A unit test scans the tracked `public-config*.json` files | "No committed configuration carries the switch" | None |

**Drift warnings** (non-blocking):

- D2 says `createAppServer` prints the start-up warning. The code prints it in `server.mjs`'s direct-run block, which `npm start` uses. The apply ruled this way so the in-process test servers stay quiet. The spec only asks for one warning at start-up, and it's met. If the ruling is wrong, a caller that embeds `createAppServer` gets no warning, but it still gets no `demoTools` key.
- The presenter panel's own "Fill fictional details" button (`src/presenter-views.mjs`) is gated too, though the design's list missed it. This follows the spec's "none shown to anyone without the switch".

---

## 5. Implementation Signal

- [x] Nothing unstaged in the worktree, apart from this report and the ticked `tasks.md`, which are committed together with it.
- [ ] Every commit pushed. Not yet: the branch is pushed at the finish step.

**Commit range:** `9712a3a..d05a1fd` for the code; this report's commit follows.

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md   # 8 files
```

- [x] The 8 files are historical design documents from parts 1–4d, which CLAUDE.md says to keep. This change wrote nothing there. Its design output is in `brainstorm.md` and `design.md`.

| File | Captured in the change | Action |
|---|---|---|
| — | — | None |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no `[~]` rows, so this section is empty.

---

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS: the D2 warning's location and the presenter-panel gate, both from rulings during apply (§4). Neither breaks a spec requirement.
- [ ] ❌ FAIL

**Next step:** write the retrospective, merge `main` into the branch, archive, then push and open the PR.
