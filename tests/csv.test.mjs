import test from "node:test";
import assert from "node:assert/strict";
import { toCsv } from "../src/csv.mjs";

test("starts with a BOM and ends lines with CR LF", () => {
  assert.equal(toCsv(["A", "B"], [["1", "2"]]), "﻿A,B\r\n1,2\r\n");
});
test("quotes commas, quotes, CR and LF, doubling quotes", () => {
  assert.equal(toCsv(["A"], [['Tagalog, "Filipino"'], ["x\ny"], ["x\ry"]]),
    '﻿A\r\n"Tagalog, ""Filipino"""\r\n"x\ny"\r\n"x\ry"\r\n');
});
test("guards cells that start like a formula, phones included", () => {
  const out = toCsv(["A"], [["=HYPERLINK(1)"], ["+1 555 0100"], ["-2"], ["@x"], ["\tx"], ["\rx"]]);
  assert.deepEqual(out.slice(1).split("\r\n").slice(1, 6), ["'=HYPERLINK(1)", "'+1 555 0100", "'-2", "'@x", "'\tx"]);
  assert.match(out, /"'\rx"/);
});
test("null and undefined are empty cells", () => {
  assert.equal(toCsv(["A", "B"], [[null, undefined]]), "﻿A,B\r\n,\r\n");
});
