import test from "node:test";
import assert from "node:assert/strict";
import { parseRelabelArgs, workspaceFromRoster, describeResult } from "../tools/admin/relabel-season.mjs";

const usage = (error) => error.code === "RELABEL_USAGE";
const BASE = ["--target", "classroom", "--roster", "r.json", "--from", "2025", "--to", "2026"];

test("relabel-season reads its arguments, dry run by default", () => {
  assert.deepEqual(parseRelabelArgs(BASE), {
    target: { kind: "classroom" },
    rosterPath: "r.json",
    from: 2025,
    to: 2026,
    apply: false,
  });
  assert.equal(parseRelabelArgs([...BASE, "--apply"]).apply, true);
  assert.equal(parseRelabelArgs(["--apply", ...BASE]).apply, true);
});

test("relabel-season refuses unclear arguments", () => {
  for (const argv of [
    [],
    BASE.slice(0, 6),
    [...BASE, "--apply", "--apply"],
    [...BASE, "--from", "2024"],
    ["--target", "hosted", ...BASE.slice(2)],
    [...BASE.slice(0, 6), "--to", "2025"],
    [...BASE.slice(0, 6), "--to", "26"],
    [...BASE.slice(0, 6), "--to", "2101"],
    [...BASE, "--force"],
  ])
    assert.throws(() => parseRelabelArgs(argv), usage, argv.join(" "));
});

test("relabel-season takes the workspace from the roster file", () => {
  const id = "3f1c2b4a-8d7e-4f60-9a1b-2c3d4e5f6a7b";
  assert.equal(workspaceFromRoster({ workspaceId: id, staff: [] }), id);
  assert.throws(() => workspaceFromRoster({}), usage);
  assert.throws(() => workspaceFromRoster({ workspaceId: "nope" }), usage);
});

test("relabel-season reports counts only", () => {
  const text = describeResult({
    workspaceId: "w",
    from: 2025,
    to: 2026,
    applied: false,
    rosterEntries: 6,
    certificates: 18,
    cases: 9,
    counters: 1,
    people: 7,
    cleared: 5,
  });
  assert.match(text, /^Dry run, nothing written: season 2025 -> 2026/);
  assert.match(text, /6 roster entries, 18 certificates, 9 cases, 1 client-number counter/);
  assert.match(text, /--apply/);
});
