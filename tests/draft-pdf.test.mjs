import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { inflateSync } from "node:zlib";
import {
  PDFDocument, PDFDict, PDFName, PDFBool, PDFHexString, pushGraphicsState, popGraphicsState, translate, drawObject, rotateInPlace, PDFArray, PDFCheckBox, PDFTextField, StandardFonts, rgb,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import * as bundled from "../src/vendor/pdf-lib.mjs";
import { FORM_FILES, FORM_SHA256, draftFields, draftFieldNames } from "../src/draft-form.mjs";
import { shadedName, shadedNames, readShaded } from "../src/shaded-fields.mjs";
import HANT_MAP from "../src/zh-hant.mjs";
import { describeFocus, focusSelectors } from "../src/ui.mjs";
import {
  CJK_DRAW, DRAFT_FONTS, DRAFT_FONT_FIXTURES, WIN_ANSI_CODE_POINTS, buildDraftPdf, buildEditingCopy, readFilledCopy, createDraftOffer, draftFontFiles,
  draftFontsFor, draftLink, fieldsNeedFont, needsEmbeddedFont, patchSubsetPadding, printable,
} from "../src/draft-pdf.mjs";

// Node, with pdf-lib and fontkit from node_modules. The fonts are the
// byte-identical copies installed from npm (DRAFT_FONT_FIXTURES); no test here
// reaches the network. All names and data are fictional.
const PDFLib = { PDFDocument, StandardFonts, rgb, PDFName, PDFBool, PDFHexString, pushGraphicsState, popGraphicsState, translate, drawObject, rotateInPlace };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const formBytes = (form) => readFile(new URL(`../${FORM_FILES[form]}`, import.meta.url));
const fixtureBytes = (url) => readFile(new URL(`../${DRAFT_FONT_FIXTURES[url].path}`, import.meta.url));
const fontFilesFor = (form) => Promise.all(draftFontsFor(form).files.map((file) => fixtureBytes(file.url)));
const F = (name) => `form1[0].${name}`;
const NOTICE = "Some characters could not be printed. The online answers have them in full.";

// pdf-lib warns once per load that it drops the forms' XFA layer; that is
// expected (the draft uses the AcroForm fields only), so keep the output quiet.
const warn = console.warn;
console.warn = (...args) => (/XFA/.test(String(args[0])) ? undefined : warn(...args));

const BASE = Object.freeze({
  tp_first_name: "Mei",
  tp_last_name: "Lin",
  tp_dob: "1961-04-05",
  tp_job_title: "Bookkeeper",
  tp_phone: "2155550199",
  marital_status: "married",
  married_last_day: "yes",
  lived_apart_last_6mo: "no",
  sp_first_name: "Lan",
  sp_last_name: "Lin",
  us_citizen: ["me"],
  inc_wages: "yes",
  gcf_consent: "no",
  additional_notes: "My 1099-INT has not arrived yet.",
});
const OPTIONS = { reference: "VT-ABCD-EFGH", today: "2026-10-04" };

/** A fontFiles stand-in that records whether the builder touched it. */
function watchedFiles(files = []) {
  const seen = { read: false };
  const proxy = new Proxy(files, {
    get(target, key, receiver) {
      seen.read = true;
      return Reflect.get(target, key, receiver);
    },
  });
  return { proxy, seen };
}

async function build(answers, { form = "en", fontFiles = [], flatten = true, shaded } = {}) {
  const fields = draftFields(answers, { ...OPTIONS, form, shaded });
  const bytes = await buildDraftPdf({
    PDFLib, fontkit, formBytes: await formBytes(form), fontFiles, fields,
    stamp: fields.stamp, fileName: fields.fileName, flatten,
  });
  assert.ok(bytes instanceof Uint8Array);
  return { bytes, fields, doc: await PDFDocument.load(bytes) };
}

const decoded = (stream) => {
  const filter = stream.dict.lookup(PDFName.of("Filter"));
  const raw = Buffer.from(stream.contents ?? stream.getContents());
  return filter === PDFName.of("FlateDecode") ? inflateSync(raw) : raw;
};

/** Every content stream of the page, decoded, as one latin1 string. */
function pageContent(page) {
  const contents = page.node.lookup(PDFName.of("Contents"));
  const streams = contents instanceof PDFArray
    ? contents.asArray().map((ref) => page.doc.context.lookup(ref))
    : [contents];
  return streams.map((stream) => decoded(stream).toString("latin1")).join("\n");
}

const hexOf = (text) => Buffer.from(text, "latin1").toString("hex").toUpperCase();
const hasHexText = (content, text) => content.toUpperCase().includes(`<${hexOf(text)}`);
/** The Helvetica (WinAnsi) strings drawn on the page, in order, without the stamp or embedded-font (CID) runs. */
const drawnLines = (page) =>
  [...pageContent(page).matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)]
    .map((m) => Buffer.from(m[1], "hex").toString("latin1"))
    .filter((line) => !line.startsWith("DRAFT ") && !line.includes("\x00"));

/**
 * Every line of text drawn on the page, whatever its font, top to bottom:
 * { y, text }. Runs in an embedded font are read back through its ToUnicode
 * map; Helvetica runs are WinAnsi. Only the draft's own fonts count (the
 * Chinese forms print text of their own), and the stamp is left out.
 */
function drawnText(page) {
  const fonts = page.node.Resources().lookup(PDFName.of("Font"));
  const maps = new Map();
  const decoderOf = (name) => {
    if (!maps.has(name)) {
      const toUnicode = fonts.lookup(PDFName.of(name))?.lookup(PDFName.of("ToUnicode"));
      if (!toUnicode) maps.set(name, null);
      else {
        const map = new Map();
        for (const m of decoded(toUnicode).toString("latin1").matchAll(/<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]{4,8})>/g))
          map.set(m[1].toUpperCase(), String.fromCharCode(...m[2].match(/.{4}/g).map((h) => parseInt(h, 16))));
        maps.set(name, map);
      }
    }
    return maps.get(name);
  };
  const lines = new Map();
  let font = null;
  let y = null;
  for (const m of pageContent(page).matchAll(/\/(\S+) [\d.]+ Tf|[-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ ([-\d.]+) Tm|<([0-9A-Fa-f]*)>\s*Tj/g)) {
    if (m[1] !== undefined) font = m[1];
    else if (m[2] !== undefined) y = Number(m[2]);
    else if (/^(NotoSans(SC|TC)?-Regular|Helvetica)-\d+$/.test(font)) {
      const map = decoderOf(font);
      const text = map
        ? m[3].match(/.{4}/g).map((gid) => map.get(gid.toUpperCase()) ?? "\uFFFD").join("")
        : Buffer.from(m[3], "hex").toString("latin1");
      lines.set(y, (lines.get(y) ?? "") + text);
    }
  }
  return [...lines].map(([at, text]) => ({ y: at, text })).filter((line) => !line.text.startsWith("DRAFT ")).sort((a, b) => b.y - a.y);
}

/** The embedded TrueType files (FontFile2) of a saved PDF, with their ToUnicode maps. */
function embeddedFonts(doc) {
  const found = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    const descendants = object.lookup(PDFName.of("DescendantFonts"));
    if (!descendants) continue;
    const cid = descendants.lookup(0);
    const descriptor = cid.lookup(PDFName.of("FontDescriptor"));
    const file = descriptor.lookup(PDFName.of("FontFile2"));
    // Only the draft's own fonts: the Chinese forms carry fonts of their own.
    if (!file || !/^\/NotoSans(SC|TC)?-Regular-\d+$/.test(String(object.get(PDFName.of("BaseFont"))))) continue;
    const toUnicode = object.lookup(PDFName.of("ToUnicode"));
    found.push({ file: decoded(file), toUnicode: toUnicode ? decoded(toUnicode).toString("latin1") : "" });
  }
  return found;
}

/**
 * Task 1's regression check for the fontkit subset bug: the embedded subset
 * parses, its `loca` agrees with its `glyf`, and every glyph it maps decodes
 * to the same outline as in the source font.
 */
function subsetProblems({ file, toUnicode }, sourceFonts) {
  const problems = [];
  const subset = fontkit.create(file);
  const offsets = subset.loca.offsets;
  const glyfLength = subset.directory.tables.glyf.length;
  if (offsets.some((offset, i) => i > 0 && offset < offsets[i - 1])) problems.push("loca not monotonic");
  if (offsets.at(-1) !== glyfLength) problems.push(`loca ends at ${offsets.at(-1)}, glyf is ${glyfLength} bytes`);
  // Padded records: every offset a multiple of 4 (so also of 2, as a short loca needs).
  if (offsets.some((offset) => offset % 4 !== 0)) problems.push("a glyph record is not padded");
  const pairs = [...toUnicode.matchAll(/<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]{4,8})>/g)].map((m) => [
    parseInt(m[1], 16),
    String.fromCodePoint(...m[2].match(/.{4}/g).map((h) => parseInt(h, 16))).codePointAt(0),
  ]);
  if (pairs.length === 0) problems.push("no ToUnicode pairs");
  for (const [gid, codePoint] of pairs) {
    if (gid === 0) continue; // .notdef
    const source = sourceFonts.find((font) => font.hasGlyphForCodePoint(codePoint));
    try {
      const got = subset.getGlyph(gid).path.toSVG();
      const want = source.glyphForCodePoint(codePoint).path.toSVG();
      if (got !== want) problems.push(`glyph ${gid} (U+${codePoint.toString(16)}) differs`);
    } catch (error) {
      problems.push(`glyph ${gid} (U+${codePoint.toString(16)}) does not decode: ${error.message}`);
    }
  }
  return problems;
}

test("the three forms match their pinned sha256", async () => {
  for (const form of Object.keys(FORM_FILES)) assert.equal(sha256(await formBytes(form)), FORM_SHA256[form], form);
});

test("every name the map can produce exists in its form, with the right type", async () => {
  for (const form of Object.keys(FORM_FILES)) {
    const pdf = await PDFDocument.load(await formBytes(form));
    const fields = pdf.getForm();
    for (const name of draftFieldNames(form)) assert.ok(fields.getField(name), `${form}: ${name}`);
    const rows = draftFieldNames(form).filter((name) => /namesOf\[0\]\.Row[1-4]\[0\]/.test(name));
    assert.equal(rows.length, 40, `${form}: four rows of ten columns`);
    // The two kinds land on the right kind of box.
    const produced = draftFields({ ...BASE, gcf_consent: "yes", gcf_tp_signature: "Mei Lin", gcf_tp_date: "2026-02-01" }, { ...OPTIONS, form });
    for (const name of Object.keys(produced.text)) assert.ok(fields.getField(name) instanceof PDFTextField, `${form}: ${name}`);
    for (const name of produced.checks) assert.ok(fields.getField(name) instanceof PDFCheckBox, `${form}: ${name}`);
  }
});

test("the Chinese forms' own marital boxes sit where the English ones do", async () => {
  const rect = (pdf, name) => pdf.getForm().getField(F(name)).acroField.getWidgets()[0].getRectangle();
  const en = await PDFDocument.load(await formBytes("en"));
  const pairs = [
    ["lastDay[0].lastDayYes[0]", "marriedForAll[0].forAllYes[0]"],
    ["lastDay[0].lastDayNo[0]", "marriedForAll[0].forAllNo[0]"],
    ["liveApart[0].liveApartYes[0]", "liveWithSpouse[0].liveWithYes[0]"],
    ["liveApart[0].liveApartNo[0]", "liveWithSpouse[0].liveWithNo[0]"],
  ];
  for (const form of ["zh-s", "zh-t"]) {
    const zh = await PDFDocument.load(await formBytes(form));
    for (const [english, chinese] of pairs) {
      const a = rect(en, `page1[0].maritalStatus[0].${english}`);
      const b = rect(zh, `page1[0].maritalStatus[0].${chinese}`);
      assert.ok(Math.abs(a.y - b.y) <= 2, `${form} ${chinese} y`);
      assert.ok(Math.abs(a.x - b.x) <= 2, `${form} ${chinese} x`);
    }
  }
});

test("needsEmbeddedFont: WinAnsi is exactly what Helvetica can encode", async () => {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  assert.deepEqual([...WIN_ANSI_CODE_POINTS].sort((a, b) => a - b), helvetica.getCharacterSet().sort((a, b) => a - b));
  assert.equal(needsEmbeddedFont("José"), false);
  assert.equal(needsEmbeddedFont("José Peña"), false);
  assert.equal(needsEmbeddedFont("Mei Lin – “quoted” €5"), false);
  assert.equal(needsEmbeddedFont("line one\nline two"), false);
  assert.equal(needsEmbeddedFont("Nguyễn"), true);
  assert.equal(needsEmbeddedFont("Łukasz"), true);
  assert.equal(needsEmbeddedFont("美"), true);
  assert.equal(fieldsNeedFont({ text: { a: "Mei" }, comments: "fine" }), false);
  assert.equal(fieldsNeedFont({ text: { a: "Mei" }, comments: "林" }), true);
  assert.equal(fieldsNeedFont({ text: { a: "美" }, comments: "" }), true);
});

test("the fonts: which entry each form uses, pinned, with byte-identical fixtures", async () => {
  assert.equal(CJK_DRAW, "runs");
  assert.equal(draftFontsFor("en"), DRAFT_FONTS["zh-s"]);
  assert.equal(draftFontsFor("zh-s"), DRAFT_FONTS["zh-s"]);
  assert.equal(draftFontsFor("zh-t"), DRAFT_FONTS["zh-t"]);
  // 简体: SC, then Latin. 繁體: TC, then SC for the simplified characters TC
  // lacks (陈, 张, …), fetched only when needed, then Latin.
  const names = (entry) => entry.files.map((file) => `${file.url.split("/").at(-1)}${file.ifMissing ? " (if missing)" : ""}`);
  assert.deepEqual(names(DRAFT_FONTS["zh-s"]), ["NotoSansSC_400Regular.ttf", "NotoSans_400Regular.ttf"]);
  assert.deepEqual(names(DRAFT_FONTS["zh-t"]), ["NotoSansTC_400Regular.ttf", "NotoSansSC_400Regular.ttf (if missing)", "NotoSans_400Regular.ttf"]);
  for (const entry of Object.values(DRAFT_FONTS)) {
    for (const file of entry.files) {
      assert.match(file.url, /^https:\/\/cdn\.jsdelivr\.net\/npm\/@expo-google-fonts\/[a-z-]+@\d+\.\d+\.\d+\//);
      const fixture = DRAFT_FONT_FIXTURES[file.url];
      assert.ok(fixture, file.url);
      assert.equal(fixture.sha256, file.sha256);
      assert.equal(sha256(await fixtureBytes(file.url)), file.sha256, file.url);
    }
  }
});

test("printable keeps what the fonts have, strips accents, then uses ?", async () => {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  assert.equal(printable("José Peña", helvetica), "José Peña");
  assert.equal(printable("Nguyễn Thị Lan", helvetica), "Nguyen Thi Lan");
  assert.equal(printable("Łukasz 美", helvetica), "?ukasz ?");
  doc.registerFontkit(fontkit);
  const files = await fontFilesFor("zh-s");
  patchSubsetPadding(fontkit, files.at(-1));
  const fonts = await Promise.all(files.map((bytes) => doc.embedFont(bytes, { subset: true })));
  assert.equal(printable("美 林 Łukasz Żółć Nguyễn", fonts), "美 林 Łukasz Żółć Nguyễn");
  assert.equal(printable("𓀀 Mei", fonts), "? Mei");
});

test("a build with flatten: false round-trips", async () => {
  const { doc } = await build(BASE, { flatten: false });
  const form = doc.getForm();
  assert.equal(form.getTextField(F("page1[0].yourFirstName[0]")).getText(), "Mei");
  assert.equal(form.getTextField(F("page1[0].yourTelephoneNumber[0]")).getText(), "(215) 555-0199");
  assert.equal(form.getCheckBox(F("page1[0].maritalStatus[0].statusMarried[0]")).isChecked(), true);
  assert.equal(form.getCheckBox(F("page1[0].maritalStatus[0].statusDivorced[0].statusDivorced[0]")).isChecked(), false);
  // Comments are written on page 5's ruled lines, not into the field.
  assert.deepEqual(drawnLines(doc.getPage(4)), ["My 1099-INT has not arrived yet."]);
  assert.equal(doc.getTitle(), "13614-C-draft-VT-ABCD-EFGH.pdf");
  assert.equal(doc.getPageCount(), 6);
});

test("the default build is flattened, stamped on every page and keeps six pages", async () => {
  const { doc } = await build(BASE);
  assert.equal(doc.getForm().getFields().length, 0, "no fields left");
  assert.equal(doc.getPageCount(), 6);
  for (const [i, page] of doc.getPages().entries()) {
    const content = pageContent(page);
    assert.ok(content.toUpperCase().includes("<4452414654"), `page ${i + 1} has the DRAFT stamp`);
    // "–" is 0x96 in WinAnsi; the rest of the line is plain ASCII.
    assert.ok(hasHexText(content, "DRAFT \x96 prepared from online answers, 10/04/2026, VT-ABCD-EFGH"), `page ${i + 1}`);
  }
});

test("page 6 stays blank without consent and is filled with it", async () => {
  const signed = { ...BASE, gcf_tp_signature: "Mei Lin", gcf_tp_date: "2026-02-01" };
  const without = await build({ ...signed, gcf_consent: "no" }, { flatten: false });
  assert.equal(without.doc.getPageCount(), 6);
  assert.equal(without.doc.getForm().getTextField(F("page6[0].primaryTaxpayer[0]")).getText(), undefined);
  assert.equal(without.doc.getForm().getTextField(F("page6[0].primaryDateSigned[0]")).getText(), undefined);
  // Even a fields object that carries page-6 text is ignored without consentPage.
  const fields = draftFields({ ...signed, gcf_consent: "yes" }, { ...OPTIONS, form: "en" });
  const forced = await buildDraftPdf({
    PDFLib, fontkit, formBytes: await formBytes("en"), fontFiles: [], stamp: fields.stamp,
    fields: { ...fields, consentPage: false }, flatten: false,
  });
  const forcedDoc = await PDFDocument.load(forced);
  assert.equal(forcedDoc.getForm().getTextField(F("page6[0].primaryTaxpayer[0]")).getText(), undefined);
  const withConsent = await build({ ...signed, gcf_consent: "yes" }, { flatten: false });
  assert.equal(withConsent.doc.getForm().getTextField(F("page6[0].primaryTaxpayer[0]")).getText(), "Mei Lin");
  assert.equal(withConsent.doc.getForm().getTextField(F("page6[0].primaryDateSigned[0]")).getText(), "02/01/2026");
});

test("a 6,000-character comment continues on a seventh page", async () => {
  const words = [];
  while (words.join(" ").length < 6000) words.push(`word${words.length}`);
  const long = words.join(" ").slice(0, 6000).replace(/\s+\S*$/, "");
  const answers = { ...BASE, additional_notes: long };
  for (const flatten of [false, true]) {
    const { doc } = await build(answers, { flatten });
    assert.equal(doc.getPageCount(), 7);
    const box = drawnLines(doc.getPage(4));
    assert.equal(box.length, 30, "one line on each of the 30 ruled lines");
    assert.equal(box.at(-1), "(continued on page 7)");
    const seventh = drawnLines(doc.getPage(6));
    assert.equal(seventh[0], "Additional comments (continued)");
    assert.ok(hasHexText(pageContent(doc.getPage(6)), "Additional comments (continued)"));
    // Nothing is cut off: the words run on, whole and in order, from page 5 to page 7.
    const printed = [...box.slice(0, -1), ...seventh.slice(1)].join(" ").split(/\s+/);
    assert.deepEqual(printed, long.split(" "));
    for (const [i, page] of doc.getPages().entries())
      assert.ok(pageContent(page).toUpperCase().includes("<4452414654"), `page ${i + 1} has the DRAFT stamp`);
  }
});

test("line breaks in comments are kept, and a comment that fits adds no page", async () => {
  const lines = Array.from({ length: 12 }, (_, i) => `Receipt ${i + 1} is in the blue folder.`);
  const { doc } = await build({ ...BASE, additional_notes: lines.join("\n"), inc_tips: "not_sure" });
  assert.equal(doc.getPageCount(), 6);
  assert.deepEqual(drawnLines(doc.getPage(4)), [...lines, "Not sure: Tips"]);
});

test("plain ASCII and WinAnsi names read no font", async () => {
  for (const names of [{}, { tp_first_name: "José", tp_last_name: "Peña", sp_first_name: "Zoë" }]) {
    const { proxy, seen } = watchedFiles();
    const fields = draftFields({ ...BASE, ...names }, { ...OPTIONS, form: "en" });
    const bytes = await buildDraftPdf({ PDFLib, fontkit, formBytes: await formBytes("en"), fontFiles: proxy, fields, stamp: fields.stamp });
    assert.equal(seen.read, false, JSON.stringify(names));
    assert.equal(embeddedFonts(await PDFDocument.load(bytes)).length, 0);
  }
});

test("Chinese and accented Latin names build with the fixture fonts", async () => {
  const cases = [
    ["zh-s", { tp_first_name: "美", tp_last_name: "林", additional_notes: "我的 1099 表还没收到。" }],
    ["zh-t", { tp_first_name: "美", tp_last_name: "林", addr_city: "費城" }],
    ["en", { tp_first_name: "Nguyễn Thị", tp_last_name: "Lan", sp_first_name: "Łukasz", sp_last_name: "Żółć" }],
    ["zh-s", { tp_first_name: "Łukasz 美", tp_last_name: "林 Nguyễn" }],
  ];
  for (const [form, names] of cases) {
    const files = await fontFilesFor(form);
    const { proxy, seen } = watchedFiles(files);
    const answers = { ...BASE, ...names };
    const fields = draftFields(answers, { ...OPTIONS, form });
    assert.equal(fieldsNeedFont(fields), true, form);
    const bytes = await buildDraftPdf({ PDFLib, fontkit, formBytes: await formBytes(form), fontFiles: proxy, fields, stamp: fields.stamp });
    assert.equal(seen.read, true, `${form}: the font path`);
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 6);
    const fonts = embeddedFonts(doc);
    assert.ok(fonts.length >= 1, `${form}: an embedded font`);
    const sources = files.map((bytes) => fontkit.create(bytes));
    for (const font of fonts) assert.deepEqual(subsetProblems(font, sources), [], form);
    // Nothing went missing, so no notice.
    const open = await buildDraftPdf({ PDFLib, fontkit, formBytes: await formBytes(form), fontFiles: files, fields, stamp: fields.stamp, flatten: false });
    assert.ok(!drawnLines((await PDFDocument.load(open)).getPage(4)).includes(NOTICE), form);
  }
  // Ł is in Noto Sans (Latin) only, so the Latin name embeds both files.
  const files = await fontFilesFor("en");
  const fields = draftFields({ ...BASE, sp_first_name: "Łukasz", tp_first_name: "美" }, { ...OPTIONS, form: "en" });
  const bytes = await buildDraftPdf({ PDFLib, fontkit, formBytes: await formBytes("en"), fontFiles: files, fields, stamp: fields.stamp });
  assert.equal(embeddedFonts(await PDFDocument.load(bytes)).length, 2);
});

test("draftFontFiles fetches the 繁體 form's Simplified font only when TC lacks a printed character", async () => {
  const fetched = [];
  const fetchFont = (file) => {
    fetched.push(file.url.split("/").at(-1));
    return fixtureBytes(file.url);
  };
  const filesFor = async (form, names) => {
    fetched.length = 0;
    const fields = draftFields({ ...BASE, ...names }, { ...OPTIONS, form });
    const bytes = await draftFontFiles(draftFontsFor(form), fields, { fetchFont, fontkit });
    return { bytes, fetched: [...fetched].sort() };
  };
  const tc = await filesFor("zh-t", { tp_first_name: "美", tp_last_name: "林" });
  assert.deepEqual(tc.fetched, ["NotoSansTC_400Regular.ttf", "NotoSans_400Regular.ttf"]);
  assert.equal(tc.bytes.length, 2);
  const sc = await filesFor("zh-t", { tp_first_name: "美", tp_last_name: "陈" });
  assert.deepEqual(sc.fetched, ["NotoSansSC_400Regular.ttf", "NotoSansTC_400Regular.ttf", "NotoSans_400Regular.ttf"]);
  // In the chain's order: TC, SC, then Latin (the subset patch reads the last).
  assert.deepEqual(sc.bytes.map((b) => b.length), (await fontFilesFor("zh-t")).map((b) => b.length));
  const hans = await filesFor("zh-s", { tp_first_name: "美", tp_last_name: "陈" });
  assert.deepEqual(hans.fetched, ["NotoSansSC_400Regular.ttf", "NotoSans_400Regular.ttf"]);
});

test("the 繁體 13614-C prints 陈 as typed, with no missing-character notice", async () => {
  const fields = draftFields({ ...BASE, tp_last_name: "陈" }, { ...OPTIONS, form: "zh-t" });
  const fontFiles = await draftFontFiles(draftFontsFor("zh-t"), fields, { fetchFont: (file) => fixtureBytes(file.url), fontkit });
  const { doc } = await build({ ...BASE, tp_last_name: "陈" }, { form: "zh-t", fontFiles, flatten: false });
  assert.ok(drawnText(doc.getPage(0)).some((line) => line.text.includes("陈")), "陈 is drawn on page 1");
  const page5 = drawnText(doc.getPage(4)).map((line) => line.text);
  assert.ok(!page5.some((line) => line.includes(fields.words.notice)), `the notice: ${JSON.stringify(page5)}`);
  assert.ok(!page5.some((line) => line.includes("?")), `a "?" on page 5: ${JSON.stringify(page5)}`);
});

test("Chinese comments with no spaces wrap by characters and continue on page 7", async () => {
  const files = await fontFilesFor("zh-s");
  const notes = "我的表还没收到".repeat(500); // 3,500 characters, no spaces
  const { doc } = await build({ ...BASE, additional_notes: notes }, { form: "zh-s", fontFiles: files });
  assert.equal(doc.getPageCount(), 7);
  // The PDF's own lines are Chinese on a 简体 form, drawn in the embedded font.
  assert.equal(drawnText(doc.getPage(4)).at(-1).text, "（续见第 7 页）");
  assert.equal(drawnText(doc.getPage(6))[0].text, "补充说明（续）");
  // 29 ruled lines of runs on page 5 before the marker, and the marker is a run too.
  const glyphRuns = (page) => [...pageContent(page).matchAll(/<(00[0-9A-Fa-f]*)>\s*Tj/g)].length;
  assert.equal(glyphRuns(doc.getPage(4)), 30);
  assert.ok(glyphRuns(doc.getPage(6)) > 0);
});

test("a Chinese draft with a generated line needs the font even when every answer is Latin; English does not", () => {
  const answers = { ...BASE, inc_tips: "not_sure" };
  assert.equal(fieldsNeedFont(draftFields(answers, { ...OPTIONS, form: "en" })), false);
  for (const form of ["zh-s", "zh-t"]) assert.equal(fieldsNeedFont(draftFields(answers, { ...OPTIONS, form })), true, form);
  // No generated line, Latin answers: still no font on a Chinese form (the 4b2 rule).
  assert.equal(fieldsNeedFont(draftFields(BASE, { ...OPTIONS, form: "zh-s" })), false);
});

test("a 简体 form with six household members and long notes overflows in Chinese as in English", async () => {
  const files = await fontFilesFor("zh-s");
  const notes = Array.from({ length: 26 }, (_, i) => `第 ${i + 1} 张收据在蓝色文件夹里。`).join("\n");
  const hh = ["安", "博", "才", "丹", "伊", "飞"].map((first, i) => ({
    member_id: String(i + 1).padStart(32, "0"), first_name: first, last_name: "林", dob: `201${i}-0${i + 1}-1${i}`,
    relationship: "son_daughter", months_lived: "12", married: "single",
    us_citizen: "yes", resident_na: "yes", fulltime_student: "no", disabled: "no", ippin: i === 5 ? "not_sure" : "no",
  }));
  const answers = { ...BASE, additional_notes: notes, inc_tips: "not_sure", has_household_members: "yes", hh };
  const { doc, fields } = await build(answers, { form: "zh-s", fontFiles: files });
  assert.equal(fieldsNeedFont(fields), true);
  assert.equal(doc.getPageCount(), 7);
  const box = drawnText(doc.getPage(4));
  const seventh = drawnText(doc.getPage(6));
  // The box's 30th ruled line says where the rest went; page 7 has its title.
  assert.deepEqual(box.at(-1), { y: 560 - 29 * 18, text: "（续见第 7 页）" });
  assert.equal(seventh[0].text, "补充说明（续）");
  // Nothing cut off, in order: what the two pages print is the comments, wrapped.
  const printed = [...box.slice(0, -1), ...seventh.slice(1)].map((line) => line.text).join("");
  assert.equal(printed.replace(/\s+/g, ""), fields.comments.replace(/\s+/g, ""));
  assert.ok(fields.comments.includes("不确定：成员 6：是否持有身份保护码（IP PIN）？、小费"));
  // The household overflow rows are Chinese and continue on page 7.
  const rest = seventh.map((line) => line.text).join("\n");
  assert.match(rest, /成员 5：伊 林 · 子女 · 2014年5月14日出生 · 居住 12 个月 · 未婚 · 美国公民：是/);
  assert.match(rest, /成员 6：飞 林 · 子女 · 2015年6月15日出生 · /);
});

// Section 1, decision 2 of the wording review (#48): the continued page's
// heading, the box's last line and the notice follow the form's language.
test("the Chinese continued heading fits the page on both Chinese forms", async () => {
  const doc = await PDFDocument.load(await formBytes("zh-s"));
  const page = doc.getPage(4);
  const box = doc.getForm().getTextField(draftFieldNames("zh-s").find((name) => /AdditionalNotesComments/.test(name)))
    .acroField.getWidgets()[0].getRectangle();
  const room = page.getWidth() - 2 * box.x;
  for (const form of ["zh-s", "zh-t"]) {
    const title = form === "zh-s" ? "补充说明（续）" : HANT_MAP["补充说明（续）"];
    assert.ok(title, form);
    const fonts = (await fontFilesFor(form)).map((bytes) => fontkit.create(bytes));
    let width = 0;
    for (const ch of title) {
      const font = fonts.find((f) => f.hasGlyphForCodePoint(ch.codePointAt(0)));
      assert.ok(font, `${form}: no font has ${ch}`);
      width += (font.layout(ch).advanceWidth / font.unitsPerEm) * 14;
    }
    assert.ok(width > 0 && width <= room, `${form}: ${width} pt in ${room} pt`);
  }
});

test("a Chinese form with only Latin comments keeps the font rule and English lines when they continue", async () => {
  const fields = draftFields({ ...BASE, additional_notes: "Receipt number 1234 is in the blue folder. ".repeat(160) }, { ...OPTIONS, form: "zh-s" });
  assert.equal(fieldsNeedFont(fields), false, "no font is fetched for Latin text");
  const bytes = await buildDraftPdf({ PDFLib, fontkit, formBytes: await formBytes("zh-s"), fontFiles: [], fields, stamp: fields.stamp });
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 7);
  assert.equal(drawnLines(doc.getPage(4)).at(-1), "(continued on page 7)");
  assert.equal(drawnLines(doc.getPage(6))[0], "Additional comments (continued)");
});

test("a character neither font has prints as ? and Additional Comments says so", async () => {
  const files = await fontFilesFor("en");
  const answers = { ...BASE, tp_first_name: "𓀀 Mei" };
  const fields = draftFields(answers, { ...OPTIONS, form: "en" });
  const open = await buildDraftPdf({ PDFLib, fontkit, formBytes: await formBytes("en"), fontFiles: files, fields, stamp: fields.stamp, flatten: false });
  assert.deepEqual(drawnLines((await PDFDocument.load(open)).getPage(4)), ["My 1099-INT has not arrived yet.", NOTICE]);
  const flat = await buildDraftPdf({ PDFLib, fontkit, formBytes: await formBytes("en"), fontFiles: files, fields, stamp: fields.stamp });
  assert.equal((await PDFDocument.load(flat)).getPageCount(), 6);
  // In the comments too, without the notice ending up twice.
  const inNotes = draftFields({ ...BASE, additional_notes: "Ask about 𓀀 and 𓀀" }, { ...OPTIONS, form: "en" });
  const notesPdf = await buildDraftPdf({ PDFLib, fontkit, formBytes: await formBytes("en"), fontFiles: files, fields: inNotes, stamp: inNotes.stamp });
  // The notes' line is drawn with the downloaded fonts ("?" for 𓀀, glyph
  // ids on the page); the notice is a WinAnsi line, drawn in Helvetica, once.
  const page5 = (await PDFDocument.load(notesPdf)).getPage(4);
  assert.deepEqual(drawnLines(page5), [NOTICE]);
  const runs = [...pageContent(page5).matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)].filter((m) => m[1].startsWith("00"));
  assert.ok(runs.length > 0, "a run in an embedded font (two-byte glyph ids)");
});

test("the builder reaches the subset patch through the small Latin file, never by parsing the CJK one again", async () => {
  const files = await fontFilesFor("zh-s");
  const parsed = [];
  const counting = {
    ...fontkit,
    create: (bytes, ...rest) => {
      parsed.push(bytes.length);
      return fontkit.create(bytes, ...rest);
    },
  };
  const fields = draftFields({ ...BASE, tp_first_name: "美", sp_first_name: "Łukasz" }, { ...OPTIONS, form: "zh-s" });
  await buildDraftPdf({ PDFLib, fontkit: counting, formBytes: await formBytes("zh-s"), fontFiles: files, fields, stamp: fields.stamp });
  assert.equal(parsed.filter((length) => length === files[0].length).length, 1, "the 10 MB CJK file is parsed once, to embed it");
  assert.equal(parsed.filter((length) => length === files.at(-1).length).length, 2, "the Latin file: the patch, then its embedding");
});

test("the subset padding patch: without it the subset is corrupt, with it every glyph decodes", async () => {
  const [sc, latin] = await fontFilesFor("zh-s");
  const text = "美 林 l o d 1 0 示例";
  const embed = async (kit) => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(kit);
    const font = await doc.embedFont(sc, { subset: true });
    doc.addPage().drawText(text, { font, size: 12, x: 20, y: 20 });
    return embeddedFonts(await PDFDocument.load(await doc.save()));
  };
  const source = [fontkit.create(sc)];
  // A fresh, unpatched copy of fontkit 1.1.1: the check must catch the bug.
  const require = createRequire(import.meta.url);
  const path = require.resolve("@pdf-lib/fontkit");
  const cached = require.cache[path];
  delete require.cache[path];
  const unpatched = require(path);
  require.cache[path] = cached;
  assert.notEqual(unpatched, fontkit);
  const [broken] = await embed(unpatched);
  assert.notDeepEqual(subsetProblems(broken, source), [], "the unpatched subset is caught");
  // Patched (twice is harmless): consistent. The builder patches through the
  // small Latin file, never by parsing the 10 MB CJK one: the prototype is
  // shared, so the CJK subset is padded all the same.
  patchSubsetPadding(unpatched, latin);
  patchSubsetPadding(unpatched, latin);
  const [fixed] = await embed(unpatched);
  assert.deepEqual(subsetProblems(fixed, source), []);
});

test("the committed vendor bundle builds a Chinese draft whose subsets decode", async () => {
  assert.equal(typeof bundled.PDFDocument.load, "function");
  assert.equal(typeof bundled.fontkit.create, "function");
  const fields = draftFields({ ...BASE, tp_first_name: "美", tp_last_name: "林", sp_first_name: "Żółć" }, { ...OPTIONS, form: "zh-t" });
  // What app.mjs passes: TC and Latin; TC has 美 and 林, so SC isn't fetched.
  const files = await draftFontFiles(draftFontsFor("zh-t"), fields, { fetchFont: (file) => fixtureBytes(file.url), fontkit: bundled.fontkit });
  assert.equal(files.length, 2);
  const bytes = await buildDraftPdf({
    PDFLib: bundled, fontkit: bundled.fontkit, formBytes: await formBytes("zh-t"), fontFiles: files, fields, stamp: fields.stamp,
  });
  const fonts = embeddedFonts(await PDFDocument.load(bytes));
  assert.equal(fonts.length, 2);
  const sources = files.map((b) => fontkit.create(b));
  for (const font of fonts) assert.deepEqual(subsetProblems(font, sources), []);
});

// The link offered when the browser blocks the draft's tab (app.mjs viewDraft)
// is kept here, not in the page: every full redraw replaces #draft-ready, and
// the link is drawn again after each one until it is opened or expires.
test("the blocked-tab draft link outlives redraws until it is opened or its URL expires", () => {
  const timers = [];
  const revoked = [];
  let expired = 0;
  const offers = createDraftOffer({
    revoke: (url) => revoked.push(url),
    onExpire: () => { expired += 1; },
    setTimer: (fn, ms) => timers.push({ fn, ms }),
  });
  assert.equal(offers.current("case-1"), null, "nothing to offer yet");

  // A tab that opened: its URL is revoked after a minute, and no link is offered.
  offers.keep("blob:tab");
  assert.equal(timers[0].ms, 60_000);
  assert.equal(offers.current("case-1"), null);

  // A blocked tab: the link is offered on its own case only, as often as asked.
  offers.keep("blob:one");
  offers.offer({ url: "blob:one", fileName: "Draft-13614-C-VT-TEST.pdf", caseId: "case-1", userId: "user-1" });
  for (let redraw = 0; redraw < 3; redraw += 1)
    assert.deepEqual(offers.current("case-1", "user-1"), { url: "blob:one", fileName: "Draft-13614-C-VT-TEST.pdf", caseId: "case-1", userId: "user-1" });
  assert.equal(offers.current("case-2", "user-1"), null, "never on another case's page");

  // Expiry revokes the URL and ends the offer.
  timers[1].fn();
  assert.deepEqual(revoked, ["blob:one"]);
  assert.equal(offers.current("case-1", "user-1"), null);
  assert.equal(expired, 1);
  timers[0].fn();
  assert.deepEqual(revoked, ["blob:one", "blob:tab"], "every draft's URL is revoked");

  // Opened (or replaced by a new press): no longer drawn, but its URL lives out its minute.
  offers.keep("blob:two");
  offers.offer({ url: "blob:two", fileName: "a.pdf", caseId: "case-1", userId: "user-1" });
  offers.drop();
  assert.equal(offers.current("case-1", "user-1"), null);
  // An older URL's expiry never ends a newer offer.
  offers.keep("blob:three");
  offers.offer({ url: "blob:three", fileName: "b.pdf", caseId: "case-1", userId: "user-1" });
  timers[2].fn();
  assert.deepEqual(revoked.at(-1), "blob:two");
  assert.equal(offers.current("case-1", "user-1").url, "blob:three");
});

test("a draft offer with no lifetime revokes its URL after 60 seconds", () => {
  const delays = [];
  const offers = createDraftOffer({ revoke: () => {}, setTimer: (fn, ms) => delays.push(ms) });
  offers.keep("blob:one");
  offers.offer({ url: "blob:one", fileName: "a.pdf", caseId: "case-1", userId: "user-1" });
  assert.deepEqual(delays, [60_000]);
});

// The draft holds the answers of whoever made it (unsaved edits included):
// another person signing in to the same tab within its minute, even on the
// same case, never sees it, and signing out ends it at once.
test("the blocked-tab draft link belongs to who made it: a sign-out or another user ends it", () => {
  const revoked = [];
  let expired = 0;
  const timers = [];
  const offers = createDraftOffer({
    revoke: (url) => revoked.push(url),
    onExpire: () => { expired += 1; },
    setTimer: (fn) => timers.push(fn),
  });
  offers.keep("blob:mine");
  offers.offer({ url: "blob:mine", fileName: "a.pdf", caseId: "case-1", userId: "user-1" });
  assert.equal(offers.current("case-1", "user-2"), null, "never shown to another user");
  offers.follow("user-1");
  assert.equal(offers.current("case-1", "user-1").url, "blob:mine", "the same user keeps it");
  offers.follow(null); // signed out
  assert.deepEqual(revoked, ["blob:mine"], "revoked at once");
  assert.equal(offers.current("case-1", "user-1"), null, "and not back after signing in again");
  timers[0]();
  assert.equal(expired, 0, "its later expiry has nothing left to end");
  assert.deepEqual(revoked, ["blob:mine"], "and its URL is not revoked a second time");

  offers.keep("blob:theirs");
  offers.offer({ url: "blob:theirs", fileName: "b.pdf", caseId: "case-1", userId: "user-1" });
  offers.follow("user-2"); // another user signed in
  assert.equal(revoked.at(-1), "blob:theirs");
  assert.equal(offers.current("case-1", "user-2"), null);
  assert.equal(offers.current("case-1", "user-1"), null);
  timers[1]();
  assert.deepEqual(revoked, ["blob:mine", "blob:theirs"], "that URL is not revoked a second time either");
});

// A keyboard user on the link keeps it across a redraw: the render's focus
// restore finds it again by its id (app.mjs showDraftLink draws it before the
// restore runs).
test("the blocked-tab draft link can be found again by the focus restore", () => {
  const made = [];
  const fakeDocument = {
    createElement: (tag) => {
      const element = { tagName: tag.toUpperCase(), dataset: {}, id: "", name: undefined };
      made.push(element);
      return element;
    },
  };
  const link = draftLink(fakeDocument, { url: "blob:one", fileName: "13614-C-draft-VT-TEST-en.pdf" }, "Your draft is ready: open it");
  assert.equal(made.length, 1);
  assert.equal(link.tagName, "A");
  assert.equal(link.href, "blob:one");
  assert.equal(link.download, "13614-C-draft-VT-TEST-en.pdf");
  assert.equal(link.target, "_blank");
  assert.equal(link.textContent, "Your draft is ready: open it");
  const focus = describeFocus(link);
  assert.ok(focus, "the focus restore has something to look for");
  assert.deepEqual(focusSelectors(focus), ['[id="draft-ready-link"]']);
});

// Row 1 of the household cells prints only while the client shows a member.
const WITH_CHILD = {
  ...BASE, has_household_members: "yes",
  hh: [{ member_id: "1".padStart(32, "0"), first_name: "Ana", last_name: "Lin", dob: "2015-06-07", relationship: "son_daughter", months_lived: "12", married: "single", us_citizen: "yes", resident_na: "yes", fulltime_student: "no", disabled: "no", ippin: "no" }],
};

test("shaded values round-trip in all three forms, a Chinese reason through runs", async () => {
  const shaded = { household1QualifyingChild: "yes", incomeW2s: true, incomeW2sCount: 2, incomeRefundAmount: "412.00", infoDisallowedReason: "子女资格不符" };
  for (const form of ["en", "zh-s", "zh-t"]) {
    const { doc } = await build(WITH_CHILD, { form, shaded, flatten: false, fontFiles: await fontFilesFor(form) });
    const f = doc.getForm();
    assert.equal(f.getTextField(shadedName("household1QualifyingChild", form)).getText(), "Yes", form);
    assert.ok(f.getCheckBox(shadedName("incomeW2s", form)).isChecked(), form);
    assert.equal(f.getTextField(shadedName("incomeW2sCount", form)).getText(), "2", form);
    assert.equal(f.getTextField(shadedName("incomeRefundAmount", form)).getText(), "412.00", form);
    assert.ok(drawnText(doc.getPage(2)).some((l) => l.text.includes("子女资格不符")), `reason drawn: ${form}`);
  }
});

test("a long note continues in Additional Comments, every character printed", async () => {
  const note = Array.from({ length: 80 }, (_, i) => `w${String(i).padStart(3, "0")}`).join(" "); // 400 characters
  assert.equal(note.length, 399);
  const { doc, fields } = await build(BASE, { shaded: { deductionNotes: note } });
  assert.equal(doc.getPageCount(), 6);
  const lines = (page) => drawnText(page).map((l) => l.text);
  const inBox = lines(doc.getPage(2));
  const rest = lines(doc.getPage(4));
  assert.ok(inBox.length > 0 && inBox[0].startsWith("w000"), JSON.stringify(inBox));
  const at = rest.indexOf("Continued from page 3, Standard or itemized deductions notes:");
  assert.ok(at >= 0, JSON.stringify(rest));
  const printed = [...inBox, ...rest.slice(at + 1)].join(" ").split(/\s+/).filter((w) => /^w\d{3}$/.test(w));
  assert.deepEqual(printed, note.split(" "));
  assert.ok(rest.includes("My 1099-INT has not arrived yet."));
  assert.equal(fields.notes.length, 1);
});

/** Every drawn line from `from` (0-based page) on, without the PDF's own continuation lines. */
const drawnFrom = (doc, from) =>
  doc.getPages().slice(from).flatMap((page) => drawnText(page).map((l) => l.text))
    .filter((t) => t !== "Additional comments (continued)" && t !== "补充说明（续）" && !/^(\(continued on page \d+\)|（续见第 \d+ 页）)$/.test(t));
const squash = (text) => text.replace(/\s+/gu, "");

test("a multi-paragraph note with a blank line prints every character", async () => {
  const para = (tag, n) => Array.from({ length: n }, (_, i) => `${tag}${String(i).padStart(2, "0")}`).join(" ");
  const note = `${para("a", 20)}\n\n${para("b", 25)}\n${para("c", 12)}`;
  const { doc } = await build({ tp_first_name: "Mei" }, { shaded: { deductionNotes: note } });
  const inBox = drawnText(doc.getPage(2)).map((l) => l.text);
  const rest = drawnFrom(doc, 4);
  assert.equal(rest[0], "Continued from page 3, Standard or itemized deductions notes:");
  assert.equal(squash([...inBox, ...rest.slice(1)].join("")), squash(note));
});

test("a Chinese note under zh-s prints every character", async () => {
  const note = "我的表还没收到，请在三月前补交。\n\n" + "子女资格需要再确认".repeat(25);
  const { doc } = await build({ tp_first_name: "Mei" }, { form: "zh-s", fontFiles: await fontFilesFor("zh-s"), shaded: { deductionNotes: note } });
  const inBox = drawnText(doc.getPage(2)).map((l) => l.text);
  const rest = drawnFrom(doc, 4);
  assert.equal(rest[0], "Continued from page 3, Standard or itemized deductions notes:");
  assert.equal(squash([...inBox, ...rest.slice(1)].join("")), squash(note));
});

test("the preparer-entries stamp is on every page, continued pages included", async () => {
  const { doc } = await build(BASE, { shaded: { deductionNotes: "word ".repeat(3000) } });
  assert.ok(doc.getPageCount() > 6);
  for (const page of doc.getPages())
    assert.ok(hasHexText(pageContent(page), "DRAFT \x96 online answers and preparer entries, 10/04/2026, VT-ABCD-EFGH"));
});

test("a case with no saved section draws the same as one built without the option", async () => {
  const [plain, nulled] = await Promise.all([build(BASE), build(BASE, { shaded: null })]);
  assert.deepEqual(plain.doc.getPages().map((p) => drawnText(p)), nulled.doc.getPages().map((p) => drawnText(p)));
  assert.equal(plain.fields.stamp, nulled.fields.stamp);
  assert.equal(plain.doc.getPageCount(), nulled.doc.getPageCount());
});

test("a short note stays in its box and a case with no section is unchanged", async () => {
  const { doc } = await build(BASE, { shaded: { incomeNotes: "Two jobs." } });
  assert.ok(drawnText(doc.getPage(1)).some((l) => l.text === "Two jobs."));
  assert.ok(!drawnText(doc.getPage(4)).some((l) => l.text.startsWith("Continued from")));
});

// ---------------------------------------------------------------------------
// The editing copy and the reader for a filled copy
// ---------------------------------------------------------------------------

const EDIT_OPTIONS = { reference: "VT-ABCD-EFGH", today: "2026-10-24" };
async function editingCopy(answers, { shaded = {}, version = 3, reference = EDIT_OPTIONS.reference, lib = PDFLib } = {}) {
  const fields = draftFields(answers, { ...EDIT_OPTIONS, form: "en" });
  return buildEditingCopy({
    PDFLib: lib, fontkit, formBytes: await formBytes("en"), fontFiles: await fontFilesFor("en"),
    fields, shaded, reference, version,
  });
}

test("the editing copy keeps exactly the shaded fields", async () => {
  const bytes = await editingCopy(BASE);
  const doc = await PDFDocument.load(bytes);
  const names = doc.getForm().getFields().map((f) => f.getName());
  assert.equal(names.length, 106);
  assert.deepEqual([...names].sort(), [...shadedNames("en")].sort());
  assert.equal(doc.getKeywords(), "vitally-shaded case:VT-ABCD-EFGH version:3");
  assert.match(pageContent(doc.getPage(0)), /FlatWidget/, "the client answers are drawn on the page");
});

test("an editing copy for a Chinese name builds, with the note's /V decoding back", async () => {
  const note = "收入说明：一份 W-2";
  const bytes = await editingCopy({ ...BASE, tp_first_name: "美玲" }, { shaded: { incomeNotes: note, incomeW2s: true, incomeW2sCount: 2, household1QualifyingChild: "yes" } });
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  assert.equal(form.getFields().length, 106);
  const field = form.getTextField(shadedName("incomeNotes"));
  assert.equal(field.acroField.dict.lookup(PDFName.of("V")).decodeText(), note);
  assert.equal(doc.catalog.lookup(PDFName.of("AcroForm")).get(PDFName.of("NeedAppearances")), PDFBool.True);
  assert.ok(form.getCheckBox(shadedName("incomeW2s")).isChecked());
  assert.equal(form.getTextField(shadedName("incomeW2sCount")).getText(), "2");
  assert.equal(form.getTextField(shadedName("household1QualifyingChild")).getText(), "Yes");
});

test("the editing copy built with the bundled pdf-lib matches", async () => {
  const bytes = await editingCopy(BASE, { lib: bundled });
  assert.equal((await PDFDocument.load(bytes)).getForm().getFields().length, 106);
});

test("the copy round-trips through the reader", async () => {
  const doc = await PDFDocument.load(await editingCopy(BASE, { version: 4 }));
  const form = doc.getForm();
  form.getCheckBox(shadedName("incomeW2s")).check();
  form.getTextField(shadedName("incomeW2sCount")).setText("2");
  const filled = await doc.save();
  const { raw, version } = await readFilledCopy({ PDFLib, bytes: filled, reference: "VT-ABCD-EFGH" });
  assert.equal(version, 4);
  assert.deepEqual(readShaded(raw, { form: "en" }), { values: { incomeW2s: true, incomeW2sCount: 2 }, errors: [] });
});

test("the reader reports a Preview Producer", async () => {
  const plain = await readFilledCopy({ PDFLib, bytes: await editingCopy(BASE), reference: "VT-ABCD-EFGH" });
  assert.equal(plain.preview, false);
  const doc = await PDFDocument.load(await editingCopy(BASE), { updateMetadata: false });
  doc.setProducer("macOS Version 14.5 (Build 23F79) Quartz PDFContext");
  const saved = await readFilledCopy({ PDFLib, bytes: await doc.save(), reference: "VT-ABCD-EFGH" });
  assert.equal(saved.preview, true);
});

test("the reader takes any box export value but Off as ticked", async () => {
  // Another PDF tool may tick with its own on-state name (/1, /On) or a string,
  // or leave /V unset and say it only in the widget's /AS.
  const doc = await PDFDocument.load(await editingCopy(BASE));
  const form = doc.getForm();
  const field = (key) => form.getCheckBox(shadedName(key)).acroField;
  field("incomeW2s").dict.set(PDFName.of("V"), PDFName.of("1"));
  field("incomeTips").dict.set(PDFName.of("V"), PDFName.of("Off"));
  field("income1099R").dict.set(PDFName.of("V"), PDFHexString.fromText("On"));
  const widgetOnly = field("incomeQcd");
  widgetOnly.dict.delete(PDFName.of("V"));
  for (const widget of widgetOnly.getWidgets()) widget.dict.set(PDFName.of("AS"), PDFName.of("On"));
  const { raw } = await readFilledCopy({ PDFLib, bytes: await doc.save(), reference: "VT-ABCD-EFGH" });
  const { values, errors } = readShaded(raw, { form: "en" });
  assert.deepEqual(errors, []);
  assert.equal(values.incomeW2s, true);
  assert.equal(values.incomeTips, undefined);
  assert.equal(values.income1099R, true);
  assert.equal(values.incomeQcd, true);
  // An untouched box is still absent.
  assert.equal(values.incomeDisability, undefined);
});

test("the reader refuses another case's copy, a flattened copy and a broken file", async () => {
  const copy = await editingCopy(BASE);
  await assert.rejects(readFilledCopy({ PDFLib, bytes: copy, reference: "VT-ZZZZ-YYYY" }), (e) => e.code === "OTHER_CASE" && /different case/.test(e.message));
  const flat = await PDFDocument.load(copy);
  flat.getForm().flatten();
  await assert.rejects(readFilledCopy({ PDFLib, bytes: await flat.save(), reference: "VT-ABCD-EFGH" }),
    (e) => e.code === "NO_FIELDS" && e.message === "This copy has no form fields. In Chrome, use the download button, not Print.");
  for (const bytes of [new TextEncoder().encode("hello"), new Uint8Array(0)])
    await assert.rejects(readFilledCopy({ PDFLib, bytes, reference: "VT-ABCD-EFGH" }),
      (e) => e.code === "NOT_A_PDF" && e.message === "This file isn't a PDF the editor can read.");
});

test("a printed copy, with no fields and no Keywords, gets the Print sentence", async () => {
  // Print to PDF makes a new file: the form is drawn, and neither the fields
  // nor the document's Keywords survive.
  const printed = await PDFDocument.create();
  printed.addPage().drawText("13614-C", { x: 50, y: 700 });
  const bytes = await printed.save();
  await assert.rejects(readFilledCopy({ PDFLib, bytes, reference: "VT-ABCD-EFGH" }),
    (e) => e.code === "NO_FIELDS" && e.message === "This copy has no form fields. In Chrome, use the download button, not Print.");
  // A flattened copy whose Keywords name another case is still a copy with no fields.
  const flat = await PDFDocument.load(await editingCopy(BASE));
  flat.getForm().flatten();
  await assert.rejects(readFilledCopy({ PDFLib, bytes: await flat.save(), reference: "VT-ZZZZ-YYYY" }), (e) => e.code === "NO_FIELDS");
  // A copy with the shaded fields but no case keyword is another case's.
  const unmarked = await PDFDocument.load(await editingCopy(BASE));
  unmarked.setKeywords([]);
  await assert.rejects(readFilledCopy({ PDFLib, bytes: await unmarked.save(), reference: "VT-ABCD-EFGH" }), (e) => e.code === "OTHER_CASE");
});

test("stored values come back through the reader, a two-line note included", async () => {
  const shaded = { household1QualifyingChild: "na", incomeNotes: "line one\nline two", incomeRefundAmount: "412.00", itemizedLastYearYes: true };
  const { raw } = await readFilledCopy({ PDFLib, bytes: await editingCopy(BASE, { shaded }), reference: "VT-ABCD-EFGH" });
  assert.deepEqual(readShaded(raw, { form: "en" }).values, shaded);
});
