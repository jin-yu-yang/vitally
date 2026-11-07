// The client's language (spec 2026-10-05 §2): en, zh-Hans or zh-Hant, kept per
// browser. Staff screens are always English. Catalogue and card text reaches
// the screen only through sourceText, so no module indexes the catalogue with
// a screen language.
import { toHant } from "./hant.mjs";
import { isStaffWindow } from "./contracts.mjs";

export const LANGS = Object.freeze(["en", "zh-Hans", "zh-Hant"]);
export const STORAGE_KEY = "vitally.lang";
const LOCALES = Object.freeze({ en: "en-US", "zh-Hans": "zh-CN", "zh-Hant": "zh-TW" });

export const localeOf = (lang) => LOCALES[lang] ?? LOCALES.en;
export const isLang = (value) => LANGS.includes(value);

export function defaultLanguage(languages) {
  const first = String((Array.isArray(languages) ? languages : [])[0] ?? "").toLowerCase();
  if (!first.startsWith("zh")) return "en";
  if (/^zh-(tw|hk|mo)\b/.test(first) || first.startsWith("zh-hant")) return "zh-Hant";
  return "zh-Hans";
}

export function readLanguage({ storage, languages }) {
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    // Blocked storage: fall through to the browser's languages.
  }
  return defaultLanguage(languages);
}

export function writeLanguage(lang, { storage }) {
  if (!isLang(lang)) throw new Error(`Unknown language: ${lang}`);
  try {
    storage?.setItem(STORAGE_KEY, lang);
  } catch {
    // Blocked storage: the choice lasts for this page only.
  }
}

// Staff screens and a presenter's plain screen are English whatever this
// browser chose.
export const viewLang = (state) =>
  isStaffWindow(state?.principal) || state?.principal?.access === "presenter"
    ? "en"
    : isLang(state?.lang) ? state.lang : "en";

// null params mean none. One pass, so a value that holds braces is never re-read.
export const fill = (template, params) => {
  const given = params ?? {};
  return String(template).replace(/\{(\w+)\}/g, (whole, name) =>
    Object.hasOwn(given, name) ? String(given[name]) : whole,
  );
};

// A plain string is returned as is; { one, other } is chosen by params.n.
export const plural = (en, params) =>
  typeof en === "string" ? en : Number(params?.n) === 1 ? en.one : en.other;

// One catalogue- or card-style value in the screen language. zh may be a
// template ({ template, params }): the template is converted, then filled, so
// the client's own words are never converted. A plain-string en is finished
// English (cards put client text in it) and is returned verbatim; only a
// plural en is chosen and filled. An unknown language is English.
export function sourceText(pair, lang = "en") {
  if (!pair) return "";
  const screen = isLang(lang) ? lang : "en";
  const zh = pair.zh !== null && typeof pair.zh === "object" ? pair.zh : null;
  const params = pair.params ?? zh?.params ?? {};
  const english = () => {
    const en = pair.en ?? "";
    return typeof en === "string" ? en : fill(plural(en, params), params);
  };
  if (pair.literal) return screen === "en" ? String(pair.en ?? "") : String(pair.zh ?? pair.en ?? "");
  const convert = (s) => (screen === "zh-Hant" ? toHant(s) : s);
  if (screen === "en") return english();
  if (zh) return typeof zh.template === "string" && zh.template !== "" ? fill(convert(zh.template), params) : english();
  if (typeof pair.zh !== "string" || pair.zh === "") return english();
  return convert(pair.zh);
}

// The newest language wish wins (app.mjs). Each press of the switch, each
// storage event and startup takes a turn; 繁體's map may take a while to
// load, and a wish whose load lands after a newer one is dropped, so a slow
// load never undoes (or saves over) a later choice. `want` answers
// "applied", "stale" (a newer wish came first) or "failed" (the map could
// not load and this is still the newest wish). With `timeoutMs`, a load
// that has not landed by then counts as failed, and the turn is made stale:
// the map may still arrive and register, but this turn never applies.
export function createLanguageRequests({ hantReady, loadHant }) {
  let latest = 0;
  async function want(lang, apply, { timeoutMs } = {}) {
    const turn = ++latest;
    if (lang === "zh-Hant" && !hantReady()) {
      try {
        if ((await within(loadHant(), timeoutMs)) === LATE) {
          if (turn !== latest) return "stale";
          latest += 1; // this turn is over: nothing it started may apply
          return "failed";
        }
      } catch {
        return turn === latest ? "failed" : "stale";
      }
      if (turn !== latest) return "stale";
    }
    apply(lang);
    return "applied";
  }
  return { want };
}

// The 繁體 draft 13614-C needs the map whatever the screen language (app.mjs
// viewDraft), and waits for it no longer than startup does: a load that has
// not landed by `timeoutMs` rejects, as a failed load does, so the draft
// fails rather than staying on "Preparing your draft…". The map may still
// arrive later and register.
export async function loadHantWithin({ hantReady, loadHant }, timeoutMs) {
  if (hantReady()) return;
  if ((await within(loadHant(), timeoutMs)) === LATE)
    throw new Error("The Traditional map did not load in time.");
}

// `promise`'s value, or LATE once `timeoutMs` has passed without it (no
// limit when timeoutMs is not positive). A rejection before then rejects.
const LATE = Symbol("late");
async function within(promise, timeoutMs) {
  if (!(timeoutMs > 0)) return await promise;
  let timer = null;
  try {
    return await Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve(LATE), timeoutMs); })]);
  } finally {
    clearTimeout(timer);
  }
}
