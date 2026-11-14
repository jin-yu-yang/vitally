import test from "node:test";
import assert from "node:assert/strict";
import { describeStage } from "../src/domain.mjs";

// Issue #170: the client's status panel on a case closed after a return was
// filed must not say the return was not filed. Asserts only the negative.

const NOT_FILED = /was not filed|未递交/;
const FILED = {
  "other return accepted": { federalMethod: "efile", stateMethod: "efile", federalResult: "rejected", stateResult: "accepted" },
  "other return waiting": { federalMethod: "efile", stateMethod: "efile", federalResult: "rejected", stateResult: null },
  "other return given to the client": { federalMethod: "efile", stateMethod: "paper", federalResult: "rejected", stateResult: "given_to_client" },
};

test("the closed status panel after a filed return (issue #170)", () => {
  for (const [label, filing] of Object.entries(FILED))
    for (const reason of ["dismissed", "withdrawn", "out_of_scope"])
      for (const lang of ["en", "zh-Hans"]) {
        const message = describeStage("closed", lang, { closingReason: reason, ...filing }).clientMessage;
        assert.ok(!NOT_FILED.test(message), `${label}, ${reason}, ${lang}: "${message}"`);
      }
});
