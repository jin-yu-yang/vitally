import test from "node:test";
import assert from "node:assert/strict";
import {
  createWindowState,
  windowStateKey,
  ACCESS_KEY,
} from "../src/window-state.mjs";

// A session-storage double that also records what was written, so the tests can
// assert the stored document and not only what comes back out.
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

test("choices are stored per user and restored as they were", () => {
  const sessionStorage = fakeSession();
  const window = createWindowState({ sessionStorage });
  assert.equal(window.read("user-1"), null, "nothing stored is nothing restored");

  window.write("user-1", {
    screen: "staff-case",
    selectedCaseId: "case-a",
    openPanels: ["confirmed"],
    pendingCreateActionId: "action-1",
    boardFilters: { status: "available", assignment: "mine" },
  });
  window.write("user-2", { screen: "applications", selectedCaseId: "case-z" });

  assert.deepEqual(window.read("user-1"), {
    screen: "staff-case",
    selectedCaseId: "case-a",
    openPanels: ["confirmed"],
    pendingCreateActionId: "action-1",
    boardFilters: { status: "available", assignment: "mine" },
  });
  assert.deepEqual(window.read("user-2"), {
    screen: "applications",
    selectedCaseId: "case-z",
  });
  assert.deepEqual(sessionStorage.keys().toSorted(), [
    windowStateKey("user-1"),
    windowStateKey("user-2"),
  ]);
  assert.equal(windowStateKey("user-1"), "vitally:client:v1:user-1");
  // Staff filters live in the same record as the client's selection: one key
  // scheme, so one sign-out clears everything.
  assert.ok(sessionStorage.raw(windowStateKey("user-1")).includes("boardFilters"));
});

test("only known fields of the right shape survive a round trip", () => {
  const sessionStorage = fakeSession();
  const window = createWindowState({ sessionStorage });
  window.write("user-1", {
    screen: "staff",
    formStep: "2",
    openPanels: "confirmed",
    boardFilters: ["available"],
    selectedCaseId: 17,
    access: "presenter",
    answers: { firstName: "Mei" },
    authCode: "123456",
  });
  assert.deepEqual(window.read("user-1"), { screen: "staff" });
  const stored = sessionStorage.raw(windowStateKey("user-1"));
  for (const forbidden of ["answers", "authCode", "access", "Mei", "123456"])
    assert.ok(!stored.includes(forbidden), forbidden);
});

test("an unreadable record restores nothing and never throws", () => {
  const broken = fakeSession({
    [windowStateKey("user-1")]: "{not json",
    [ACCESS_KEY]: "[]",
  });
  const window = createWindowState({ sessionStorage: broken });
  assert.equal(window.read("user-1"), null);
  assert.deepEqual(window.readAccess(), {}, "a non-object access record is empty");

  // A window with no session storage at all behaves the same way.
  const none = createWindowState({});
  assert.equal(none.read("user-1"), null);
  none.write("user-1", { screen: "staff" });
  none.clear("user-1");
  assert.deepEqual(none.readAccess(), {});
  none.writeAccess({ startedAt: 1 });
  none.clearAccess();
  assert.equal(none.cooldownRemaining(65), 0);

  // Storage that refuses to be written is not a failure either.
  const refusing = createWindowState({
    sessionStorage: {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    },
  });
  assert.equal(refusing.read("user-1"), null);
  refusing.write("user-1", { screen: "staff" });
  refusing.clear("user-1");
});

test("clearing one user's record leaves the other window state alone", () => {
  const sessionStorage = fakeSession();
  const window = createWindowState({ sessionStorage });
  window.write("user-1", { screen: "staff", selectedCaseId: "case-a" });
  window.write("user-2", { screen: "applications" });
  window.writeAccess({ startedAt: 1_000, email: "mei@example.org" });

  window.clear("user-1");
  assert.equal(window.read("user-1"), null);
  assert.deepEqual(window.read("user-2"), { screen: "applications" });
  assert.equal(
    window.readAccess().email,
    "mei@example.org",
    "the access record belongs to the window, not to a user",
  );
  window.clearAccess();
  assert.deepEqual(window.readAccess(), {});
  assert.deepEqual(sessionStorage.keys(), [windowStateKey("user-2")]);
});

test("the cooldown is measured from the stored moment, not from this instance", () => {
  let now = 1_000_000;
  const sessionStorage = fakeSession();
  const window = createWindowState({ sessionStorage, clock: () => now });
  assert.equal(window.cooldownRemaining(65), 0, "no request, no cooldown");

  window.writeAccess({ startedAt: now, email: "mei@example.org", message: "Check your inbox." });
  assert.equal(window.cooldownRemaining(65), 65);
  now += 20_000;
  assert.equal(window.cooldownRemaining(65), 45);

  // A reload is a new collaborator over the same storage: the timer survives.
  const reloaded = createWindowState({ sessionStorage, clock: () => now });
  assert.equal(reloaded.cooldownRemaining(65), 45);
  now += 45_000;
  assert.equal(reloaded.cooldownRemaining(65), 0);
  now += 60_000;
  assert.equal(reloaded.cooldownRemaining(65), 0, "it never goes negative");

  // Nonsense in either input is no cooldown at all, never NaN.
  window.writeAccess({ startedAt: "soon" });
  assert.equal(window.cooldownRemaining(65), 0);
  window.writeAccess({ startedAt: now });
  assert.equal(window.cooldownRemaining(undefined), 0);
});

test("the sidebar choice is kept only when it is a real boolean", () => {
  const sessionStorage = fakeSession();
  const window = createWindowState({ sessionStorage });
  window.write("user-1", { screen: "staff", sidebarOpen: false });
  assert.deepEqual(window.read("user-1"), { screen: "staff", sidebarOpen: false });
  window.write("user-1", { screen: "staff", sidebarOpen: "no" });
  assert.deepEqual(window.read("user-1"), { screen: "staff" });
});

test("the case tab is kept as a string", () => {
  const sessionStorage = fakeSession();
  const window = createWindowState({ sessionStorage });
  window.write("user-1", { screen: "staff-case", caseTab: "documents" });
  assert.deepEqual(window.read("user-1"), { screen: "staff-case", caseTab: "documents" });
  window.write("user-1", { screen: "staff-case", caseTab: 3 });
  assert.deepEqual(window.read("user-1"), { screen: "staff-case" });
});

test("the version-2 sub-step is kept when it has a sub-step id's shape", () => {
  const sessionStorage = fakeSession();
  const window = createWindowState({ sessionStorage });
  window.write("user-1", { screen: "intake", formSubstep: "about.you" });
  assert.deepEqual(window.read("user-1"), { screen: "intake", formSubstep: "about.you" });
  window.write("user-1", { screen: "intake", formSubstep: "review.summary" });
  assert.equal(window.read("user-1").formSubstep, "review.summary");
  // The shape only: whether the catalogue has it is the controller's business.
  window.write("user-1", { screen: "intake", formSubstep: "old.gone_away" });
  assert.equal(window.read("user-1").formSubstep, "old.gone_away");
  for (const formSubstep of ["About.You", 5, "about", "about.", ".you", "about.you.x", "about.you2", null, ["about.you"]]) {
    window.write("user-1", { screen: "intake", formSubstep });
    assert.deepEqual(window.read("user-1"), { screen: "intake" }, JSON.stringify(formSubstep));
  }
});

// Design D8: version 1's place in the form was `formStep`, a step number. A
// record an older version wrote still holds it; `write` itself drops it now,
// so the stale record goes straight into storage and `read` must ignore it.
test("a version-1 step number saved by an older version is not restored", () => {
  const stale = JSON.stringify({ screen: "intake", formStep: 2, formSubstep: "about.you" });
  const sessionStorage = fakeSession({ [windowStateKey("user-1")]: stale });
  const window = createWindowState({ sessionStorage });
  assert.deepEqual(window.read("user-1"), { screen: "intake", formSubstep: "about.you" });
  window.write("user-1", { screen: "intake", formStep: 2, formSubstep: "about.you" });
  assert.deepEqual(JSON.parse(sessionStorage.raw(windowStateKey("user-1"))), { screen: "intake", formSubstep: "about.you" });
});

test("the revealed answers of one case round-trip", () => {
  const sessionStorage = fakeSession();
  const window = createWindowState({ sessionStorage });
  const revealedAnswers = { caseId: "case-a", ids: ["email", "hh[1].dob"] };
  window.write("user-1", { screen: "intake", revealedAnswers });
  assert.deepEqual(window.read("user-1"), { screen: "intake", revealedAnswers });
  window.write("user-1", { screen: "intake", revealedAnswers: { caseId: "case-a", ids: [] } });
  assert.deepEqual(window.read("user-1").revealedAnswers, { caseId: "case-a", ids: [] });
});

test("a malformed revealed-answers record is dropped whole", () => {
  const sessionStorage = fakeSession();
  const window = createWindowState({ sessionStorage });
  for (const revealedAnswers of [
    { caseId: 17, ids: [] },
    { caseId: "", ids: [] },
    { ids: ["email"] },
    { caseId: "case-a" },
    { caseId: "case-a", ids: ["email", 3] },
    { caseId: "case-a", ids: "email" },
    ["case-a", ["email"]],
    "case-a",
  ]) {
    window.write("user-1", { screen: "intake", revealedAnswers });
    assert.deepEqual(window.read("user-1"), { screen: "intake" }, JSON.stringify(revealedAnswers));
  }
});

test("a stored visited-steps record from 4b is ignored", () => {
  const stale = JSON.stringify({
    screen: "intake",
    visitedSteps: { caseId: "case-a", steps: [0, 1], revealed: ["email"] },
  });
  const sessionStorage = fakeSession({ [windowStateKey("user-1")]: stale });
  const window = createWindowState({ sessionStorage });
  assert.deepEqual(window.read("user-1"), { screen: "intake" });
  window.write("user-1", { screen: "intake", visitedSteps: { caseId: "case-a", steps: [0], revealed: [] } });
  assert.deepEqual(JSON.parse(sessionStorage.raw(windowStateKey("user-1"))), { screen: "intake" });
});

test("a staff window neither stores nor restores a persona", () => {
  // A persona left by a presenter window (or written by hand) under this key.
  const leftover = JSON.stringify({ screen: "staff", selectedPersonId: "person-sam" });
  const sessionStorage = fakeSession({ [windowStateKey("user-riley")]: leftover });
  const window = createWindowState({ sessionStorage });
  assert.deepEqual(window.read("user-riley"), { screen: "staff" });
  // A record holding nothing but the persona is nothing restored.
  sessionStorage.setItem(windowStateKey("user-riley"), JSON.stringify({ selectedPersonId: "person-sam" }));
  assert.equal(window.read("user-riley"), null);

  window.write("user-riley", { screen: "staff-case", selectedPersonId: "person-sam" });
  assert.deepEqual(JSON.parse(sessionStorage.raw(windowStateKey("user-riley"))), { screen: "staff-case" });
});

test("a stored persona is ignored and never written", () => {
  // A persona left in this tab by an earlier presenter window (or by hand).
  const leftover = JSON.stringify({ selectedPersonId: "p1", screen: "board" });
  const sessionStorage = fakeSession({ [windowStateKey("user-1")]: leftover });
  const window = createWindowState({ sessionStorage });
  assert.deepEqual(window.read("user-1"), { screen: "board" });
  window.write("user-1", { screen: "board", selectedPersonId: "p1" });
  assert.deepEqual(JSON.parse(sessionStorage.raw(windowStateKey("user-1"))), { screen: "board" });
});
