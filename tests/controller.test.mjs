import test from "node:test";
import assert from "node:assert/strict";
import { createController } from "../src/controller.mjs";
import { SHADED_EDITOR, SHADED_UPLOAD } from "../src/contracts.mjs";
import { POOL_FILTER_KEYS } from "../src/pool-views.mjs";
import { saveStatus } from "../src/client-views.mjs";
import { closeUnsignedDialogBody, closeUnsignedListKey } from "../src/office-views.mjs";
import { staffScreen } from "../src/views.mjs";
import { CONTACT_FIELDS, findQuestion, isMemberId } from "../src/intake-catalogue.mjs";
import { newMemberId, renderQuestion, reviewAlerts, valuesFromControls, withholdInvalid } from "../src/intake-form.mjs";
import { fictionalAnswers, fillBlankAnswers, makeSampleAnswers } from "../src/sample-data.mjs";
import { cardsFor } from "../src/document-cards.mjs";
import { CONSENT_14446 } from "./support/consent-14446.mjs";

// Doubles, not mocks: every test asserts the envelopes that reach the store and
// the state the controller ends in, never "this function was called".

function fakeSession(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      data.set(key, String(value));
    },
    removeItem: (key) => {
      data.delete(key);
    },
    keys: () => [...data.keys()],
    raw: (key) => (data.has(key) ? data.get(key) : null),
  };
}

function fakeEvents() {
  const handlers = new Map();
  return {
    addEventListener(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      handlers.get(type)?.delete(handler);
    },
    count: (type) => handlers.get(type)?.size ?? 0,
    async emit(type) {
      for (const handler of [...(handlers.get(type) ?? [])]) await handler();
    },
  };
}

// A store double that records every read and every action envelope.
function fakeStore({
  principal = { userId: "user-1", workspaceId: "w1", access: "applicant" },
  cases = [],
  people = [],
  assistance = [],
  workspace = {
    id: "w1",
    defaultFollowupPersonId: "person-sam",
    defaultIntakeVersion: 2,
  },
} = {}) {
  const records = new Map(cases.map((entry) => [entry.id, entry]));
  const items = new Map(assistance.map((entry) => [entry.id, entry]));
  const store = {
    workspace,
    calls: [],
    writes: [],
    subscriptions: 0,
    released: 0,
    handlers: null,
    failNext: null,
    records,
    async getPrincipal() {
      store.calls.push("getPrincipal");
      if (principal instanceof Error) throw principal;
      return principal;
    },
    async listPeople() {
      store.calls.push("listPeople");
      return people;
    },
    async listCases() {
      store.calls.push("listCases");
      return [...records.values()];
    },
    async getCase(id) {
      store.calls.push(`getCase:${id}`);
      const found = records.get(id);
      if (!found) throw Object.assign(new Error("gone"), { code: "NOT_FOUND" });
      return found;
    },
    async createCase(request) {
      store.calls.push("createCase");
      store.writes.push(request);
      const failure = store.failNext;
      if (failure) {
        store.failNext = null;
        throw failure;
      }
      const seen = [...records.values()].find(
        (entry) => entry.createdBy === request.actionId,
      );
      if (seen)
        return {
          actionId: request.actionId,
          caseId: seen.id,
          reference: seen.reference,
          revision: seen.revision,
        };
      const id = `case-${records.size + 1}`;
      records.set(id, {
        id,
        reference: `VT-NEW${records.size + 1}-AAAA`,
        stage: "draft",
        revision: 1,
        answers: {},
        createdBy: request.actionId,
      });
      return {
        actionId: request.actionId,
        caseId: id,
        reference: records.get(id).reference,
        revision: 1,
      };
    },
    async act(action) {
      store.calls.push(`act:${action.type}`);
      store.writes.push(action);
      const failure = store.failNext;
      if (failure) {
        store.failNext = null;
        throw failure;
      }
      const record = records.get(action.caseId);
      const next = {
        ...record,
        revision: record.revision + 1,
        answers:
          action.type === "SAVE_ANSWERS"
            ? { ...action.payload.answers }
            : record.answers,
        stage: action.type === "START_SCREENING" ? "screening" : record.stage,
      };
      records.set(action.caseId, next);
      return {
        actionId: action.actionId,
        caseId: action.caseId,
        reference: next.reference,
        revision: next.revision,
      };
    },
    items,
    async listAssistance() {
      store.calls.push("listAssistance");
      return [...items.values()];
    },
    async actAssistance(request) {
      store.calls.push(`actAssistance:${request.type}`);
      store.writes.push(request);
      const failure = store.failNext;
      if (failure) {
        store.failNext = null;
        throw failure;
      }
      const current = items.get(request.itemId);
      items.set(request.itemId, {
        ...current,
        revision: current.revision + 1,
        status: request.type === "CLAIM" ? "assigned" : "resolved",
        assigneeId:
          request.type === "CLAIM" ? request.personId : current.assigneeId,
        resolutionNote: request.note ?? current.resolutionNote,
      });
    },
    async logContact(request) {
      store.calls.push("logContact");
      store.writes.push(request);
      const failure = store.failNext;
      if (failure) {
        store.failNext = null;
        throw failure;
      }
      const record = records.get(request.caseId);
      const contacts = record.contacts ?? [];
      records.set(request.caseId, {
        ...record,
        contacts: [
          ...contacts,
          { id: `contact-${contacts.length + 1}`, revision: 1, ...request.entry },
        ],
      });
      return { actionId: request.actionId, caseId: request.caseId, revision: 1 };
    },
    async editContact(request) {
      store.calls.push("editContact");
      store.writes.push(request);
      const failure = store.failNext;
      if (failure) {
        store.failNext = null;
        throw failure;
      }
      for (const [id, record] of records) {
        const contacts = record.contacts ?? [];
        if (!contacts.some((entry) => entry.id === request.contactId)) continue;
        records.set(id, {
          ...record,
          contacts: contacts.map((entry) =>
            entry.id === request.contactId
              ? { ...entry, ...request.entry, revision: entry.revision + 1 }
              : entry,
          ),
        });
      }
      return { actionId: request.actionId, contactId: request.contactId, revision: 2 };
    },
    async getWorkspace() {
      store.calls.push("getWorkspace");
      return { ...store.workspace };
    },
    subscribe(handlers) {
      store.subscriptions += 1;
      store.handlers = handlers;
      return () => {
        store.released += 1;
        store.handlers = null;
      };
    },
  };
  return store;
}

const idleAuth = () => ({
  getSession: async () => ({ user: { id: "user-1" } }),
  subscribe: () => () => {},
  signOut: async () => {},
  cooldownRemaining: () => 0,
});

function build(options = {}) {
  // `focus` records the argument of every render, because it decides whether
  // the rebuilt page takes the keyboard back to the top.
  const renders = { count: 0, focus: [] };
  const events = options.windowEvents ?? fakeEvents();
  const sessionStorage = options.sessionStorage ?? fakeSession();
  const controller = createController({
    store: options.store,
    auth: options.auth ?? idleAuth(),
    render: (focus = false) => {
      renders.count += 1;
      renders.focus.push(focus === true);
    },
    sessionStorage,
    windowEvents: events,
    clock: options.clock,
    newActionId: options.newActionId,
    cooldownSeconds: options.cooldownSeconds,
    localStorage: options.localStorage,
    languages: options.languages,
    demoTools: options.demoTools,
  });
  return { controller, events, sessionStorage, renders };
}

test("the controller carries the demo-tools switch it was given", () => {
  assert.equal(build({ demoTools: true }).controller.getState().demoTools, true);
  assert.equal(build().controller.getState().demoTools, false);
});

// ---------------------------------------------------------------------------
// The task brief's test, verbatim.
// ---------------------------------------------------------------------------
test("remote refresh preserves unsaved answers", async () => {
  let current = {
    id: "case-a",
    revision: 1,
    stage: "draft",
    answers: { tp_first_name: "Old" },
  };
  const writes = [];
  const store = {
    getPrincipal: async () => ({ userId: "a", access: "applicant" }),
    listCases: async () => [current],
    getCase: async () => current,
    act: async (action) => {
      writes.push(action);
      current = {
        ...current,
        revision: current.revision + 1,
        answers: action.payload.answers,
      };
      return {
        actionId: action.actionId,
        caseId: current.id,
        revision: current.revision,
      };
    },
    subscribe: () => () => {},
  };
  const controller = createController({
    store,
    auth: { getSession: async () => ({}), subscribe: () => () => {} },
    render: () => {},
    sessionStorage: { getItem: () => null, setItem: () => {} },
  });
  await controller.start();
  await controller.selectCase("case-a");
  controller.editAnswers({ tp_first_name: "Unsaved" });
  current = { ...current, revision: 2, answers: { tp_first_name: "Server edit" } };
  await controller.refresh();
  assert.equal(controller.getState().draftAnswers.tp_first_name, "Unsaved");
  assert.equal(controller.getState().savedCase.revision, 2);
  assert.equal(controller.getState().savedCase.answers.tp_first_name, "Server edit");
  assert.equal(controller.getState().editBaseRevision, 1);
  assert.deepEqual(controller.getState().conflict, {
    code: "REMOTE_CHANGED",
    baseRevision: 1,
    serverRevision: 2,
  });
  await assert.rejects(controller.saveAnswers(), (error) => error.code === "CONFLICT");
  assert.equal(writes.length, 0);
  await assert.rejects(
    controller.reconcileAnswers({
      answers: { tp_first_name: "Chosen" },
      expectedServerRevision: 1,
    }),
    (error) => error.code === "CONFLICT",
  );
  await controller.reconcileAnswers({
    answers: { tp_first_name: "Chosen" },
    expectedServerRevision: 2,
  });
  assert.equal(controller.getState().conflict, null);
  assert.equal(controller.getState().editBaseRevision, 2);
  await controller.saveAnswers();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].type, "SAVE_ANSWERS");
  assert.equal(writes[0].expectedRevision, 2);
  assert.equal(writes[0].payload.answers.tp_first_name, "Chosen");
  controller.stop();
});

// The browser story's two-window conflict, with the re-reads a real window has
// in flight when the person presses "Keep my edits": Realtime publishes more
// than one row per action, so a re-read can answer after the choice — and one
// that left before the other window saved answers with the older revision.
test("re-reads that land after a reconcile never replace the chosen answers", async () => {
  let current = { id: "case-a", revision: 1, stage: "draft", answers: { addr_city: "Base" } };
  const held = [];
  let hold = false;
  const writes = [];
  const store = {
    getPrincipal: async () => ({ userId: "a", access: "applicant" }),
    listCases: async () => [current],
    getCase: async () => {
      const snapshot = current;
      if (!hold) return snapshot;
      return await new Promise((resolve) => held.push(() => resolve(snapshot)));
    },
    act: async (action) => {
      writes.push(action);
      return { actionId: action.actionId, caseId: current.id, revision: current.revision + 1 };
    },
    subscribe: () => () => {},
  };
  const controller = createController({
    store,
    auth: { getSession: async () => ({}), subscribe: () => () => {} },
    render: () => {},
    sessionStorage: { getItem: () => null, setItem: () => {} },
  });
  await controller.start();
  await controller.selectCase("case-a");
  controller.editAnswers({ addr_city: "Keepmine City" });

  // A re-read that leaves before the other window saves, and answers late.
  hold = true;
  const stale = controller.refresh();
  hold = false;
  current = { ...current, revision: 2, answers: { addr_city: "Otherwindow City" } };
  await controller.refresh();
  assert.equal(controller.getState().conflict?.serverRevision, 2);
  // One more that sees the other window's save and is still in flight.
  hold = true;
  const late = controller.refresh();
  hold = false;

  await controller.reconcileAnswers({
    answers: controller.getState().draftAnswers,
    expectedServerRevision: 2,
  });
  for (const release of held.splice(0)) release();
  await Promise.all([stale, late]);

  const state = controller.getState();
  assert.equal(state.draftAnswers.addr_city, "Keepmine City");
  assert.equal(state.conflict, null);
  assert.equal(state.dirty, true);
  assert.equal(state.editBaseRevision, 2);
  await controller.saveAnswers();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].expectedRevision, 2);
  assert.equal(writes[0].payload.answers.addr_city, "Keepmine City");
  controller.stop();
});

// ---------------------------------------------------------------------------

test("start reads the principal before subscribing and makes no staff read as an applicant", async () => {
  const store = fakeStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} }],
  });
  const { controller, events } = build({ store });
  await controller.start();
  assert.equal(store.calls[0], "getPrincipal");
  assert.ok(!store.calls.includes("listPeople"));
  assert.equal(store.subscriptions, 1);
  // The subscription is opened only after identity is known.
  assert.ok(store.calls.indexOf("getPrincipal") < store.calls.indexOf("listCases"));
  assert.equal(controller.getState().principal.userId, "user-1");
  assert.equal(controller.getState().cases.length, 1);
  assert.equal(events.count("focus"), 1);
  assert.equal(events.count("online"), 1);
  controller.stop();
  assert.equal(store.released, 1);
  assert.equal(events.count("focus"), 0);
  assert.equal(events.count("online"), 0);
});

test("an identity failure never reaches the subscription path", async () => {
  const store = fakeStore({
    principal: Object.assign(new Error("no access"), { code: "FORBIDDEN" }),
  });
  const { controller } = build({ store });
  await controller.start();
  assert.equal(store.subscriptions, 0);
  assert.equal(controller.getState().error.code, "FORBIDDEN");
  assert.equal(controller.getState().principal, null);
  controller.stop();
});

test("a staff start loads people and the staff landing", async () => {
  const store = fakeStore({
    principal: { userId: "p1", workspaceId: "w1", access: "staff", personId: "person-1" },
    people: [{ id: "person-1", name: "Alex", capabilities: ["prepare"] }],
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "received", revision: 1, answers: {} }],
  });
  const { controller } = build({ store });
  await controller.start();
  assert.ok(store.calls.includes("listPeople"));
  assert.equal(controller.getState().people.length, 1);
  assert.equal(controller.getState().screen, "staff");
  controller.stop();
});

test("an out-of-order response never replaces a newer known revision", async () => {
  const store = fakeStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 4, answers: { tp_first_name: "New" } }],
  });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-a");
  assert.equal(controller.getState().savedCase.revision, 4);
  // A slow earlier read lands after the newer one.
  store.records.set("case-a", {
    id: "case-a",
    reference: "VT-AAAA-BBBB",
    stage: "draft",
    revision: 2,
    answers: { tp_first_name: "Stale" },
  });
  await controller.refresh();
  assert.equal(controller.getState().savedCase.revision, 4);
  assert.equal(controller.getState().savedCase.answers.tp_first_name, "New");
  assert.equal(controller.getState().conflict, null);
  controller.stop();
});

test("a subscribed change refreshes the affected case, and another case's change does not", async () => {
  const store = fakeStore({
    cases: [
      { id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} },
      { id: "case-b", reference: "VT-CCCC-DDDD", stage: "draft", revision: 1, answers: {} },
    ],
  });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-a");
  const before = store.calls.filter((entry) => entry === "getCase:case-a").length;
  await store.handlers.onChange({ table: "client_events", eventType: "INSERT", id: "e1", caseId: "case-b" });
  assert.equal(
    store.calls.filter((entry) => entry === "getCase:case-a").length,
    before,
  );
  await store.handlers.onChange({ table: "client_events", eventType: "INSERT", id: "e2", caseId: "case-a" });
  assert.equal(
    store.calls.filter((entry) => entry === "getCase:case-a").length,
    before + 1,
  );
  // A case row change also refreshes the list behind "My applications".
  const lists = store.calls.filter((entry) => entry === "listCases").length;
  await store.handlers.onChange({ table: "cases", eventType: "UPDATE", id: "case-b", caseId: "case-b" });
  assert.equal(store.calls.filter((entry) => entry === "listCases").length, lists + 1);
  store.handlers.onConnection("offline");
  assert.equal(controller.getState().connection, "offline");
  controller.stop();
  assert.equal(store.released, 1);
});

test("only a screen change asks the page to take the keyboard back", async () => {
  // The render argument is how the wiring layer knows a new screen was drawn:
  // a new screen puts the keyboard at the top of it, and a rebuild of the same
  // screen — a refresh, somebody else's change, a refused action — must leave
  // it where the person put it.
  const store = fakeStore({
    cases: [
      { id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} },
      { id: "case-b", reference: "VT-CCCC-DDDD", stage: "draft", revision: 1, answers: {} },
    ],
  });
  const { controller, renders, events } = build({ store });
  await controller.start();
  const since = () => renders.focus.slice(mark);
  let mark = renders.focus.length;
  controller.navigate("applications");
  assert.deepEqual(since(), [true], "navigating is a screen change");

  mark = renders.focus.length;
  await controller.selectCase("case-a");
  assert.ok(since().includes(true), "opening a case is a screen change");

  // Everything that redraws the screen the person is already on.
  mark = renders.focus.length;
  await controller.selectCase("case-b", { navigate: false });
  await controller.refresh();
  await events.emit("focus");
  await store.handlers.onChange({
    table: "cases",
    eventType: "UPDATE",
    id: "case-a",
    caseId: "case-a",
  });
  store.handlers.onConnection("offline");
  controller.togglePanel("confirmed");
  controller.openDialog("help");
  controller.closeDialog();
  store.failNext = Object.assign(new Error("no"), { code: "CONFLICT" });
  await assert.rejects(() => controller.runAction("SUBMIT", { confirmed: true }));
  assert.ok(since().length > 0, "these really did re-render");
  assert.deepEqual(
    since().filter(Boolean),
    [],
    "a rebuild of the same screen never moves the keyboard",
  );
  controller.stop();
});

test("focus and online events refresh, and stop removes the listeners", async () => {
  const store = fakeStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} }],
  });
  const { controller, events } = build({ store });
  await controller.start();
  const before = store.calls.filter((entry) => entry === "listCases").length;
  await events.emit("focus");
  await events.emit("online");
  assert.equal(
    store.calls.filter((entry) => entry === "listCases").length,
    before + 2,
  );
  controller.stop();
  await events.emit("focus");
  assert.equal(
    store.calls.filter((entry) => entry === "listCases").length,
    before + 2,
  );
});

test("save state moves unsaved to saving to saved, and an edit whitelists its keys", async () => {
  const store = fakeStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} }],
  });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-a");
  assert.equal(controller.getState().saveState, "idle");
  controller.editAnswers({ tp_first_name: "Mei", ownerUserId: "forged", stage: "closed" });
  assert.equal(controller.getState().saveState, "unsaved");
  assert.equal(controller.getState().dirty, true);
  assert.equal(controller.getState().editBaseRevision, 1);
  assert.equal(Object.hasOwn(controller.getState().draftAnswers, "ownerUserId"), false);
  assert.equal(Object.hasOwn(controller.getState().draftAnswers, "stage"), false);
  const seen = [];
  const saving = controller.saveAnswers();
  seen.push(controller.getState().saveState);
  await saving;
  seen.push(controller.getState().saveState);
  assert.deepEqual(seen, ["saving", "saved"]);
  assert.equal(controller.getState().dirty, false);
  assert.equal(controller.getState().editBaseRevision, null);
  assert.equal(store.writes[0].payload.answers.tp_first_name, "Mei");
  assert.equal(Object.hasOwn(store.writes[0].payload.answers, "ownerUserId"), false);
  assert.equal(store.writes[0].personId, null);
  assert.equal(controller.getState().savedCase.revision, 2);
  controller.stop();
});

test("an edit with no form open changes nothing", async () => {
  // No case and no new office draft: there is no form the answers belong to,
  // like the other entry points (revealInvalid, goToSubstep, removeMember).
  const store = fakeStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} }],
  });
  const { controller, renders } = build({ store });
  await controller.start();
  const drawn = renders.count;
  controller.editAnswers({ tp_first_name: "Mei" });
  const state = controller.getState();
  assert.deepEqual(state.draftAnswers, {});
  assert.equal(state.dirty, false);
  assert.equal(state.saveState, "idle");
  assert.equal(renders.count, drawn, "nothing to redraw");
  // Once a case is open, the same edit lands.
  await controller.selectCase("case-a");
  controller.editAnswers({ tp_first_name: "Mei" });
  assert.equal(controller.getState().draftAnswers.tp_first_name, "Mei");
  assert.equal(controller.getState().dirty, true);
  controller.stop();
});

test("a failed save keeps the draft editable and retries the identical envelope", async () => {
  const store = fakeStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} }],
  });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-a");
  controller.editAnswers({ tp_first_name: "Mei" });
  store.failNext = Object.assign(new Error("offline"), { code: "OFFLINE" });
  await assert.rejects(controller.saveAnswers(), (error) => error.code === "OFFLINE");
  assert.equal(controller.getState().saveState, "failed");
  assert.equal(controller.getState().dirty, true);
  assert.equal(controller.getState().draftAnswers.tp_first_name, "Mei");
  assert.equal(controller.getState().retryable, true);
  await controller.retryLast();
  assert.equal(store.writes.length, 2);
  // The same envelope object: same action id, payload and expectation.
  assert.equal(store.writes[0], store.writes[1]);
  assert.equal(store.writes[1].actionId, store.writes[0].actionId);
  assert.equal(controller.getState().saveState, "saved");
  assert.equal(controller.getState().retryable, false);
  assert.equal(controller.getState().dirty, false);
  controller.stop();
});

test("a retained envelope never outlives the answers it was built from", async () => {
  const store = fakeStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} }],
  });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-a");
  controller.editAnswers({ tp_first_name: "First try" });
  store.failNext = Object.assign(new Error("offline"), { code: "OFFLINE" });
  await assert.rejects(controller.saveAnswers(), (error) => error.code === "OFFLINE");
  assert.equal(controller.getState().retryable, true);
  // The person keeps typing while the save is still unsent.
  controller.editAnswers({ tp_first_name: "Newer answer" });
  assert.equal(
    controller.getState().retryable,
    false,
    "no banner may still offer to re-send the older answers",
  );
  assert.equal(await controller.retryLast(), null);
  assert.equal(store.writes.length, 1, "the stale envelope is never re-sent");
  assert.equal(controller.getState().draftAnswers.tp_first_name, "Newer answer");
  assert.equal(controller.getState().dirty, true);
  // Saving now sends the newer answers under a fresh envelope.
  await controller.saveAnswers();
  assert.equal(store.writes.length, 2);
  assert.notEqual(store.writes[1].actionId, store.writes[0].actionId);
  assert.equal(store.writes[1].payload.answers.tp_first_name, "Newer answer");
  assert.equal(controller.getState().savedCase.answers.tp_first_name, "Newer answer");
  controller.stop();
});

test("an unreachable server is never shown as a sign-in form, and retries by itself", async () => {
  const store = fakeStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} }],
  });
  let reachable = false;
  const auth = {
    ...idleAuth(),
    getSession: async () => {
      if (!reachable)
        throw Object.assign(
          new Error("Network error. Please try again later."),
          { code: "OFFLINE" },
        );
      return { user: { id: "user-1" } };
    },
  };
  const { controller, events } = build({ store, auth });
  await controller.start();
  let state = controller.getState();
  assert.equal(state.session, "unknown", "whether they are signed in is not known");
  assert.equal(state.principal, null);
  assert.equal(state.error.code, "OFFLINE");
  assert.equal(store.calls.length, 0, "nothing is read and nothing is subscribed");
  assert.equal(store.subscriptions, 0);
  // Coming back to the window re-attempts the identity load.
  await events.emit("focus");
  assert.equal(controller.getState().session, "unknown");
  reachable = true;
  await events.emit("online");
  state = controller.getState();
  assert.equal(state.session, "present");
  assert.equal(state.principal.userId, "user-1");
  assert.equal(state.error, null);
  assert.equal(state.cases.length, 1);
  assert.equal(store.subscriptions, 1);
  controller.stop();
});

test("a signed-in visitor the server cannot identify is not signed out either", async () => {
  const store = fakeStore({
    principal: Object.assign(new Error("offline"), { code: "OFFLINE" }),
  });
  const { controller } = build({ store });
  await controller.start();
  const state = controller.getState();
  assert.equal(state.session, "present", "the session was read; the principal was not");
  assert.equal(state.principal, null);
  assert.equal(state.error.code, "OFFLINE");
  assert.equal(store.subscriptions, 0);
  // Signing out is the one thing that makes the sign-in form right again.
  await controller.signOut();
  assert.equal(controller.getState().session, "none");
  controller.stop();
});

test("a corrected email address is the one bound, even inside the cooldown", async () => {
  const session = fakeSession();
  let now = 2_000_000;
  const sends = [];
  const verified = [];
  const auth = {
    getSession: async () => null,
    subscribe: () => () => {},
    signOut: async () => {},
    cooldownRemaining: () => 0,
    sendCode: async (email) => {
      sends.push(email);
      return {
        state: "code_entry",
        message: "If this address is eligible, check your inbox for a sign-in code.",
        retryAfterSeconds: 65,
      };
    },
    verifyCode: async (email, code) => {
      verified.push([email, code]);
    },
  };
  const { controller } = build({
    store: fakeStore(),
    auth,
    sessionStorage: session,
    clock: () => now,
    cooldownSeconds: 65,
  });
  await controller.start();
  await controller.sendCode("mei@exmaple.org");
  assert.equal(controller.getState().authEmail, "mei@exmaple.org");
  // The typo is noticed and corrected while the cooldown is still running.
  controller.restartSignIn();
  assert.equal(controller.getState().authStep, "email");
  assert.equal(controller.getState().authEmail, "");
  now += 5_000;
  assert.equal(controller.cooldownRemaining(), 60, "R38: the cooldown still runs");
  const answer = await controller.sendCode("mei@example.org");
  assert.equal(sends.length, 1, "nothing leaves inside the cooldown");
  assert.equal(
    answer.message,
    "If this address is eligible, check your inbox for a sign-in code.",
  );
  assert.equal(answer.retryAfterSeconds, 60);
  assert.equal(controller.getState().authStep, "code");
  assert.equal(
    controller.getState().authEmail,
    "mei@example.org",
    "the corrected address is bound, not the typo",
  );
  await controller.verifyCode("123456");
  assert.deepEqual(verified, [["mei@example.org", "123456"]]);
  controller.stop();

  // And the binding survives a reload, like the cooldown itself.
  now += 1_000;
  const again = build({
    store: fakeStore(),
    auth: { ...auth, getSession: async () => null },
    sessionStorage: session,
    clock: () => now,
    cooldownSeconds: 65,
  });
  session.setItem(
    "vitally:access:v1",
    JSON.stringify({
      startedAt: now - 5_000,
      email: "mei@example.org",
      message: "If this address is eligible, check your inbox for a sign-in code.",
    }),
  );
  await again.controller.start();
  assert.equal(again.controller.getState().authEmail, "mei@example.org");
  again.controller.stop();
});

test("an action that succeeded is never reported as failed by a later read", async () => {
  const store = fakeStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} }],
  });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-a");
  controller.editAnswers({ tp_first_name: "Mei" });
  // The write lands, then the connection drops before the re-read.
  const realList = store.listCases;
  store.listCases = async () => {
    store.calls.push("listCases");
    throw Object.assign(new Error("offline"), { code: "OFFLINE" });
  };
  await controller.saveAnswers();
  const state = controller.getState();
  assert.equal(state.saveState, "saved", "the save is not undone by a stale view");
  assert.equal(state.dirty, false);
  assert.equal(state.retryable, false, "there is no envelope left to re-send");
  assert.equal(state.connection, "offline");
  store.listCases = realList;
  await controller.retryLast();
  assert.equal(store.writes.length, 1, "nothing is sent a second time");
  controller.stop();
});

test("panels opened on one application do not follow to another", async () => {
  const store = fakeStore({
    cases: [
      { id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} },
      { id: "case-b", reference: "VT-CCCC-DDDD", stage: "draft", revision: 1, answers: {} },
    ],
  });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-a");
  controller.togglePanel("confirmed");
  assert.deepEqual(controller.getState().openPanels, ["confirmed"]);
  await controller.selectCase("case-b");
  assert.deepEqual(controller.getState().openPanels, []);
  controller.stop();
});

test("a refusal nobody has dismissed survives an unrelated background re-read", async () => {
  const store = fakeStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} }],
  });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-a");
  controller.editAnswers({ tp_first_name: "Mei" });
  store.failNext = Object.assign(
    new Error("Network error. Please try again later."),
    { code: "OFFLINE" },
  );
  await assert.rejects(controller.saveAnswers(), (error) => error.code === "OFFLINE");
  const shown = controller.getState().error;
  assert.equal(shown.code, "OFFLINE");
  assert.match(shown.message, /Network error\. Please try again later\./);

  // Somebody else's window changes a case. That says nothing about
  // this person's save, and must not answer for it.
  await store.handlers.onChange({ table: "cases", eventType: "UPDATE", id: "case-a", caseId: "case-a" });
  assert.deepEqual(controller.getState().error, shown, "the reason is still on screen");
  assert.equal(controller.getState().saveState, "failed");

  // Nor does a reconnect, a window focus or any other re-read.
  await controller.refresh();
  assert.deepEqual(controller.getState().error, shown);

  // Their own next action is what clears it.
  controller.editAnswers({ tp_last_name: "Chen" });
  assert.equal(controller.getState().error, null);
  controller.stop();
});

test("each way a person can answer a refusal clears it", async () => {
  const fresh = async () => {
    const store = fakeStore({
      cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} }],
    });
    const { controller } = build({ store });
    await controller.start();
    await controller.selectCase("case-a");
    store.failNext = Object.assign(new Error("offline"), { code: "OFFLINE" });
    await assert.rejects(controller.runAction("SUBMIT", { confirmed: true }));
    assert.equal(controller.getState().error.code, "OFFLINE");
    return { store, controller };
  };

  const dismissed = await fresh();
  dismissed.controller.dismissError();
  assert.equal(dismissed.controller.getState().error, null, "the dismiss control");
  dismissed.controller.stop();

  const navigated = await fresh();
  navigated.controller.navigate("applications");
  assert.equal(navigated.controller.getState().error, null, "navigation");
  navigated.controller.stop();

  const acted = await fresh();
  await acted.controller.runAction("SUBMIT", { confirmed: true });
  assert.equal(acted.controller.getState().error, null, "the next action");
  acted.controller.stop();

  const saved = await fresh();
  saved.controller.editAnswers({ tp_first_name: "Mei" });
  await saved.controller.saveAnswers();
  assert.equal(saved.controller.getState().error, null, "a save");
  saved.controller.stop();
});

test("a conflict explains itself and its own re-read does not erase the explanation", async () => {
  const store = fakeStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "preparing", revision: 3, answers: {} }],
  });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-a");
  // The office's work moved the revision a moment ago.
  store.failNext = Object.assign(new Error("conflict"), { code: "CONFLICT" });
  await assert.rejects(
    controller.runAction("RESPOND_DOCUMENT", {
      requestId: "req-1",
      filename: "demo-mileage-record-2025.pdf",
    }),
    (error) => error.code === "CONFLICT",
  );
  // The post-conflict re-read is what shows the newest case; it must not take
  // the sentence explaining the refusal with it.
  const after = controller.getState();
  assert.equal(after.error.code, "CONFLICT");
  assert.match(after.error.message, /someone else changed this/i);
  // And a background change arriving afterwards leaves it alone too.
  await store.handlers.onChange({ table: "cases", eventType: "UPDATE", id: "case-a", caseId: "case-a" });
  assert.equal(controller.getState().error.code, "CONFLICT");
  controller.stop();
});

test("a rejected action is not retryable and a remote conflict refreshes the case", async () => {
  const store = fakeStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} }],
  });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-a");
  const reads = store.calls.filter((entry) => entry === "getCase:case-a").length;
  store.failNext = Object.assign(new Error("conflict"), { code: "CONFLICT" });
  await assert.rejects(
    controller.runAction("SUBMIT", { confirmed: true }),
    (error) => error.code === "CONFLICT",
  );
  assert.equal(controller.getState().retryable, false);
  assert.match(controller.getState().error.message, /someone else changed this/i);
  assert.equal(
    store.calls.filter((entry) => entry === "getCase:case-a").length,
    reads + 1,
  );
  controller.stop();
});

test("runAction rejects an unknown type locally and sends no staff person for an applicant", async () => {
  const store = fakeStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "preparing", revision: 3, answers: {} }],
  });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-a");
  await assert.rejects(
    controller.runAction("DELETE_EVERYTHING", {}),
    (error) => error.code === "VALIDATION",
  );
  assert.equal(store.writes.length, 0);
  await controller.runAction("RESPOND_DOCUMENT", {
    requestId: "req-1",
    filename: "demo-mileage-record-2025.pdf",
  });
  assert.deepEqual(
    { ...store.writes[0], actionId: "id" },
    {
      actionId: "id",
      caseId: "case-a",
      expectedRevision: 3,
      personId: null,
      type: "RESPOND_DOCUMENT",
      payload: { requestId: "req-1", filename: "demo-mileage-record-2025.pdf" },
    },
  );
  controller.stop();
});

test("a staff member opens a case on the staff workspace and claims it", async () => {
  const store = fakeStore({
    principal: { userId: "p1", workspaceId: "w1", access: "staff", personId: "morgan" },
    people: [
      { id: "alex", name: "Alex", capabilities: ["prepare"] },
      { id: "morgan", name: "Morgan", capabilities: ["review"] },
    ],
    cases: [
      {
        id: "case-a",
        reference: "VT-AAAA-BBBB",
        stage: "review_ready",
        revision: 4,
        answers: {},
        preparerId: "alex",
        reviewerId: null,
        participants: ["alex"],
      },
    ],
  });
  const { controller } = build({ store });
  await controller.start();
  assert.equal(controller.getState().screen, "staff");
  await controller.selectCase("case-a");
  assert.equal(
    controller.getState().screen,
    "staff-case",
    "staff never land on the client's progress screen",
  );
  // The board's claim button sends exactly this: the canonical type, an empty
  // payload, and no person (the database derives it from the account).
  await controller.runAction("CLAIM_REVIEW", {});
  assert.deepEqual(
    { ...store.writes[0], actionId: "id" },
    {
      actionId: "id",
      caseId: "case-a",
      expectedRevision: 4,
      personId: null,
      type: "CLAIM_REVIEW",
      payload: {},
    },
  );
  controller.stop();
});

test("the board's filters are this window's, kept per user and dropped on sign-out", async () => {
  const shared = fakeSession();
  const staffCases = [
    { id: "case-a", reference: "VT-AAAA-BBBB", stage: "review_ready", revision: 4, answers: {} },
  ];
  const store = fakeStore({
    principal: { userId: "p1", workspaceId: "w1", access: "staff", personId: "alex" },
    people: [{ id: "alex", name: "Alex", capabilities: ["prepare"] }],
    cases: staffCases,
  });
  const first = build({ store, sessionStorage: shared });
  await first.controller.start();
  assert.deepEqual(first.controller.getState().boardFilters, {});
  first.controller.setBoardFilter("status", "available");
  first.controller.setBoardFilter("language", "Cantonese");
  assert.deepEqual(first.controller.getState().boardFilters, {
    status: "available",
    language: "Cantonese",
  });
  first.controller.stop();

  // A reload of the same window restores them.
  const again = build({ store, sessionStorage: shared });
  await again.controller.start();
  assert.deepEqual(again.controller.getState().boardFilters, {
    status: "available",
    language: "Cantonese",
  });
  again.controller.clearBoardFilters();
  assert.deepEqual(again.controller.getState().boardFilters, {});
  again.controller.setBoardFilter("search", "VT-AAAA");
  assert.equal(again.controller.getState().boardFilters.search, "VT-AAAA");
  // Choosing a tab is choosing what to see, so it ends the search.
  again.controller.setBoardFilter("status", "review");
  assert.deepEqual(again.controller.getState().boardFilters, { status: "review" });

  // Signing out drops them with everything else this window held.
  await again.controller.signOut();
  assert.deepEqual(again.controller.getState().boardFilters, {});
  assert.equal(shared.raw("vitally:client:v1:p1"), null);
  again.controller.stop();
});

test("clearing named board filters keeps the others", async () => {
  const { controller } = build({ store: fakeStore() });
  await controller.start();
  controller.setBoardFilter("status", "review");
  controller.setBoardFilter("poolLanguage", "Mandarin");
  controller.setBoardFilter("poolPhase", "closed");
  controller.clearBoardFilters(POOL_FILTER_KEYS);
  assert.deepEqual(controller.getState().boardFilters, { status: "review" });
  controller.clearBoardFilters();
  assert.deepEqual(controller.getState().boardFilters, {});
  controller.stop();
});

test("the board search draft survives a re-render but not a filter change", async () => {
  const store = fakeStore({
    principal: { userId: "p1", workspaceId: "w1", access: "staff", personId: "alex" },
    people: [{ id: "alex", name: "Alex", capabilities: ["prepare"] }],
    cases: [],
  });
  const { controller, sessionStorage } = build({ store });
  await controller.start();
  assert.equal(controller.getState().boardSearchDraft, undefined);

  // Typing sets the draft, like `setLookup` does for the applications lookup.
  controller.setBoardSearchDraft("VT-Z");
  assert.equal(controller.getState().boardSearchDraft, "VT-Z");

  // A search submit — `setBoardFilter("search", …)` — sends it and clears the
  // draft, so the field falls back to reading the saved search.
  controller.setBoardFilter("search", "VT-Z");
  assert.equal(controller.getState().boardSearchDraft, undefined);
  assert.equal(controller.getState().boardFilters.search, "VT-Z");

  // Any other filter choice ends a half-typed search too ("Clear search" is
  // one of these: `set-board-filter` with `data-filter="search"`).
  controller.setBoardSearchDraft("something else");
  controller.setBoardFilter("language", "Cantonese");
  assert.equal(controller.getState().boardSearchDraft, undefined);

  // So does clearing every filter.
  controller.setBoardSearchDraft("more typing");
  controller.clearBoardFilters();
  assert.equal(controller.getState().boardSearchDraft, undefined);

  // Never written to window-local storage: only the saved search is.
  controller.setBoardSearchDraft("not persisted");
  const stored = sessionStorage.keys().map((key) => sessionStorage.raw(key)).join("\n");
  assert.doesNotMatch(stored, /not persisted/);
  controller.stop();
});

test("starting a new application is explicit, idempotent and selects the new case", async () => {
  const store = fakeStore();
  let next = 0;
  const { controller, sessionStorage } = build({
    store,
    newActionId: () => `action-${(next += 1)}`,
  });
  await controller.start();
  assert.equal(store.writes.length, 0);
  // A transport failure keeps the pending action id.
  store.failNext = Object.assign(new Error("offline"), { code: "OFFLINE" });
  await assert.rejects(controller.createCase(), (error) => error.code === "OFFLINE");
  assert.equal(store.writes[0].actionId, "action-1");
  assert.ok(
    sessionStorage
      .raw("vitally:client:v1:user-1")
      .includes("action-1"),
    "the pending action id survives in window state",
  );
  // The retry reuses it, so the server replays one receipt instead of acting twice.
  const first = controller.createCase();
  const second = controller.createCase();
  await Promise.all([first, second]);
  assert.equal(store.writes.length, 2, "a second click while pending is a no-op");
  assert.equal(store.writes[1].actionId, "action-1");
  assert.equal(store.writes[1].mode, "client");
  assert.equal(store.writes[1].personId, null);
  assert.deepEqual(store.writes[1].answers, {});
  const state = controller.getState();
  assert.equal(state.selectedCaseId, state.savedCase.id);
  assert.equal(state.screen, "reference");
  assert.equal(state.cases.length, 1);
  assert.ok(!sessionStorage.raw("vitally:client:v1:user-1").includes("action-1"));
  // A second deliberate application uses a new action id.
  await controller.createCase();
  assert.equal(store.writes[2].actionId, "action-2");
  assert.equal(controller.getState().cases.length, 2);
  controller.stop();
});

test("window state is keyed by the authenticated user", async () => {
  // case-a is consented, or the 14446 gate would keep it on 0.4 (add-form-14446-consent).
  const shared = fakeSession();
  const storeOne = fakeStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: { ...CONSENT_14446 } }],
  });
  const one = build({ store: storeOne, sessionStorage: shared });
  await one.controller.start();
  await one.controller.selectCase("case-a");
  await one.controller.goToSubstep("about.you");
  one.controller.stop();

  const storeTwo = fakeStore({
    principal: { userId: "user-2", workspaceId: "w1", access: "applicant" },
    cases: [{ id: "case-z", reference: "VT-ZZZZ-YYYY", stage: "draft", revision: 1, answers: {} }],
  });
  const two = build({ store: storeTwo, sessionStorage: shared });
  await two.controller.start();
  assert.equal(two.controller.getState().selectedCaseId, null);
  assert.equal(two.controller.getState().formSubstep, null);
  two.controller.stop();

  // The first user's window state is still their own.
  const again = build({ store: storeOne, sessionStorage: shared });
  await again.controller.start();
  assert.equal(again.controller.getState().selectedCaseId, "case-a");
  assert.equal(again.controller.getState().formSubstep, "about.you");
  assert.equal(again.controller.getState().savedCase.id, "case-a");
  again.controller.stop();
  assert.deepEqual(shared.keys().sort(), [
    "vitally:client:v1:user-1",
    "vitally:client:v1:user-2",
  ]);
});

test("signing out clears cached records, drafts and the user's window state", async () => {
  const store = fakeStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} }],
  });
  let signedOut = 0;
  const auth = { ...idleAuth(), signOut: async () => { signedOut += 1; } };
  const { controller, sessionStorage } = build({ store, auth });
  await controller.start();
  await controller.selectCase("case-a");
  controller.editAnswers({ tp_first_name: "Mei" });
  assert.ok(sessionStorage.raw("vitally:client:v1:user-1"));
  await controller.signOut();
  assert.equal(signedOut, 1);
  const state = controller.getState();
  assert.equal(state.principal, null);
  assert.equal(state.savedCase, null);
  assert.deepEqual(state.draftAnswers, {});
  assert.deepEqual(state.cases, []);
  assert.equal(state.dirty, false);
  assert.equal(state.selectedCaseId, null);
  assert.equal(state.screen, "access");
  assert.equal(sessionStorage.raw("vitally:client:v1:user-1"), null);
  assert.equal(store.released, 1, "the subscription is released on sign-out");
  controller.stop();
});

test("the resend cooldown survives a reload of the same window", async () => {
  const session = fakeSession();
  let now = 1_000_000;
  const sends = [];
  const makeAuth = () => ({
    getSession: async () => null,
    subscribe: () => () => {},
    signOut: async () => {},
    cooldownRemaining: () => 0,
    sendCode: async (email) => {
      sends.push(email);
      return {
        state: "code_entry",
        message: "If this address is eligible, check your inbox for a sign-in code.",
        retryAfterSeconds: 65,
      };
    },
    verifyCode: async () => {},
  });
  const store = fakeStore();
  const first = build({
    store,
    auth: makeAuth(),
    sessionStorage: session,
    clock: () => now,
    cooldownSeconds: 65,
  });
  await first.controller.start();
  assert.equal(first.controller.getState().screen, "access");
  assert.equal(store.calls.length, 0, "a signed-out visitor reads nothing");
  await first.controller.sendCode("mei@example.org");
  assert.equal(first.controller.getState().authStep, "code");
  assert.equal(first.controller.cooldownRemaining(), 65);
  first.controller.stop();

  now += 10_000;
  const second = build({
    store,
    auth: makeAuth(),
    sessionStorage: session,
    clock: () => now,
    cooldownSeconds: 65,
  });
  await second.controller.start();
  assert.equal(second.controller.getState().authStep, "code");
  assert.equal(second.controller.cooldownRemaining(), 55);
  // A resend inside the window sends nothing at all and says the same thing.
  const answer = await second.controller.sendCode("mei@example.org");
  assert.equal(sends.length, 1);
  assert.equal(
    answer.message,
    "If this address is eligible, check your inbox for a sign-in code.",
  );
  now += 60_000;
  assert.equal(second.controller.cooldownRemaining(), 0);
  await second.controller.sendCode("mei@example.org");
  assert.equal(sends.length, 2);
  second.controller.stop();
});

test("the code being typed is held in state and cleared on every way out", async () => {
  const store = fakeStore();
  const sent = [];
  let session = null;
  const auth = {
    getSession: async () => session,
    subscribe: () => () => {},
    signOut: async () => {},
    cooldownRemaining: () => 0,
    sendCode: async () => ({
      state: "code_entry",
      message: "If this address is eligible, check your inbox for a sign-in code.",
      retryAfterSeconds: 65,
    }),
    verifyCode: async (email, code) => {
      sent.push([email, code]);
      if (code !== "246") throw Object.assign(new Error("no"), { code: "AUTH_INVALID_CODE" });
      session = { user: { id: "user-1" } };
    },
  };
  const { controller, renders } = build({ store, auth });
  await controller.start();
  await controller.sendCode("mei@example.org");

  // Typing does not re-render: the field already shows the characters, and a
  // rebuild would take them away again.
  const before = renders.count;
  controller.editAuthCode("24");
  controller.editAuthCode("246");
  assert.equal(controller.getState().authCode, "246");
  assert.equal(renders.count, before, "a keystroke never rebuilds the page");
  // Typing the address works the same way.
  controller.editAuthEmail("mei@example.org");
  assert.equal(controller.getState().authEmail, "mei@example.org");
  assert.equal(renders.count, before);

  // Called with nothing, the stored code is what is submitted.
  await assert.rejects(
    (async () => {
      controller.editAuthCode("999");
      await controller.verifyCode();
    })(),
    (error) => error.code === "AUTH_INVALID_CODE",
  );
  assert.deepEqual(sent.at(-1), ["mei@example.org", "999"]);
  assert.equal(controller.getState().authCode, "999", "a failed code stays editable");

  // Called with an argument, state and submission agree on that argument.
  await controller.verifyCode("246");
  assert.deepEqual(sent.at(-1), ["mei@example.org", "246"]);
  assert.equal(controller.getState().authCode, "", "cleared once it is spent");
  assert.equal(controller.getState().principal.userId, "user-1");

  await controller.signOut();
  assert.equal(controller.getState().authCode, "");
  controller.stop();
});

test("restarting sign-in forgets the code as well as the address", async () => {
  const auth = {
    ...idleAuth(),
    getSession: async () => null,
    sendCode: async () => ({
      state: "code_entry",
      message: "If this address is eligible, check your inbox for a sign-in code.",
      retryAfterSeconds: 65,
    }),
    verifyCode: async () => {},
  };
  const { controller } = build({ store: fakeStore(), auth });
  await controller.start();
  await controller.sendCode("mei@exmaple.org");
  controller.editAuthCode("123456");
  controller.restartSignIn();
  assert.equal(controller.getState().authCode, "");
  assert.equal(controller.getState().authEmail, "");
  assert.equal(controller.getState().authStep, "email");
  controller.stop();
});

test("an invalid code is a distinct failure and a verified visitor loads their own cases", async () => {
  const store = fakeStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} }],
  });
  let session = null;
  const auth = {
    getSession: async () => session,
    subscribe: () => () => {},
    signOut: async () => {},
    cooldownRemaining: () => 0,
    sendCode: async () => ({
      state: "code_entry",
      message: "If this address is eligible, check your inbox for a sign-in code.",
      retryAfterSeconds: 65,
    }),
    verifyCode: async (email, code) => {
      if (code !== "123456")
        throw Object.assign(
          new Error("That code is invalid or has expired. Request a new code."),
          { code: "AUTH_INVALID_CODE" },
        );
      session = { user: { id: "user-1" } };
    },
  };
  const { controller } = build({ store, auth });
  await controller.start();
  await controller.sendCode("mei@example.org");
  await assert.rejects(
    controller.verifyCode("000000"),
    (error) => error.code === "AUTH_INVALID_CODE",
  );
  assert.equal(controller.getState().authError.code, "AUTH_INVALID_CODE");
  assert.equal(controller.getState().principal, null);
  await controller.verifyCode("123456");
  assert.equal(controller.getState().authError, null);
  assert.equal(controller.getState().principal.userId, "user-1");
  assert.equal(controller.getState().cases.length, 1);
  assert.equal(controller.getState().screen, "applications");
  controller.stop();
});

// ---------------------------------------------------------------------------
// The office: assisted intake and assistance requests (Ruling R52)
// ---------------------------------------------------------------------------

const officeStore = (extra = {}) =>
  fakeStore({
    principal: { userId: "p1", workspaceId: "w1", access: "staff", personId: "sam" },
    people: [
      {
        id: "sam",
        name: "Sam",
        capabilities: ["admin", "assist", "followup", "receive_documents"],
      },
    ],
    ...extra,
  });

test("only a staff window can open Add a case", async () => {
  const client = fakeStore();
  const asClient = build({ store: client });
  await asClient.controller.start();
  await assert.rejects(
    asClient.controller.openAddCase(),
    (error) => error.code === "FORBIDDEN",
  );
  assert.equal(client.writes.length, 0);
  assert.notEqual(asClient.controller.getState().screen, "office-add-case");
  asClient.controller.stop();
});

test("assistance is loaded for a staff window only, and refreshed when its table changes", async () => {
  const applicant = fakeStore();
  const asClient = build({ store: applicant });
  await asClient.controller.start();
  assert.ok(!applicant.calls.includes("listAssistance"));
  assert.deepEqual(asClient.controller.getState().assistance, []);
  asClient.controller.stop();

  const store = officeStore({
    assistance: [
      { id: "item-1", title: "Help with the forms", status: "open", revision: 1 },
    ],
  });
  const { controller } = build({ store });
  await controller.start();
  assert.equal(
    store.calls.filter((entry) => entry === "listAssistance").length,
    1,
  );
  assert.equal(controller.getState().assistance[0].id, "item-1");
  // A change naming the assistance table re-reads the list, and nothing else.
  store.items.set("item-1", {
    id: "item-1",
    title: "Help with the forms",
    status: "assigned",
    revision: 2,
  });
  const listReads = store.calls.filter((entry) => entry === "listCases").length;
  await store.handlers.onChange({
    table: "assistance_items",
    eventType: "UPDATE",
    id: "item-1",
    caseId: null,
  });
  assert.equal(controller.getState().assistance[0].status, "assigned");
  assert.equal(
    store.calls.filter((entry) => entry === "listCases").length,
    listReads,
    "an assistance change is not a case change",
  );
  // A reconnect re-reads it too: a subscription is never the only way back.
  const assistanceReads = store.calls.filter(
    (entry) => entry === "listAssistance",
  ).length;
  await controller.refresh();
  assert.equal(
    store.calls.filter((entry) => entry === "listAssistance").length,
    assistanceReads + 1,
  );
  // Signing out drops the list with everything else.
  await controller.signOut();
  assert.deepEqual(controller.getState().assistance, []);
  controller.stop();
});

test("an assistance action carries the item's own revision and re-reads the list", async () => {
  const store = officeStore({
    assistance: [
      {
        id: "item-1",
        title: "Help with the forms",
        status: "open",
        revision: 4,
        assigneeId: null,
      },
    ],
  });
  let next = 0;
  const { controller } = build({
    store,
    newActionId: () => `action-${(next += 1)}`,
  });
  await controller.start();
  await controller.runAssistanceAction("CLAIM", "item-1");
  assert.deepEqual(store.writes[0], {
    actionId: "action-1",
    itemId: "item-1",
    expectedRevision: 4,
    personId: null,
    type: "CLAIM",
    note: null,
  });
  // The list is re-read, so the card now shows the new status and revision.
  assert.equal(controller.getState().assistance[0].status, "assigned");
  assert.equal(controller.getState().assistance[0].revision, 5);
  // A resolution carries the note and the revision the claim produced.
  await controller.runAssistanceAction("RESOLVE", "item-1", "Filled it in together.");
  assert.deepEqual(store.writes[1], {
    actionId: "action-2",
    itemId: "item-1",
    expectedRevision: 5,
    personId: null,
    type: "RESOLVE",
    note: "Filled it in together.",
  });
  assert.equal(controller.getState().assistance[0].status, "resolved");
  assert.equal(controller.getState().busy, false);
  // A claim never carries a note, whatever it is handed.
  store.items.set("item-2", {
    id: "item-2",
    title: "Another form",
    status: "open",
    revision: 1,
  });
  await store.handlers.onChange({
    table: "assistance_items",
    eventType: "INSERT",
    id: "item-2",
    caseId: null,
  });
  await controller.runAssistanceAction("CLAIM", "item-2", "smuggled");
  assert.equal(store.writes[2].note, null);
  controller.stop();
});

test("a stale assistance item is a conflict in the words of the item", async () => {
  const store = officeStore({
    assistance: [
      { id: "item-1", title: "Help with the forms", status: "open", revision: 1 },
    ],
  });
  const { controller } = build({ store });
  await controller.start();
  const reads = store.calls.filter((entry) => entry === "listAssistance").length;
  store.failNext = Object.assign(new Error("conflict"), { code: "CONFLICT" });
  await assert.rejects(
    controller.runAssistanceAction("CLAIM", "item-1"),
    (error) => error.code === "CONFLICT",
  );
  const state = controller.getState();
  assert.equal(state.error.code, "CONFLICT");
  assert.match(state.error.message, /Someone else changed this item/);
  assert.equal(state.retryable, false, "an assistance action is never re-sent");
  assert.equal(state.busy, false);
  assert.equal(
    store.calls.filter((entry) => entry === "listAssistance").length,
    reads + 1,
    "the newest version is read before the failure is shown",
  );
  controller.stop();
});

test("an unknown assistance type, or an item that is gone, never reaches the store", async () => {
  const store = officeStore({
    assistance: [
      { id: "item-1", title: "Help with the forms", status: "open", revision: 1 },
    ],
  });
  const { controller } = build({ store });
  await controller.start();
  for (const type of ["RELEASE", "claim", "CLOSE_CASE", "toString", ""])
    await assert.rejects(
      controller.runAssistanceAction(type, "item-1"),
      (error) => error.code === "VALIDATION",
      type,
    );
  await assert.rejects(
    controller.runAssistanceAction("CLAIM", "item-missing"),
    (error) => error.code === "NOT_FOUND",
  );
  assert.equal(store.writes.length, 0);
  controller.stop();
});

test("the office answers for a walk-in client and sends no person", async () => {
  const store = officeStore({
    cases: [
      {
        id: "case-a",
        reference: "VT-AAAA-BBBB",
        stage: "draft",
        revision: 2,
        ownerUserId: null,
        answers: {},
      },
    ],
  });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-a");
  controller.editAnswers({ tp_first_name: "Mei" });
  await controller.saveAnswers();
  // The database derives the staff member's person from the account.
  assert.equal(store.writes[0].type, "SAVE_ANSWERS");
  assert.equal(store.writes[0].personId, null);
  assert.equal(store.writes[0].expectedRevision, 2);
  assert.deepEqual(store.writes[0].payload, { answers: { tp_first_name: "Mei" } });
  // A client still answers for themselves.
  const asClient = build({
    store: fakeStore({
      cases: [
        { id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} },
      ],
    }),
  });
  await asClient.controller.start();
  await asClient.controller.selectCase("case-a");
  asClient.controller.editAnswers({ tp_first_name: "Mei" });
  await asClient.controller.saveAnswers();
  assert.equal(asClient.controller.getState().savedCase.answers.tp_first_name, "Mei");
  controller.stop();
  asClient.controller.stop();
});

// ---------------------------------------------------------------------------
// The workspace row and the workspace update
// ---------------------------------------------------------------------------

const adminStaffStore = (overrides = {}) =>
  fakeStore({
    principal: { userId: "p1", workspaceId: "w1", access: "staff", personId: "person-sam" },
    people: [{ id: "person-sam", name: "Sam", capabilities: ["admin"] }],
    ...overrides,
  });

const sampleCase = (overrides = {}) => ({
  id: "fixture-a",
  reference: "VT-SEED-1AAA",
  stage: "review_approved",
  revision: 11,
  answers: {},
  ...overrides,
});

test("a staff start reads the workspace its settings live on", async () => {
  const store = adminStaffStore({ cases: [sampleCase()] });
  const { controller } = build({ store });
  await controller.start();
  assert.ok(store.calls.includes("getWorkspace"));
  assert.deepEqual(controller.getState().workspace, {
    id: "w1",
    defaultFollowupPersonId: "person-sam",
    defaultIntakeVersion: 2,
  });
  controller.stop();

  // A client never reads the workspace.
  const clientStore = fakeStore({ cases: [] });
  const asClient = build({ store: clientStore });
  await asClient.controller.start();
  assert.ok(!clientStore.calls.includes("getWorkspace"));
  assert.equal(asClient.controller.getState().workspace, null);
  asClient.controller.stop();
});

test("a workspace update refetches the lists, the workspace and the open case", async () => {
  const store = adminStaffStore({
    cases: [sampleCase()],
    assistance: [
      { id: "item-1", title: "Help with the forms", status: "open", revision: 1 },
    ],
  });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("fixture-a");
  const before = {
    cases: store.calls.filter((entry) => entry === "listCases").length,
    workspace: store.calls.filter((entry) => entry === "getWorkspace").length,
    assistance: store.calls.filter((entry) => entry === "listAssistance").length,
  };
  // The workspace row moved, and it names no case at all. The open case is
  // gone, and the window forgets it quietly.
  store.records.delete("fixture-a");
  store.workspace = { ...store.workspace, defaultFollowupPersonId: "person-lee" };
  // The open case's own change comes first: getCase now answers NOT_FOUND.
  await store.handlers.onChange({
    table: "cases",
    eventType: "UPDATE",
    id: "fixture-a",
    caseId: "fixture-a",
  });
  assert.equal(controller.getState().selectedCaseId, null);
  assert.equal("notice" in controller.getState(), false);
  assert.equal(controller.getState().error, null);
  await store.handlers.onChange({
    table: "workspaces",
    eventType: "UPDATE",
    id: "w1",
    caseId: null,
  });
  assert.equal(
    store.calls.filter((entry) => entry === "listCases").length,
    before.cases + 2,
    "one list read per change",
  );
  assert.equal(
    store.calls.filter((entry) => entry === "getWorkspace").length,
    before.workspace + 1,
  );
  assert.equal(
    store.calls.filter((entry) => entry === "listAssistance").length,
    before.assistance + 1,
  );
  assert.equal(controller.getState().workspace.defaultFollowupPersonId, "person-lee");
  assert.equal(controller.getState().selectedCaseId, null);
  assert.equal(controller.getState().screen, "staff");
  assert.equal("notice" in controller.getState(), false, "nothing is said about it");
  assert.equal(controller.getState().error, null, "a case that is gone is not a failure");
  controller.stop();
});

test("a workspace update with the open case still there keeps the selection", async () => {
  const store = adminStaffStore({ cases: [sampleCase()] });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("fixture-a");
  await store.handlers.onChange({
    table: "workspaces",
    eventType: "UPDATE",
    id: "w1",
    caseId: null,
  });
  assert.equal(controller.getState().selectedCaseId, "fixture-a");
  controller.stop();
});

test("signing out forgets the workspace with everything else", async () => {
  const store = adminStaffStore({ cases: [sampleCase()] });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("fixture-a");
  assert.ok(controller.getState().workspace);
  await controller.signOut();
  assert.equal(controller.getState().workspace, null);
  controller.stop();
});

test("the sidebar starts open, toggles, survives a reload and reopens after sign-out", async () => {
  const shared = fakeSession();
  const store = fakeStore({
    principal: { userId: "p1", workspaceId: "w1", access: "staff", personId: "alex" },
    people: [{ id: "alex", name: "Alex", capabilities: ["prepare"] }],
    cases: [],
  });
  const first = build({ store, sessionStorage: shared });
  await first.controller.start();
  assert.equal(first.controller.getState().sidebarOpen, true);
  first.controller.toggleSidebar();
  assert.equal(first.controller.getState().sidebarOpen, false);
  first.controller.stop();

  const again = build({ store, sessionStorage: shared });
  await again.controller.start();
  assert.equal(again.controller.getState().sidebarOpen, false, "a reload keeps it");
  await again.controller.signOut();
  assert.equal(again.controller.getState().sidebarOpen, true);
  again.controller.stop();
});

test("the case tab is this window's, and resets for another case and sign-out", async () => {
  const shared = fakeSession();
  const store = fakeStore({
    principal: { userId: "p1", workspaceId: "w1", access: "staff", personId: "alex" },
    people: [
      { id: "alex", name: "Alex", capabilities: ["prepare"] },
      { id: "sam", name: "Sam", capabilities: ["admin"] },
    ],
    cases: [
      { id: "case-a", reference: "VT-AAAA-AAAA", stage: "preparing", revision: 1, answers: {} },
      { id: "case-b", reference: "VT-BBBB-BBBB", stage: "preparing", revision: 1, answers: {} },
    ],
  });
  const first = build({ store, sessionStorage: shared });
  await first.controller.start();
  assert.equal(first.controller.getState().caseTab, "overview");
  await first.controller.selectCase("case-a");
  first.controller.setCaseTab("documents");
  assert.equal(first.controller.getState().caseTab, "documents");
  // Re-opening the same case keeps the tab.
  await first.controller.selectCase("case-a");
  assert.equal(first.controller.getState().caseTab, "documents");
  first.controller.stop();

  // A reload of the same window restores it.
  const again = build({ store, sessionStorage: shared });
  await again.controller.start();
  assert.equal(again.controller.getState().caseTab, "documents");
  // Another case starts on Overview.
  await again.controller.selectCase("case-b");
  assert.equal(again.controller.getState().caseTab, "overview");
  again.controller.setCaseTab("followup");
  await again.controller.signOut();
  assert.equal(again.controller.getState().caseTab, "overview");
  again.controller.stop();
});

// ---------------------------------------------------------------------------
// The office drawers
// ---------------------------------------------------------------------------

test("a dialog can carry what it is about, and every way out forgets it", async () => {
  const store = adminStaffStore({ cases: [sampleCase({ id: "c1" })] });
  const { controller } = build({ store });
  await controller.start();
  controller.openDialog("log-call", { caseId: "c1" });
  assert.equal(controller.getState().dialog, "log-call");
  assert.deepEqual(controller.getState().dialogContext, { caseId: "c1" });
  controller.closeDialog();
  assert.equal(controller.getState().dialog, null);
  assert.equal(controller.getState().dialogContext, null);

  controller.openDialog("log-call", { caseId: "c1" });
  controller.navigate("staff");
  assert.equal(controller.getState().dialog, null);
  assert.equal(controller.getState().dialogContext, null);

  controller.openDialog("help");
  assert.equal(controller.getState().dialog, "help");
  assert.equal(controller.getState().dialogContext, null);
  controller.stop();
});

test("a case that is gone only moves a window that was showing it", async () => {
  const store = adminStaffStore({ cases: [sampleCase({ id: "c1" })] });
  const { controller } = build({ store });
  await controller.start();

  // Elsewhere on purpose: the selection is cleared and the screen stays.
  await controller.selectCase("c1", { navigate: false });
  controller.navigate("office-cases");
  store.records.delete("c1");
  await controller.refresh();
  assert.equal(controller.getState().selectedCaseId, null);
  assert.equal(controller.getState().savedCase, null);
  assert.equal(controller.getState().screen, "office-cases");

  // On the case page itself, the page has nothing left to show.
  store.records.set("c1", sampleCase({ id: "c1" }));
  await controller.selectCase("c1");
  assert.equal(controller.getState().screen, "staff-case");
  store.records.delete("c1");
  await controller.refresh();
  assert.equal(controller.getState().selectedCaseId, null);
  assert.equal(controller.getState().screen, "staff");

  // Opening a gone case in place from elsewhere leaves the screen alone too.
  controller.navigate("office-cases");
  await assert.rejects(
    () => controller.selectCase("c1", { navigate: false }),
    (error) => error.code === "NOT_FOUND",
  );
  assert.equal(controller.getState().selectedCaseId, null);
  assert.equal(controller.getState().screen, "office-cases");
  controller.stop();
});

test("a saved case id that no longer exists is forgotten when the window opens", async () => {
  // A window's saved selection outlives its case: the cleanup deleted it, or
  // a reset replaced it. The read answers NOT_FOUND, and nothing is selected.
  const sessionStorage = fakeSession({
    "vitally:client:v1:user-1": JSON.stringify({ screen: "intake", selectedCaseId: "case-gone", formSubstep: "about.you" }),
  });
  const store = fakeStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} }],
  });
  const { controller } = build({ store, sessionStorage });
  await controller.start();
  assert.ok(store.calls.includes("getCase:case-gone"), "the saved id was read");
  const state = controller.getState();
  assert.equal(state.selectedCaseId, null);
  assert.equal(state.savedCase, null);
  assert.equal(state.screen, "applications");
  assert.equal(state.error, null, "a gone case is not a failure to report");
  controller.stop();
});

test("the office screens are a staff admin's, and a client falls back home", async () => {
  const shared = fakeSession();
  const admin = build({ store: adminStaffStore(), sessionStorage: shared });
  await admin.controller.start();
  admin.controller.navigate("office-add-case");
  assert.equal(admin.controller.getState().screen, "office-add-case");
  admin.controller.navigate("office-cases");
  assert.equal(admin.controller.getState().screen, "office-cases");
  admin.controller.stop();

  // A reload keeps either one for a staff admin.
  for (const screen of ["office-add-case", "office-cases"]) {
    const store = adminStaffStore();
    const first = build({ store, sessionStorage: shared });
    await first.controller.start();
    first.controller.navigate(screen);
    first.controller.stop();
    const again = build({ store: adminStaffStore(), sessionStorage: shared });
    await again.controller.start();
    assert.equal(again.controller.getState().screen, screen);
    again.controller.stop();
  }

  // A client principal restoring either screen lands on its own home.
  const client = build({
    store: fakeStore({ principal: { userId: "p1", workspaceId: "w1", access: "applicant" } }),
    sessionStorage: shared,
  });
  await client.controller.start();
  assert.equal(client.controller.getState().screen, "applications");
  client.controller.stop();
});

// ---------------------------------------------------------------------------
// Version 2: the draft, withheld invalid values, sub-steps, visits on the
// server, the revealed list and card actions (spec 2026-09-30 §2.5, §3.3–§3.4;
// spec 2026-10-04 §3.1, §3.7, §3.8, §5.2, §6.3).
// ---------------------------------------------------------------------------

// The version-2 server as the fake sees it: a save merges (null clears) and the
// four contact fields go to the case's contact record, never into answers. Like
// the server, it refuses an envelope whose expected revision is not the case's,
// stores the union of the visited sub-steps it is sent, keeps card rows, and
// bumps the revision for every action.
function v2Store({
  answers = {},
  contact = null,
  revision = 1,
  stage = "draft",
  intakeVisited = [],
  documentCards = [],
  others = [],
  ...shared
} = {}) {
  const store = fakeStore({
    ...shared,
    cases: [
      {
        id: "case-v2",
        reference: "VT-V2AA-BBBB",
        stage,
        revision,
        intakeVersion: 2,
        // Consented and signed unless a test says otherwise (add-form-14446-consent).
        answers: { ...CONSENT_14446, ...answers },
        contact,
        intakeVisited,
        documentCards,
      },
      ...others,
    ],
  });
  // Refusals to throw from `act`, one per call, before anything is stored.
  store.refusals = [];
  store.act = async (action) => {
    store.calls.push(`act:${action.type}`);
    store.writes.push(action);
    const failure = store.failNext ?? store.refusals.shift();
    store.failNext = null;
    if (failure) throw failure;
    const record = store.records.get(action.caseId);
    if (action.expectedRevision !== record.revision)
      throw Object.assign(new Error("stale"), { code: "CONFLICT" });
    const next = { ...record, revision: record.revision + 1 };
    if (action.type === "SAVE_ANSWERS") {
      const merged = { ...record.answers };
      let contact = record.contact;
      for (const [id, value] of Object.entries(action.payload.answers)) {
        if (CONTACT_FIELDS[id]) {
          contact = { ...(contact ?? {}), [CONTACT_FIELDS[id]]: value };
          continue;
        }
        if (value === null) delete merged[id];
        else merged[id] = value;
      }
      next.answers = merged;
      next.contact = contact;
      if (action.payload.visited)
        next.intakeVisited = [...new Set([...(record.intakeVisited ?? []), ...action.payload.visited])];
    }
    // The office's best time and note go to the case's contact record; a null clears.
    if (action.type === "UPDATE_CONTACT")
      next.contact = { ...(record.contact ?? {}), ...action.payload };
    const setCard = (slotId, change) => {
      const cards = [...(record.documentCards ?? [])];
      const at = cards.findIndex((card) => card.slotId === slotId);
      const row = { slotId, status: null, groupOverride: null, ...(at >= 0 ? cards[at] : {}), ...change, changedAt: "2026-10-04T12:00:00Z" };
      if (at >= 0) cards[at] = row;
      else cards.push(row);
      next.documentCards = cards;
    };
    if (action.type === "SET_DOCUMENT_CARD")
      setCard(action.payload.slotId, { status: action.payload.status === "not_done" ? null : action.payload.status });
    if (action.type === "SET_DOCUMENT_GROUP")
      setCard(action.payload.slotId, { groupOverride: action.payload.group === "needed" ? "needed" : null });
    store.records.set(action.caseId, next);
    return { actionId: action.actionId, caseId: action.caseId, reference: next.reference, revision: next.revision };
  };
  return store;
}

test("the office's UPDATE_CONTACT leaves the case's contact changed and its revision the store's", async () => {
  const { controller, store } = await openV2({
    answers: { tp_first_name: "Mei" },
    contact: { phone: "2155550101", bestContactTime: ["weekday_evening"], bestContactNote: "After 6 pm." },
    stage: "preparing",
  });
  await controller.runAction("UPDATE_CONTACT", { bestContactTime: ["weekend"] });
  const saved = controller.getState().savedCase;
  assert.deepEqual(saved.contact.bestContactTime, ["weekend"]);
  assert.equal(saved.contact.phone, "2155550101", "the phone is never part of this action");
  assert.equal(saved.contact.bestContactNote, "After 6 pm.", "a key the form did not send is left alone");
  assert.equal(saved.revision, store.records.get("case-v2").revision);
  assert.equal(store.writes.at(-1).type, "UPDATE_CONTACT");
  assert.deepEqual(store.writes.at(-1).payload, { bestContactTime: ["weekend"] });
  controller.stop();
});

// Somebody else's change to the open case: a newer revision of the record,
// then the realtime signal for it.
async function remoteChange(store, change) {
  const record = store.records.get("case-v2");
  store.records.set("case-v2", { ...record, revision: record.revision + 1, ...change });
  await store.handlers.onChange({ table: "cases", caseId: "case-v2" });
}

const offline = () => Object.assign(new Error("offline"), { code: "OFFLINE" });
const chip = (controller) => saveStatus(controller.getState()).replace(/<[^>]+>/g, "").trim();

async function openV2(options = {}) {
  const store = v2Store(options);
  const built = build({ store, sessionStorage: options.sessionStorage, clock: options.clock });
  await built.controller.start();
  await built.controller.selectCase("case-v2");
  return { store, ...built };
}

// A version-2 case whose last save succeeded: the chip reads "Saved".
async function savedV2(answers = { tp_first_name: "Mei" }) {
  const opened = await openV2({ answers: { ...answers, tp_last_name: "Old" } });
  opened.controller.editAnswers({ tp_last_name: "Chen" });
  await opened.controller.saveAnswers();
  assert.equal(opened.controller.getState().saveState, "saved");
  assert.equal(chip(opened.controller), "Saved");
  return opened;
}

test("a version-2 draft takes its contact fields from the case's contact record", async () => {
  const bare = await openV2({ answers: { tp_first_name: "Mei" }, contact: null });
  const draft = bare.controller.getState().draftAnswers;
  assert.deepEqual(draft, { ...CONSENT_14446, tp_first_name: "Mei" });
  for (const id of Object.keys(CONTACT_FIELDS)) assert.equal(Object.hasOwn(draft, id), false, id);
  bare.controller.stop();

  const withContact = await openV2({
    answers: { tp_first_name: "Mei" },
    contact: { phone: "2155550199", spousePhone: null, bestContactTime: ["weekend"], bestContactNote: null },
  });
  assert.deepEqual(withContact.controller.getState().draftAnswers, {
    ...CONSENT_14446,
    tp_first_name: "Mei",
    tp_phone: "2155550199",
    best_contact_time: ["weekend"],
  });
  withContact.controller.stop();
});

test("a version-2 edit keeps structured values and null, and the save carries them with the contact", async () => {
  const { controller, store } = await openV2({
    answers: { tp_first_name: "Mei", tp_middle_name: "Lan", ownerUserId: "forged" },
    contact: { phone: "2155550199", bestContactTime: ["weekend"] },
  });
  assert.equal(Object.hasOwn(controller.getState().draftAnswers, "ownerUserId"), false);
  controller.editAnswers({ tp_middle_name: null });
  assert.equal(controller.getState().draftAnswers.tp_middle_name, null);
  controller.editAnswers({ hh: [{ member_id: "0123456789abcdef0123456789abcdef", first_name: "Xiao" }], best_contact_time: ["weekend", "any_time"], stage: "closed" });
  assert.deepEqual(controller.getState().draftAnswers.hh, [{ member_id: "0123456789abcdef0123456789abcdef", first_name: "Xiao" }]);
  assert.equal(Object.hasOwn(controller.getState().draftAnswers, "stage"), false);
  await controller.saveAnswers();
  const sent = store.writes[0].payload.answers;
  assert.equal(sent.tp_middle_name, null);
  assert.equal(sent.tp_phone, "2155550199");
  assert.deepEqual(sent.best_contact_time, ["weekend", "any_time"]);
  assert.deepEqual(sent.hh, [{ member_id: "0123456789abcdef0123456789abcdef", first_name: "Xiao" }]);
  controller.stop();
});

test("leaving married drops the spouse from every who answer in the same edit", async () => {
  const { controller } = await openV2({
    answers: { marital_status: "married", us_citizen: ["me", "spouse"], on_visa: ["spouse"], pecf: ["none"] },
  });
  controller.editAnswers({ marital_status: "married", disabled: ["spouse"] });
  assert.deepEqual(controller.getState().draftAnswers.disabled, ["spouse"], "still married: nothing is cleared");
  controller.editAnswers({ marital_status: "never_married" });
  const draft = controller.getState().draftAnswers;
  assert.equal(draft.marital_status, "never_married");
  assert.deepEqual(draft.us_citizen, ["me"]);
  assert.deepEqual(draft.pecf, ["none"]);
  for (const id of ["us_citizen", "on_visa", "disabled", "pecf"])
    assert.equal((draft[id] ?? []).includes("spouse"), false, id);
  controller.stop();
});

test("a death year that ends the joint return drops the spouse from the who answers (add-widowed-spouse-rules)", async () => {
  const { controller } = await openV2({
    answers: { marital_status: "widowed", spouse_death_year: "2025", us_citizen: ["me", "spouse"], pecf: ["spouse"] },
  });
  controller.editAnswers({ spouse_death_year: "2020" });
  const draft = controller.getState().draftAnswers;
  assert.deepEqual(draft.us_citizen, ["me"]);
  assert.equal(draft.pecf, null);
  controller.stop();
});

test("a death year with spaces counts as the whole year the save sends (add-widowed-spouse-rules)", async () => {
  const { controller } = await openV2({
    answers: { marital_status: "widowed", spouse_death_year: "2025", us_citizen: ["me", "spouse"] },
  });
  controller.editAnswers({ spouse_death_year: "2020 " });
  assert.deepEqual(controller.getState().draftAnswers.us_citizen, ["me"]);
  controller.stop();
});

test("retyping the death year keeps the spouse (add-widowed-spouse-rules)", async () => {
  const { controller } = await openV2({
    answers: { marital_status: "widowed", spouse_death_year: "2025", us_citizen: ["me", "spouse"] },
  });
  for (const typed of ["", "2", "20", "202", "2025"]) {
    controller.editAnswers({ spouse_death_year: typed });
    assert.deepEqual(controller.getState().draftAnswers.us_citizen, ["me", "spouse"], `after "${typed}"`);
  }
  controller.editAnswers({ spouse_death_year: "2205" });
  assert.deepEqual(controller.getState().draftAnswers.us_citizen, ["me", "spouse"], "an invalid year waits for a whole one");
  // What a move sends from the marital-status page: every answer on it,
  // the unchanged marital status included.
  controller.editAnswers({ marital_status: "widowed", spouse_death_year: "202" });
  assert.deepEqual(controller.getState().draftAnswers.us_citizen, ["me", "spouse"], "a move with an unchanged status keeps the spouse");
  controller.editAnswers({ marital_status: "divorced" });
  assert.deepEqual(controller.getState().draftAnswers.us_citizen, ["me"], "a changed marital status cleans while J is off");
  controller.stop();
});

test("goToSubstep records the sub-step being left, saves a dirty draft, then moves", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  assert.equal(controller.getState().formSubstep, "before.ready");
  assert.deepEqual(controller.getState().visitedSubsteps, []);
  await controller.goToSubstep("before.service");
  assert.equal(controller.getState().formSubstep, "before.service");
  assert.deepEqual(controller.getState().visitedSubsteps, ["before.ready"]);
  controller.editAnswers({ tp_first_name: "Ming" });
  await controller.goToSubstep("about.address");
  assert.equal(store.writes.length, 2);
  assert.equal(store.writes[1].payload.answers.tp_first_name, "Ming");
  assert.deepEqual(store.writes[1].payload.visited, ["before.ready", "before.service"]);
  assert.equal(controller.getState().formSubstep, "about.address");
  assert.deepEqual(controller.getState().visitedSubsteps, ["before.ready", "before.service"]);
  assert.equal(controller.getState().saveState, "saved");
  assert.equal(controller.getState().dirty, false);
  controller.stop();
});

test("goToSubstep still moves when its save fails", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.editAnswers({ tp_first_name: "Ming" });
  store.failNext = offline();
  await controller.goToSubstep("about.you");
  assert.equal(controller.getState().formSubstep, "about.you");
  assert.equal(controller.getState().saveState, "failed");
  assert.equal(controller.getState().dirty, true);
  controller.stop();
});

// Holds every `act` until `release()`, so a test can act during a save.
function holdSaves(store) {
  const act = store.act;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  store.actCalls = 0;
  store.act = async (action) => {
    store.actCalls += 1;
    await gate;
    return act(action);
  };
  return () => release();
}

test("a second sub-step change during the first one's save is ignored, so no false conflict", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.editAnswers({ tp_first_name: "Ming" });
  const release = holdSaves(store);
  const first = controller.goToSubstep("before.service");
  const second = controller.goToSubstep("income.wages");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.actCalls, 1, "one SAVE_ANSWERS only");
  release();
  await Promise.all([first, second]);
  assert.equal(store.actCalls, 1);
  assert.equal(controller.getState().formSubstep, "before.service");
  assert.equal(controller.getState().saveState, "saved");
  assert.equal(controller.getState().conflict, null);
  await controller.goToSubstep("income.wages");
  assert.equal(controller.getState().formSubstep, "income.wages", "the guard is gone once the save lands");
  assert.equal(controller.getState().conflict, null);
  controller.stop();
});

test("a sub-step change whose save outlives its case leaves the newly opened case's place alone", async () => {
  const { controller, store } = await openV2({
    answers: { tp_first_name: "Mei" },
    others: [{ id: "case-w", reference: "VT-WWWW-BBBB", stage: "draft", revision: 1, intakeVersion: 2, answers: {} }],
  });
  controller.editAnswers({ tp_first_name: "Ming" });
  const release = holdSaves(store);
  const moving = controller.goToSubstep("income.wages");
  await controller.selectCase("case-w");
  const opened = controller.getState().formSubstep;
  assert.equal(opened, "before.ready");
  release();
  await moving;
  assert.equal(controller.getState().selectedCaseId, "case-w");
  assert.equal(controller.getState().formSubstep, opened);
  controller.stop();
});

test("using the office's values on a version-2 case keeps the four contact fields", async () => {
  const { controller, store } = await openV2({
    answers: { tp_first_name: "Mei" },
    contact: { phone: "2155550199", spousePhone: null, bestContactTime: ["weekend"], bestContactNote: "After six" },
  });
  controller.editAnswers({ tp_first_name: "Ming" });
  store.records.set("case-v2", {
    ...store.records.get("case-v2"),
    revision: 2,
    answers: { tp_first_name: "Lan" },
  });
  await store.handlers.onChange({ table: "cases", caseId: "case-v2" });
  const state = controller.getState();
  assert.equal(state.conflict?.code, "REMOTE_CHANGED");
  assert.equal(Object.hasOwn(state.savedCase.answers, "tp_phone"), false, "the contact is not in answers");
  await controller.reconcileAnswers({
    answers: state.savedCase.answers,
    expectedServerRevision: state.savedCase.revision,
    fromServer: true,
  });
  assert.deepEqual(controller.getState().draftAnswers, {
    tp_first_name: "Lan",
    tp_phone: "2155550199",
    best_contact_time: ["weekend"],
    best_contact_note: "After six",
  });
  assert.equal(controller.getState().conflict, null);
  controller.stop();
});

test("another case starts with no visited sub-steps, nothing revealed and no return", async () => {
  const { controller } = await openV2({
    answers: { tp_first_name: "Mei" },
    others: [{ id: "case-w", reference: "VT-WWWW-BBBB", stage: "draft", revision: 1, intakeVersion: 2, answers: {} }],
  });
  await controller.goToSubstep("about.you");
  controller.editAnswers({ email: "a@" });
  await controller.openForChange("about.address");
  assert.deepEqual(controller.getState().visitedSubsteps, ["before.ready", "about.you"]);
  assert.deepEqual(controller.getState().revealed, ["email"]);
  assert.equal(controller.getState().returnToSummary, true);
  await controller.selectCase("case-w");
  assert.deepEqual(controller.getState().visitedSubsteps, []);
  assert.deepEqual(controller.getState().revealed, []);
  assert.equal(controller.getState().returnToSummary, false);
  assert.equal(controller.getState().formSubstep, "before.ready");
  controller.stop();
});

test("a version-2 save withholds invalid values and trims, and never touches the draft", async () => {
  const { controller, store } = await openV2();
  controller.editAnswers({ tp_first_name: "Mei", email: "a@", addr_zip: " 19107 " });
  await controller.saveAnswers();
  assert.deepEqual(store.writes[0].payload.answers, { ...CONSENT_14446, tp_first_name: "Mei", addr_zip: "19107" });
  const draft = controller.getState().draftAnswers;
  assert.equal(draft.addr_zip, " 19107 ");
  assert.equal(draft.email, "a@");
  controller.stop();
});

test("version-2 dirty means a save would change the server", async () => {
  const { controller } = await savedV2();
  // Valid to invalid: the field is withheld, so nothing would change.
  controller.editAnswers({ email: "a@" });
  assert.equal(controller.getState().dirty, false);
  assert.equal(chip(controller), "Saved");
  controller.revealInvalid("email");
  assert.equal(chip(controller), "1 answer needs checking");
  // Editing an already-invalid value leaves it as it was.
  controller.editAnswers({ email: "a@@" });
  assert.equal(controller.getState().dirty, false);
  // Spaces alone would send the same value.
  controller.editAnswers({ tp_first_name: "Mei " });
  assert.equal(controller.getState().dirty, false);
  assert.equal(controller.getState().editBaseRevision, null);
  assert.equal(controller.getState().saveState, "saved");
  // A real change pins the revision the person was looking at.
  controller.editAnswers({ tp_first_name: "Ming" });
  assert.equal(controller.getState().dirty, true);
  assert.equal(controller.getState().saveState, "unsaved");
  assert.equal(controller.getState().editBaseRevision, 2);
  controller.stop();
});

test("an undo returns to the save state it replaced", async () => {
  const saved = await savedV2();
  saved.controller.editAnswers({ tp_first_name: "Ming" });
  assert.equal(chip(saved.controller), "Unsaved changes");
  saved.controller.editAnswers({ tp_first_name: "Mei" });
  assert.equal(saved.controller.getState().dirty, false);
  assert.equal(saved.controller.getState().saveState, "saved");
  assert.equal(saved.controller.getState().editBaseRevision, null);
  assert.equal(chip(saved.controller), "Saved");
  // With a revealed invalid email in the draft, the undo shows the count.
  saved.controller.editAnswers({ email: "a@" });
  saved.controller.revealInvalid("email");
  saved.controller.editAnswers({ tp_first_name: "Ming" });
  saved.controller.editAnswers({ tp_first_name: "Mei" });
  assert.equal(chip(saved.controller), "1 answer needs checking");
  saved.controller.stop();

  const fresh = await openV2({ answers: { tp_first_name: "Mei" } });
  fresh.controller.editAnswers({ tp_first_name: "Ming" });
  fresh.controller.editAnswers({ tp_first_name: "Mei" });
  assert.equal(fresh.controller.getState().dirty, false);
  assert.equal(fresh.controller.getState().saveState, "idle");
  assert.equal(chip(fresh.controller), "Up to date");
  fresh.controller.stop();
});

test("the pin is cleared on undo, so a later office save is not a false conflict", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" }, revision: 5 });
  controller.editAnswers({ tp_first_name: "Ming" });
  assert.equal(controller.getState().editBaseRevision, 5);
  controller.editAnswers({ tp_first_name: "Mei" });
  assert.equal(controller.getState().dirty, false);
  assert.equal(controller.getState().editBaseRevision, null);
  // The office saves in between.
  store.records.set("case-v2", {
    ...store.records.get("case-v2"),
    revision: 6,
    answers: { tp_first_name: "Mei", tp_last_name: "Chen" },
  });
  await store.handlers.onChange({ table: "cases", caseId: "case-v2" });
  assert.equal(controller.getState().conflict, null);
  assert.equal(controller.getState().draftAnswers.tp_last_name, "Chen");
  controller.editAnswers({ tp_first_name: "Ming" });
  assert.equal(controller.getState().editBaseRevision, 6);
  await controller.saveAnswers();
  assert.equal(store.writes[0].expectedRevision, 6);
  assert.equal(controller.getState().conflict, null);
  assert.equal(controller.getState().saveState, "saved");
  controller.stop();
});

test("after a failed save an undo stays dirty and keeps its pin", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.editAnswers({ tp_first_name: "Ming" });
  store.failNext = offline();
  await assert.rejects(controller.saveAnswers(), (error) => error.code === "OFFLINE");
  assert.equal(controller.getState().retryable, true);
  controller.editAnswers({ tp_first_name: "Mei" });
  assert.equal(controller.getState().dirty, true);
  assert.equal(controller.getState().editBaseRevision, 1);
  assert.equal(controller.getState().saveState, "failed");
  assert.equal(controller.getState().retryable, false, "the envelope no longer matches");
  assert.equal(await controller.retryLast(), null);
  await controller.saveAnswers();
  assert.equal(store.writes.length, 2);
  assert.equal(store.writes[1].payload.answers.tp_first_name, "Mei");
  assert.equal(store.writes[1].expectedRevision, 1);
  controller.stop();
});

test("local-only differences survive every refresh", async () => {
  const { controller, store } = await openV2();
  controller.editAnswers({ tp_first_name: "Mei", email: "a@", addr_zip: " 19107 " });
  await controller.saveAnswers();
  assert.equal(Object.hasOwn(store.records.get("case-v2").answers, "email"), false);
  assert.equal(store.records.get("case-v2").answers.addr_zip, "19107");
  let draft = controller.getState().draftAnswers;
  assert.equal(draft.email, "a@");
  assert.equal(draft.addr_zip, " 19107 ");
  // Somebody else changes the name.
  store.records.set("case-v2", {
    ...store.records.get("case-v2"),
    revision: 3,
    answers: { ...store.records.get("case-v2").answers, tp_first_name: "Ming" },
  });
  await store.handlers.onChange({ table: "cases", caseId: "case-v2" });
  draft = controller.getState().draftAnswers;
  assert.equal(draft.tp_first_name, "Ming");
  assert.equal(draft.email, "a@");
  assert.equal(draft.addr_zip, " 19107 ");
  controller.stop();
});

test("a retained envelope ignores withheld fields and spaces", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.editAnswers({ tp_last_name: "Chen", email: "a@" });
  store.failNext = offline();
  await assert.rejects(controller.saveAnswers());
  controller.editAnswers({ email: "b@" });
  assert.equal(controller.getState().retryable, true, "the invalid email was never in the envelope");
  controller.editAnswers({ tp_last_name: "Chen " });
  assert.equal(controller.getState().retryable, true, "spaces alone send the same value");
  await controller.retryLast();
  assert.equal(store.writes.length, 2);
  assert.equal(store.writes[1], store.writes[0], "the identical envelope");
  assert.equal(controller.getState().saveState, "saved");

  controller.editAnswers({ tp_last_name: "Wang" });
  store.failNext = offline();
  await assert.rejects(controller.saveAnswers());
  controller.editAnswers({ tp_first_name: "Ming" });
  assert.equal(controller.getState().retryable, false);
  assert.equal(await controller.retryLast(), null);
  assert.equal(store.writes.length, 3);
  controller.stop();
});

test("the revealed list: typing never adds, a fix or a new case removes", async () => {
  const { controller } = await savedV2();
  controller.editAnswers({ email: "a@" });
  assert.deepEqual(controller.getState().revealed, [], "typing adds nothing");
  assert.equal(chip(controller), "Saved");
  controller.revealInvalid("email");
  assert.deepEqual(controller.getState().revealed, ["email"]);
  controller.revealInvalid("email");
  assert.deepEqual(controller.getState().revealed, ["email"], "added once");
  controller.revealInvalid("tp_first_name");
  assert.deepEqual(controller.getState().revealed, ["email"], "a valid value is never revealed");
  controller.editAnswers({ email: "mei@example.com" });
  assert.deepEqual(controller.getState().revealed, []);
  controller.editAnswers({ email: "a@" });
  assert.deepEqual(controller.getState().revealed, []);
  controller.revealInvalid("email");
  controller.editAnswers({ email: null });
  assert.deepEqual(controller.getState().revealed, [], "empty is not invalid");
  controller.stop();
});

test("leaving a sub-step reveals its invalid answers", async () => {
  const { controller } = await savedV2();
  await controller.goToSubstep("about.you");
  controller.editAnswers({ email: "a@", sp_dob: "1990-02-30" });
  assert.equal(chip(controller), "Saved");
  await controller.goToSubstep("about.address");
  assert.deepEqual(controller.getState().revealed, ["email"], "only the sub-step being left, and only visible questions");
  assert.equal(chip(controller), "1 answer needs checking");
  controller.stop();
});

test("a revealed answer whose question is hidden is not counted, and stays revealed", async () => {
  const { controller, store } = await openV2({ answers: { marital_status: "married" } });
  controller.editAnswers({ sp_dob: "1990-02-30" });
  assert.equal(controller.getState().dirty, false);
  controller.revealInvalid("sp_dob");
  assert.equal(chip(controller), "1 answer needs checking");
  store.records.set("case-v2", {
    ...store.records.get("case-v2"),
    revision: 2,
    answers: { marital_status: "never_married" },
  });
  await store.handlers.onChange({ table: "cases", caseId: "case-v2" });
  assert.equal(controller.getState().draftAnswers.sp_dob, "1990-02-30");
  assert.deepEqual(controller.getState().revealed, ["sp_dob"]);
  assert.equal(chip(controller), "Up to date");
  controller.stop();
});

test("removing a household member renumbers the revealed ids after it", async () => {
  const { controller } = await openV2();
  controller.editAnswers({
    has_household_members: "yes",
    hh: [
      { member_id: "00000000000000000000000000000001", first_name: "An", dob: "2015-02-30" },
      { member_id: "00000000000000000000000000000002", first_name: "Bo", dob: "2016-02-30" },
      { member_id: "00000000000000000000000000000003", first_name: "Cy", dob: "2017-01-01" },
    ],
  });
  controller.revealInvalid("hh[0].dob");
  controller.revealInvalid("hh[1].dob");
  assert.deepEqual(controller.getState().revealed, ["hh[0].dob", "hh[1].dob"]);
  const before = controller.getState().draftAnswers.hh;
  controller.removeMember(0);
  assert.deepEqual(controller.getState().revealed, ["hh[0].dob"]);
  assert.deepEqual(
    controller.getState().draftAnswers.hh.map((member) => member.first_name),
    ["Bo", "Cy"],
  );
  assert.equal(before.length, 3, "the old array is never changed in place");
  controller.removeMember(1);
  controller.removeMember(0);
  assert.deepEqual(controller.getState().revealed, []);
  assert.equal(controller.getState().draftAnswers.hh, null, "no members left reads null");
  controller.stop();
});

test("taking the office's valid value unreveals it", async () => {
  const { controller, store } = await savedV2();
  controller.editAnswers({ email: "a@" });
  controller.revealInvalid("email");
  controller.editAnswers({ tp_first_name: "Ming" });
  const server = { ...store.records.get("case-v2").answers, email: "office@example.com" };
  store.records.set("case-v2", { ...store.records.get("case-v2"), revision: 3, answers: server });
  await store.handlers.onChange({ table: "cases", caseId: "case-v2" });
  assert.equal(controller.getState().conflict?.code, "REMOTE_CHANGED");
  assert.deepEqual(controller.getState().revealed, ["email"]);
  await controller.reconcileAnswers({ answers: server, expectedServerRevision: 3 });
  assert.equal(controller.getState().draftAnswers.email, "office@example.com");
  assert.deepEqual(controller.getState().revealed, []);
  controller.editAnswers({ email: "a@" });
  assert.deepEqual(controller.getState().revealed, []);
  assert.equal(controller.getState().dirty, false);
  assert.equal(chip(controller), "Saved");
  controller.stop();
});

test("the sub-step and the revealed list round-trip through the window state; visits come from the server", async () => {
  const sessionStorage = fakeSession();
  // The fake server holds an invalid email (the real one never would), so the
  // restored id still has something to point at after the case is re-read.
  const first = await openV2({ answers: { email: "a@" }, sessionStorage });
  await first.controller.goToSubstep("about.you");
  await first.controller.goToSubstep("about.address");
  assert.deepEqual(first.controller.getState().revealed, ["email"]);
  const stored = JSON.parse(sessionStorage.raw("vitally:client:v1:user-1"));
  assert.equal(stored.formSubstep, "about.address");
  assert.deepEqual(stored.revealedAnswers, { caseId: "case-v2", ids: ["email"] });
  assert.equal(Object.hasOwn(stored, "visitedSteps"), false);
  first.controller.stop();

  const second = build({ store: first.store, sessionStorage });
  await second.controller.start();
  assert.equal(second.controller.getState().selectedCaseId, "case-v2");
  assert.equal(second.controller.getState().formSubstep, "about.address");
  assert.deepEqual(second.controller.getState().revealed, ["email"]);
  assert.deepEqual(second.controller.getState().visitedSubsteps, ["before.ready", "about.you"]);
  second.controller.stop();

  // A record for another case is not this case's; a stale 4b record and an id
  // the catalogue doesn't have are ignored (the latter lands on the first).
  const other = fakeSession({
    "vitally:client:v1:user-1": JSON.stringify({
      selectedCaseId: "case-v2",
      formSubstep: "old.gone",
      revealedAnswers: { caseId: "case-other", ids: ["email"] },
      visitedSteps: { caseId: "case-v2", steps: [3], revealed: ["email"] },
    }),
  });
  const third = build({ store: first.store, sessionStorage: other });
  await third.controller.start();
  assert.deepEqual(third.controller.getState().revealed, []);
  assert.equal(Object.hasOwn(third.controller.getState(), "visitedSteps"), false);
  assert.equal(third.controller.currentSubstep(), "before.ready");
  third.controller.stop();
});

test("a refusal that names a field is retried once without it", async () => {
  const refusal = (field) => Object.assign(new Error("refused"), { code: "VALIDATION", ...(field ? { field } : {}) });
  const once = await openV2();
  once.controller.editAnswers({ tp_first_name: "Mei", tp_dob: "1980-01-01" });
  once.store.refusals.push(refusal("tp_dob"));
  await once.controller.saveAnswers();
  assert.equal(once.store.writes.length, 2);
  assert.equal(once.store.writes[0].payload.answers.tp_dob, "1980-01-01");
  assert.equal(Object.hasOwn(once.store.writes[1].payload.answers, "tp_dob"), false);
  assert.equal(once.store.writes[1].payload.answers.tp_first_name, "Mei");
  assert.equal(once.store.writes[1].expectedRevision, once.store.writes[0].expectedRevision);
  assert.equal(once.controller.getState().saveState, "saved");
  once.controller.stop();

  const twice = await openV2();
  twice.controller.editAnswers({ tp_first_name: "Mei", tp_dob: "1980-01-01" });
  twice.store.refusals.push(refusal("tp_dob"), refusal("tp_first_name"), refusal("tp_first_name"));
  await assert.rejects(twice.controller.saveAnswers(), (error) => error.code === "VALIDATION");
  assert.equal(twice.store.writes.length, 2, "never a loop");
  assert.equal(twice.controller.getState().saveState, "failed");
  twice.controller.stop();

  const unnamed = await openV2();
  unnamed.controller.editAnswers({ tp_first_name: "Mei" });
  unnamed.store.refusals.push(refusal());
  await assert.rejects(unnamed.controller.saveAnswers(), (error) => error.code === "VALIDATION");
  assert.equal(unnamed.store.writes.length, 1);
  unnamed.controller.stop();
});

// ---------------------------------------------------------------------------
// Sub-steps, visits on the server, revisions that change no answers, card
// actions and the return to the summary (spec 2026-10-04 §3.1, §3.7, §3.8,
// §5.2, §6.3).
// ---------------------------------------------------------------------------

// Every before.* and about.you answer a Done mark needs, tp_phone from the
// contact record.
const BEFORE_AND_YOU = {
  service: "drop_off",
  language: "english",
  tp_first_name: "Mei",
  tp_last_name: "Chen",
  tp_dob: "1980-01-01",
  tp_job_title: "Cook",
};

test("a new case opens at before.ready, and a resumed one at its first unfinished sub-step", async () => {
  const fresh = await openV2();
  assert.equal(fresh.controller.getState().formSubstep, "before.ready");
  assert.equal(fresh.controller.currentSubstep(), "before.ready");
  assert.equal(fresh.controller.getState().returnToSummary, false);
  fresh.controller.stop();

  const resumed = await openV2({
    answers: BEFORE_AND_YOU,
    contact: { phone: "2155550199" },
    intakeVisited: ["before.ready", "before.service", "before.language", "before.virtual", "about.you"],
  });
  assert.equal(resumed.controller.getState().formSubstep, "about.address");
  assert.deepEqual(resumed.controller.getState().visitedSubsteps, [
    "before.ready",
    "before.service",
    "before.language",
    "before.virtual",
    "about.you",
  ]);
  resumed.controller.stop();
});

test("leaving a sub-step with nothing edited saves the visit once, with the answers unchanged", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  await controller.goToSubstep("before.service");
  assert.equal(store.writes.length, 1);
  assert.equal(store.writes[0].type, "SAVE_ANSWERS");
  assert.equal(store.writes[0].expectedRevision, 1);
  assert.deepEqual(store.writes[0].payload, { answers: { ...CONSENT_14446, tp_first_name: "Mei" }, visited: ["before.ready"] });
  assert.deepEqual(store.records.get("case-v2").intakeVisited, ["before.ready"]);
  assert.equal(controller.getState().dirty, false);
  assert.equal(controller.getState().formSubstep, "before.service");
  controller.stop();
});

test("revisiting already-visited sub-steps with nothing edited sends nothing", async () => {
  const { controller, store } = await openV2({
    answers: { tp_first_name: "Mei" },
    intakeVisited: ["before.ready", "before.service"],
  });
  assert.equal(controller.getState().formSubstep, "before.service");
  await controller.goToSubstep("before.ready");
  await controller.goToSubstep("before.service");
  assert.equal(store.writes.length, 0);
  assert.equal(controller.getState().dirty, false);
  assert.equal(controller.getState().formSubstep, "before.service");
  controller.stop();
});

test("a visited id the catalogue doesn't know is kept but never sent, and never makes the draft dirty", async () => {
  const { controller, store } = await openV2({
    answers: { tp_first_name: "Mei" },
    intakeVisited: ["old.gone"],
  });
  assert.equal(controller.getState().dirty, false);
  assert.ok(controller.getState().visitedSubsteps.includes("old.gone"));
  await controller.goToSubstep("before.service");
  assert.equal(store.writes.length, 1);
  assert.deepEqual(store.writes[0].payload.visited, ["before.ready"]);
  controller.editAnswers({ tp_first_name: "Ming" });
  await controller.saveAnswers();
  assert.deepEqual(store.writes[1].payload.visited, ["before.ready"]);
  controller.stop();
});

test("staff never send visits, and their visits never make the draft dirty", async () => {
  const store = v2Store({ answers: { tp_first_name: "Mei" } });
  const staffPrincipal = { userId: "user-9", workspaceId: "w1", access: "staff", personId: "person-admin" };
  store.getPrincipal = async () => staffPrincipal;
  store.listPeople = async () => [{ id: "person-admin", capabilities: ["admin"] }];
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-v2");
  await controller.goToSubstep("before.service");
  assert.equal(store.writes.length, 0);
  assert.equal(controller.getState().dirty, false);
  controller.editAnswers({ tp_first_name: "Ming" });
  await controller.saveAnswers();
  assert.equal(Object.hasOwn(store.writes[0].payload, "visited"), false);
  assert.equal(store.writes[0].personId, null);
  controller.stop();
});

test("on a submitted case, visits are never pending and a card mark sends only the card action", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" }, stage: "received" });
  await controller.goToSubstep("about.you");
  assert.ok(controller.getState().visitedSubsteps.includes("before.ready"), "a visit the server lacks");
  assert.equal(controller.getState().dirty, false);
  await controller.setDocumentCard("w2.household", "later");
  assert.deepEqual(
    store.writes.map((write) => write.type),
    ["SET_DOCUMENT_CARD"],
  );
  assert.deepEqual(store.writes[0].payload, { slotId: "w2.household", status: "later" });
  assert.equal(store.writes[0].expectedRevision, 1);
  assert.equal(store.writes[0].personId, null);
  assert.equal(controller.getState().savedCase.documentCards[0].status, "later");
  assert.equal(controller.getState().dirty, false);
  controller.stop();
});

test("two tabs: a submit elsewhere while only visits are unsaved takes the newer case, and a card mark goes through", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  store.failNext = offline();
  await controller.goToSubstep("before.service");
  assert.equal(controller.getState().dirty, true, "the visit is unsaved");
  // Tab B submits.
  await remoteChange(store, { stage: "received" });
  let state = controller.getState();
  assert.equal(state.conflict, null);
  assert.equal(state.savedCase.stage, "received");
  assert.equal(state.dirty, false);
  assert.equal(state.editBaseRevision, null);
  assert.deepEqual(state.visitedSubsteps, [], "the server's visits, the unsent one dropped");
  assert.equal(state.retryable, false, "the visits' envelope can no longer be sent");
  await controller.setDocumentCard("w2.household", "none");
  state = controller.getState();
  assert.deepEqual(
    store.writes.map((write) => write.type),
    ["SAVE_ANSWERS", "SET_DOCUMENT_CARD"],
  );
  assert.equal(store.writes[1].expectedRevision, 2);
  assert.equal(state.conflict, null);
  assert.equal(state.error, null);
  controller.stop();
});

test("§3.8 (a): a newer revision that changes no answers moves the pin and keeps the typing", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.editAnswers({ tp_first_name: "Ming" });
  assert.equal(controller.getState().editBaseRevision, 1);
  await remoteChange(store, {
    documentCards: [{ slotId: "w2.household", status: "later", groupOverride: null, changedAt: "2026-10-04T12:00:00Z" }],
  });
  const state = controller.getState();
  assert.equal(state.conflict, null);
  assert.equal(state.editBaseRevision, 2);
  assert.equal(state.dirty, true);
  assert.equal(state.saveState, "unsaved");
  assert.equal(state.draftAnswers.tp_first_name, "Ming");
  assert.equal(state.savedCase.documentCards.length, 1);
  await controller.saveAnswers();
  assert.equal(store.writes[0].expectedRevision, 2);
  assert.equal(controller.getState().saveState, "saved");
  assert.equal(store.records.get("case-v2").answers.tp_first_name, "Ming");
  controller.stop();
});

test("§3.8 (b): a newer revision that changes an answer while answers are unsaved is a conflict", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.editAnswers({ tp_first_name: "Ming" });
  await remoteChange(store, { answers: { tp_first_name: "Mei", addr_city: "Philadelphia" } });
  const state = controller.getState();
  assert.equal(state.conflict?.code, "REMOTE_CHANGED");
  assert.equal(state.conflict.baseRevision, 1);
  assert.equal(state.conflict.serverRevision, 2);
  assert.equal(state.editBaseRevision, 1);
  assert.equal(state.draftAnswers.tp_first_name, "Ming");
  assert.equal(Object.hasOwn(state.draftAnswers, "addr_city"), false);
  // A later answer-free revision does not clear a conflict already raised.
  await remoteChange(store, { documentCards: [{ slotId: "w2.household", status: "none", groupOverride: null }] });
  assert.equal(controller.getState().conflict?.code, "REMOTE_CHANGED");
  assert.equal(controller.getState().editBaseRevision, 1);
  controller.stop();
});

test("§3.8 (c): with only visits unsaved, a newer revision's answers are taken and the visits still sent", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  store.failNext = offline();
  await controller.goToSubstep("before.service");
  assert.equal(controller.getState().dirty, true);
  await remoteChange(store, { answers: { tp_first_name: "Mei", addr_city: "Philadelphia" } });
  let state = controller.getState();
  assert.equal(state.conflict, null);
  assert.equal(state.draftAnswers.addr_city, "Philadelphia");
  assert.deepEqual(state.visitedSubsteps, ["before.ready"]);
  assert.equal(state.editBaseRevision, 2);
  assert.equal(state.dirty, true);
  await controller.saveAnswers();
  const sent = store.writes.at(-1);
  assert.equal(sent.expectedRevision, 2);
  assert.deepEqual(sent.payload.visited, ["before.ready"]);
  assert.equal(sent.payload.answers.addr_city, "Philadelphia");
  state = controller.getState();
  assert.equal(state.saveState, "saved");
  assert.equal(state.dirty, false);
  assert.deepEqual(store.records.get("case-v2").intakeVisited, ["before.ready"]);
  controller.stop();
});

test("§3.8 (d): a stage change while answers are unsaved is handled as today", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.editAnswers({ tp_first_name: "Ming" });
  await remoteChange(store, { stage: "received" });
  const state = controller.getState();
  assert.equal(state.conflict?.code, "REMOTE_CHANGED");
  assert.equal(state.editBaseRevision, 1, "never re-pinned");
  assert.equal(state.savedCase.stage, "received");
  assert.equal(state.draftAnswers.tp_first_name, "Ming");
  controller.stop();
});

test("a card action saves a dirty draft first, and a failed save stops it", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.editAnswers({ tp_first_name: "Ming" });
  await controller.setDocumentCard("w2.household", "later");
  assert.deepEqual(
    store.writes.map((write) => [write.type, write.expectedRevision]),
    [
      ["SAVE_ANSWERS", 1],
      ["SET_DOCUMENT_CARD", 2],
    ],
  );
  assert.equal(controller.getState().conflict, null);
  assert.equal(controller.getState().dirty, false);
  controller.stop();

  const failing = await openV2({ answers: { tp_first_name: "Mei" } });
  failing.controller.editAnswers({ tp_first_name: "Ming" });
  failing.store.failNext = offline();
  assert.equal(await failing.controller.setDocumentCard("w2.household", "later"), null);
  assert.deepEqual(
    failing.store.writes.map((write) => write.type),
    ["SAVE_ANSWERS"],
  );
  assert.equal(failing.controller.getState().saveState, "failed");
  assert.equal(failing.controller.getState().error?.code, "OFFLINE");
  failing.controller.stop();
});

test("a card's group is moved through the same path", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" }, stage: "received" });
  await controller.setDocumentGroup("w2.household", "needed");
  assert.equal(store.writes.length, 1);
  assert.equal(store.writes[0].type, "SET_DOCUMENT_GROUP");
  assert.deepEqual(store.writes[0].payload, { slotId: "w2.household", group: "needed" });
  assert.equal(controller.getState().savedCase.documentCards[0].groupOverride, "needed");
  controller.stop();
});

test("a rail step collapses and expands in one change each", async () => {
  const { controller, renders } = await openV2({ answers: { tp_first_name: "Mei" } });
  await controller.goToSubstep("about.you");
  controller.togglePanel("rail-open:about");
  let before = renders.count;
  controller.setRailExpanded("about", false);
  assert.equal(renders.count, before + 1);
  let panels = controller.getState().openPanels;
  assert.ok(panels.includes("rail-shut:about"));
  assert.equal(panels.includes("rail-open:about"), false);
  before = renders.count;
  controller.setRailExpanded("about", true);
  assert.equal(renders.count, before + 1);
  panels = controller.getState().openPanels;
  assert.ok(panels.includes("rail-open:about"));
  assert.equal(panels.includes("rail-shut:about"), false);
  assert.equal(panels.filter((name) => name.endsWith(":about")).length, 1);
  controller.stop();
});

test("Expand all and Collapse all set every summary section in one change", async () => {
  const { controller, renders } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.togglePanel("rail-open:about");
  controller.togglePanel("summary-shut:about");
  let before = renders.count;
  controller.setSummaryShut(["about", "income", "documents"]);
  assert.equal(renders.count, before + 1);
  assert.deepEqual(controller.getState().openPanels, [
    "rail-open:about", "summary-shut:about", "summary-shut:income", "summary-shut:documents",
  ]);
  before = renders.count;
  controller.setSummaryShut([]);
  assert.equal(renders.count, before + 1);
  assert.deepEqual(controller.getState().openPanels, ["rail-open:about"]);
  controller.stop();
});

// A complete, valid draft: the sample's answers, with its contact fields in the
// case's contact record, where the server keeps them.
function completeV2() {
  const { tp_phone, sp_phone, best_contact_time, best_contact_note, ...answers } = makeSampleAnswers();
  return {
    answers,
    contact: {
      phone: tp_phone ?? null,
      spousePhone: sp_phone ?? null,
      bestContactTime: best_contact_time ?? null,
      bestContactNote: best_contact_note ?? null,
    },
  };
}

test("Change sets a return to the summary; Back to summary or a rail jump clears it", async () => {
  const { controller } = await openV2(completeV2());
  await controller.openForChange("about.address");
  assert.equal(controller.getState().formSubstep, "about.address");
  assert.equal(controller.getState().returnToSummary, true);
  await controller.backToSummary();
  assert.equal(controller.getState().formSubstep, "review.summary");
  assert.equal(controller.getState().returnToSummary, false);
  await controller.openForChange("about.address");
  await controller.goToSubstep("about.you");
  assert.equal(controller.getState().returnToSummary, false);
  await controller.openForChange("about.address");
  await controller.moveSubstep(1);
  assert.equal(controller.getState().returnToSummary, false);
  controller.stop();
});

test("moveSubstep goes to the next or previous visible sub-step and does nothing at either end", async () => {
  const { controller, store } = await openV2({ answers: { marital_status: "never_married" } });
  await controller.moveSubstep(-1);
  assert.equal(controller.getState().formSubstep, "before.ready");
  assert.equal(store.writes.length, 0, "nothing left, nothing visited");
  assert.deepEqual(controller.getState().visitedSubsteps, []);
  await controller.moveSubstep(1);
  assert.equal(controller.getState().formSubstep, "before.service");
  await controller.goToSubstep("about.marital");
  await controller.moveSubstep(1);
  assert.equal(controller.getState().formSubstep, "about.sign", "the hidden spouse sub-step is skipped");
  // With alerts the form ends at 9.1: Continue there goes nowhere and sends nothing.
  await controller.goToSubstep("review.submit");
  assert.equal(controller.getState().formSubstep, "review.check");
  const writes = store.writes.length;
  await controller.moveSubstep(1);
  assert.equal(controller.getState().formSubstep, "review.check");
  assert.equal(store.writes.length, writes);
  controller.stop();
});

test("the review gate: only Continue on 9.2 earns 9.3, and an alert sends 9.2 and 9.3 back to 9.1", async () => {
  const { controller, store } = await openV2(completeV2());
  assert.deepEqual(reviewAlerts(controller.getState().draftAnswers), []);
  await controller.goToSubstep("review.submit");
  assert.equal(controller.getState().formSubstep, "review.summary", "9.3 before Continue on 9.2");
  // Leaving 9.2 by a rail jump or a Change link earns nothing.
  await controller.goToSubstep("about.you");
  await controller.goToSubstep("review.summary");
  await controller.openForChange("about.address");
  await controller.backToSummary();
  assert.equal(controller.getState().formSubstep, "review.summary");
  assert.equal(controller.getState().visitedSubsteps.includes("review.submit"), false);
  // Continue does, and the move's save sends the visit.
  await controller.moveSubstep(1);
  assert.equal(controller.getState().formSubstep, "review.submit");
  assert.ok(controller.getState().visitedSubsteps.includes("review.submit"));
  assert.ok(store.records.get("case-v2").intakeVisited.includes("review.submit"), "the earned visit was not saved");
  // An alert: 9.3 resolves to 9.1, and Continue there does nothing.
  controller.editAnswers({ addr_city: null });
  assert.equal(controller.currentSubstep(), "review.check");
  const writes = store.writes.length;
  await controller.moveSubstep(1);
  assert.equal(controller.currentSubstep(), "review.check");
  assert.equal(store.writes.length, writes, "a blocked Continue sent something");
  // "Back to summary" lands on 9.1 too.
  await controller.backToSummary();
  assert.equal(controller.currentSubstep(), "review.check");
  // The fix brings both back: 9.3 without another Continue.
  controller.editAnswers({ addr_city: "Philadelphia" });
  await controller.goToSubstep("review.submit");
  assert.equal(controller.currentSubstep(), "review.submit");
  controller.stop();
});

test("Continue moves from where the form is shown: a stored review.submit with no visit shows 9.2, and Continue earns 9.3", async () => {
  // The first window earns 9.3, which leaves review.submit in its window state.
  const shared = fakeSession();
  const first = await openV2({ ...completeV2(), sessionStorage: shared });
  await first.controller.goToSubstep("review.summary");
  await first.controller.moveSubstep(1);
  assert.equal(first.controller.getState().formSubstep, "review.submit");
  first.controller.stop();
  // A reload whose record lacks the visit (the Continue's save never landed):
  // the window state still says review.submit.
  const { controller, store } = await openV2({ ...completeV2(), sessionStorage: shared });
  assert.equal(controller.getState().formSubstep, "review.submit");
  assert.equal(controller.getState().visitedSubsteps.includes("review.submit"), false);
  assert.equal(controller.currentSubstep(), "review.summary");
  await controller.moveSubstep(1);
  assert.equal(controller.currentSubstep(), "review.submit");
  assert.equal(controller.getState().formSubstep, "review.submit");
  assert.ok(controller.getState().visitedSubsteps.includes("review.submit"));
  assert.ok(store.records.get("case-v2").intakeVisited.includes("review.submit"), "the earned visit was not saved");
  controller.stop();
});

test("guardSubmit: a Submit pressed on a stale page with an alert reveals it and goes to 9.1, sending nothing", async () => {
  const { controller, store } = await openV2(completeV2());
  await controller.goToSubstep("review.summary");
  await controller.moveSubstep(1);
  controller.togglePanel("confirmed");
  assert.equal(controller.currentSubstep(), "review.submit");
  // A clean draft passes, and the guard moves nothing.
  assert.equal(await controller.guardSubmit(), true);
  assert.equal(controller.currentSubstep(), "review.submit");
  // A missing answer alone is refused too: the guard checks the review alerts, not only invalid answers.
  controller.editAnswers({ addr_city: null });
  assert.equal(await controller.guardSubmit(), false);
  assert.equal(controller.getState().formSubstep, "review.check");
  controller.editAnswers({ addr_city: "Philadelphia" });
  await controller.goToSubstep("review.submit");
  assert.equal(controller.currentSubstep(), "review.submit");
  // The draft changes under a page already drawn: an invalid email and no city.
  controller.editAnswers({ email: "a@", addr_city: null });
  assert.equal(await controller.guardSubmit(), false);
  assert.equal(controller.getState().formSubstep, "review.check");
  assert.ok(controller.getState().revealed.includes("email"), "the invalid email was not revealed");
  const record = store.records.get("case-v2");
  assert.equal(record.stage, "draft", "the guard submitted");
  assert.notEqual(record.answers.email, "a@", "an invalid email reached the server");
  controller.stop();
});

test("currentSubstep resolves a place the draft has hidden to the next visible one", async () => {
  const { controller } = await openV2({ answers: { marital_status: "married" } });
  await controller.goToSubstep("about.spouse");
  assert.equal(controller.currentSubstep(), "about.spouse");
  controller.editAnswers({ marital_status: "never_married" });
  assert.equal(controller.getState().formSubstep, "about.spouse");
  assert.equal(controller.currentSubstep(), "about.sign");
  controller.stop();
});

test("an undo after a failed save stays Not saved, keeps its pin, and the next save sends the undone value", async () => {
  // An edit, a failed save, an undo.
  const edited = await savedV2();
  edited.controller.editAnswers({ tp_first_name: "Ming" });
  edited.store.failNext = offline();
  await assert.rejects(edited.controller.saveAnswers());
  edited.controller.editAnswers({ tp_first_name: "Mei" });
  assert.match(chip(edited.controller), /^Not saved\./);
  assert.equal(edited.controller.getState().dirty, true);
  await edited.controller.saveAnswers();
  assert.equal(edited.store.writes.at(-1).payload.answers.tp_first_name, "Mei");
  edited.controller.stop();

  // A failed clean save, then an edit and its undo: the failed save may have
  // landed, so the undo goes back to Not saved, not to Saved.
  const clean = await savedV2();
  clean.store.failNext = offline();
  await assert.rejects(clean.controller.saveAnswers());
  assert.equal(clean.controller.getState().dirty, false);
  clean.controller.editAnswers({ tp_first_name: "Ming" });
  assert.equal(clean.controller.getState().saveState, "unsaved");
  assert.equal(clean.controller.getState().editBaseRevision, 2);
  clean.controller.editAnswers({ tp_first_name: "Mei" });
  let state = clean.controller.getState();
  assert.equal(state.saveState, "failed");
  assert.equal(state.dirty, true);
  assert.equal(state.editBaseRevision, 2);
  assert.equal(state.retryable, false);
  assert.match(chip(clean.controller), /^Not saved\./);
  await clean.controller.saveAnswers();
  const sent = clean.store.writes.at(-1);
  assert.equal(sent.payload.answers.tp_first_name, "Mei");
  assert.equal(sent.expectedRevision, 2);
  state = clean.controller.getState();
  assert.equal(state.saveState, "saved");
  assert.equal(state.dirty, false);
  clean.controller.stop();
});

test("reconciling to the server's own answers leaves the form not dirty", async () => {
  const { controller, store } = await savedV2();
  controller.editAnswers({ tp_first_name: "Ming" });
  await remoteChange(store, { answers: { ...store.records.get("case-v2").answers, tp_last_name: "Wang" } });
  assert.equal(controller.getState().conflict?.code, "REMOTE_CHANGED");
  await controller.reconcileAnswers({ answers: {}, expectedServerRevision: 3, fromServer: true });
  let state = controller.getState();
  assert.equal(state.draftAnswers.tp_last_name, "Wang");
  assert.equal(state.draftAnswers.tp_first_name, "Mei");
  assert.equal(state.dirty, false);
  assert.equal(state.editBaseRevision, null);
  assert.equal(state.conflict, null);
  assert.equal(state.saveState, "saved");
  assert.equal(chip(controller), "Saved");

  // Keeping one's own edits is still a change to save, pinned at the newest.
  controller.editAnswers({ tp_first_name: "Ming" });
  await remoteChange(store, { answers: { ...store.records.get("case-v2").answers, tp_last_name: "Lee" } });
  await controller.reconcileAnswers({
    answers: controller.getState().draftAnswers,
    expectedServerRevision: 4,
  });
  state = controller.getState();
  assert.equal(state.dirty, true);
  assert.equal(state.editBaseRevision, 4);
  assert.equal(state.saveState, "unsaved");
  controller.stop();
});

test("every household member in the draft has a member id", async () => {
  const { controller, store } = await openV2({
    answers: { has_household_members: "yes", hh: [{ first_name: "Bo" }] },
  });
  // From the server: an id is given, and the same one survives a refresh.
  const fromServer = controller.getState().draftAnswers.hh[0].member_id;
  assert.ok(isMemberId(fromServer));
  await remoteChange(store, { answers: { has_household_members: "yes", hh: [{ first_name: "Bo" }], addr_city: "Philadelphia" } });
  assert.equal(controller.getState().draftAnswers.hh[0].member_id, fromServer);

  // An edit: a new member, an invalid id and a shared id all get their own.
  controller.editAnswers({
    hh: [
      { member_id: fromServer, first_name: "Bo" },
      { first_name: "A" },
      { member_id: "x", first_name: "C" },
      { member_id: fromServer, first_name: "D" },
    ],
  });
  const members = controller.getState().draftAnswers.hh;
  assert.equal(members[0].member_id, fromServer);
  assert.ok(members.every((member) => isMemberId(member.member_id)));
  assert.equal(new Set(members.map((member) => member.member_id)).size, 4);
  const ids = members.map((member) => member.member_id);
  controller.editAnswers({ tp_first_name: "Mei" });
  assert.deepEqual(controller.getState().draftAnswers.hh.map((member) => member.member_id), ids, "stable across edits");
  await controller.saveAnswers();
  assert.deepEqual(store.writes.at(-1).payload.answers.hh.map((member) => member.member_id), ids, "the household is sent, not withheld");
  controller.stop();

  const simple = await openV2();
  simple.controller.editAnswers({ hh: [{ first_name: "A" }] });
  assert.ok(isMemberId(simple.controller.getState().draftAnswers.hh[0].member_id));
  simple.controller.stop();
});

// The household's controls as the page renders them, read back the way
// `readForm` (empty cards dropped) and `readField` (kept) read the DOM: each
// <input data-control> as a descriptor, the hidden member id included.
function householdControls(members) {
  const html = renderQuestion(findQuestion(2, "hh"), members, { answers: { has_household_members: "yes", hh: members } });
  return [...html.matchAll(/<input\b[^>]*\bdata-control\b[^>]*>/g)].map(([tag]) => {
    const attr = (name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
    const descriptor = { q: attr("data-q"), type: attr("type"), value: attr("value") ?? "", checked: /\schecked\b/.test(tag) };
    if (attr("data-member") !== undefined) descriptor.member = Number(attr("data-member"));
    if (attr("data-sub") !== undefined) descriptor.sub = attr("data-sub");
    if (attr("data-date-part") !== undefined) descriptor.part = attr("data-date-part");
    return descriptor;
  });
}

// Task 2 of cleanup-v2-correctness, "not reproduced": `withMemberIds` gives an
// id-less member the id the previous draft had at the same index, so a card
// mark (`ssn.hh.<id>`) would move to whoever arrived there. No path in the app
// produces an id-less member at a shifted index; this pins each one: the mark
// on An's card stays on An or on nobody, never on another person.
// The page's fictional details (app.mjs `fictional` and the office's
// `fillAssistedIntake`): the seed starts again at 1 on every page load and the
// sample's member id is fixed by the seed. After a remove and a reload, a fill
// must not bring back a removed person's id, or the regenerated person takes
// over that person's card marks.
test("fictional details after a reload never reuse a removed member's id or inherit its card marks", async () => {
  for (const replaceEverything of [false, true]) {
    const store = v2Store({ answers: { tp_first_name: "Mei" } });
    const sessionStorage = fakeSession();
    const page = async () => {
      const built = build({ store, sessionStorage });
      await built.controller.start();
      await built.controller.selectCase("case-v2");
      return built.controller;
    };
    const fill = (controller) => {
      const draft = controller.getState().draftAnswers;
      const sample = makeSampleAnswers({ seed: 1, married: draft.marital_status === "married" });
      controller.editAnswers(fictionalAnswers(draft, sample, { replaceEverything }));
    };
    const laterOnHousehold = (controller) =>
      cardsFor(controller.getState().draftAnswers, controller.getState().savedCase.documentCards).filter(
        (card) => card.ruleId === "ssn" && card.owner.startsWith("hh.") && card.status === "later",
      );

    let controller = await page();
    fill(controller);
    await controller.saveAnswers();
    const first = controller.getState().draftAnswers.hh[0].member_id;
    await controller.setDocumentCard(`ssn.hh.${first}`, "later");
    assert.equal(laterOnHousehold(controller).length, 1);
    controller.removeMember(0);
    await controller.saveAnswers();
    assert.equal(controller.getState().draftAnswers.hh, null);
    controller.stop();

    // A reload: the page's seed starts again.
    controller = await page();
    fill(controller);
    const again = controller.getState().draftAnswers.hh[0].member_id;
    assert.ok(isMemberId(again));
    assert.notEqual(again, first, `replaceEverything ${replaceEverything}: the removed person's id came back`);
    assert.deepEqual(laterOnHousehold(controller), [], "the new person starts with no marks");
    controller.stop();
  }
});

// The fill gives generated members fresh ids; members already in the draft
// keep theirs, and the sample's own ids stay fixed by the seed.
test("fictional details give generated household members fresh ids and leave the draft's own alone", () => {
  const sample = makeSampleAnswers({ seed: 1 });
  const fixed = sample.hh[0].member_id;
  const fresh = ["000000000000000000000000000000f1", "000000000000000000000000000000f2"];
  const newId = () => fresh.shift();
  assert.equal(fictionalAnswers({}, sample, { newId }).hh[0].member_id, "000000000000000000000000000000f1");
  assert.equal(fictionalAnswers({ tp_first_name: "Mei" }, sample, { replaceEverything: true, newId }).hh[0].member_id, "000000000000000000000000000000f2");
  assert.equal(sample.hh[0].member_id, fixed, "the sample is never changed in place");
  assert.equal(makeSampleAnswers({ seed: 1 }).hh[0].member_id, fixed, "still fixed by the seed");
  const own = [{ member_id: "000000000000000000000000000000a1", first_name: "An" }];
  assert.equal(fictionalAnswers({ hh: own }, sample, { newId: () => assert.fail("no id for a kept household") }).hh, own);
});

test("a household member's card mark stays with that person on every path that changes the household", async () => {
  const A = "000000000000000000000000000000a1";
  const B = "000000000000000000000000000000b2";
  const household = [
    { member_id: A, first_name: "An", last_name: "Lee" },
    { member_id: B, first_name: "Bo", last_name: "Lee" },
  ];
  const documentCards = [{ slotId: `ssn.hh.${A}`, status: "later", groupOverride: null, changedAt: "2026-10-04T12:00:00Z" }];
  const marked = (controller) =>
    cardsFor(controller.getState().draftAnswers, documentCards)
      .filter((card) => card.ruleId === "ssn" && card.status === "later")
      .map((card) => card.ownerLine.en);
  const ids = (controller) => controller.getState().draftAnswers.hh?.map((member) => member.member_id) ?? null;
  const open = () => openV2({ answers: { has_household_members: "yes", hh: household }, documentCards });

  // Opening: the server's ids are the draft's.
  let { controller, store, sessionStorage } = await open();
  assert.deepEqual(ids(controller), [A, B]);
  assert.deepEqual(marked(controller), ["An Lee"]);

  // The form read: every rendered card carries its hidden id, so An's emptied
  // card is dropped (readForm) and Bo arrives at index 0 with Bo's own id.
  const emptied = householdControls([{ member_id: A }, household[1]]);
  assert.equal(emptied.filter((d) => d.sub === "member_id").length, 2, "one hidden id per card");
  const read = valuesFromControls(emptied);
  assert.deepEqual(read.hh.map((member) => member.member_id), [B]);
  controller.editAnswers(read);
  assert.deepEqual(ids(controller), [B]);
  assert.deepEqual(marked(controller), []);
  // readField keeps the empty card, id and all.
  controller.editAnswers(valuesFromControls(householdControls(household), { keepEmptyMembers: true }));
  assert.deepEqual(ids(controller), [A, B]);
  assert.deepEqual(marked(controller), ["An Lee"]);
  controller.stop();

  // Remove, then add (the page's add: a fresh id): nobody inherits An's.
  ({ controller } = await open());
  controller.removeMember(0);
  assert.deepEqual(ids(controller), [B]);
  controller.editAnswers({ hh: [...controller.getState().draftAnswers.hh, { member_id: newMemberId() }] });
  assert.equal(ids(controller)[0], B);
  assert.ok(isMemberId(ids(controller)[1]) && ![A, B].includes(ids(controller)[1]));
  assert.deepEqual(marked(controller), []);
  controller.stop();

  // Fictional details, as the controller sees them: filling the blanks keeps
  // the household and its marks; replacing everything puts in the example's
  // member, a different person with no marks. (The page's fresh ids for
  // generated members are pinned in the fictionalAnswers test above.)
  ({ controller } = await open());
  const generated = makeSampleAnswers({ seed: 1 });
  controller.editAnswers(fillBlankAnswers(controller.getState().draftAnswers, generated));
  assert.deepEqual(ids(controller), [A, B]);
  controller.editAnswers({ ...generated });
  assert.deepEqual(ids(controller), [generated.hh[0].member_id]);
  assert.ok(![A, B].includes(generated.hh[0].member_id));
  assert.deepEqual(marked(controller), []);
  controller.stop();

  // Reconcile: the office's side comes with the server's ids; one's own side
  // with the draft's.
  ({ controller, store } = await open());
  controller.editAnswers({ tp_first_name: "Mei" });
  await remoteChange(store, { answers: { has_household_members: "yes", hh: [household[1]] } });
  assert.equal(controller.getState().conflict?.code, "REMOTE_CHANGED");
  await controller.reconcileAnswers({ answers: {}, expectedServerRevision: store.records.get("case-v2").revision, fromServer: true });
  assert.deepEqual(ids(controller), [B]);
  assert.deepEqual(marked(controller), []);
  controller.editAnswers({ tp_first_name: "Mei", hh: household });
  await remoteChange(store, { answers: { has_household_members: "yes", hh: [household[1]], tp_first_name: "Lan" } });
  await controller.reconcileAnswers({
    answers: controller.getState().draftAnswers,
    expectedServerRevision: store.records.get("case-v2").revision,
  });
  assert.deepEqual(ids(controller), [A, B]);
  assert.deepEqual(marked(controller), ["An Lee"]);
  controller.stop();

  // Restoring a session: no answer is kept in the window, so the draft is the
  // server's again, ids and all.
  ({ controller, store, sessionStorage } = await open());
  controller.removeMember(0);
  controller.stop();
  for (const key of sessionStorage.keys()) assert.ok(!sessionStorage.raw(key).includes(B), key);
  const restored = build({ store, sessionStorage });
  await restored.controller.start();
  await restored.controller.selectCase("case-v2");
  assert.deepEqual(ids(restored.controller), [A, B]);
  assert.deepEqual(marked(restored.controller), ["An Lee"]);
  restored.controller.stop();
});

test("§3.8: after a failed save of an answer and its undo, a newer revision's answers are a choice, not taken", async () => {
  // The failed save may have landed: the newer revision may be that very
  // edit, which the person undid. Taking it silently would bring it back.
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.editAnswers({ tp_first_name: "Ming" });
  store.failNext = offline();
  await controller.goToSubstep("before.service");
  controller.editAnswers({ tp_first_name: "Mei" });
  assert.equal(controller.getState().dirty, true);
  await remoteChange(store, { answers: { tp_first_name: "Ming" } });
  const state = controller.getState();
  assert.equal(state.conflict?.code, "REMOTE_CHANGED");
  assert.equal(state.draftAnswers.tp_first_name, "Mei");
  controller.stop();
});

test("a card mark and a sub-step change share one save at a time", async () => {
  // A mark during a sub-step change's save is ignored: no second save.
  const first = await openV2({ answers: { tp_first_name: "Mei" } });
  first.controller.editAnswers({ tp_first_name: "Ming" });
  let release = holdSaves(first.store);
  const moving = first.controller.goToSubstep("before.service");
  const marking = first.controller.setDocumentCard("w2.household", "later");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(first.store.actCalls, 1, "one SAVE_ANSWERS only");
  release();
  const [, marked] = await Promise.all([moving, marking]);
  assert.equal(marked, null);
  assert.deepEqual(first.store.writes.map((write) => write.type), ["SAVE_ANSWERS"]);
  assert.equal(first.controller.getState().formSubstep, "before.service");
  assert.equal(first.controller.getState().conflict, null);
  assert.equal(first.controller.getState().error, null);
  first.controller.stop();

  // A sub-step change during a mark's pre-save is ignored the same way.
  const second = await openV2({ answers: { tp_first_name: "Mei" } });
  second.controller.editAnswers({ tp_first_name: "Ming" });
  release = holdSaves(second.store);
  const marking2 = second.controller.setDocumentCard("w2.household", "later");
  const moving2 = second.controller.goToSubstep("about.you");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(second.store.actCalls, 1, "one SAVE_ANSWERS only");
  release();
  await Promise.all([marking2, moving2]);
  assert.deepEqual(
    second.store.writes.map((write) => [write.type, write.expectedRevision]),
    [
      ["SAVE_ANSWERS", 1],
      ["SET_DOCUMENT_CARD", 2],
    ],
  );
  assert.equal(second.controller.getState().formSubstep, "before.ready");
  assert.equal(second.controller.getState().conflict, null);
  assert.equal(second.controller.getState().error, null);
  second.controller.stop();
});

// A card mark is one action at a time from send to answer, not only during its
// pre-save: a second mark, or a sub-step change, sent while the first mark is
// in flight would carry the same expected revision and meet a false conflict.
test("a second card mark while the first is in flight is ignored, so no false conflict", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  assert.equal(controller.getState().dirty, false, "no pre-save: the mark goes straight out");
  const release = holdSaves(store);
  const first = controller.setDocumentCard("w2.household", "later");
  const second = controller.setDocumentCard("photo_id.tp", "none");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.actCalls, 1, "one SET_DOCUMENT_CARD only");
  release();
  const [marked, ignored] = await Promise.allSettled([first, second]);
  assert.equal(marked.status, "fulfilled");
  assert.deepEqual(ignored, { status: "fulfilled", value: null });
  assert.deepEqual(
    store.writes.map((write) => [write.type, write.payload.slotId, write.expectedRevision]),
    [["SET_DOCUMENT_CARD", "w2.household", 1]],
  );
  const state = controller.getState();
  assert.equal(state.conflict, null);
  assert.equal(state.error, null);
  assert.equal(state.savedCase.documentCards[0].status, "later");
  // Once it has landed, the next mark goes through with the new revision.
  await controller.setDocumentCard("photo_id.tp", "none");
  assert.deepEqual(store.writes.at(-1).expectedRevision, 2);
  assert.equal(controller.getState().error, null);
  controller.stop();
});

test("a sub-step change or a Change link while a card mark is in flight is ignored, so no false conflict", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  const release = holdSaves(store);
  const marking = controller.setDocumentCard("w2.household", "later");
  const moving = controller.goToSubstep("before.service");
  const continuing = controller.moveSubstep(1);
  const changing = controller.openForChange("about.you");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.actCalls, 1, "no visit save beside the mark");
  release();
  const results = await Promise.allSettled([marking, moving, continuing, changing]);
  assert.deepEqual(results.map((result) => result.status), ["fulfilled", "fulfilled", "fulfilled", "fulfilled"]);
  assert.deepEqual(store.writes.map((write) => write.type), ["SET_DOCUMENT_CARD"]);
  const state = controller.getState();
  assert.equal(state.formSubstep, "before.ready", "the page stays where it was");
  assert.equal(state.returnToSummary, false);
  assert.deepEqual(state.visitedSubsteps, [], "an ignored move records no visit");
  assert.equal(state.dirty, false);
  assert.notEqual(state.saveState, "failed");
  assert.equal(state.conflict, null);
  assert.equal(state.error, null);
  // Once the mark has landed, the move goes through on the new revision.
  await controller.goToSubstep("before.service");
  assert.deepEqual(
    store.writes.map((write) => [write.type, write.expectedRevision]),
    [
      ["SET_DOCUMENT_CARD", 1],
      ["SAVE_ANSWERS", 2],
    ],
  );
  assert.equal(controller.getState().formSubstep, "before.service");
  assert.equal(controller.getState().error, null);
  controller.stop();
});

// ---------------------------------------------------------------------------
// The version-2 Add a case: a new office draft (spec 2026-10-04 §10)
// ---------------------------------------------------------------------------

// The office on a version-2 workspace. The server creates a case of the
// workspace's version with no owner, no contact, no visits and no card rows.
// `case-v2` is an owner-less version-2 office draft already saved.
function officeV2(options = {}) {
  const store = v2Store({
    principal: { userId: "p1", workspaceId: "w1", access: "staff", personId: "sam" },
    people: [{ id: "sam", name: "Sam", capabilities: ["admin", "assist", "followup"] }],
    workspace: { id: "w1", defaultFollowupPersonId: "sam", defaultIntakeVersion: 2 },
    ...options,
  });
  store.records.set("case-v2", { ...store.records.get("case-v2"), ownerUserId: null });
  const create = store.createCase;
  store.createCase = async (request) => {
    await store.createGate;
    const receipt = await create(request);
    const record = store.records.get(receipt.caseId);
    if (record.intakeVersion === undefined)
      store.records.set(receipt.caseId, {
        ...record,
        intakeVersion: store.workspace.defaultIntakeVersion,
        ownerUserId: null,
        contact: null,
        intakeVisited: [],
        documentCards: [],
      });
    return receipt;
  };
  // Reads to refuse, one per case id, before anything is returned.
  store.getFailures = new Map();
  const get = store.getCase;
  store.getCase = async (id) => {
    const failure = store.getFailures.get(id);
    if (failure) {
      store.getFailures.delete(id);
      store.calls.push(`getCase:${id}`);
      throw failure;
    }
    return get(id);
  };
  return store;
}

// Holds every create until `release()`.
function holdCreates(store) {
  let release;
  store.createGate = new Promise((resolve) => {
    release = resolve;
  });
  return () => release();
}

async function startOffice(options = {}) {
  const store = officeV2(options);
  let next = 0;
  const built = build({
    store,
    sessionStorage: options.sessionStorage,
    newActionId: () => `action-${(next += 1)}`,
  });
  await built.controller.start();
  return { store, ...built };
}

const writesOf = (store, type) => store.writes.filter((write) => (write.type ?? "createCase") === type);
const creates = (store) => store.writes.filter((write) => write.mode !== undefined);

test("Add a case on a version-2 workspace starts a new office draft that takes version-2 answers", async () => {
  const { controller } = await startOffice();
  await controller.openAddCase();
  let state = controller.getState();
  assert.equal(state.officeDraft, true);
  assert.equal(state.savedCase, null);
  assert.equal(state.selectedCaseId, null);
  assert.equal(state.screen, "office-add-case");
  assert.deepEqual(state.openAddSubsteps, ["before.ready"]);
  assert.equal(state.addCaseShowMissing, false);
  assert.equal(state.dirty, false);
  assert.equal(state.saveState, "idle");
  assert.deepEqual(state.revealed, []);
  controller.editAnswers({ tp_first_name: "Mei" });
  state = controller.getState();
  assert.equal(state.draftAnswers.tp_first_name, "Mei", "the version-2 key is kept");
  assert.equal(state.dirty, true, "anything typed is something to send");
  controller.editAnswers({ hh: [{ first_name: "A" }] });
  assert.ok(isMemberId(controller.getState().draftAnswers.hh[0].member_id));
  controller.stop();
});

test("the first Save draft creates one empty case, adopts it in place and saves without visits", async () => {
  const { controller, store } = await startOffice();
  await controller.openAddCase();
  controller.editAnswers({ tp_first_name: "Mei", email: "not-an-email" });
  const draft = controller.getState().draftAnswers;
  assert.deepEqual(await controller.saveOfficeDraft(), { sent: false });
  assert.deepEqual(creates(store), [
    { actionId: "action-1", mode: "assisted", personId: null, answers: {} },
  ]);
  const saves = writesOf(store, "SAVE_ANSWERS");
  assert.equal(saves.length, 1);
  assert.equal(saves[0].caseId, "case-2");
  assert.equal(saves[0].personId, null);
  assert.deepEqual(saves[0].payload.answers, withholdInvalid(draft, 2));
  assert.equal(Object.hasOwn(saves[0].payload, "visited"), false, "the office never sends visits");
  const state = controller.getState();
  assert.equal(state.officeDraft, false);
  assert.equal(state.officeDraftCaseId, null);
  assert.equal(state.savedCase.id, "case-2");
  assert.equal(state.selectedCaseId, "case-2");
  assert.equal(state.screen, "office-add-case");
  assert.equal(state.dirty, false);
  assert.equal(state.saveState, "saved");
  assert.equal(state.officeSaving, false);
  assert.equal(state.draftAnswers.email, "not-an-email", "the invalid value stays in the draft");
  controller.stop();
});

test("a save that fails after the create keeps the draft and the case, and never creates twice", async () => {
  const { controller, store } = await startOffice();
  await controller.openAddCase();
  controller.editAnswers({ tp_first_name: "Mei" });
  store.refusals.push(offline());
  await assert.rejects(controller.saveOfficeDraft(), { code: "OFFLINE" });
  let state = controller.getState();
  assert.equal(state.draftAnswers.tp_first_name, "Mei");
  assert.equal(state.selectedCaseId, "case-2");
  assert.equal(state.savedCase.id, "case-2");
  assert.equal(state.saveState, "failed");
  assert.equal(state.officeSaving, false);
  assert.equal(state.error.code, "OFFLINE");
  await controller.saveOfficeDraft();
  assert.equal(creates(store).length, 1, "no second case");
  assert.equal(writesOf(store, "SAVE_ANSWERS").length, 2, "one more save");
  state = controller.getState();
  assert.equal(state.saveState, "saved");
  assert.equal(store.records.get("case-2").answers.tp_first_name, "Mei");
  controller.stop();
});

test("a create with an unknown outcome is retried with the same action id", async () => {
  const { controller, store } = await startOffice();
  await controller.openAddCase();
  controller.editAnswers({ tp_first_name: "Mei" });
  store.failNext = offline();
  await assert.rejects(controller.saveOfficeDraft(), { code: "OFFLINE" });
  let state = controller.getState();
  assert.equal(state.officeDraft, true);
  assert.equal(state.savedCase, null);
  assert.equal(state.draftAnswers.tp_first_name, "Mei");
  await controller.saveOfficeDraft();
  assert.deepEqual(creates(store).map((write) => write.actionId), ["action-1", "action-1"]);
  state = controller.getState();
  assert.equal(state.savedCase.id, "case-2");
  assert.equal(writesOf(store, "SAVE_ANSWERS").length, 1);
  controller.stop();
});

test("a create that lands but whose case can't be read is used again, not created again", async () => {
  const { controller, store } = await startOffice();
  await controller.openAddCase();
  controller.editAnswers({ tp_first_name: "Mei" });
  store.getFailures.set("case-2", offline());
  await assert.rejects(controller.saveOfficeDraft(), { code: "OFFLINE" });
  let state = controller.getState();
  assert.equal(state.officeDraftCaseId, "case-2");
  assert.equal(state.officeDraft, true);
  assert.equal(state.savedCase, null);
  assert.equal(state.draftAnswers.tp_first_name, "Mei");
  assert.equal(state.error.code, "OFFLINE");
  assert.equal(writesOf(store, "SAVE_ANSWERS").length, 0);
  await controller.saveOfficeDraft();
  assert.equal(creates(store).length, 1, "no second case");
  assert.equal(writesOf(store, "SAVE_ANSWERS").length, 1);
  state = controller.getState();
  assert.equal(state.officeDraftCaseId, null);
  assert.equal(state.savedCase.id, "case-2");
  controller.stop();
});

test("what the office types while the case is being created is kept and saved", async () => {
  const { controller, store } = await startOffice();
  await controller.openAddCase();
  controller.editAnswers({ tp_first_name: "Mei" });
  const release = holdCreates(store);
  const saving = controller.saveOfficeDraft();
  await new Promise((resolve) => setImmediate(resolve));
  controller.editAnswers({ addr_city: "Camden" });
  release();
  await saving;
  const [save] = writesOf(store, "SAVE_ANSWERS");
  assert.equal(save.payload.answers.tp_first_name, "Mei");
  assert.equal(save.payload.answers.addr_city, "Camden");
  assert.equal(controller.getState().draftAnswers.addr_city, "Camden");
  assert.equal(controller.getState().dirty, false);
  controller.stop();
});

test("adopting the new case resets nothing on the page", async () => {
  const { controller } = await startOffice();
  await controller.openAddCase();
  controller.editAnswers({ tp_first_name: "Mei", email: "not-an-email" });
  controller.revealInvalid("email");
  controller.toggleAddSubstep("about.address");
  controller.togglePanel("confirmed");
  await controller.saveOfficeDraft();
  const state = controller.getState();
  assert.equal(state.savedCase.id, "case-2");
  assert.deepEqual(state.revealed, ["email"]);
  assert.deepEqual(state.openAddSubsteps, ["before.ready", "about.address"]);
  assert.ok(state.openPanels.includes("confirmed"));
  assert.equal(state.addCaseShowMissing, false);
  controller.stop();
});

test("one save at a time: a second press, or a card mark, during a Save draft does nothing", async () => {
  const { controller, store } = await startOffice();
  await controller.openAddCase();
  controller.editAnswers({ tp_first_name: "Mei" });
  const release = holdCreates(store);
  const first = controller.saveOfficeDraft();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.getState().officeSaving, true);
  assert.deepEqual(await controller.saveOfficeDraft({ send: true }), { sent: false, reason: "busy" });
  assert.deepEqual(await controller.saveOfficeDraft(), { sent: false, reason: "busy" });
  assert.equal(await controller.setDocumentCard("w2.household", "later"), null);
  release();
  await first;
  assert.equal(creates(store).length, 1);
  assert.equal(writesOf(store, "SET_DOCUMENT_CARD").length, 0);
  assert.equal(controller.getState().officeSaving, false);
  // Once it has landed, a mark goes through on the saved case.
  await controller.setDocumentCard("w2.household", "later");
  assert.equal(writesOf(store, "SET_DOCUMENT_CARD").length, 1);
  controller.stop();
});

test("a new office draft never outlives the page, and starts again on a reload or when the workspace arrives", async () => {
  // Leaving resets it.
  const left = await startOffice();
  await left.controller.openAddCase();
  left.controller.editAnswers({ tp_first_name: "Mei" });
  left.controller.navigate("staff");
  let state = left.controller.getState();
  assert.equal(state.officeDraft, false);
  assert.equal(state.officeDraftCaseId, null);
  assert.equal(state.addCaseShowMissing, false);
  left.controller.stop();

  // A reload on Add a case with no case starts a new draft.
  const sessionStorage = fakeSession();
  const first = await startOffice({ sessionStorage });
  await first.controller.openAddCase();
  first.controller.stop();
  const again = await startOffice({ sessionStorage });
  state = again.controller.getState();
  assert.equal(state.screen, "office-add-case");
  assert.equal(state.officeDraft, true);
  assert.deepEqual(state.openAddSubsteps, ["before.ready"]);

  // A realtime workspace change doesn't wipe what is being typed.
  again.controller.editAnswers({ tp_first_name: "Mei" });
  again.store.workspace = { ...again.store.workspace, defaultFollowupPersonId: "person-lee" };
  await again.store.handlers.onChange({ table: "workspaces" });
  state = again.controller.getState();
  assert.equal(state.workspace.defaultFollowupPersonId, "person-lee");
  assert.equal(state.officeDraft, true);
  assert.equal(state.draftAnswers.tp_first_name, "Mei");
  assert.equal(state.dirty, true);
  again.controller.stop();

  // Pressed before the workspace row has loaded: the draft starts when it arrives.
  const store = officeV2();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const getWorkspace = store.getWorkspace;
  store.getWorkspace = async () => {
    await gate;
    return getWorkspace();
  };
  const early = build({ store });
  const starting = early.controller.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(early.controller.getState().workspace, null);
  await early.controller.openAddCase();
  state = early.controller.getState();
  assert.equal(state.screen, "office-add-case");
  assert.equal(state.officeDraft, false);
  release();
  await starting;
  state = early.controller.getState();
  assert.equal(state.officeDraft, true);
  assert.equal(state.screen, "office-add-case");
  early.controller.stop();
});

test("a refused Send saves the draft, shows what is missing and opens its part", async () => {
  const { controller, store } = await startOffice();
  await controller.openAddCase();
  const { addr_city: _city, ...answers } = makeSampleAnswers();
  controller.editAnswers(answers);
  controller.togglePanel("confirmed");
  assert.deepEqual(await controller.saveOfficeDraft({ send: true }), { sent: false, reason: "answers" });
  assert.equal(creates(store).length, 1);
  assert.equal(writesOf(store, "SAVE_ANSWERS").length, 1);
  assert.equal(writesOf(store, "SUBMIT").length, 0);
  let state = controller.getState();
  assert.equal(state.addCaseShowMissing, true);
  assert.ok(state.openAddSubsteps.includes("about.address"));
  assert.ok(state.openAddSubsteps.includes("before.ready"), "opening one closes none");
  assert.equal(state.screen, "office-add-case");
  assert.equal(state.savedCase.id, "case-2");
  // Answered now: the next Send goes, and the missing marks are reset.
  controller.editAnswers({ addr_city: "Camden" });
  assert.deepEqual(await controller.saveOfficeDraft({ send: true }), { sent: true });
  state = controller.getState();
  assert.equal(state.addCaseShowMissing, false);
  assert.equal(state.screen, "staff-case");
  assert.equal(creates(store).length, 1);
  assert.equal(writesOf(store, "SUBMIT").length, 1);
  controller.stop();

  // Leaving resets the missing marks too.
  const other = await startOffice();
  await other.controller.openAddCase();
  other.controller.editAnswers({ tp_first_name: "Mei" });
  other.controller.togglePanel("confirmed");
  await other.controller.saveOfficeDraft({ send: true });
  assert.equal(other.controller.getState().addCaseShowMissing, true);
  other.controller.navigate("staff");
  assert.equal(other.controller.getState().addCaseShowMissing, false);
  other.controller.stop();
});

test("Send needs the confirmation; ticked, a complete new draft is created, saved and sent", async () => {
  const unticked = await startOffice();
  await unticked.controller.openAddCase();
  unticked.controller.editAnswers(makeSampleAnswers());
  assert.deepEqual(await unticked.controller.saveOfficeDraft({ send: true }), {
    sent: false,
    reason: "unconfirmed",
  });
  assert.deepEqual(unticked.store.writes, [], "nothing is created, saved or sent");
  assert.equal(unticked.controller.getState().officeDraft, true);
  unticked.controller.stop();

  const { controller, store } = await startOffice();
  await controller.openAddCase();
  controller.editAnswers(makeSampleAnswers());
  controller.togglePanel("confirmed");
  assert.deepEqual(await controller.saveOfficeDraft({ send: true }), { sent: true });
  assert.deepEqual(
    store.writes.map((write) => write.type ?? "createCase"),
    ["createCase", "SAVE_ANSWERS", "SUBMIT"],
  );
  const submit = writesOf(store, "SUBMIT")[0];
  assert.deepEqual(submit.payload, { confirmed: true });
  assert.equal(submit.personId, null);
  assert.equal(submit.expectedRevision, 2, "the saved revision");
  const state = controller.getState();
  assert.equal(state.screen, "staff-case");
  assert.equal(state.selectedCaseId, "case-2");
  assert.equal(state.officeSaving, false);
  controller.stop();
});

test("a Send with an invalid answer saves, reveals it and sends nothing", async () => {
  const { controller, store } = await startOffice();
  await controller.openAddCase();
  controller.editAnswers({ ...makeSampleAnswers(), email: "not-an-email" });
  controller.togglePanel("confirmed");
  assert.deepEqual(await controller.saveOfficeDraft({ send: true }), { sent: false, reason: "answers" });
  assert.equal(writesOf(store, "SAVE_ANSWERS").length, 1);
  assert.equal(writesOf(store, "SUBMIT").length, 0);
  const state = controller.getState();
  assert.ok(state.revealed.includes("email"));
  assert.ok(state.openAddSubsteps.includes("about.you"));
  assert.equal(state.addCaseShowMissing, true);
  assert.equal(state.screen, "office-add-case");
  controller.stop();
});

test("Add a case opens a saved office draft on the page", async () => {
  const { controller } = await startOffice({ answers: { tp_first_name: "Mei" } });
  await controller.openAddCase({ caseId: "case-v2" });
  const state = controller.getState();
  assert.equal(state.selectedCaseId, "case-v2");
  assert.equal(state.savedCase.id, "case-v2");
  assert.equal(state.officeDraft, false);
  assert.equal(state.screen, "office-add-case");
  assert.deepEqual(state.openAddSubsteps, ["before.ready"]);
  assert.equal(state.draftAnswers.tp_first_name, "Mei");
  controller.stop();
});

test("Add a case's parts open and close independently", async () => {
  const { controller } = await startOffice();
  await controller.openAddCase();
  controller.toggleAddSubstep("about.you");
  controller.toggleAddSubstep("documents");
  assert.deepEqual(controller.getState().openAddSubsteps, ["before.ready", "about.you", "documents"]);
  controller.toggleAddSubstep("before.ready");
  assert.deepEqual(controller.getState().openAddSubsteps, ["about.you", "documents"]);
  controller.stop();
});

test("the adopted draft is pinned: a re-read of the new case before its save lands keeps the draft", async () => {
  const { controller, store } = await startOffice();
  await controller.openAddCase();
  controller.editAnswers({ tp_first_name: "Mei" });
  const release = holdSaves(store);
  const saving = controller.saveOfficeDraft();
  await new Promise((resolve) => setImmediate(resolve));
  let state = controller.getState();
  assert.equal(state.savedCase.id, "case-2");
  assert.equal(state.editBaseRevision, 1);
  // The create's own change arrives while the save is out.
  await store.handlers.onChange({ table: "cases", caseId: "case-2" });
  state = controller.getState();
  assert.equal(state.draftAnswers.tp_first_name, "Mei");
  assert.equal(state.conflict, null);
  release();
  await saving;
  assert.equal(store.records.get("case-2").answers.tp_first_name, "Mei");
  assert.equal(controller.getState().saveState, "saved");
  controller.stop();
});

// ---- fix round 1 ----------------------------------------------------------

// Starts a Save draft whose create is held, runs `meanwhile`, then lets the
// create land. Returns the Save draft's result.
async function leaveMidCreate(controller, store, meanwhile) {
  await controller.openAddCase();
  controller.editAnswers({ tp_first_name: "Lin" });
  const release = holdCreates(store);
  const saving = controller.saveOfficeDraft();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.getState().officeSaving, true, "the create is out");
  await meanwhile();
  release();
  return await saving;
}

test("a create that lands after another case was opened adopts nothing and saves nothing", async () => {
  const { controller, store } = await startOffice({ answers: { tp_first_name: "Mei" } });
  const result = await leaveMidCreate(controller, store, () => controller.selectCase("case-v2"));
  assert.deepEqual(result, { sent: false, reason: "left" });
  const state = controller.getState();
  assert.equal(state.selectedCaseId, "case-v2");
  assert.equal(state.savedCase.id, "case-v2");
  assert.equal(state.screen, "staff-case");
  assert.equal(state.officeDraftCaseId, null);
  assert.equal(writesOf(store, "SAVE_ANSWERS").length, 0);
  assert.ok(store.records.has("case-2"), "the empty case stays, unselected");
  assert.equal(store.records.get("case-v2").answers.tp_first_name, "Mei");
  assert.equal(state.officeSaving, false);
  controller.stop();
});

test("a create that lands after the office left for the board adopts nothing and saves nothing", async () => {
  const { controller, store } = await startOffice();
  const result = await leaveMidCreate(controller, store, async () => controller.navigate("staff"));
  assert.deepEqual(result, { sent: false, reason: "left" });
  const state = controller.getState();
  assert.equal(state.screen, "staff");
  assert.equal(state.selectedCaseId, null);
  assert.equal(state.savedCase, null);
  assert.equal(state.officeDraftCaseId, null);
  assert.equal(writesOf(store, "SAVE_ANSWERS").length, 0);
  controller.stop();
});

test("a create that lands after sign-out, or after a fresh draft started, adopts nothing", async () => {
  const signedOut = await startOffice();
  const result = await leaveMidCreate(signedOut.controller, signedOut.store, () => signedOut.controller.signOut());
  assert.deepEqual(result, { sent: false, reason: "left" });
  let state = signedOut.controller.getState();
  assert.equal(state.principal, null);
  assert.equal(state.selectedCaseId, null);
  assert.equal(state.savedCase, null);
  assert.equal(state.officeDraftCaseId, null);
  assert.equal(writesOf(signedOut.store, "SAVE_ANSWERS").length, 0);
  signedOut.controller.stop();

  const fresh = await startOffice();
  const again = await leaveMidCreate(fresh.controller, fresh.store, () => fresh.controller.openAddCase());
  assert.deepEqual(again, { sent: false, reason: "left" });
  state = fresh.controller.getState();
  assert.equal(state.officeDraft, true, "the fresh draft is untouched");
  assert.equal(state.savedCase, null);
  assert.equal(state.officeDraftCaseId, null);
  assert.deepEqual(state.draftAnswers, {});
  assert.equal(writesOf(fresh.store, "SAVE_ANSWERS").length, 0);
  fresh.controller.stop();
});

test("a Send whose save outlives its case sends nothing", async () => {
  const { controller, store } = await startOffice({ answers: { tp_first_name: "Mei" } });
  await controller.openAddCase();
  controller.editAnswers(makeSampleAnswers());
  controller.togglePanel("confirmed");
  const release = holdSaves(store);
  const sending = controller.saveOfficeDraft({ send: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.getState().savedCase.id, "case-2");
  await controller.selectCase("case-v2");
  release();
  assert.deepEqual(await sending, { sent: false, reason: "left" });
  assert.equal(writesOf(store, "SUBMIT").length, 0);
  assert.equal(controller.getState().selectedCaseId, "case-v2");
  controller.stop();
});

test("Add a case drops an open case's selection and starts a new office draft", async () => {
  const { controller } = await startOffice({ answers: { tp_first_name: "Mei" } });
  await controller.selectCase("case-v2");
  assert.equal(controller.getState().selectedCaseId, "case-v2");
  await controller.openAddCase();
  const state = controller.getState();
  assert.equal(state.screen, "office-add-case");
  assert.equal(state.selectedCaseId, null);
  assert.equal(state.savedCase, null);
  assert.equal(state.officeDraft, true);
  assert.deepEqual(state.draftAnswers, {});
  assert.equal(state.dirty, false);
  controller.stop();
});

test("on a new office draft, typing while the first save is out is kept and still to send", async () => {
  const { controller, store } = await startOffice();
  await controller.openAddCase();
  controller.editAnswers({ tp_first_name: "Mei" });
  const release = holdSaves(store);
  const saving = controller.saveOfficeDraft();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.actCalls, 1);
  controller.editAnswers({ addr_city: "Camden" });
  release();
  await saving;
  let state = controller.getState();
  assert.equal(store.records.get("case-2").answers.tp_first_name, "Mei");
  assert.equal(Object.hasOwn(store.records.get("case-2").answers, "addr_city"), false);
  assert.equal(state.draftAnswers.addr_city, "Camden");
  assert.equal(state.draftAnswers.tp_first_name, "Mei");
  assert.equal(state.dirty, true);
  assert.equal(state.saveState, "unsaved");
  await controller.saveOfficeDraft();
  assert.equal(store.records.get("case-2").answers.addr_city, "Camden");
  state = controller.getState();
  assert.equal(state.dirty, false);
  assert.equal(state.error, null);
  controller.stop();
});

test("on the client's own version-2 draft, typing while a save is out is kept; the same value is not dirty", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.editAnswers({ tp_first_name: "Ming" });
  let release = holdSaves(store);
  let saving = controller.saveAnswers();
  await new Promise((resolve) => setImmediate(resolve));
  controller.editAnswers({ addr_city: "Camden" });
  release();
  await saving;
  let state = controller.getState();
  assert.equal(state.draftAnswers.tp_first_name, "Ming");
  assert.equal(state.draftAnswers.addr_city, "Camden");
  assert.equal(state.dirty, true);
  await controller.saveAnswers();
  assert.equal(store.records.get("case-v2").answers.addr_city, "Camden");
  assert.equal(store.writes.at(-1).expectedRevision, 2);
  assert.equal(controller.getState().dirty, false);

  // Changed and changed back while the save is out: nothing new to send.
  controller.editAnswers({ tp_first_name: "Lan" });
  release = holdSaves(store);
  saving = controller.saveAnswers();
  await new Promise((resolve) => setImmediate(resolve));
  controller.editAnswers({ tp_first_name: "Mei" });
  controller.editAnswers({ tp_first_name: "Lan" });
  release();
  await saving;
  state = controller.getState();
  assert.equal(state.draftAnswers.tp_first_name, "Lan");
  assert.equal(state.dirty, false);
  assert.equal(state.saveState, "saved");
  controller.stop();
});

// Part 4c, Task 4 fix round 1 (I1): a saved office draft changed elsewhere
// while the office has unsaved edits raises the usual choice on Add a case,
// and choosing keeps the office on the page with nothing visited sent.
test("a conflict on a saved office draft is reconciled on Add a case, then saves", async () => {
  const { controller, store } = await startOffice({ answers: { tp_first_name: "Mei" } });
  await controller.openAddCase({ caseId: "case-v2" });
  controller.editAnswers({ tp_first_name: "Ming" });
  store.records.set("case-v2", { ...store.records.get("case-v2"), revision: 2, answers: { tp_first_name: "Lan" } });
  await store.handlers.onChange({ table: "cases", caseId: "case-v2" });
  let state = controller.getState();
  assert.equal(state.conflict?.code, "REMOTE_CHANGED");
  assert.equal(state.screen, "office-add-case");
  await assert.rejects(controller.saveOfficeDraft(), { code: "CONFLICT" });
  assert.equal(writesOf(store, "SAVE_ANSWERS").length, 0, "nothing is rebased behind the office's back");
  state = controller.getState();
  await controller.reconcileAnswers({ answers: state.draftAnswers, expectedServerRevision: state.savedCase.revision });
  state = controller.getState();
  assert.equal(state.conflict, null);
  assert.equal(state.screen, "office-add-case", "the office stays on Add a case");
  assert.equal(state.draftAnswers.tp_first_name, "Ming");
  assert.equal(state.dirty, true);
  assert.deepEqual(await controller.saveOfficeDraft(), { sent: false });
  const saves = writesOf(store, "SAVE_ANSWERS");
  assert.equal(saves.length, 1);
  assert.equal(saves[0].expectedRevision, 2);
  assert.equal(saves[0].payload.answers.tp_first_name, "Ming");
  assert.equal(Object.hasOwn(saves[0].payload, "visited"), false, "the office never sends visits");
  assert.equal(controller.getState().saveState, "saved");
  assert.equal(controller.getState().screen, "office-add-case");
  controller.stop();
});

// ---------------------------------------------------------------------------
// Part 4d: the language (spec 2026-10-05 §2). Saved per browser in
// localStorage; never part of the window state in sessionStorage.
// ---------------------------------------------------------------------------

test("the language comes from the browser's saved choice, else its languages", () => {
  const saved = build({ store: fakeStore(), localStorage: fakeSession({ "vitally.lang": "zh-Hant" }), languages: ["en-US"] });
  assert.equal(saved.controller.getState().lang, "zh-Hant");
  const fromBrowser = build({ store: fakeStore(), localStorage: fakeSession(), languages: ["zh-CN", "en"] });
  assert.equal(fromBrowser.controller.getState().lang, "zh-Hans");
  const nothing = build({ store: fakeStore() });
  assert.equal(nothing.controller.getState().lang, "en", "no storage and no languages is English");
  const blocked = {
    getItem() { throw new Error("SecurityError"); },
    setItem() { throw new Error("SecurityError"); },
  };
  const refused = build({ store: fakeStore(), localStorage: blocked, languages: ["zh-TW"] });
  assert.equal(refused.controller.getState().lang, "zh-Hant", "blocked storage falls back to the browser's languages");
  refused.controller.setLanguage("en");
  assert.equal(refused.controller.getState().lang, "en", "a choice that cannot be saved still lasts for this page");
});

test("setLanguage saves the choice and redraws; an unknown language throws", async () => {
  const localStorage = fakeSession();
  const { controller, renders } = build({ store: fakeStore(), localStorage, languages: ["en"] });
  await controller.start();
  const before = renders.count;
  controller.setLanguage("zh-Hans");
  assert.equal(controller.getState().lang, "zh-Hans");
  assert.equal(localStorage.raw("vitally.lang"), "zh-Hans");
  assert.equal(renders.count, before + 1);
  assert.equal(renders.focus.at(-1), false, "a language change keeps the keyboard where it is");
  assert.throws(() => controller.setLanguage("fr"), /Unknown language/);
  assert.equal(controller.getState().lang, "zh-Hans", "a refused language changes nothing");
  assert.equal(localStorage.raw("vitally.lang"), "zh-Hans");
  controller.stop();
});

test("adoptLanguage follows a choice made elsewhere without writing it", async () => {
  const localStorage = fakeSession({ "vitally.lang": "zh-Hant" });
  const { controller, renders } = build({ store: fakeStore(), localStorage });
  // Startup's fallback: nothing is drawn before start.
  controller.adoptLanguage("zh-Hans", { draw: false });
  assert.equal(controller.getState().lang, "zh-Hans");
  assert.equal(renders.count, 0);
  assert.equal(localStorage.raw("vitally.lang"), "zh-Hant", "the saved choice stays");
  await controller.start();
  const before = renders.count;
  // Another tab's choice (the storage event): drawn, not written back.
  controller.adoptLanguage("en");
  assert.equal(controller.getState().lang, "en");
  assert.equal(renders.count, before + 1);
  assert.equal(localStorage.raw("vitally.lang"), "zh-Hant");
  assert.throws(() => controller.adoptLanguage("fr"), /Unknown language/);
  controller.stop();
});

test("the window state never holds the language", async () => {
  const sessionStorage = fakeSession();
  const localStorage = fakeSession();
  const { controller } = build({ store: fakeStore(), sessionStorage, localStorage });
  await controller.start();
  controller.setLanguage("zh-Hant");
  controller.toggleSidebar(); // a change that writes the window state
  controller.navigate("applications");
  const keys = sessionStorage.keys();
  assert.ok(keys.length > 0, "the window state was written");
  for (const key of keys) {
    assert.doesNotMatch(key, /lang/i, key);
    assert.doesNotMatch(String(sessionStorage.raw(key)), /"lang"|zh-Hant/, key);
  }
  assert.deepEqual(localStorage.keys(), ["vitally.lang"]);
  controller.stop();
});

// Cleanup: the version-2 save path. A save that lands after another case was
// opened, a re-read that fails after a save, a visit recorded while a save is
// out, and the chip after a quiet re-pin.
// ---------------------------------------------------------------------------

test("a save that lands after another case was opened leaves that case's edits dirty", async () => {
  const { controller, store } = await openV2({
    answers: { tp_first_name: "Mei" },
    others: [{ id: "case-w", reference: "VT-WWWW-BBBB", stage: "draft", revision: 1, intakeVersion: 2, answers: {} }],
  });
  controller.editAnswers({ tp_first_name: "Ming" });
  const release = holdSaves(store);
  const saving = controller.saveAnswers();
  await new Promise((resolve) => setImmediate(resolve));
  await controller.selectCase("case-w");
  controller.editAnswers({ addr_city: "Camden" });
  release();
  await saving;
  assert.equal(store.records.get("case-v2").answers.tp_first_name, "Ming", "the first case's save landed");
  const state = controller.getState();
  assert.equal(state.selectedCaseId, "case-w");
  assert.equal(state.draftAnswers.addr_city, "Camden", "the open case's typing is kept");
  assert.equal(state.dirty, true);
  assert.equal(state.editBaseRevision, 1);
  assert.equal(state.saveState, "unsaved");
  await controller.saveAnswers();
  assert.equal(store.records.get("case-w").answers.addr_city, "Camden");
  assert.equal(controller.getState().saveState, "saved");
  controller.stop();
});

test("a save whose re-read fails still pins the next edit to the revision the save made", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.editAnswers({ tp_first_name: "Ming" });
  const getCase = store.getCase;
  store.getCase = async () => {
    throw offline();
  };
  await controller.saveAnswers();
  store.getCase = getCase;
  assert.equal(controller.getState().saveState, "saved");
  assert.equal(controller.getState().savedCase.revision, 1, "the re-read failed");
  controller.editAnswers({ addr_city: "Camden" });
  assert.equal(controller.getState().editBaseRevision, 2);
  await controller.saveAnswers();
  assert.equal(store.writes.at(-1).expectedRevision, 2);
  assert.equal(store.records.get("case-v2").answers.addr_city, "Camden");
  assert.equal(controller.getState().saveState, "saved");
  assert.equal(controller.getState().conflict, null);
  controller.stop();
});

test("a save whose re-read fails, then a Save with nothing changed, expects the revision the save made", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.editAnswers({ tp_first_name: "Ming" });
  const getCase = store.getCase;
  store.getCase = async () => {
    throw offline();
  };
  await controller.saveAnswers();
  store.getCase = getCase;
  assert.equal(controller.getState().dirty, false);
  await controller.saveAnswers();
  assert.equal(store.writes.at(-1).expectedRevision, 2);
  assert.equal(controller.getState().saveState, "saved");
  controller.stop();
});

test("a sub-step change ignored during a save records no visit, and the next one sends it", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.editAnswers({ tp_first_name: "Ming" });
  const release = holdSaves(store);
  const saving = controller.saveAnswers();
  await new Promise((resolve) => setImmediate(resolve));
  const moving = controller.goToSubstep("before.service");
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all([saving, moving]);
  let state = controller.getState();
  assert.deepEqual(state.visitedSubsteps, [], "the ignored change recorded nothing");
  assert.equal(state.formSubstep, "before.ready");
  assert.equal(state.dirty, false);
  await controller.goToSubstep("before.service");
  assert.deepEqual(store.writes.at(-1).payload.visited, ["before.ready"]);
  assert.deepEqual(store.records.get("case-v2").intakeVisited, ["before.ready"]);
  assert.equal(controller.getState().dirty, false);
  controller.stop();
});

test("a re-pin that leaves nothing to send settles the chip", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  store.failNext = offline();
  await controller.goToSubstep("before.service");
  assert.equal(controller.getState().dirty, true);
  assert.equal(controller.getState().saveState, "failed");
  // The save in doubt had landed after all: the next read shows its visit.
  await remoteChange(store, { intakeVisited: ["before.ready"] });
  const state = controller.getState();
  assert.equal(state.conflict, null);
  assert.equal(state.dirty, false, "nothing differs from the server");
  assert.equal(state.editBaseRevision, null);
  assert.equal(state.saveState, "idle");
  assert.equal(chip(controller), "Up to date");
  controller.stop();
});

test("a save refused as a conflict that a quiet re-pin answers leaves no failure behind", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.editAnswers({ tp_first_name: "Ming" });
  // A card mark in another tab whose change has not reached this window.
  const record = store.records.get("case-v2");
  store.records.set("case-v2", {
    ...record,
    revision: 2,
    documentCards: [{ slotId: "w2.household", status: "later", groupOverride: null, changedAt: "2026-10-04T12:00:00Z" }],
  });
  await assert.rejects(controller.saveAnswers(), { code: "CONFLICT" });
  const state = controller.getState();
  assert.equal(state.conflict, null, "nothing to choose between");
  assert.equal(state.editBaseRevision, 2);
  assert.equal(state.dirty, true);
  assert.equal(state.saveState, "unsaved");
  assert.equal(state.error, null);
  assert.equal(chip(controller), "Unsaved changes");
  await controller.saveAnswers();
  assert.equal(store.writes.at(-1).expectedRevision, 2);
  assert.equal(store.records.get("case-v2").answers.tp_first_name, "Ming");
  assert.equal(controller.getState().saveState, "saved");
  controller.stop();
});

test("a sub-step change or a card mark during an explicit Save sends no second save", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.editAnswers({ tp_first_name: "Ming" });
  const release = holdSaves(store);
  const saving = controller.saveAnswers();
  await new Promise((resolve) => setImmediate(resolve));
  const moving = controller.goToSubstep("before.service");
  const marking = controller.setDocumentCard("w2.household", "later");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.actCalls, 1, "one SAVE_ANSWERS only");
  release();
  await Promise.all([saving, moving, marking]);
  assert.deepEqual(store.writes.map((write) => [write.type, write.expectedRevision]), [["SAVE_ANSWERS", 1]]);
  const state = controller.getState();
  assert.equal(state.error, null, "no conflict banner");
  assert.equal(state.saveState, "saved");
  assert.equal(state.dirty, false);
  controller.stop();
});

test("a save that fails after another case was opened leaves that case's chip, banner and retry alone", async () => {
  const { controller, store } = await openV2({
    answers: { tp_first_name: "Mei" },
    others: [{ id: "case-w", reference: "VT-WWWW-BBBB", stage: "draft", revision: 1, intakeVersion: 2, answers: {} }],
  });
  controller.editAnswers({ tp_first_name: "Ming" });
  const release = holdSaves(store);
  const saving = controller.saveAnswers();
  await new Promise((resolve) => setImmediate(resolve));
  await controller.selectCase("case-w");
  controller.editAnswers({ addr_city: "Camden" });
  store.failNext = offline();
  release();
  await assert.rejects(saving, { code: "OFFLINE" });
  const state = controller.getState();
  assert.equal(state.selectedCaseId, "case-w");
  assert.equal(state.saveState, "unsaved");
  assert.equal(state.error, null);
  assert.equal(state.retryable, false);
  assert.equal(state.dirty, true);
  assert.equal(await controller.retryLast(), null, "the first case's save is not retried here");
  assert.equal(store.writes.length, 1);
  await controller.saveAnswers();
  assert.equal(store.writes.at(-1).caseId, "case-w");
  assert.equal(store.records.get("case-w").answers.addr_city, "Camden");
  controller.stop();
});

test("a save whose re-read fails, then a card mark, expects the revision the save made", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.editAnswers({ tp_first_name: "Ming" });
  const getCase = store.getCase;
  store.getCase = async () => {
    throw offline();
  };
  await controller.saveAnswers();
  store.getCase = getCase;
  await controller.setDocumentCard("w2.household", "later");
  assert.deepEqual(store.writes.at(-1).type, "SET_DOCUMENT_CARD");
  assert.equal(store.writes.at(-1).expectedRevision, 2);
  assert.equal(controller.getState().error, null);
  assert.equal(store.records.get("case-v2").documentCards.length, 1);
  controller.stop();
});

// Fix round 1 (I1): an explicit Save while another save is out waits for it,
// then saves what is still unsaved, or fails visibly; it is never a quiet null.
test("Save during a sub-step change's save waits for it, then sends what was typed since", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.editAnswers({ tp_first_name: "Ming" });
  const release = holdSaves(store);
  const moving = controller.goToSubstep("before.service");
  await new Promise((resolve) => setImmediate(resolve));
  controller.editAnswers({ addr_city: "Camden" });
  const saving = controller.saveAnswers();
  release();
  await moving;
  const receipt = await saving;
  assert.ok(receipt, "Save says it saved only when it did");
  assert.equal(store.records.get("case-v2").answers.addr_city, "Camden");
  assert.deepEqual(store.writes.map((write) => write.expectedRevision), [1, 2], "one save after the other");
  assert.equal(controller.getState().dirty, false);
  assert.equal(controller.getState().saveState, "saved");
  controller.stop();
});

test("Save during a sub-step change's save that fails fails too, and sends nothing more", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.editAnswers({ tp_first_name: "Ming" });
  const release = holdSaves(store);
  const moving = controller.goToSubstep("before.service");
  await new Promise((resolve) => setImmediate(resolve));
  controller.editAnswers({ addr_city: "Camden" });
  const saving = controller.saveAnswers();
  store.failNext = offline();
  release();
  await moving;
  await assert.rejects(saving, { code: "OFFLINE" });
  assert.equal(store.writes.length, 1);
  assert.equal(controller.getState().saveState, "failed");
  assert.equal(controller.getState().dirty, true);
  controller.stop();
});

test("Save on a case opened while the old case's save is out saves the open case", async () => {
  const { controller, store } = await openV2({
    answers: { tp_first_name: "Mei" },
    others: [{ id: "case-w", reference: "VT-WWWW-BBBB", stage: "draft", revision: 1, intakeVersion: 2, answers: {} }],
  });
  controller.editAnswers({ tp_first_name: "Ming" });
  const release = holdSaves(store);
  const moving = controller.goToSubstep("before.service");
  await new Promise((resolve) => setImmediate(resolve));
  await controller.selectCase("case-w");
  controller.editAnswers({ addr_city: "Camden" });
  const saving = controller.saveAnswers();
  release();
  await moving;
  assert.ok(await saving);
  assert.equal(store.records.get("case-w").answers.addr_city, "Camden");
  assert.equal(controller.getState().saveState, "saved");
  controller.stop();
});

// Fix round 1 (minor): the old case's failure is not the open case's doubt,
// and its refusal is not retried.
test("an unknown outcome for the old case's save leaves the open case's visit-only draft settling quietly", async () => {
  const { controller, store } = await openV2({
    answers: { tp_first_name: "Mei" },
    others: [{ id: "case-w", reference: "VT-WWWW-BBBB", stage: "draft", revision: 1, intakeVersion: 2, answers: { tp_first_name: "Lan" } }],
  });
  controller.editAnswers({ tp_first_name: "Ming" });
  const release = holdSaves(store);
  const saving = controller.saveAnswers();
  await new Promise((resolve) => setImmediate(resolve));
  await controller.selectCase("case-w");
  store.failNext = offline();
  release();
  await assert.rejects(saving, { code: "OFFLINE" });
  // Only a visit is unsaved on the open case.
  store.failNext = offline();
  await controller.goToSubstep("before.service");
  assert.equal(controller.getState().dirty, true);
  const record = store.records.get("case-w");
  store.records.set("case-w", { ...record, revision: record.revision + 1, answers: { tp_first_name: "Lan", addr_city: "Camden" } });
  await store.handlers.onChange({ table: "cases", caseId: "case-w" });
  const state = controller.getState();
  assert.equal(state.conflict, null, "nothing to choose between");
  assert.equal(state.draftAnswers.addr_city, "Camden");
  controller.stop();
});

test("a refusal naming a field for the old case's save is not retried once another case is open", async () => {
  const { controller, store } = await openV2({
    answers: { tp_first_name: "Mei" },
    others: [{ id: "case-w", reference: "VT-WWWW-BBBB", stage: "draft", revision: 1, intakeVersion: 2, answers: {} }],
  });
  controller.editAnswers({ tp_first_name: "Ming", tp_dob: "1980-01-01" });
  const release = holdSaves(store);
  const saving = controller.saveAnswers();
  await new Promise((resolve) => setImmediate(resolve));
  await controller.selectCase("case-w");
  store.refusals.push(Object.assign(new Error("refused"), { code: "VALIDATION", field: "tp_dob" }));
  release();
  await assert.rejects(saving, { code: "VALIDATION" });
  assert.equal(store.writes.length, 1, "no retry for the case that was left");
  controller.stop();
});

// Fix round 1 (minor): Retry is a version-2 save like any other.
test("a sub-step change during a Retry sends no second save", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.editAnswers({ tp_first_name: "Ming" });
  store.failNext = offline();
  await assert.rejects(controller.saveAnswers(), { code: "OFFLINE" });
  assert.equal(controller.getState().retryable, true);
  const release = holdSaves(store);
  const retrying = controller.retryLast();
  await new Promise((resolve) => setImmediate(resolve));
  const moving = controller.goToSubstep("before.service");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.actCalls, 1, "one SAVE_ANSWERS only");
  release();
  await Promise.all([retrying, moving]);
  assert.equal(controller.getState().error, null, "no conflict banner");
  assert.equal(store.records.get("case-v2").answers.tp_first_name, "Ming");
  controller.stop();
});

// ---- cleanup: a create that lands after sign-out ---------------------------

test("a client's create that lands after sign-out reloads no list and selects nothing", async () => {
  const store = fakeStore();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const create = store.createCase;
  store.createCase = async (request) => {
    await gate;
    return create(request);
  };
  const { controller } = build({ store });
  await controller.start();
  const creating = controller.createCase();
  await new Promise((resolve) => setImmediate(resolve));
  await controller.signOut();
  const before = store.calls.length;
  release();
  const receipt = await creating;
  assert.ok(receipt?.caseId, "the case exists: the receipt still comes back");
  assert.deepEqual(store.calls.slice(before), ["createCase"], "no list or case read for the signed-out window");
  const state = controller.getState();
  assert.equal(state.principal, null);
  assert.deepEqual(state.cases, []);
  assert.equal(state.selectedCaseId, null);
  assert.equal(state.savedCase, null);
  assert.equal(state.screen, "access");
  controller.stop();
});

test("an office create that lands after sign-out reloads no list", async () => {
  const { controller, store } = await startOffice();
  let before = 0;
  const result = await leaveMidCreate(controller, store, async () => {
    await controller.signOut();
    before = store.calls.length;
  });
  assert.deepEqual(result, { sent: false, reason: "left" });
  assert.deepEqual(store.calls.slice(before).filter((call) => call === "listCases"), [], "no list read after sign-out");
  assert.deepEqual(controller.getState().cases, []);
  controller.stop();
});

test("a client's create that lands after signing out and back in reloads no list and selects nothing", async () => {
  // A fresh principal object on every read, as the real store returns.
  const store = fakeStore();
  const getPrincipal = store.getPrincipal;
  store.getPrincipal = async () => ({ ...(await getPrincipal()) });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const create = store.createCase;
  store.createCase = async (request) => {
    await gate;
    return create(request);
  };
  const auth = { ...idleAuth(), verifyCode: async () => {} };
  const { controller } = build({ store, auth });
  await controller.start();
  const creating = controller.createCase();
  await new Promise((resolve) => setImmediate(resolve));
  await controller.signOut();
  await controller.verifyCode("123456");
  assert.equal(controller.getState().session, "present", "signed in again: the session alone looks unchanged");
  assert.ok(controller.getState().principal);
  const before = store.calls.length;
  release();
  await creating;
  assert.deepEqual(store.calls.slice(before), ["createCase"], "no list or case read for the earlier sign-in");
  const state = controller.getState();
  assert.equal(state.selectedCaseId, null);
  assert.equal(state.savedCase, null);
  assert.notEqual(state.screen, "reference");
  controller.stop();
});

// ---- cleanup follow-ups: the version-2 save path ----------------------------

const caseW = { id: "case-w", reference: "VT-WWWW-BBBB", stage: "draft", revision: 1, intakeVersion: 2, answers: {} };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("a save that lands after its case was left and opened again leaves the reopened draft at the saved values", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" }, others: [caseW] });
  controller.editAnswers({ tp_first_name: "Ming" });
  const release = holdSaves(store);
  const saving = controller.saveAnswers();
  await tick();
  await controller.selectCase("case-w");
  await controller.selectCase("case-v2");
  assert.equal(controller.getState().draftAnswers.tp_first_name, "Mei", "reopened from before the save");
  release();
  await saving;
  assert.equal(store.records.get("case-v2").answers.tp_first_name, "Ming", "the save landed");
  let state = controller.getState();
  assert.equal(state.savedCase.revision, 2);
  assert.equal(state.draftAnswers.tp_first_name, "Ming", "the reopened draft shows the saved values");
  assert.equal(state.dirty, false);
  assert.equal(state.editBaseRevision, null);
  assert.notEqual(state.saveState, "unsaved");
  // Nothing old goes back: the next save sends only what is typed now.
  controller.editAnswers({ addr_city: "Camden" });
  await controller.saveAnswers();
  assert.equal(store.writes.at(-1).expectedRevision, 2);
  assert.equal(store.records.get("case-v2").answers.tp_first_name, "Ming");
  assert.equal(store.records.get("case-v2").answers.addr_city, "Camden");
  state = controller.getState();
  assert.equal(state.saveState, "saved");
  assert.equal(state.conflict, null);
  controller.stop();
});

test("typing in the reopened case while the earlier opening's save is out is kept, and the newer save is a choice", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" }, others: [caseW] });
  controller.editAnswers({ tp_first_name: "Ming" });
  const release = holdSaves(store);
  const saving = controller.saveAnswers();
  await tick();
  await controller.selectCase("case-w");
  await controller.selectCase("case-v2");
  controller.editAnswers({ addr_city: "Camden" });
  release();
  await saving;
  const state = controller.getState();
  assert.equal(state.draftAnswers.addr_city, "Camden", "the reopened typing is kept");
  assert.equal(state.dirty, true);
  assert.equal(state.editBaseRevision, 1, "pinned to what the reopened draft was built from");
  assert.equal(state.saveState, "unsaved", "the earlier opening's save is not this draft's");
  assert.equal(state.conflict?.serverRevision, 2, "the save it did not see is a choice, never taken quietly");
  controller.stop();
});

test("a plain save, and a re-read of the open case while it is out, behave as before", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.editAnswers({ tp_first_name: "Ming" });
  const release = holdSaves(store);
  const saving = controller.saveAnswers();
  await tick();
  // A refresh, a realtime catch-up and a board control's re-read of the same
  // case are the same opening: the save is still this draft's.
  await controller.refresh();
  await store.handlers.onChange({ table: "cases", caseId: "case-v2" });
  await controller.selectCase("case-v2", { navigate: false });
  controller.editAnswers({ addr_city: "Camden" });
  release();
  assert.ok(await saving);
  let state = controller.getState();
  assert.equal(state.savedCase.revision, 2);
  assert.equal(state.draftAnswers.tp_first_name, "Ming");
  assert.equal(state.draftAnswers.addr_city, "Camden", "typed while the save was out, kept");
  assert.equal(state.dirty, true);
  assert.equal(state.editBaseRevision, 2);
  assert.equal(state.conflict, null);
  await controller.saveAnswers();
  state = controller.getState();
  assert.equal(store.writes.at(-1).expectedRevision, 2);
  assert.equal(store.records.get("case-v2").answers.addr_city, "Camden");
  assert.equal(state.saveState, "saved");
  assert.equal(state.dirty, false);
  controller.stop();
});

test("two Saves waiting on a sub-step change's failing save: one fails, the other is not saved", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.editAnswers({ tp_first_name: "Ming" });
  const release = holdSaves(store);
  const moving = controller.goToSubstep("before.service");
  await tick();
  const first = controller.saveAnswers();
  const second = controller.saveAnswers();
  store.failNext = offline();
  release();
  await moving;
  const [one, two] = await Promise.allSettled([first, second]);
  // The sub-step change shows nothing of its own: the first Save reports it.
  assert.equal(one.status, "rejected");
  assert.equal(one.reason.code, "OFFLINE");
  assert.deepEqual(two, { status: "fulfilled", value: null }, "reported once");
  const state = controller.getState();
  assert.equal(store.writes.length, 1);
  assert.equal(state.saveState, "failed");
  assert.equal(state.error?.code, "OFFLINE", "the banner shows it");
  assert.equal(state.retryable, true);
  assert.match(chip(controller), /^Not saved\./);
  controller.stop();
});

test("two Saves waiting on a Save that fails are not saved: the Save that sent it reports it", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.editAnswers({ tp_first_name: "Ming" });
  const release = holdSaves(store);
  const owner = controller.saveAnswers();
  await tick();
  const first = controller.saveAnswers();
  const second = controller.saveAnswers();
  store.failNext = offline();
  release();
  const results = await Promise.allSettled([owner, first, second]);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[0].reason.code, "OFFLINE");
  assert.deepEqual(results.slice(1), [
    { status: "fulfilled", value: null },
    { status: "fulfilled", value: null },
  ]);
  const state = controller.getState();
  assert.equal(store.writes.length, 1);
  assert.equal(state.saveState, "failed");
  assert.equal(state.error?.code, "OFFLINE");
  controller.stop();
});

test("Retry while a version-2 save is out answers null and sends nothing", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" } });
  controller.editAnswers({ tp_first_name: "Ming" });
  store.failNext = offline();
  await assert.rejects(controller.saveAnswers(), { code: "OFFLINE" });
  assert.equal(controller.getState().retryable, true);
  const release = holdSaves(store);
  const saving = controller.saveAnswers();
  await tick();
  const retrying = controller.retryLast();
  await tick();
  assert.equal(store.actCalls, 1, "only the Save's own SAVE_ANSWERS");
  release();
  assert.equal(await retrying, null);
  assert.ok(await saving);
  assert.equal(store.writes.length, 2);
  assert.equal(controller.getState().saveState, "saved");
  controller.stop();
});

test("a sub-step change whose save outlives its opening leaves the case opened again at its own place", async () => {
  const moving = await openV2({ answers: { tp_first_name: "Mei" }, others: [caseW] });
  moving.controller.editAnswers({ tp_first_name: "Ming" });
  const release = holdSaves(moving.store);
  const move = moving.controller.goToSubstep("income.wages");
  await tick();
  await moving.controller.selectCase("case-w");
  await moving.controller.selectCase("case-v2");
  const place = moving.controller.getState().formSubstep;
  release();
  await move;
  assert.equal(moving.controller.getState().formSubstep, place, "the move was the earlier opening's");
  moving.controller.stop();
});

test("a card mark whose pre-save outlives its opening is not sent to the case opened again", async () => {
  const marking = await openV2({ answers: { tp_first_name: "Mei" }, others: [caseW] });
  marking.controller.editAnswers({ tp_first_name: "Ming" });
  const release = holdSaves(marking.store);
  const mark = marking.controller.setDocumentCard("w2.household", "later");
  await tick();
  await marking.controller.selectCase("case-w");
  await marking.controller.selectCase("case-v2");
  release();
  assert.equal(await mark, null);
  assert.deepEqual(writesOf(marking.store, "SET_DOCUMENT_CARD"), [], "the mark was the earlier opening's");
  marking.controller.stop();
});

test("a Send whose save outlives its opening sends nothing from the draft opened again", async () => {
  const sending = await startOffice({ answers: { tp_first_name: "Mei" } });
  await sending.controller.openAddCase();
  sending.controller.editAnswers(makeSampleAnswers());
  sending.controller.togglePanel("confirmed");
  const release = holdSaves(sending.store);
  const send = sending.controller.saveOfficeDraft({ send: true });
  await tick();
  assert.equal(sending.controller.getState().savedCase.id, "case-2");
  await sending.controller.selectCase("case-v2");
  await sending.controller.openAddCase({ caseId: "case-2" });
  release();
  assert.deepEqual(await send, { sent: false, reason: "left" });
  assert.equal(writesOf(sending.store, "SUBMIT").length, 0);
  sending.controller.stop();
});

test("a save whose re-read fails after its case was opened again does not pin the reopened draft past what it read", async () => {
  const { controller, store } = await openV2({ answers: { tp_first_name: "Mei" }, others: [caseW] });
  controller.editAnswers({ tp_first_name: "Ming" });
  const release = holdSaves(store);
  const saving = controller.saveAnswers();
  await tick();
  await controller.selectCase("case-w");
  await controller.selectCase("case-v2");
  const getCase = store.getCase;
  store.getCase = async () => {
    throw offline();
  };
  release();
  await saving;
  store.getCase = getCase;
  assert.equal(controller.getState().savedCase.revision, 1, "the re-read failed");
  controller.editAnswers({ addr_city: "Camden" });
  assert.equal(controller.getState().editBaseRevision, 1, "pinned to what this opening read");
  await assert.rejects(controller.saveAnswers(), { code: "CONFLICT" });
  assert.equal(store.records.get("case-v2").answers.tp_first_name, "Ming", "the saved values are not put back quietly");
  assert.equal(controller.getState().conflict?.serverRevision, 2, "a choice instead");
  assert.equal(controller.getState().draftAnswers.addr_city, "Camden");
  controller.stop();
});

test("the 14446 gate: no move past step 0 until consented, and unticking keeps the answers (add-form-14446-consent)", async () => {
  const { controller } = await openV2({ answers: { vc_agree: null, tp_first_name: "Mei" } });
  await controller.goToSubstep("about.address");
  assert.equal(controller.currentSubstep(), "before.virtual");
  controller.editAnswers({ vc_agree: ["yes"] });
  await controller.goToSubstep("about.address");
  assert.equal(controller.currentSubstep(), "about.address");
  controller.editAnswers({ vc_agree: null });
  assert.equal(controller.currentSubstep(), "before.virtual");
  assert.equal(controller.getState().draftAnswers.tp_first_name, "Mei");
  controller.stop();
});

test("signing Form 14446 fills its date with today, and a typed date is kept (add-form-14446-consent)", async () => {
  const clock = () => new Date(2026, 1, 3, 10).getTime();
  const { controller } = await openV2({ clock, answers: { vc_tp_signature: null, vc_tp_date: null, marital_status: "married" } });
  controller.editAnswers({ vc_tp_signature: "M" });
  assert.equal(controller.getState().draftAnswers.vc_tp_date, "2026-02-03");
  controller.editAnswers({ vc_sp_date: "2026-01-30" });
  controller.editAnswers({ vc_sp_signature: "W" });
  assert.equal(controller.getState().draftAnswers.vc_sp_date, "2026-01-30");
  controller.editAnswers({ vc_tp_date: "2026-01-31" });
  controller.editAnswers({ vc_tp_signature: "Mei Chen" });
  assert.equal(controller.getState().draftAnswers.vc_tp_date, "2026-01-31", "a signature already filled fills nothing");
  controller.editAnswers({ gcf_consent: "yes", gcf_tp_signature: "Mei Chen" });
  assert.equal(controller.getState().draftAnswers.gcf_tp_date ?? null, null, "15080's dates are not filled");
  controller.stop();
});

test("a refusal is recorded before it is thrown, and offers no retry", async () => {
  const store = fakeStore();
  const { controller } = build({ store });
  await controller.start();
  await assert.rejects(controller.runAction("SUBMIT", { confirmed: true }), (error) => error.code === "NOT_FOUND");
  assert.deepEqual(controller.getState().error, { code: "NOT_FOUND", message: "Open an application first." });
  assert.equal(controller.getState().retryable, false);
  controller.stop();
});

test("noteLocalFailure records the error, and Try again runs its retry once, synchronously", async () => {
  const store = fakeStore();
  const { controller } = build({ store });
  await controller.start();
  let runs = 0;
  controller.noteLocalFailure({ code: "DRAFT", message: "The draft could not be made. Try again." }, () => {
    runs += 1;
  });
  assert.deepEqual(controller.getState().error, { code: "DRAFT", message: "The draft could not be made. Try again." });
  assert.equal(controller.getState().retryable, true);
  const pending = controller.retryLast();
  assert.equal(runs, 1, "a rebuilt draft must open its tab inside the press");
  assert.deepEqual(await pending, { local: true });
  assert.equal(controller.getState().error, null);
  assert.equal(await controller.retryLast(), null, "the retry is used up");
  assert.equal(runs, 1);
  controller.stop();
});

test("without a retry, noteLocalFailure offers Dismiss only", async () => {
  const store = fakeStore();
  const { controller } = build({ store });
  await controller.start();
  controller.noteLocalFailure({ code: "VALIDATION", message: "There is no assisted intake form on screen." });
  assert.equal(controller.getState().retryable, false);
  assert.equal(await controller.retryLast(), null);
  controller.stop();
});

test("a newer error, a dismiss or a sign-out drops the local retry", async () => {
  const store = fakeStore();
  const { controller } = build({ store });
  await controller.start();
  let runs = 0;
  const retry = () => {
    runs += 1;
  };
  controller.noteLocalFailure({ code: "DRAFT", message: "x" }, retry);
  controller.dismissError();
  assert.equal(await controller.retryLast(), null);
  controller.noteLocalFailure({ code: "DRAFT", message: "x" }, retry);
  await assert.rejects(controller.runAction("SUBMIT", { confirmed: true })); // a refusal: a newer error
  assert.equal(await controller.retryLast(), null);
  controller.noteLocalFailure({ code: "DRAFT", message: "x" }, retry);
  await controller.signOut();
  assert.equal(await controller.retryLast(), null);
  assert.equal(runs, 0);
  controller.stop();
});

test("a local failure during a failed save falls back to unsaved and keeps the draft", async () => {
  const store = fakeStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} }],
  });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-a");
  controller.editAnswers({ tp_first_name: "Mei" });
  store.failNext = Object.assign(new Error("offline"), { code: "OFFLINE" });
  await assert.rejects(controller.saveAnswers());
  assert.equal(controller.getState().saveState, "failed");
  controller.noteLocalFailure({ code: "DRAFT", message: "The draft could not be made. Try again." }, () => {});
  const state = controller.getState();
  assert.equal(state.saveState, "unsaved");
  assert.equal(state.dirty, true, "the draft is still here");
  assert.equal(state.error.code, "DRAFT");
  assert.deepEqual(await controller.retryLast(), { local: true }, "Try again is the draft's, not the dropped save's");
  controller.stop();
});

test("retryLast still replays a pending action when no local retry is pending", async () => {
  const store = fakeStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} }],
  });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-a");
  controller.editAnswers({ tp_first_name: "Mei" });
  store.failNext = Object.assign(new Error("offline"), { code: "OFFLINE" });
  await assert.rejects(controller.saveAnswers());
  assert.equal(controller.getState().retryable, true);
  const replay = await controller.retryLast();
  assert.ok(replay && !replay.local, "a replayed save is not a local retry");
  controller.stop();
});

// ---------------------------------------------------------------------------
// Lists that are loading or couldn't load (design D6)
// ---------------------------------------------------------------------------

const offlineList = () => async () => {
  throw Object.assign(new Error("offline"), { code: "OFFLINE" });
};

test("a dropped local retry takes its Try again with it", async () => {
  const store = fakeStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} }],
  });
  const { controller } = build({ store });
  await controller.start();
  let runs = 0;
  controller.noteLocalFailure({ code: "DRAFT", message: "The draft could not be made. Try again." }, () => {
    runs += 1;
  });
  assert.equal(controller.getState().retryable, true);
  controller.dismissError();
  assert.equal(controller.getState().retryable, false, "Dismiss drops the draft's Try again");
  // A focus or `online` re-read that fails offline: its banner offers no
  // Try again that would do nothing.
  store.listCases = offlineList();
  await controller.refresh();
  assert.equal(controller.getState().error.code, "OFFLINE");
  assert.equal(controller.getState().retryable, false, "no Try again that does nothing");
  assert.equal(await controller.retryLast(), null);
  // A newer error drops it too.
  controller.noteLocalFailure({ code: "DRAFT", message: "x" }, () => {
    runs += 1;
  });
  await controller.refresh();
  assert.equal(controller.getState().retryable, false, "a newer error drops the draft's Try again");
  // And a sign-out.
  controller.noteLocalFailure({ code: "DRAFT", message: "x" }, () => {
    runs += 1;
  });
  await controller.signOut();
  assert.equal(controller.getState().retryable, false);
  assert.equal(runs, 0);
  controller.stop();
});

test("a refusal replacing a retryable error offers no Try again", async () => {
  const store = fakeStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} }],
  });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-a");
  controller.editAnswers({ tp_first_name: "Mei" });
  store.failNext = Object.assign(new Error("offline"), { code: "OFFLINE" });
  await assert.rejects(controller.saveAnswers());
  assert.equal(controller.getState().retryable, true, "the offline save can be sent again");
  await assert.rejects(controller.runAction("DELETE_EVERYTHING", {}), (error) => error.code === "VALIDATION");
  assert.equal(controller.getState().error.code, "VALIDATION");
  assert.equal(controller.getState().retryable, false);
  controller.stop();
});

test("a save that fails after a draft failure keeps its own Try again", async () => {
  const store = fakeStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} }],
  });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-a");
  controller.noteLocalFailure({ code: "DRAFT", message: "The draft could not be made. Try again." }, () => {});
  controller.editAnswers({ tp_first_name: "Mei" });
  store.failNext = Object.assign(new Error("offline"), { code: "OFFLINE" });
  await assert.rejects(controller.saveAnswers());
  assert.equal(controller.getState().error.code, "OFFLINE");
  assert.equal(controller.getState().retryable, true, "the save's envelope can be sent again");
  const replay = await controller.retryLast();
  assert.ok(replay && !replay.local, "Try again re-sends the save, not the dropped draft");
  controller.stop();
});

test("every recorded error is counted", async () => {
  const store = fakeStore();
  const { controller } = build({ store });
  assert.equal(controller.getState().errorCount, 0);
  await controller.start();
  const before = controller.getState().errorCount;
  controller.noteLocalFailure({ code: "VALIDATION", message: "There is no assisted intake form on screen." });
  assert.equal(controller.getState().errorCount, before + 1, "noteLocalFailure");
  await assert.rejects(controller.runAction("SUBMIT", { confirmed: true }));
  assert.equal(controller.getState().errorCount, before + 2, "a refusal");
  store.listCases = offlineList();
  await controller.refresh();
  assert.equal(controller.getState().errorCount, before + 3, "a failed read (noteFailure)");
  // The same words again are still a new error.
  await controller.refresh();
  assert.equal(controller.getState().errorCount, before + 4);
  controller.stop();
});

test("clearError clears only its own error", async () => {
  const store = adminStaffStore({ cases: [sampleCase()] });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("fixture-a");
  let runs = 0;
  controller.noteLocalFailure({ code: "DRAFT", message: "The draft could not be made. Try again." }, () => {
    runs += 1;
  });
  controller.clearError("OFFLINE");
  assert.equal(controller.getState().error.code, "DRAFT", "another code is left alone");
  assert.equal(controller.getState().retryable, true);
  controller.clearError("DRAFT");
  assert.equal(controller.getState().error, null);
  assert.equal(controller.getState().retryable, false);
  assert.equal(await controller.retryLast(), null);
  assert.equal(runs, 0);
  controller.stop();
});

test("a list that never loaded says so, and Try again reads everything again", async () => {
  const store = adminStaffStore({ cases: [sampleCase()] });
  const realList = store.listCases;
  store.listCases = offlineList();
  const { controller } = build({ store });
  assert.equal(controller.getState().lists.cases, "loading");
  await controller.start();
  assert.equal(controller.getState().lists.cases, "failed");
  assert.equal(controller.getState().retryable, true);
  store.listCases = realList;
  store.calls.length = 0;
  assert.deepEqual(await controller.retryLast(), { local: true });
  const state = controller.getState();
  assert.equal(state.lists.cases, "ready");
  assert.equal(state.lists.assistance, "ready");
  assert.equal(state.cases.length, 1);
  assert.ok(store.calls.includes("listPeople"), "the people are read again");
  assert.ok(state.people.length > 0);
  assert.ok(state.workspace, "the workspace is read again");
  controller.stop();
});

test("a list that loaded once keeps its cases when a reload fails", async () => {
  const store = fakeStore({ cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: {} }] });
  const { controller } = build({ store });
  await controller.start();
  assert.equal(controller.getState().lists.cases, "ready");
  store.listCases = offlineList();
  await controller.refresh();
  assert.equal(controller.getState().lists.cases, "ready");
  assert.equal(controller.getState().cases.length, 1);
  assert.equal(controller.getState().error?.code, "OFFLINE", "the failed reload is still said");
  controller.stop();
});

test("a first load that fails after both lists are read still offers Try again", async () => {
  const store = adminStaffStore({ cases: [sampleCase()] });
  const realWorkspace = store.getWorkspace;
  store.getWorkspace = offlineList();
  const { controller } = build({ store });
  await controller.start();
  assert.equal(controller.getState().lists.cases, "ready");
  assert.equal(controller.getState().lists.assistance, "ready");
  assert.equal(controller.getState().workspace, null);
  assert.equal(controller.getState().error?.code, "OFFLINE");
  assert.equal(controller.getState().retryable, true, "Try again reads the rest");
  store.getWorkspace = realWorkspace;
  assert.deepEqual(await controller.retryLast(), { local: true });
  assert.ok(controller.getState().workspace, "the workspace is read");
  assert.equal(controller.getState().error, null);
  controller.stop();
});

test("an applicant's help-request list counts as loaded, and sign-out starts over", async () => {
  const store = fakeStore();
  const { controller } = build({ store });
  await controller.start();
  assert.deepEqual(controller.getState().lists, { cases: "ready", assistance: "ready" });
  await controller.signOut();
  assert.deepEqual(controller.getState().lists, { cases: "loading", assistance: "loading" });
  controller.stop();
});

test("a restored open case that also fails to load does not take Try again away from the lists", async () => {
  const shared = fakeSession();
  const record = { id: "case-a", reference: "VT-AAAA-BBBB", stage: "draft", revision: 1, answers: { ...CONSENT_14446 } };
  const store = fakeStore({ cases: [record] });
  const first = build({ store, sessionStorage: shared });
  await first.controller.start();
  await first.controller.selectCase("case-a");
  first.controller.stop();

  const realList = store.listCases;
  const realGet = store.getCase;
  store.listCases = offlineList();
  store.getCase = offlineList();
  const { controller } = build({ store, sessionStorage: shared });
  await controller.start();
  assert.equal(controller.getState().selectedCaseId, "case-a", "the open case was restored");
  assert.equal(controller.getState().lists.cases, "failed");
  assert.equal(controller.getState().retryable, true, "Try again is offered");
  store.listCases = realList;
  store.getCase = realGet;
  assert.deepEqual(await controller.retryLast(), { local: true });
  assert.equal(controller.getState().lists.cases, "ready");
  assert.equal(controller.getState().cases.length, 1);
  controller.stop();
});

test("a later refresh after a failed first load reads the people and the workspace too", async () => {
  const store = adminStaffStore({ cases: [sampleCase()] });
  const realList = store.listCases;
  store.listCases = offlineList();
  const { controller } = build({ store });
  await controller.start();
  assert.equal(controller.getState().lists.cases, "failed");
  assert.equal(controller.getState().people.length, 0);
  assert.equal(controller.getState().workspace, null);
  store.listCases = realList;
  store.calls.length = 0;
  await controller.refresh();
  const state = controller.getState();
  assert.equal(state.lists.cases, "ready");
  assert.equal(state.lists.assistance, "ready");
  assert.ok(state.people.length > 0, "the people are read");
  assert.ok(state.workspace, "the workspace is read");
  assert.ok(store.calls.includes("listPeople"), "listPeople was called again");
  store.calls.length = 0;
  await controller.refresh();
  assert.ok(!store.calls.includes("listPeople"), "once loaded, a refresh does not read the people again");
  controller.stop();
});

// ---------------------------------------------------------------------------
// The contact log (OpenSpec change add-contact-log)
// ---------------------------------------------------------------------------

const CONTACT_ENTRY = Object.freeze({
  contactedAt: "2026-09-04T12:00:00.000Z",
  direction: "outgoing",
  method: "phone",
  note: "Left word.",
  otherName: null,
  outcome: "left_voicemail",
  purpose: "ask_question",
  withWhom: "client",
});

const contactStore = () =>
  officeStore({
    cases: [
      {
        id: "case-a",
        reference: "VT-AAAA-BBBB",
        stage: "preparing",
        revision: 5,
        answers: {},
        contacts: [{ id: "contact-1", revision: 3, ...CONTACT_ENTRY }],
      },
    ],
  });

const readsOf = (store) =>
  store.calls.filter((entry) => entry === "getCase:case-a").length;

test("logging sends the task and no person, then re-reads the case", async () => {
  const store = contactStore();
  const { controller } = build({ store, newActionId: () => "action-1" });
  await controller.start();
  await controller.selectCase("case-a");
  const reads = readsOf(store);
  const request = await controller.logContact("case-a", CONTACT_ENTRY, "followup-1");
  assert.deepEqual(store.writes.at(-1), {
    actionId: "action-1",
    caseId: "case-a",
    personId: null,
    followupId: "followup-1",
    entry: CONTACT_ENTRY,
  });
  assert.equal(request.actionId, "action-1");
  assert.equal(readsOf(store), reads + 1);
  assert.equal(controller.getState().savedCase.contacts.length, 2);
  assert.equal(controller.getState().busy, false);
  await controller.logContact("case-a", CONTACT_ENTRY);
  assert.equal(store.writes.at(-1).followupId, null);
  controller.stop();
});

test("editing sends the revision on screen", async () => {
  const store = contactStore();
  const { controller } = build({ store, newActionId: () => "action-2" });
  await controller.start();
  await controller.selectCase("case-a");
  await controller.editContact("contact-1", { ...CONTACT_ENTRY, note: "Changed." });
  assert.deepEqual(store.writes.at(-1), {
    actionId: "action-2",
    contactId: "contact-1",
    expectedRevision: 3,
    personId: null,
    entry: { ...CONTACT_ENTRY, note: "Changed." },
  });
  assert.equal(controller.getState().savedCase.contacts[0].note, "Changed.");
  assert.equal(controller.getState().savedCase.contacts[0].revision, 4);
  controller.stop();
});

test("a conflicting edit shows the newest version", async () => {
  const store = contactStore();
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-a");
  const reads = readsOf(store);
  store.failNext = Object.assign(new Error("conflict"), { code: "CONFLICT" });
  await assert.rejects(
    controller.editContact("contact-1", CONTACT_ENTRY),
    (error) => error.code === "CONFLICT",
  );
  const state = controller.getState();
  assert.equal(state.error.code, "CONFLICT");
  assert.equal(
    state.error.message,
    "Someone else changed this contact. The newest version is shown — check it and try again.",
  );
  assert.equal(state.busy, false);
  assert.equal(readsOf(store), reads + 1);
  controller.stop();
});

test("a failed log shows the error and throws", async () => {
  const store = contactStore();
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-a");
  store.failNext = Object.assign(new Error("Pick an outcome."), { code: "VALIDATION" });
  await assert.rejects(
    controller.logContact("case-a", CONTACT_ENTRY),
    (error) => error.code === "VALIDATION",
  );
  assert.equal(controller.getState().error.code, "VALIDATION");
  assert.equal(controller.getState().error.message, "Pick an outcome.");
  assert.equal(controller.getState().busy, false);
  controller.stop();
});

test("an edit of a contact not on screen is refused without a call", async () => {
  const store = contactStore();
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-a");
  await assert.rejects(
    controller.editContact("contact-9", CONTACT_ENTRY),
    (error) => error.code === "NOT_FOUND",
  );
  assert.ok(!store.calls.includes("editContact"));
  assert.equal(controller.getState().error.code, "NOT_FOUND");
  controller.stop();
});

test("a contact log change on the open case re-reads it", async () => {
  const store = contactStore();
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-a");
  store.records.set("case-a", { ...store.records.get("case-a"), contacts: [] });
  for (const table of ["contact_log", "contact_log_versions"]) {
    const reads = readsOf(store);
    await store.handlers.onChange({
      table,
      eventType: "INSERT",
      id: "x",
      caseId: "case-a",
    });
    assert.equal(readsOf(store), reads + 1, table);
  }
  assert.deepEqual(controller.getState().savedCase.contacts, []);
  controller.stop();
});

// ---- screening starts when an admin opens a Request sent case ---------------

const RECEIVED = { id: "case-r", reference: "VT-RRRR-RRRR", stage: "received", revision: 3, answers: {} };
const adminPeople = [
  { id: "person-sam", name: "Sam", capabilities: ["admin", "followup"] },
  { id: "person-alex", name: "Alex", capabilities: ["prepare"] },
];
const startWrites = (store) => store.writes.filter((write) => write.type === "START_SCREENING");

test("an admin staff member opening a Request sent case starts screening, once", async () => {
  const store = adminStaffStore({ cases: [RECEIVED], people: adminPeople });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-r");
  await tick();
  assert.equal(startWrites(store).length, 1);
  assert.deepEqual(
    { ...startWrites(store)[0], actionId: "id" },
    { actionId: "id", caseId: "case-r", expectedRevision: 3, personId: null, type: "START_SCREENING", payload: {} },
  );
  assert.equal(controller.getState().savedCase.stage, "screening", "the case was re-read");
  await controller.selectCase("case-r");
  await tick();
  assert.equal(startWrites(store).length, 1, "not twice");
  assert.equal(controller.getState().busy, false);
  assert.equal(controller.getState().error, null);
  controller.stop();
});

test("another admin got there first: no error, the case is re-read, nothing is sent twice", async () => {
  const store = adminStaffStore({ cases: [RECEIVED], people: adminPeople });
  // The other admin's start lands first: the case is already at screening
  // (revision 4) when ours is refused.
  const act = store.act;
  let first = true;
  store.act = async (action) => {
    if (first && action.type === "START_SCREENING") {
      first = false;
      store.writes.push(action);
      store.records.set("case-r", { ...RECEIVED, stage: "screening", revision: 4 });
      throw Object.assign(new Error("INVALID_TRANSITION"), { code: "INVALID_TRANSITION" });
    }
    return act(action);
  };
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-r");
  await tick();
  const state = controller.getState();
  assert.equal(state.error, null);
  assert.equal(state.retryable, false);
  assert.equal(state.savedCase.stage, "screening", "the case was re-read");
  assert.equal(startWrites(store).length, 1, "no second start");
  controller.stop();
});

test("offline on open: nothing shows, and a refresh sends the same start again", async () => {
  const store = adminStaffStore({ cases: [RECEIVED], people: adminPeople });
  store.failNext = Object.assign(new Error("offline"), { code: "OFFLINE" });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-r");
  await tick();
  assert.equal(controller.getState().error, null);
  assert.equal(controller.getState().connection, "offline", "the offline notice shows");
  assert.equal(controller.getState().retryable, false, "no Try again for a start");
  const first = startWrites(store)[0].actionId;
  await controller.refresh();
  await tick();
  assert.equal(startWrites(store).length, 2);
  assert.equal(startWrites(store)[1].actionId, first, "the same action id, so a receipt answers a replay");
  controller.stop();
});

test("a case past Request sent starts nothing", async () => {
  const store = adminStaffStore({ cases: [{ ...RECEIVED, stage: "screening" }], people: adminPeople });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-r");
  await tick();
  assert.equal(startWrites(store).length, 0);
  controller.stop();
});

test("selecting a case in place from a list is not an open", async () => {
  const store = adminStaffStore({ cases: [RECEIVED], people: adminPeople });
  const { controller } = build({ store });
  await controller.start();
  // Follow-ups' Log contact and the Mark buttons read the case without leaving
  // the list; after start() the window is on its home screen, not a case page.
  await controller.selectCase("case-r", { navigate: false });
  await tick();
  assert.notEqual(controller.getState().screen, "staff-case");
  assert.equal(startWrites(store).length, 0);
  controller.stop();
});

test("a reload on the case page starts screening", async () => {
  const store = adminStaffStore({ cases: [RECEIVED], people: adminPeople });
  // The window's stored record (window-state.mjs), under the staff member's
  // user id: this case open on the staff case page.
  const sessionStorage = fakeSession({
    "vitally:client:v1:p1": JSON.stringify({
      screen: "staff-case",
      selectedCaseId: "case-r",
    }),
  });
  const { controller } = build({ store, sessionStorage });
  await controller.start();
  await tick();
  assert.equal(controller.getState().screen, "staff-case");
  assert.equal(startWrites(store).length, 1);
  controller.stop();
});

test("the connection's return sends the held start, unchanged", async () => {
  const store = adminStaffStore({ cases: [RECEIVED], people: adminPeople });
  store.failNext = Object.assign(new Error("offline"), { code: "OFFLINE" });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-r");
  await tick();
  assert.equal(controller.getState().connection, "offline", "the offline notice shows");
  await store.handlers.onConnection("offline");
  await store.handlers.onConnection("online");
  await tick();
  assert.equal(controller.getState().connection, "online");
  const sent = startWrites(store);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], sent[0], "the same action, id and revision alike");
  controller.stop();
});

test("a race that leaves the case at Request sent tries once more, at the new revision", async () => {
  const store = adminStaffStore({ cases: [RECEIVED], people: adminPeople });
  // The first start meets a case that moved on (another admin logged a
  // contact): revision 4, still Request sent.
  const act = store.act;
  let first = true;
  store.act = async (action) => {
    if (first && action.type === "START_SCREENING") {
      first = false;
      store.writes.push(action);
      store.records.set("case-r", { ...RECEIVED, revision: 4 });
      throw Object.assign(new Error("CONFLICT"), { code: "CONFLICT" });
    }
    return act(action);
  };
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-r");
  await tick();
  const sent = startWrites(store);
  assert.equal(sent.length, 2);
  assert.notEqual(sent[1].actionId, sent[0].actionId, "a fresh action");
  assert.equal(sent[1].expectedRevision, 4);
  assert.equal(controller.getState().error, null);
  controller.stop();
});

test("a refusal that isn't a race is given up on for this case", async () => {
  const store = adminStaffStore({ cases: [RECEIVED], people: adminPeople });
  store.failNext = Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-r");
  await tick();
  await controller.refresh();
  await tick();
  assert.equal(startWrites(store).length, 1, "no retry on every refresh");
  assert.equal(controller.getState().error, null);
  controller.stop();
});

test("a held start is sent after the admin's own pending action goes through", async () => {
  const store = adminStaffStore({ cases: [RECEIVED], people: adminPeople });
  store.failNext = Object.assign(new Error("offline"), { code: "OFFLINE" });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-r");
  await tick();
  assert.equal(startWrites(store).length, 1, "the start is held");
  // The admin presses an action while still offline: it is held too.
  store.failNext = Object.assign(new Error("offline"), { code: "OFFLINE" });
  await assert.rejects(controller.runAction("ESCALATE_CONTACT", {}));
  assert.equal(controller.getState().retryable, true);
  // The connection returns, but the action is still pending: no start yet.
  await store.handlers.onConnection("online");
  await tick();
  assert.equal(startWrites(store).length, 1, "waits for the pending action");
  // Try again: the action goes through, then the held start is sent, unchanged.
  await controller.retryLast();
  await tick();
  const sent = startWrites(store);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], sent[0], "the same action, id and revision alike");
  assert.equal(controller.getState().error, null);
  controller.stop();
});

test("a case action pressed while the start is out waits for it and pins the new revision", async () => {
  const store = adminStaffStore({ cases: [RECEIVED], people: adminPeople });
  const act = store.act;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  store.act = async (action) => {
    if (action.type === "START_SCREENING") await gate;
    return act(action);
  };
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-r");
  await tick();
  const pressed = controller.runAction("ESCALATE_CONTACT", {});
  await tick();
  assert.equal(store.writes.filter((write) => write.type === "ESCALATE_CONTACT").length, 0, "held back");
  release();
  await pressed;
  await tick();
  const types = store.writes.map((write) => write.type);
  assert.deepEqual(types, ["START_SCREENING", "ESCALATE_CONTACT"], "the start first");
  assert.equal(store.writes[1].expectedRevision, 4, "the revision after the start");
  assert.equal(controller.getState().error, null);
  controller.stop();
});

test("a held start belongs to its case: opening another case drops it", async () => {
  const other = { ...RECEIVED, id: "case-b", reference: "VT-BBBB-BBBB" };
  const store = adminStaffStore({ cases: [RECEIVED, other], people: adminPeople });
  store.failNext = Object.assign(new Error("offline"), { code: "OFFLINE" });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-r");
  await tick();
  assert.equal(startWrites(store).length, 1, "case A's start is held");
  await controller.selectCase("case-b");
  await tick();
  await store.handlers.onConnection("offline");
  await store.handlers.onConnection("online");
  await tick();
  const sent = startWrites(store);
  assert.deepEqual(sent.map((write) => write.caseId), ["case-r", "case-b"], "A is not resent; B has its own");
  assert.notEqual(sent[1].actionId, sent[0].actionId);
  controller.stop();
});

test("signing out drops a held start: nothing is sent when the connection returns", async () => {
  const store = adminStaffStore({ cases: [RECEIVED], people: adminPeople });
  store.failNext = Object.assign(new Error("offline"), { code: "OFFLINE" });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-r");
  await tick();
  assert.equal(startWrites(store).length, 1, "the start is held");
  await controller.signOut();
  await controller.refresh();
  await tick();
  assert.equal(startWrites(store).length, 1, "nothing resent");
  controller.stop();
});

test("a start skipped while a contact write is out is sent when the write settles", async () => {
  const store = adminStaffStore({ cases: [RECEIVED], people: adminPeople });
  const logContact = store.logContact;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  store.logContact = async (request) => {
    await gate;
    return logContact(request);
  };
  const { controller } = build({ store });
  await controller.start();
  // Read in place from a list, so this is not an open yet.
  await controller.selectCase("case-r", { navigate: false });
  await tick();
  assert.equal(startWrites(store).length, 0, "not an open");
  const logged = controller.logContact("case-r", CONTACT_ENTRY);
  await tick();
  assert.equal(controller.getState().busy, true, "the write is out");
  // The case page opens while the write is out: the start is skipped.
  await controller.selectCase("case-r");
  await tick();
  assert.equal(startWrites(store).length, 0, "skipped while busy");
  release();
  await logged;
  await tick();
  assert.equal(startWrites(store).length, 1, "sent once the write settles");
  assert.equal(controller.getState().savedCase.stage, "screening");
  assert.equal(controller.getState().error, null);
  controller.stop();
});

// A store whose first START_SCREENING is held open until `release()`.
function storeHoldingFirstStart(cases) {
  const store = adminStaffStore({ cases, people: adminPeople });
  const act = store.act;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let held = false;
  store.act = async (action) => {
    if (action.type === "START_SCREENING" && !held) {
      held = true;
      await gate;
    }
    return act(action);
  };
  return { store, release };
}

test("a press that waited for the start is not sent for another case opened meanwhile", async () => {
  const other = { ...RECEIVED, id: "case-b", reference: "VT-BBBB-BBBB" };
  const { store, release } = storeHoldingFirstStart([RECEIVED, other]);
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-r");
  await tick();
  const pressed = controller.runAction("ESCALATE_CONTACT", {});
  await tick();
  await controller.selectCase("case-b");
  release();
  assert.equal(await pressed, null, "a press for the case that was left sends nothing");
  await tick();
  assert.equal(store.writes.filter((write) => write.type === "ESCALATE_CONTACT").length, 0);
  assert.equal(controller.getState().selectedCaseId, "case-b");
  assert.equal(controller.getState().error, null);
  controller.stop();
});

test("a second press while one waits for the start does nothing", async () => {
  const { store, release } = storeHoldingFirstStart([RECEIVED]);
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-r");
  await tick();
  const first = controller.runAction("ESCALATE_CONTACT", {});
  await tick();
  assert.equal(await controller.runAction("ESCALATE_CONTACT", {}), null, "the second press is ignored");
  release();
  await first;
  await tick();
  const sent = store.writes.filter((write) => write.type === "ESCALATE_CONTACT");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].expectedRevision, 4);
  assert.equal(controller.getState().error, null);
  controller.stop();
});

const unsignedStore = () => {
  const store = officeStore({
    cases: [
      { id: "case-a", reference: "VT-A", stage: "review_approved", revision: 4, answers: {} },
      { id: "case-b", reference: "VT-B", stage: "review_approved", revision: 2, answers: {} },
    ],
  });
  store.closeUnsigned = async (request) => {
    store.calls.push("closeUnsigned");
    store.writes.push(request);
    const failure = store.failNext;
    if (failure) {
      store.failNext = null;
      throw failure;
    }
    for (const { caseId } of request.cases)
      store.records.set(caseId, { ...store.records.get(caseId), stage: "closed" });
    return {
      actionId: request.actionId,
      cases: request.cases.map(({ caseId, revision }) => ({ caseId, reference: "R", revision: revision + 1 })),
    };
  };
  return store;
};

test("closeUnsigned sends the ticked list and applies revisions", async () => {
  const store = unsignedStore();
  const { controller } = build({ store, newActionId: () => "action-7" });
  await controller.start();
  controller.openDialog("close-unsigned");
  await controller.closeUnsigned([{ caseId: "case-a", revision: 4 }]);
  assert.deepEqual(store.writes.at(-1), {
    actionId: "action-7",
    personId: null,
    cases: [{ caseId: "case-a", revision: 4 }],
    confirmed: true,
  });
  const state = controller.getState();
  assert.equal(state.cases.find((c) => c.id === "case-a").stage, "closed");
  assert.equal(state.cases.find((c) => c.id === "case-b").stage, "review_approved");
  assert.equal(state.busy, false);
  controller.stop();
});

test("closeUnsigned conflict re-reads", async () => {
  const store = unsignedStore();
  const { controller } = build({ store, newActionId: () => "action-8" });
  await controller.start();
  controller.openDialog("close-unsigned");
  const before = structuredClone(controller.getState().cases);
  // Another admin moves case-b first; the call changes nothing.
  store.records.set("case-b", { ...store.records.get("case-b"), stage: "closed" });
  store.failNext = Object.assign(new Error("A case moved."), { code: "CONFLICT" });
  const reads = store.calls.filter((c) => c === "listCases").length;
  await assert.rejects(
    controller.closeUnsigned([
      { caseId: "case-a", revision: 4 },
      { caseId: "case-b", revision: 2 },
    ]),
    (error) => error.code === "CONFLICT",
  );
  const state = controller.getState();
  assert.equal(store.calls.filter((c) => c === "listCases").length, reads + 1);
  assert.equal(state.dialog, "close-unsigned");
  assert.equal(state.error.code, "CONFLICT");
  assert.equal(state.cases.find((c) => c.id === "case-a").stage, "review_approved");
  assert.equal(state.cases.find((c) => c.id === "case-b").stage, "closed");
  assert.equal(state.busy, false);
  // The re-read list is a new list: the dialog asks for its confirmation again
  // (the page drops the ticked box when the key changes) and the button is drawn
  // disabled.
  assert.notEqual(closeUnsignedListKey(state.cases), closeUnsignedListKey(before));
  const html = closeUnsignedDialogBody({ cases: state.cases });
  assert.doesNotMatch(html, /id="field-close-unsigned-confirmed"[^>]*checked/);
  assert.match(html, /id="close-unsigned-submit"[^>]*disabled/);
  controller.stop();
});

// ---------------------------------------------------------------------------
// The shaded section (change add-preparer-13614c-fields, design D5)
// ---------------------------------------------------------------------------

const shadedStore = () =>
  fakeStore({
    principal: { userId: "p1", workspaceId: "w1", access: "staff", personId: "alex" },
    people: [{ id: "alex", name: "Alex", capabilities: ["prepare"] }],
    cases: [
      {
        id: "case-s",
        reference: "VT-SHAD-ED22",
        stage: "preparing",
        revision: 7,
        answers: {},
        preparerId: "alex",
        participants: ["alex"],
        preparerShadedFields: [],
      },
    ],
  });

test("saveShadedSection sends the latest revision", async () => {
  const store = shadedStore();
  let next = 0;
  const { controller } = build({ store, newActionId: () => `action-${(next += 1)}` });
  await controller.start();
  await controller.selectCase("case-s");
  // The office logs a contact meanwhile: realtime brings the newer revision.
  store.records.set("case-s", { ...store.records.get("case-s"), revision: 9 });
  await store.handlers.onChange({ table: "cases", eventType: "UPDATE", id: "case-s", caseId: "case-s" });
  const fields = { incomeW2s: true, incomeW2sCount: 2 };
  await controller.saveShadedSection(fields, 0);
  const sent = store.writes.at(-1);
  assert.equal(sent.type, "SAVE_PREPARER_FIELDS");
  assert.equal(sent.caseId, "case-s");
  assert.equal(sent.expectedRevision, 9);
  assert.equal(sent.personId, null);
  assert.deepEqual(sent.payload, { fields, basedOnVersion: 0 });
  // Saved, in place beside the upload control.
  assert.deepEqual(controller.getState().shadedStatus, { caseId: "case-s", text: "Saved" });
  controller.stop();
});

// The read of an uploaded copy is held until the preparer confirms
// (change guard-shaded-upload-against-preview, design D1).

const shadedSends = (store) => store.writes.filter((write) => write.type === "SAVE_PREPARER_FIELDS");

async function openShadedCase({ withSecondCase = false } = {}) {
  const store = shadedStore();
  if (withSecondCase)
    store.records.set("case-t", { ...store.records.get("case-s"), id: "case-t", reference: "VT-SHAD-ED33", revision: 3 });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-s");
  return { store, controller };
}

test("a reviewed upload is sent only on confirm", async () => {
  const { store, controller } = await openShadedCase();
  controller.reviewShadedCopy({ values: { incomeW2s: true }, version: 0, preview: false });
  assert.equal(shadedSends(store).length, 0);
  assert.deepEqual(controller.getState().shadedReview, {
    caseId: "case-s",
    values: { incomeW2s: true },
    version: 0,
    preview: false,
  });
  assert.ok(await controller.confirmShadedReview());
  const sends = shadedSends(store);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].caseId, "case-s");
  assert.deepEqual(sends[0].payload, { fields: { incomeW2s: true }, basedOnVersion: 0 });
  const state = controller.getState();
  assert.equal(state.shadedReview, null);
  assert.deepEqual(state.shadedStatus, { caseId: "case-s", text: "Saved" });
  controller.stop();
});

test("a new upload under review clears this case's upload error and Saved", async () => {
  const { controller } = await openShadedCase();
  controller.noteLocalFailure({ code: "VALIDATION", message: "This file isn't a PDF the editor can read.", place: SHADED_UPLOAD });
  controller.reviewShadedCopy({ values: { incomeW2s: true }, version: 0, preview: true });
  const state = controller.getState();
  assert.equal(state.error, null);
  assert.equal(state.shadedStatus, null);
  assert.equal(state.shadedReview.preview, true);
  controller.stop();
});

test("cancel sends nothing", async () => {
  const { store, controller } = await openShadedCase();
  controller.reviewShadedCopy({ values: { incomeW2s: true }, version: 0, preview: false });
  controller.cancelShadedReview();
  assert.equal(shadedSends(store).length, 0);
  assert.equal(controller.getState().shadedReview, null);
  assert.equal(await controller.confirmShadedReview(), null);
  assert.equal(shadedSends(store).length, 0);
  controller.stop();
});

test("a case switch drops the review", async () => {
  const { store, controller } = await openShadedCase({ withSecondCase: true });
  controller.reviewShadedCopy({ values: { incomeW2s: true }, version: 0, preview: false });
  await controller.selectCase("case-t");
  assert.equal(controller.getState().shadedReview, null);
  assert.equal(await controller.confirmShadedReview(), null);
  assert.equal(shadedSends(store).length, 0);
  controller.stop();
});

test("sign-out drops the review", async () => {
  const { store, controller } = await openShadedCase();
  controller.reviewShadedCopy({ values: { incomeW2s: true }, version: 0, preview: false });
  await controller.signOut();
  assert.equal(controller.getState().shadedReview, null);
  assert.equal(await controller.confirmShadedReview(), null);
  assert.equal(shadedSends(store).length, 0);
  controller.stop();
});

test("the review survives a state change", async () => {
  const { store, controller } = await openShadedCase();
  const values = { incomeW2s: true, incomeW2sCount: 2 };
  controller.reviewShadedCopy({ values, version: 0, preview: false });
  // The office logs a contact meanwhile: realtime brings the newer revision.
  store.records.set("case-s", { ...store.records.get("case-s"), revision: 9 });
  await store.handlers.onChange({ table: "cases", eventType: "UPDATE", id: "case-s", caseId: "case-s" });
  const state = controller.getState();
  assert.equal(state.savedCase.revision, 9);
  assert.equal(state.shadedReview.caseId, "case-s");
  assert.deepEqual(state.shadedReview.values, values);
  // Confirming then sends it on the newer revision.
  await controller.confirmShadedReview();
  assert.equal(shadedSends(store).at(-1).expectedRevision, 9);
  controller.stop();
});

test("confirm is single-flight", async () => {
  const { store, controller } = await openShadedCase();
  controller.reviewShadedCopy({ values: { incomeW2s: true }, version: 0, preview: false });
  const first = controller.confirmShadedReview();
  assert.equal(await controller.confirmShadedReview(), null);
  await first;
  assert.equal(shadedSends(store).length, 1);
  controller.stop();
});

test("a CONFLICT after confirm keeps the stale-copy sentence", async () => {
  const { store, controller } = await openShadedCase();
  controller.reviewShadedCopy({ values: { incomeW2s: true }, version: 0, preview: false });
  // The section itself was saved since the copy was downloaded (version 0).
  store.records.set("case-s", {
    ...store.records.get("case-s"),
    revision: 8,
    preparerShadedFields: [{ version: 1, fields: {} }],
  });
  store.failNext = Object.assign(new Error("stale"), { code: "CONFLICT" });
  await assert.rejects(controller.confirmShadedReview(), (error) => error.code === "CONFLICT");
  assert.equal(shadedSends(store).length, 1);
  const state = controller.getState();
  assert.equal(state.error.place, SHADED_UPLOAD);
  assert.equal(
    state.error.message,
    "The shaded section was saved since this copy was downloaded. Download a fresh copy and fill that one.",
  );
  assert.equal(state.shadedReview, null);
  assert.equal(state.retryable, false);
  controller.stop();
});

test("an upload refused only because the case moved is sent once more on the new revision", async () => {
  const store = shadedStore();
  let next = 0;
  const { controller } = build({ store, newActionId: () => `action-${(next += 1)}` });
  await controller.start();
  await controller.selectCase("case-s");
  // The office records materials in another window; this window hasn't heard yet.
  store.records.set("case-s", { ...store.records.get("case-s"), revision: 8 });
  store.failNext = Object.assign(new Error("CONFLICT"), { code: "CONFLICT" });
  const fields = { incomeW2s: true, incomeW2sCount: 2 };
  assert.ok(await controller.saveShadedSection(fields, 0));
  const sends = store.writes.filter((write) => write.type === "SAVE_PREPARER_FIELDS");
  assert.equal(sends.length, 2);
  assert.equal(sends[0].expectedRevision, 7);
  assert.equal(sends[1].expectedRevision, 8);
  assert.notEqual(sends[0].actionId, sends[1].actionId);
  assert.deepEqual(sends[1].payload, { fields, basedOnVersion: 0 });
  const state = controller.getState();
  assert.equal(state.error, null);
  assert.deepEqual(state.shadedStatus, { caseId: "case-s", text: "Saved" });
  controller.stop();
});

test("an upload is never sent again to a case opened while it was out", async () => {
  const store = shadedStore();
  store.records.set("case-t", { ...store.records.get("case-s"), id: "case-t", reference: "VT-SHAD-ED33", revision: 3 });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-s");
  // The first send meets a CONFLICT, and the preparer opens another case meanwhile;
  // that case's section is also at version 0, as the copy's was.
  const act = store.act;
  let first = true;
  store.act = async (action) => {
    if (first) {
      first = false;
      await controller.selectCase("case-t");
      store.failNext = Object.assign(new Error("CONFLICT"), { code: "CONFLICT" });
    }
    return act(action);
  };
  assert.equal(await controller.saveShadedSection({ incomeW2s: true }, 0), null);
  const sends = store.writes.filter((write) => write.type === "SAVE_PREPARER_FIELDS");
  assert.equal(sends.length, 1);
  assert.equal(sends[0].caseId, "case-s");
  const state = controller.getState();
  assert.equal(state.savedCase.id, "case-t");
  // Nothing about case-s is said on case-t.
  assert.equal(state.shadedStatus, null);
  assert.equal(state.error, null);
  controller.stop();
});

test("an upload whose resend meets the case moving again asks for the same file again", async () => {
  const store = shadedStore();
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-s");
  // Every send meets a newer case revision; the section stays at version 0.
  const act = store.act;
  store.act = async (action) => {
    const record = store.records.get(action.caseId);
    store.records.set(action.caseId, { ...record, revision: record.revision + 1 });
    store.failNext = Object.assign(new Error("CONFLICT"), { code: "CONFLICT" });
    return act(action);
  };
  await assert.rejects(controller.saveShadedSection({ incomeW2s: true }, 0));
  assert.equal(store.writes.filter((write) => write.type === "SAVE_PREPARER_FIELDS").length, 2);
  const state = controller.getState();
  assert.equal(state.error.place, SHADED_UPLOAD);
  assert.equal(state.error.message, "The case changed while this copy was being saved. Upload the same file again.");
  assert.equal(state.retryable, false);
  assert.equal(state.shadedStatus, null);
  controller.stop();
});

test("a refused shaded save is said beside the upload control, with Dismiss only", async () => {
  const store = shadedStore();
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-s");
  // The section itself was saved since the copy was downloaded (version 0).
  store.records.set("case-s", {
    ...store.records.get("case-s"),
    revision: 8,
    preparerShadedFields: [{ version: 1, fields: {} }],
  });
  store.failNext = Object.assign(new Error("stale"), { code: "CONFLICT" });
  await assert.rejects(controller.saveShadedSection({}, 0), (error) => error.code === "CONFLICT");
  // A stale copy is not sent again.
  assert.equal(store.writes.filter((write) => write.type === "SAVE_PREPARER_FIELDS").length, 1);
  const state = controller.getState();
  // One name for the place, from contracts.mjs, shared by the controller and the page.
  assert.equal(SHADED_UPLOAD, "shaded-upload");
  assert.equal(state.error.place, SHADED_UPLOAD);
  assert.equal(
    state.error.message,
    "The shaded section was saved since this copy was downloaded. Download a fresh copy and fill that one.",
  );
  assert.equal(state.retryable, false);
  assert.equal(state.shadedStatus, null);
  // An unknown outcome is not offered again either: the upload is pressed again instead.
  store.failNext = Object.assign(new Error("offline"), { code: "OFFLINE" });
  await assert.rejects(controller.saveShadedSection({}, 0), (error) => error.code === "OFFLINE");
  assert.equal(controller.getState().retryable, false);
  assert.equal(controller.getState().error.place, SHADED_UPLOAD);
  assert.equal(await controller.retryLast(), null);
  // A failure the page records itself (a file it couldn't read) goes to the same place.
  controller.noteLocalFailure({ code: "VALIDATION", message: "This file isn't a PDF the editor can read.", place: SHADED_UPLOAD });
  assert.equal(controller.getState().error.place, SHADED_UPLOAD);
  controller.stop();
});

test("a second shaded save while one is out does nothing", async () => {
  const store = shadedStore();
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-s");
  const first = controller.saveShadedSection({ incomeW2s: true }, 0);
  assert.equal(await controller.saveShadedSection({ incomeW2s: true }, 0), null);
  await first;
  assert.equal(store.writes.filter((write) => write.type === "SAVE_PREPARER_FIELDS").length, 1);
  controller.stop();
});

test("an editor's shaded save leaves its refusals to the editor", async () => {
  const store = shadedStore();
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-s");
  for (const code of ["CONFLICT", "INVALID_TRANSITION", "OFFLINE"]) {
    store.failNext = Object.assign(new Error(code), { code });
    await assert.rejects(
      controller.saveShadedSection({ incomeW2s: true }, 0, { from: "editor" }),
      (error) => error.code === code,
    );
    const state = controller.getState();
    // The editor says it in its own status; nothing is said behind it.
    assert.equal(state.error, null, code);
    assert.equal(state.retryable, false, code);
    assert.equal(state.shadedStatus, null, code);
    assert.equal(await controller.retryLast(), null, code);
  }
  // An accepted save says Saved beside the tools, as an upload does.
  await controller.saveShadedSection({ incomeW2s: true }, 0, { from: "editor" });
  assert.deepEqual(controller.getState().shadedStatus, { caseId: "case-s", text: "Saved" });
  controller.stop();
});

test("an editor's save sent again after a CONFLICT goes out on the re-read revision", async () => {
  const store = shadedStore();
  let next = 0;
  const { controller } = build({ store, newActionId: () => `action-${(next += 1)}` });
  await controller.start();
  await controller.selectCase("case-s");
  // Another window moved the case (materials, say).
  (await store.getCase("case-s")).revision = 8;
  store.failNext = Object.assign(new Error("CONFLICT"), { code: "CONFLICT" });
  await assert.rejects(controller.saveShadedSection({ incomeW2s: true }, 0, { from: "editor" }));
  // The CONFLICT re-read the case; the section is still at the editor's version.
  assert.equal((controller.getState().savedCase.preparerShadedFields ?? [])[0]?.version ?? 0, 0);
  // The second send is not blocked by the first, and is not a retry envelope.
  assert.ok(await controller.saveShadedSection({ incomeW2s: true }, 0, { from: "editor" }));
  const sends = store.writes.filter((write) => write.type === "SAVE_PREPARER_FIELDS");
  assert.equal(sends.length, 2);
  assert.notEqual(sends[0].actionId, sends[1].actionId);
  // Pinned to the revision the window holds after the re-read, never older.
  assert.equal(sends[1].expectedRevision, 8);
  assert.equal(controller.getState().error, null);
  controller.stop();
});

test("an editor that couldn't be opened is recorded in the shaded panel, with Try again", async () => {
  const store = shadedStore();
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-s");
  let opened = 0;
  controller.noteLocalFailure(
    { code: "EDITOR", message: "The editor could not be opened. Try again, or use Download to fill elsewhere.", place: SHADED_EDITOR },
    () => void (opened += 1),
  );
  assert.equal(SHADED_EDITOR, "shaded-editor");
  assert.equal(controller.getState().error.place, SHADED_EDITOR);
  assert.equal(controller.getState().retryable, true);
  assert.deepEqual(await controller.retryLast(), { local: true });
  assert.equal(opened, 1);
  assert.equal(controller.getState().error, null);
  controller.stop();
});

// ---------------------------------------------------------------------------
// A staff account acts as its own person (add-staff-identity, design D9)
// ---------------------------------------------------------------------------

const STAFF_PRINCIPAL = Object.freeze({
  userId: "user-riley",
  workspaceId: "w1",
  access: "staff",
  email: "riley.park@example.test",
  personId: "person-riley",
  personName: "Riley Park",
});
const staffPeople = [
  { id: "person-riley", name: "Riley Park", capabilities: ["prepare", "admin", "followup"] },
  { id: "person-sam", name: "Sam", capabilities: ["admin", "followup"] },
];
const staffStore = (overrides = {}) =>
  fakeStore({ principal: { ...STAFF_PRINCIPAL }, people: staffPeople, ...overrides });

test("a staff start loads the staff landing and acts as the staff person", async () => {
  const store = staffStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "preparing", revision: 1, answers: {} }],
  });
  const { controller } = build({ store });
  await controller.start();
  const state = controller.getState();
  assert.equal(state.screen, "staff");
  assert.ok(store.calls.includes("listPeople"));
  assert.ok(store.calls.includes("listAssistance"));
  assert.ok(state.workspace, "the workspace is read");
  await controller.selectCase("case-a");
  assert.equal(controller.getState().screen, "staff-case");
  controller.stop();
});

// The staff twin of staff-views' "the viewer's own case ... show the
// revealable phone" and "someone else's case show the locked phone": the board
// is drawn from the controller's own state, so the viewer is whatever person
// the controller says this window acts as.
test("a staff board reveals the phone of the staff person's own case and locks another's", async () => {
  const boardRow = (html, reference) =>
    html.split('<tr class="board-row').slice(1).find((row) => row.includes(reference))?.split("</tr>")[0] ?? "";
  const onBoard = (overrides) => ({
    stage: "preparing",
    revision: 3,
    preparationVersion: 0,
    answers: { service: "Drop-off", language: "English" },
    intakeVerified: true,
    reviewerId: null,
    lastRemindedAt: null,
    updatedAt: "2026-09-12T16:30:00.000Z",
    phone: "2155550123",
    ...overrides,
  });
  const store = staffStore({
    // Riley is a volunteer here: office staff see every phone, which would
    // hide the rule.
    people: [
      { id: "person-riley", name: "Riley Park", capabilities: ["prepare"] },
      { id: "person-sam", name: "Sam", capabilities: ["prepare"] },
    ],
    cases: [
      onBoard({ id: "riley-1", reference: "VT-PHON-0001", preparerId: "person-riley" }),
      onBoard({ id: "sam-1", reference: "VT-PHON-0002", preparerId: "person-sam" }),
    ],
  });
  const { controller } = build({ store });
  await controller.start();
  controller.setBoardFilter("search", "VT-PHON");
  const html = staffScreen(controller.getState());
  const mine = boardRow(html, "VT-PHON-0001");
  assert.match(mine, /<span class="phone-mask" id="board-phone-riley-1" tabindex="0">/);
  assert.ok(mine.includes('<span class="phone-full">(215) 555-0123</span>'));
  const theirs = boardRow(html, "VT-PHON-0002");
  assert.match(theirs, /<span class="phone-mask is-locked" title="Claim this case to see the full number">/);
  assert.doesNotMatch(theirs, /555/, "the number reached Riley's locked row");
  controller.stop();
});

test("a staff controller's actions carry no person", async () => {
  const store = staffStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "preparation_ready", revision: 2, answers: {} }],
    assistance: [{ id: "item-1", caseId: null, kind: "intake_help", status: "open", revision: 4, assigneeId: null }],
  });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-a");
  await controller.runAction("CLAIM_PREPARATION", {});
  assert.equal(store.writes.at(-1).personId, null);
  await controller.logContact("case-a", CONTACT_ENTRY);
  assert.equal(store.writes.at(-1).personId, null);
  await controller.runAssistanceAction("CLAIM", "item-1");
  assert.equal(store.writes.at(-1).personId, null);
  controller.stop();
});

test("a staff window ignores a persona left in its storage and never stores one", async () => {
  const sessionStorage = fakeSession({
    "vitally:client:v1:user-riley": JSON.stringify({
      screen: "staff-case",
      selectedCaseId: "case-a",
      selectedPersonId: "person-sam",
    }),
  });
  const store = staffStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "preparation_ready", revision: 2, answers: {} }],
  });
  const { controller } = build({ store, sessionStorage });
  await controller.start();
  // The rest of the record is still this window's.
  assert.equal(controller.getState().selectedCaseId, "case-a");
  assert.ok(!("selectedPersonId" in controller.getState()), "the leftover is not restored");
  await controller.runAction("CLAIM_PREPARATION", {});
  assert.equal(store.writes.at(-1).personId, null, "Riley never acts as Sam");
  const record = JSON.parse(sessionStorage.raw("vitally:client:v1:user-riley"));
  assert.equal(record.selectedCaseId, "case-a");
  assert.ok(!("selectedPersonId" in record), "no persona is written for staff");
  controller.stop();
});

// Whether this window acts as an admin is decided by the account's own person.
test("screening starts for an admin staff member only", async () => {
  const admin = staffStore({ cases: [RECEIVED] });
  const first = build({ store: admin });
  await first.controller.start();
  await first.controller.selectCase("case-r");
  await tick();
  assert.equal(startWrites(admin).length, 1);
  assert.equal(startWrites(admin)[0].personId, null, "the store derives the person");
  first.controller.stop();

  const preparer = staffStore({
    cases: [RECEIVED],
    people: [{ id: "person-riley", name: "Riley Park", capabilities: ["prepare"] }],
  });
  const second = build({ store: preparer });
  await second.controller.start();
  await second.controller.selectCase("case-r");
  await tick();
  assert.equal(startWrites(preparer).length, 0);
  second.controller.stop();
});

test("a staff member without admin starts no screening, whatever persona the window once held", async () => {
  const sessionStorage = fakeSession({
    "vitally:client:v1:user-riley": JSON.stringify({ selectedPersonId: "person-sam" }),
  });
  const store = staffStore({
    cases: [RECEIVED],
    people: [{ id: "person-riley", name: "Riley Park", capabilities: ["prepare"] }, ...adminPeople],
  });
  const { controller } = build({ store, sessionStorage });
  await controller.start();
  await controller.selectCase("case-r");
  await tick();
  assert.equal(startWrites(store).length, 0);
  controller.stop();
});

test("a presenter's window loads nothing", async () => {
  const sessionStorage = fakeSession({
    "vitally:client:v1:p1": JSON.stringify({ screen: "case", selectedCaseId: "case-a" }),
  });
  const store = fakeStore({
    principal: { userId: "p1", workspaceId: "w1", access: "presenter" },
    people: [{ id: "person-1", name: "Alex", capabilities: ["prepare"] }],
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "received", revision: 1, answers: {} }],
  });
  const { controller } = build({ store, sessionStorage });
  await controller.start();
  assert.equal(controller.getState().screen, "presenter");
  for (const read of ["listCases", "listPeople", "getCase:case-a", "listAssistance", "getWorkspace"])
    assert.ok(!store.calls.includes(read), `${read} was called`);
  assert.equal(store.subscriptions, 0);
  controller.stop();
});

function inertPresenter() {
  const saved = JSON.stringify({ screen: "case", selectedCaseId: "case-a" });
  const sessionStorage = fakeSession({ "vitally:client:v1:p1": saved });
  const store = fakeStore({
    principal: { userId: "p1", workspaceId: "w1", access: "presenter" },
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "received", revision: 1, answers: {} }],
  });
  const { controller, events } = build({ store, sessionStorage });
  const quiet = async (trigger) => {
    await controller.start();
    const calls = store.calls.length;
    await trigger({ controller, events });
    assert.deepEqual(store.calls.slice(calls), []);
    assert.equal(store.subscriptions, 0);
    assert.equal(sessionStorage.raw("vitally:client:v1:p1"), saved);
    assert.equal(controller.getState().screen, "presenter");
    controller.stop();
  };
  return { store, quiet };
}

test("a presenter's window reads and saves nothing on tab focus", async () => {
  await inertPresenter().quiet(({ events }) => events.emit("focus"));
});

test("a presenter's window reads and saves nothing when back online", async () => {
  await inertPresenter().quiet(({ events }) => events.emit("online"));
});

test("a presenter's window reads and saves nothing on Try again (retry-connection)", async () => {
  // app.mjs sends retry-connection to controller.refresh().
  await inertPresenter().quiet(({ controller }) => controller.refresh());
});

test("a presenter's window makes no store call at all after getPrincipal", async () => {
  const { store, quiet } = inertPresenter();
  await quiet(async ({ controller, events }) => {
    await events.emit("focus");
    await events.emit("online");
    await controller.refresh();
    await controller.refresh();
  });
  assert.deepEqual(store.calls, ["getPrincipal"]);
});

test("a staff action sends no persona", async () => {
  const store = staffStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "preparation_ready", revision: 2, answers: {} }],
  });
  const { controller } = build({ store });
  await controller.start();
  await controller.selectCase("case-a");
  await controller.runAction("CLAIM_PREPARATION", {});
  assert.equal(store.writes.at(-1).type, "CLAIM_PREPARATION");
  assert.equal(store.writes.at(-1).personId, null);
  assert.ok(!("selectedPersonId" in controller.getState()));
  controller.stop();
});

// A change can still arrive on a channel this window released (a staff
// session's, before the same window started again as a presenter). The
// realtime path's three loads are each inert on their own.
test("every data load is inert for a presenter", async () => {
  const store = staffStore({
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "preparing", revision: 2, answers: {} }],
  });
  const { controller } = build({ store });
  await controller.start();
  const late = store.handlers;
  controller.stop();
  store.getPrincipal = async () => {
    store.calls.push("getPrincipal");
    return { userId: "p1", workspaceId: "w1", access: "presenter" };
  };
  await controller.start();
  assert.equal(controller.getState().screen, "presenter");
  const calls = store.calls.length;
  assert.equal(store.calls.at(-1), "getPrincipal");
  // A workspace change touches the list, the workspace and the assistance.
  await late.onChange({ table: "workspaces" });
  await late.onChange({ table: "cases", caseId: "case-a" });
  await late.onChange({ table: "assistance_items" });
  assert.deepEqual(store.calls.slice(calls), []);
  assert.equal(controller.getState().screen, "presenter");
  controller.stop();

  // And each load on its own, called directly in a window a presenter signed
  // in to first, reads nothing and leaves the lists as they were.
  const fresh = fakeStore({
    principal: { userId: "p1", workspaceId: "w1", access: "presenter" },
    cases: [{ id: "case-a", reference: "VT-AAAA-BBBB", stage: "preparing", revision: 2, answers: {} }],
  });
  const presenter = build({ store: fresh }).controller;
  await presenter.start();
  assert.deepEqual(fresh.calls, ["getPrincipal"]);
  const before = presenter.getState();
  await presenter.testing.loadList();
  // loadWorkspace's inert() guard sits in front of its staff-only check
  // (`!staffWindow()`), which also returns for a presenter, so removing that
  // guard can't fail this test. The review checks it by grep instead, as each
  // data load's first line.
  await presenter.testing.loadWorkspace();
  await presenter.testing.loadAssistance();
  assert.deepEqual(fresh.calls, ["getPrincipal"]);
  assert.deepEqual(presenter.getState().lists, before.lists);
  assert.equal(presenter.getState().workspace, before.workspace);
  assert.equal(presenter.getState().screen, "presenter");
  presenter.stop();
});
