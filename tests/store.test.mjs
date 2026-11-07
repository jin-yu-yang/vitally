import test from "node:test";
import assert from "node:assert/strict";
import {
  createStore,
  mapCase,
  mapAssistance,
  mapFollowup,
  SUBSCRIBED_TABLES,
} from "../src/supabase-store.mjs";

// The staff tables an applicant read must never touch. The live file proves
// RLS would refuse them anyway; this asserts the adapter does not even ask.
const STAFF_ONLY_TABLES = [
  "people",
  "preparation_participants",
  "admin_followups",
  "contact_attempts",
  "contact_log",
  "contact_log_versions",
  "case_events",
  "reviews",
  "assistance_items",
  "action_receipts",
  "case_materials",
  "preparer_questionnaires",
  "reviewer_questionnaires",
  "preparer_shaded_fields",
  "filing_attempts",
  "filing_returns",
  "filing_notes",
];

const CASE_ROW = Object.freeze({
  id: "case-1",
  reference: "VT-ABCD-2345",
  workspace_id: "workspace-1",
  owner_user_id: "user-1",
  origin: "client",
  created_by_user_id: "user-1",
  created_by_person_id: null,
  answers: { year: "2025" },
  stage: "preparing",
  revision: 7,
  preparation_version: 1,
  intake_verified: true,
  preparer_id: "person-alex",
  reviewer_id: null,
  season: 2025,
  client_number: 93,
  last_reminded_at: null,
  last_reminded_by_person_id: null,
  created_at: "2026-09-10T15:00:00.000Z",
  updated_at: "2026-09-12T16:30:00.000Z",
  intake_version: 2,
  intake_visited: ["about.you", "before.ready"],
});

// Every related row the staff read assembles, one per table.
const RELATED_ROWS = Object.freeze({
  document_requests: [
    {
      id: "request-1",
      workspace_id: "workspace-1",
      case_id: "case-1",
      title: "Mileage record",
      message: "Please add the fictional sample.",
      status: "open",
      requested_by_person_id: "person-alex",
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
    },
  ],
  documents: [
    {
      id: "document-1",
      workspace_id: "workspace-1",
      case_id: "case-1",
      request_id: "request-1",
      filename: "demo-mileage-record-2025.pdf",
      source: "client",
      submitted_by_user_id: "user-1",
      submitted_by_person_id: null,
      created_at: "2026-09-02T00:00:00Z",
    },
  ],
  client_events: [
    {
      id: "client-event-1",
      workspace_id: "workspace-1",
      case_id: "case-1",
      action: "SUBMIT",
      message: "Application received.",
      created_at: "2026-09-01T00:00:00Z",
    },
  ],
  case_events: [
    {
      id: "case-event-1",
      workspace_id: "workspace-1",
      case_id: "case-1",
      actor_user_id: "user-2",
      actor_person_id: "person-sam",
      action: "VERIFY_INTAKE",
      detail: { simulated: true },
      created_at: "2026-09-01T00:00:00Z",
    },
  ],
  preparation_participants: [
    {
      workspace_id: "workspace-1",
      case_id: "case-1",
      person_id: "person-alex",
      created_at: "2026-09-01T00:00:00Z",
    },
  ],
  admin_followups: [
    {
      id: "followup-1",
      workspace_id: "workspace-1",
      case_id: "case-1",
      request_id: "request-1",
      assignee_person_id: "person-sam",
      status: "open",
      reason: "No response to the document request.",
      resolution_outcome: null,
      resolution_note: null,
      created_by_person_id: "person-alex",
      created_at: "2026-09-03T00:00:00Z",
      resolved_at: null,
    },
  ],
  contact_log: [
    {
      id: "contact-1",
      workspace_id: "workspace-1",
      case_id: "case-1",
      followup_id: "followup-1",
      logged_by_user_id: "user-2",
      logged_by_person_id: "person-sam",
      logged_at: "2026-09-04T00:05:00Z",
      revision: 1,
      edited_at: null,
      direction: "outgoing",
      contacted_at: "2026-09-04T00:00:00Z",
      with_whom: "client",
      other_name: null,
      method: "phone",
      purpose: "request_documents",
      outcome: "no_answer",
      note: null,
    },
    {
      id: "contact-2",
      workspace_id: "workspace-1",
      case_id: "case-1",
      followup_id: null,
      logged_by_user_id: "user-2",
      logged_by_person_id: "person-sam",
      logged_at: "2026-09-04T12:05:00Z",
      revision: 2,
      edited_at: "2026-09-04T13:00:00Z",
      direction: "incoming",
      contacted_at: "2026-09-04T12:00:00Z",
      with_whom: "other",
      other_name: "Pat Lee",
      method: "phone",
      purpose: "ask_question",
      outcome: "reached",
      note: "Asked about the W-2.",
    },
  ],
  contact_log_versions: [
    {
      contact_id: "contact-1",
      version: 1,
      workspace_id: "workspace-1",
      case_id: "case-1",
      edited_by_user_id: "user-2",
      edited_by_person_id: "person-sam",
      created_at: "2026-09-04T00:05:00Z",
      direction: "outgoing",
      contacted_at: "2026-09-04T00:00:00Z",
      with_whom: "client",
      other_name: null,
      method: "phone",
      purpose: "request_documents",
      outcome: "no_answer",
      note: null,
    },
    {
      contact_id: "contact-2",
      version: 1,
      workspace_id: "workspace-1",
      case_id: "case-1",
      edited_by_user_id: "user-2",
      edited_by_person_id: "person-sam",
      created_at: "2026-09-04T12:05:00Z",
      direction: "incoming",
      contacted_at: "2026-09-04T12:00:00Z",
      with_whom: "client",
      other_name: null,
      method: "phone",
      purpose: "ask_question",
      outcome: "reached",
      note: null,
    },
    {
      contact_id: "contact-2",
      version: 2,
      workspace_id: "workspace-1",
      case_id: "case-1",
      edited_by_user_id: "user-3",
      edited_by_person_id: "person-alex",
      created_at: "2026-09-04T13:00:00Z",
      direction: "incoming",
      contacted_at: "2026-09-04T12:00:00Z",
      with_whom: "other",
      other_name: "Pat Lee",
      method: "phone",
      purpose: "ask_question",
      outcome: "reached",
      note: "Asked about the W-2.",
    },
  ],
  reviews: [
    {
      id: "review-1",
      workspace_id: "workspace-1",
      case_id: "case-1",
      preparation_version: 1,
      reviewer_person_id: "person-morgan",
      status: "active",
      findings: null,
      resolution: null,
      client_contact_status: null,
      client_contact_outcome: null,
      client_contact_note: null,
      client_contacted_at: null,
      created_at: "2026-09-05T00:00:00Z",
      decided_at: null,
    },
  ],
  people: [
    {
      id: "person-alex",
      workspace_id: "workspace-1",
      person_key: "alex",
      name: "Alex",
      capabilities: ["prepare"],
    },
  ],
  case_contacts: [
    {
      workspace_id: "workspace-1",
      case_id: "case-1",
      phone: "2155550100",
      spouse_phone: null,
      best_contact_time: ["weekday_morning", "weekend"],
      best_contact_note: "After 5pm",
      updated_at: "2026-09-06T00:00:00Z",
    },
  ],
  case_document_cards: [
    {
      workspace_id: "workspace-1",
      case_id: "case-1",
      slot_id: "w2.household",
      status: "later",
      group_override: null,
      changed_at: "2026-09-08T00:00:00Z",
    },
    {
      workspace_id: "workspace-1",
      case_id: "case-1",
      slot_id: "ssn.tp",
      status: null,
      group_override: "needed",
      changed_at: "2026-09-08T01:00:00Z",
    },
  ],
  case_materials: [
    {
      workspace_id: "workspace-1",
      case_id: "case-1",
      item: "photo_id",
      received_at: "2026-09-07T00:00:00Z",
      recorded_by_person_id: "person-sam",
    },
    {
      workspace_id: "workspace-1",
      case_id: "case-1",
      item: "w2",
      received_at: "2026-09-07T00:00:00Z",
      recorded_by_person_id: "person-sam",
    },
  ],
  assistance_items: [
    {
      id: "item-1",
      workspace_id: "workspace-1",
      case_id: "case-1",
      title: "Client needs help completing intake forms",
      status: "open",
      revision: 1,
      assignee_person_id: null,
      language: "Mandarin",
      contact_preference: "Prefers calls from the main office",
      resolution_note: null,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
    },
  ],
});

// A captured supabase-js double: it records every table read, every RPC
// envelope and every channel, and answers from plain fixture rows.
// What supabase-js returns from `getUser()` when there is no session: an
// `AuthSessionMissingError`, which carries a name and a status but no
// database code. The SDK never answers with a null user and no error.
const SESSION_MISSING = Object.freeze({
  name: "AuthSessionMissingError",
  status: 400,
  message: "Auth session missing!",
});
// What it returns when the request could not reach the server. It is returned,
// not thrown, and it is just as code-less as the one above.
const RETRYABLE_FETCH = Object.freeze({
  name: "AuthRetryableFetchError",
  status: 0,
  message: "Failed to fetch",
});

function fakeClient({
  access = "presenter",
  user = { id: "user-1", email: "student@example.com" },
  rows = {},
  rpc,
  readError,
  authError,
  authThrows,
} = {}) {
  const table = (name) =>
    name === "memberships"
      ? access === null
        ? []
        : [{ user_id: user?.id, workspace_id: "workspace-1", access }]
      : name === "cases"
        ? (rows.cases ?? [CASE_ROW])
        : (rows[name] ?? RELATED_ROWS[name] ?? []);
  const client = {
    reads: [],
    rpcCalls: [],
    channels: [],
    removed: [],
    auth: {
      // Mirrors the SDK: a failure is returned, never `error: undefined`, and
      // a null user always comes with the error that explains it.
      getUser: async () => {
        if (authThrows) throw authThrows;
        if (authError) return { data: { user: null }, error: authError };
        return user
          ? { data: { user }, error: null }
          : { data: { user: null }, error: SESSION_MISSING };
      },
    },
    from(name) {
      const read = { table: name, filters: [], orders: [] };
      client.reads.push(read);
      const builder = {
        select(columns) {
          read.columns = columns;
          return builder;
        },
        eq(column, value) {
          read.filters.push([column, value]);
          return builder;
        },
        in(column, values) {
          read.within = [column, [...values]];
          return builder;
        },
        order(column) {
          read.orders.push(column);
          return builder;
        },
        then: (onFulfilled, onRejected) =>
          Promise.resolve()
            .then(() => {
              if (readError) return { data: null, error: readError };
              const matches = table(name).filter(
                (row) =>
                  read.filters.every(([column, value]) => row[column] === value) &&
                  (!read.within || read.within[1].includes(row[read.within[0]])),
              );
              // PostgREST returns the columns that were asked for and no
              // others, so the double projects them too: a read that names its
              // columns cannot quietly deliver the rest of the row.
              if (!read.columns || read.columns === "*")
                return { data: matches, error: null };
              const wanted = read.columns.split(",").map((name_) => name_.trim());
              return {
                data: matches.map((row) =>
                  Object.fromEntries(wanted.map((column) => [column, row[column]])),
                ),
                error: null,
              };
            })
            .then(onFulfilled, onRejected),
      };
      return builder;
    },
    async rpc(name, args) {
      client.rpcCalls.push({ name, args });
      return rpc
        ? rpc(name, args)
        : { data: { actionId: args.p_action_id }, error: null };
    },
    channel(name) {
      const record = { name, bindings: [], status: null, handlers: {} };
      client.channels.push(record);
      const channel = {
        record,
        on(type, filter, handler) {
          record.bindings.push({ type, filter, handler });
          return channel;
        },
        subscribe(onStatus) {
          record.onStatus = onStatus;
          return channel;
        },
      };
      record.channel = channel;
      return channel;
    },
    removeChannel(channel) {
      client.removed.push(channel);
    },
  };
  return client;
}

// `subscribe` resolves the caller's access before it opens a channel, so tests
// wait for the channel rather than guessing at a tick count.
const settle = async () => {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
};

test("the principal is the caller's own membership plus their identity", async () => {
  const client = fakeClient({ access: "applicant" });
  assert.deepEqual(await createStore(client).getPrincipal(), {
    userId: "user-1",
    workspaceId: "workspace-1",
    access: "applicant",
    email: "student@example.com",
    personId: null,
    personName: null,
  });
  assert.deepEqual(
    client.reads.map((read) => read.table),
    ["memberships"],
  );
});

const STAFF_PERSON = {
  id: "person-sam",
  workspace_id: "workspace-1",
  person_key: "sam",
  name: "Sam",
  capabilities: ["prepare"],
  user_id: "user-1",
};

test("a staff principal carries the person linked to the signed-in account", async () => {
  const client = fakeClient({
    access: "staff",
    rows: { people: [{ ...STAFF_PERSON, id: "person-other", user_id: "user-9" }, STAFF_PERSON] },
  });
  const principal = await createStore(client).getPrincipal();
  assert.equal(principal.access, "staff");
  assert.equal(principal.personId, "person-sam");
  assert.equal(principal.personName, "Sam");
  assert.deepEqual(client.reads.at(-1).filters, [["user_id", "user-1"]]);
});

test("a presenter principal reads no person", async () => {
  const client = fakeClient({ access: "presenter" });
  const principal = await createStore(client).getPrincipal();
  assert.equal(principal.personId, null);
  assert.equal(principal.personName, null);
  assert.ok(!client.reads.some((read) => read.table === "people"));
});

test("a staff case list reads what a presenter's does, filing notes included", async () => {
  const tables = async (access) => {
    const client = fakeClient({ access });
    await createStore(client).listCases();
    return client.reads.map((read) => read.table).filter((name) => name !== "memberships");
  };
  const presenter = await tables("presenter");
  assert.ok(presenter.includes("filing_notes"));
  assert.deepEqual(await tables("staff"), presenter);
});

test("a staff case read adds exactly the staff sections, filing tables too", async () => {
  const tables = async (access) => {
    const client = fakeClient({ access });
    await createStore(client).getCase("case-1");
    return client.reads.map((read) => read.table);
  };
  const presenter = await tables("presenter");
  for (const name of ["filing_attempts", "filing_returns", "filing_notes", "reviews"])
    assert.ok(presenter.includes(name), name);
  assert.deepEqual(await tables("staff"), presenter);
});

test("staff subscribe to the staff tables, and read the roster and assistance list", async () => {
  assert.equal(SUBSCRIBED_TABLES.staff, SUBSCRIBED_TABLES.presenter);
  const client = fakeClient({ access: "staff" });
  const store = createStore(client);
  store.subscribe();
  await settle();
  const watched = new Set(client.channels[0].bindings.map((b) => b.filter.table));
  assert.deepEqual([...watched].sort(), [...SUBSCRIBED_TABLES.staff].sort());
  assert.equal((await store.listPeople()).length, 1);
  assert.equal((await store.listAssistance()).length, 1);
});

test("a staff call names no person, whatever the request says", async () => {
  const client = fakeClient({ access: "staff" });
  const store = createStore(client);
  await store.createCase({ mode: "x", personId: "person-x", answers: {} });
  await store.act({ caseId: "c", expectedRevision: 1, personId: "person-x", type: "t", payload: {} });
  await store.logContact({ caseId: "c", personId: "person-x", entry: {} });
  await store.editContact({ contactId: "k", expectedRevision: 1, personId: "person-x", entry: {} });
  await store.actAssistance({ itemId: "i", expectedRevision: 1, personId: "person-x", type: "t" });
  await store.closeUnsigned({ personId: "person-x", cases: [], confirmed: true });
  assert.equal(client.rpcCalls.length, 6);
  for (const call of client.rpcCalls) assert.equal(call.args.p_person_id, null, call.name);
});

test("a presenter's call still names the person the request carries", async () => {
  const client = fakeClient({ access: "presenter" });
  await createStore(client).closeUnsigned({ personId: "person-x", cases: [], confirmed: true });
  assert.equal(client.rpcCalls[0].args.p_person_id, "person-x");
});

test("no membership and no session are both FORBIDDEN", async () => {
  await assert.rejects(() => createStore(fakeClient({ access: null })).getPrincipal(), {
    code: "FORBIDDEN",
  });
  await assert.rejects(
    () => createStore(fakeClient({ user: null })).getPrincipal(),
    { code: "FORBIDDEN" },
  );
});

test("an unreachable server is OFFLINE, not a refusal", async () => {
  // The SDK returns this failure instead of throwing it, and it is as
  // code-less as a missing session. Telling an offline visitor with a cached
  // session that they have no access would be the wrong answer, and the wrong
  // screen.
  await assert.rejects(
    () => createStore(fakeClient({ authError: RETRYABLE_FETCH })).getPrincipal(),
    (error) => {
      assert.equal(error.code, "OFFLINE");
      assert.equal(error.cause, RETRYABLE_FETCH);
      return true;
    },
  );
  // A visitor who is simply signed out still gets the refusal.
  await assert.rejects(
    () => createStore(fakeClient({ authError: SESSION_MISSING })).getPrincipal(),
    { code: "FORBIDDEN" },
  );
  // A thrown call stays OFFLINE, as before.
  await assert.rejects(
    () =>
      createStore(
        fakeClient({ authThrows: new TypeError("fetch failed") }),
      ).getPrincipal(),
    { code: "OFFLINE" },
  );
});

test("listCases maps rows to the Case scalars with no related tables", async () => {
  const client = fakeClient({ access: "applicant" });
  const cases = await createStore(client).listCases();
  assert.deepEqual(cases, [
    {
      id: "case-1",
      reference: "VT-ABCD-2345",
      workspaceId: "workspace-1",
      ownerUserId: "user-1",
      stage: "preparing",
      revision: 7,
      preparationVersion: 1,
      answers: { year: "2025" },
      intakeVerified: true,
      preparerId: "person-alex",
      reviewerId: null,
      season: 2025,
      clientNumber: 93,
      lastRemindedAt: null,
      lastRemindedByPersonId: null,
      createdAt: "2026-09-10T15:00:00.000Z",
      updatedAt: "2026-09-12T16:30:00.000Z",
      intakeVersion: 2,
      intakeVisited: ["about.you", "before.ready"],
      signingPlan: null,
      signingAppointmentAt: null,
      federalMethod: null,
      stateMethod: null,
      federalResult: null,
      stateResult: null,
      documentsOrigin: null,
      holdOrigin: null,
      closingReason: null,
    },
  ]);
  assert.deepEqual(cases[0], mapCase(CASE_ROW));
  // The list asks who is reading before it decides what to fetch, so a client
  // list still names no staff table at all (Ruling R56).
  assert.deepEqual(
    client.reads.map((read) => read.table),
    ["memberships", "cases"],
  );
  for (const staffTable of STAFF_ONLY_TABLES)
    assert.ok(
      !client.reads.some((read) => read.table === staffTable),
      staffTable,
    );
});

test("a presenter list carries the summaries a work board reads", async () => {
  const client = fakeClient({ access: "presenter" });
  const [row] = await createStore(client).listCases();
  // The Case scalars, unchanged, plus exactly eight summary fields (the
  // eighth, the newest fix note, is read from filing_notes for Follow-ups).
  assert.deepEqual(
    Object.keys(row).toSorted(),
    [
      ...Object.keys(mapCase(CASE_ROW)),
      "followupAssigneeIds",
      "goOverOpen",
      "latestFixNote",
      "openFollowups",
      "openRequests",
      "openWithdrawalNotices",
      "participants",
      "phone",
      "reviewContactStatus",
      "withdrawalNoticeReason",
    ].toSorted(),
  );
  assert.deepEqual(row.participants, ["person-alex"]);
  assert.equal(row.openFollowups, 1);
  // The fake client's one open task is not a withdrawal notice.
  assert.equal(row.openWithdrawalNotices, 0);
  assert.equal(row.withdrawalNoticeReason, null);
  assert.deepEqual(row.followupAssigneeIds, ["person-sam"]);
  assert.equal(row.openRequests, 1);
  // The client's phone for the list's masked column (D5), and nothing else
  // of the contact row.
  assert.equal(row.phone, "2155550100");
  // Five grouped reads, each scoped to the cases this list actually holds,
  // and each asking only for the columns the board needs.
  const summaries = client.reads.filter((read) =>
    [
      "preparation_participants",
      "admin_followups",
      "document_requests",
      "case_contacts",
      "reviews",
    ].includes(read.table),
  );
  assert.equal(summaries.length, 5);
  for (const read of summaries) assert.deepEqual(read.within, ["case_id", ["case-1"]]);
  assert.ok(!summaries.some((read) => read.columns === "*"), "no whole rows");
  // Only the open work is counted: a resolved task is not a task.
  for (const read of summaries.filter((entry) =>
    ["admin_followups", "document_requests"].includes(entry.table),
  ))
    assert.deepEqual(read.filters, [["status", "open"]]);
  // The phone read names the phone and nothing else: no spouse phone, best
  // time or note reaches a list.
  const phoneRead = summaries.find((read) => read.table === "case_contacts");
  assert.equal(phoneRead.columns, "case_id,phone");
  assert.deepEqual(phoneRead.filters, []);
  // The reviewer's call is read from the approved reviews alone, and only
  // the status column (no note, outcome or findings) reaches a list.
  const approvalRead = summaries.find((read) => read.table === "reviews");
  assert.equal(approvalRead.columns, "case_id,client_contact_status,created_at");
  assert.deepEqual(approvalRead.filters, [["status", "approved"]]);
  assert.deepEqual(approvalRead.orders, ["created_at"]);
  // This case has only an active review, so no call status yet.
  assert.equal(row.reviewContactStatus, null);
  assert.equal(row.latestFixNote, null);
});

test("a listed case carries its latest approved review's call status", async () => {
  const review = (id, caseId, status, contact, createdAt) => ({
    ...RELATED_ROWS.reviews[0],
    id,
    case_id: caseId,
    status,
    client_contact_status: contact,
    created_at: createdAt,
  });
  const rows = {
    cases: [
      CASE_ROW,
      { ...CASE_ROW, id: "case-2", reference: "VT-WXYZ-6789" },
      { ...CASE_ROW, id: "case-3", reference: "VT-QRST-1234" },
    ],
    reviews: [
      // case-1: an older approval whose call is pending, then a newer one
      // that is completed. The newer wins (the read is ordered by created_at).
      review("r-1", "case-1", "approved", "pending", "2026-09-05T00:00:00Z"),
      review("r-2", "case-1", "approved", "completed", "2026-09-08T00:00:00Z"),
      // case-2: approved, call still pending.
      review("r-3", "case-2", "approved", "pending", "2026-09-06T00:00:00Z"),
      // case-3: only an active review, so no approval at all.
      review("r-4", "case-3", "active", null, "2026-09-07T00:00:00Z"),
    ],
  };
  const client = fakeClient({ access: "presenter", rows });
  const list = await createStore(client).listCases();
  const byId = Object.fromEntries(list.map((row) => [row.id, row.reviewContactStatus]));
  assert.deepEqual(byId, { "case-1": "completed", "case-2": "pending", "case-3": null });
});

test("a listed case with no contact row has no phone", async () => {
  const client = fakeClient({ access: "presenter", rows: { case_contacts: [] } });
  const [row] = await createStore(client).listCases();
  assert.equal(row.phone, null);
});

test("an empty presenter list asks for no summaries at all", async () => {
  const client = fakeClient({ access: "presenter", rows: { cases: [] } });
  assert.deepEqual(await createStore(client).listCases(), []);
  assert.deepEqual(
    client.reads.map((read) => read.table),
    ["memberships", "cases"],
  );
});

test("the workspace read carries the office's settings", async () => {
  const client = fakeClient({
    access: "presenter",
    rows: {
      workspaces: [
        {
          id: "workspace-1",
          default_followup_person_id: "person-sam",
          current_season: 2025,
          default_intake_version: 2,
        },
      ],
    },
  });
  assert.deepEqual(await createStore(client).getWorkspace(), {
    id: "workspace-1",
    defaultFollowupPersonId: "person-sam",
    currentSeason: 2025,
    defaultIntakeVersion: 2,
  });
  await assert.rejects(
    () => createStore(fakeClient({ rows: { workspaces: [] } })).getWorkspace(),
    { code: "NOT_FOUND" },
  );
});

test("the workspace read carries its default intake version as a number", async () => {
  // The version a new application starts at (spec 2026-09-30 §4.2). The
  // column is always 2 (migration 023), so there is no fallback.
  const row = { id: "workspace-1", default_followup_person_id: null };
  const read = async (extra) =>
    (await createStore(fakeClient({ access: "presenter", rows: { workspaces: [{ ...row, ...extra }] } })).getWorkspace())
      .defaultIntakeVersion;
  assert.equal(await read({ default_intake_version: 2 }), 2);
  assert.equal(await read({ default_intake_version: "2" }), 2);
});

test("a workspace row without a season column reads as any season", async () => {
  // A database from before migration 010 has no current_season: the board
  // then searches client numbers across every season rather than none.
  const client = fakeClient({
    access: "presenter",
    rows: {
      workspaces: [
        { id: "workspace-1", default_followup_person_id: null },
      ],
    },
  });
  assert.equal((await createStore(client).getWorkspace()).currentSeason, null);
});

test("an applicant case read asks for no staff table at all", async () => {
  const client = fakeClient({ access: "applicant" });
  const found = await createStore(client).getCase("case-1");
  const tables = client.reads.map((read) => read.table);
  assert.deepEqual(tables.toSorted(), [
    "case_contacts",
    "case_document_cards",
    "cases",
    "client_events",
    "document_requests",
    "documents",
    "memberships",
  ]);
  for (const staffTable of STAFF_ONLY_TABLES)
    assert.ok(!tables.includes(staffTable), staffTable);
  assert.deepEqual(Object.keys(found).toSorted(), [
    "answers",
    "clientNumber",
    "closingReason",
    "contact",
    "createdAt",
    "documentCards",
    "documents",
    "documentsOrigin",
    "federalMethod",
    "federalResult",
    "history",
    "holdOrigin",
    "id",
    "intakeVerified",
    "intakeVersion",
    "intakeVisited",
    "lastRemindedAt",
    "lastRemindedByPersonId",
    "ownerUserId",
    "preparationVersion",
    "preparerId",
    "reference",
    "requests",
    "reviewerId",
    "revision",
    "season",
    "signingAppointmentAt",
    "signingPlan",
    "stage",
    "stateMethod",
    "stateResult",
    "updatedAt",
    "workspaceId",
  ]);
  assert.equal(found.history[0].message, "Application received.");
  // Every related read names its columns. `select("*")` would hand the browser
  // whatever the table holds: the office person who asked for a document, and
  // — on a staff-recorded one — the presenter's own Auth user id.
  const related = client.reads.filter((read) =>
    ["document_requests", "documents", "client_events"].includes(read.table),
  );
  assert.equal(related.length, 3);
  for (const read of related) {
    assert.notEqual(read.columns, "*", `${read.table} selects everything`);
    for (const column of [
      "submitted_by_user_id",
      "submitted_by_person_id",
      "requested_by_person_id",
    ])
      assert.ok(!read.columns.includes(column), `${read.table} selects ${column}`);
  }
  // And what came back carries none of them either.
  const values = JSON.stringify([found.requests, found.documents, found.history]);
  for (const name of ["person-alex", "user-1", "submittedBy", "requestedBy"])
    assert.ok(!values.includes(name), `the client payload carries ${name}`);
  // What the client's own screens read is still there.
  assert.equal(found.requests[0].title, "Mileage record");
  assert.equal(found.requests[0].status, "open");
  assert.equal(found.documents[0].filename, "demo-mileage-record-2025.pdf");
  // The applicant's own contact row, by named columns, and never materials.
  assert.equal(found.intakeVersion, 2);
  assert.deepEqual(found.contact, {
    phone: "2155550100",
    spousePhone: null,
    bestContactTime: ["weekday_morning", "weekend"],
    bestContactNote: "After 5pm",
  });
  const [contactRead] = client.reads.filter((read) => read.table === "case_contacts");
  assert.notEqual(contactRead.columns, "*");
  assert.deepEqual(contactRead.filters, [["case_id", "case-1"]]);
  assert.ok(!("materials" in found));
});

test("a case with no contacts row reads as no contact", async () => {
  for (const access of ["applicant", "presenter"]) {
    const client = fakeClient({ access, rows: { case_contacts: [] } });
    const found = await createStore(client).getCase("case-1");
    assert.equal(found.contact, null, access);
  }
  const client = fakeClient({ access: "presenter", rows: { case_materials: [] } });
  assert.deepEqual((await createStore(client).getCase("case-1")).materials, []);
});

test("a presenter case read adds exactly the staff sections", async () => {
  const client = fakeClient({ access: "presenter" });
  const found = await createStore(client).getCase("case-1");
  assert.deepEqual(
    client.reads.map((read) => read.table).toSorted(),
    [
      "admin_followups",
      "case_contacts",
      "case_document_cards",
      "case_events",
      "case_materials",
      "cases",
      "client_events",
      "contact_log",
      "contact_log_versions",
      "document_requests",
      "documents",
      "filing_attempts",
      "filing_notes",
      "filing_returns",
      "memberships",
      "preparation_participants",
      "preparer_questionnaires",
      "preparer_shaded_fields",
      "reviewer_questionnaires",
      "reviews",
    ],
  );
  assert.equal(found.intakeVersion, 2);
  assert.deepEqual(found.contact, {
    phone: "2155550100",
    spousePhone: null,
    bestContactTime: ["weekday_morning", "weekend"],
    bestContactNote: "After 5pm",
  });
  assert.deepEqual(found.materials, [
    { item: "photo_id", receivedAt: "2026-09-07T00:00:00Z", recordedByPersonId: "person-sam" },
    { item: "w2", receivedAt: "2026-09-07T00:00:00Z", recordedByPersonId: "person-sam" },
  ]);
  // Both new reads name their columns, one case at a time.
  for (const table of ["case_contacts", "case_materials"]) {
    const [read] = client.reads.filter((entry) => entry.table === table);
    assert.notEqual(read.columns, "*", table);
    assert.deepEqual(read.filters, [["case_id", "case-1"]], table);
  }
  assert.deepEqual(found.participants, ["person-alex"]);
  assert.deepEqual(found.reviews, [
    {
      id: "review-1",
      preparationVersion: 1,
      reviewerId: "person-morgan",
      status: "active",
      findings: null,
      resolution: null,
      clientContactStatus: null,
      clientContactOutcome: null,
      clientContactNote: null,
      createdAt: "2026-09-05T00:00:00Z",
      decidedAt: null,
      clientContactedAt: null,
    },
  ]);
  assert.deepEqual(found.followups, [
    {
      id: "followup-1",
      requestId: "request-1",
      assigneeId: "person-sam",
      purpose: "request_documents",
      status: "open",
      reason: "No response to the document request.",
      resolutionOutcome: null,
      resolutionNote: null,
      createdByPersonId: "person-alex",
      createdAt: "2026-09-03T00:00:00Z",
      resolvedAt: null,
    },
  ]);
  assert.equal(found.internalHistory[0].action, "VERIFY_INTAKE");
});

test("a list row says whether the office's go-over is open (D13)", async () => {
  const task = (purpose) => ({ ...RELATED_ROWS.admin_followups[0], purpose });
  const goOverOf = async (admin_followups) => {
    const client = fakeClient({ access: "presenter", rows: { admin_followups } });
    const [row] = await createStore(client).listCases();
    const read = client.reads.find((entry) => entry.table === "admin_followups");
    assert.match(String(read.columns), /purpose/);
    return row.goOverOpen;
  };
  assert.equal(await goOverOf([task("go_over_return")]), true);
  assert.equal(await goOverOf([task("request_documents")]), false);
  assert.equal(await goOverOf([]), false);
});

test("a list row carries the first open withdrawal notice's own text", async () => {
  const task = (purpose, reason) => ({ ...RELATED_ROWS.admin_followups[0], purpose, reason });
  const reasonOf = async (admin_followups) => {
    const client = fakeClient({ access: "presenter", rows: { admin_followups } });
    const [row] = await createStore(client).listCases();
    const read = client.reads.find((entry) => entry.table === "admin_followups");
    assert.match(String(read.columns), /reason/);
    return row.withdrawalNoticeReason;
  };
  assert.equal(await reasonOf([task("withdrawal_notice", "Stop work text.")]), "Stop work text.");
  assert.equal(await reasonOf([task("request_documents", "Other."), task("withdrawal_notice", "Notice.")]), "Notice.");
  assert.equal(await reasonOf([task("request_documents", "Other.")]), null);
});

test("a follow-up row with no purpose reads as a document request", () => {
  assert.equal(mapFollowup({ id: "f" }).purpose, "request_documents");
  assert.equal(mapFollowup({ id: "f", purpose: "go_over_return" }).purpose, "go_over_return");
});

test("the staff case carries its contacts with their versions", async () => {
  const client = fakeClient({ access: "presenter" });
  const found = await createStore(client).getCase("case-1");
  const version = (fields) => ({
    direction: "incoming",
    contactedAt: "2026-09-04T12:00:00Z",
    withWhom: "client",
    otherName: null,
    method: "phone",
    purpose: "ask_question",
    outcome: "reached",
    note: null,
    ...fields,
  });
  assert.deepEqual(found.contacts, [
    {
      id: "contact-1",
      caseId: "case-1",
      followupId: "followup-1",
      revision: 1,
      loggedAt: "2026-09-04T00:05:00Z",
      editedAt: null,
      loggedByPersonId: "person-sam",
      ...version({
        direction: "outgoing",
        contactedAt: "2026-09-04T00:00:00Z",
        purpose: "request_documents",
        outcome: "no_answer",
      }),
      versions: [
        {
          version: 1,
          createdAt: "2026-09-04T00:05:00Z",
          editedByPersonId: "person-sam",
          ...version({
            direction: "outgoing",
            contactedAt: "2026-09-04T00:00:00Z",
            purpose: "request_documents",
            outcome: "no_answer",
          }),
        },
      ],
    },
    {
      id: "contact-2",
      caseId: "case-1",
      followupId: null,
      revision: 2,
      loggedAt: "2026-09-04T12:05:00Z",
      editedAt: "2026-09-04T13:00:00Z",
      loggedByPersonId: "person-sam",
      ...version({
        withWhom: "other",
        otherName: "Pat Lee",
        note: "Asked about the W-2.",
      }),
      versions: [
        {
          version: 1,
          createdAt: "2026-09-04T12:05:00Z",
          editedByPersonId: "person-sam",
          ...version({}),
        },
        {
          version: 2,
          createdAt: "2026-09-04T13:00:00Z",
          editedByPersonId: "person-alex",
          ...version({
            withWhom: "other",
            otherName: "Pat Lee",
            note: "Asked about the W-2.",
          }),
        },
      ],
    },
  ]);
  const [log] = client.reads.filter((read) => read.table === "contact_log");
  assert.deepEqual(log.filters, [["case_id", "case-1"]]);
  assert.deepEqual(log.orders, ["contacted_at", "logged_at", "id"]);
  const [versions] = client.reads.filter(
    (read) => read.table === "contact_log_versions",
  );
  assert.deepEqual(versions.filters, [["case_id", "case-1"]]);
  assert.deepEqual(versions.orders, ["contact_id", "version"]);
});

test("a case with no contacts has an empty list", async () => {
  const client = fakeClient({
    access: "presenter",
    rows: { contact_log: [], contact_log_versions: [] },
  });
  assert.deepEqual((await createStore(client).getCase("case-1")).contacts, []);
});

test("the client path never reads the contact log", async () => {
  const client = fakeClient({ access: "applicant" });
  const found = await createStore(client).getCase("case-1");
  for (const table of ["contact_log", "contact_log_versions", "contact_attempts"])
    assert.ok(!client.reads.some((read) => read.table === table), table);
  assert.ok(!("contacts" in found));
});

test("follow-ups no longer read contact_attempts", async () => {
  const client = fakeClient({ access: "presenter" });
  const found = await createStore(client).getCase("case-1");
  assert.ok(!client.reads.some((read) => read.table === "contact_attempts"));
  assert.ok(found.followups.every((followup) => !("attempts" in followup)));
});

test("log and edit call their RPCs, keeping the action id for a retry", async () => {
  const client = fakeClient({ access: "presenter" });
  const store = createStore(client);
  const entry = {
    contactedAt: "2026-09-04T12:00:00.000Z",
    direction: "outgoing",
    method: "phone",
    note: null,
    otherName: null,
    outcome: "reached",
    purpose: "ask_question",
    withWhom: "client",
  };
  await store.logContact({
    actionId: "action-1",
    caseId: "case-1",
    personId: "person-sam",
    followupId: "followup-1",
    entry,
  });
  const editRequest = {
    contactId: "contact-1",
    expectedRevision: 3,
    personId: "person-sam",
    entry,
  };
  await store.editContact(editRequest);
  assert.match(editRequest.actionId, /^[0-9a-f-]{36}$/);
  await store.logContact({ caseId: "case-1", personId: null, entry });
  assert.deepEqual(client.rpcCalls.slice(0, 2), [
    {
      name: "vitally_log_contact",
      args: {
        p_action_id: "action-1",
        p_case_id: "case-1",
        p_person_id: "person-sam",
        p_followup_id: "followup-1",
        p_entry: entry,
      },
    },
    {
      name: "vitally_edit_contact",
      args: {
        p_action_id: editRequest.actionId,
        p_contact_id: "contact-1",
        p_expected_revision: 3,
        p_person_id: "person-sam",
        p_entry: entry,
      },
    },
  ]);
  assert.equal(client.rpcCalls[2].args.p_followup_id, null);
  assert.equal(client.rpcCalls[2].args.p_person_id, null);
});

test("the staff channel watches the contact log, not the old attempts", () => {
  for (const table of ["contact_log", "contact_log_versions"]) {
    assert.ok(SUBSCRIBED_TABLES.presenter.includes(table), table);
    assert.ok(!SUBSCRIBED_TABLES.applicant.includes(table), table);
  }
  assert.ok(!SUBSCRIBED_TABLES.presenter.includes("contact_attempts"));
});

test("an invisible or absent case is one NOT_FOUND", async () => {
  const client = fakeClient({ access: "applicant", rows: { cases: [] } });
  await assert.rejects(() => createStore(client).getCase("case-1"), {
    code: "NOT_FOUND",
  });
});

test("the roster and the assistance list are presenter reads", async () => {
  const presenter = createStore(fakeClient({ access: "presenter" }));
  assert.deepEqual(await presenter.listPeople(), [
    { id: "person-alex", name: "Alex", capabilities: ["prepare"], linked: false },
  ]);
  assert.deepEqual(await presenter.listAssistance(), [
    mapAssistance(RELATED_ROWS.assistance_items[0]),
  ]);
  const applicant = createStore(fakeClient({ access: "applicant" }));
  // Access is checked first, so an applicant gets a refusal rather than an
  // empty roster that looks like a workspace with no volunteers.
  await assert.rejects(() => applicant.listPeople(), { code: "FORBIDDEN" });
  await assert.rejects(() => applicant.listAssistance(), { code: "FORBIDDEN" });
});

test("act sends the frozen envelope and maps the SQLSTATE", async () => {
  const client = fakeClient({
    rpc: async () => ({ data: null, error: { code: "VT003" } }),
  });
  const action = {
    actionId: "action-1",
    caseId: "case-1",
    expectedRevision: 7,
    personId: null,
    type: "SAVE_ANSWERS",
    payload: { answers: { year: "2025" } },
  };
  await assert.rejects(() => createStore(client).act(action), {
    code: "CONFLICT",
  });
  assert.deepEqual(client.rpcCalls, [
    {
      name: "vitally_apply_action",
      args: {
        p_action_id: "action-1",
        p_case_id: "case-1",
        p_expected_revision: 7,
        p_person_id: null,
        p_type: "SAVE_ANSWERS",
        p_payload: { answers: { year: "2025" } },
      },
    },
  ]);
});

test("a thrown transport failure becomes OFFLINE through the shared mapper", async () => {
  const client = fakeClient({
    rpc: async () => {
      throw new TypeError("fetch failed");
    },
  });
  await assert.rejects(
    () =>
      createStore(client).act({
        actionId: "action-1",
        caseId: "case-1",
        expectedRevision: 7,
        type: "SUBMIT",
        payload: { confirmed: true },
      }),
    { code: "OFFLINE" },
  );
});

test("a read failure is mapped too, and 42501 is FORBIDDEN", async () => {
  await assert.rejects(
    () => createStore(fakeClient({ readError: { code: "42501" } })).listCases(),
    { code: "FORBIDDEN" },
  );
  await assert.rejects(
    () =>
      createStore(fakeClient({ readError: { code: "PGRST301" } })).listCases(),
    { code: "SERVER_ERROR" },
  );
});

test("a retry of a timed-out action re-sends the identical envelope", async () => {
  let attempt = 0;
  const client = fakeClient({
    rpc: async (name, args) => {
      attempt += 1;
      if (attempt === 1) throw new TypeError("fetch failed");
      return { data: { actionId: args.p_action_id, revision: 8 }, error: null };
    },
  });
  const store = createStore(client);
  // The caller did not supply an action id, so the store mints one — once.
  const action = {
    caseId: "case-1",
    expectedRevision: 7,
    type: "SUBMIT",
    payload: { confirmed: true },
  };
  await assert.rejects(() => store.act(action), { code: "OFFLINE" });
  await store.act(action);
  assert.equal(client.rpcCalls.length, 2);
  assert.deepEqual(client.rpcCalls[0].args, client.rpcCalls[1].args);
  assert.equal(typeof client.rpcCalls[0].args.p_action_id, "string");
  // It is kept on the action itself, so the caller can persist it too.
  assert.equal(action.actionId, client.rpcCalls[0].args.p_action_id);
});

test("every other RPC uses its documented signature", async () => {
  const client = fakeClient();
  const store = createStore(client);
  await store.createCase({
    actionId: "action-1",
    mode: "client",
    personId: null,
    answers: { year: "2025" },
  });
  await store.actAssistance({
    actionId: "action-2",
    itemId: "item-1",
    expectedRevision: 1,
    personId: "person-sam",
    type: "CLAIM",
    note: null,
  });
  assert.deepEqual(client.rpcCalls, [
    {
      name: "vitally_create_case",
      args: {
        p_action_id: "action-1",
        p_mode: "client",
        p_person_id: null,
        p_answers: { year: "2025" },
      },
    },
    {
      name: "vitally_assistance_action",
      args: {
        p_action_id: "action-2",
        p_item_id: "item-1",
        p_expected_revision: 1,
        p_person_id: "person-sam",
        p_type: "CLAIM",
        p_note: null,
      },
    },
  ]);
});

test("createCase returns the server receipt unchanged", async () => {
  const receipt = {
    actionId: "action-1",
    caseId: "case-1",
    reference: "VT-ABCD-2345",
    revision: 1,
  };
  const client = fakeClient({ rpc: async () => ({ data: receipt, error: null }) });
  assert.deepEqual(
    await createStore(client).createCase({
      actionId: "action-1",
      mode: "client",
      personId: null,
      answers: {},
    }),
    receipt,
  );
});

test("a subscription watches only the tables its principal may read", async () => {
  for (const [access, expected] of Object.entries(SUBSCRIBED_TABLES)) {
    const client = fakeClient({ access });
    const stop = createStore(client).subscribe({
      onChange: () => {},
      onConnection: () => {},
    });
    await settle();
    assert.equal(client.channels.length, 1, access);
    const [channel] = client.channels;
    assert.deepEqual(
      [...new Set(channel.bindings.map((binding) => binding.filter.table))],
      [...expected],
      access,
    );
    // INSERT and UPDATE only: a removed row is never announced.
    assert.deepEqual(
      [...new Set(channel.bindings.map((binding) => binding.filter.event))],
      ["INSERT", "UPDATE"],
      access,
    );
    assert.ok(
      channel.bindings.every(
        (binding) =>
          binding.type === "postgres_changes" &&
          binding.filter.schema === "public",
      ),
    );
    stop();
  }
  assert.deepEqual(SUBSCRIBED_TABLES.applicant, [
    "cases",
    "document_requests",
    "documents",
    "client_events",
    "workspaces",
    "case_contacts",
    "case_document_cards",
  ]);
  assert.deepEqual(SUBSCRIBED_TABLES.presenter, [
    "cases",
    "document_requests",
    "documents",
    "client_events",
    "workspaces",
    "case_contacts",
    "case_document_cards",
    "people",
    "preparation_participants",
    "admin_followups",
    "contact_log",
    "contact_log_versions",
    "case_events",
    "assistance_items",
    "reviews",
    "case_materials",
    "preparer_questionnaires",
    "reviewer_questionnaires",
    "preparer_shaded_fields",
  ]);
  // The applicant's channel never names a staff-only table.
  for (const staffTable of STAFF_ONLY_TABLES)
    assert.ok(!SUBSCRIBED_TABLES.applicant.includes(staffTable), staffTable);
});

test("a change announces identifiers only", async () => {
  const seen = [];
  const client = fakeClient({ access: "applicant" });
  const stop = createStore(client).subscribe({ onChange: (change) => seen.push(change) });
  await settle();
  const [channel] = client.channels;
  const fire = (table, eventType, row) =>
    channel.bindings
      .filter(
        (binding) =>
          binding.filter.table === table && binding.filter.event === eventType,
      )
      .forEach((binding) => binding.handler({ eventType, new: row, old: {} }));
  fire("cases", "UPDATE", {
    id: "case-1",
    reference: "VT-ABCD-2345",
    answers: { firstName: "Mei" },
  });
  fire("client_events", "INSERT", {
    id: "client-event-1",
    case_id: "case-1",
    message: "Application received.",
  });
  assert.deepEqual(seen, [
    { table: "cases", eventType: "UPDATE", id: "case-1", caseId: "case-1" },
    {
      table: "client_events",
      eventType: "INSERT",
      id: "client-event-1",
      caseId: "case-1",
    },
  ]);
  stop();
});

test("channel status becomes a connection state and cleanup happens once", async () => {
  const states = [];
  const client = fakeClient({ access: "applicant" });
  const stop = createStore(client).subscribe({
    onChange: () => {},
    onConnection: (state) => states.push(state),
  });
  await settle();
  const [channel] = client.channels;
  for (const status of [
    "SUBSCRIBED",
    "TIMED_OUT",
    "CHANNEL_ERROR",
    "CLOSED",
    "SOMETHING_NEW",
  ])
    channel.onStatus(status);
  assert.deepEqual(states, ["online", "reconnecting", "reconnecting", "offline"]);
  stop();
  stop();
  stop();
  assert.deepEqual(client.removed, [channel.channel]);
});

test("unsubscribing before the channel opens never opens one", async () => {
  const client = fakeClient({ access: "applicant" });
  const stop = createStore(client).subscribe({ onChange: () => {} });
  stop();
  await settle();
  assert.deepEqual(client.channels, []);
  assert.deepEqual(client.removed, []);
});

test("mapCase carries the season and the client number, null until submitted", () => {
  const mapped = mapCase(CASE_ROW);
  assert.equal(mapped.season, 2025);
  assert.equal(mapped.clientNumber, 93);
  const draft = mapCase({ ...CASE_ROW, season: null, client_number: null });
  assert.equal(draft.season, null);
  assert.equal(draft.clientNumber, null);
});

test("mapCase carries the intake version as a number", () => {
  // Always 2 (migration 023), so there is no fallback.
  assert.equal(mapCase(CASE_ROW).intakeVersion, 2);
  assert.equal(mapCase({ ...CASE_ROW, intake_version: "2" }).intakeVersion, 2);
});

test("mapCase carries the visited sub-steps, [] when the column is absent", () => {
  assert.deepEqual(mapCase(CASE_ROW).intakeVisited, ["about.you", "before.ready"]);
  const { intake_visited: _visited, ...older } = CASE_ROW;
  assert.deepEqual(mapCase(older).intakeVisited, []);
  assert.deepEqual(mapCase({ ...CASE_ROW, intake_visited: null }).intakeVisited, []);
  // A copy: the browser cannot change the row it came from.
  assert.notEqual(mapCase(CASE_ROW).intakeVisited, CASE_ROW.intake_visited);
});

test("both principals read the card rows by named columns and map them", async () => {
  assert.ok(SUBSCRIBED_TABLES.applicant.includes("case_document_cards"));
  assert.ok(SUBSCRIBED_TABLES.presenter.includes("case_document_cards"));
  for (const access of ["applicant", "presenter"]) {
    const client = fakeClient({ access });
    const found = await createStore(client).getCase("case-1");
    const [read] = client.reads.filter((entry) => entry.table === "case_document_cards");
    assert.equal(read.columns, "slot_id,status,group_override,changed_at", access);
    assert.deepEqual(read.filters, [["case_id", "case-1"]], access);
    assert.deepEqual(read.orders, ["slot_id"], access);
    assert.deepEqual(found.documentCards, [
      { slotId: "w2.household", status: "later", groupOverride: null, changedAt: "2026-09-08T00:00:00Z" },
      { slotId: "ssn.tp", status: null, groupOverride: "needed", changedAt: "2026-09-08T01:00:00Z" },
    ], access);
    assert.deepEqual(found.intakeVisited, ["about.you", "before.ready"], access);
  }
  const empty = fakeClient({ access: "applicant", rows: { case_document_cards: [] } });
  assert.deepEqual((await createStore(empty).getCase("case-1")).documentCards, []);
});

test("mapCase carries the signing plan and appointment, null until approval", () => {
  const plain = mapCase(CASE_ROW);
  assert.equal(plain.signingPlan, null);
  assert.equal(plain.signingAppointmentAt, null);
  const planned = mapCase({ ...CASE_ROW, signing_plan: "appointment", signing_appointment_at: "2026-11-02T14:30:00" });
  assert.equal(planned.signingPlan, "appointment");
  assert.equal(planned.signingAppointmentAt, "2026-11-02T14:30:00");
});

test("mapCase carries the filing methods and results, null before a filing", () => {
  const filed = mapCase({
    ...CASE_ROW,
    federal_method: "efile",
    state_method: "paper",
    federal_result: "accepted",
    state_result: "mailed",
  });
  assert.deepEqual(
    [filed.federalMethod, filed.stateMethod, filed.federalResult, filed.stateResult],
    ["efile", "paper", "accepted", "mailed"],
  );
});

test("mapCase carries the documents origin, hold origin and closing reason, null when unset", () => {
  const plain = mapCase(CASE_ROW);
  assert.deepEqual([plain.documentsOrigin, plain.holdOrigin, plain.closingReason], [null, null, null]);
  const held = mapCase({
    ...CASE_ROW,
    documents_origin: "screening",
    hold_origin: "awaiting_documents",
    closing_reason: "dismissed",
  });
  assert.deepEqual(
    [held.documentsOrigin, held.holdOrigin, held.closingReason],
    ["screening", "awaiting_documents", "dismissed"],
  );
});

test("a staff case read carries the filing attempts, newest first; an applicant read none of them", async () => {
  const rows = {
    // In the order the database returns them: attempts newest first.
    filing_attempts: [
      { id: "a2", case_id: "case-1", attempt: 2, filed_at: "2026-10-05T10:00:00Z", filed_by: "person-sam" },
      { id: "a1", case_id: "case-1", attempt: 1, filed_at: "2026-10-01T10:00:00Z", filed_by: "person-sam" },
    ],
    filing_returns: [
      { id: "r1", case_id: "case-1", attempt: 1, return_kind: "federal", method: "efile", result: "accepted", answered_on: "2026-10-02", reject_code: null, recorded_by: "person-sam" },
      { id: "r2", case_id: "case-1", attempt: 1, return_kind: "state", method: "efile", result: "rejected", answered_on: "2026-10-02", reject_code: "PA-1", recorded_by: "person-sam" },
      { id: "r3", case_id: "case-1", attempt: 2, return_kind: "state", method: "paper", result: null, answered_on: null, reject_code: null, recorded_by: null },
    ],
    filing_notes: [
      { id: "n1", case_id: "case-1", attempt: 1, note: "First fix", recorded_by: "person-sam", recorded_at: "2026-10-03T10:00:00Z" },
      { id: "n2", case_id: "case-1", attempt: 1, note: "Second fix", recorded_by: "person-alex", recorded_at: "2026-10-04T10:00:00Z" },
    ],
  };
  const client = fakeClient({ access: "presenter", rows });
  const staff = await createStore(client).getCase("case-1");
  assert.deepEqual(staff.filingAttempts, [
    {
      attempt: 2,
      filedAt: "2026-10-05T10:00:00Z",
      returns: [{ returnKind: "state", method: "paper", result: null, answeredOn: null, rejectCode: null }],
      notes: [],
    },
    {
      attempt: 1,
      filedAt: "2026-10-01T10:00:00Z",
      returns: [
        { returnKind: "federal", method: "efile", result: "accepted", answeredOn: "2026-10-02", rejectCode: null },
        { returnKind: "state", method: "efile", result: "rejected", answeredOn: "2026-10-02", rejectCode: "PA-1" },
      ],
      notes: [
        { note: "First fix", recordedBy: "person-sam", recordedAt: "2026-10-03T10:00:00Z" },
        { note: "Second fix", recordedBy: "person-alex", recordedAt: "2026-10-04T10:00:00Z" },
      ],
    },
  ]);
  // Each read is scoped to the case, and the tables are ordered without a created_at.
  for (const table of ["filing_attempts", "filing_returns", "filing_notes"]) {
    const [read] = client.reads.filter((entry) => entry.table === table);
    assert.deepEqual(read.filters, [["case_id", "case-1"]], table);
    assert.ok(!read.orders.includes("created_at"), `${table} has no created_at`);
  }
  const ordered = (table) => client.reads.find((entry) => entry.table === table).orders;
  assert.deepEqual(ordered("filing_attempts"), ["attempt"]);
  assert.deepEqual(ordered("filing_returns"), ["attempt", "return_kind"]);
  assert.deepEqual(ordered("filing_notes"), ["recorded_at", "id"]);
  assert.deepEqual((await createStore(fakeClient({ access: "presenter" })).getCase("case-1")).filingAttempts, []);

  const applicantClient = fakeClient({ access: "applicant", rows });
  const applicant = await createStore(applicantClient).getCase("case-1");
  assert.ok(!("filingAttempts" in applicant), "an applicant's Case carries no filing section");
  assert.ok(!applicantClient.reads.some((read) => read.table.startsWith("filing_")));
});

test("a staff case read carries both questionnaire tables, an applicant read neither", async () => {
  const rows = {
    preparer_questionnaires: [
      { id: "pq-1", case_id: "case-1", preparation_version: 1, confirmed_by: "client", confirmed_method: "phone", ready_for_review_on: "2026-10-16" },
    ],
    reviewer_questionnaires: [
      { id: "rq-1", case_id: "case-1", review_id: "review-1", completed_on: "2026-10-17", went_over: true, exit_form: { federal: null, state: null, local: [] } },
    ],
  };
  const staff = await createStore(fakeClient({ access: "presenter", rows })).getCase("case-1");
  assert.deepEqual(staff.preparerQuestionnaires, [
    { id: "pq-1", caseId: "case-1", preparationVersion: 1, confirmedBy: "client", confirmedMethod: "phone", readyForReviewOn: "2026-10-16" },
  ]);
  assert.equal(staff.reviewerQuestionnaires[0].reviewId, "review-1");
  assert.deepEqual(staff.reviewerQuestionnaires[0].exitForm, { federal: null, state: null, local: [] });
  const client = fakeClient({ access: "applicant", rows });
  const applicant = await createStore(client).getCase("case-1");
  assert.ok(!("preparerQuestionnaires" in applicant));
  assert.ok(!client.reads.some((read) => read.table.endsWith("_questionnaires")));
});

test("a staff case read carries the shaded section, an applicant read never names it", async () => {
  const rows = {
    preparer_shaded_fields: [
      { id: "ps-1", case_id: "case-1", fields: { incomeW2s: true, incomeW2sCount: 2 }, version: 3, updated_by_person_id: "person-alex" },
    ],
  };
  const staffClient = fakeClient({ access: "presenter", rows });
  const staff = await createStore(staffClient).getCase("case-1");
  assert.deepEqual(staff.preparerShadedFields, [
    { id: "ps-1", caseId: "case-1", fields: { incomeW2s: true, incomeW2sCount: 2 }, version: 3, updatedByPersonId: "person-alex" },
  ]);
  const [read] = staffClient.reads.filter((entry) => entry.table === "preparer_shaded_fields");
  assert.deepEqual(read.filters, [["case_id", "case-1"]]);
  assert.deepEqual((await createStore(fakeClient({ access: "presenter" })).getCase("case-1")).preparerShadedFields, []);
  const client = fakeClient({ access: "applicant", rows });
  const applicant = await createStore(client).getCase("case-1");
  assert.ok(!("preparerShadedFields" in applicant));
  assert.ok(!client.reads.some((entry) => entry.table === "preparer_shaded_fields"));
});

test("closeUnsigned calls vitally_close_unsigned", async () => {
  const client = fakeClient({ access: "presenter" });
  const cases = [{ caseId: "case-1", revision: 4 }];
  await createStore(client).closeUnsigned({
    actionId: "action-9",
    personId: "person-sam",
    cases,
    confirmed: true,
  });
  assert.deepEqual(client.rpcCalls.at(-1), {
    name: "vitally_close_unsigned",
    args: { p_action_id: "action-9", p_person_id: "person-sam", p_cases: cases, p_confirmed: true },
  });
});
