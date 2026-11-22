// The "nothing left in English" sweep (spec 2026-10-05 §6): the visible text of
// a rendered screen, the Latin words it may hold, and the history sentences the
// migrations write (§3.3).
import { readFileSync, readdirSync } from "node:fs";
import CATALOGUE from "../../src/intake-catalogue-data.mjs";
import { CARD_RULES, CARD_WHY, CARD_TEMPLATES } from "../../src/document-cards.mjs";

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m]);

// Visible text plus the four attributes that are read aloud or shown on hover.
export function textOf(html) {
  const attributes = [...html.matchAll(/\s(?:aria-label|title|placeholder|alt)="([^"]*)"/g)].map((m) => m[1]);
  const body = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ");
  return decode([body, ...attributes].join(" ")).replace(/\s+/g, " ").trim();
}

// Brand, form and document names, the Application ID's format, which the
// lookup shows as its placeholder in every language, and the date boxes'
// placeholders, which stay YYYY, MM and DD in Chinese (Task 3's ruling; the
// boxes' labels are 年, 月 and 日).
const FIXED = ["ViTally", "PCDC", "OneDrive", "English", "W-2", "W-2s", "1099", "1098", "1095", "ITIN", "IRS", "IP", "PIN", "SSN", "EAD", "13614-C", "CP01A", "TIN", "Philadelphia", "PA", "VT-XXXX-XXXX", "YYYY", "MM", "DD"];

function zhLatinWords() {
  const words = new Set();
  const visit = (v) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!v || typeof v !== "object") return;
    const zh = typeof v.zh === "string" ? v.zh : v.zh?.template;
    if (typeof zh === "string") for (const w of zh.match(/[A-Za-z][A-Za-z0-9-]*/g) ?? []) words.add(w);
    for (const [k, child] of Object.entries(v)) if (k !== "zh") visit(child);
  };
  visit(CATALOGUE);
  visit(CARD_RULES);
  visit(CARD_WHY);
  visit(CARD_TEMPLATES);
  return words;
}
const ZH_WORDS = zhLatinWords();

// The whole tokens of the test's data values: each value split on whitespace
// and on @ . / , ( ). A word is allowed only as a whole token, so a short
// English word ("a", "in", "record", "town") never hides inside an email or a
// file name. "-" is not a separator: the word pattern below keeps hyphens, so
// the screen's words are VT-AB2C-DE3F, demo-mileage-record-2025 and
// chinatown-pcdc, which are exactly these tokens; splitting them further would
// only let their parts ("record", "demo") pass on their own.
export const dataTokens = (data = []) =>
  new Set(data.flatMap((value) => String(value).split(/[\s@./,()]+/)).filter(Boolean));

// Latin words in `text` that aren't allowed. `data` holds the test's own
// values (reference, email, names, phone, office address); a word passes only
// as one of their whole tokens.
export function latinLeaks(text, data = []) {
  const allowed = new Set([...FIXED, ...ZH_WORDS, ...dataTokens(data)]);
  return (text.match(/[A-Za-z][A-Za-z0-9'’-]*/g) ?? []).filter((w) => !allowed.has(w));
}

// ---------------------------------------------------------------------------
// The history sentences in the migrations
// ---------------------------------------------------------------------------

export const REQUEST_PREFIX = "A volunteer requested a document: ";
// Migration 036: the office's request line at intake (titles typed by the office).
export const DOCUMENTS_PREFIX = "PCDC asked for these documents: ";

// SQL as tokens: single-quoted literals ('' unescaped), words (identifiers and
// keywords, dots included), numbers and single punctuation marks. `--`
// comments are dropped. `depth` is the square-bracket depth, so a literal
// inside array[…] is never read as a value.
function tokens(sql) {
  const out = [];
  let depth = 0;
  for (let i = 0; i < sql.length; ) {
    const c = sql[i];
    if (c === "'") {
      let value = "";
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) throw new Error("unterminated SQL literal");
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            value += "'";
            j += 2;
            continue;
          }
          break;
        }
        value += sql[j++];
      }
      out.push({ type: "str", value, depth });
      i = j + 1;
    } else if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
    } else if (/\s/.test(c)) {
      i++;
    } else if (/[A-Za-z_]/.test(c)) {
      const word = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(sql.slice(i, i + 200))[0];
      out.push({ type: "word", value: word.toLowerCase(), depth });
      i += word.length;
    } else if (/[0-9]/.test(c)) {
      const number = /^[0-9][0-9.]*/.exec(sql.slice(i, i + 50))[0];
      out.push({ type: "num", value: number, depth });
      i += number.length;
    } else if (c === "|" && sql[i + 1] === "|") {
      out.push({ type: "punct", value: "||", depth });
      i += 2;
    } else if (c === ":" && sql[i + 1] === ":") {
      out.push({ type: "punct", value: "::", depth });
      i += 2;
    } else {
      if (c === "[") depth++;
      if (c === "]") depth = Math.max(0, depth - 1);
      out.push({ type: "punct", value: c, depth });
      i++;
    }
  }
  return out;
}

const is = (token, type, value) => token?.type === type && (value === undefined || token.value === value);

// A literal value: one quoted literal, optionally cast ('…'::text).
function literalOf(element) {
  if (!is(element[0], "str")) return null;
  const rest = element.slice(1);
  if (rest.length === 0 || (rest.length === 2 && is(rest[0], "punct", "::") && is(rest[1], "word"))) return element[0].value;
  return null;
}

// The tuples of one values list starting at tokens[at] ("(" of the first tuple):
// each a list of elements (token lists split at its top-level commas). Returns
// the tuples and the index after the last one.
function tuplesAt(list, at) {
  const tuples = [];
  let i = at;
  while (is(list[i], "punct", "(")) {
    let level = 0;
    const elements = [[]];
    for (; i < list.length; i++) {
      const token = list[i];
      if (is(token, "punct", "(")) {
        level++;
        if (level === 1) continue;
      }
      if (is(token, "punct", ")")) {
        level--;
        if (level === 0) break;
      }
      if (level === 1 && is(token, "punct", ",")) elements.push([]);
      else elements.at(-1).push(token);
    }
    tuples.push(elements);
    i++;
    if (is(list[i], "punct", ",") && is(list[i + 1], "punct", "(")) i++;
    else break;
  }
  return { tuples, end: i };
}

// The words of a parenthesised column list starting at tokens[at].
function columnsAt(list, at) {
  if (!is(list[at], "punct", "(")) return null;
  const names = [];
  for (let i = at + 1; i < list.length && !is(list[i], "punct", ")"); i++) if (is(list[i], "word")) names.push(list[i].value);
  return names;
}

/**
 * Every client-history sentence in `sql`, and every request line.
 *  - `'message',<literal>`: a sentence, unless the literal is followed by `||`
 *    (then it is a request prefix) or sits inside array[…];
 *  - `'message',case when … then <literal> … end`: each literal after `then`;
 *  - `'message',` followed by a number or an identifier: nothing;
 *  - a `values(…)` list whose columns include `message` — either
 *    `insert into …client_events(cols) values(…)` or `(values …) as v(cols)` —
 *    gives the literal at the column index of `message`.
 * Returns `{ sentences, prefixes, requests }`: the fixed sentences, the request
 * prefixes found (`'…'||`), and seeded lines that start with REQUEST_PREFIX
 * (`historyLine` handles those, so they are kept apart from the sentences).
 */
export function historySentences(sql) {
  const list = tokens(sql);
  const sentences = new Set();
  const prefixes = new Set();
  const requests = new Set();
  const keep = (text) => (text.startsWith(REQUEST_PREFIX) || text.startsWith(DOCUMENTS_PREFIX) ? requests : sentences).add(text);
  for (let i = 0; i < list.length; i++) {
    const token = list[i];
    if (is(token, "str", "message") && token.depth === 0 && is(list[i + 1], "punct", ",")) {
      const next = list[i + 2];
      if (is(next, "str")) {
        if (is(list[i + 3], "punct", "||")) prefixes.add(next.value);
        else keep(next.value);
      } else if (is(next, "word", "case")) {
        let level = 0;
        for (let j = i + 2; j < list.length; j++) {
          if (is(list[j], "word", "case")) level++;
          if (is(list[j], "word", "end") && --level === 0) break;
          if (is(list[j], "word", "then") && is(list[j + 1], "str") && !is(list[j + 2], "punct", "||")) keep(list[j + 1].value);
        }
      }
    }
    if (is(token, "word", "values") && is(list[i + 1], "punct", "(")) {
      let columns = null;
      // insert into <table>(cols) values(…)
      const close = list[i - 1];
      if (is(close, "punct", ")")) {
        let j = i - 2;
        while (j >= 0 && !is(list[j], "punct", "(")) j--;
        if (is(list[j - 1], "word") && list[j - 1].value.endsWith("client_events")) columns = columnsAt(list, j);
      }
      const { tuples, end } = tuplesAt(list, i + 1);
      // (values …) as v(cols)
      if (!columns && is(list[end], "punct", ")") && is(list[end + 1], "word", "as") && is(list[end + 2], "word"))
        columns = columnsAt(list, end + 3);
      const at = columns ? columns.indexOf("message") : -1;
      if (at < 0) continue;
      for (const tuple of tuples) {
        const text = tuple[at] ? literalOf(tuple[at]) : null;
        if (text !== null) keep(text);
      }
    }
  }
  return { sentences: [...sentences], prefixes: [...prefixes], requests: [...requests] };
}

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

// Every history sentence the migrations write, the live handlers' and the
// seeded rows' alike.
export function migrationSentences() {
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort();
  const sql = files.map((name) => readFileSync(new URL(name, MIGRATIONS), "utf8")).join("\n");
  return historySentences(sql);
}
