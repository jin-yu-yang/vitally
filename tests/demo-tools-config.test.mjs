import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import test from "node:test";

// Returns the paths whose content carries the demoTools key. A committed
// public config must never have it: the server alone decides, from the local
// environment, whether the fill tools appear.
export function findDemoToolsConfigs(paths, read) {
  return paths.filter((path) => read(path).includes('"demoTools"'));
}

test("the scan flags a config that carries demoTools", () => {
  const found = findDemoToolsConfigs(["public-config.fake.json"], () =>
    '{"configured": true, "demoTools": true}');
  assert.deepEqual(found, ["public-config.fake.json"]);
  assert.deepEqual(findDemoToolsConfigs(["public-config.fake.json"], () => '{"configured": false}'), []);
});

test("no committed public config carries demoTools", () => {
  const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter((path) => /^public-config.*\.json$/.test(basename(path)));
  const found = findDemoToolsConfigs(tracked, (path) => readFileSync(path, "utf8"));
  assert.deepEqual(found, [], `demoTools must not be committed in: ${found.join(", ")}`);
});
