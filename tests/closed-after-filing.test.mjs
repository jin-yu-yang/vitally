import test from "node:test";
import assert from "node:assert/strict";
import { closedLine, CLOSED_OUTCOMES, sentence, t } from "../src/client-text.mjs";
import { describeStage, returnOutcome, BEFORE_FILING_NOTICE_REASONS, CLOSED_AFTER_FILING_NOTICE_REASON } from "../src/domain.mjs";
import { setHantMap } from "../src/hant.mjs";
import HANT from "../src/zh-hant.mjs";
setHantMap(HANT);
const panel = (lang, record) => describeStage("closed", lang, record).clientMessage;

// Issue #170: the client's status panel on a case closed after a return was
// filed must not say the return was not filed. Asserts only the negative.

const NOT_FILED = /Your return was not filed|您的报税表未递交/; // the whole-return line; a composed line may say one return was not filed
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

test("composed closed messages, exact", () => {
  const acceptedState = { closingReason: "withdrawn", federalMethod: "efile", stateMethod: "efile", federalResult: "rejected", stateResult: "accepted" };
  assert.equal(panel("en", acceptedState), "You withdrew this application. Your federal return was not filed. Your Pennsylvania return was filed and accepted. Do not file it again.");
  assert.equal(panel("zh-Hans", acceptedState), "您已撤回此申请。您的联邦报税表未递交。您的宾州报税表已递交并被接受。请勿再次递交。");
  assert.equal(panel("zh-Hant", acceptedState), sentence(panel("en", acceptedState), "zh-Hant"));
  assert.notEqual(panel("zh-Hant", acceptedState), panel("zh-Hans", acceptedState));
  const hantExact = "您已撤回此申請。您的聯邦報稅表未遞交。您的賓州報稅表已遞交並被接受。請勿再次遞交。";
  assert.equal(panel("zh-Hant", acceptedState), hantExact);
  assert.equal(sentence(panel("en", acceptedState), "zh-Hant"), hantExact);
  const waiting = { closingReason: "dismissed", federalMethod: "efile", stateMethod: "efile", federalResult: "rejected", stateResult: null };
  assert.equal(panel("en", waiting), "PCDC could not reach you, so this application was closed. Your federal return was not filed. Your Pennsylvania return was e-filed and is waiting for an answer. Do not file it again.");
  const paper = { closingReason: "out_of_scope", federalMethod: "efile", stateMethod: "paper", federalResult: "rejected", stateResult: "given_to_client" };
  assert.equal(panel("en", paper), "This application was closed because the return is outside what VITA volunteers can prepare. Your federal return was not filed. PCDC gave you your Pennsylvania return on paper. It is filed only after you mail it.");
  const noNeed = { closingReason: "no_need_to_file", federalMethod: "efile", stateMethod: "efile", federalResult: "accepted", stateResult: "rejected" };
  assert.equal(panel("en", noNeed), "A PCDC volunteer confirmed with you that nothing more needs to be prepared this year, so this application was closed. Your federal return was filed and accepted. Do not file it again. Your Pennsylvania return was not filed.");
});

test("nothing filed, duplicate, other and no reason read as today", () => {
  const bothRejected = { federalMethod: "efile", stateMethod: "efile", federalResult: "rejected", stateResult: "rejected" };
  const none = { federalMethod: null, stateMethod: null, federalResult: null, stateResult: null };
  const filed = { federalMethod: "efile", stateMethod: "efile", federalResult: "rejected", stateResult: "accepted" };
  for (const lang of ["en", "zh-Hans", "zh-Hant"]) {
    for (const reason of ["dismissed", "withdrawn", "out_of_scope", "no_need_to_file"])
      for (const filing of [bothRejected, none])
        assert.equal(panel(lang, { closingReason: reason, ...filing }), t(`stage.closed.client.${reason}`, {}, lang));
    assert.equal(panel(lang, { closingReason: "duplicate", ...filed }), t("stage.closed.client.duplicate", {}, lang));
    for (const closingReason of ["other", null])
      assert.equal(panel(lang, { closingReason, ...filed }), t("stage.closed.client", {}, lang));
  }
});

test("every composed line has its 简体 sentence", () => {
  // 4 reasons x 15 pairs = 60; each English line translates to its zh-Hans composition.
  let n = 0;
  for (const reason of ["dismissed", "withdrawn", "out_of_scope", "no_need_to_file"])
    for (const f of CLOSED_OUTCOMES) for (const s of CLOSED_OUTCOMES) {
      const en = closedLine(reason, f, s, "en");
      if (f === "not_filed" && s === "not_filed") { assert.equal(en, null); continue; }
      assert.equal(sentence(en, "zh-Hans"), closedLine(reason, f, s, "zh-Hans")); n++;
    }
  assert.equal(n, 60);
});

test("returnOutcome and the after-filing notice", () => {
  assert.equal(returnOutcome("efile", "accepted"), "accepted");
  assert.equal(returnOutcome("efile", null), "waiting");
  assert.equal(returnOutcome("paper", "given_to_client"), "paper");
  assert.equal(returnOutcome("paper", null), "paper");
  assert.equal(returnOutcome("efile", "rejected"), "not_filed");
  assert.equal(returnOutcome(null, null), "not_filed");
  assert.equal(CLOSED_AFTER_FILING_NOTICE_REASON, "The case was closed after a return was filed; make sure the rejected return is not transmitted again in TaxSlayer.");
  assert.ok(BEFORE_FILING_NOTICE_REASONS.includes(CLOSED_AFTER_FILING_NOTICE_REASON));
});
