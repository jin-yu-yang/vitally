## Why

Bug #175. When a client answers Yes to the household question, adds members, then changes the answer to No, the members stay in `answers.hh`. The shaded section still counts them:
- the database accepts household cells for those rows, and the editor and upload checks allow them;
- the draft 13614-C prints those cells next to an empty household table.

Everything else (the draft's own household rows, the document cards, the 14446 consent) already hides those members. Only the shaded section disagrees, so the draft can show preparer answers about people the client said aren't there.

## What Changes

**Which household rows take cells**
- From: `min(length of answers.hh, 4)`, ignoring the Yes/No answer. Decided separately in SQL (039) and in `src/app.mjs`.
- To: `min(number of members, 4)` while the catalogue shows the `hh` group for the case's intake version, else 0. One browser function in `src/shaded-fields.mjs`, one SQL function in migration 050, and a parity test between them.
- Reason: the shaded section must follow the household the client actually shows.
- Impact: non-breaking. A save that fills a hidden row is now refused with `VALIDATION`, as rows past the household size already are.

**Stored cells on rows that become hidden**
- From: they print, are prefilled in the editor (where every save would then be refused), and are counted on the case page.
- To: they stay stored but are hidden. They don't print, aren't prefilled, aren't counted and don't set the "preparer entries" stamp. A save keeps them, so they come back if the client answers Yes again.
- Reason: the intake also keeps hidden answers. Dropping data the preparer cannot see would be silent data loss. A save must never be stuck on cells the preparer cannot see.
- Impact: `SAVE_PREPARER_FIELDS` replaces the visible section, not the whole stored row.

**Migration 050**
`create or replace` of `vitally_private.act_save_preparer_fields` (first defined in 039), plus a new `vitally_private.household_rows`. It will be renamed at merge time if the agreed order (047 #197, 048 #200, 049 #196) changes.

Out of scope: cells follow row numbers, not members (issue #202).

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `shaded-section`: which household rows take cells; what a save does with stored cells on hidden rows; the editing copy and the case page show only visible rows.
- `draft-13614c`: the draft prints shaded household cells, and sets its stamp, only from visible rows.

## Impact

- **Database:** new migration `supabase/migrations/050_hidden_household_rows.sql`. No schema change, no RLS change, no new RPC. `SAVE_PREPARER_FIELDS` behaviour changes as above.
- **Browser:** `src/shaded-fields.mjs` (new `householdRows`, `visibleShaded`), `src/app.mjs` (`shadedRules`, editing copy, draft call), `src/draft-form.mjs` (shaded loop and stamp), `src/staff-views.mjs` (the "N fields filled" count).
- **Docs:** `docs/database.md` (the save and the new function).
- **Tests:** `tests/shaded-fields.test.mjs`, `tests/draft-form.test.mjs`, `tests/staff-views.test.mjs`, `tests/database-shaded.mjs` (including the JS/SQL parity table).
- **Client text:** none changed. No Chinese impact.
