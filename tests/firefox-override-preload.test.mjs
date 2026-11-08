import test from "node:test";
import assert from "node:assert/strict";
import { withOverride } from "../tools/firefox-override-preload.mjs";

test("the Firefox preload adds --override after the caller's own arguments and keeps the rest", async () => {
  const seen = [];
  const launch = withOverride(async (options) => {
    seen.push(options);
    return "browser";
  }, "/fictional/override.ini");
  assert.equal(await launch({ headless: true, args: ["-wait-for-browser"] }), "browser");
  assert.equal(await launch(), "browser");
  assert.deepEqual(seen, [
    { headless: true, args: ["-wait-for-browser", "--override", "/fictional/override.ini"] },
    { args: ["--override", "/fictional/override.ini"] },
  ]);
});
