# Review-contact line after Return to signing: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a Return to signing, "Your next step" at Ready to exit places the first approval's client conversation at the first signing and says it isn't repeated (#204).

**Architecture:** `contactStepLine` in `src/staff-views.mjs` gets an optional `{ returned }` argument that switches it to two second-signing sentences. Only the `review_approved` branch of "Your next step" passes `returned: returnedToSigning(record)`. The Independent review history row keeps its two-argument call and its wording.

**Tech Stack:** plain ES modules rendering HTML strings; `node:test` unit tests; the Playwright story in `tests/browser.mjs`.

**Spec:**
- `openspec/changes/fix-contact-line-after-return-to-signing/specs/review-and-corrections/spec.md`, requirement "An approval with a questionnaire settles the review-contact step";
- `design.md` D1–D4 in the same folder.

## Global Constraints

- The exact sentences, copied verbatim from the spec:
  - "yes": `At the first signing, the reviewer went over the return with the client on ${staffDate(questionnaire.wentOverOn)}. It isn't gone over again.`
  - "no": `At the first signing, going over the return with the client was passed to the office. It isn't gone over again.`
- **Unchanged text:**
  - the first signing's sentences: "The reviewer went over the return with the client on <date>." and "The office will go over the return with the client.";
  - the no-questionnaire fallback: "The client conversation for this review is recorded. Nothing further is needed here.".
- **The history row:** the Independent review panel's "Client conversation" row (`reviewAttempts`) must not change.
- **No database work:** no database, migration, RPC, client-text or `zh-hant` change. Staff screens stay English.
- **Fictional data only** in tests.
- **Commit trailer:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The "no" approval after a Return to signing, on the full case page.** The history row still says "The office will go over the return with the client." by design. A check for "absent" must look only inside the `.next-step` section: Task 1 cuts the panel out of the HTML, and Task 2 uses the `.next-step` locator.
2. **An approval with no questionnaire, on a returned case.** It must keep the existing fallback and must not throw on the new argument (Task 1, test 3).
3. **A returned case that has more than one approval.** The line must come from the latest approval, which is already `approved` in `nextStep`. Task 1, test 1 uses `returnedCase`, which has one approval; the existing `findLast` decides, so no extra test is needed.
4. **A "yes" approval whose `wentOverOn` is missing.** `staffDate` already handles that on the first signing, and the new sentence reuses it unchanged. No new test.
5. **The go-over is not raised again.** The case's `go_over_return` follow-ups stay at one (Task 2).

---

### Task 1: The second-signing line in "Your next step"

**Files:**
- Modify: `src/staff-views.mjs`:
  - `contactStepLine` (around line 1880);
  - its `review_approved` caller in `nextStep` (around line 1581).
- Test: `tests/staff-views.test.mjs`. Add the tests after "approved with no says the office takes over" (around line 3020). Reuse `returnedCase`, `revQ`, `reviewRow`, `staffCase`, `nextStep`, `staffEligibility`, `renderStaffCase` and `MORGAN`, all already in the file.

**Interfaces:**
- **Produces:** `contactStepLine(attempt, questionnaire, { returned = false } = {})`, which returns `string | null`.
  - With no attempt, or no questionnaire: `null`, whatever `returned` is.
  - Otherwise, with `returned` false: today's sentences.
  - With `returned` true: the two Global Constraints sentences.

- [ ] **Step 1: Write the failing tests**

```js
const returnedStep = (record) => nextStep(record, staffEligibility(record, MORGAN), {});
const nextStepPanel = (html) => html.slice(html.indexOf('class="panel next-step"'), html.indexOf("</section>", html.indexOf('class="panel next-step"')));

test("after Return to signing, a yes approval is placed at the first signing (#204)", () => {
  const html = returnedStep(returnedCase());
  assert.match(html, /At the first signing, the reviewer went over the return with the client on 10\/16\/2026\. It isn't gone over again\./);
});

test("after Return to signing, a no approval names no coming go-over (#204)", () => {
  const html = returnedStep(returnedCase({ reviewerQuestionnaires: [revQ({ wentOver: false, wentOverOn: null, wentOverHow: null })] }));
  assert.match(html, /At the first signing, going over the return with the client was passed to the office\. It isn't gone over again\./);
  assert.doesNotMatch(html, /The office will go over the return with the client\./);
});

test("after Return to signing, an approval with no questionnaire keeps its fallback (#204)", () => {
  const html = returnedStep(returnedCase({
    reviewerQuestionnaires: [],
    reviews: [reviewRow({ status: "approved", clientContactStatus: "completed", decidedAt: "2026-10-17T15:00:00.000Z" })],
  }));
  assert.match(html, /The client conversation for this review is recorded\. Nothing further is needed here\./);
  assert.doesNotMatch(html, /At the first signing/);
});

test("after Return to signing, the review history row is unchanged (#204)", () => {
  const yes = renderStaffCase(returnedCase(), MORGAN);
  assert.match(yes, /<span>Client conversation<\/span><strong>The reviewer went over the return with the client on 10\/16\/2026\.<\/strong>/);
  const no = renderStaffCase(returnedCase({ reviewerQuestionnaires: [revQ({ wentOver: false, wentOverOn: null, wentOverHow: null })] }), MORGAN);
  assert.match(no, /<span>Client conversation<\/span><strong>The office will go over the return with the client\.<\/strong>/);
  assert.doesNotMatch(nextStepPanel(no), /The office will go over the return with the client\./);
});
```

The existing "approved with yes offers no conversation form" and "approved with no says the office takes over" tests are the unchanged first-signing checks. Leave them as they are.

- [ ] **Step 2: Run the tests and see them fail**

Run: `node --test --test-name-pattern="#204" tests/staff-views.test.mjs`
Expected: the "yes", "no" and history-row tests FAIL, because the old sentences are shown. The no-questionnaire test may already pass.

- [ ] **Step 3: Implement it**

- Give `contactStepLine` the third argument from Interfaces, with the two sentences.
- Update its JSDoc to name the second-signing variant.
- In the `review_approved` case of `nextStep`, call `contactStepLine(approved, reviewerQuestionnaireOf(record, approved), { returned: returnedToSigning(record) })`. `returnedToSigning` is already imported.
- Leave the call in `reviewAttempts` alone.

- [ ] **Step 4: Run the unit suite**

Run: `npm test`
Expected: all pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/staff-views.mjs tests/staff-views.test.mjs
git commit -m "After Return to signing, the review-contact line places the conversation at the first signing (#204)"
```

### Task 2: The story checks the line after Return to signing

**Files:**
- Modify: `tests/browser.mjs`, in the class-case Return to signing step (around lines 3841–3860). Add the checks right after `assert.equal((await caseById(fixture, classCase.id)).stage, "review_approved");` and before `poolTabShows("signing", …)`. The staff page is still on the case page there.

**Interfaces:**
- **Consumes:** the "no" sentence from Task 1. The class case is approved with `wentOver: "no"` (around line 3093). Confirm that before writing the assertion.
- **Uses these existing helpers:** `waitFor`, `one`, `fixture`, `classCase`, `ARRIVAL_MS`.

- [ ] **Step 1: Add the checks**

- **The new sentence.** `waitFor(staff, "the next step to place the go-over at the first signing", …)` until `document.querySelector(".panel.next-step")?.innerText` includes "At the first signing, going over the return with the client was passed to the office. It isn't gone over again.", within `ARRIVAL_MS`.
- **The old sentence is gone.** Then assert that the same panel's text does not include "The office will go over the return with the client.".
- **No new go-over.** Assert that `select count(*)::int as n from public.admin_followups where case_id=$1 and purpose='go_over_return'` for `classCase.id` is `1`.

- [ ] **Step 2: Run the story**

Run: `npm run test:browser` on the local stack (about 20–25 minutes). Instead, CI's `story (chrome-client)` and `story (firefox-client)` jobs on the pushed branch can stand in.
Expected: both browser orders pass.

If the Chrome-client order times out at the seed step's 20 s "page holds still" wait, that is the known timing problem, outside this change. Re-run that order alone with `node --env-file=.env.test --test --test-skip-pattern="Firefox client and Chrome staff" tests/browser.mjs` before treating it as a failure.

- [ ] **Step 3: Commit**

```bash
git add tests/browser.mjs
git commit -m "Story: the next step after Return to signing places the go-over at the first signing (#204)"
```

### Task 3: Follow-up draft and repository checks

**Files:** none in the repo. The draft goes in the session scratchpad and is handed to the user.

- [ ] **Step 1: Draft the follow-up issue.** Title: "Review-contact line still says the office will go over the return after the go-over is closed".
  - **Where:** "Your next step" at the first signing, after the office's `go_over_return` follow-up is resolved or cancelled, and the Independent review "Client conversation" row.
  - **Why it's open:** wording by outcome needs the follow-up's outcome on the record (design D3).
  - **Refers to:** #204.
  - Do not file it.
- [ ] **Step 2: Run the repository checks.** Run `npx openspec validate --all` and `npm run build:intake`, then `git status --short`.
  Expected: validation passes, and nothing is left to commit.
