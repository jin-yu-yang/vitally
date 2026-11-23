import test from "node:test";
import assert from "node:assert/strict";
import { readWorkspaceSide, writeWorkspaceSide, WORKSPACE_SIDE_PREFIX } from "../src/workspace-side.mjs";

const fakeStorage = () => {
  const map = new Map();
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => void map.set(k, String(v)) };
};

test("a side round-trips per user", () => {
  const storage = fakeStorage();
  writeWorkspaceSide("u1", "cases", { storage });
  assert.equal(readWorkspaceSide("u1", { storage }), "cases");
  assert.equal(readWorkspaceSide("u2", { storage }), null);
  assert.equal(storage.map.get(`${WORKSPACE_SIDE_PREFIX}u1`), "cases");
});

test("anything else reads as nothing", () => {
  const storage = fakeStorage();
  storage.map.set(`${WORKSPACE_SIDE_PREFIX}u1`, "admin");
  assert.equal(readWorkspaceSide("u1", { storage }), null);
});

test("a bad side or missing user is not written", () => {
  const storage = fakeStorage();
  writeWorkspaceSide("u1", "admin", { storage });
  writeWorkspaceSide("", "office", { storage });
  writeWorkspaceSide(null, "office", { storage });
  assert.equal(storage.map.size, 0);
});

test("throwing storage never throws", () => {
  const storage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(readWorkspaceSide("u1", { storage }), null);
  assert.equal(writeWorkspaceSide("u1", "office", { storage }), undefined);
});

test("no storage", () => {
  assert.equal(readWorkspaceSide("u1", { storage: null }), null);
  assert.equal(writeWorkspaceSide("u1", "office", { storage: null }), undefined);
});
