import test from "node:test";
import assert from "node:assert/strict";
import {
  describeStage,
  filingMessage,
  phaseTab,
  BOARD_TABS,
  signingWhen,
  filingMethodKind,
  returnState,
  waitingReturns,
  awaitsAcknowledgment,
  returnedToSigning,
  latestFixNote,
  holdKind,
  canWithdraw,
  mustContactToWithdraw,
  WITHDRAW_STAGES,
  CLOSING_REASON_NAMES,
} from "../src/domain.mjs";
import { spawnSync } from "node:child_process";
import { historyLine, t } from "../src/client-text.mjs";
import {
  CASE_ACTIONS,
  ERROR_CODES,
  REFERENCE_ALPHABET,
  REFERENCE_PATTERN,
  SQLSTATE_ERROR_CODES,
  STAGES,
} from "../src/contracts.mjs";

// The in-browser case machine of the local prototype is gone: stages,
// authority, revisions and history are the database's, and every transition it
// used to simulate is covered authoritatively by the live suites in
// `tests/database-*.mjs` (see the Task 6 report for the assertion-by-assertion
// map). What remains here is what the browser still decides for itself: what it
// may show, what it may send, and what it may say about a stage.

test("every server stage has plain status copy and no workflow decision", () => {
  const described = STAGES.map((stage) => describeStage(stage));
  for (const [index, stage] of STAGES.entries()) {
    const { label, clientMessage } = described[index];
    assert.equal(typeof label, "string", stage);
    assert.equal(typeof clientMessage, "string", stage);
    assert.ok(label.length > 0 && label.length <= 40, stage);
    assert.ok(clientMessage.length > 0, stage);
    // Status copy is client-facing: no internal words, no money, and no claim
    // of a milestone the case has not reached. The efiled message names
    // e-filing because the case is there.
    for (const word of [
      "findings",
      "refund",
      "bank",
      "routing",
      "deposit",
      "$",
    ])
      // Accepted points to the refund websites (spec case-lifecycle), and says nothing about money.
      assert.ok(
        (stage === "accepted" && word === "refund") || !clientMessage.toLowerCase().includes(word),
        `${stage} must not mention ${word}`,
      );
  }
  // Every stage is described distinctly, and the table is stage-keyed only.
  assert.equal(
    new Set(described.map((entry) => entry.label)).size,
    STAGES.length,
  );
  assert.deepEqual(Object.keys(describeStage("reviewing")).sort(), [
    "clientLabel",
    "clientMessage",
    "label",
  ]);
  assert.equal(describeStage("reviewing").label, "Review in progress");
  assert.match(
    describeStage("corrections_required").clientMessage,
    /No action is needed from you right now/,
  );
  // Approval says signing comes next (neutral: no form name); it does not claim it was signed.
  assert.equal(
    describeStage("review_approved").clientMessage,
    "Your return has been checked. PCDC will contact you to sign it. Your return can't be filed until you sign.",
  );
  // Pure: the same input answers the same way, and an edited result never
  // changes the next answer.
  const first = describeStage("preparing");
  first.label = "Changed";
  assert.equal(describeStage("preparing").label, "Filing in progress (preparing)");
  assert.deepEqual(describeStage("preparing"), describeStage("preparing"));
  // Anything the server never sends falls back to neutral copy.
  for (const unknown of [
    "signed",
    "filed",
    "approved",
    "",
    undefined,
    null,
    "toString",
  ])
    assert.deepEqual(describeStage(unknown), {
      label: "Application",
      clientLabel: "Application",
      clientMessage:
        "This application is with the office. Contact PCDC if you have questions.",
    });
});

test("shared case contracts expose readable references and frozen vocabularies", () => {
  assert.equal(REFERENCE_ALPHABET, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
  assert.equal(REFERENCE_PATTERN.test("VT-A2BC-DE9F"), true);
  assert.equal(REFERENCE_PATTERN.test("VT-A1BC-DE0F"), false);
  assert.deepEqual(STAGES, [
    "draft",
    "received",
    "screening",
    "awaiting_documents",
    "preparation_ready",
    "preparing",
    "review_ready",
    "reviewing",
    "corrections_required",
    "review_approved",
    "on_hold",
    "ready_to_efile",
    "efiled",
    "rejected",
    "accepted",
    "closed",
  ]);
  assert.deepEqual(CASE_ACTIONS, [
    "SAVE_ANSWERS",
    "SUBMIT",
    "START_SCREENING",
    "VERIFY_INTAKE",
    "CLAIM_PREPARATION",
    "REQUEST_DOCUMENT",
    "RESPOND_DOCUMENT",
    "RECORD_DOCUMENT_RESPONSE",
    "VERIFY_DOCUMENT",
    "ESCALATE_CONTACT",
    "RESOLVE_FOLLOWUP",
    "SUBMIT_REVIEW",
    "CLAIM_REVIEW",
    "REQUEST_CORRECTIONS",
    "RESUBMIT_REVIEW",
    "APPROVE_REVIEW",
    "RECORD_REVIEW_CONTACT",
    "MARK_READY_TO_EFILE",
    "MARK_EFILED",
    "RECORD_FILING_RESULT",
    "RETURN_TO_SIGNING",
    "REMIND",
    "REQUEST_DOCUMENTS_AT_INTAKE",
    "PUT_ON_HOLD",
    "RESUME_FROM_HOLD",
    "WITHDRAW",
    "CLOSE_CASE",
    "UPDATE_CONTACT",
    "RECORD_MATERIALS",
    "SET_DOCUMENT_CARD",
    "SET_DOCUMENT_GROUP",
    "SAVE_PREPARER_FIELDS",
    "ASSIGN_CASE",
  ]);
  assert.deepEqual(ERROR_CODES, [
    "FORBIDDEN",
    "NOT_FOUND",
    "CONFLICT",
    "INVALID_TRANSITION",
    "SELF_REVIEW",
    "INELIGIBLE",
    "VALIDATION",
    "NOT_CLEARED",
    "OFFLINE",
    "SERVER_ERROR",
  ]);
  assert.deepEqual(SQLSTATE_ERROR_CODES, {
    VT001: "FORBIDDEN",
    VT002: "NOT_FOUND",
    VT003: "CONFLICT",
    VT004: "INVALID_TRANSITION",
    VT005: "SELF_REVIEW",
    VT006: "INELIGIBLE",
    VT007: "VALIDATION",
    VT009: "NOT_CLEARED",
  });
  assert.equal(Object.isFrozen(STAGES), true);
  assert.equal(Object.isFrozen(CASE_ACTIONS), true);
  assert.equal(Object.isFrozen(ERROR_CODES), true);
  assert.equal(Object.isFrozen(SQLSTATE_ERROR_CODES), true);
});

test("each of today's stages belongs to exactly one board tab, or none", () => {
  assert.deepEqual(
    BOARD_TABS.map(([value]) => value),
    ["available", "preparation", "review"],
  );
  const cases = [
    [{ stage: "preparation_ready", preparerId: null }, "available"],
    [{ stage: "preparation_ready", preparerId: "alex" }, "preparation"],
    [{ stage: "preparing", preparerId: "alex" }, "preparation"],
    [{ stage: "corrections_required", preparerId: "alex" }, "preparation"],
    [{ stage: "review_ready", reviewerId: null }, "review"],
    [{ stage: "reviewing", reviewerId: "morgan" }, "review"],
    [{ stage: "draft" }, null],
    [{ stage: "received" }, null],
    [{ stage: "review_approved" }, null],
    [{ stage: "closed" }, null],
    [{ stage: "nonsense" }, null],
    [null, null],
  ];
  for (const [record, tab] of cases)
    assert.equal(phaseTab(record), tab, JSON.stringify(record));
});

// Part 4d: stage text in the client's language; English unchanged by default.
test("describeStage takes a language; English is the default and unchanged", async () => {
  const { setHantMap } = await import("../src/hant.mjs");
  const { default: MAP } = await import("../src/zh-hant.mjs");
  const english = describeStage("reviewing");
  assert.deepEqual(describeStage("reviewing", "en"), english);
  assert.equal(english.clientMessage, "An independent reviewer is checking your return.");
  const zh = describeStage("reviewing", "zh-Hans");
  assert.match(zh.clientMessage, /\p{Script=Han}/u);
  assert.match(zh.clientLabel, /\p{Script=Han}/u);
  assert.equal(zh.label, "Review in progress", "staff names stay English");
  assert.deepEqual(Object.keys(zh).sort(), ["clientLabel", "clientMessage", "label"]);
  for (const stage of [...STAGES, "nonsense", null]) {
    const text = describeStage(stage, "zh-Hans");
    assert.match(text.clientLabel, /\p{Script=Han}/u, String(stage));
    assert.match(text.clientMessage, /\p{Script=Han}/u, String(stage));
    assert.deepEqual(describeStage(stage, "fr"), describeStage(stage), "an unknown language is English");
  }
  assert.equal(new Set(STAGES.map((stage) => describeStage(stage, "zh-Hans").clientLabel)).size, STAGES.length);
  setHantMap(MAP);
  try {
    assert.equal(describeStage("reviewing", "zh-Hant").clientMessage, MAP[zh.clientMessage]);
  } finally {
    setHantMap(null);
  }
});

test("the text table's English stage entries match STAGE_DESCRIPTIONS", async () => {
  const { t } = await import("../src/client-text.mjs");
  for (const stage of [...STAGES, "unknown"]) {
    const english = describeStage(stage === "unknown" ? "nonsense" : stage);
    assert.equal(t(`stage.${stage}.label`), english.clientLabel, stage);
    // Rejected and Accepted are built per return (filingMessage); their base is the closing sentence.
    if (stage === "rejected" || stage === "accepted") {
      assert.equal(t(`filing.closing.${stage}`), english.clientMessage, stage);
      continue;
    }
    assert.equal(t(`stage.${stage}.client`), english.clientMessage, stage);
  }
});

test("each stage has a staff name, a client label and a client message", () => {
  const STAFF = { draft: "Draft", received: "Request sent", screening: "Screening in progress", awaiting_documents: "Waiting for documents", preparation_ready: "Pending intake / filing", preparing: "Filing in progress (preparing)", corrections_required: "Corrections in progress", review_ready: "Pending review", reviewing: "Review in progress", review_approved: "Ready to exit", on_hold: "Hold", ready_to_efile: "Ready to e-file", efiled: "E-filed", rejected: "Rejected", accepted: "Accepted", closed: "Closed" };
  const CLIENT_EN = { draft: "Draft", received: "Sent to PCDC", screening: "Being reviewed", awaiting_documents: "Documents needed", preparation_ready: "Waiting for a volunteer", preparing: "Being prepared", corrections_required: "Being corrected", review_ready: "Waiting for review", reviewing: "Being checked", review_approved: "Ready to sign", on_hold: "Waiting for you", ready_to_efile: "Ready", efiled: "E-filed", rejected: "Needs a correction", accepted: "Complete", closed: "Closed" };
  const CLIENT_ZH = { draft: "草稿", received: "已发送给 PCDC", screening: "审核中", awaiting_documents: "需要文件", preparation_ready: "等待志愿者", preparing: "准备中", corrections_required: "正在更正", review_ready: "等待检查", reviewing: "检查中", review_approved: "等待签名", on_hold: "等待您的回复", ready_to_efile: "已准备好", efiled: "已电子递交", rejected: "需要更正", accepted: "已完成", closed: "已关闭" };
  const MESSAGES = {
    received: ["Your application is with PCDC. The office will review it soon and may call you.", "PCDC 已收到您的申请。办公室会尽快查看，并可能致电您。"],
    screening: ["PCDC is reviewing your application. We may call you to confirm your information and documents.", "PCDC 正在审核您的申请。我们可能会致电您，核对您的信息和文件。"],
    preparation_ready: ["Your application has been checked. It is waiting for a volunteer to start preparing your return.", "您的申请已核对完毕，正在等待志愿者开始准备您的报税表。"],
    review_ready: ["Your return is prepared and is waiting for an independent reviewer.", "您的报税表已准备好，正在等待审核志愿者检查。"],
    review_approved: ["Your return has been checked. PCDC will contact you to sign it. Your return can't be filed until you sign.", "您的报税表已检查完毕。PCDC 会联系您签署报税表。您签署后才能递交报税表。"],
    ready_to_efile: ["Your return is ready. PCDC will take the next step.", "您的报税表已准备好。PCDC 会进行下一步。"],
    efiled: ["Your return was e-filed. The IRS will confirm whether it is accepted.", "您的报税表已电子递交。国税局会确认是否接受。"],
  };
  for (const stage of STAGES) {
    assert.equal(describeStage(stage).label, STAFF[stage], stage);
    assert.equal(describeStage(stage, "zh-Hans").label, STAFF[stage], `${stage}: staff names stay English`);
    assert.equal(describeStage(stage).clientLabel, CLIENT_EN[stage], stage);
    assert.equal(describeStage(stage, "zh-Hans").clientLabel, CLIENT_ZH[stage], stage);
    assert.ok(describeStage(stage).clientMessage && describeStage(stage, "zh-Hans").clientMessage, stage);
  }
  for (const [stage, [en, zh]] of Object.entries(MESSAGES)) {
    assert.equal(describeStage(stage).clientMessage, en, stage);
    assert.equal(describeStage(stage, "zh-Hans").clientMessage, zh, stage);
  }
});

const PHONE = /\d{3}\D{0,2}\d{3}\D{0,2}\d{4}/;
const NEW_HISTORY = [
  ["PCDC started reviewing your application. We may call you.", "PCDC 已开始审核您的申请。我们可能会致电您。"],
  ["PCDC recorded that you signed Form 8879. Your return is ready to e-file.", "PCDC 已记录您签署了 8879 表。您的报税表可以电子递交了。"],
  ["PCDC e-filed your return.", "PCDC 已电子递交您的报税表。"],
];

test("no stage message or new history line names a phone number", () => {
  for (const stage of STAGES)
    for (const lang of ["en", "zh-Hans"]) {
      assert.doesNotMatch(describeStage(stage, lang).clientMessage, PHONE, `${stage} ${lang}`);
      assert.doesNotMatch(describeStage(stage, lang).clientLabel, PHONE, `${stage} ${lang}`);
    }
  for (const [line] of NEW_HISTORY)
    for (const lang of ["en", "zh-Hans"]) assert.doesNotMatch(historyLine(line, lang), PHONE, `${line} ${lang}`);
});

// ---- Ready to exit variants (design D11) ----
const READY = "Your return has been checked. ";
const VARIANTS = {
  appointment: {
    en: `${READY}Please come to PCDC on Monday, November 2 at 2:30 PM to sign it. Your return can't be filed until you sign.`,
    "zh-Hans": "您的报税表已检查完毕。请于 11月2日星期一 下午2:30 到 PCDC 签署报税表。您签署后才能递交报税表。",
  },
  same_day: {
    en: `${READY}Please sign it with a volunteer before you leave today. Your return can't be filed until you sign.`,
    "zh-Hans": "您的报税表已检查完毕。请在今天离开前与志愿者一起签署报税表。您签署后才能递交报税表。",
  },
  portal: {
    en: `${READY}Please e-sign Form 8879 in the TaxSlayer Customer Portal. Your return can't be filed until you sign.`,
    "zh-Hans": "您的报税表已检查完毕。请在 TaxSlayer 客户门户（Customer Portal）以电子方式签署 8879 表。您签署后才能递交报税表。（门户为英文页面，可用浏览器翻译）",
  },
  go_over_first: {
    en: `${READY}PCDC will contact you to go over your return together. After that, you will sign it. Your return can't be filed until you sign.`,
    "zh-Hans": "您的报税表已检查完毕。PCDC 会联系您，先和您一起查看报税表，再请您签署。您签署后才能递交报税表。",
  },
};
const planRecord = (signingPlan) => ({
  stage: "review_approved",
  signingPlan,
  signingAppointmentAt: signingPlan === "appointment" ? "2026-11-02T14:30:00" : null,
});

test("each Ready to exit variant in English and 简体", () => {
  for (const [plan, texts] of Object.entries(VARIANTS))
    for (const [lang, text] of Object.entries(texts))
      assert.equal(describeStage("review_approved", lang, planRecord(plan)).clientMessage, text, `${plan} ${lang}`);
});

test("wording review strings", () => {
  const goOver = describeStage("review_approved", "en", planRecord("go_over_first")).clientMessage;
  assert.ok(goOver.includes("go over your return together. After that, you will sign it. Your return can't be filed until you sign."));
  const portal = describeStage("review_approved", "zh-Hans", planRecord("portal")).clientMessage;
  assert.ok(portal.endsWith("您签署后才能递交报税表。（门户为英文页面，可用浏览器翻译）"));
});

test("appointment text", () => {
  assert.equal(signingWhen("2026-11-02T14:30", "en"), "Monday, November 2 at 2:30 PM");
  assert.equal(signingWhen("2026-11-02T14:30:00", "zh-Hans"), "11月2日星期一 下午2:30");
  assert.equal(signingWhen("2026-11-02T14:30:00", "zh-Hant"), "11月2日星期一 下午2:30");
  const hant = describeStage("review_approved", "zh-Hant", planRecord("appointment")).clientMessage;
  assert.ok(hant.includes("11月2日星期一 下午2:30"));
});

// The shape is assembled from formatToParts, so it cannot drift with the ICU
// version (Node 24.13's ICU 77 put a space after 日 in zh-Hant; 24.21's ICU 78 does not).
test("appointment text around midnight and noon", () => {
  assert.equal(signingWhen("2026-11-02T00:05", "en"), "Monday, November 2 at 12:05 AM");
  assert.equal(signingWhen("2026-11-02T12:00", "en"), "Monday, November 2 at 12:00 PM");
  assert.equal(signingWhen("2026-11-02T09:07", "zh-Hans"), "11月2日星期一 上午9:07");
  assert.equal(signingWhen("2026-11-02T00:05", "zh-Hant"), "11月2日星期一 上午12:05");
});

test("appointment text ignores the time zone", () => {
  const script = `import { describeStage } from ${JSON.stringify(new URL("../src/domain.mjs", import.meta.url).href)};
    const r = { stage: "review_approved", signingPlan: "appointment", signingAppointmentAt: "2026-11-02T14:30:00" };
    console.log(JSON.stringify(["en", "zh-Hans", "zh-Hant"].map((l) => describeStage("review_approved", l, r).clientMessage)));`;
  const outputs = ["Asia/Shanghai", "America/Los_Angeles", "UTC"].map((TZ) => {
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ }, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout;
  });
  assert.equal(outputs[0], outputs[1]);
  assert.equal(outputs[0], outputs[2]);
  assert.ok(JSON.parse(outputs[0])[0].includes("Monday, November 2 at 2:30 PM"));
});

test("no plan keeps today's message", () => {
  for (const record of [undefined, null, { stage: "review_approved", signingPlan: null }, { stage: "review_approved" }])
    for (const lang of ["en", "zh-Hans"]) {
      const bare = describeStage("review_approved", lang);
      assert.deepEqual(describeStage("review_approved", lang, record), bare);
    }
});

test("other stages ignore the plan", () => {
  for (const lang of ["en", "zh-Hans"])
    assert.deepEqual(
      describeStage("ready_to_efile", lang, planRecord("portal")),
      describeStage("ready_to_efile", lang),
    );
});

test("no variant names a phone number or a money word", () => {
  const MONEY_WORDS = ["$", "refund", "bank", "routing", "deposit", "account number", "direct debit", "退税", "银行", "存款"];
  for (const plan of Object.keys(VARIANTS))
    for (const lang of ["en", "zh-Hans", "zh-Hant"]) {
      const text = describeStage("review_approved", lang, planRecord(plan)).clientMessage;
      assert.ok(!/\d{3}[-.\s)]*\d{3,4}/.test(text), `${plan} ${lang} has a phone-like number`);
      for (const word of MONEY_WORDS) assert.ok(!text.toLowerCase().includes(word), `${plan} ${lang} says ${word}`);
    }
});

// ---- Filing methods and results (change add-post-efiling-stages) ----
const methods = (federalMethod, stateMethod, extra = {}) => ({ federalMethod, stateMethod, ...extra });

test("describeStage names E-filed and Accepted by filing method, for staff and for the client", () => {
  const cases = [
    ["efiled", methods("efile", "efile"), "Both e-filed", "E-filed", "已电子递交"],
    ["efiled", methods("efile", "paper"), "E-filed, PA on paper", "Filed", "已递交"],
    ["efiled", methods("paper", "efile"), "E-filed, federal on paper", "Filed", "已递交"],
    ["efiled", methods("paper", "paper"), "Both paper", "Filed", "已递交"],
    ["efiled", methods(null, null), "E-filed", "E-filed", "已电子递交"],
    ["efiled", null, "E-filed", "E-filed", "已电子递交"],
    ["accepted", methods("efile", "efile"), "Accepted", "Complete", "已完成"],
    ["accepted", methods("efile", "paper"), "Accepted, PA on paper", "Ready to mail", "待邮寄"],
    ["accepted", methods("paper", "efile"), "Accepted, federal on paper", "Ready to mail", "待邮寄"],
    ["accepted", methods("paper", "paper"), "Paper", "Ready to mail", "待邮寄"],
    ["accepted", methods(null, null), "Accepted", "Complete", "已完成"],
    ["rejected", methods("efile", "efile"), "Rejected", "Needs a correction", "需要更正"],
    ["rejected", null, "Rejected", "Needs a correction", "需要更正"],
  ];
  for (const [stage, record, staff, client, zh] of cases) {
    const en = describeStage(stage, "en", record);
    assert.equal(en.label, staff, `${stage} ${JSON.stringify(record)}`);
    assert.equal(en.clientLabel, client, `${stage} ${JSON.stringify(record)}`);
    const hans = describeStage(stage, "zh-Hans", record);
    assert.equal(hans.label, staff, "staff names stay English");
    assert.equal(hans.clientLabel, zh, `${stage} ${JSON.stringify(record)}`);
    assert.ok(en.clientMessage && hans.clientMessage);
  }
  // A method never renames another stage.
  assert.equal(describeStage("closed", "en", methods("paper", "paper")).label, "Closed");
});

// ---- Hold and closing (change add-hold-and-closing) ----
const CLOSED_MESSAGES = {
  out_of_scope: ["This application was closed because the return is outside what VITA volunteers can prepare. Your return was not filed by PCDC.", "此申请已关闭，因为该报税表超出了 VITA 志愿者可以准备的范围。PCDC 未递交您的报税表。"],
  no_need_to_file: ["A PCDC volunteer confirmed with you that you don't need to file a return this year, so this application was closed.", "PCDC 志愿者已与您确认，您今年无需递交报税表，因此此申请已关闭。"],
  duplicate: ["This application was closed. Your return continues under your other application with PCDC.", "此申请已关闭。您的报税表将在您在 PCDC 的另一份申请中继续处理。"],
  dismissed: ["PCDC could not reach you, so this application was closed. Your return was not filed.", "PCDC 无法联系到您，因此此申请已关闭。您的报税表未递交。"],
  withdrawn: ["You withdrew this application. Your return was not filed.", "您已撤回此申请。您的报税表未递交。"],
  other: ["This application was closed by the office. This does not change any return filed elsewhere.", "此申请已由办公室关闭。这不影响在其他地方递交的任何报税表。"],
};

test("Closed carries its reason's staff name, and the client reads the message for the reason", () => {
  assert.deepEqual(CLOSING_REASON_NAMES, {
    out_of_scope: "Out of scope",
    no_need_to_file: "No need to file",
    duplicate: "Duplicate",
    dismissed: "Dismissed (client unreachable)",
    withdrawn: "Withdrawn",
    other: "Other",
  });
  assert.equal(describeStage("closed", "en", { closingReason: "duplicate" }).label, "Closed · Duplicate");
  assert.equal(describeStage("closed", "zh-Hans", { closingReason: "dismissed" }).label, "Closed · Dismissed (client unreachable)");
  assert.equal(describeStage("closed", "en", { closingReason: null }).label, "Closed");
  assert.equal(describeStage("closed", "en", { closingReason: "toString" }).label, "Closed");
  assert.equal(describeStage("closed", "en").label, "Closed");
  for (const [reason, [en, zh]] of Object.entries(CLOSED_MESSAGES)) {
    assert.equal(describeStage("closed", "en", { closingReason: reason }).clientMessage, en, reason);
    assert.equal(describeStage("closed", "zh-Hans", { closingReason: reason }).clientMessage, zh, reason);
    assert.equal(describeStage("closed", "en", { closingReason: reason }).clientLabel, "Closed");
  }
  // No reason (closed before reasons existed), and any unknown one, keep the generic message.
  for (const record of [null, {}, { closingReason: null }, { closingReason: "nonsense" }]) {
    assert.equal(describeStage("closed", "en", record).clientMessage, CLOSED_MESSAGES.other[0]);
    assert.equal(describeStage("closed", "zh-Hans", record).clientMessage, CLOSED_MESSAGES.other[1]);
  }
  // A note never reaches the client.
  const noted = describeStage("closed", "en", { closingReason: "other", closingNote: "<b>secret</b>" });
  assert.doesNotMatch(JSON.stringify(noted), /secret/);
});

test("Hold and Waiting for documents are told by where the hold came from", () => {
  const docsEn = "PCDC has been trying to reach you about the documents we need. Please upload them below or contact PCDC.";
  const docsZh = "PCDC 一直在设法联系您，询问所需的文件。请在下方上传，或联系 PCDC。";
  const signEn = "PCDC has been trying to reach you to sign your return. Please contact PCDC. Your return can't be filed until you sign.";
  const signZh = "PCDC 一直在设法联系您签署报税表。请联系 PCDC。您签署后才能递交报税表。";
  assert.equal(describeStage("on_hold", "en", { holdOrigin: "awaiting_documents" }).clientMessage, docsEn);
  assert.equal(describeStage("on_hold", "zh-Hans", { holdOrigin: "awaiting_documents" }).clientMessage, docsZh);
  assert.equal(describeStage("on_hold", "en", { holdOrigin: "review_approved" }).clientMessage, signEn);
  assert.equal(describeStage("on_hold", "zh-Hans", { holdOrigin: "review_approved" }).clientMessage, signZh);
  assert.equal(describeStage("on_hold", "en", { holdOrigin: "review_approved" }).label, "Hold");
  // Without an origin the documents message stands.
  assert.equal(describeStage("on_hold", "en").clientMessage, docsEn);
  assert.equal(
    describeStage("awaiting_documents", "en").clientMessage,
    "PCDC needs more documents from you before your return can be prepared. See the requests below.",
  );
  assert.equal(
    describeStage("awaiting_documents", "zh-Hans").clientMessage,
    "PCDC 需要您提供更多文件，才能准备您的报税表。请查看下方的文件请求。",
  );
  for (const origin of [null, "toString"]) assert.equal(holdKind({ holdOrigin: origin }), null);
  assert.equal(holdKind({ holdOrigin: "awaiting_documents" }), "documents");
  assert.equal(holdKind({ holdOrigin: "review_approved" }), "signing");
  assert.equal(holdKind(null), null);
});

test("canWithdraw is true at the withdraw stages and at a documents hold only", () => {
  assert.deepEqual(WITHDRAW_STAGES, [
    "received", "screening", "awaiting_documents", "preparation_ready",
    "preparing", "corrections_required", "review_ready", "reviewing",
  ]);
  for (const stage of WITHDRAW_STAGES) assert.equal(canWithdraw({ stage }), true, stage);
  assert.equal(canWithdraw({ stage: "on_hold", holdOrigin: "awaiting_documents" }), true);
  assert.equal(canWithdraw({ stage: "on_hold", holdOrigin: "review_approved" }), false);
  assert.equal(canWithdraw({ stage: "on_hold", holdOrigin: null }), false);
  for (const stage of ["draft", "review_approved", "ready_to_efile", "efiled", "rejected", "accepted", "closed"])
    assert.equal(canWithdraw({ stage }), false, stage);
  assert.equal(canWithdraw(null), false);
});

test("mustContactToWithdraw is true from Ready to exit to Ready to e-file, at Rejected and at a signing hold", () => {
  for (const stage of ["review_approved", "ready_to_efile", "rejected"])
    assert.equal(mustContactToWithdraw({ stage }), true, stage);
  assert.equal(mustContactToWithdraw({ stage: "on_hold", holdOrigin: "review_approved" }), true);
  assert.equal(mustContactToWithdraw({ stage: "on_hold", holdOrigin: "awaiting_documents" }), false);
  assert.equal(mustContactToWithdraw({ stage: "on_hold", holdOrigin: null }), false);
  for (const stage of ["draft", "preparing", "efiled", "accepted", "closed"])
    assert.equal(mustContactToWithdraw({ stage }), false, stage);
  assert.equal(mustContactToWithdraw(null), false);
});

test("returnState, waitingReturns and awaitsAcknowledgment read the methods and results", () => {
  assert.equal(filingMethodKind(methods("efile", "efile")), "both_efile");
  assert.equal(filingMethodKind(methods("efile", "paper")), "efile_and_paper");
  assert.equal(filingMethodKind(methods("paper", "paper")), "both_paper");
  assert.equal(filingMethodKind(methods(null, null)), null);
  assert.equal(filingMethodKind(null), null);
  assert.equal(filingMethodKind(methods("paper", "efile")), "paper_and_efile");
  assert.equal(filingMethodKind(methods("efile", null)), null);

  const waiting = methods("efile", "paper");
  assert.equal(returnState(waiting, "federal"), "waiting");
  assert.equal(returnState(waiting, "state"), "given_to_client", "a paper return with no result is given to the client");
  const split = methods("efile", "efile", { federalResult: "accepted", stateResult: "rejected" });
  assert.equal(returnState(split, "federal"), "accepted");
  assert.equal(returnState(split, "state"), "rejected");
  assert.equal(returnState(methods("paper", "paper", { federalResult: "given_to_client" }), "federal"), "given_to_client");
  assert.equal(returnState(methods(null, null), "federal"), null);
  assert.equal(returnState(null, "state"), null);

  assert.deepEqual(waitingReturns(methods("efile", "efile")), ["federal", "state"]);
  assert.deepEqual(waitingReturns(methods("efile", "paper")), ["federal"], "a paper return never waits");
  assert.deepEqual(waitingReturns(methods("efile", "efile", { federalResult: "accepted" })), ["state"]);
  assert.deepEqual(waitingReturns(methods("efile", "efile", { federalResult: "accepted", stateResult: "accepted" })), []);
  assert.deepEqual(waitingReturns(methods(null, null)), []);
  assert.deepEqual(waitingReturns(null), []);

  assert.equal(awaitsAcknowledgment(methods("efile", "paper")), true);
  assert.equal(awaitsAcknowledgment(methods("paper", "paper")), false, "a case waiting only on paper");
  assert.equal(awaitsAcknowledgment(methods("efile", "paper", { federalResult: "accepted" })), false);
  assert.equal(awaitsAcknowledgment(methods(null, null)), false);
});

test("returnedToSigning is Ready to exit with methods on file; latestFixNote is the newest note", () => {
  assert.equal(returnedToSigning({ stage: "review_approved", federalMethod: "efile" }), true);
  assert.equal(returnedToSigning({ stage: "review_approved", federalMethod: null }), false);
  assert.equal(returnedToSigning({ stage: "rejected", federalMethod: "efile" }), false);
  assert.equal(returnedToSigning(null), false);

  assert.equal(latestFixNote({ filingAttempts: [] }), null);
  assert.equal(latestFixNote({}), null);
  assert.equal(latestFixNote(null), null);
  const record = {
    filingAttempts: [
      { attempt: 2, notes: [] },
      {
        attempt: 1,
        notes: [
          { note: "First fix", recordedAt: "2026-10-01T10:00:00Z" },
          { note: "Second fix", recordedAt: "2026-10-02T10:00:00Z" },
        ],
      },
    ],
  };
  assert.equal(latestFixNote(record), "Second fix");
  record.filingAttempts[0].notes.push({ note: "Newest", recordedAt: "2026-10-05T10:00:00Z" });
  assert.equal(latestFixNote(record), "Newest");
});

test("four filing kinds and their names", () => {
  assert.equal(filingMethodKind({ federalMethod: "paper", stateMethod: "efile" }), "paper_and_efile");
  const name = (stage, f, s) => describeStage(stage, "en", { stage, federalMethod: f, stateMethod: s }).label;
  assert.equal(name("efiled", "efile", "paper"), "E-filed, PA on paper");
  assert.equal(name("efiled", "paper", "efile"), "E-filed, federal on paper");
  assert.equal(name("accepted", "efile", "paper"), "Accepted, PA on paper");
  assert.equal(name("accepted", "paper", "efile"), "Accepted, federal on paper");
  assert.equal(name("accepted", "paper", "paper"), "Paper");
});

test("client labels for paper and ready", () => {
  const label = (stage, rec, lang = "en") => describeStage(stage, lang, { stage, ...rec }).clientLabel;
  assert.equal(label("accepted", { federalMethod: "efile", stateMethod: "paper" }), "Ready to mail");
  assert.equal(label("accepted", { federalMethod: "paper", stateMethod: "paper" }, "zh-Hans"), "待邮寄");
  assert.equal(label("accepted", { federalMethod: "efile", stateMethod: "efile" }), "Complete");
  assert.equal(label("efiled", { federalMethod: "paper", stateMethod: "efile" }), "Filed");
  assert.equal(label("ready_to_efile", {}), "Ready");
});

test("a stuck paper return reads as given to the client", () => {
  const rec = { federalMethod: "paper", stateMethod: "paper", federalResult: null, stateResult: null };
  assert.equal(returnState(rec, "federal"), "given_to_client");
  assert.deepEqual(waitingReturns(rec), []);
  assert.doesNotThrow(() => describeStage("efiled", "en", { stage: "efiled", ...rec }));
  assert.doesNotMatch(describeStage("efiled", "en", { stage: "efiled", ...rec }).clientMessage, /mailed\./);
});

test("Accepted with a paper return: the IRS sentence, the PA handover, then the refund sentence", () => {
  const rec = { federalMethod: "efile", stateMethod: "paper", federalResult: "accepted", stateResult: "given_to_client" };
  assert.equal(
    filingMessage("accepted", "en", rec),
    [
      t("filing.federal.accepted"),
      "PCDC gave your Pennsylvania return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it.",
      t("filing.closing.accepted"),
    ].join(" "),
  );
});
