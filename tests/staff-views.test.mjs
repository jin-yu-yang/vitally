import test from "node:test";
import assert from "node:assert/strict";
import {
  renderStaffCase,
  renderStaffBoard,
  decorateStaffCase,
  staffEligibility,
  isAvailableWork,
  filterCases,
  matchesBoardSearch,
  boardCounts,
  boardFilters,
  DEFAULT_BOARD_FILTERS,
  caseTabs,
  lifecycleBar,
  filingPanel,
  caseHeader,
  caseDetails,
  CASE_TABS,
  nextStep,
  correctionsDialogBody,
  problemNotice,
  historySentence,
  stageWork,
  EVENT_SENTENCES,
  historyPanel,
  answersPanel,
  contactCard,
  materialsCard,
  documentChecklist,
  phoneMask,
  listPhone,
  htmlRow,
  PHONE_LOCKED,
  contactsPanel,
  logContactForm,
  mayEditContact,
  taskContacts,
  outcomeGroup,
  shadedPanel,
} from "../src/staff-views.mjs";
import { contactSummary, contactEntryFromForm, nowInput } from "../src/contact-log.mjs";
import { makeSampleAnswers } from "../src/sample-data.mjs";
import { CONTACT_FIELDS, MATERIALS_ITEMS } from "../src/intake-catalogue.mjs";
import { describeStage } from "../src/domain.mjs";
import { CASE_ACTIONS, SHADED_EDITOR, SHADED_UPLOAD } from "../src/contracts.mjs";

// The staff screens are pure functions of one record and one persona, so these
// tests operate on the HTML string itself. No DOM library, and nothing here may
// reach a store.

// ---------------------------------------------------------------------------
// The task brief's test, verbatim.
// ---------------------------------------------------------------------------
test('preparer cannot obtain a self-review action', () => {
  const html = renderStaffCase({stage:'review_ready', preparerId:'alex',
    participants:['alex'], requests:[], reviews:[], history:[]},
    {id:'alex',name:'Alex',capabilities:['prepare','review']});
  assert.match(html, /prepared this case/i);
  assert.doesNotMatch(html, /data-case-action="CLAIM_REVIEW"/);
  const eligible = renderStaffCase({stage:'review_ready',preparerId:'alex',
    participants:['alex'],requests:[],reviews:[],history:[]},
    {id:'morgan',name:'Morgan',capabilities:['review']});
  assert.match(eligible, /data-case-action="CLAIM_REVIEW"/);
});

// ---------------------------------------------------------------------------

const ALEX = { id: "alex", name: "Alex", capabilities: ["prepare"] };
const MORGAN = { id: "morgan", name: "Morgan", capabilities: ["review"] };
const SAM = {
  id: "sam",
  name: "Sam",
  capabilities: ["admin", "assist", "followup", "receive_documents"],
};
const PEOPLE = [ALEX, MORGAN, SAM];

// One contact log entry as the store maps it (Task 3), before decoration: its
// one version holds the same entry. 3:45 PM New York time on 10/17/2026.
const contactEntry = (over = {}) => {
  const entry = {
    direction: "outgoing",
    contactedAt: "2026-10-17T19:45:00.000Z",
    withWhom: "client",
    otherName: null,
    method: "phone",
    purpose: "go_over_return",
    outcome: "reached",
    note: null,
    ...over,
  };
  return {
    id: "c1",
    caseId: "case-a",
    followupId: null,
    revision: 1,
    loggedAt: "2026-10-17T19:46:00.000Z",
    editedAt: null,
    loggedByPersonId: "alex",
    versions: [
      {
        version: 1,
        createdAt: "2026-10-17T19:46:00.000Z",
        editedByPersonId: over.loggedByPersonId ?? "alex",
        direction: entry.direction,
        contactedAt: entry.contactedAt,
        withWhom: entry.withWhom,
        otherName: entry.otherName,
        method: entry.method,
        purpose: entry.purpose,
        outcome: entry.outcome,
        note: entry.note,
      },
    ],
    ...entry,
    ...over,
  };
};

const staffCase = (overrides = {}) =>
  decorateStaffCase(
    {
      id: "case-a",
      reference: "VT-AB2C-DE3F",
      workspaceId: "w1",
      ownerUserId: "owner-1",
      stage: "preparing",
      revision: 5,
      preparationVersion: 0,
      answers: {
        service: "Drop-off",
        language: "Cantonese",
        firstName: "Mei",
        lastName: "Chen",
        residenceCity: "Philadelphia",
        household: "3",
      },
      intakeVerified: true,
      preparerId: "alex",
      reviewerId: null,
      lastRemindedAt: null,
      lastRemindedByPersonId: null,
      createdAt: "2026-09-10T15:00:00.000Z",
      updatedAt: "2026-09-12T16:30:00.000Z",
      participants: ["alex"],
      requests: [],
      documents: [],
      followups: [],
      reviews: [],
      history: [],
      internalHistory: [],
      ...overrides,
    },
    PEOPLE,
  );

// A board row is what `listCases` returns: the Case scalars, nothing related.
const boardCase = (overrides = {}) =>
  decorateStaffCase(
    {
      id: "case-1",
      reference: "VT-AAAA-1111",
      stage: "preparation_ready",
      revision: 3,
      preparationVersion: 0,
      answers: { service: "Drop-off", language: "English" },
      intakeVerified: true,
      preparerId: null,
      reviewerId: null,
      lastRemindedAt: null,
      updatedAt: "2026-09-12T16:30:00.000Z",
      ...overrides,
    },
    PEOPLE,
  );

const BOARD = [
  boardCase(),
  boardCase({
    id: "case-2",
    reference: "VT-BBBB-2222",
    stage: "preparing",
    preparerId: "alex",
    answers: { service: "Same-day", language: "Cantonese" },
  }),
  boardCase({
    id: "case-3",
    reference: "VT-CCCC-3333",
    stage: "review_ready",
    preparationVersion: 1,
    preparerId: "alex",
    answers: { service: "Drop-off", language: "Cantonese" },
  }),
  boardCase({
    id: "case-4",
    reference: "VT-DDDD-4444",
    stage: "reviewing",
    preparationVersion: 1,
    preparerId: "alex",
    reviewerId: "morgan",
    answers: { service: "Online", language: "English" },
    lastRemindedAt: "2026-09-11T14:00:00.000Z",
    lastRemindedByPersonId: "sam",
  }),
  boardCase({
    id: "case-5",
    reference: "VT-EEEE-5555",
    stage: "closed",
    preparationVersion: 2,
    preparerId: "alex",
    reviewerId: "morgan",
    answers: { service: "Online", language: "Mandarin" },
  }),
];

const board = (ui = {}) => renderStaffBoard(BOARD, PEOPLE, ui);
const shows = (html, reference) => html.includes(reference);

test("names come from the roster, and only the sections the record carries", () => {
  const decorated = decorateStaffCase(
    {
      id: "case-a",
      preparerId: "alex",
      reviewerId: "nobody-here",
      lastRemindedByPersonId: "sam",
      participants: ["alex", "casey"],
      followups: [
        {
          id: "task-1",
          assigneeId: "sam",
        },
      ],
      reviews: [{ id: "r1", reviewerId: "morgan" }],
    },
    PEOPLE,
  );
  assert.equal(decorated.preparerName, "Alex");
  assert.equal(decorated.reviewerName, "Unknown person", "an id nobody matches");
  assert.equal(decorated.lastRemindedByName, "Sam");
  assert.deepEqual(decorated.participantNames, ["Alex", "Unknown person"]);
  assert.equal(decorated.followups[0].assigneeName, "Sam");
  // Follow-ups carry no attempts any more: their contacts are in the log.
  assert.equal("attempts" in decorated.followups[0], false);
  assert.equal(decorated.reviews[0].reviewerName, "Morgan");
  // The ids are still there: names are added, nothing is replaced.
  assert.equal(decorated.preparerId, "alex");

  // An unassigned case has no name to attach, and a list row gains no staff
  // section it did not have.
  const row = decorateStaffCase({ id: "case-b", preparerId: null }, PEOPLE);
  assert.equal(row.preparerName, null);
  assert.deepEqual(row.participantNames, []);
  assert.ok(!("followups" in row), "no follow-ups are invented");
  assert.ok(!("reviews" in row), "no reviews are invented");
  // An empty roster still renders something a person can read.
  assert.equal(decorateStaffCase({ preparerId: "alex" }).preparerName, "Unknown person");
});

test("available work is exactly the two unclaimed states", () => {
  assert.equal(isAvailableWork({ stage: "preparation_ready", preparerId: null }), true);
  assert.equal(isAvailableWork({ stage: "review_ready", reviewerId: null }), true);
  assert.equal(isAvailableWork({ stage: "preparation_ready", preparerId: "alex" }), false);
  assert.equal(isAvailableWork({ stage: "review_ready", reviewerId: "morgan" }), false);
  for (const stage of [
    "draft",
    "received",
    "preparing",
    "reviewing",
    "corrections_required",
    "review_approved",
    "closed",
  ])
    assert.equal(isAvailableWork({ stage }), false, stage);
  // The Available tab is where unclaimed preparation shows up on the board.
  assert.ok(shows(board({ person: ALEX }), "VT-AAAA-1111"));
});

test("the board shows one tab at a time, and search reaches every stage", () => {
  // BOARD: case-1 available, case-2 preparing (Alex), case-3 review_ready
  // (prepared by Alex), case-4 reviewing (Alex/Morgan), case-5 closed.
  assert.deepEqual(DEFAULT_BOARD_FILTERS, {
    status: "available",
    assignment: "anyone",
    language: "all",
    service: "all",
    search: "",
  });
  const ids = (filters, person = ALEX) =>
    filterCases(BOARD, filters, person).map((record) => record.id);

  assert.deepEqual(ids({}), ["case-1"], "Available is the default tab");
  assert.deepEqual(ids({ status: "preparation" }), ["case-2"]);
  assert.deepEqual(ids({ status: "review" }), ["case-3", "case-4"]);
  // Mine / Everyone narrows only the two waiting tabs.
  assert.deepEqual(ids({ status: "review", assignment: "mine" }, MORGAN), ["case-4"]);
  assert.deepEqual(ids({ status: "preparation", assignment: "mine" }, MORGAN), []);
  assert.deepEqual(ids({ status: "available", assignment: "mine" }, MORGAN), ["case-1"]);
  // Old saved values fall back instead of hiding everything.
  for (const old of ["all", "mine", "in_progress", "waiting", "done"])
    assert.deepEqual(ids({ status: old }), ["case-1"], old);
  assert.equal(boardFilters({ assignment: "unassigned" }).assignment, "anyone");
  // Language and service still narrow the tab.
  assert.deepEqual(ids({ status: "review", language: "English" }), ["case-4"]);
  // Search ignores the tab and the scope, keeps language and service, and
  // reaches stages that have no tab.
  assert.deepEqual(ids({ search: "eeee" }), ["case-5"]);
  assert.deepEqual(ids({ status: "review", assignment: "mine", search: "VT-" }, MORGAN), [
    "case-1",
    "case-2",
    "case-3",
    "case-4",
    "case-5",
  ]);
  assert.deepEqual(ids({ search: "VT-", language: "Cantonese" }), ["case-2", "case-3"]);
  assert.deepEqual(ids({ search: "   " }), ["case-1"], "blank search is no search");

  // Counts: one per tab, respecting language, service and scope.
  assert.deepEqual(boardCounts(BOARD, {}, ALEX), { available: 1, preparation: 1, review: 2 });
  assert.deepEqual(boardCounts(BOARD, { assignment: "mine" }, MORGAN), {
    available: 1,
    preparation: 0,
    review: 1,
  });
  assert.deepEqual(boardCounts(BOARD, { language: "Cantonese" }, ALEX), {
    available: 0,
    preparation: 1,
    review: 1,
  });
});

test("the board's tabs are unchanged, and its search finds a case at e-filed", () => {
  const efiled = boardCase({ id: "case-9", reference: "VT-FILE-9999", stage: "efiled", preparerId: "alex" });
  const signing = boardCase({ id: "case-8", reference: "VT-SIGN-8888", stage: "review_approved" });
  // None of the three new stages is on a tab, so no tab shows them.
  for (const status of ["available", "preparation", "review"])
    assert.deepEqual(
      filterCases([efiled, signing], { status }, ALEX).map((c) => c.id),
      [],
      status,
    );
  assert.deepEqual(boardCounts([efiled, signing], {}, ALEX), { available: 0, preparation: 0, review: 0 });
  // A search ignores the tab, so it reaches every stage.
  assert.deepEqual(filterCases([efiled, signing], { search: "FILE-9999" }, ALEX).map((c) => c.id), ["case-9"]);
  assert.deepEqual(filterCases([efiled, signing], { search: "VT-SIGN" }, ALEX).map((c) => c.id), ["case-8"]);
  const html = renderStaffBoard([efiled], PEOPLE, { person: ALEX, filters: { search: "VT-FILE" } });
  assert.match(html, /VT-FILE-9999/);
});

test("the board's Language cell lists every language, preferred first, and the filter matches any of them", () => {
  const both = boardCase({ id: "b", reference: "VT-BOTH", answers: { language: "cantonese", language_also: ["mandarin"] } });
  const mand = boardCase({ id: "m", reference: "VT-MAND", answers: { language: "mandarin" } });
  const eng = boardCase({ id: "e", reference: "VT-ENG", answers: { language: "english", language_also: ["other"], language_also_other: "Vietnamese" } });
  const cases = [both, mand, eng];
  const ids = (filters) => filterCases(cases, { status: "available", ...filters }, ALEX).map((c) => c.id).sort();
  assert.deepEqual(ids({ language: "Mandarin" }), ["b", "m"]);
  assert.deepEqual(ids({ language: "Cantonese" }), ["b"]);
  assert.deepEqual(ids({ language: "Other" }), ["e"]);
  const html = renderStaffBoard(cases, PEOPLE, { person: ALEX, filters: { status: "available" } });
  assert.match(html, /<span class="language-letters" title="Cantonese \(preferred\), Mandarin" data-languages="Cantonese\|Mandarin"><span aria-hidden="true">C, M<\/span>/);
  assert.match(html, /title="English \(preferred\), Other: Vietnamese" data-languages="English\|Other"><span aria-hidden="true">E, O<\/span>/);
  for (const label of ["Cantonese", "English", "Mandarin", "Other"])
    assert.equal([...html.matchAll(new RegExp(`data-filter="language" data-value="${label}"`, "g"))].length, 1, label);
});

test("answer codes display and filter by their labels", () => {
  const v2 = boardCase({ id: "v2", reference: "VT-V2", answers: { service: "drop_off", language: "cantonese" } });
  const other = boardCase({ id: "v3", reference: "VT-V3", answers: { service: "online", language: "english" } });
  const both = [v2, other];
  const ids = (filters) => filterCases(both, { status: "available", ...filters }, ALEX).map((c) => c.id).sort();
  assert.deepEqual(ids({ service: "Drop-off" }), ["v2"]);
  assert.deepEqual(ids({ language: "Cantonese" }), ["v2"]);
  assert.deepEqual(ids({ service: "Online" }), ["v3"]);
  const html = renderStaffBoard(both, PEOPLE, { person: ALEX, filters: { status: "available" } });
  assert.ok(!html.includes("drop_off") && !html.includes("cantonese"));
  assert.equal([...html.matchAll(/data-filter="service" data-value="Drop-off"/g)].length, 1);
  assert.equal([...html.matchAll(/data-filter="language" data-value="Cantonese"/g)].length, 1);
  const shown = renderStaffBoard(both, PEOPLE, { person: ALEX, filters: { status: "available", service: "Drop-off" } });
  assert.match(shown, /VT-V2/);
  assert.doesNotMatch(shown, /VT-V3/);
});

test("the board names the workflow and no taxpayer", () => {
  const html = board({ person: ALEX, filters: { status: "review" } });
  assert.match(html, /Drop-off/);
  assert.match(html, /Cantonese/);
  assert.match(html, new RegExp(describeStage("review_ready").label));
  // Alex prepared case-3, so the review claim is refused in place, with why.
  assert.match(html, /VT-CCCC-3333[\s\S]*prepared this case/i);
  const withIdentifiers = renderStaffBoard(
    [
      boardCase({
        answers: {
          service: "drop_off",
          language: "english",
          tp_first_name: "Mei",
          tp_last_name: "Chen",
          addr_street: "123 Arch Street",
          addr_zip: "19107",
        },
      }),
    ],
    PEOPLE,
    { person: ALEX },
  );
  for (const identifier of ["Mei", "Chen", "Arch Street", "19107"])
    assert.ok(!withIdentifiers.includes(identifier), identifier);
  assert.doesNotMatch(withIdentifiers, /\$/);
  assert.doesNotMatch(withIdentifiers, /refund|routing|deposit/i);
});

test("the board draws tabs with counts, a search box and one table", () => {
  const now = new Date(2026, 8, 14, 12, 0).getTime();
  const html = board({ person: ALEX, filters: { status: "review" }, now });
  // Tabs keep the filter hook and say how many each holds.
  for (const [value, count] of [["available", 1], ["preparation", 1], ["review", 2]])
    assert.match(
      html,
      new RegExp(
        `data-action="set-board-filter" data-filter="status" data-value="${value}" aria-pressed="${value === "review"}"[^>]*>[^<]*<span class="tab-count">${count}</span>`,
      ),
    );
  assert.match(html, /Showing 2 of 5 cases/);
  assert.match(html, /<form id="board-search-form"[^>]*role="search"/);
  assert.match(html, /<input id="field-board-search" name="boardSearch" type="search"/);
  assert.match(html, /<table class="board-table">/);
  assert.equal((html.match(/<tr class="board-row/g) ?? []).length, 2);
  // Mine / Everyone shows on the waiting tabs only.
  assert.match(html, /data-filter="assignment" data-value="mine"/);
  assert.doesNotMatch(board({ person: ALEX }), /data-filter="assignment"/);
  // The current persona reads as "You", and their rows are marked and first.
  assert.match(html, /<tr class="board-row own">[\s\S]*?VT-CCCC-3333/);
  assert.match(html, /<strong class="you">You<\/strong>/);
  assert.match(html, /Unassigned/);
  // Dates read as days (built in local time, so any time zone agrees).
  const dated = renderStaffBoard(
    [boardCase({ updatedAt: new Date(2026, 8, 12, 9, 0).toISOString() })],
    PEOPLE,
    { person: ALEX, now },
  );
  assert.match(dated, /2 days ago/);
  // Actions: Claim review for a reviewer; Open when nothing can be claimed.
  const morgan = board({ person: MORGAN, filters: { status: "review" }, now });
  assert.match(morgan, /data-case-action="CLAIM_REVIEW" data-case-id="case-3"/);
  assert.match(morgan, /data-action="open-case" data-case-id="case-4"[^>]*>Open</);
  // Dropped columns stay dropped.
  assert.doesNotMatch(html, /Work needed|Requires|Last reminded/);
});

// A re-render mid-keystroke (a realtime update, a notice, a persona click)
// must not wipe out what somebody is typing into the board search box (final
// review, finding 3): the box shows the draft when the wiring layer passes
// one, and only falls back to the saved search otherwise.
test("the search box shows the in-progress draft over the saved search", () => {
  const withDraft = board({ person: ALEX, filters: { search: "VT-AAAA" }, searchDraft: "VT-Z" });
  assert.match(withDraft, /<input id="field-board-search" name="boardSearch" type="search" value="VT-Z"/);
  // An empty draft (every character deleted) still wins over the saved search.
  const emptyDraft = board({ person: ALEX, filters: { search: "VT-AAAA" }, searchDraft: "" });
  assert.match(emptyDraft, /<input id="field-board-search" name="boardSearch" type="search" value=""/);
  // No draft at all: the saved search shows, exactly as before.
  const noDraft = board({ person: ALEX, filters: { search: "VT-AAAA" } });
  assert.match(noDraft, /<input id="field-board-search" name="boardSearch" type="search" value="VT-AAAA"/);
  // The submit button carries a stable id so the wiring layer can restore
  // focus to the field after a search or a clear.
  assert.match(noDraft, /<button id="board-search-submit" class="btn secondary" type="submit">/);
});

test("search results replace the tab, and empty states say what to do", () => {
  const found = board({ person: ALEX, filters: { status: "review", search: "eeee" } });
  assert.match(found, /Search results/);
  assert.match(found, /Showing 1 of 5 cases/);
  assert.ok(shows(found, "VT-EEEE-5555"), "a closed case is reachable by search");
  assert.match(found, /aria-pressed="false"[^>]*>Waiting for review/);
  assert.match(found, /data-action="set-board-filter" data-filter="search" data-value=""/);

  const none = board({ person: ALEX, filters: { search: "ZZZZ" } });
  assert.match(none, /No case matches “ZZZZ”\./);
  assert.match(none, /data-action="clear-board-filters"/);

  const quiet = renderStaffBoard([], PEOPLE, { person: ALEX });
  assert.match(quiet, /Nothing to claim right now/);
  const mineOnly = board({ person: MORGAN, filters: { status: "preparation", assignment: "mine" } });
  assert.match(mineOnly, /Nothing of yours is waiting for preparation\./);
  const narrowed = board({ person: ALEX, filters: { language: "Polish" } });
  assert.match(narrowed, /Nothing on this tab matches these filters\./);
  assert.match(narrowed, /data-action="clear-board-filters"/);
  // The finished-case hint is always there.
  assert.match(quiet, /find one by its Application ID/);
});

test("reminders are shown on the case page, not the board", () => {
  assert.doesNotMatch(board({ person: ALEX, filters: { status: "review" } }), /Last reminded/);

  const reminded = renderStaffCase(
    staffCase({
      lastRemindedAt: "2026-09-11T14:00:00.000Z",
      lastRemindedByPersonId: "sam",
    }),
    ALEX,
  );
  assert.match(reminded, /Last reminded<\/span><strong>Sep 11[^<]*by Sam/);
  assert.match(renderStaffCase(staffCase(), ALEX), /Last reminded<\/span><strong>Not reminded yet/);
  // Sending a reminder is the office's own screen, not this one.
  assert.doesNotMatch(reminded, /data-case-action="REMIND"/);
});

test("a claim is offered to the eligible volunteer and explained to everyone else", () => {
  const readyToPrepare = staffCase({
    stage: "preparation_ready",
    preparerId: null,
    participants: [],
    preparationVersion: 0,
  });
  const forAlex = renderStaffCase(readyToPrepare, ALEX);
  assert.match(forAlex, /data-case-action="CLAIM_PREPARATION"/);
  assert.doesNotMatch(forAlex, /Needs preparation eligibility/);

  const forMorgan = renderStaffCase(readyToPrepare, MORGAN);
  assert.doesNotMatch(forMorgan, /data-case-action="CLAIM_PREPARATION"/);
  assert.match(forMorgan, /Needs preparation eligibility\./);

  const forSam = renderStaffCase(readyToPrepare, SAM);
  assert.doesNotMatch(forSam, /data-case-action="CLAIM_PREPARATION"/);
  assert.match(forSam, /Needs preparation eligibility\./);

  // Already claimed: nobody may claim it again, and the screen says why.
  const claimed = renderStaffCase(
    staffCase({ stage: "preparation_ready", preparerId: "alex" }),
    MORGAN,
  );
  assert.doesNotMatch(claimed, /data-case-action="CLAIM_PREPARATION"/);
  assert.match(claimed, /Another volunteer has already claimed preparation\./);

  // The review side, with the same two answers.
  const readyToReview = staffCase({
    stage: "review_ready",
    preparationVersion: 1,
    preparerId: "alex",
    participants: ["alex"],
  });
  assert.match(renderStaffCase(readyToReview, MORGAN), /data-case-action="CLAIM_REVIEW"/);
  const samReviews = renderStaffCase(readyToReview, SAM);
  assert.doesNotMatch(samReviews, /data-case-action="CLAIM_REVIEW"/);
  assert.match(samReviews, /Needs review eligibility\./);
  const takenReview = renderStaffCase(
    staffCase({ stage: "review_ready", preparerId: "alex", reviewerId: "morgan" }),
    MORGAN,
  );
  assert.doesNotMatch(takenReview, /data-case-action="CLAIM_REVIEW"/);
  assert.match(takenReview, /Another volunteer has already claimed the review\./);
});

test("the board refuses a self-review with the same words the case does", () => {
  const ownPreparation = [
    boardCase({
      id: "case-9",
      reference: "VT-FFFF-9999",
      stage: "review_ready",
      preparationVersion: 1,
      preparerId: "alex",
    }),
  ];
  const capablePreparer = {
    id: "alex",
    name: "Alex",
    capabilities: ["prepare", "review"],
  };
  const own = renderStaffBoard(ownPreparation, PEOPLE, {
    person: capablePreparer,
    filters: { status: "review" },
  });
  assert.doesNotMatch(own, /data-case-action="CLAIM_REVIEW"/);
  assert.match(own, /You prepared this case, so you cannot review it\./);
  // Another volunteer sees the button on the very same row.
  assert.match(
    renderStaffBoard(ownPreparation, PEOPLE, {
      person: MORGAN,
      filters: { status: "review" },
    }),
    /data-case-action="CLAIM_REVIEW"/,
  );
});

test("a presenter with no persona reads the board and acts on nothing", () => {
  const html = board({ person: null });
  assert.match(html, /This account isn(?:'|&#39;)t linked to a volunteer yet\. Ask your site coordinator\./);
  assert.match(html, /read-only/i);
  assert.doesNotMatch(html, /data-case-action=/);
  // Filters and navigation still work without a persona.
  assert.match(html, /data-action="set-board-filter"/);
  assert.match(html, /data-action="open-case" data-case-id="case-1"/);

  const one = renderStaffCase(staffCase({ stage: "preparation_ready", preparerId: null }), null);
  assert.doesNotMatch(one, /data-case-action=/);
  assert.match(one, /This account isn(?:'|&#39;)t linked to a volunteer yet\. Ask your site coordinator\./);
});

test("the preparer's documents and hand-off, and nobody else's", () => {
  const withRequests = staffCase({
    requests: [
      {
        id: "req-open",
        title: "Mileage record",
        message: "Please add the fictional sample.",
        status: "open",
        createdAt: "2026-09-12T15:00:00.000Z",
      },
      {
        id: "req-sent",
        title: "Second page",
        message: "The second page is missing.",
        status: "awaiting_verification",
        createdAt: "2026-09-12T15:30:00.000Z",
      },
    ],
    documents: [
      {
        id: "doc-1",
        requestId: "req-sent",
        filename: "demo-mileage-record-2025.pdf",
        source: "client",
        createdAt: "2026-09-12T16:00:00.000Z",
      },
    ],
  });
  const forAlex = renderStaffCase(withRequests, ALEX);
  assert.match(forAlex, /data-case-action="REQUEST_DOCUMENT"/);
  assert.match(forAlex, /name="title"/);
  assert.match(forAlex, /name="message"/);
  assert.match(
    forAlex,
    /data-case-action="VERIFY_DOCUMENT" data-request-id="req-sent"/,
  );
  // Only the answered request can be verified.
  assert.ok(!forAlex.includes('data-case-action="VERIFY_DOCUMENT" data-request-id="req-open"'));
  assert.match(
    forAlex,
    /data-case-action="ESCALATE_CONTACT" data-request-id="req-open"/,
  );
  assert.match(forAlex, /name="reason"/);
  assert.match(forAlex, /Waiting for the client/);
  assert.match(forAlex, /Received, not verified yet/);

  // A case whose request already has an open office task is not escalated twice.
  const escalated = renderStaffCase(
    staffCase({
      requests: withRequests.requests,
      documents: withRequests.documents,
      followups: [
        {
          id: "task-1",
          requestId: "req-open",
          assigneeId: "sam",
          status: "open",
          reason: "No response for a week",
        },
      ],
    }),
    ALEX,
  );
  assert.doesNotMatch(escalated, /data-case-action="ESCALATE_CONTACT"/);
  assert.match(escalated, /The office is already contacting the client/);

  // Another volunteer gets the reason, not the controls.
  const forMorgan = renderStaffCase(withRequests, MORGAN);
  for (const action of ["REQUEST_DOCUMENT", "VERIFY_DOCUMENT", "ESCALATE_CONTACT"])
    assert.ok(!forMorgan.includes(`data-case-action="${action}"`), action);
  assert.match(forMorgan, /Needs preparation eligibility\./);
});

test("two open requests get two forms that cannot be confused", () => {
  const html = renderStaffCase(
    staffCase({
      requests: [
        {
          id: "req-first",
          title: "Mileage record",
          message: "Please add the fictional sample.",
          status: "open",
          createdAt: "2026-09-12T15:00:00.000Z",
        },
        {
          id: "req-second",
          title: "Second page",
          message: "The second page is missing.",
          status: "open",
          createdAt: "2026-09-12T15:30:00.000Z",
        },
      ],
    }),
    ALEX,
  );
  // Each escalation form names its own request, in the button's dataset and in
  // the hidden field, so whichever one is submitted carries the right id.
  for (const id of ["req-first", "req-second"]) {
    assert.match(
      html,
      new RegExp(`data-case-action="ESCALATE_CONTACT" data-request-id="${id}"`),
      id,
    );
    assert.match(
      html,
      new RegExp(`<input type="hidden" name="requestId" value="${id}">`),
      id,
    );
  }
  // And each `reason` box has its own id, which is what lets the cursor go back
  // to the box it came from after a re-render (see `describeFocus`).
  const ids = [...html.matchAll(/<textarea id="([^"]+)" name="reason"/g)].map(
    (match) => match[1],
  );
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2, "the two boxes do not share an id");
  for (const id of ids) assert.match(id, /^field-req-(first|second)-reason$/);
  // The labels point at their own box, not at the first one.
  for (const id of ids)
    assert.match(html, new RegExp(`<label class="field" for="${id}">`));
});

test("the hand-off to review waits for the intake checks and the documents", () => {
  const ready = renderStaffCase(staffCase(), ALEX);
  assert.match(
    ready,
    /data-case-action="SUBMIT_REVIEW"[^>]*>[\s\S]{0,400}Record that preparation is complete in TaxSlayer/,
  );
  assert.doesNotMatch(ready, /data-case-action="SUBMIT_REVIEW" [^>]*disabled/);
  assert.match(ready, /prepared by hand in TaxSlayer/);

  const blocked = renderStaffCase(
    staffCase({
      intakeVerified: false,
      requests: [
        {
          id: "req-open",
          title: "Mileage record",
          message: "Please add it.",
          status: "open",
          createdAt: "2026-09-12T15:00:00.000Z",
        },
      ],
    }),
    ALEX,
  );
  assert.match(blocked, /data-case-action="SUBMIT_REVIEW"[^>]*disabled/);
  assert.match(blocked, /has not recorded the intake checks yet/);
  assert.match(blocked, /1 document request is still open or unverified\./);
});

test("corrections are shown to the preparer, who resubmits with a resolution", () => {
  const corrected = staffCase({
    stage: "corrections_required",
    preparationVersion: 1,
    reviews: [
      {
        id: "review-1",
        preparationVersion: 1,
        reviewerId: "morgan",
        status: "corrections_requested",
        findings: "The household size does not match the intake answers.",
        resolution: null,
        clientContactStatus: null,
        createdAt: "2026-09-12T16:00:00.000Z",
        decidedAt: "2026-09-12T17:00:00.000Z",
      },
    ],
  });
  const forAlex = renderStaffCase(corrected, ALEX);
  assert.match(forAlex, /The household size does not match the intake answers\./);
  assert.match(forAlex, /data-case-action="RESUBMIT_REVIEW"/);
  assert.match(forAlex, /name="resolution"/);
  assert.match(
    forAlex,
    /data-case-action="RESUBMIT_REVIEW"[^>]*>[\s\S]{0,400}Record that the corrections are complete in TaxSlayer/,
  );
  assert.match(forAlex, /Corrections requested/);
  assert.doesNotMatch(forAlex, /data-case-action="SUBMIT_REVIEW"/);
  assert.doesNotMatch(forAlex, /data-case-action="REQUEST_CORRECTIONS"/);

  // The reviewer who asked for them cannot make them.
  const forMorgan = renderStaffCase(corrected, MORGAN);
  assert.doesNotMatch(forMorgan, /data-case-action="RESUBMIT_REVIEW"/);
  assert.match(forMorgan, /Needs preparation eligibility\./);

  // A resubmission is blocked by an unverified document, like the first one.
  const waiting = renderStaffCase(
    staffCase({
      stage: "corrections_required",
      preparationVersion: 1,
      reviews: corrected.reviews,
      requests: [
        {
          id: "req-open",
          title: "Mileage record",
          message: "Please add it.",
          status: "awaiting_verification",
          createdAt: "2026-09-12T15:00:00.000Z",
        },
      ],
    }),
    ALEX,
  );
  assert.match(waiting, /data-case-action="RESUBMIT_REVIEW"[^>]*disabled/);
  assert.match(waiting, /1 document request is still open or unverified\./);
});

test("the assigned reviewer decides, and the decision is never a filing", () => {
  const reviewing = staffCase({
    stage: "reviewing",
    preparationVersion: 1,
    reviewerId: "morgan",
    reviews: [
      {
        id: "review-1",
        preparationVersion: 1,
        reviewerId: "morgan",
        status: "active",
        findings: null,
        resolution: null,
        clientContactStatus: null,
        createdAt: "2026-09-12T16:00:00.000Z",
        decidedAt: null,
      },
    ],
  });
  const forMorgan = renderStaffCase(reviewing, MORGAN);
  assert.match(forMorgan, /data-action="open-request-corrections"/);
  assert.match(forMorgan, /data-case-action="APPROVE_REVIEW"/);
  assert.match(
    forMorgan,
    /records the result of the external review; it is not signing or filing/i,
  );
  assert.match(forMorgan, /Version 1/);

  // The preparer, and any other reviewer, get the reason instead.
  const forAlex = renderStaffCase(reviewing, ALEX);
  assert.doesNotMatch(forAlex, /data-case-action="APPROVE_REVIEW"/);
  assert.match(forAlex, /You prepared this case, so you cannot review it\./);
  const other = renderStaffCase(reviewing, {
    id: "riley",
    name: "Riley",
    capabilities: ["review"],
  });
  assert.doesNotMatch(other, /data-case-action="REQUEST_CORRECTIONS"/);
  assert.match(other, /Only the assigned reviewer records a review decision\./);
});

test("the client conversation is recorded once, by the reviewer, while it is pending", () => {
  const approved = (contact = {}) =>
    staffCase({
      stage: "review_approved",
      preparationVersion: 1,
      reviewerId: "morgan",
      reviews: [
        {
          id: "review-1",
          preparationVersion: 1,
          reviewerId: "morgan",
          status: "approved",
          findings: null,
          resolution: null,
          clientContactStatus: "pending",
          clientContactOutcome: null,
          clientContactNote: null,
          createdAt: "2026-09-12T16:00:00.000Z",
          decidedAt: "2026-09-12T18:00:00.000Z",
          clientContactedAt: null,
          ...contact,
        },
      ],
    });
  const pending = renderStaffCase(approved(), MORGAN);
  assert.match(pending, /data-case-action="RECORD_REVIEW_CONTACT"/);
  assert.match(pending, /name="outcome"/);
  assert.match(pending, /name="note"/);
  for (const outcome of ["no_answer", "reached", "no_further_contact", "closure_requested"])
    assert.match(pending, new RegExp(`value="${outcome}"`), outcome);
  assert.match(pending, /Recording an attempt never closes the case/);
  assert.doesNotMatch(pending, /data-case-action="CLOSE_CASE"/);

  // Once it is completed the form is gone, and the outcome is on the record.
  const done = renderStaffCase(
    approved({
      clientContactStatus: "completed",
      clientContactOutcome: "reached",
      clientContactNote: "Explained the next step.",
      clientContactedAt: "2026-09-13T15:00:00.000Z",
    }),
    MORGAN,
  );
  assert.doesNotMatch(done, /data-case-action="RECORD_REVIEW_CONTACT"/);
  assert.match(done, /Spoke with the client/);
  assert.match(done, /Explained the next step\./);

  // Pending, but the wrong person.
  const forAlex = renderStaffCase(approved(), ALEX);
  assert.doesNotMatch(forAlex, /data-case-action="RECORD_REVIEW_CONTACT"/);
  assert.match(forAlex, /You prepared this case, so you cannot review it\./);
  const forSam = renderStaffCase(approved(), SAM);
  assert.doesNotMatch(forSam, /data-case-action="RECORD_REVIEW_CONTACT"/);
  assert.match(forSam, /Needs review eligibility\./);
});

test("follow-up work is shown but never acted on from this screen", () => {
  const html = renderStaffCase(
    staffCase({
      followups: [
        {
          id: "task-1",
          requestId: "req-open",
          assigneeId: "sam",
          status: "open",
          reason: "No response for a week",
          resolutionNote: null,
        },
      ],
      contacts: [
        contactEntry({
          followupId: "task-1",
          loggedByPersonId: "sam",
          outcome: "no_answer",
          note: "Left a message on the mobile number.",
        }),
      ],
    }),
    ALEX,
  );
  assert.match(html, /Open with the office/);
  assert.match(html, /No response for a week/);
  // The task lists its linked contacts by their summary lines.
  const followup = html.slice(html.indexOf('id="case-panel-followup"'), html.indexOf('id="case-panel-contacts"'));
  assert.match(followup, /Contacts so far/);
  assert.match(followup, /Sam → client, phone — Go over tax return — No answer\. Note: Left a message on the mobile number\./);
  for (const action of ["RECORD_CONTACT", "RESOLVE_FOLLOWUP", "REMIND", "CLOSE_CASE"])
    assert.ok(!html.includes(`data-case-action="${action}"`), action);
  // Nothing on this tab logs a contact: that is the office's, or the Contacts tab's.
  assert.doesNotMatch(followup, /contact-form/);
});

test("internal notes stay in the internal history, never in the client's", () => {
  const html = renderStaffCase(
    staffCase({
      stage: "corrections_required",
      preparationVersion: 1,
      reviews: [
        {
          id: "review-1",
          preparationVersion: 1,
          reviewerId: "morgan",
          status: "corrections_requested",
          findings: "Household size is wrong on line 6.",
          resolution: "Corrected the household size.",
          clientContactStatus: null,
          createdAt: "2026-09-12T16:00:00.000Z",
          decidedAt: "2026-09-12T17:00:00.000Z",
        },
      ],
      internalHistory: [
        { id: "e1", action: "REQUEST_CORRECTIONS", createdAt: "2026-09-12T17:00:00.000Z" },
      ],
      history: [
        {
          id: "c1",
          message:
            "The reviewer asked your preparer to make corrections. No action is needed from you right now.",
          createdAt: "2026-09-12T17:00:00.000Z",
        },
      ],
    }),
    ALEX,
  );
  assert.match(html, /Internal history — staff only/);
  assert.match(html, /asked the preparer for corrections/i);
  const clientSection = html.slice(html.indexOf('data-role="client-history"'));
  assert.ok(clientSection.length > 0);
  assert.match(clientSection, /No action is needed from you right now\./);
  assert.ok(!clientSection.includes("Household size is wrong"), "no findings");
  assert.ok(!clientSection.includes("Corrected the household size"), "no resolution");
});

test("findings, notes and names are escaped on the way out", () => {
  const nasty = '<script>alert("x")</script>';
  const html = renderStaffCase(
    decorateStaffCase(
      {
        ...staffCase({
          stage: "review_approved",
          preparationVersion: 1,
          reviewerId: "morgan",
        }),
        reference: `VT-AB2C-DE3F${nasty}`,
        answers: { service: nasty, language: "English" },
        requests: [
          {
            id: 'req"1',
            title: nasty,
            message: nasty,
            status: "open",
            createdAt: "2026-09-12T15:00:00.000Z",
          },
        ],
        followups: [
          {
            id: "task-1",
            requestId: 'req"1',
            assigneeId: "sam",
            status: "open",
            reason: nasty,
          },
        ],
        reviews: [
          {
            id: "review-1",
            preparationVersion: 1,
            reviewerId: "morgan",
            status: "approved",
            findings: nasty,
            resolution: nasty,
            clientContactStatus: "completed",
            clientContactOutcome: "reached",
            clientContactNote: nasty,
            createdAt: "2026-09-12T16:00:00.000Z",
            decidedAt: "2026-09-12T18:00:00.000Z",
            clientContactedAt: "2026-09-13T15:00:00.000Z",
          },
        ],
        history: [{ id: "c1", message: nasty, createdAt: "2026-09-12T17:00:00.000Z" }],
        internalHistory: [
          { id: "e1", action: nasty, createdAt: "2026-09-12T17:00:00.000Z" },
        ],
      },
      PEOPLE,
    ),
    { id: "morgan", name: nasty, capabilities: ["review"] },
  );
  assert.ok(!html.includes("<script>"), "no injected element survives");
  assert.match(html, /&lt;script&gt;/);

  const boardHtml = renderStaffBoard(
    [
      decorateStaffCase(
        {
          id: 'case"1',
          reference: nasty,
          stage: "preparation_ready",
          answers: { service: nasty, language: nasty },
          updatedAt: "2026-09-12T16:30:00.000Z",
        },
        PEOPLE,
      ),
    ],
    PEOPLE,
    { person: ALEX },
  );
  assert.ok(!boardHtml.includes("<script>"));
  assert.match(boardHtml, /&lt;script&gt;/);
});

test("pending actions are disabled while one is in flight, and a conflict is shown", () => {
  const busy = renderStaffCase(
    staffCase({ stage: "preparation_ready", preparerId: null, participants: [] }),
    ALEX,
    { busy: true },
  );
  assert.match(busy, /data-case-action="CLAIM_PREPARATION"[^>]*disabled/);
  const idle = renderStaffCase(
    staffCase({ stage: "preparation_ready", preparerId: null, participants: [] }),
    ALEX,
    { busy: false },
  );
  assert.doesNotMatch(idle, /data-case-action="CLAIM_PREPARATION"[^>]*disabled/);

  const conflicted = renderStaffCase(staffCase(), ALEX, {
    error: {
      code: "CONFLICT",
      message: "Someone else changed this case. The newest version is shown — check it and try again.",
    },
  });
  assert.match(conflicted, /Someone else changed this case/);
  assert.match(conflicted, /role="alert"/);
});

test("an applicant-shaped record offers no case action at all", () => {
  // Exactly what `getCase` returns to an applicant: no participants, no
  // reviews, no internal history.
  const clientShaped = {
    id: "case-a",
    reference: "VT-AB2C-DE3F",
    stage: "preparing",
    revision: 4,
    preparationVersion: 0,
    answers: { service: "Drop-off", language: "English" },
    intakeVerified: true,
    preparerId: "alex",
    reviewerId: null,
    requests: [
      {
        id: "req-1",
        title: "Mileage record",
        message: "Please add it.",
        status: "awaiting_verification",
        createdAt: "2026-09-12T15:00:00.000Z",
      },
    ],
    documents: [],
    history: [{ id: "c1", message: "A volunteer is preparing your return.", createdAt: "2026-09-12T15:00:00.000Z" }],
  };
  const html = renderStaffCase(decorateStaffCase(clientShaped, PEOPLE), ALEX);
  assert.doesNotMatch(html, /data-case-action=/);
  assert.match(html, /Staff sections are not loaded/);
  assert.match(html, /A volunteer is preparing your return\./);
  // A board row is the same shape, and is equally inert.
  assert.doesNotMatch(renderStaffCase(boardCase(), ALEX), /data-case-action=/);
});

test("eligibility answers the same way for a board row and a full case", () => {
  const person = { id: "alex", name: "Alex", capabilities: ["prepare", "review"] };
  const row = staffEligibility(
    { stage: "review_ready", preparerId: "alex", reviewerId: null },
    person,
  );
  const full = staffEligibility(
    {
      stage: "review_ready",
      preparerId: "alex",
      reviewerId: null,
      participants: ["alex"],
    },
    person,
  );
  assert.equal(row.claimReview.allowed, false);
  assert.equal(row.claimReview.reason, full.claimReview.reason);
  assert.equal(row.participant, true, "a row knows its current preparer");

  // A former preparer is only visible on the full record, which is why the
  // database is the authority: the row lets the claim through and the server
  // answers SELF_REVIEW.
  const formerOnRow = staffEligibility(
    { stage: "review_ready", preparerId: "casey", reviewerId: null },
    person,
  );
  assert.equal(formerOnRow.claimReview.allowed, true);
  assert.equal(
    staffEligibility(
      {
        stage: "review_ready",
        preparerId: "casey",
        reviewerId: null,
        participants: ["alex", "casey"],
      },
      person,
    ).claimReview.allowed,
    false,
  );

  // Nothing is allowed without a persona.
  const nobody = staffEligibility({ stage: "preparation_ready" }, null);
  for (const decision of [
    "claimPreparation",
    "claimReview",
    "preparationWork",
    "reviewDecision",
    "reviewContact",
  ]) {
    assert.equal(nobody[decision].allowed, false, decision);
    assert.match(nobody[decision].reason, /isn't linked to a volunteer yet/);
  }
});

// ---------------------------------------------------------------------------
// The case page frame (Task 2)
// ---------------------------------------------------------------------------

test("case tabs follow the ARIA tab pattern and keep every panel in the page", () => {
  assert.deepEqual(CASE_TABS.map(([key]) => key), ["overview", "intake", "documents", "followup", "contacts", "history"]);
  const panels = CASE_TABS.map(([key, label]) => [key, label, `<p>${key} body</p>`]);
  const html = caseTabs(panels, "documents", { documents: 2 });
  assert.match(html, /<div class="case-tabs" role="tablist" aria-label="Case sections">/);
  assert.match(html, /<button type="button" role="tab" id="case-tab-documents" aria-controls="case-panel-documents" aria-selected="true" tabindex="0" class="case-tab selected" data-action="set-case-tab" data-value="documents">Documents <span class="tab-count">2<\/span><\/button>/);
  assert.match(html, /id="case-tab-overview" aria-controls="case-panel-overview" aria-selected="false" tabindex="-1"/);
  assert.match(html, /<div role="tabpanel" id="case-panel-documents" aria-labelledby="case-tab-documents" class="case-panel" tabindex="0">/);
  assert.match(html, /<div role="tabpanel" id="case-panel-overview" aria-labelledby="case-tab-overview" class="case-panel" tabindex="0" hidden>/);
  for (const [key] of CASE_TABS) assert.match(html, new RegExp(`${key} body`));
  // An unknown tab falls back to the first.
  assert.match(caseTabs(panels, "nonsense"), /id="case-tab-overview" aria-controls="case-panel-overview" aria-selected="true"/);
});

test("the lifecycle bar marks done, current and still-to-come steps", () => {
  const steps = (stage) =>
    [...lifecycleBar(stage).matchAll(/class="lifecycle-step ([a-z ]+)"/g)].map((m) => m[1]);
  assert.deepEqual(steps("preparing"), [
    "done", "done", "done", "current", "todo", "todo", "todo", "todo", "todo", "todo",
  ]);
  assert.deepEqual(steps("received")[0], "current");
  assert.deepEqual(steps("screening").slice(0, 3), ["done", "current", "todo"]);
  assert.deepEqual(steps("corrections_required")[3], "current amend");
  assert.deepEqual(steps("corrections_required").slice(0, 3), ["done", "done", "done"]);
  assert.match(lifecycleBar("corrections_required"), /Corrections in progress/);
  assert.match(lifecycleBar("reviewing"), /aria-current="step"[^>]*>[\s\S]*?Review in progress/);
  assert.ok(steps("nonsense").every((s) => s === "todo"));
  // A draft is not on the path: it marks nothing, and does not claim a step.
  assert.ok(steps("draft").every((s) => s === "todo"));
  assert.doesNotMatch(lifecycleBar("draft"), /aria-current/);
  assert.doesNotMatch(lifecycleBar("draft"), /Closed/);
  assert.doesNotMatch(lifecycleBar("nonsense"), /Closed/);
  // Closed can happen at any stage, so nothing before it is claimed as done
  // or still to come: those steps are neutral, and Closed is the only current one.
  assert.deepEqual(steps("closed"), [...Array(10).fill("neutral"), "current"]);
  const labelsOf = (stage) =>
    [...lifecycleBar(stage).matchAll(/class="lifecycle-label">([^<]*)</g)].map((m) => m[1]);
  assert.equal(labelsOf("closed").at(-1), "Closed");
  assert.equal([...lifecycleBar("closed").matchAll(/aria-current="step"/g)].length, 1);
  assert.match(lifecycleBar("closed"), /aria-current="step"[^>]*>[\s\S]*?Closed/);
});

test("the lifecycle bar ends at Accepted and never draws Closed after it", () => {
  const steps = (record) =>
    [...lifecycleBar(record).matchAll(/class="lifecycle-step ([a-z ]+)"/g)].map((m) => m[1]);
  const labels = (record) =>
    [...lifecycleBar(record).matchAll(/class="lifecycle-label">([^<]*)</g)].map((m) => m[1]);
  const accepted = { stage: "accepted", federalMethod: "efile", stateMethod: "efile" };
  assert.deepEqual(steps(accepted), Array(10).fill("done"));
  assert.doesNotMatch(lifecycleBar(accepted), /aria-current/);
  assert.doesNotMatch(lifecycleBar(accepted), /Closed/);
  assert.deepEqual(steps("review_ready"), [
    ...Array(4).fill("done"), "current", ...Array(5).fill("todo"),
  ]);
  assert.ok(!labels("review_ready").includes("Closed"));
  const mixed = { stage: "accepted", federalMethod: "efile", stateMethod: "paper" };
  assert.deepEqual(labels(mixed).slice(8), [
    describeStage("efiled", "en", mixed).label,
    describeStage("accepted", "en", mixed).label,
  ]);
  assert.deepEqual(steps(mixed).slice(8), ["done", "done"]);
});

test("a closed case claims nothing, even when it came from a Hold", () => {
  const steps = (record) =>
    [...lifecycleBar(record).matchAll(/class="lifecycle-step ([a-z ]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    steps({ stage: "closed", holdOrigin: "awaiting_documents", documentsOrigin: "screening" }),
    [...Array(10).fill("neutral"), "current"],
  );
});

test("the lifecycle bar runs on to Ready to e-file and E-filed", () => {
  const steps = (stage) =>
    [...lifecycleBar(stage).matchAll(/class="lifecycle-step ([a-z ]+)"/g)].map((m) => m[1]);
  const ready = steps("ready_to_efile");
  assert.deepEqual(ready.slice(0, 7), Array(7).fill("done"));
  assert.equal(ready[7], "current");
  assert.deepEqual(ready.slice(8), ["todo", "todo"]);
  const bar = lifecycleBar("ready_to_efile");
  assert.match(bar, /Ready to e-file/);
  assert.match(bar, /E-filed/);
  assert.deepEqual(steps("efiled").slice(0, 8), Array(8).fill("done"));
  assert.equal(steps("efiled")[8], "current");
  assert.match(lifecycleBar("efiled"), /aria-current="step"[^>]*>[\s\S]*?E-filed/);
});

test("the lifecycle bar takes the record: Accepted, Rejected on E-filed, the method's name", () => {
  const steps = (record) =>
    [...lifecycleBar(record).matchAll(/class="lifecycle-step ([a-z ]+)"/g)].map((m) => m[1]);
  const labels = (record) =>
    [...lifecycleBar(record).matchAll(/class="lifecycle-label">([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(labels({ stage: "efiled" }).slice(7), [
    "Ready to e-file", "E-filed", "Accepted",
  ]);
  // Rejected shows on the E-filed step, marked like Corrections on Filing in progress.
  const rejected = steps({ stage: "rejected", federalMethod: "efile", stateMethod: "efile" });
  assert.deepEqual(rejected.slice(0, 8), Array(8).fill("done"));
  assert.equal(rejected[8], "current amend");
  assert.equal(rejected[9], "todo");
  assert.equal(
    labels({ stage: "rejected", federalMethod: "efile", stateMethod: "efile" })[8],
    "Rejected",
  );
  assert.match(
    lifecycleBar({ stage: "rejected", federalMethod: "efile", stateMethod: "efile" }),
    /aria-current="step"/,
  );
  // Accepted ends the path: every step is done and none is current.
  const accepted = steps({ stage: "accepted", federalMethod: "efile", stateMethod: "efile" });
  assert.deepEqual(accepted, Array(10).fill("done"));
  // The method's staff name; a case e-filed before methods keeps "E-filed".
  assert.equal(
    labels({ stage: "efiled", federalMethod: "efile", stateMethod: "paper" })[8],
    "E-filed, PA on paper",
  );
  assert.equal(labels({ stage: "efiled", federalMethod: null, stateMethod: null })[8], "E-filed");
  assert.equal(labels({ stage: "efiled" })[8], "E-filed");
});

test("the lifecycle bar shows Waiting for documents and Hold on the step they came from", () => {
  const steps = (record) =>
    [...lifecycleBar(record).matchAll(/class="lifecycle-step ([a-z ]+)"/g)].map((m) => m[1]);
  const labels = (record) =>
    [...lifecycleBar(record).matchAll(/class="lifecycle-label">([^<]*)</g)].map((m) => m[1]);
  // Asked for at Screening: Screening is the current step, named for the wait.
  const screening = { stage: "awaiting_documents", documentsOrigin: "screening" };
  assert.deepEqual(steps(screening).slice(0, 3), ["done", "current amend", "todo"]);
  assert.equal(labels(screening)[1], "Waiting for documents");
  // Asked for at Pending intake / filing.
  const filing = { stage: "awaiting_documents", documentsOrigin: "preparation_ready" };
  assert.equal(steps(filing)[2], "current amend");
  assert.equal(labels(filing)[2], "Waiting for documents");
  // A Hold from Ready to exit marks Ready to exit.
  const signing = { stage: "on_hold", holdOrigin: "review_approved" };
  assert.deepEqual(steps(signing).slice(0, 8), [...Array(6).fill("done"), "current amend", "todo"]);
  assert.equal(labels(signing)[6], "Hold");
  // A Hold from Waiting for documents marks the stage the documents were asked from.
  const chasing = { stage: "on_hold", holdOrigin: "awaiting_documents", documentsOrigin: "screening" };
  assert.equal(steps(chasing)[1], "current amend");
  assert.equal(labels(chasing)[1], "Hold");
  assert.match(lifecycleBar(chasing), /aria-current="step"/);
  // With no origin on the record nothing is claimed.
  assert.ok(steps({ stage: "on_hold" }).every((s) => s === "todo"));
});

test("Waiting for documents and Hold have staff sentences for the volunteer's next step", () => {
  assert.equal(stageWork("awaiting_documents").work, "The office is waiting for the client's documents.");
  assert.equal(stageWork("on_hold").work, "The office is trying to reach the client.");
  assert.equal(stageWork("awaiting_documents").needs, null);
  assert.equal(stageWork("on_hold").needs, null);
  const html = renderStaffCase(
    { id: "c", reference: "VT-W", stage: "awaiting_documents", documentsOrigin: "screening", participants: [], reviews: [], answers: {} },
    { id: "alex", name: "Alex", capabilities: ["prepare"] },
    {},
  );
  assert.match(html, /Your next step[\s\S]*The office is waiting for the client&#39;s documents\./);
});

test("an admin verifies the documents at Waiting for documents and at a documents Hold", () => {
  const sam = { id: "sam", name: "Sam", capabilities: ["admin"] };
  const alex = { id: "alex", name: "Alex", capabilities: ["prepare"], };
  const base = {
    id: "c", reference: "VT-W", participants: [], reviews: [], answers: {}, followups: [],
    requests: [{ id: "r1", title: "Photo ID", message: "Send it", status: "awaiting_verification", createdAt: "2026-10-01T12:00:00Z" }],
  };
  const verify = (record, person) =>
    renderStaffCase({ ...base, ...record }, person, {}).includes('data-case-action="VERIFY_DOCUMENT"');
  assert.equal(verify({ stage: "awaiting_documents", documentsOrigin: "screening" }, sam), true);
  assert.equal(verify({ stage: "on_hold", holdOrigin: "awaiting_documents", documentsOrigin: "screening" }, sam), true);
  // Not at a signing hold, not for a volunteer.
  assert.equal(verify({ stage: "on_hold", holdOrigin: "review_approved" }, sam), false);
  assert.equal(verify({ stage: "awaiting_documents", documentsOrigin: "screening" }, alex), false);
  assert.equal(staffEligibility({ stage: "awaiting_documents" }, sam).verifyIntakeDocument.allowed, true);
  assert.equal(staffEligibility({ stage: "preparing", preparerId: "sam" }, sam).verifyIntakeDocument.allowed, false);
});

test("a hold note or a close note renders escaped in the staff history", () => {
  const history = (action, detail) => ({ action, actorName: "Sam", detail, createdAt: "2026-10-01T12:00:00Z" });
  assert.equal(
    historySentence(history("PUT_ON_HOLD", { note: "<b>x</b>" })),
    "Sam put the case on hold. Note: <b>x</b>",
  );
  assert.equal(
    historySentence(history("CLOSE_CASE", { reason: "duplicate", note: "Same as VT-OTHER" })),
    "Sam closed the case. Reason: Duplicate. Note: Same as VT-OTHER",
  );
  // A close from before reasons existed has neither.
  assert.equal(historySentence(history("CLOSE_CASE", { reason: "free text from long ago" })), "Sam closed the case.");
  const html = historyPanel(
    {
      internalHistory: [history("PUT_ON_HOLD", { note: "<b>x</b>" }), history("CLOSE_CASE", { reason: "other", note: "<script>1</script>" })],
      history: [{ message: "PCDC is trying to reach you.", createdAt: "2026-10-01T12:00:00Z" }],
    },
    true,
  );
  assert.match(html, /Note: &lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /Note: &lt;script&gt;1&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<b>x<\/b>|<script>/);
  // The client's own list never carries the note.
  const clientList = html.slice(html.indexOf("What the client sees"));
  assert.doesNotMatch(clientList, /Note:/);
});

test("the stage work sentences name who does the next thing", () => {
  assert.equal(stageWork("screening").work, "The office is screening this application.");
  assert.equal(stageWork("received").work, "The office starts screening when an admin opens the case.");
  assert.equal(stageWork("ready_to_efile").work, "The office e-files the return.");
  assert.equal(
    stageWork("efiled").work,
    "The office records the answers from the IRS and Pennsylvania.",
  );
  assert.equal(
    stageWork("rejected").work,
    "A return was rejected. The site coordinator fixes it in TaxSlayer, and the office contacts the client.",
  );
  assert.equal(
    stageWork("accepted").work,
    "The returns are accepted or given to the client on paper. Nothing more is needed here.",
  );
  assert.equal(
    stageWork("review_approved").work,
    "The reviewer records the conversation with the client; the office records the client's signature.",
  );
  for (const stage of ["received", "screening", "ready_to_efile", "efiled", "rejected", "accepted"])
    assert.equal(stageWork(stage).needs, null, stage);
});

const ATTEMPTS = [
  {
    attempt: 2,
    filedAt: "2026-10-12T15:00:00.000Z",
    returns: [
      { returnKind: "state", method: "efile", result: null, answeredOn: null, rejectCode: null },
    ],
    notes: [],
  },
  {
    attempt: 1,
    filedAt: "2026-10-01T15:00:00.000Z",
    returns: [
      { returnKind: "federal", method: "efile", result: "accepted", answeredOn: "2026-10-03", rejectCode: null },
      { returnKind: "state", method: "efile", result: "rejected", answeredOn: "2026-10-04", rejectCode: "PA-INV-7" },
    ],
    notes: [
      { note: "Site coordinator to correct the SSN", recordedBy: "sam", recordedByName: "Sam", recordedAt: "2026-10-05T14:00:00.000Z" },
      { note: "<b>x</b> Client to bring the card", recordedBy: "sam", recordedByName: "Sam", recordedAt: "2026-10-06T14:00:00.000Z" },
    ],
  },
];

test("the Filing panel shows each filing, newest first, with its notes oldest first", () => {
  const html = filingPanel(staffCase({ stage: "rejected", filingAttempts: ATTEMPTS }));
  assert.match(html, /<h2[^>]*>Filing<\/h2>/);
  assert.ok(html.indexOf("Filing 2") < html.indexOf("Filing 1"));
  assert.match(html, /PA-INV-7/);
  assert.match(html, /2026-10-03/);
  assert.match(html, /Accepted/);
  assert.match(html, /Rejected/);
  assert.match(html, /Waiting for an answer/);
  assert.ok(html.indexOf("Site coordinator to correct the SSN") < html.indexOf("Client to bring the card"));
  assert.match(html, /Sam/);
  // A fix note is escaped, never parsed (Review Focus 3).
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt; Client to bring the card/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
});

test("the Filing panel renders nothing before E-filed, and reads a client-shaped record", () => {
  assert.equal(filingPanel(staffCase({ stage: "ready_to_efile" })), "");
  assert.equal(filingPanel(staffCase({ stage: "preparing" })), "");
  // The key is absent on a client record: it must not throw.
  const bare = filingPanel(staffCase({ stage: "efiled", federalMethod: "efile", stateMethod: "efile" }));
  assert.match(bare, /Filing/);
  assert.match(bare, /Waiting for an answer/);
});

test("the staff case page puts the Filing panel after the next step", () => {
  const html = renderStaffCase(
    staffCase({ stage: "rejected", filingAttempts: ATTEMPTS }),
    ALEX,
  );
  assert.ok(html.indexOf('id="next-step-title"') < html.indexOf(">Filing</h2>"));
  assert.match(html, /Site coordinator to correct the SSN/);
});

test("the new actions have their history sentences", () => {
  assert.equal(EVENT_SENTENCES.START_SCREENING, "started screening");
  assert.equal(EVENT_SENTENCES.MARK_READY_TO_EFILE, "recorded the client's signature");
  assert.equal(EVENT_SENTENCES.MARK_EFILED, "recorded that the return was e-filed");
  assert.equal(
    historySentence({ action: "MARK_EFILED", actorName: "Sam" }),
    "Sam recorded that the return was e-filed.",
  );
});

test("the filing actions have their history sentences", () => {
  assert.equal(EVENT_SENTENCES.RECORD_FILING_RESULT, "recorded the filing result");
  assert.equal(EVENT_SENTENCES.RETURN_TO_SIGNING, "returned the case to signing");
});

test("the case header names the case, its stage and its people", () => {
  const html = caseHeader(staffCase({ stage: "reviewing", preparerId: "alex", reviewerId: "morgan" }), MORGAN);
  assert.match(html, /<h2 id="case-title" tabindex="-1">VT-AB2C-DE3F<\/h2>/);
  assert.match(html, /class="badge prep"/);
  assert.match(html, /<ol class="lifecycle"/);
  assert.match(html, /Preparer<\/small> Alex/);
  assert.match(html, /Reviewer<\/small> <strong class="you">You<\/strong>/);
  assert.match(html, /Signed in as Morgan\./);
  assert.match(caseHeader(staffCase(), null), /This account isn(?:'|&#39;)t linked to a volunteer yet\. Ask your site coordinator\./);
});

test("a staff account's case header says who is signed in", () => {
  const riley = { id: "riley", name: "Riley Park", capabilities: ["prepare"] };
  const staff = caseHeader(staffCase(), riley, { access: "staff", personId: "riley", personName: "Riley Park" });
  assert.match(staff, /Signed in as Riley Park\./);
  assert.doesNotMatch(staff, /Acting as/);
  // The principal's own name stands in when the roster has not loaded yet.
  assert.match(
    caseHeader(staffCase(), null, { access: "staff", personId: "riley", personName: "Riley Park" }),
    /Signed in as Riley Park\./,
  );
});

test("case details keep the rows the story and the office read", () => {
  const html = caseDetails(staffCase({ intakeVerified: true, lastRemindedAt: "2026-09-11T14:00:00.000Z", lastRemindedByPersonId: "sam" }));
  for (const label of ["Stage", "Preparation version", "Intake checks", "Preparer", "Reviewer", "Last reminded", "Updated"])
    assert.match(html, new RegExp(`<div class="detail-row"><span>${label}</span>`), label);
  assert.match(html, /<span>Intake checks<\/span><strong>Recorded<\/strong>/);
  assert.match(html, /<span>Preparer<\/span><strong>Alex<\/strong>/);
});

// ---------------------------------------------------------------------------
// "Your next step", the corrections dialog and the tabbed case page (Task 3)
// ---------------------------------------------------------------------------

test("the preparer questionnaire's auto-fill button follows the switch, not the account", () => {
  const record = staffCase({ stage: "preparing" });
  const step = (ui, principal) => nextStep(record, staffEligibility(record, ALEX), { principal, ...ui });
  assert.match(step({ demoTools: true }, { access: "staff" }), /data-action="demo-fill"/, "staff account, switch on");
  assert.doesNotMatch(step({ demoTools: false }, { access: "presenter" }), /demo-fill/, "presenter, switch off");
  assert.doesNotMatch(step({}, { access: "presenter" }), /demo-fill/, "presenter, no switch given");
});

test("your next step offers the one action that fits, or says who the case waits on", () => {
  const step = (overrides, person) => {
    const record = staffCase(overrides);
    return nextStep(record, staffEligibility(record, person), {});
  };
  // Claim preparation.
  assert.match(step({ stage: "preparation_ready", preparerId: null, participants: [] }, ALEX), /data-case-action="CLAIM_PREPARATION"/);
  assert.doesNotMatch(step({ stage: "preparation_ready", preparerId: null, participants: [] }, MORGAN), /data-case-action=/);
  assert.match(step({ stage: "preparation_ready", preparerId: null, participants: [] }, MORGAN), /Needs preparation eligibility\./);
  // Record preparation complete (the preparer only).
  assert.match(step({ stage: "preparing" }, ALEX), /data-case-action="SUBMIT_REVIEW"/);
  // A volunteer who can prepare, but is not this case's preparer.
  const CASEY = { id: "casey", name: "Casey", capabilities: ["prepare"] };
  // `esc` turns an apostrophe into `&#39;`, like every other quoted refusal
  // reason on this page.
  assert.match(step({ stage: "preparing" }, CASEY), /Only this case&#39;s current preparer can do this work\./);
  assert.match(step({ stage: "preparing" }, MORGAN), /Needs preparation eligibility\./);
  // Claim review, and the self-review refusal.
  assert.match(step({ stage: "review_ready", preparerId: "alex", participants: ["alex"] }, MORGAN), /data-case-action="CLAIM_REVIEW"/);
  assert.match(step({ stage: "review_ready", preparerId: "alex", participants: ["alex"] }, ALEX), /You prepared this case, so you cannot review it\./);
  // Decide the review: approve here, corrections through the dialog.
  const deciding = step({ stage: "reviewing", preparerId: "alex", reviewerId: "morgan", participants: ["alex"] }, MORGAN);
  assert.match(deciding, /data-case-action="APPROVE_REVIEW"/);
  assert.match(deciding, /data-action="open-request-corrections"/);
  assert.doesNotMatch(deciding, /data-case-action="REQUEST_CORRECTIONS"/);
  // Corrections: the reviewer's words stay visible to everyone on the case.
  const correcting = step({
    stage: "corrections_required",
    reviews: [{ id: "r1", status: "corrections_requested", findings: "Fix the mileage.", preparationVersion: 1 }],
  }, ALEX);
  assert.match(correcting, /Corrections the reviewer asked for/);
  assert.match(correcting, /Fix the mileage\./);
  assert.match(correcting, /data-case-action="RESUBMIT_REVIEW"/);
  // Office intake stages and a closed case: no action, just the state.
  assert.doesNotMatch(step({ stage: "received" }, ALEX), /data-case-action=/);
  assert.match(step({ stage: "received" }, ALEX), /<h2 id="next-step-title" tabindex="-1">Your next step<\/h2>/);
  // No persona.
  assert.match(step({ stage: "preparing" }, null), /This account isn(?:'|&#39;)t linked to a volunteer yet\. Ask your site coordinator\./);
  // A case returned to signing after a rejection: no review conversation is due.
  const returned = step({ stage: "review_approved", federalMethod: "efile", stateMethod: "efile" }, MORGAN);
  assert.match(returned, /The client signs again\. The office then marks it ready to e-file\./);
  assert.doesNotMatch(returned, /reviewer records the conversation/);
  assert.match(
    step({ stage: "review_approved", federalMethod: null }, MORGAN),
    /The reviewer records the conversation with the client/,
  );
});

test("the staff case page is five tabs, with each action in exactly one place", () => {
  const html = renderStaffCase(staffCase({ stage: "reviewing", preparerId: "alex", reviewerId: "morgan", participants: ["alex"], reviews: [{ id: "r1", status: "open", preparationVersion: 1 }] }), MORGAN, { caseTab: "documents" });
  assert.match(html, /<h2 id="case-title" tabindex="-1">/);
  for (const [key] of CASE_TABS) assert.match(html, new RegExp(`id="case-panel-${key}"`));
  assert.match(html, /id="case-tab-documents" aria-controls="case-panel-documents" aria-selected="true"/);
  assert.match(html, /id="case-panel-overview"[^>]*hidden>[\s\S]*Your next step[\s\S]*Case details[\s\S]*Preparation milestones[\s\S]*Independent review/);
  assert.equal((html.match(/data-case-action="APPROVE_REVIEW"/g) ?? []).length, 1);
  assert.match(html, /id="case-panel-intake"[^>]*>[\s\S]*What the client told us/);
  assert.match(html, /id="case-panel-history"[^>]*>[\s\S]*History/);
});

test("the corrections dialog carries the form the action is built from", () => {
  const html = correctionsDialogBody({ busy: false });
  assert.match(html, /<form class="staff-form">/);
  assert.match(html, /<span>Corrections to send back to the preparer<\/span><textarea id="field-corrections-findings" name="findings"/);
  assert.match(html, /<button type="submit" class="btn primary full" data-case-action="REQUEST_CORRECTIONS"/);
  assert.match(html, /data-action="close-dialog"/);
  assert.match(correctionsDialogBody({ busy: true }), /data-case-action="REQUEST_CORRECTIONS"\s+disabled/);
  // A refused send is repeated inside the dialog, which would otherwise hide
  // it (the dialog is aria-modal, so the page's own alert behind it may not
  // be read); it carries role="alert" and is tied to the textarea.
  const refused = correctionsDialogBody({ error: { code: "CONFLICT", message: "Someone else changed this case." } });
  assert.match(refused, /<div class="notice error" role="alert" id="corrections-error">[\s\S]*Someone else changed this case\./);
  assert.match(refused, /<textarea id="field-corrections-findings" name="findings" required maxlength="2000" rows="4" aria-describedby="corrections-error">/);
  assert.doesNotMatch(correctionsDialogBody({}), /role="alert"/);
  assert.doesNotMatch(correctionsDialogBody({}), /aria-describedby/);
  // With a dialog open this is the only copy, so it carries the banner's
  // controls: Dismiss always, Try again only when the press can be re-sent.
  const notice = (html) => /<div class="notice error" role="alert" id="corrections-error">[\s\S]*?<\/div><\/div><\/div>/.exec(html)?.[0] ?? "";
  assert.match(notice(refused), /<div class="conflict-choices">[\s\S]*data-action="dismiss-error"/);
  assert.doesNotMatch(notice(refused), /data-action="retry-action"/);
  const retryable = correctionsDialogBody({ error: { code: "OFFLINE", message: "Network error. Please try again later." }, retryable: true });
  assert.match(notice(retryable), /<div class="conflict-choices"><button[^>]*data-action="retry-action"[^>]*>Try again<\/button><button[^>]*data-action="dismiss-error"[^>]*>Dismiss<\/button><\/div>/);
});

test("internal history reads as sentences, with who did it", () => {
  const record = staffCase({
    internalHistory: [
      { id: "e1", action: "CLAIM_PREPARATION", actorPersonId: "alex", createdAt: "2026-09-12T15:00:00.000Z" },
      { id: "e2", action: "LOAD_SOMETHING_NEW", actorPersonId: null, createdAt: "2026-09-12T16:00:00.000Z" },
    ],
  });
  assert.equal(record.internalHistory[0].actorName, "Alex");
  assert.equal(historySentence(record.internalHistory[0]), "Alex claimed preparation.");
  // An event this table does not know still reads as words, never as a code.
  assert.equal(historySentence(record.internalHistory[1]), "Load something new.");
  for (const action of CASE_ACTIONS) assert.ok(EVENT_SENTENCES[action], action);
  assert.equal(
    historySentence({ action: "RECORD_FILING_RESULT", actorName: "Sam" }),
    "Sam recorded the filing result.",
  );
  assert.equal(
    historySentence({ action: "RETURN_TO_SIGNING", actorName: "Sam" }),
    "Sam returned the case to signing.",
  );
  // Design D12's four sentences. The client's withdrawal has no staff actor.
  assert.equal(historySentence({ action: "REQUEST_DOCUMENTS_AT_INTAKE", actorName: "Sam" }), "Sam asked for documents.");
  assert.equal(historySentence({ action: "PUT_ON_HOLD", actorName: "Sam" }), "Sam put the case on hold.");
  assert.equal(historySentence({ action: "RESUME_FROM_HOLD", actorName: "Sam" }), "Sam recorded that the office got in touch.");
  assert.equal(historySentence({ action: "WITHDRAW", actorName: null }), "The client withdrew the application.");
  const html = historyPanel(record, true);
  assert.match(html, /Alex claimed preparation\./);
  assert.doesNotMatch(html, /CLAIM_PREPARATION/);
});

test("decorateStaffCase names who recorded each fix note, from the same people lookup", () => {
  const people = [{ id: "person-alex", name: "Alex" }];
  const record = decorateStaffCase(
    {
      id: "case-1",
      filingAttempts: [
        { attempt: 1, notes: [{ note: "Fixed", recordedBy: "person-alex" }, { note: "Again", recordedBy: "gone" }], returns: [] },
      ],
    },
    people,
  );
  assert.deepEqual(record.filingAttempts[0].notes.map((n) => n.recordedByName), ["Alex", "Unknown person"]);
  assert.equal(record.filingAttempts[0].notes[0].note, "Fixed");
  // A case without the section (an applicant's, a board row) gains none.
  assert.ok(!("filingAttempts" in decorateStaffCase({ id: "case-2" }, people)));
});

// ---------------------------------------------------------------------------
// Part 2: client numbers on the staff screens.
// ---------------------------------------------------------------------------
test("the board search finds a client number in the current season, or an Application ID", () => {
  const c = { reference: "VT-AB2C-DE3F", clientNumber: 93, season: 2025 };
  for (const q of ["93", "093", "#093", " #93 "]) assert.equal(matchesBoardSearch(c, q, 2025), true, q);
  assert.equal(matchesBoardSearch(c, "9", 2025), false);
  assert.equal(matchesBoardSearch(c, "93", 2026), false);
  assert.equal(matchesBoardSearch(c, "93", null), true);
  assert.equal(matchesBoardSearch(c, "ab2c", 2025), true);
  assert.equal(matchesBoardSearch({ reference: "VT-AAAA-AAAA", clientNumber: null }, "93", 2025), false);
});

test("searching a client number through the board finds a case on no tab", () => {
  const numbered = [
    boardCase({ id: "n-1", reference: "VT-NNNN-0093", stage: "received", clientNumber: 93, season: 2025 }),
    boardCase({ id: "n-2", reference: "VT-NNNN-0094", stage: "received", clientNumber: 94, season: 2025 }),
  ];
  const html = renderStaffBoard(numbered, PEOPLE, {
    person: ALEX,
    filters: { search: "093" },
    currentSeason: 2025,
  });
  assert.ok(html.includes("VT-NNNN-0093"));
  assert.ok(!html.includes("VT-NNNN-0094"));
});

test("a board row shows the client number before the reference, a draft says none yet", () => {
  const rows = [
    boardCase({ id: "n-1", reference: "VT-NNNN-0093", stage: "preparation_ready", clientNumber: 93, season: 2025 }),
    boardCase({ id: "n-2", reference: "VT-NNNN-0095", stage: "draft", clientNumber: null }),
  ];
  const html = renderStaffBoard(rows, PEOPLE, { person: ALEX, filters: { search: "VT-NNNN" } });
  assert.match(html, /<th scope="col">Client<\/th>/);
  assert.match(
    html,
    /<span class="client-number">#093<\/span><button class="board-reference" data-action="open-case" data-case-id="n-1">VT-NNNN-0093<\/button>/,
  );
  assert.match(html, /No number yet/);
});

// The masked phone on the work board (D5, DESIGN.md §8): the case page's
// mask and rule, one cell per row, after Stage.
const PHONE = "2155550123";
const FULL = "(215) 555-0123";
const OLIVE = { id: "olive", name: "Olive", capabilities: ["followup"] };
const PHONE_BOARD = [
  boardCase({ id: "open-1", reference: "VT-PHON-0001", phone: PHONE }),
  boardCase({ id: "mine-1", reference: "VT-PHON-0002", stage: "preparing", preparerId: "alex", phone: PHONE }),
  boardCase({ id: "none-1", reference: "VT-PHON-0003", phone: null }),
  boardCase({ id: "blank-1", reference: "VT-PHON-0004", phone: "" }),
  boardCase({ id: "spouse-1", reference: "VT-PHON-0005", phone: null, spousePhone: "2155550188" }),
];
const phoneBoard = (person) =>
  renderStaffBoard(PHONE_BOARD, PEOPLE, { person, filters: { search: "VT-PHON" } });
const boardRowOf = (html, reference) =>
  html.split('<tr class="board-row').slice(1).find((row) => row.includes(reference))?.split("</tr>")[0] ?? "";
const attributeValues = (html) => [...html.matchAll(/="([^"]*)"/g)].map((match) => match[1]);

test("listPhone: a dash with no phone, the mask with a per-row id otherwise", () => {
  for (const phone of [undefined, null, "", "   "])
    assert.equal(listPhone({ id: "case-9", phone, preparerId: "alex" }, ALEX, "board-phone"), "—");
  const mine = listPhone({ id: "case-9", phone: PHONE, preparerId: "alex" }, ALEX, "board-phone");
  assert.equal(mine, phoneMask(PHONE, true, "board-phone-case-9"));
  const theirs = listPhone({ id: "case-9", phone: PHONE, preparerId: "morgan" }, ALEX, "board-phone");
  assert.equal(theirs, phoneMask(PHONE, false));
  assert.doesNotMatch(theirs, /id="/);
});

test("the board's Phone column comes right after Stage", () => {
  const html = phoneBoard(ALEX);
  const headers = [...html.matchAll(/<th scope="col">([^<]*)<\/th>/g)].map((match) => match[1]);
  assert.deepEqual(headers.slice(0, 8), ["Client", "Stage", "Phone", "Language", "Service", "Preparer", "Reviewer", "Updated"]);
  const row = boardRowOf(html, "VT-PHON-0001");
  assert.ok(row.indexOf('class="badge') < row.indexOf("phone-mask"), "the phone is not after the stage");
  assert.ok(row.indexOf("phone-mask") < row.indexOf("English"), "the phone is not before the language");
});

test("an available case and someone else's case show the locked phone", () => {
  for (const [person, reference] of [[ALEX, "VT-PHON-0001"], [MORGAN, "VT-PHON-0002"]]) {
    const row = boardRowOf(phoneBoard(person), reference);
    assert.match(row, /<span class="phone-mask is-locked" title="Claim this case to see the full number">/);
    assert.match(row, /\(•••\) •••-0123/);
    assert.doesNotMatch(row, /tabindex/);
    assert.doesNotMatch(row, /id="board-phone-/);
    assert.doesNotMatch(row, /555/, `the number reached ${person.name}'s locked row`);
  }
});

test("the viewer's own case, and any case for office staff, show the revealable phone", () => {
  for (const [person, reference, id] of [
    [ALEX, "VT-PHON-0002", "mine-1"],
    [OLIVE, "VT-PHON-0001", "open-1"],
    [OLIVE, "VT-PHON-0002", "mine-1"],
  ]) {
    const row = boardRowOf(phoneBoard(person), reference);
    assert.match(row, new RegExp(`<span class="phone-mask" id="board-phone-${id}" tabindex="0">`));
    assert.ok(row.includes(`<span class="phone-full">${FULL}</span>`));
    for (const value of attributeValues(row))
      assert.doesNotMatch(value, /555/, `an attribute carries the number: ${value}`);
  }
});

test("a listed case with no phone shows a dash, and a spouse phone is never listed", () => {
  const html = phoneBoard(OLIVE);
  for (const reference of ["VT-PHON-0003", "VT-PHON-0004", "VT-PHON-0005"]) {
    const row = boardRowOf(html, reference);
    assert.doesNotMatch(row, /phone-mask/);
    assert.match(row, /<td>—<\/td>/);
  }
  assert.doesNotMatch(html, /0188/, "a spouse phone reached the board");
});

test("in a board row the case link comes before the phone", () => {
  const row = boardRowOf(phoneBoard(ALEX), "VT-PHON-0002");
  assert.ok(row.indexOf('class="board-reference"') > -1);
  assert.ok(row.indexOf('class="board-reference"') < row.indexOf("phone-mask"));
});

test("the board's note keeps workflow only and says phones stay masked", () => {
  const html = phoneBoard(ALEX);
  assert.match(html, /This board shows workflow only: no taxpayer names, no addresses and no document contents\./);
  assert.match(html, /Phone numbers stay masked: on cases you work on, hover over or tab to a number to see it\./);
});

test("the board search box asks for a client number or an Application ID", () => {
  const html = board({ person: ALEX });
  assert.match(html, /<label class="sr-only" for="field-board-search">Find a client # or Application ID<\/label>/);
  assert.match(html, /id="field-board-search"[^>]*placeholder="Find a client # or Application ID"/);
});

test("the case header shows the client number above the heading, after it in reading order", () => {
  const html = caseHeader(staffCase({ clientNumber: 93, season: 2025 }), MORGAN);
  // The heading comes first in the DOM so heading navigation lands on it and
  // reads the number next; CSS lifts the number above it on screen.
  assert.match(html, /<div class="case-title-row"><h2 id="case-title" tabindex="-1">VT-AB2C-DE3F<\/h2><div class="case-client-number">Client #093<\/div>/);
  assert.doesNotMatch(html, /case-client-number[\s\S]*<h2 id="case-title"/);
  const draft = caseHeader(staffCase({ stage: "draft", clientNumber: null }), MORGAN);
  assert.match(draft, /<div class="case-client-number">No number yet<\/div>/);
});

test("a submit entry names the client number the server assigned", () => {
  assert.equal(
    historySentence({ action: "SUBMIT", actorName: "Sam", detail: { clientNumber: 93 } }),
    "Sam submitted the application. Client #093 assigned.",
  );
  assert.equal(historySentence({ action: "SUBMIT", actorName: "Sam" }), "Sam submitted the application.");
});

test("the contact and materials actions read as sentences", () => {
  assert.equal(
    historySentence({ action: "UPDATE_CONTACT", actorName: "Sam" }),
    "Sam updated the best time to reach.",
  );
  assert.equal(
    historySentence({ action: "RECORD_MATERIALS", actorName: "Alex", detail: { items: ["w2"] } }),
    "Alex recorded the materials received.",
  );
  assert.equal(EVENT_SENTENCES.UPDATE_CONTACT, "updated the best time to reach");
  assert.equal(EVENT_SENTENCES.RECORD_MATERIALS, "recorded the materials received");
});

// ---------------------------------------------------------------------------
// Part 4c, Task 1: the version-2 answers by step and sub-step, "Not sure", the
// contact card and the materials card.
// ---------------------------------------------------------------------------

// A version-2 case the way the store returns it: the four contact fields live
// in `contact`, never in `answers`.
function v2Case({ seed = 1, married = false, answers = {}, ...overrides } = {}) {
  const sample = { ...makeSampleAnswers({ seed, married }), ...answers };
  const contact = {};
  for (const [id, key] of Object.entries(CONTACT_FIELDS)) {
    contact[key] = sample[id] ?? null;
    delete sample[id];
  }
  return staffCase({ intakeVersion: 2, answers: sample, contact, materials: [], ...overrides });
}
// Drop keys (the sample answers everything), keeping the rest.
const without = (record, ...ids) => ({
  ...record,
  answers: Object.fromEntries(Object.entries(record.answers).filter(([id]) => !ids.includes(id))),
});
const v2Panel = (record, person = SAM) => answersPanel(record, { person });
const D5_SENTENCE =
  "Contact details are shown to the office, and to the preparer and reviewer once the case is claimed.";

test("the staff answers panel shows the wording the client saw", () => {
  const single = v2Panel(v2Case({ answers: { marital_status: "divorced", opt_veteran: "no" } }));
  assert.match(single, /Are you a veteran of the U\.S\. Armed Forces\?/);
  assert.doesNotMatch(single, /Are you or your spouse a veteran/);
  const married = v2Panel(v2Case({ married: true, answers: { opt_veteran: "no" } }));
  assert.match(married, /Are you or your spouse a veteran of the U\.S\. Armed Forces\?/);
});

// ---------------------------------------------------------------------------
// The masked phone (D5, DESIGN.md §8): one helper, two states.
// ---------------------------------------------------------------------------

// Every attribute value in the HTML, with the icons' path data left out
// (an SVG path is full of digits).
const attrs = (html) =>
  [...html.replace(/<svg[\s\S]*?<\/svg>/g, "").matchAll(/\s[\w-]+="([^"]*)"/g)].map((m) => m[1]);

test("phoneMask: an allowed viewer gets the mask, the eye and the number as text only", () => {
  for (const stored of ["2155550123", "(215) 555-0123"]) {
    const html = phoneMask(stored, true, "contact-phone");
    assert.match(html, /^<span class="phone-mask" id="contact-phone" tabindex="0">/);
    assert.match(html, /<span class="phone-dots" aria-hidden="true">\(•••\) •••-0123<\/span>/);
    assert.match(html, /<span class="phone-full">\(215\) 555-0123<\/span>/);
    assert.equal(html.match(/555-0123/g).length, 1, "the number appears once");
    for (const value of attrs(html)) assert.doesNotMatch(value, /215|555/, `an attribute carries the number: ${value}`);
    assert.match(html, /<svg class="icon /);
    assert.doesNotMatch(html, /title=|aria-label=/);
  }
});

test("phoneMask: a viewer who is not allowed gets the last four, a lock and no number anywhere", () => {
  const html = phoneMask("2155550123", false, "contact-phone");
  assert.doesNotMatch(html.replace(/<svg[\s\S]*?<\/svg>/g, ""), /215|555/);
  assert.doesNotMatch(html, /tabindex|\sid=/);
  assert.match(html, /^<span class="phone-mask is-locked" title="Claim this case to see the full number">/);
  assert.match(html, /<span class="phone-dots" aria-hidden="true">\(•••\) •••-0123<\/span>/);
  assert.match(html, /<span class="sr-only">Ends in 0123\. Claim this case to see the full number\.<\/span>/);
  assert.equal(PHONE_LOCKED, "Claim this case to see the full number");
});

test("phoneMask: an empty phone reads Not given, and a short one shows bullets only", () => {
  for (const allowed of [true, false])
    for (const empty of ["", null, undefined]) assert.equal(phoneMask(empty, allowed), "Not given");
  assert.match(phoneMask("123", false), /\(•••\) •••-••••/);
  assert.doesNotMatch(phoneMask("123", false), /123/);
});

test("htmlRow is detailRow's markup without escaping the value", () => {
  assert.equal(htmlRow("Phone", "<b>x</b>"), '<div class="detail-row"><span>Phone</span><strong><b>x</b></strong></div>');
  assert.equal(htmlRow("A & B", "x"), '<div class="detail-row"><span>A &amp; B</span><strong>x</strong></div>');
});

test("a version-2 answers panel groups the answers by step and sub-step", () => {
  const html = v2Panel(v2Case({ answers: { tp_dob: "1961-04-12" } }));
  assert.match(html, /<h2 id="answers-title">What the client told us<\/h2>/);
  assert.match(html, /Wording used: Standard/);
  // Question steps only: the Documents and Review steps have no answer rows.
  const steps = [...html.matchAll(/<section class="answers-step"><h3>([^<]*)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(steps.slice(0, 3), ["Before you start", "About you", "Household"]);
  assert.equal(steps.includes("Documents"), false);
  assert.equal(steps.includes("Review & submit"), false);
  assert.match(html, /<h3>About you<\/h3><div class="answers-sub"><h4>About you<\/h4>/);
  assert.match(html, /<h4>Mailing address<\/h4>/);
  assert.match(html, /Date of birth<\/span><strong>Apr 12, 1961<\/strong>/);
  // A household member, one row each.
  assert.match(html, /Sam Rivera · Son \/ Daughter · born Aug 30, 2012 · lived with you 12 months/);
  assert.equal((html.match(/People in your household/g) ?? []).length, 1);
  assert.doesNotMatch(html, /data-case-action|<input|<textarea/);
});

test("the senior wording is named, and the questions use it", () => {
  const html = v2Panel(v2Case({ answers: { form_version: "senior" } }));
  assert.match(html, /Wording used: Senior/);
  assert.match(html, /What is your phone number\?/);
  assert.match(html, /Tips \(extra money from customers\)/);
});

test("a required question without an answer says so, and an optional one is left out", () => {
  const record = without(v2Case(), "addr_street", "additional_notes", "opt_veteran");
  const html = v2Panel(record);
  assert.match(html, /<div class="detail-row is-missing"><span>[^<]*(Street|street)[^<]*<\/span><strong>Not answered<\/strong><\/div>/);
  // `opt_veteran` and `additional_notes` are optional: no row at all.
  assert.doesNotMatch(html, /veteran of the U\.S\. Armed Forces/);
  assert.doesNotMatch(html, /Anything else you&#39;d like the volunteer to know/);
});

test("a hidden question and a hidden sub-step are absent", () => {
  const single = v2Panel(v2Case());
  assert.doesNotMatch(single, /Your spouse/);
  assert.doesNotMatch(single, /Spouse&#39;s first name/);
  assert.doesNotMatch(single, /Not answered[\s\S]*Spouse/);
  const married = v2Panel(v2Case({ married: true }));
  assert.match(married, /<h4>Your spouse<\/h4>/);
  assert.match(married, /Spouse&#39;s first name<\/span><strong>Casey<\/strong>/);
});

test("the staff answers panel titles a widowed client's spouse Your late spouse (add-widowed-spouse-rules)", () => {
  const html = v2Panel(v2Case({ answers: { marital_status: "widowed", spouse_death_year: "2025", sp_first_name: "Wei", sp_last_name: "Lin" } }));
  assert.match(html, /<h4>Your late spouse<\/h4>/);
  assert.match(html, /Spouse&#39;s first name<\/span><strong>Wei<\/strong>/);
  assert.doesNotMatch(html, /<h4>Your spouse<\/h4>/);
});

test('"Not sure" is highlighted with the words and an icon, and counted', () => {
  const one = v2Panel(v2Case({ answers: { inc_tips: "not_sure" } }));
  assert.match(one, /<div class="detail-row is-not-sure"><span>Tips<\/span><strong>[^<]*<span class="not-sure-flag"><svg[^>]*>.*?<\/svg> Not sure<\/span><\/strong><\/div>/);
  assert.match(one, /<p class="not-sure-count"><svg[^>]*>.*?<\/svg> 1 answer is "Not sure"\. Ask about them at the interview\.<\/p>/);
  const memberId = "0000000000000000000000000000abcd";
  const member = v2Panel(
    v2Case({
      answers: {
        inc_tips: "not_sure",
        hh: [{ member_id: memberId, first_name: "Lin", last_name: "Chen", dob: "2015-03-14", relationship: "son_daughter", us_citizen: "not_sure", fulltime_student: "not_sure" }],
      },
    }),
  );
  assert.match(member, /Lin Chen[^<]*<span class="not-sure-flag">[^]*? Not sure: U\.S\. citizen, Full-time student in 2025 \(at least 5 months\)<\/span>/);
  assert.doesNotMatch(member, /Not sure: U\.S\. citizen\?/);
  assert.match(member, /3 answers are "Not sure"\./);
  const two = v2Panel(v2Case({ answers: { inc_tips: "not_sure", inc_wages: "not_sure" } }));
  assert.match(two, /2 answers are "Not sure"\./);
  const none = v2Panel(v2Case());
  assert.doesNotMatch(none, /not-sure-count|is-not-sure|not-sure-flag/);
});

test("a viewer who may not see contact details gets the phones locked in the answers, and no best time or note", () => {
  const html = v2Panel(v2Case({ married: true }), null);
  assert.match(html, /Phone number<\/span><strong><span class="phone-mask is-locked"/);
  assert.match(html, /Spouse&#39;s phone number<\/span><strong><span class="phone-mask is-locked"/);
  for (const text of ["Best time to reach you", "Notes about reaching you"]) assert.doesNotMatch(html, new RegExp(text), text);
  assert.doesNotMatch(html.replace(/<svg[\s\S]*?<\/svg>/g, ""), /215|555-01/);
  // An unanswered required phone reads as it does for anyone: "Not answered".
  // (The phones live in `contact`, not `answers`, so empty it there.)
  const base = v2Case();
  const bare = v2Panel({ ...base, contact: { ...base.contact, phone: null } }, null);
  assert.match(bare, /Phone number<\/span><strong>Not answered<\/strong>/);
  assert.match(v2Panel({ ...base, contact: { ...base.contact, phone: null } }, SAM), /Phone number<\/span><strong>Not answered<\/strong>/);
  // Allowed: the mask, revealable, with the answers panel's own id.
  const seen = v2Panel(v2Case({ married: true }), SAM);
  assert.match(seen, /Phone number<\/span><strong><span class="phone-mask" id="answers-tp_phone" tabindex="0">/);
  assert.match(seen, /id="answers-sp_phone"/);
  assert.match(seen, /<span class="phone-full">\(215\) 555-01\d\d<\/span>/);
});

test("contact details follow D5 on the staff page", () => {
  const unclaimed = v2Case({ married: true, stage: "preparation_ready", preparerId: null, participants: [] });
  const html = renderStaffCase(unclaimed, ALEX);
  assert.doesNotMatch(html.replace(/<svg[\s\S]*?<\/svg>/g, ""), /215\D?555|2155550/);
  assert.doesNotMatch(html, /Weekday evenings|After 6 pm/);
  const card = html.match(/<section class="panel contact-card"[\s\S]*?<\/section>/)[0];
  assert.match(card, /<h2 id="contact-title">Contact details<\/h2>/);
  assert.match(card, /<span>Phone<\/span><strong><span class="phone-mask is-locked"/);
  assert.match(card, /<span>Spouse phone<\/span><strong><span class="phone-mask is-locked"/);
  assert.match(card, /<p class="muted">Contact details are shown to the office, and to the preparer and reviewer once the case is claimed\.<\/p><\/section>$/);
  assert.doesNotMatch(card, /Best time to reach|toggle-edit-contact|tabindex/);
  assert.doesNotMatch(html, /data-action="view-draft"/);
  // The same case with that volunteer as its preparer.
  const claimed = renderStaffCase(v2Case({ married: true, preparerId: "alex", participants: ["alex"] }), ALEX);
  assert.match(claimed, /<span>Phone<\/span><strong><span class="phone-mask" id="contact-phone" tabindex="0">/);
  assert.match(claimed, /id="contact-spouse-phone"/);
  assert.match(claimed, /<span class="phone-full">\(215\) 555-01\d\d<\/span>/);
  assert.match(claimed, /Weekday evenings/);
  assert.match(claimed, /data-action="toggle-edit-contact" aria-expanded="false">Edit best time<\/button>/);
  assert.doesNotMatch(claimed, new RegExp(D5_SENTENCE));
  // Every revealable mask has its own id, so a redraw can put focus back.
  const ids = [...claimed.matchAll(/class="phone-mask" id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.sort(), ["answers-sp_phone", "answers-tp_phone", "contact-phone", "contact-spouse-phone"]);
  // An office person sees it on any case.
  const office = renderStaffCase(unclaimed, SAM);
  assert.match(office, /<span class="phone-full">\(215\) 555-01\d\d<\/span>/);
});

test("the contact form is pre-ticked from the contact record and carries a note", () => {
  const record = v2Case({ preparerId: "alex", participants: ["alex"] });
  const ui = { openPanels: ["edit-contact"] };
  const html = renderStaffCase(record, ALEX, ui);
  const form = html.match(/<form[^>]*id="contact-form"[\s\S]*?<\/form>/)?.[0] ?? "";
  assert.ok(form, "the form is drawn");
  const boxes = form.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
  assert.equal(boxes.length, 5);
  for (const box of boxes) assert.match(box, /name="bestContactTime"/);
  const ticked = boxes.filter((box) => /\schecked/.test(box));
  assert.equal(ticked.length, 1);
  assert.match(ticked[0], /value="weekday_evening"/);
  assert.match(form, /<textarea[^>]*name="bestContactNote"[^>]*>After 6 pm is best\.<\/textarea>/);
  assert.match(form, /data-case-action="UPDATE_CONTACT"[^>]*>[^<]*Save best time/);
  assert.match(form, /data-action="toggle-edit-contact"[^>]*>[^<]*Cancel/);
  // Closed: no form, and the toggle says so.
  const closed = renderStaffCase(record, ALEX, { openPanels: [] });
  assert.doesNotMatch(closed, /id="contact-form"/);
  assert.match(html, /data-action="toggle-edit-contact"[^>]*aria-expanded="true"/);
});

test("the materials card lists the eleven items in order, ticks the received ones and names who recorded them", () => {
  const record = v2Case({
    preparerId: "alex",
    participants: ["alex"],
    materials: [{ item: "ssn_itin", receivedAt: "2026-09-14T15:00:00.000Z", recordedByPersonId: "alex" }],
  });
  const html = renderStaffCase(record, ALEX);
  const card = html.match(/<section class="panel materials-card"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.match(card, /<h2[^>]*>Materials received<\/h2>/);
  assert.match(card, /<legend>Materials received<\/legend>/);
  const boxes = card.match(/<input[^>]*name="received"[^>]*>/g) ?? [];
  assert.equal(boxes.length, 11);
  assert.deepEqual(
    boxes.map((box) => box.match(/value="([^"]*)"/)[1]),
    MATERIALS_ITEMS.map((item) => item.id),
  );
  const ticked = boxes.filter((box) => /\schecked/.test(box));
  assert.equal(ticked.length, 1);
  assert.match(ticked[0], /value="ssn_itin"/);
  assert.match(card, /Recorded by Alex ·/);
  assert.match(card, /data-case-action="RECORD_MATERIALS"[^>]*>[^<]*Save materials/);
  assert.doesNotMatch(card, /disabled/);
  for (const item of MATERIALS_ITEMS) assert.match(card, new RegExp(item.label.en.replace(/[/()]/g, "\\$&")));
});

test("a viewer who may not record materials sees them read-only, with the reason", () => {
  const record = v2Case({ stage: "preparation_ready", preparerId: null, participants: [], materials: [{ item: "photo_id", receivedAt: "2026-09-14T15:00:00.000Z", recordedByPersonId: "sam" }] });
  const html = renderStaffCase(record, ALEX);
  const card = html.match(/<section class="panel materials-card"[\s\S]*?<\/section>/)?.[0] ?? "";
  const boxes = card.match(/<input[^>]*name="received"[^>]*>/g) ?? [];
  assert.equal(boxes.length, 11);
  for (const box of boxes) assert.match(box, /\sdisabled/);
  assert.doesNotMatch(card, /RECORD_MATERIALS/);
  assert.match(card, /Materials are recorded by the office, and by the preparer and reviewer once the case is claimed\./);
});

test("materialsCard and contactCard are exported with the (record, rights, ui) shape", () => {
  const record = v2Case({ preparerId: "alex", participants: ["alex"] });
  const rights = staffEligibility(record, ALEX);
  assert.match(materialsCard(record, rights, {}), /^<section class="panel materials-card"/);
  assert.match(contactCard(record, rights, {}), /^<section class="panel contact-card"/);
  assert.match(contactCard(record, rights, { openPanels: ["edit-contact"], busy: true }), /UPDATE_CONTACT"[^>]*disabled/);
  // Busy disables the save, not the reading.
  assert.match(materialsCard(record, rights, { busy: true }), /RECORD_MATERIALS"[^>]*disabled/);
});

test("a version-2 case's intake tab is the answers, the contact card, then the materials card", () => {
  const html = renderStaffCase(v2Case({ preparerId: "alex", participants: ["alex"] }), ALEX);
  const tab = html.match(/<div role="tabpanel" id="case-panel-intake"[^>]*>([\s\S]*?)<div role="tabpanel" id="case-panel-documents"/)[1];
  const at = (text) => tab.indexOf(text);
  assert.ok(at("Wording used") >= 0);
  assert.ok(at("Wording used") < at('class="panel contact-card"'));
  assert.ok(at('class="panel contact-card"') < at('class="panel materials-card"'));
});

test("staffEligibility: editing the best time and recording materials follow works_on_case", () => {
  const claimed = v2Case({ preparerId: "alex", participants: ["alex"] });
  const unclaimed = v2Case({ stage: "preparation_ready", preparerId: null, participants: [] });
  const MATERIALS_REASON = "Materials are recorded by the office, and by the preparer and reviewer once the case is claimed.";
  // Its preparer.
  assert.deepEqual(staffEligibility(claimed, ALEX).editContact, { allowed: true, reason: "" });
  assert.deepEqual(staffEligibility(claimed, ALEX).recordMaterials, { allowed: true, reason: "" });
  // Its reviewer.
  const reviewing = v2Case({ stage: "reviewing", preparerId: "alex", reviewerId: "morgan", participants: ["alex"] });
  assert.equal(staffEligibility(reviewing, MORGAN).editContact.allowed, true);
  assert.equal(staffEligibility(reviewing, MORGAN).recordMaterials.allowed, true);
  // Another volunteer, and nobody.
  assert.deepEqual(staffEligibility(unclaimed, ALEX).editContact, { allowed: false, reason: D5_SENTENCE });
  assert.deepEqual(staffEligibility(unclaimed, ALEX).recordMaterials, { allowed: false, reason: MATERIALS_REASON });
  assert.equal(staffEligibility(claimed, MORGAN).editContact.allowed, false);
  assert.equal(staffEligibility(claimed, null).recordMaterials.allowed, false);
  // Office staff, on any case.
  assert.equal(staffEligibility(unclaimed, SAM).editContact.allowed, true);
  assert.equal(staffEligibility(unclaimed, SAM).recordMaterials.allowed, true);
});

test("decorateStaffCase names who recorded each material", () => {
  const record = decorateStaffCase(
    { id: "c", materials: [{ item: "photo_id", receivedAt: "2026-09-14T15:00:00.000Z", recordedByPersonId: "alex" }, { item: "ssn_itin", recordedByPersonId: "gone" }] },
    PEOPLE,
  );
  assert.equal(record.materials[0].recordedByName, "Alex");
  assert.equal(record.materials[1].recordedByName, "Unknown person");
  assert.equal(record.materials[0].item, "photo_id");
  assert.equal(decorateStaffCase({ id: "c" }, PEOPLE).materials, undefined);
});

test("contacts get the logger's and editor's names", () => {
  const record = decorateStaffCase(
    {
      id: "c",
      contacts: [
        {
          id: "k1",
          loggedByPersonId: "alex",
          versions: [
            { version: 1, editedByPersonId: "alex" },
            { version: 2, editedByPersonId: "gone" },
          ],
        },
        { id: "k2", loggedByPersonId: "gone" },
      ],
    },
    PEOPLE,
  );
  assert.equal(record.contacts[0].loggedByName, "Alex");
  assert.equal(record.contacts[0].versions[0].editedByName, "Alex");
  assert.equal(record.contacts[0].versions[1].editedByName, "Unknown person");
  assert.equal(record.contacts[1].loggedByName, "Unknown person");
  assert.deepEqual(record.contacts[1].versions, []);
  assert.equal(decorateStaffCase({ id: "c" }, PEOPLE).contacts, undefined);
});

// ---------------------------------------------------------------------------
// Part 4c, Task 2: the document checklist with marks and Needed/Maybe moves,
// and the draft 13614-C on the case page.
// ---------------------------------------------------------------------------

const HH1 = "a".repeat(32);
const HH2 = "b".repeat(32);
const member = (id, first) => ({
  member_id: id,
  first_name: first,
  last_name: "Rivera",
  relationship: "child",
  dob: "2012-08-30",
  months_in_home: 12,
});
// Wages, two household members and a direct-deposit refund; one card marked
// Later and one Maybe card moved up by the office.
function checklistCase(overrides = {}) {
  return v2Case({
    stage: "received",
    preparerId: null,
    participants: [],
    answers: {
      inc_wages: "yes",
      has_household_members: "yes",
      hh: [member(HH1, "Sam"), member(HH2, "Lee")],
      refund_method: "direct_deposit",
    },
    documentCards: [
      { slotId: "w2.household", status: "later", groupOverride: null },
      { slotId: `ssn.hh.${HH1}`, status: null, groupOverride: "needed" },
    ],
    ...overrides,
  });
}
const checklist = (record, person = SAM, ui = {}) =>
  documentChecklist(record, staffEligibility(record, person), ui);
const rowOf = (html, slot) => {
  const id = `doc-${slot.replace(/\./g, "-")}`;
  const start = html.indexOf(`<article class="doc-row" id="${id}"`);
  assert.ok(start >= 0, `a row for ${slot}`);
  return html.slice(start, html.indexOf("</article>", start));
};
const MARK_ACTIONS = /data-action="(mark-card|move-card)"/g;

test("the checklist groups the client's cards under sub-step titles, in order", () => {
  const html = checklist(checklistCase());
  assert.match(
    html,
    /^<section class="panel doc-checklist" aria-labelledby="doc-checklist-title"><div class="section-head"><h2 id="doc-checklist-title">Document checklist<\/h2><\/div>/,
  );
  assert.match(html, /From the client(?:'|&#39;)s answers\. Same-day clients bring these to the visit\./);
  const titles = [...html.matchAll(/<h3>([^<]*)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(titles, ["Identity", "Income forms", "Health and other events", "Other documents"]);
  const at = (slot) => html.indexOf(`id="doc-${slot.replace(/\./g, "-")}"`);
  assert.ok(at("photo_id.tp") < at("w2.household"));
  assert.ok(at("w2.household") < at("bank.household"));
  assert.ok(at("bank.household") < at("other.household"));
});

test("a marked card shows its status and the three marks", () => {
  const row = rowOf(checklist(checklistCase()), "w2.household");
  assert.match(row, /id="doc-w2-household" data-slot="w2\.household" tabindex="-1"/);
  assert.match(row, /<strong class="doc-label">[^<]*W-2/);
  assert.match(row, /<p class="doc-owner">Client<\/p>/);
  assert.match(row, /<p class="doc-status is-later" id="doc-w2-household-status" tabindex="-1">[^]*Later<\/p>/);
  assert.match(row, /data-action="mark-card" data-slot="w2\.household" data-status="later"[^>]*>Later</);
  assert.match(row, /data-status="none"[^>]*>Don(?:'|&#39;)t have</);
  assert.match(row, /data-status="not_done"[^>]*>Mark as not done</);
  assert.match(row, /Needed/);
  assert.doesNotMatch(row, /move-card/);
});

test("a card with no mark offers Later and Don't have, and no Mark as not done", () => {
  const row = rowOf(checklist(checklistCase()), "photo_id.tp");
  assert.match(row, /doc-status is-not_done[^>]*>[^]*Not done<\/p>/);
  assert.match(row, /data-status="later"/);
  assert.match(row, /data-status="none"/);
  assert.doesNotMatch(row, /data-status="not_done"/);
  assert.doesNotMatch(row, /move-card/, "an answer-Needed card has no move");
  assert.doesNotMatch(row, /Asked by/, "a card with no asking question has no reason line");
});

test("Maybe cards move up and back; a moved-up card says who moved it", () => {
  const html = checklist(checklistCase());
  const up = rowOf(html, `ssn.hh.${HH1}`);
  assert.match(up, /Needed \(moved up by the office\)/);
  assert.match(up, new RegExp(`data-action="move-card" data-slot="ssn\\.hh\\.${HH1}" data-group="maybe"[^>]*>Move to Maybe needed<`));
  const maybe = rowOf(html, `ssn.hh.${HH2}`);
  assert.match(maybe, /Maybe needed/);
  assert.doesNotMatch(maybe, /moved up/);
  assert.match(maybe, new RegExp(`data-action="move-card" data-slot="ssn\\.hh\\.${HH2}" data-group="needed"[^>]*>Move to Needed<`));
  assert.match(up, /Sam Rivera/);
});

test("the optional card has no marks, no status and no move", () => {
  const row = rowOf(checklist(checklistCase()), "other.household");
  assert.match(row, /Optional/);
  assert.doesNotMatch(row, /doc-status|mark-card|move-card/);
});

test("the reason line names the question that asked for the card", () => {
  const html = checklist(checklistCase());
  assert.match(rowOf(html, "w2.household"), /Asked by: Wages from a part-time or full-time job/);
  assert.match(rowOf(html, `ssn.hh.${HH2}`), /Asked by: /);
});

// Wording review (#48), section 3: the checklist's owner lines are the office's
// (as on Add a case), never the client's "For you"; a member's name stays as typed.
test("the owner lines speak to the office; a household member keeps their name", () => {
  const html = checklist(checklistCase());
  assert.match(rowOf(html, "w2.household"), /<p class="doc-owner">Client<\/p>/);
  assert.match(rowOf(html, "bank.household"), /<p class="doc-owner">Household<\/p>/);
  assert.match(rowOf(html, `ssn.hh.${HH1}`), /<p class="doc-owner">Sam [^<]*<\/p>/);
  assert.doesNotMatch(html, /<p class="doc-owner">(You|Your spouse|For you|For you and your spouse|For your household)<\/p>/);
  const married = checklist(checklistCase({ answers: { ...checklistCase().answers, marital_status: "married" } }));
  assert.match(rowOf(married, "w2.household"), /<p class="doc-owner">Client and spouse<\/p>/);
});

test("Alex sees marks and moves only on a case he prepares; Morgan only as its reviewer", () => {
  const unclaimed = checklistCase({ preparerId: "someone-else" });
  const refused =
    "Documents are marked by the office, and by the preparer and reviewer once the case is claimed.";
  const forAlex = checklist(unclaimed, ALEX);
  assert.doesNotMatch(forAlex, MARK_ACTIONS);
  assert.equal((forAlex.match(/class="staff-reason"/g) ?? []).length, 1, "the refusal is shown once");
  assert.ok(forAlex.includes(refused));
  assert.ok(forAlex.indexOf(refused) < forAlex.indexOf("<h3>"), "at the top of the checklist");
  assert.match(forAlex, /doc-row/, "the cards are still shown to read");
  const prepared = checklistCase({ preparerId: "alex" });
  const mine = checklist(prepared, ALEX);
  assert.match(mine, /data-action="mark-card"/);
  assert.match(mine, /data-action="move-card"/);
  assert.doesNotMatch(mine, /staff-reason/);
  const reviewed = checklistCase({ preparerId: "someone-else", reviewerId: "morgan" });
  assert.match(checklist(reviewed, MORGAN), /data-action="move-card"/);
  assert.doesNotMatch(checklist(unclaimed, MORGAN), MARK_ACTIONS);
});

test("a closed case offers no marks or moves, and says why", () => {
  const html = checklist(checklistCase({ stage: "closed" }));
  assert.doesNotMatch(html, MARK_ACTIONS);
  assert.equal((html.match(/This case is closed\./g) ?? []).length, 1);
  assert.match(html, /doc-row/);
});

test("document marks and moves follow one rule under two names", () => {
  const sam = staffEligibility(checklistCase(), SAM);
  assert.deepEqual(sam.markDocumentCard, { allowed: true, reason: "" });
  assert.deepEqual(sam.moveDocumentCard, sam.markDocumentCard);
  const alex = staffEligibility(checklistCase({ preparerId: "x" }), ALEX);
  assert.equal(alex.markDocumentCard.allowed, false);
  assert.deepEqual(alex.moveDocumentCard, alex.markDocumentCard);
});

test("every mark and move is disabled while busy", () => {
  const html = checklist(checklistCase(), SAM, { busy: true });
  const buttons = html.match(/<button[^>]*data-action="(?:mark-card|move-card)"[^>]*>/g) ?? [];
  assert.ok(buttons.length > 4);
  for (const one of buttons) assert.match(one, /\sdisabled/);
  const idle = checklist(checklistCase(), SAM, { busy: false });
  for (const one of idle.match(/<button[^>]*data-action="(?:mark-card|move-card)"[^>]*>/g) ?? [])
    assert.doesNotMatch(one, /\sdisabled/);
});

test("same-day clients still show the full cards, with marks, to staff", () => {
  const record = checklistCase({ answers: { ...checklistCase().answers, service: "same_day" } });
  const html = checklist(record);
  assert.match(html, /data-action="mark-card"/);
  assert.match(html, /doc-status/);
  assert.doesNotMatch(html, /bring-list/);
});

test("text in the cards is escaped", () => {
  const record = checklistCase({
    answers: { ...checklistCase().answers, hh: [member(HH1, "<b>Sam</b>"), member(HH2, "Lee")] },
  });
  const html = checklist(record);
  assert.doesNotMatch(html, /<b>Sam/);
  assert.match(html, /&lt;b&gt;Sam/);
});

test("the Documents tab starts with the checklist, above the requests", () => {
  const record = checklistCase({ requests: [], stage: "received" });
  const html = renderStaffCase(record, SAM);
  const tab = html.match(/id="case-panel-documents"[^>]*>([\s\S]*?)<div role="tabpanel" id="case-panel-followup"/)[1];
  assert.ok(tab.startsWith('<section class="panel doc-checklist"'));
  assert.ok(tab.indexOf("doc-checklist") < tab.indexOf('id="documents-title"'));
});

test("the draft 13614-C buttons show to staff who work on a version-2 case", () => {
  const intake = (html) =>
    html.match(/id="case-panel-intake"[^>]*>([\s\S]*?)<div role="tabpanel" id="case-panel-documents"/)[1];
  const tools = (record, person) => intake(renderStaffCase(record, person));
  const has = (html) =>
    html.includes('<div class="summary-tools">') &&
    html.includes('data-form="en"') &&
    html.includes('data-form="zh-s"') &&
    html.includes('data-form="zh-t"') &&
    html.includes('<p id="draft-ready" class="draft-ready" aria-live="polite"></p>');
  const office = tools(checklistCase(), SAM);
  assert.ok(has(office));
  assert.match(office, /data-action="view-draft" data-form="en">View Draft 13614-C</);
  assert.match(office, />简体中文版</);
  assert.match(office, />繁體中文版</);
  assert.match(office, /data-action="view-draft" data-draft="14446" data-form="en"[^>]*>View Draft Form 14446</);
  assert.match(office, /data-action="view-draft" data-draft="14446" data-form="zh-t" lang="zh-Hant"[^>]*>繁體中文版</);
  // After the answers panel, before the contact card.
  assert.ok(office.indexOf("answers-v2") < office.indexOf("summary-tools"));
  assert.ok(office.indexOf("summary-tools") < office.indexOf("contact-card"));
  assert.ok(has(tools(checklistCase({ preparerId: "alex" }), ALEX)));
  assert.equal(has(tools(checklistCase({ preparerId: "someone-else" }), ALEX)), false);
  assert.doesNotMatch(tools(checklistCase({ preparerId: "someone-else" }), ALEX), /view-draft|draft-ready/);
});

test("staff see an unmarried client's who answers as Yes/No, with the wording the client saw", () => {
  const panel = v2Panel(v2Case({ answers: { on_visa: ["none"] } }));
  assert.match(panel, /<span>Were you in the U\.S\. on a visa in 2025\?<\/span><strong>No<\/strong>/);
  assert.doesNotMatch(panel, /Who was in the U\.S\. on a visa/);
  const docs = checklist(v2Case({ answers: { on_visa: ["me"] } }));
  assert.match(docs, /Asked by: Were you in the U\.S\. on a visa in 2025\?/);
});

test("the work board while its cases load, and when they couldn't", () => {
  const loading = renderStaffBoard([], PEOPLE, { person: ALEX, list: "loading" });
  assert.match(loading, /Loading cases…/);
  assert.doesNotMatch(loading, /Nothing to claim right now|data-filter="status"|Showing 0/);
  const failed = renderStaffBoard([], PEOPLE, { person: ALEX, list: "failed" });
  assert.match(failed, /The cases couldn&#39;t load\./);
  assert.doesNotMatch(failed, /Nothing to claim right now/);
  assert.match(renderStaffBoard([], PEOPLE, { person: ALEX }), /Nothing to claim right now/, "ready by default");
});

test("the case page's in-place error is an error block with both controls", () => {
  const html = problemNotice({ error: { code: "SERVER_ERROR", message: "x" }, retryable: true });
  assert.match(html, /^<div class="notice error" role="alert">/);
  assert.match(html, /data-action="retry-action"/);
  assert.match(html, /data-action="dismiss-error"/);
});

// ---------------------------------------------------------------------------
// The contact log (OpenSpec change add-contact-log, Task 4): the Contacts tab
// and the one Log contact form.
// ---------------------------------------------------------------------------

const NOW_1745 = Date.parse("2026-10-17T21:45:00.000Z"); // 5:45 PM in New York
const tabOf = (html, key) => {
  const from = html.indexOf(`id="case-panel-${key}"`);
  return html.slice(from, html.indexOf('role="tabpanel"', from + 1));
};
const fieldsetOf = (html, legend) =>
  html.match(new RegExp(`<fieldset[^>]*><legend>${legend}</legend>[\\s\\S]*?</fieldset>`))?.[0] ?? "";
const radios = (fieldset) =>
  [...fieldset.matchAll(/<input type="radio"[^>]*value="([a-z_]+)"[^>]*><span>([^<]+)<\/span>/g)].map((m) => [m[1], m[2]]);
const checkedIn = (html) =>
  [...html.matchAll(/name="([a-zA-Z]+)" value="([a-z_]+)"[^>]*checked/g)].map((m) => `${m[1]}=${m[2]}`);

test("the case tabs include Contacts before History", () => {
  const html = renderStaffCase(staffCase(), ALEX);
  const order = [...html.matchAll(/role="tab" id="case-tab-([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ["overview", "intake", "documents", "followup", "contacts", "history"]);
  assert.match(html, /data-value="contacts">Contacts<\/button>/);
});

test("the Contacts tab shows its count", () => {
  const html = renderStaffCase(
    staffCase({ contacts: [contactEntry(), contactEntry({ id: "c2" }), contactEntry({ id: "c3" })] }),
    ALEX,
  );
  assert.match(html, /data-value="contacts">Contacts <span class="tab-count">3<\/span><\/button>/);
  assert.match(tabOf(html, "contacts"), /<h2 id="contacts-title">Contacts<\/h2>/);
  // An applicant-shaped record has no log to show.
  const applicant = renderStaffCase({ id: "x", stage: "preparing", answers: {} }, ALEX);
  assert.match(tabOf(applicant, "contacts"), /Open the case from the work board to see this\./);
  assert.doesNotMatch(applicant, /contact-form/);
});

test("newest contact time first", () => {
  const html = contactsPanel(
    staffCase({
      contacts: [
        contactEntry({ id: "c-am", contactedAt: "2026-10-17T14:00:00.000Z" }),
        contactEntry({ id: "c-pm", contactedAt: "2026-10-17T19:45:00.000Z" }),
      ],
    }),
    ALEX,
    { now: NOW_1745 },
  );
  assert.ok(html.indexOf('id="contact-c-pm"') < html.indexOf('id="contact-c-am"'));
  assert.match(html, /<li id="contact-c-pm" class="contact-entry" tabindex="-1">/);
  assert.match(html, /10\/17\/2026 3:45 PM — Alex → client, phone — Go over tax return — Reached\./);
  assert.match(html, /10\/17\/2026 10:00 AM — Alex/);
  // The section, its Copy all and each entry's Copy.
  assert.match(html, /<h2 id="contacts-title">Contacts<\/h2>/);
  assert.match(html, /data-action="copy-all-contacts"[^>]*>Copy all</);
  assert.match(html, /data-action="copy-contact"[^>]*data-contact-id="c-am"[^>]*>Copy</);
  // The form comes before the entries.
  assert.ok(html.indexOf("contact-form") < html.indexOf('id="contact-c-pm"'));
});

test("Edit only for the logger or an admin", () => {
  const record = staffCase({ contacts: [contactEntry({ loggedByPersonId: "morgan" })] });
  const edit = /data-action="toggle-contact-edit" data-contact-id="c1"[^>]*>Edit</;
  assert.doesNotMatch(contactsPanel(record, ALEX, {}), edit);
  assert.match(contactsPanel(record, MORGAN, {}), edit);
  assert.match(contactsPanel(record, SAM, {}), edit, "an admin edits anyone's entry");
  assert.equal(mayEditContact(record.contacts[0], MORGAN), true);
  assert.equal(mayEditContact(record.contacts[0], SAM), true);
  assert.equal(mayEditContact(record.contacts[0], ALEX), false);
  assert.equal(mayEditContact(record.contacts[0], null), false);
  assert.equal(mayEditContact({ loggedByPersonId: undefined }, {}), false, "no persona is nobody's logger");
});

test("an edited entry says so and lists its earlier versions", () => {
  const sent = contactEntry({ method: "text", outcome: "sent", contactedAt: "2026-10-17T14:00:00.000Z" });
  const record = staffCase({
    contacts: [
      {
        ...sent,
        outcome: "replied",
        revision: 2,
        editedAt: "2026-10-17T15:30:00.000Z",
        versions: [
          { ...sent.versions[0], createdAt: "2026-10-17T14:00:00.000Z" },
          { ...sent.versions[0], version: 2, outcome: "replied", createdAt: "2026-10-17T15:30:00.000Z", editedByPersonId: "sam" },
        ],
      },
    ],
  });
  const html = contactsPanel(record, ALEX, {});
  assert.match(html, /10\/17\/2026 10:00 AM — Alex → client, text — Go over tax return — Client replied\./);
  assert.match(html, /edited 10\/17\/2026 11:30 AM/);
  const details = html.match(/<details class="contact-versions">[\s\S]*?<\/details>/)?.[0] ?? "";
  assert.match(details, /<summary>Earlier versions \(1\)<\/summary>/);
  assert.match(details, /10\/17\/2026 10:00 AM — Alex → client, text — Go over tax return — Sent\./);
  assert.match(details, /Saved 10\/17\/2026 10:00 AM · Alex/);
  assert.doesNotMatch(details, /Client replied/, "the current version is not an earlier one");
  // An entry never edited has neither.
  const plain = contactsPanel(staffCase({ contacts: [contactEntry()] }), ALEX, {});
  assert.doesNotMatch(plain, /edited |Earlier versions/);
});

test("a linked entry names its task", () => {
  const html = contactsPanel(
    staffCase({
      followups: [{ id: "task-1", requestId: "r", assigneeId: "sam", status: "open", reason: "Ask for the <W-2>" }],
      contacts: [contactEntry({ followupId: "task-1", loggedByPersonId: "sam" })],
    }),
    ALEX,
    {},
  );
  assert.match(html, /For the follow-up: Ask for the &lt;W-2&gt;/);
  assert.doesNotMatch(contactsPanel(staffCase({ contacts: [contactEntry()] }), ALEX, {}), /For the follow-up/);
});

test("an empty log", () => {
  const html = contactsPanel(staffCase(), ALEX, { now: NOW_1745 });
  assert.match(html, /<p class="muted">No contacts logged yet\.<\/p>/);
  assert.doesNotMatch(html, /copy-all-contacts/);
  assert.match(html, /<form class="staff-form contact-form" data-case-id="case-a"/);
  // No persona: the reason, not a form the database would refuse.
  const nobody = contactsPanel(staffCase(), null, {});
  assert.doesNotMatch(nobody, /<form/);
  assert.match(nobody, /This account isn(?:'|&#39;)t linked to a volunteer yet\. Ask your site coordinator\./);
});

test("the form's button groups and defaults", () => {
  const html = logContactForm(staffCase(), ALEX, { now: NOW_1745 });
  assert.match(html, /^<form class="staff-form contact-form" data-case-id="case-a">/);
  assert.match(html, /<h3>Log contact<\/h3>/);
  assert.deepEqual(radios(fieldsetOf(html, "Direction")), [["outgoing", "We contacted"], ["incoming", "The client contacted us"]]);
  assert.deepEqual(radios(fieldsetOf(html, "Method")), [
    ["phone", "Phone"], ["text", "Text"], ["email", "Email"], ["in_person", "In person"], ["video", "Video"],
  ]);
  assert.deepEqual(radios(fieldsetOf(html, "Purpose")), [
    ["go_over_return", "Go over tax return"], ["ask_question", "Ask a question"], ["request_documents", "Request documents"],
    ["schedule_appointment", "Schedule an appointment"], ["other", "Other"],
  ]);
  assert.deepEqual(radios(fieldsetOf(html, "With")), [["client", "Client"], ["spouse", "Spouse"], ["other", "Other"]]);
  const voice = html.match(/<fieldset[^>]*data-outcome-group="voice"[^>]*>[\s\S]*?<\/fieldset>/)?.[0] ?? "";
  const written = html.match(/<fieldset[^>]*data-outcome-group="written"[^>]*>[\s\S]*?<\/fieldset>/)?.[0] ?? "";
  assert.match(voice, /<legend>Outcome<\/legend>/);
  assert.match(written, /<legend>Outcome<\/legend>/);
  assert.deepEqual(radios(voice), [["reached", "Reached"], ["no_answer", "No answer"], ["left_voicemail", "Left voicemail"], ["wrong_number", "Wrong or invalid number"]]);
  assert.deepEqual(radios(written), [["sent", "Sent"], ["replied", "Client replied"], ["failed", "Failed to deliver"]]);
  assert.match(voice, /^<fieldset class="seg-group" data-outcome-group="voice">/, "phone shows the voice outcomes");
  assert.match(written, /^<fieldset class="seg-group" data-outcome-group="written" hidden disabled>/);
  // Real radios with real labels, required, ids scoped to this form.
  assert.match(html, /<label class="seg" for="field-contact-new-direction-outgoing"><input type="radio" id="field-contact-new-direction-outgoing" name="direction" value="outgoing" required checked><span>We contacted<\/span><\/label>/);
  for (const name of ["direction", "method", "purpose", "outcomeVoice", "outcomeWritten", "withWhom"])
    assert.match(html, new RegExp(`name="${name}" value="[a-z_]+" required`), name);
  // Only "We contacted" and "Phone" are chosen.
  assert.deepEqual(checkedIn(html), ["direction=outgoing", "method=phone"]);
  assert.match(html, /<input id="field-contact-new-contactedAt" name="contactedAt" type="datetime-local" value="2026-10-17T17:45" required>/);
  assert.equal(nowInput(NOW_1745), "2026-10-17T17:45");
  assert.match(html, /<span>Contact time<\/span>/);
  assert.match(html, /<label class="field" for="field-contact-new-otherName" data-other-name hidden><span>Name<\/span><input id="field-contact-new-otherName" name="otherName" type="text" value="" maxlength="80"><\/label>/);
  assert.match(html, /<span>Note<\/span><textarea id="field-contact-new-note" name="note" maxlength="1000"/);
  assert.match(html, /<button type="submit" class="btn primary" id="field-contact-new-submit">Log contact<\/button><\/form>$/);
  assert.doesNotMatch(html, /data-case-action/, "the log is not a case action");

  // Linked to a task: the task's own scope and id.
  const linked = logContactForm(staffCase(), SAM, { now: NOW_1745 }, { followupId: "task-1" });
  assert.match(linked, /^<form class="staff-form contact-form" data-case-id="case-a" data-followup-id="task-1">/);
  assert.match(linked, /<h4>Log contact<\/h4>/);
  assert.match(linked, /id="field-contact-task-task-1-note"/);

  // Editing: the entry's own values, Save changes and Cancel.
  const entry = staffCase({
    contacts: [contactEntry({ method: "text", outcome: "sent", purpose: "ask_question", withWhom: "other", otherName: "Lee Park", note: "Asked about Monday." })],
  }).contacts[0];
  const edit = logContactForm(staffCase(), ALEX, { now: NOW_1745 }, { contact: entry });
  assert.match(edit, /^<form class="staff-form contact-form" data-case-id="case-a" data-contact-id="c1" aria-label="Edit this contact">/);
  assert.deepEqual(checkedIn(edit), ["direction=outgoing", "method=text", "purpose=ask_question", "outcomeWritten=sent", "withWhom=other"]);
  assert.match(edit, /data-outcome-group="voice" hidden disabled/);
  assert.match(edit, /data-outcome-group="written">/);
  assert.match(edit, /value="2026-10-17T15:45" required/);
  assert.match(edit, /for="field-contact-edit-c1-otherName" data-other-name><span>Name/);
  assert.match(edit, /value="Lee Park" maxlength="80"/);
  assert.match(edit, />Asked about Monday\.<\/textarea>/);
  assert.match(edit, /<button type="submit" class="btn primary" id="field-contact-edit-c1-submit">Save changes<\/button>/);
  assert.match(edit, /<button type="button" class="btn secondary" data-action="toggle-contact-edit" data-contact-id="c1">Cancel<\/button>/);
  // In person, or incoming: no outcome group shows.
  for (const over of [{ method: "in_person" }, { direction: "incoming" }]) {
    const none = logContactForm(staffCase(), ALEX, {}, { contact: { ...entry, ...over } });
    assert.match(none, /data-outcome-group="voice" hidden disabled/);
    assert.match(none, /data-outcome-group="written" hidden disabled/);
  }
  // Busy: the button waits.
  assert.match(logContactForm(staffCase(), ALEX, { busy: true }), /<button type="submit" class="btn primary" id="field-contact-new-submit" disabled>Log contact/);
});

test("a note is text, not markup", () => {
  const note = '<b>"Lee" & co</b>';
  const record = staffCase({
    contacts: [contactEntry({ note, withWhom: "other", otherName: "<i>Jo</i>" })],
  });
  const html = contactsPanel(record, ALEX, { openPanels: ["contact-edit:c1"] });
  assert.doesNotMatch(html, /<b>|<i>/);
  assert.match(html, /Note: &lt;b&gt;&quot;Lee&quot; &amp; co&lt;\/b&gt;/);
  assert.match(html, /&lt;i&gt;Jo&lt;\/i&gt;/);
  // The edit form holds it as text too.
  assert.match(html, />&lt;b&gt;&quot;Lee&quot; &amp; co&lt;\/b&gt;<\/textarea>/);
  // Copy puts the line on the clipboard exactly as typed (app.mjs copies this).
  assert.match(contactSummary(record.contacts[0]), /<i>Jo<\/i>, phone[^]*Note: <b>"Lee" & co<\/b>$/);
  // The task list escapes it as well.
  const linked = { ...record, contacts: [{ ...record.contacts[0], followupId: "task-1" }] };
  assert.doesNotMatch(taskContacts(linked, { id: "task-1" }), /<b>/);
  assert.match(taskContacts(linked, { id: "task-1" }), /&lt;b&gt;/);
});

test("a persona switch closes someone else's edit form", () => {
  const record = staffCase({ contacts: [contactEntry({ loggedByPersonId: "alex" })] });
  const ui = { openPanels: ["contact-edit:c1"] };
  const forAlex = contactsPanel(record, ALEX, ui);
  assert.match(forAlex, /data-contact-id="c1" aria-label="Edit this contact"/);
  assert.match(forAlex, /data-action="toggle-contact-edit" data-contact-id="c1" aria-expanded="true"/);
  // Morgan, chosen with Alex's form still open, sees no form and nothing to save.
  const forMorgan = contactsPanel(record, MORGAN, ui);
  assert.doesNotMatch(forMorgan, /aria-label="Edit this contact"/);
  assert.doesNotMatch(forMorgan, /Save changes/);
  assert.doesNotMatch(forMorgan, /toggle-contact-edit/);
  // A closed form is not drawn for Alex either.
  assert.doesNotMatch(contactsPanel(record, ALEX, {}), /aria-label="Edit this contact"/);
});

test("no phone digits in the tab", () => {
  const record = staffCase({ phone: "2155550123", contacts: [contactEntry({ note: "Called back." })] });
  const tab = tabOf(renderStaffCase(record, SAM, { caseTab: "contacts", now: NOW_1745 }), "contacts");
  assert.ok(tab.includes("Called back."));
  assert.doesNotMatch(tab, /555|0123/);
});

test("an old RECORD_CONTACT event still reads as a call attempt", () => {
  assert.ok(!CASE_ACTIONS.includes("RECORD_CONTACT"));
  assert.equal(historySentence({ action: "RECORD_CONTACT", actorName: "Sam" }), "Sam recorded a call attempt.");
  const html = historyPanel(
    { internalHistory: [{ id: "e1", action: "RECORD_CONTACT", actorName: "Sam", createdAt: "2026-03-02T14:15:00.000Z" }], history: [] },
    true,
  );
  assert.match(html, /Sam recorded a call attempt\./);
});

test("the task lists its linked contacts, oldest first", () => {
  const record = staffCase({
    contacts: [
      contactEntry({ id: "late", followupId: "task-1", contactedAt: "2026-10-17T19:45:00.000Z", loggedByPersonId: "sam" }),
      contactEntry({ id: "early", followupId: "task-1", contactedAt: "2026-10-17T14:00:00.000Z", loggedByPersonId: "sam", outcome: "no_answer" }),
      contactEntry({ id: "other", followupId: null }),
    ],
  });
  const html = taskContacts(record, { id: "task-1" });
  assert.match(html, /^<ul class="contact-task-list">/);
  assert.equal((html.match(/<li>/g) ?? []).length, 2);
  assert.ok(html.indexOf("10:00 AM") < html.indexOf("3:45 PM"));
  assert.match(taskContacts(record, { id: "task-2" }), /^<p class="muted">No contact has been logged on this task yet\.<\/p>$/);
});

test("switching method after picking an outcome sends only the shown group", () => {
  // Phone → No answer, then Text (Review Focus 4). The page hides and disables
  // the voice group (app.mjs, syncContactForm), so FormData leaves it out and
  // the written group, shown and required, is the one that counts.
  const text = logContactForm(staffCase(), ALEX, {}, { contact: { ...contactEntry({ method: "text", outcome: "sent" }) } });
  assert.match(text, /data-outcome-group="voice" hidden disabled/);
  assert.match(text, /<fieldset class="seg-group" data-outcome-group="written"><legend>Outcome<\/legend>[^]*?name="outcomeWritten" value="sent" required/);
  const sent = contactEntryFromForm({
    direction: "outgoing", method: "text", purpose: "ask_question", withWhom: "client",
    outcomeVoice: "no_answer", outcomeWritten: "replied", contactedAt: "2026-10-17T15:45", note: "",
  });
  assert.equal(sent.outcome, "replied");
  // Nothing chosen in the shown group sends no outcome at all; the database
  // refuses that, and the browser never gets there (the group is required).
  const none = contactEntryFromForm({
    direction: "outgoing", method: "text", purpose: "ask_question", withWhom: "client",
    outcomeVoice: "no_answer", contactedAt: "2026-10-17T15:45", note: "",
  });
  assert.equal(none.outcome, undefined);
  assert.equal(outcomeGroup("text", "outgoing"), "written");
  assert.equal(outcomeGroup("video", "outgoing"), "voice");
  assert.equal(outcomeGroup("phone", "incoming"), null);
  assert.equal(outcomeGroup("in_person", "outgoing"), null);
});

// ---------------------------------------------------------------------------
// The preparer and reviewer questionnaires (add-preparer-and-reviewer-questionnaires, Task 7)
// ---------------------------------------------------------------------------

const NOON = new Date(2026, 9, 19, 12, 0, 0).getTime(); // 2026-10-19 in the browser's zone
const prepQ = (over = {}) => ({
  id: "pq-1",
  caseId: "case-a",
  preparationVersion: 1,
  confirmedBy: "client",
  confirmedByName: null,
  confirmedMethod: "in_person",
  shadedPartsCompleted: true,
  stateForgivenessSet: true,
  readyForReviewOn: "2026-10-10",
  ...over,
});
const revQ = (over = {}) => ({
  id: "rq-1",
  caseId: "case-a",
  reviewId: "review-1",
  completedOn: "2026-10-17",
  paForgiveness: "eligible",
  wentOver: true,
  wentOverOn: "2026-10-16",
  wentOverHow: "phone",
  signMethod: "portal",
  signAppointmentAt: null,
  exitForm: {
    federal: { method: "efile", result: "refund", amount: "120.00", refundBy: "direct_deposit" },
    state: null,
    local: [{ type: "NPT", method: "paper", result: "none" }],
  },
  remarks: "Looks right.",
  ...over,
});
const reviewRow = (over = {}) => ({
  id: "review-1",
  preparationVersion: 1,
  reviewerId: "morgan",
  status: "active",
  findings: null,
  resolution: null,
  clientContactStatus: null,
  createdAt: "2026-09-12T16:00:00.000Z",
  decidedAt: null,
  ...over,
});
const stepFor = (overrides, person, ui = {}) => {
  const record = staffCase(overrides);
  return nextStep(record, staffEligibility(record, person), { now: NOON, ...ui });
};
const REVIEWING = { stage: "reviewing", preparerId: "alex", reviewerId: "morgan", participants: ["alex"], preparationVersion: 1, reviews: [reviewRow()] };
const checkedOf = (html, name) =>
  [...html.matchAll(new RegExp(`<input[^>]*name="${name.replaceAll(".", "\\.")}"[^>]*>`, "g"))]
    .filter((m) => / checked/.test(m[0]))
    .map((m) => /value="([^"]*)"/.exec(m[0])[1]);

test("Filing in progress shows the preparer form inline with today's date", () => {
  const html = stepFor({ stage: "preparing" }, ALEX);
  assert.match(html, /<form class="staff-form q-form">[\s\S]*name="confirmedBy"[\s\S]*data-case-action="SUBMIT_REVIEW"/);
  assert.match(html, /name="readyForReviewOn" type="date" value="2026-10-19"/);
  assert.doesNotMatch(html, /<dialog|role="dialog"|aria-modal/);
  assert.deepEqual(checkedOf(html, "confirmedBy"), []);
});

test("resubmit is prefilled from the latest submission", () => {
  const html = stepFor(
    {
      stage: "corrections_required",
      preparationVersion: 1,
      preparerQuestionnaires: [prepQ({ readyForReviewOn: "2026-10-10" })],
      reviews: [{ id: "r1", status: "corrections_requested", findings: "Fix it.", preparationVersion: 1 }],
    },
    ALEX,
  );
  assert.deepEqual(checkedOf(html, "confirmedBy"), ["client"]);
  assert.deepEqual(checkedOf(html, "confirmedMethod"), ["in_person"]);
  assert.deepEqual(checkedOf(html, "shadedPartsCompleted"), ["yes"]);
  assert.deepEqual(checkedOf(html, "stateForgivenessSet"), ["yes"]);
  assert.match(html, /name="readyForReviewOn" type="date" value="2026-10-19"/);
  assert.match(html, /name="resolution"[\s\S]*name="confirmedBy"[\s\S]*data-case-action="RESUBMIT_REVIEW"/);
});

test("resubmit with no earlier questionnaire", () => {
  const html = stepFor(
    { stage: "corrections_required", reviews: [{ id: "r1", status: "corrections_requested", findings: "Fix it.", preparationVersion: 1 }] },
    ALEX,
  );
  assert.deepEqual(checkedOf(html, "confirmedBy"), []);
  assert.deepEqual(checkedOf(html, "shadedPartsCompleted"), []);
  assert.match(html, /name="readyForReviewOn" type="date" value="2026-10-19"/);
});

test("the reviewer form sits above Approve", () => {
  const html = stepFor({ ...REVIEWING, answers: { service: "online" } }, MORGAN);
  const at = (needle) => html.indexOf(needle);
  assert.ok(at('name="completedOn"') > 0);
  assert.ok(at('name="completedOn"') < at('name="remarks"'));
  assert.ok(at('name="remarks"') < at('data-case-action="APPROVE_REVIEW"'));
  assert.ok(at('data-case-action="APPROVE_REVIEW"') < at('data-action="open-request-corrections"'));
  assert.match(html, /data-case-action="APPROVE_REVIEW"[^>]*data-service="online"/);
  assert.match(html, /Approve this review/);
  assert.match(html, /Ask the preparer for corrections/);
  assert.doesNotMatch(html, /<dialog|aria-modal/);
});

test("reviewer form defaults signing from service", () => {
  const sign = (service) => checkedOf(stepFor({ ...REVIEWING, answers: { service } }, MORGAN), "signMethod");
  assert.deepEqual(sign("online"), ["portal"]);
  assert.deepEqual(sign("drop_off"), []);
  assert.deepEqual(sign("same_day"), ["in_person"]);
});

test("reviewer form prefills going over from the contact log", () => {
  const html = stepFor({ ...REVIEWING, contacts: [contactEntry()] }, MORGAN);
  assert.deepEqual(checkedOf(html, "wentOver"), ["yes"]);
  assert.deepEqual(checkedOf(html, "wentOverHow"), ["phone"]);
  assert.match(html, /name="wentOverOn" type="date" value="2026-10-17"/);
  const none = stepFor(REVIEWING, MORGAN);
  assert.deepEqual(checkedOf(none, "wentOver"), []);
  assert.match(none, /name="wentOverOn" type="date" value=""/);
});

test("same-day reviewer form has no appointment block", () => {
  assert.doesNotMatch(stepFor({ ...REVIEWING, answers: { service: "same_day" } }, MORGAN), /signAppointmentAt|q-when-in-person/);
  assert.match(stepFor({ ...REVIEWING, answers: { service: "drop_off" } }, MORGAN), /name="signAppointmentAt" type="datetime-local"/);
});

test("Exit Form groups are collapsed details", () => {
  const html = stepFor(REVIEWING, MORGAN);
  const groups = html.match(/<details class="q-exit-group"[^>]*>/g);
  assert.equal(groups.length, 7);
  assert.ok(groups.every((tag) => !/ open/.test(tag)));
  for (const type of ["NPT", "BIRT", "EET", "SIT", "PAIBWTR"]) assert.match(html, new RegExp(`name="local\\.${type}\\.amount"`));
  assert.match(html, /name="federal\.method"/);
  assert.match(html, /name="state\.result"/);
});

test("an Exit Form group wraps each Result-dependent field for CSS to show or hide (#108)", () => {
  const html = stepFor(REVIEWING, MORGAN);
  const federal = html.match(/<details class="q-exit-group" data-exit-group="federal">[\s\S]*?<\/details>/)[0];
  assert.match(federal, /<div class="q-exit-when-amount">[^]*?name="federal\.amount"[^]*?<\/div>/);
  assert.match(federal, /<div class="q-exit-when-refund"><fieldset class="check-group"><legend>How the refund is paid<\/legend>[^]*?name="federal\.refundBy"/);
  assert.match(federal, /<div class="q-exit-when-owe"><fieldset class="check-group"><legend>How the amount owed is paid<\/legend>[^]*?name="federal\.oweBy"/);
  assert.match(federal, /<div class="q-exit-when-debit">[^]*?name="federal\.debitOn"/);
  // Method and Result stay outside every wrapper: they are always shown.
  assert.doesNotMatch(federal, /q-exit-when-[a-z]+">(?:(?!<\/div>)[^])*name="federal\.(?:method|result)"/);
  assert.equal((html.match(/class="q-exit-when-amount"/g) ?? []).length, 7);
});

test("every Exit Form group has a Clear control", () => {
  const html = stepFor(REVIEWING, MORGAN);
  const keys = ["federal", "state", "local.NPT", "local.BIRT", "local.EET", "local.SIT", "local.PAIBWTR"];
  for (const key of keys)
    assert.match(
      html,
      new RegExp(`<button type="button" class="btn secondary" data-action="clear-exit-group" data-group="${key.replace(".", "\.")}">Clear this section</button>`),
    );
  assert.equal((html.match(/data-action="clear-exit-group"/g) ?? []).length, 7);
});

test("the seeded Ready to exit sample's answers render", () => {
  // The sample's shape: Federal refund and a Local NPT entry in a list.
  const record = staffCase({
    stage: "review_approved",
    preparationVersion: 1,
    reviews: [reviewRow({ status: "approved", clientContactStatus: "completed", clientContactOutcome: "reached" })],
    preparerQuestionnaires: [prepQ()],
    reviewerQuestionnaires: [
      revQ({
        exitForm: {
          federal: { method: "efile", result: "refund", amount: "412.00", refundBy: "direct_deposit" },
          state: null,
          local: [{ type: "NPT", method: "paper", result: "none" }],
        },
      }),
    ],
  });
  const html = renderStaffCase(record, MORGAN);
  assert.match(html, /<span>Exit Form, Federal<\/span><strong>E-file, refund 412\.00 by direct deposit<\/strong>/);
  assert.match(html, /<span>Exit Form, Local: NPT<\/span><strong>Paper, no refund or amount owed<\/strong>/);
});

test("the ready-for-review date is marked Changed only when it differs", () => {
  const compare = (nextDate) =>
    stepFor(
      {
        ...REVIEWING,
        preparationVersion: 2,
        reviews: [reviewRow({ preparationVersion: 2 })],
        preparerQuestionnaires: [prepQ(), prepQ({ id: "pq-2", preparationVersion: 2, readyForReviewOn: nextDate })],
      },
      MORGAN,
    );
  const dateRow = /<th scope="row">Ready for review in TaxSlayer on<\/th>[^]*?<\/tr>/;
  assert.doesNotMatch(compare("2026-10-10").match(dateRow)[0], /Changed/);
  assert.match(compare("2026-10-17").match(dateRow)[0], /<td>10\/17\/2026 <mark class="q-changed">Changed<\/mark>/);
});

test("Review in progress shows previous and current with changes marked", () => {
  const html = stepFor(
    {
      ...REVIEWING,
      preparationVersion: 2,
      reviews: [reviewRow({ preparationVersion: 2 })],
      preparerQuestionnaires: [prepQ(), prepQ({ id: "pq-2", preparationVersion: 2, confirmedMethod: "phone" })],
    },
    MORGAN,
  );
  assert.equal((html.match(/Changed<\/mark>/g) ?? []).length, 1);
  assert.match(html, /<th scope="row">How it was confirmed<\/th><td>In person<\/td><td>Phone <mark class="q-changed">Changed<\/mark>/);
  assert.ok(html.indexOf("q-compare") < html.indexOf('name="completedOn"'));
  // The first version has nothing to compare.
  assert.doesNotMatch(stepFor({ ...REVIEWING, preparerQuestionnaires: [prepQ()] }, MORGAN), /q-compare/);
});

test("questionnaire dates on staff screens read MM/DD/YYYY", () => {
  const record = staffCase({
    stage: "review_approved",
    preparationVersion: 1,
    reviewerId: "morgan",
    reviews: [reviewRow({ id: "review-1", status: "approved", clientContactStatus: "completed", clientContactOutcome: "reached" })],
    preparerQuestionnaires: [prepQ()],
    reviewerQuestionnaires: [
      revQ({
        signMethod: "in_person",
        signAppointmentAt: "2026-11-02T14:30:00",
        exitForm: {
          federal: null,
          state: { method: "efile", result: "owe", amount: "45.50", oweBy: "direct_debit", debitOn: "2027-04-15" },
          local: [],
        },
      }),
    ],
  });
  const html = renderStaffCase(record, MORGAN);
  assert.match(html, /<span>Ready for review in TaxSlayer on<\/span><strong>10\/10\/2026<\/strong>/);
  assert.match(html, /<span>Completed in TaxSlayer on<\/span><strong>10\/17\/2026<\/strong>/);
  assert.match(html, /<span>Exit Form, State<\/span><strong>E-file, owes 45\.50 by direct debit on 04\/15\/2027<\/strong>/);
  assert.match(html, /<span>Form 8879 signing<\/span><strong>In person, appointment 11\/02\/2026 14:30<\/strong>/);
  assert.doesNotMatch(html, /20\d\d-\d\d-\d\d<\/strong>/);
});

test("review panel shows answers per version", () => {
  const record = staffCase({
    stage: "review_approved",
    preparationVersion: 2,
    reviews: [
      reviewRow({ id: "review-0", preparationVersion: 1, status: "corrections_requested", findings: "Fix it." }),
      reviewRow({ id: "review-1", preparationVersion: 2, status: "approved", decidedAt: "2026-09-13T16:00:00.000Z", clientContactStatus: "completed", clientContactOutcome: "reached", clientContactedAt: "2026-09-13T16:00:00.000Z" }),
    ],
    preparerQuestionnaires: [prepQ(), prepQ({ id: "pq-2", preparationVersion: 2, confirmedMethod: "phone" })],
    reviewerQuestionnaires: [revQ()],
  });
  const html = renderStaffCase(record, MORGAN);
  assert.equal((html.match(/<h4>Preparer's answers<\/h4>/g) ?? []).length, 2);
  assert.match(html, /<span>How it was confirmed<\/span><strong>In person<\/strong>/);
  assert.match(html, /<span>How it was confirmed<\/span><strong>Phone<\/strong>/);
  assert.match(html, /<span>Exit Form, Federal<\/span><strong>E-file, refund 120\.00 by direct deposit<\/strong>/);
  assert.match(html, /<span>Exit Form, Local: NPT<\/span><strong>Paper, no refund or amount owed<\/strong>/);
  assert.match(html, /<span>Remarks<\/span><strong>Looks right\.<\/strong>/);
  assert.match(html, /<span>Client conversation<\/span><strong>The reviewer went over the return with the client on 10\/16\/2026\.<\/strong>/);
  assert.match(html, /<span>Went over the return with the client<\/span><strong>Yes, on 10\/16\/2026/);
  // Only the approval with a questionnaire offers the Exit Form.
  assert.equal((html.match(/data-action="view-exit-form"/g) ?? []).length, 1);
  assert.match(html, /data-action="view-exit-form" data-review="review-1">Download Exit Form</);
});

test("the Exit Form's blocked-tab link has a place only on the Intake answers tab, and only for who sees the contact details (#122)", () => {
  const record = staffCase({
    stage: "review_approved",
    preparationVersion: 1,
    preparerId: "alex",
    reviewerId: "morgan",
    reviews: [reviewRow({ id: "review-1", status: "approved", clientContactStatus: "completed", clientContactOutcome: "reached" })],
    preparerQuestionnaires: [prepQ()],
    reviewerQuestionnaires: [revQ()],
  });
  // Known problem, #122: another volunteer gets the button but no place to show
  // the blocked-tab link. This records what happens, not what we want.
  const other = renderStaffCase(record, { id: "jo", name: "Jo", capabilities: ["review"] });
  assert.match(other, /data-action="view-exit-form"/);
  assert.doesNotMatch(other, /id="draft-ready"/);

  const reviewer = renderStaffCase(record, MORGAN);
  assert.match(reviewer, /data-action="view-exit-form"/);
  assert.match(reviewer, /id="draft-ready"/);
  assert.ok(reviewer.indexOf('id="draft-ready"') > reviewer.indexOf('id="case-panel-intake"'), "the link is not in the Overview");
});

test("no questionnaire recorded line", () => {
  const html = renderStaffCase(staffCase({ stage: "review_ready", preparationVersion: 1, reviews: [reviewRow({ status: "approved" })] }), MORGAN);
  assert.match(html, /<p class="muted">No questionnaire was recorded for this version\.<\/p>/);
  assert.doesNotMatch(html, /view-exit-form/);
});

const approvedWith = (q) =>
  staffCase({
    stage: "review_approved",
    preparationVersion: 1,
    reviewerId: "morgan",
    reviews: [reviewRow({ status: "approved", clientContactStatus: q ? "completed" : "pending" })],
    reviewerQuestionnaires: q ? [q] : [],
  });
const approvedStep = (record) => nextStep(record, staffEligibility(record, MORGAN), {});

test("approved with yes offers no conversation form", () => {
  const html = approvedStep(approvedWith(revQ()));
  assert.doesNotMatch(html, /RECORD_REVIEW_CONTACT/);
  assert.match(html, /The reviewer went over the return with the client on 10\/16\/2026\./);
});

test("approved with no says the office takes over", () => {
  const html = approvedStep(approvedWith(revQ({ wentOver: false, wentOverOn: null, wentOverHow: null })));
  assert.doesNotMatch(html, /RECORD_REVIEW_CONTACT/);
  assert.match(html, /The office will go over the return with the client\./);
});

test("legacy pending approval still shows the conversation form", () => {
  assert.match(approvedStep(approvedWith(null)), /data-case-action="RECORD_REVIEW_CONTACT"/);
});

test("logContactForm: purpose preselects on a new entry, never overrides an edit", () => {
  const checked = (html) => [...html.matchAll(/name="purpose" value="([a-z_]+)" required checked/g)].map((m) => m[1]);
  assert.deepEqual(checked(logContactForm(staffCase(), SAM, {}, { followupId: "t", purpose: "go_over_return" })), ["go_over_return"]);
  assert.deepEqual(checked(logContactForm(staffCase(), SAM, {})), []);
  const entry = staffCase({ contacts: [contactEntry({ purpose: "ask_question" })] }).contacts[0];
  assert.deepEqual(checked(logContactForm(staffCase(), SAM, {}, { contact: entry, purpose: "go_over_return" })), ["ask_question"]);
});

test("old VERIFY_INTAKE event renders", () => {
  const html = renderStaffCase(
    staffCase({
      internalHistory: [
        {
          id: "e1",
          action: "VERIFY_INTAKE",
          detail: { simulated: true, checks: { interview: true, identity: true, documents: true, consent: true } },
          createdAt: "2026-09-12T17:00:00.000Z",
        },
      ],
    }),
    ALEX,
  );
  assert.match(html, /recorded the screening checks/i);
  assert.doesNotMatch(html, /simulat/i);
});

test("the case page header names Accepted by the filing method", () => {
  const html = renderStaffCase(
    staffCase({ stage: "accepted", federalMethod: "paper", stateMethod: "paper", federalResult: "given_to_client", stateResult: "given_to_client" }),
    SAM,
  );
  assert.match(html, /<i><\/i>Paper<\/span>/);
  assert.doesNotMatch(html, /Mailed/);
});

test("a paper return in the Filing panel reads Paper · Given to the client, with no date, and none waits for a mailing", () => {
  const html = filingPanel(
    staffCase({
      stage: "accepted",
      filingAttempts: [
        {
          attempt: 1,
          filedAt: "2026-10-01T15:00:00.000Z",
          returns: [
            { returnKind: "federal", method: "efile", result: "accepted", answeredOn: "2026-10-03", rejectCode: null },
            { returnKind: "state", method: "paper", result: "given_to_client", answeredOn: null, rejectCode: null },
          ],
          notes: [],
        },
      ],
    }),
  );
  assert.match(html, /Pennsylvania return[^]*?Paper · Given to the client/);
  assert.doesNotMatch(html, /Paper · Given to the client · /);
  assert.doesNotMatch(html, /mailed|Mailed/);
  // A paper return filed before the rule, with no result, reads the same.
  const stuck = filingPanel(staffCase({ stage: "efiled", federalMethod: "paper", stateMethod: "paper" }));
  assert.match(stuck, /Paper · Given to the client/);
  assert.doesNotMatch(stuck, /mailed|Mailed|Waiting for/);
});

test("a season-end close reads as one", () => {
  assert.equal(
    historySentence({
      action: "CLOSE_CASE",
      actorName: "Sam",
      detail: { reason: "dismissed", seasonEnd: true },
      createdAt: "2026-10-01T12:00:00Z",
    }),
    "Sam closed the case at season end · Dismissed.",
  );
});

// ---------------------------------------------------------------------------
// The shaded section (change add-preparer-13614c-fields, design D4 and D8)
// ---------------------------------------------------------------------------

test("shaded tools only for the case's preparer at the two stages", () => {
  for (const stage of ["preparing", "corrections_required"]) {
    const rights = staffEligibility(staffCase({ stage }), ALEX);
    assert.deepEqual(rights.shadedSection, { allowed: true, reason: "" }, stage);
    const html = renderStaffCase(staffCase({ stage }), ALEX);
    assert.match(html, /data-action="download-shaded-copy"[^>]*>(?:<svg.*?<\/svg>)? Download to fill elsewhere<\/button>/, stage);
    // The editor first, with download / upload always beside it (D7, D8).
    assert.match(html, /data-action="open-shaded-editor"[^>]*>(?:<svg.*?<\/svg>)? Fill the shaded section<\/button>/, stage);
    assert.ok(html.indexOf("open-shaded-editor") < html.indexOf("download-shaded-copy"), stage);
    assert.match(html, /Chrome and Edge 125 or later, Firefox ESR or later, and Safari 18 or later/, stage);
    assert.match(html, /<input type="file" id="shaded-upload" accept="application\/pdf" data-action="upload-shaded-copy"/, stage);
    assert.match(html, /<label[^>]*for="shaded-upload"[^>]*>(?:<svg.*?<\/svg>)? Upload the filled copy<\/label>/, stage);
  }
  // Refused with the preparationWork sentences otherwise.
  const refusals = [
    [staffCase({ stage: "review_ready" }), ALEX],
    [staffCase({ stage: "reviewing", reviewerId: "morgan" }), ALEX],
    [staffCase({ stage: "on_hold" }), ALEX],
    [staffCase({ stage: "preparing" }), MORGAN],
    [staffCase({ stage: "corrections_required", reviewerId: "morgan" }), MORGAN],
    [staffCase({ stage: "preparing" }), { id: "casey", name: "Casey", capabilities: ["prepare"] }],
    [staffCase({ stage: "preparing", preparerId: null, participants: [] }), ALEX],
    [staffCase({ stage: "preparing" }), null],
  ];
  for (const [record, person] of refusals) {
    const rights = staffEligibility(record, person);
    assert.equal(rights.shadedSection.allowed, false, `${record.stage} ${person?.id}`);
    assert.deepEqual(rights.shadedSection, rights.preparationWork);
    const html = renderStaffCase(record, person);
    assert.doesNotMatch(html, /download-shaded-copy|upload-shaded-copy|open-shaded-editor/);
    assert.match(html, /aria-labelledby="shaded-title"/, "the panel says why, in place");
    assert.ok(html.includes(rights.preparationWork.reason.replace("'", "&#39;")), rights.preparationWork.reason);
  }
});

test("the shaded panel says Saved and its upload error in place, with Dismiss only", () => {
  const record = staffCase({
    preparerShadedFields: [{ caseId: "case-a", fields: { incomeW2s: true }, version: 2 }],
  });
  const saved = renderStaffCase(record, ALEX, { shadedStatus: { caseId: "case-a", text: "Saved" } });
  assert.match(saved, /id="shaded-status"[^>]*>Saved</);
  // Another case's Saved is not this case's.
  assert.doesNotMatch(
    renderStaffCase(record, ALEX, { shadedStatus: { caseId: "case-b", text: "Saved" } }),
    /id="shaded-status"[^>]*>Saved</,
  );
  const error = { code: "VALIDATION", message: "This file isn't a PDF the editor can read.", place: "shaded-upload" };
  const html = renderStaffCase(record, ALEX, { error, retryable: true, shadedStatus: { caseId: "case-a", text: "Saved" } });
  // Once, beside the upload control, and not at the top of the page.
  assert.equal(html.match(/role="alert"/g).length, 1);
  assert.match(html, /<div class="notice error" role="alert" id="shaded-upload-error">.*This file isn&#39;t a PDF the editor can read\./);
  const panel = html.slice(html.indexOf('aria-labelledby="shaded-title"'));
  assert.match(panel, /id="shaded-upload-error"/);
  assert.match(panel, /<input type="file"[^>]*aria-describedby="shaded-upload-error"/);
  assert.match(panel, /data-action="dismiss-error"/);
  assert.doesNotMatch(panel.slice(0, panel.indexOf("</section>")), /retry-action/, "Dismiss only");
  assert.doesNotMatch(html, /id="shaded-status"[^>]*>Saved</, "the error replaces Saved");
  // A copy that couldn't be made says so, in its own words, and offers no
  // control it doesn't have.
  const download = renderStaffCase(record, ALEX, {
    error: { code: "DRAFT", message: "The copy could not be made. Press Download to fill elsewhere again.", place: SHADED_UPLOAD },
  });
  assert.match(download, /id="shaded-upload-error">.*<h3>The copy was not downloaded<\/h3><p>The copy could not be made\. Press Download to fill elsewhere again\.<\/p>/);
  assert.doesNotMatch(download, /The filled copy was not saved|retry-action/);
  // Any other error stays at the top of the page, as before.
  const other = renderStaffCase(record, ALEX, { error: { code: "SERVER_ERROR", message: "Something went wrong." } });
  assert.doesNotMatch(other, /id="shaded-upload-error"/);
  assert.match(other, /That step did not go through/);
});

test("an editor that couldn't be opened is said in the shaded panel, with Try again and Dismiss", () => {
  assert.equal(SHADED_EDITOR, "shaded-editor");
  const record = staffCase({});
  const error = {
    code: "EDITOR",
    message: "The editor could not be opened. Try again, or use Download to fill elsewhere.",
    place: SHADED_EDITOR,
  };
  const html = renderStaffCase(record, ALEX, { error, retryable: true });
  // Once, in the panel, not at the top of the page.
  assert.equal(html.match(/role="alert"/g).length, 1);
  assert.doesNotMatch(html, /That step did not go through/);
  const panel = html.slice(html.indexOf('aria-labelledby="shaded-title"'));
  const own = panel.slice(0, panel.indexOf("</section>"));
  assert.match(
    own,
    /<div class="notice error" role="alert" id="shaded-editor-error">.*<h3>The editor did not open<\/h3><p>The editor could not be opened\. Try again, or use Download to fill elsewhere\.<\/p>/,
  );
  assert.match(own, /data-action="retry-action"/);
  assert.match(own, /data-action="dismiss-error"/);
  // The download and upload tools are still offered beside it.
  assert.match(own, /data-action="download-shaded-copy"/);
  assert.match(own, /data-action="upload-shaded-copy"/);
  assert.match(own, /data-action="open-shaded-editor"/);
  assert.doesNotMatch(own, /id="shaded-upload-error"/);
});

test("history names changed fields", () => {
  assert.equal(EVENT_SENTENCES.SAVE_PREPARER_FIELDS, "saved the shaded section");
  assert.equal(
    historySentence({ action: "SAVE_PREPARER_FIELDS", actorName: "Alex", detail: { changed: ["incomeW2sCount", "incomeNotes"] } }),
    "Alex saved the shaded section · W-2s #, Income notes.",
  );
  assert.equal(
    historySentence({ action: "SAVE_PREPARER_FIELDS", actorName: "Alex", detail: { changed: [] } }),
    "Alex saved the shaded section · no fields changed.",
  );
});

// ---------------------------------------------------------------------------
// The shaded panel's Preview hint and review box (change guard-shaded-upload-against-preview)
// ---------------------------------------------------------------------------

const shadedFor = (ui = {}, record = staffCase({ stage: "preparing" })) =>
  shadedPanel(record, staffEligibility(record, ALEX), ui);
const review = (values, preview = false, caseId = staffCase().id) => ({ shadedReview: { caseId, values, version: 1, preview } });

test("the download note", () => {
  const html = shadedFor();
  assert.match(
    html,
    /Download to fill elsewhere<\/button><p class="field-note shaded-download-note">Open it in Chrome or the free Adobe Acrobat Reader, not macOS Preview\.<\/p>/,
  );
});

test("the review box", () => {
  const html = shadedFor(review({ infoNotes: "n", infoLastReturnAvailable: true, household1OwnSupport: "yes" }));
  assert.match(html, /<div class="shaded-review" role="region" aria-labelledby="shaded-review-title">/);
  assert.match(html, /<h3 id="shaded-review-title" tabindex="-1">Check what was read from this copy<\/h3>/);
  assert.match(html, /<p>3 filled fields:<\/p>/);
  assert.match(html, /<span class="shaded-review-value">ticked<\/span>/);
  assert.match(html, /data-action="confirm-shaded-review"[^>]*>Save these values<\/button>/);
  assert.match(html, /data-action="cancel-shaded-review"[^>]*>Cancel<\/button>/);
  assert.doesNotMatch(html, /id="shaded-upload"/);
  const labels = [...html.matchAll(/shaded-review-label">([^<]*)</g)].map((m) => m[1]);
  assert.equal(labels.length, 3);
  assert.ok(labels[0].startsWith("Row 1"), labels[0]);
  assert.match(shadedFor(review({ infoNotes: "n" })), /<p>1 filled field:<\/p>/);
});

test("review rows escape and keep line breaks", () => {
  const html = shadedFor(review({ infoNotes: "<b>x</b>\nline 2" }));
  assert.match(html, /<span class="shaded-review-value">&lt;b&gt;x&lt;\/b&gt;\nline 2<\/span>/);
  assert.doesNotMatch(html, /<b>x/);
});

test("the Preview line", () => {
  const warn = "This copy was saved by macOS Preview, which can drop or change values. Check them before saving.";
  assert.ok(shadedFor(review({ infoNotes: "n" }, true)).includes(`<p class="shaded-review-warning">${warn}</p>`));
  assert.ok(!shadedFor(review({ infoNotes: "n" }, false)).includes(warn));
});

test("a review for another case isn't shown", () => {
  const html = shadedFor(review({ infoNotes: "n" }, false, "some-other-case"));
  assert.doesNotMatch(html, /shaded-review"/);
  assert.match(html, /id="shaded-upload"/);
});

test("busy disables the review buttons; a refused viewer sees no review", () => {
  assert.match(shadedFor({ ...review({ infoNotes: "n" }), busy: true }), /confirm-shaded-review"[^>]*disabled/);
  const record = staffCase({ stage: "review_ready" });
  assert.doesNotMatch(shadedFor(review({ infoNotes: "n" }), record), /shaded-review"/);
});
