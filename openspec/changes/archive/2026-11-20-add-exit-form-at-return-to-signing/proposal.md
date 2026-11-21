## Why

After a rejected return is fixed and sent back with Return to signing, the Exit Form prints only the header and the
settled filing methods, and staff fill in the rest by hand (#173). ViTally holds no corrected refund, amount owed,
payment method, Other Tax entry or Remarks, because Return to signing collects none. The client is then handed a
form that is mostly handwritten at their second signing. #203 asks for the Return to signing dialog to collect
the corrected values, so the form can print in full.

## What Changes

**The Return to signing dialog**
- From: "The fix is done." and nothing else.
- To: "The fix is done.", then optional Exit Form groups:
  - Federal, State, and Other Tax (Local NPT, BIRT, EET, SIT, PAIBWTR), each collapsible and starting empty and
    closed, with "Clear this section";
  - Remarks.

  A settled return's group shows the case's filing method, fixed. For the rejected return, the admin picks the
  planned refile method.
- Reason: the office knows the corrected figures at this point, and the hand-out should carry them.
- Impact: non-breaking. The groups are optional, so a Return to signing with none of them behaves as today.
  Admin only, staff screens only.

**The `RETURN_TO_SIGNING` payload and storage**
- From: `{confirmed: true}` only. Nothing is stored apart from the stage move and the history line.
- To: the payload also accepts optional `exitForm` and `remarks`, in the reviewer questionnaire's shape. They are
  validated by the existing `check_exit_form`, so no banking details can be stored. A settled return's method
  must match the case's.

  The values are stored in a new staff-only table, `return_to_signing_exit_forms` (migration 054), with one row
  per Return to signing that carried values. Clients can't read it.
- Reason: a review's questionnaire belongs to that review. The corrected values belong to the Return to signing.
- Impact: non-breaking. The old payload stays valid. One new migration, one new table in the staff record and the
  realtime subscription.

**The Exit Form after a Return to signing**
- From: always the header, the settled methods and a fill-by-hand note listing every other part.
- To: when the latest Return to signing stored values, the form prints them. Each filing method comes from the
  case once that return is settled, and from the stored values until then. The note says the form was filled
  from the corrected values recorded at Return to signing, and lists only what's missing. Without stored values,
  the behaviour is unchanged.
- Reason: the form reflects the latest approval, now with its figures.
- Impact: non-breaking. The same rule serves the office panel, the volunteer's button and the PDF builder.

**Mark e-filed after a Return to signing**
- From: the rejected return's method choice starts with nothing selected.
- To: it starts with the method entered at Return to signing, if any. The admin can still change it.
- Reason: the method planned at Return to signing should carry through to the refile.
- Impact: non-breaking.

Not in this change: the review-contact line after a Return to signing (#204), and prefilling the dialog from the
first approval (decided against).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `case-lifecycle`: "A rejected case returns to signing" gains the optional corrected Exit Form values, their
  validation and storage, and Mark e-filed's preselected method.
- `review-and-corrections`: the Exit Form after a Return to signing prints the stored corrected values when there
  are any. The fill-by-hand note lists only the missing parts. Who can read the corrected values (staff, never the
  client).

## Impact

- **Database:** new migration `supabase/migrations/054_return_to_signing_exit_forms.sql`.
  - New table, with row-level security that reuses the read rule of `reviewer_questionnaires`.
  - New copies of:
    - `check_payload` (the `RETURN_TO_SIGNING` branch);
    - `act_return_to_signing`;
  - No reset copy: migration 040 dropped `apply_fixture_scenario`; rows go with their case (on delete cascade).
- **Browser:**
  - `src/admin-views.mjs`: `returnToSigningDialogBody` and `efiledChoices`.
  - `src/case-actions.mjs`: the `RETURN_TO_SIGNING` payload builder.
  - `src/questionnaires.mjs`: reuse `exitFormFrom`.
  - `src/staff-views.mjs`: share `exitGroup` with the dialog.
  - `src/exit-form-source.mjs`.
  - `src/supabase-store.mjs`: the record loader and `STAFF_TABLES`.
  - `src/contracts.mjs`.
  - `src/app.mjs`: dialog wiring, if needed.
- **Tests:**
  - unit: `tests/exit-form-source.test.mjs`, `tests/admin-views.test.mjs`, `tests/case-actions.test.mjs`,
    `tests/questionnaires.test.mjs`, `tests/confirm-dialogs.test.mjs`;
  - database: a new or extended `tests/database-filing.mjs` / `tests/database-review.mjs` covering the payload,
    the storage, row-level security and the client's lack of access, plus `tests/database-realtime.mjs`;
  - browser story: the Return to signing path.
- **Docs:** `docs/developer/backend.md`, `docs/developer/frontend.md`, `docs/demo-script.md` and `README.md`,
  where they describe Return to signing or the Exit Form.
