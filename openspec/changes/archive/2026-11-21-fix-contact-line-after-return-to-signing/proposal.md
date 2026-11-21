## Why

After a Return to signing, the case is back at Ready to exit for the client's second signing (#204, a follow-up from #173). "Your next step" still shows the review-contact line from the first approval, as if it were current. For a "yes" approval, it reports a go-over of the return from before the fix. For a "no" approval, it promises an office go-over that will never happen, because the canonical spec says the second signing does not repeat the reviewer's conversation or the office's go-over. Staff reading the panel are told something false about what still has to be done.

## What Changes

**The review-contact line in "Your next step" after a Return to signing**

- **From:**
  - "The reviewer went over the return with the client on <date>." for an approval answered "yes";
  - "The office will go over the return with the client." for one answered "no".
- **To:**
  - "At the first signing, the reviewer went over the return with the client on <date>. It isn't gone over again." for "yes";
  - "At the first signing, going over the return with the client was passed to the office. It isn't gone over again." for "no".
- **Reason:** the line should place the conversation at the first signing and not promise work that isn't coming. For "no", it should say only what is certain: an office go-over can close without reaching the client.
- **Impact:** non-breaking, and visible to staff only.

**What stays as it is:**
- the first signing's lines;
- the fallback for an approval with no questionnaire;
- the Independent review panel's "Client conversation" history row;
- every database rule.

The go-over follow-up is **not** raised again. The `case-lifecycle` requirement "A rejected case returns to signing" already rules that out.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `review-and-corrections`: the requirement "An approval with a questionnaire settles the review-contact step" gains what "Your next step" says after a Return to signing, with a scenario for each answer.

## Impact

- **Code:** `src/staff-views.mjs`. `contactStepLine` gains a returned-to-signing variant, chosen with `returnedToSigning(record)` in "Your next step" only.
- **Tests:**
  - `tests/staff-views.test.mjs`;
  - one assertion in the browser story (`tests/browser.mjs`) after its existing Return to signing step.
- **Unchanged:**
  - no database, migration, RPC, row-level security or realtime change;
  - no client text, catalogue or `zh-hant` change, because staff screens stay English.
- **Follow-up:** the stale first-signing "The office will go over the return with the client." after the go-over closes goes into a separate issue, drafted for the user to file.
