import test from "node:test";
import assert from "node:assert/strict";
import { createAppError } from "../src/errors.mjs";
import { ERROR_CODES, SQLSTATE_ERROR_CODES } from "../src/contracts.mjs";

const safe = (error) => {
  assert.ok(error instanceof Error);
  assert.ok(ERROR_CODES.includes(error.code), `${error.code} is a domain code`);
  assert.equal(typeof error.message, "string");
  assert.ok(error.message.length > 0 && error.message.length <= 120);
  return error;
};

test("every VT sqlstate becomes its frozen domain code", () => {
  for (const [sqlstate, code] of Object.entries(SQLSTATE_ERROR_CODES)) {
    const original = {
      code: sqlstate,
      message: code,
      details: "cases.owner_user_id=…",
      hint: null,
    };
    const mapped = safe(createAppError(original));
    assert.equal(mapped.code, code);
    assert.equal(mapped.cause, original);
  }
});

test("standard permission denial maps to FORBIDDEN", () => {
  const original = { code: "42501", message: "permission denied for function" };
  const mapped = safe(createAppError(original));
  assert.equal(mapped.code, "FORBIDDEN");
  assert.equal(mapped.cause, original);
});

test("a transport failure with no code maps to OFFLINE", () => {
  // supabase-js reports a failed fetch with an empty code; a thrown fetch error has none.
  for (const original of [
    new TypeError("fetch failed"),
    { name: "FetchError", message: "FetchError: request to … failed", code: "" },
    { message: "socket hang up" },
  ]) {
    const mapped = safe(createAppError(original));
    assert.equal(mapped.code, "OFFLINE");
    assert.equal(mapped.cause, original);
  }
});

test("unexpected codes map to SERVER_ERROR with safe copy", () => {
  for (const original of [
    { code: "23505", message: "duplicate key value violates unique constraint" },
    { code: "PGRST202", message: "Could not find the function" },
    { code: "VT008", message: "not a frozen code" },
  ]) {
    const mapped = safe(createAppError(original));
    assert.equal(mapped.code, "SERVER_ERROR");
    assert.equal(mapped.cause, original);
    assert.ok(!mapped.message.includes(original.message));
    assert.ok(!mapped.message.includes(original.code));
  }
});

test("mapping reads the code alone, never the message or a status", () => {
  // A message that mentions VT002 under a different code must not become NOT_FOUND.
  assert.equal(
    createAppError({ code: "23503", message: "VT002 NOT_FOUND" }).code,
    "SERVER_ERROR",
  );
  assert.equal(
    createAppError({ code: "VT002", message: "", status: 500 }).code,
    "NOT_FOUND",
  );
  assert.equal(
    createAppError({ code: "VT001", status: 200 }).code,
    "FORBIDDEN",
  );
});

test("safe copy never repeats database wording", () => {
  const codes = new Set(
    [
      ...Object.keys(SQLSTATE_ERROR_CODES).map((sqlstate) => ({
        code: sqlstate,
      })),
      { code: "42501" },
      { code: "23505" },
      {},
    ].map((original) => createAppError(original).code),
  );
  assert.equal(codes.size, 10);
  for (const original of [{ code: "VT002" }, { code: "42501" }, {}]) {
    const mapped = createAppError(original);
    assert.ok(!mapped.message.includes(mapped.code));
    assert.ok(!/sqlstate|pg|postgres|vt00/i.test(mapped.message));
  }
});

test("VT009 becomes NOT_CLEARED with its safe message", () => {
  const mapped = safe(createAppError({ code: "VT009", message: "internal" }));
  assert.equal(mapped.code, "NOT_CLEARED");
  assert.equal(mapped.message, "Finish your setup for this season first.");
});
