import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as OpenCC from "opencc-js";
import * as views from "../src/views.mjs";
import * as client from "../src/client-views.mjs";
import { setHantMap } from "../src/hant.mjs";
import MAP from "../src/zh-hant.mjs";
import { SENTENCES, TEXT, t, sentence, historyLine } from "../src/client-text.mjs";
import { NEUTRAL_SEND_MESSAGE } from "../src/auth.mjs";
import { payloadFor, SAMPLE_DOCUMENT_FILENAME } from "../src/case-actions.mjs";
import { OFFICE_CONTACT } from "../src/ui.mjs";
import { makeSampleAnswers } from "../src/sample-data.mjs";
import { reviewAlerts, visibleSubsteps } from "../src/intake-form.mjs";
import { cardsFor } from "../src/document-cards.mjs";
import { findQuestion, substepQuestions } from "../src/intake-catalogue.mjs";
import { intakeFormV2 } from "../src/intake-views.mjs";
import {
  textOf,
  latinLeaks,
  dataTokens,
  historySentences,
  migrationSentences,
  REQUEST_PREFIX,
  DOCUMENTS_PREFIX,
} from "./support/language-sweep.mjs";

// Part 4d Task 6 (spec 2026-10-05 §3, §6): the client frame, sign-in, the
// applications list, the reference screen and the progress page, rendered in
// 简体 and 繁體, with nothing left in English and no Simplified character left
// in 繁體.

setHantMap(MAP);

// The screen app.mjs picks (screenFor), for a client or a visitor.
function screenFor(state) {
  if (!state.principal) {
    if (state.error?.code === "FORBIDDEN") return views.noAccessScreen(state);
    if (state.session !== "none") return views.unreachableScreen(state);
    return client.accessScreen(state);
  }
  return client.clientScreen(state);
}
const render = (state) => views.page(state, screenFor(state));

// Sample free text uses only characters that are the same in both scripts.
const EMAIL = "lin.mei@example.org";
const REFERENCE = "VT-AB2C-DE3F";
const REFERENCE_2 = "VT-GJPY-JAY9";
const REQUEST_TITLE = "中山路文件";
const REQUEST_MESSAGE = "林美的文件";
const DATA = [
  REFERENCE,
  REFERENCE_2,
  EMAIL,
  "林",
  "美",
  OFFICE_CONTACT.phone,
  OFFICE_CONTACT.email,
  SAMPLE_DOCUMENT_FILENAME,
  REQUEST_TITLE,
  REQUEST_MESSAGE,
];

const baseState = (overrides = {}) => ({
  session: "present",
  principal: { userId: "user-1", workspaceId: "w1", access: "applicant" },
  connection: "online",
  error: null,
  retryable: false,
  notice: null,
  authStep: "email",
  authEmail: "",
  authCode: "",
  authMessage: "",
  authError: null,
  resendSeconds: 0,
  cases: [],
  people: [],
  savedCase: null,
  draftAnswers: {},
  dirty: false,
  conflict: null,
  saveState: "idle",
  busy: false,
  screen: "applications",
  selectedCaseId: null,
  openPanels: [],
  lookup: "",
  dialog: null,
  ...overrides,
});

const v2Answers = () => {
  const answers = makeSampleAnswers();
  return {
    ...answers,
    tp_first_name: "美",
    tp_last_name: "林",
    vc_tp_signature: "美林",
    addr_street: "中山路 100",
    hh: answers.hh.map((member) => ({ ...member, first_name: "文", last_name: "林" })),
  };
};

const v2Case = (overrides = {}) => ({
  id: "case-v2",
  reference: REFERENCE_2,
  workspaceId: "w1",
  ownerUserId: "user-1",
  stage: "preparing",
  revision: 6,
  intakeVersion: 2,
  clientNumber: 12,
  answers: v2Answers(),
  contact: null,
  documentCards: [{ slotId: "w2.household", status: "later" }],
  requests: [],
  documents: [],
  history: [],
  ...overrides,
});

const HISTORY = [
  "Application received. A volunteer will check your information and documents.",
  "Simulated intake checks are recorded. Your application is waiting for a volunteer to start preparation.",
  "A volunteer has started preparing your return.",
  `${REQUEST_PREFIX}${REQUEST_TITLE}`,
].map((message, index) => ({
  id: `e${index}`,
  action: "X",
  message,
  createdAt: `2026-01-0${index + 2}T15:04:05Z`,
}));

const progressCase = v2Case({
  requests: [
    { id: "req-1", caseId: "case-v2", title: REQUEST_TITLE, message: REQUEST_MESSAGE, status: "open" },
  ],
  documents: [{ id: "d1", requestId: "req-0", filename: SAMPLE_DOCUMENT_FILENAME, source: "client" }],
  history: HISTORY,
});

const draftCase = { id: "case-d", reference: REFERENCE, stage: "draft", clientNumber: null };
const receivedCase = { id: "case-v2", reference: REFERENCE_2, stage: "received", clientNumber: 12 };

const visitor = (overrides) => baseState({ principal: null, session: "none", screen: "access", ...overrides });

// Every state that changes the text of these screens.
const STATES = {
  "sign-in: the email step": visitor(),
  "sign-in: the code step with a countdown": visitor({
    authStep: "code",
    authEmail: EMAIL,
    authMessage: NEUTRAL_SEND_MESSAGE,
    resendSeconds: 42,
  }),
  "sign-in: the code step with an auth error": visitor({
    authStep: "code",
    authEmail: EMAIL,
    authMessage: NEUTRAL_SEND_MESSAGE,
    authError: { code: "AUTH_INVALID_CODE", message: "That code is invalid or has expired. Request a new code." },
  }),
  "sign-in: the email step with a validation error": visitor({
    authError: { code: "OFFLINE", message: "Network error. Please try again later." },
  }),
  "sign-in: the code step, resend ready": visitor({ authStep: "code", authEmail: EMAIL, authMessage: NEUTRAL_SEND_MESSAGE }),
  "applications: one draft and one received": baseState({
    cases: [draftCase, receivedCase],
    savedCase: v2Case({ id: "case-v2", history: HISTORY }),
  }),
  "applications: none yet": baseState(),
  "applications: a lookup that finds nothing": baseState({ cases: [draftCase], lookup: "VT-ZZZZ" }),
  "the reference screen": baseState({ screen: "reference", savedCase: v2Case({ stage: "draft", clientNumber: null }) }),
  "progress: a request, history and a document sent": baseState({ screen: "progress", savedCase: progressCase }),
  "progress: an upload failure": baseState({
    screen: "progress",
    savedCase: progressCase,
    openPanels: ["upload-failed", "upload-failure"],
  }),
  "progress: in review, nothing open": baseState({
    screen: "progress",
    savedCase: v2Case({ stage: "reviewing", documentCards: [], history: [] }),
  }),
  "progress: same-day bring list": baseState({
    screen: "progress",
    savedCase: v2Case({ stage: "received", answers: { ...v2Answers(), service: "same_day" } }),
  }),
  "the frame: reconnecting": baseState({ connection: "reconnecting", cases: [draftCase] }),
  "the frame: offline": baseState({ connection: "offline", cases: [draftCase] }),
  "the frame: the problem banner": baseState({
    error: { code: "SERVER_ERROR", message: "Something went wrong. Please try again." },
    retryable: true,
  }),
  "the frame: the help dialog": baseState({ dialog: "help" }),
  "the frame: the regenerate dialog": baseState({ dialog: "regenerate" }),
  "the frame: the print dialog": baseState({ dialog: "print", savedCase: v2Case() }),
  "the unreachable screen": baseState({
    principal: null,
    session: "unknown",
    error: { code: "OFFLINE", message: "Network error. Please try again later." },
  }),
  "the no-access screen": baseState({
    principal: null,
    session: "present",
    error: { code: "FORBIDDEN", message: "You do not have access to this step." },
  }),
};

const toTw = OpenCC.Converter({ from: "cn", to: "tw" });
// The switch's own buttons name each language in itself (简体中文 included), so
// they are not page text for the 繁體 check.
const withoutSwitchNames = (html) => html.replace(/<button[^>]*data-action="set-language"[^>]*>[^<]*<\/button>/g, "");

for (const [name, state] of Object.entries(STATES)) {
  test(`简体: ${name} has nothing left in English`, () => {
    const html = render({ ...state, lang: "zh-Hans" });
    assert.deepEqual(latinLeaks(textOf(html), DATA), []);
    assert.match(textOf(html), /\p{Script=Han}/u);
  });
  test(`繁體: ${name} has nothing in English and no Simplified character`, () => {
    const html = render({ ...state, lang: "zh-Hant" });
    assert.deepEqual(latinLeaks(textOf(html), DATA), []);
    const text = textOf(withoutSwitchNames(html));
    assert.equal(toTw(text), text);
  });
}

test("latinLeaks matches data by whole token: short English words never hide inside the data", () => {
  const html = render({ ...STATES["progress: a request, history and a document sent"], lang: "zh-Hans" });
  assert.deepEqual(latinLeaks(textOf(html), DATA), []);
  const injected = html.replace("您的进度", "您的进度 a record in town");
  assert.notEqual(injected, html);
  assert.deepEqual(latinLeaks(textOf(injected), DATA), ["a", "record", "in", "town"]);
  // The data's own tokens still pass: the email, the file name and the reference.
  const tokens = dataTokens(DATA);
  for (const word of ["lin", "mei", "example", "org", "demo-mileage-record-2025", "pdf", "chinatown-pcdc", "vita", REFERENCE])
    assert.ok(tokens.has(word), word);
  for (const word of ["a", "in", "town", "record", "demo", "chinatown"]) assert.ok(!tokens.has(word), word);
});

test("English is the default: the same states render in English without a language", () => {
  for (const state of Object.values(STATES)) {
    const english = render(state);
    assert.equal(render({ ...state, lang: "en" }), english);
  }
});

test("a staff account's frame stays English whatever the browser chose", () => {
  const staffPage = baseState({
    principal: { userId: "p", workspaceId: "w1", access: "staff" },
    dialog: "help",
  });
  assert.equal(views.page({ ...staffPage, lang: "zh-Hans" }, ""), views.page(staffPage, ""));
});

test("the code step's first draw uses the countdown keys app.mjs patches in place", () => {
  const html = render({ ...STATES["sign-in: the code step with a countdown"], lang: "zh-Hans" });
  assert.ok(html.includes(t("signin.countdown", { n: 42 }, "zh-Hans")));
  assert.ok(html.includes(t("signin.resend_in", { n: 42 }, "zh-Hans")));
  const ready = render({ ...STATES["sign-in: the code step, resend ready"], lang: "zh-Hans" });
  assert.ok(ready.includes(t("signin.resend", {}, "zh-Hans")));
});

test("the progress page shows the office's words as typed, with Chinese labels around them", () => {
  const html = render({ ...STATES["progress: a request, history and a document sent"], lang: "zh-Hant" });
  assert.ok(html.includes(REQUEST_TITLE) && html.includes(REQUEST_MESSAGE));
  assert.ok(html.includes(t("progress.request_title", {}, "zh-Hant")));
  assert.ok(html.includes(t("progress.request_message", {}, "zh-Hant")));
  assert.ok(html.includes(t("history.requested", { title: REQUEST_TITLE }, "zh-Hant")));
  assert.equal(t("progress.request_title", {}, "zh-Hans"), "需要的文件");
  assert.equal(t("progress.request_message", {}, "zh-Hans"), "办公室留言");
  // No lang attribute on the office's text.
  assert.doesNotMatch(html, new RegExp(`lang="[^"]*"[^>]*>${REQUEST_TITLE}`));
});

// ---------------------------------------------------------------------------
// The save chip and the conflict panel (version 2)
// ---------------------------------------------------------------------------

test("the version-2 save chip and conflict panel speak the client's language", () => {
  const v2 = (overrides) =>
    baseState({ screen: "intake", savedCase: v2Case({ stage: "draft" }), draftAnswers: v2Answers(), lang: "zh-Hans", ...overrides });
  for (const overrides of [
    { saveState: "saving" },
    { saveState: "saved" },
    { saveState: "failed", error: { message: "Someone else updated this application. Refresh and try again." }, retryable: true },
    { saveState: "failed" },
    { saveState: "unsaved" },
    { saveState: "idle" },
    { saveState: "saved", revealed: ["tp_phone"], draftAnswers: { ...v2Answers(), tp_phone: "12" } },
  ]) {
    const chip = client.saveStatus(v2(overrides));
    assert.deepEqual(latinLeaks(textOf(chip), DATA), [], JSON.stringify(overrides));
  }
  const conflict = client.conflictForm(
    v2({
      conflict: { serverRevision: 7, baseRevision: 6 },
      draftAnswers: { ...v2Answers(), tp_first_name: "文" },
    }),
  );
  assert.deepEqual(latinLeaks(textOf(conflict), DATA), []);
  assert.match(conflict, /文/);
  // The office's Add a case, before its first save, keeps English.
  const office = baseState({ screen: "office-add-case", lang: "zh-Hans", saveState: "saved", savedCase: null });
  assert.match(client.saveStatus(office), /Saved/);
});

// ---------------------------------------------------------------------------
// History: every sentence the migrations write has an entry
// ---------------------------------------------------------------------------

test("the history parser finds exactly the sentences, prefixes and seeded lines", () => {
  const sql = `
    -- 'message','A comment is not a sentence.'
    perform record(jsonb_build_object('stage','received',
      'message','Application received.'));
    perform record(jsonb_build_object('message', 'It''s spaced and quoted.'));
    if vitally_private.payload_keys(p_payload)<>array['message','title'] then
    if not vitally_private.payload_text(p_payload,'message',2000) then
    insert into public.document_requests(title,message,x) values(p_payload->>'title',p_payload->>'message',p_person.id);
    perform record(jsonb_build_object('message','A volunteer requested a document: '||(p_payload->>'title')));
    perform record(jsonb_build_object('message',case when v_completed then 'A volunteer spoke with you.' end));
    perform record(jsonb_build_object('message',v_message));
    insert into public.client_events(workspace_id,case_id,action,message) values(p_case.workspace_id,p_case.id,p_type,p_outcome->>'message');
    insert into public.client_events(workspace_id,case_id,action,message) values('w','c','SUBMIT','Inserted directly.');
    insert into public.other_table(action,message) values('X','Not a client event.');
    select v.message from (values
      ('a',1,'SUBMIT',null::text,'{"x":1}'::jsonb,'Seeded sentence.'::text),
      ('a',2,'X','sam','{}',null),
      ('a',3,'REQUEST_DOCUMENT','alex','{}','A volunteer requested a document: Mileage record')
    ) as v(key,seq,action,person_key,detail,message);
    select v.title from (values ('Not a message column.')) as v(title);
  `;
  const found = historySentences(sql);
  assert.deepEqual(found.sentences.sort(), [
    "A volunteer spoke with you.",
    "Application received.",
    "Inserted directly.",
    "It's spaced and quoted.",
    "Seeded sentence.",
  ]);
  assert.deepEqual(found.prefixes, [REQUEST_PREFIX]);
  assert.deepEqual(found.requests, ["A volunteer requested a document: Mileage record"]);
});

test("every history sentence in the migrations is a SENTENCES key; the request line keeps the title", () => {
  const { sentences, prefixes, requests } = migrationSentences();
  assert.ok(sentences.length >= 13, "the live handlers and the seeded rows");
  assert.ok(sentences.includes("A volunteer spoke with you about the next service step."));
  for (const text of sentences) assert.ok(Object.hasOwn(SENTENCES, text), text);
  assert.deepEqual([...prefixes].sort(), [DOCUMENTS_PREFIX, REQUEST_PREFIX].sort());
  for (const line of requests.filter((line) => line.startsWith(REQUEST_PREFIX))) {
    const title = line.slice(REQUEST_PREFIX.length);
    assert.equal(historyLine(line, "zh-Hans"), `志愿者请求了一份文件：${title}`);
    assert.equal(historyLine(line, "en"), line);
  }
  // The office's title is never converted or filled.
  assert.equal(historyLine(`${REQUEST_PREFIX}发达 {n}`, "zh-Hant"), `${t("history.requested", { title: "" }, "zh-Hant")}发达 {n}`);
  // Other lines go through the sentence table; unknown ones stay English.
  assert.equal(historyLine(sentences[0], "zh-Hans"), SENTENCES[sentences[0]]);
  assert.equal(historyLine("Something new.", "zh-Hans"), "Something new.");
});

test("the intake documents line keeps the titles as typed (migration 036)", () => {
  const line = `${DOCUMENTS_PREFIX}W-2, Photo ID.`;
  assert.equal(historyLine(line, "zh-Hans"), "PCDC 请您提供以下文件：W-2, Photo ID。");
  assert.equal(historyLine(line, "en"), line);
  // The titles are never converted or filled.
  assert.equal(
    historyLine(`${DOCUMENTS_PREFIX}发达 {n}.`, "zh-Hant"),
    t("history.requested_documents", { titles: "" }, "zh-Hant").replace("。", "发达 {n}。"),
  );
  assert.equal(historyLine(line, "zh-Hant"), "PCDC 請您提供以下文件：W-2, Photo ID。");
  assert.equal(SENTENCES["PCDC is working on your application again."], "PCDC 已继续处理您的申请。");
});

test("the screening, 8879 and e-file history lines translate exactly", () => {
  const lines = {
    "PCDC started reviewing your application. We may call you.": "PCDC 已开始审核您的申请。我们可能会致电您。",
    "PCDC recorded that you signed Form 8879. Your return is ready to e-file.": "PCDC 已记录您签署了 8879 表。您的报税表可以电子递交了。",
    "PCDC e-filed your return.": "PCDC 已电子递交您的报税表。",
  };
  for (const [english, zh] of Object.entries(lines)) {
    assert.equal(SENTENCES[english], zh, english);
    assert.equal(historyLine(english, "zh-Hans"), zh, english);
    assert.equal(historyLine(english, "en"), english, english);
    assert.ok(migrationSentences().sentences.includes(english), `${english} is written by migration 032`);
  }
});

test("the Return to signing line translates exactly", () => {
  const english = "PCDC corrected your return. You need to sign it again.";
  const zh = "PCDC 已更正您的报税表，您需要再次签名。";
  assert.equal(SENTENCES[english], zh);
  assert.equal(historyLine(english, "zh-Hans"), zh);
  assert.equal(historyLine(english, "en"), english);
  assert.ok(migrationSentences().sentences.includes(english), "migration 035 writes it");
});

test("the filing history lines translate exactly", () => {
  const rows = [
    ["PCDC e-filed your federal return and mailed your Pennsylvania return.", "PCDC 已电子递交您的联邦报税表，并邮寄了您的宾州报税表。"],
    ["PCDC mailed your returns.", "PCDC 已邮寄您的报税表。"],
    ["PCDC e-filed your federal return.", "PCDC 已电子递交您的联邦报税表。"],
    ["PCDC mailed your federal return.", "PCDC 已邮寄您的联邦报税表。"],
    ["PCDC e-filed your Pennsylvania return.", "PCDC 已电子递交您的宾州报税表。"],
    ["PCDC mailed your Pennsylvania return.", "PCDC 已邮寄您的宾州报税表。"],
    ["The IRS and Pennsylvania accepted your returns.", "国税局和宾州税务局都已接受您的报税表。"],
    [
      "The IRS accepted your federal return. Your Pennsylvania return needs a correction before it can be accepted.",
      "国税局已接受您的联邦报税表。您的宾州报税表需要更正后才能被接受。",
    ],
    [
      "Your federal return was mailed. A reply to a mailed return can take several weeks. Pennsylvania accepted your Pennsylvania return.",
      "您的联邦报税表已邮寄。邮寄的报税表可能需要几周才会有回复。宾州税务局已接受您的宾州报税表。",
    ],
  ];
  for (const [english, zh] of rows) {
    assert.equal(SENTENCES[english], zh, english);
    assert.equal(historyLine(english, "zh-Hans"), zh, english);
    assert.doesNotMatch(zh, /\d{3}\D{0,2}\d{3}\D{0,2}\d{4}/);
  }
  const hant = historyLine("PCDC mailed your returns.", "zh-Hant");
  assert.notEqual(hant, "PCDC 已邮寄您的报税表。");
  assert.ok(hant.includes("郵寄"), hant);
});

const FED_EN = "PCDC gave your federal return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it.";
const FED_ZH = "PCDC 已将您的联邦报税表纸本交给您或您委托的人。如果还没有签名，请先签名，然后自行邮寄。邮寄后可能需要约 3 个月才会有回复。";
const PA_EN = "PCDC gave your Pennsylvania return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it.";
const PA_ZH = "PCDC 已将您的宾州报税表纸本交给您或您委托的人。如果还没有签名，请先签名，然后自行邮寄。邮寄后可能需要约 3 个月才会有回复。";

test("the new filing and ready lines translate exactly (migration 037)", () => {
  const rows = [
    ["PCDC recorded that your return is ready. PCDC will take the next step.", "PCDC 已记录您的报税表已准备好。PCDC 会进行下一步。"],
    ["PCDC e-filed your federal return and gave your Pennsylvania return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it.", "PCDC 已电子递交您的联邦报税表，并将您的宾州报税表纸本交给您或您委托的人。如果还没有签名，请先签名，然后自行邮寄。邮寄后可能需要约 3 个月才会有回复。"],
    ["PCDC gave your federal return on paper to you or the person you sent, and e-filed your Pennsylvania return. If the federal return isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it.", "PCDC 已将您的联邦报税表纸本交给您或您委托的人，并电子递交了您的宾州报税表。如果联邦报税表还没有签名，请先签名，然后自行邮寄。邮寄后可能需要约 3 个月才会有回复。"],
    ["PCDC gave your returns on paper to you or the person you sent. If they aren't signed yet, sign them, then mail them yourself. A reply can take about 3 months after you mail them.", "PCDC 已将您的报税表纸本交给您或您委托的人。如果还没有签名，请先签名，然后自行邮寄。邮寄后可能需要约 3 个月才会有回复。"],
    ["PCDC gave your federal and Pennsylvania returns on paper to you or the person you sent. If they aren't signed yet, sign them, then mail them yourself. A reply can take about 3 months after you mail them.", "PCDC 已将您的联邦和宾州报税表纸本交给您或您委托的人。如果还没有签名，请先签名，然后自行邮寄。邮寄后可能需要约 3 个月才会有回复。"],
    [FED_EN, FED_ZH],
    [PA_EN, PA_ZH],
    [`The IRS accepted your federal return. ${PA_EN}`, `国税局已接受您的联邦报税表。${PA_ZH}`],
  ];
  for (const [english, zh] of rows) {
    assert.equal(SENTENCES[english], zh, english);
    assert.equal(historyLine(english, "zh-Hans"), zh, english);
    assert.equal(historyLine(english, "en"), english, english);
  }
});

test("legacy filing lines keep their translation", () => {
  const rows = [
    ["PCDC mailed your returns.", "PCDC 已邮寄您的报税表。"],
    ["PCDC mailed your federal return.", "PCDC 已邮寄您的联邦报税表。"],
    ["PCDC mailed your Pennsylvania return.", "PCDC 已邮寄您的宾州报税表。"],
    ["PCDC e-filed your federal return and mailed your Pennsylvania return.", "PCDC 已电子递交您的联邦报税表，并邮寄了您的宾州报税表。"],
    ["Your federal and Pennsylvania returns were mailed. A reply to a mailed return can take several weeks.", "您的联邦和宾州报税表已邮寄。邮寄的报税表可能需要几周才会有回复。"],
    ["Your federal return was mailed. A reply to a mailed return can take several weeks.", "您的联邦报税表已邮寄。邮寄的报税表可能需要几周才会有回复。"],
    ["Your Pennsylvania return was mailed. A reply to a mailed return can take several weeks.", "您的宾州报税表已邮寄。邮寄的报税表可能需要几周才会有回复。"],
    ["Your federal return was mailed. A reply to a mailed return can take several weeks. Pennsylvania accepted your Pennsylvania return.", "您的联邦报税表已邮寄。邮寄的报税表可能需要几周才会有回复。宾州税务局已接受您的宾州报税表。"],
    ["The IRS accepted your federal return. Your Pennsylvania return was mailed. A reply to a mailed return can take several weeks.", "国税局已接受您的联邦报税表。您的宾州报税表已邮寄。邮寄的报税表可能需要几周才会有回复。"],
    ["PCDC recorded that you signed Form 8879. Your return is ready to e-file.", "PCDC 已记录您签署了 8879 表。您的报税表可以电子递交了。"],
  ];
  for (const [english, zh] of rows) {
    assert.equal(SENTENCES[english], zh, english);
    assert.equal(historyLine(english, "zh-Hans"), zh, english);
  }
});

test("every filing message has 简体, no phone number, and 繁體 is generated", () => {
  const keys = Object.keys(TEXT).filter((key) => key.startsWith("filing.") || key.startsWith("stage.review_approved.client.resign"));
  assert.ok(keys.length >= 15, keys.length);
  for (const key of keys) {
    assert.match(TEXT[key].zh, /\p{Script=Han}/u, key);
    assert.doesNotMatch(TEXT[key].en, /\d{3}\D{0,2}\d{3}\D{0,2}\d{4}/, key);
    assert.doesNotMatch(TEXT[key].zh, /\d{3}\D{0,2}\d{3}\D{0,2}\d{4}/, key);
    assert.doesNotMatch(TEXT[key].zh, /宾夕法尼亚/, key);
    assert.notEqual(t(key, {}, "zh-Hant"), undefined);
  }
});

test("every fixed hold and closing history line has 简体 and no phone number (migration 036)", () => {
  const lines = [
    "PCDC is trying to reach you.",
    "PCDC is working on your application again.",
    "You withdrew your application. Your return was not filed.",
  ];
  const closed = Object.keys(TEXT).filter((key) => key.startsWith("stage.closed.client."));
  assert.equal(closed.length, 5);
  const phone = /\d{3}\D{0,2}\d{3}\D{0,2}\d{4}/;
  for (const english of lines) {
    assert.ok(Object.hasOwn(SENTENCES, english), english);
    assert.match(SENTENCES[english], /\p{Script=Han}/u, english);
    assert.equal(historyLine(english, "zh-Hans"), SENTENCES[english], english);
    assert.doesNotMatch(english, phone);
    assert.doesNotMatch(SENTENCES[english], phone);
  }
  for (const key of [...closed, "stage.on_hold.client", "stage.on_hold.client.signing", "stage.awaiting_documents.client"]) {
    assert.match(TEXT[key].zh, /\p{Script=Han}/u, key);
    assert.doesNotMatch(TEXT[key].en, phone, key);
    assert.doesNotMatch(TEXT[key].zh, phone, key);
  }
  for (const key of ["withdraw.button", "withdraw.title", "withdraw.body", "withdraw.box", "withdraw.keep", "withdraw.contact", "toast.withdrawn"]) {
    assert.match(TEXT[key].zh, /\p{Script=Han}/u, key);
    assert.doesNotMatch(TEXT[key].en, phone, key);
    assert.doesNotMatch(TEXT[key].zh, phone, key);
  }
  assert.equal(TEXT["withdraw.button"].zh, "撤回此申请");
  assert.equal(TEXT["withdraw.box"].zh, "我要撤回此申请。我的报税表将不会被递交。");
  assert.equal(TEXT["withdraw.contact"].zh, "如需撤回，请联系 PCDC。");
});

test("new screening line translated", () => {
  const english = "PCDC finished screening your application. A volunteer will start preparing your return next.";
  const zh = "PCDC 已完成对您申请的审核。接下来会有志愿者开始准备您的报税表。";
  assert.equal(SENTENCES[english], zh);
  assert.equal(historyLine(english, "zh-Hans"), zh);
  assert.equal(historyLine(english, "en"), english);
  assert.ok(migrationSentences().sentences.includes(english), "migration 034 writes it");
  const hant = historyLine(english, "zh-Hant");
  assert.notEqual(hant, zh);
  assert.ok(hant.includes("已完成"), hant);
});

test("old simulated line keeps its 简体", () => {
  assert.equal(
    SENTENCES["Simulated intake checks are recorded. Your application is waiting for a volunteer to start preparation."],
    "模拟的登记核查已记录。您的申请正在等待志愿者开始准备报税表。",
  );
});

// ---------------------------------------------------------------------------
// Errors, sign-in and notices: every sentence that can reach a client
// ---------------------------------------------------------------------------

const source = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const literal = (text) => JSON.parse(text);

test("every errors.mjs, controller, auth and message-constant sentence is a SENTENCES key", () => {
  const wanted = new Set(["Something went wrong.", "Please try again."]);
  // errors.mjs: SAFE_MESSAGES
  const errors = /const SAFE_MESSAGES = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(source("errors.mjs"))[1];
  const safe = [...errors.matchAll(/:\s*("(?:[^"\\]|\\.)*")/g)].map((m) => literal(m[1]));
  assert.equal(safe.length, 9);
  safe.forEach((s) => wanted.add(s));
  // controller.mjs: literal controllerError sentences, *_MESSAGE constants and the client conflict messages
  const controller = source("controller.mjs");
  const errorsThrown = [...controller.matchAll(/(?:controllerError|refuse)\(\s*"[A-Z_]+"\s*,\s*("(?:[^"\\]|\\.)*")/g)].map((m) => literal(m[1]));
  assert.ok(errorsThrown.length >= 9);
  errorsThrown.forEach((s) => wanted.add(s));
  // The fallbacks a sign-in error falls back on when it carries no message
  const fallbacks = [...controller.matchAll(/message:\s*[\w?.]+\s*\?\?\s*("(?:[^"\\]|\\.)*")/g)].map((m) => literal(m[1]));
  assert.ok(fallbacks.includes("Sign-in could not be completed."));
  fallbacks.forEach((s) => wanted.add(s));
  const constants = [...controller.matchAll(/const (\w+_(?:NOTICE|MESSAGE)) =\s*("(?:[^"\\]|\\.)*")/g)];
  const clientConstants = constants.filter(([, name]) => !/^(STAFF|ASSISTANCE)_/.test(name));
  assert.ok(clientConstants.length >= 1, "the client constants must not all be filtered out");
  for (const [, , text] of clientConstants) wanted.add(literal(text));
  // auth.mjs: the neutral message and every authError sentence
  wanted.add(NEUTRAL_SEND_MESSAGE);
  const auth = [...source("auth.mjs").matchAll(/authError\(\s*"[A-Z_]+"\s*,\s*("(?:[^"\\]|\\.)*")/g)].map((m) => literal(m[1]));
  assert.equal(auth.length, 3);
  auth.forEach((s) => wanted.add(s));
  for (const text of wanted) assert.ok(Object.hasOwn(SENTENCES, text), text);
});

test("the client's own case actions refuse in sentences the table knows", () => {
  // The caseButtons on client screens: Submit and the sample document.
  const clientActions = new Set();
  for (const file of ["client-views.mjs", "intake-views.mjs"])
    for (const m of source(file).matchAll(/caseButton\(\s*[\s\S]*?,\s*"([A-Z_]+)"/g)) clientActions.add(m[1]);
  assert.deepEqual([...clientActions].sort(), ["RESPOND_DOCUMENT", "SUBMIT"]);
  const messages = ["This step is not available."];
  for (const type of clientActions) {
    try {
      payloadFor(type, {}, {});
    } catch (error) {
      messages.push(error.message);
    }
  }
  assert.ok(messages.includes("This request is no longer on screen."));
  try {
    payloadFor("NOT_AN_ACTION");
  } catch (error) {
    assert.equal(error.message, "This step is not available.");
  }
  for (const text of messages) {
    assert.ok(Object.hasOwn(SENTENCES, text), text);
    assert.notEqual(sentence(text, "zh-Hans"), text);
  }
});

test("the client's Withdraw refuses in a sentence the table translates", () => {
  let message = "";
  try {
    payloadFor("WITHDRAW", {}, {});
  } catch (error) {
    message = error.message;
  }
  assert.equal(message, "Tick the box to withdraw this application.");
  assert.ok(Object.hasOwn(SENTENCES, message));
  assert.equal(sentence(message, "zh-Hans"), "请勾选方框以撤回此申请。");
  assert.equal(sentence(message, "en"), message);
});

// ---------------------------------------------------------------------------
// The version-2 intake (Task 7): every visible sub-step, Review & submit,
// Documents, the submitted page and the progress page's open cards
// ---------------------------------------------------------------------------

// The married sample, its free text (names, job titles, the contact note and
// the street) in characters that are the same in both scripts.
const intakeAnswers = (overrides = {}) => {
  const answers = makeSampleAnswers({ seed: 1, married: true });
  return {
    ...answers,
    tp_first_name: "美",
    tp_last_name: "林",
    tp_job_title: "工人",
    vc_tp_signature: "美林",
    best_contact_note: "晚上",
    addr_street: "中山路 100",
    sp_first_name: "文",
    sp_last_name: "林",
    sp_job_title: "店主",
    hh: answers.hh.map((member) => ({ ...member, first_name: "中", last_name: "林" })),
    ...overrides,
  };
};

const intakeCase = (overrides = {}) =>
  v2Case({ stage: "draft", clientNumber: null, answers: {}, documentCards: [], ...overrides });

const ALL_VISIBLE = visibleSubsteps(intakeAnswers(), cardsFor(intakeAnswers(), []), ["review.submit"]);

const intakeState = (overrides = {}) =>
  baseState({
    screen: "intake",
    savedCase: intakeCase(),
    draftAnswers: intakeAnswers(),
    formSubstep: "before.ready",
    visitedSubsteps: ALL_VISIBLE,
    revealed: [],
    ...overrides,
  });

// Later, Don't have and Not done side by side, and the Maybe needed card still open.
const MARKED = [
  { slotId: "ssn.tp", status: "later" },
  { slotId: "photo_id.sp", status: "none" },
  { slotId: "w2.household", status: "later" },
];

// Alerts of each kind: a missing answer, a household member's missing date
// and an invalid email, with document warnings beside them.
const withAlerts = () => {
  const answers = intakeAnswers({ email: "lin.mei@" });
  delete answers.tp_phone;
  answers.hh = answers.hh.map(({ dob, ...member }) => member);
  return answers;
};

// The married sample with nothing answered in one part: optional.questions has
// six questions, none required, so emptying it leaves no alerts and the gate
// still shows the summary.
const withEmptyPart = () => {
  const answers = intakeAnswers();
  for (const question of substepQuestions("optional.questions")) delete answers[question.id];
  return answers;
};

const INTAKE_STATES = {
  ...Object.fromEntries(
    ALL_VISIBLE.map((id) => [
      `intake: ${id}`,
      intakeState({ formSubstep: id, savedCase: intakeCase({ documentCards: MARKED }), openPanels: [`maybe:${id}`] }),
    ]),
  ),
  "intake: the senior wording": intakeState({ formSubstep: "about.you", draftAnswers: intakeAnswers({ form_version: "senior" }) }),
  "intake: Back to summary, a conflict, a failed save and an error": intakeState({
    formSubstep: "about.address",
    returnToSummary: true,
    conflict: { serverRevision: 7, baseRevision: 6 },
    saveState: "failed",
    retryable: true,
    error: { code: "CONFLICT", message: "Someone else updated this application. Refresh and try again." },
  }),
  "intake: an invalid answer revealed": intakeState({ formSubstep: "about.you", draftAnswers: withAlerts(), revealed: ["email", "tp_phone"] }),
  "review: alerts and warnings": intakeState({
    formSubstep: "review.check",
    draftAnswers: withAlerts(),
    savedCase: intakeCase({ documentCards: MARKED }),
  }),
  "review: no alerts and no warnings": intakeState({
    formSubstep: "review.check",
    draftAnswers: intakeAnswers({ service: "same_day" }),
  }),
  "review: the summary with marked cards": intakeState({ formSubstep: "review.summary", savedCase: intakeCase({ documentCards: MARKED }) }),
  "review: the summary with nothing answered in a part": intakeState({ formSubstep: "review.summary", draftAnswers: withEmptyPart() }),
  "review: submit": intakeState({ formSubstep: "review.submit" }),
  "review: submit, confirmed and busy": intakeState({ formSubstep: "review.submit", openPanels: ["confirmed"], busy: true, saveState: "saving" }),
  "same-day: the bring list": intakeState({ formSubstep: "documents.bring", draftAnswers: intakeAnswers({ service: "same_day" }) }),
  "same-day: the summary": intakeState({ formSubstep: "review.summary", draftAnswers: intakeAnswers({ service: "same_day" }) }),
  "the submitted page": intakeState({
    savedCase: intakeCase({
      stage: "received",
      answers: intakeAnswers(),
      contact: { phone: "2155550123", spousePhone: null, bestContactTime: ["weekday_morning"], bestContactNote: "晚上" },
    }),
    draftAnswers: {},
  }),
  "progress: open document cards, Later and Not done": baseState({
    screen: "progress",
    savedCase: v2Case({ stage: "received", answers: intakeAnswers(), documentCards: MARKED }),
  }),
};

for (const [name, state] of Object.entries(INTAKE_STATES)) {
  test(`简体: ${name} has nothing left in English`, () => {
    const html = render({ ...state, lang: "zh-Hans" });
    assert.deepEqual(latinLeaks(textOf(html), DATA), []);
    assert.match(textOf(html), /\p{Script=Han}/u);
  });
  test(`繁體: ${name} has nothing in English and no Simplified character`, () => {
    const html = render({ ...state, lang: "zh-Hant" });
    assert.deepEqual(latinLeaks(textOf(html), DATA), []);
    const text = textOf(withoutSwitchNames(html));
    assert.equal(toTw(text), text);
  });
}

test("the intake sweep covers every visible sub-step of the married sample", () => {
  assert.ok(ALL_VISIBLE.length >= 30, ALL_VISIBLE.length);
  for (const id of ["about.spouse", "household.members", "documents.identity", "notes.anything", "review.submit"])
    assert.ok(ALL_VISIBLE.includes(id), id);
  // The free text holds no Latin letters beyond the city and state.
  const latin = Object.entries(intakeAnswers()).filter(
    ([id, value]) => typeof value === "string" && /[A-Za-z]/.test(value) && findQuestion(2, id)?.type === "text",
  );
  assert.deepEqual(latin.map(([id]) => id).sort(), ["addr_city", "addr_state"]);
});

test("the summary's empty part reads in Chinese, and the part's draft has no alerts", () => {
  const state = INTAKE_STATES["review: the summary with nothing answered in a part"];
  assert.deepEqual(reviewAlerts(state.draftAnswers), [], "the summary only shows with no alerts");
  const html = render({ ...state, lang: "zh-Hans" });
  assert.match(html, /data-substep="review\.summary"/);
  assert.ok(html.includes(t("summary.none", {}, "zh-Hans")), "the empty part's text");
  assert.ok(textOf(html).includes("尚未回答任何问题。"));
});

test("English is the default on every intake state too", () => {
  for (const state of Object.values(INTAKE_STATES)) assert.equal(render({ ...state, lang: "en" }), render(state));
});

test("the summary offers no draft 13614-C in any language, and the 14446's first form follows the screen", () => {
  const page = (lang) => client.intakeScreen(intakeState({ formSubstep: "review.summary", lang }));
  const drafts = (lang) =>
    [...page(lang).matchAll(/data-action="view-draft"([^>]*)/g)].map((m) =>
      /data-draft="14446"/.test(m[1]) ? /data-form="([^"]+)"/.exec(m[1])[1] : "13614-C",
    );
  assert.deepEqual(drafts("en"), ["en", "zh-t"]);
  assert.deepEqual(drafts("zh-Hans"), ["zh-t", "en"]);
  assert.deepEqual(drafts("zh-Hant"), ["zh-t", "en"]);
  assert.match(page("zh-Hans"), /14446 表草稿/);
  assert.doesNotMatch(page("zh-Hans"), /13614-C/);
});

test("the summary's printed date is today's long date in the screen's language", () => {
  const today = new Date(2026, 9, 5);
  const html = (lang) => intakeFormV2(intakeState({ formSubstep: "review.summary", lang }), { today });
  assert.match(html("zh-Hans"), /2026年10月5日/);
  assert.match(html("zh-Hant"), /2026年10月5日/);
  assert.match(html(undefined), /October 5, 2026/);
});

test("the intake's Change links, alerts and Upload now keep their actions in Chinese", () => {
  const html = render({ ...INTAKE_STATES["review: alerts and warnings"], lang: "zh-Hans" });
  assert.match(html, /data-action="go-substep" data-substep="household\.members"[^>]*><span class="alert-q">成员 1：/);
  assert.ok(html.includes(t("alert.missing", {}, "zh-Hans")) && html.includes(t("alert.invalid", {}, "zh-Hans")));
  assert.match(html, new RegExp(`data-focus="doc-w2-household"[^>]*>${t("review.upload_now", {}, "zh-Hans")}<`));
  const summary = render({ ...INTAKE_STATES["review: the summary with marked cards"], lang: "zh-Hans" });
  assert.match(summary, /data-action="change-substep" data-substep="about\.address">修改<\/button>/);
});
