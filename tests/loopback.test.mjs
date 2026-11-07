import test from "node:test";
import assert from "node:assert/strict";
import { isLoopbackUrl } from "../src/loopback.mjs";

test("loopback URLs", () => {
  for (const url of [
    "http://127.0.0.1:54321",
    "http://localhost:54321",
    "https://localhost",
    "http://[::1]:54321",
  ])
    assert.equal(isLoopbackUrl(url), true, url);
  for (const url of [
    "https://abcd.supabase.co",
    "http://127.0.0.1.example.org",
    "http://localhost.example.org",
    "http://user@localhost.evil.test",
    "ftp://localhost",
    "::1",
    "",
    undefined,
    42,
  ])
    assert.equal(isLoopbackUrl(url), false, String(url));
});
