## 1. The second-signing line in "Your next step"

- [ ] 1.1 Add failing unit tests in `tests/staff-views.test.mjs`, using the `returnedCase` fixture:
  - a "yes" approval reads "At the first signing, the reviewer went over the return with the client on 10/16/2026. It isn't gone over again.";
  - a "no" approval reads "At the first signing, going over the return with the client was passed to the office. It isn't gone over again." and not "The office will go over the return with the client.";
  - an approval with no questionnaire keeps "The client conversation for this review is recorded. Nothing further is needed here.".
- [ ] 1.2 Add a unit test that the Independent review panel's "Client conversation" row is unchanged on a returned case. The existing first-signing tests ("approved with yes…" and "approved with no…") must keep passing.
- [ ] 1.3 In `src/staff-views.mjs`, give `contactStepLine` an optional `{ returned }` argument with the two second-signing sentences (design D1–D4). Pass `returned: returnedToSigning(record)` from the `review_approved` branch of "Your next step" only.
- [ ] 1.4 Run `npm test`; all unit tests pass.

## 2. The story

- [ ] 2.1 In `tests/browser.mjs`, after the existing Return to signing step (the class case, approved with "no"), add three checks:
  - the staff case page's "Your next step" panel shows the "passed to the office" second-signing sentence;
  - that panel does not show "The office will go over the return with the client.". The history row still does, by design, so keep this check inside the panel.
  - the case still has exactly one `go_over_return` follow-up.
- [ ] 2.2 Run the browser story (`npm run test:browser`), or rely on CI's two `story` jobs on the pushed branch, and review their screenshots.

## 3. Follow-up and checks

- [ ] 3.1 Draft a follow-up issue about the stale first-signing "The office will go over the return with the client." once the go-over is closed, in "Your next step" and in the history row. Hand it to the user to file; do not file it.
- [ ] 3.2 Run `npx openspec validate --all`, and confirm that `npm run build:intake` leaves nothing to commit.
