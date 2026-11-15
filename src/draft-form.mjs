// The draft Form 13614-C, part one: which box of the paper form each answer
// fills (spec 2026-10-04 §7.2). Pure: answers in, field names and texts out.
// The PDF itself is built by `draft-pdf.mjs` in the browser; nothing here
// reads a file or touches pdf-lib.
//
// The three forms are Rev. 10-2025 (English, Simplified and Traditional
// Chinese). Their field names match except four marital-status boxes and the
// nesting of "income from renting out your house", so each form gets its own
// names for those. Every name below is written without the `form1[0].` prefix
// that `draftFields` adds.
import { CATALOGUE, findQuestion, isAnswered, memberNameParts, spouseShown, visibleAnswers, wording } from "./intake-catalogue.mjs";
import { formatAnswer, formatDate } from "./intake-form.mjs";
import { sourceText } from "./language.mjs";
import { t } from "./client-text.mjs";
import { SHADED_FIELDS, shadedName, shadedPrint, visibleShaded } from "./shaded-fields.mjs";

export const FORM_FILES = Object.freeze({
  en: "src/forms/f13614c-2025.pdf",
  "zh-s": "src/forms/f13614cn-2025.pdf",
  "zh-t": "src/forms/f13614ct-2025.pdf",
});

// Pinned, so a silent swap of a form cannot break the field map (checked by
// tests/draft-pdf.test.mjs against the committed files).
export const FORM_SHA256 = Object.freeze({
  en: "160507ac6daa8cc5e3126ad51ba5c2050c786337048f434f8336b48d92992c9d",
  "zh-s": "a8c4909bf41a947cd7bcffdca4c106b8e5640fc4f24cc9bb4f29f018f121f5c2",
  "zh-t": "f3eef75ca2683ab106281198b33c7ea0485f06dcadd9f16decfe4d790ac33487",
});

const PREFIX = "form1[0].";
const P1 = "page1[0].";
const MARITAL = `${P1}maritalStatus[0].`;
const MONEY = "page2[0].receivedMoneyFrom[0].";
const COLUMN1 = `${P1}youSpouseWereIn[0].column1[0].`;
const COLUMN2 = `${P1}youSpouseWereIn[0].column2[0].`;
const OPTIONAL = "page4[0].optionalQuestions[0].";
export const COMMENTS_FIELD = `${PREFIX}page5[0].AdditionalComments[0].AdditionalNotesComments[0]`;

// The names that differ between the English and the Chinese forms. The two
// Chinese marital boxes sit exactly where the English ones do (same widget
// rectangles; tests/draft-pdf.test.mjs), so they are the same questions.
const FORM_NAMES = {
  en: {
    married_last_day: [`${MARITAL}lastDay[0].lastDayYes[0]`, `${MARITAL}lastDay[0].lastDayNo[0]`],
    lived_apart_last_6mo: [`${MARITAL}liveApart[0].liveApartYes[0]`, `${MARITAL}liveApart[0].liveApartNo[0]`],
    inc_rental_home: `${MONEY}incomeRentingHouse[0]`,
  },
  zh: {
    married_last_day: [`${MARITAL}marriedForAll[0].forAllYes[0]`, `${MARITAL}marriedForAll[0].forAllNo[0]`],
    lived_apart_last_6mo: [`${MARITAL}liveWithSpouse[0].liveWithYes[0]`, `${MARITAL}liveWithSpouse[0].liveWithNo[0]`],
    inc_rental_home: `${MONEY}incomeRentingHouse[0].incomeRentingHouse[0]`,
  },
};

// Text boxes: answer id → [box, how the value is written].
const TEXT = {
  tp_first_name: [`${P1}yourFirstName[0]`, "text"],
  tp_middle_name: [`${P1}yourMiddleInitial[0]`, "initial"],
  tp_last_name: [`${P1}yourLastName[0]`, "text"],
  tp_dob: [`${P1}yourDateOfBirth[0]`, "date"],
  tp_job_title: [`${P1}yourJobTitle[0]`, "text"],
  sp_first_name: [`${P1}spousesFirstName[0]`, "text"],
  sp_middle_name: [`${P1}spousesMiddleInitial[0]`, "initial"],
  sp_last_name: [`${P1}spousesLastName[0]`, "text"],
  sp_dob: [`${P1}spousesDateOfBirth[0]`, "date"],
  sp_job_title: [`${P1}spousesJobTitle[0]`, "text"],
  addr_street: [`${P1}mailingAddress[0]`, "text"],
  addr_apt: [`${P1}maillingApartmentNumber[0]`, "text"],
  addr_city: [`${P1}mailingCity[0]`, "text"],
  addr_state: [`${P1}mailingState[0]`, "text"],
  addr_zip: [`${P1}mailingZIPCode[0]`, "text"],
  tp_phone: [`${P1}yourTelephoneNumber[0]`, "phone"],
  sp_phone: [`${P1}spousesTelephoneNumber[0]`, "phone"],
  email: [`${P1}yourEmailAddress[0]`, "text"],
  refund_method_other: [`${P1}dueARefund[0].refundOtherExplain[0]`, "text"],
  irs_language: [`${P1}writtenCommunicationLanguage[0].whatLanguage[0]`, "text"],
  divorce_date: [`${MARITAL}statusDivorced[0].dateFinalDecree[0]`, "date"],
  separation_date: [`${MARITAL}statusLegallySeparated[0].dateSeparateDecree[0]`, "date"],
  spouse_death_year: [`${MARITAL}statusWidowed[0].yearSpousesDeath[0]`, "text"],
  inc_wages_job_count: [`${MONEY}howManyJobs[0]`, "text"],
};

// Form 15080 (page 6): filled only when gcf_consent = yes.
const CONSENT_TEXT = {
  gcf_tp_signature: ["page6[0].primaryTaxpayer[0]", "text"],
  gcf_tp_date: ["page6[0].primaryDateSigned[0]", "date"],
  gcf_sp_signature: ["page6[0].secondaryTaxpayer[0]", "text"],
  gcf_sp_date: ["page6[0].secondaryDateSigned[0]", "date"],
};

// Yes/no pairs: answer id → [yes box, no box]. "not_sure" ticks neither.
const YES_NO = {
  multi_state: [`${P1}liveWorkStates[0].liveWorkYes[0]`, `${P1}liveWorkStates[0].liveWorkNo[0]`],
  claimed_by_other: [`${P1}anyoneElseClaim[0].otherClaimYes[0]`, `${P1}anyoneElseClaim[0].otherClaimNo[0]`],
  inc_sale_assets_prior_loss: [`${MONEY}reportALoss[0].reportLossYes[0]`, `${MONEY}reportALoss[0].reportLossNo[0]`],
  inc_rental_home_under15: [`${MONEY}useAsPersonal[0].personalResidenceYes[0]`, `${MONEY}useAsPersonal[0].personalResidenceNo[0]`],
  inc_self_employed_prior_loss: [`${MONEY}lossLastReturn[0].reportLossYes[0]`, `${MONEY}lossLastReturn[0].reportLossNo[0]`],
};

// Who questions: answer id → the stem of its You / Spouse / No boxes.
const WHO = {
  us_citizen: `${COLUMN1}usCitizen[0].usCitizen`,
  on_visa: `${COLUMN1}usOnVisa[0].onVisa`,
  fulltime_student: `${COLUMN1}fullTimeStudent[0].student`,
  legally_blind: `${COLUMN2}legallyBlind[0].legallyBlind`,
  disabled: `${COLUMN2}totallyPermanentlyDisabled[0].disabled`,
  ippin: `${COLUMN2}issuedIdentityProtection[0].identityProtection`,
  digital_assets: `${COLUMN2}holdDigitalAssets[0].digitalAssets`,
  irs_language_pref: `${P1}writtenCommunicationLanguage[0].otherLanguage`,
  pecf: `${P1}presidentialElectionFund[0].presidentialElectionFund`,
};
const WHO_SUFFIX = { me: "You", spouse: "Spouse", none: "No" };

const scale = (stem) => ({
  very_well: `${stem}veryWell[0]`,
  well: `${stem}well[0]`,
  not_well: `${stem}notWell[0]`,
  not_at_all: `${stem}notAtAll[0]`,
  prefer_not_to_answer: `${stem}notAnswer[0]`,
});

// One-choice questions: answer id → { option value → box }.
const CHOICE = {
  refund_method: {
    direct_deposit: `${P1}dueARefund[0].refundDirectDeposit[0]`,
    check: `${P1}dueARefund[0].refundCheckMail[0]`,
    split: `${P1}dueARefund[0].refundSplitAccounts[0]`,
    other: `${P1}dueARefund[0].refundOther[0]`,
  },
  payment_method: {
    bank_account: `${P1}haveBlanceDue[0].blanceBankAccount[0]`,
    direct_pay: `${P1}haveBlanceDue[0].blanceDirectPay[0]`,
    installment: `${P1}haveBlanceDue[0].blanceInstallmentAgreement[0]`,
    mail: `${P1}haveBlanceDue[0].blanceMailPayment[0]`,
  },
  marital_status: {
    never_married: `${MARITAL}statusNeverMarried[0]`,
    married: `${MARITAL}statusMarried[0]`,
    divorced: `${MARITAL}statusDivorced[0].statusDivorced[0]`,
    separated: `${MARITAL}statusLegallySeparated[0].statusLegallySeparated[0]`,
    widowed: `${MARITAL}statusWidowed[0].statusWidowed[0]`,
  },
  opt_english_speak: scale(`${OPTIONAL}carryConversationEnglish[0].`),
  opt_english_read: scale(`${OPTIONAL}readNewspaperEnglish[0].`),
  opt_household_disability: {
    yes: `${OPTIONAL}memberHouseholdDisability[0].disabilityYes[0]`,
    no: `${OPTIONAL}memberHouseholdDisability[0].disabilityNo[0]`,
    prefer_not_to_answer: `${OPTIONAL}memberHouseholdDisability[0].notAnswer[0]`,
  },
  opt_veteran: {
    yes: `${OPTIONAL}youSpouseVeteran[0].veteranYes[0]`,
    no: `${OPTIONAL}youSpouseVeteran[0].veteranNo[0]`,
    prefer_not_to_answer: `${OPTIONAL}youSpouseVeteran[0].notAnswer[0]`,
  },
};

// "Check if yes" boxes: the 2025 forms have no Unsure box, so not_sure ticks
// nothing and goes to the "Not sure" line instead. inc_rental_home is per form.
const EXPENSES = "page3[0].paidFollowingExpenses[0].";
const PAID = "page3[0].paidExpenses[0].";
const EVENTS = "page3[0].followingHappenDuring[0].";
const YES_BOX = {
  inc_wages: `${MONEY}wagesPartFull[0]`,
  inc_tips: `${MONEY}receivedMoneyTimps[0]`,
  inc_retirement: `${MONEY}retirementAccount[0]`,
  inc_disability: `${MONEY}disabilityBenefits[0].disabilityBenefits[0]`,
  inc_social_security: `${MONEY}socialSecurityRailroad[0]`,
  inc_unemployment: `${MONEY}unemploymentBenefits[0]`,
  inc_state_refund: `${MONEY}refundStateLocal[0]`,
  inc_interest_div: `${MONEY}interestOrDividends[0]`,
  inc_sale_assets: `${MONEY}saleStocksBonds[0]`,
  inc_alimony: `${MONEY}receivedAlimony[0]`,
  inc_rental_property: `${MONEY}incomeRentingVehicle[0]`,
  inc_gambling: `${MONEY}gamblingLotteryWinnings[0]`,
  inc_self_employed: `${MONEY}paymentsContractSelf[0]`,
  inc_other: `${MONEY}otherMoneyReceived[0].otherMoneyReceived[0]`,
  exp_mortgage_interest: `${EXPENSES}mortgageinterest[0]`,
  exp_taxes: `${EXPENSES}taxesStateLocal[0]`,
  exp_medical: `${EXPENSES}mendicalDentalPrescription[0]`,
  exp_charity: `${EXPENSES}charitableContributions[0]`,
  exp_student_loan: `${PAID}studentLoanInterest[0]`,
  exp_dependent_care: `${PAID}childDependentCare[0]`,
  exp_retirement_contrib: `${PAID}contributionsRetirementAccount[0]`,
  exp_educator: `${PAID}schooldSupplies[0]`,
  exp_alimony_paid: `${PAID}alimonyPayments[0]`,
  evt_education: `${EVENTS}tookEducationalClasses[0].tookEducationalClasses[0]`,
  evt_sold_home: `${EVENTS}sellAHome[0]`,
  evt_hsa: `${EVENTS}healthSavingsAccount[0]`,
  evt_marketplace: `${EVENTS}purchaseMarketplaceInsurance[0]`,
  evt_energy: `${EVENTS}energyEfficientItems[0].energyEfficientItems[0]`,
  evt_other: `${EVENTS}otherPurchase[0]`,
  evt_debt_canceled: `${EVENTS}forgaveByLender[0].forgaveByLender[0]`,
  evt_disaster: `${EVENTS}lossRelatedDisaster[0]`,
  evt_credit_disallowed: `${EVENTS}taxCreditDisallowed[0].taxCreditDisallowed[0]`,
  evt_irs_letter: `${EVENTS}receivedLetterBill[0]`,
  evt_estimated_payments: `${EVENTS}estimatedTaxPayments[0].estimatedTaxPayments[0]`,
  evt_brought_prior_return: `${EVENTS}lastYearsReturn[0]`,
};

// Race and ethnicity: several boxes may tick. prefer_not_to_answer has none.
const RACE_BOXES = {
  american_indian_alaska_native: "americanIndian[0]",
  asian: "asian[0]",
  black_african_american: "blackAfricanAmerican[0]",
  hispanic_latino: "hispanicLatino[0]",
  middle_eastern_north_african: "middleEsternNorthAfrican[0]",
  native_hawaiian_pacific_islander: "hawaiianPacific[0]",
  white: "white[0]",
};
const MULTI = {
  opt_race_tp: "page4[0].yourRaceEthnicity[0].",
  opt_race_sp: "page4[0].yourSpousesRaceEthnicity[0].",
};

// The household table: four rows of ten client columns. The last five columns
// of each row are for the certified volunteer and stay blank.
const ROWS = 4;
const ROW_COLUMNS = [
  "nameFirstLast", "dateOfBirth", "relationshipToYou", "monthsLivedHome", "singleMarried",
  "usCitizen", "residentUSCandaMexico", "fullTimeStudent", "totallyPermanentlyDisabled", "issuedIPPIN",
];
const rowBox = (k, column) => `${P1}namesOf[0].Row${k}[0].${column}[0]`;
// [answer id, table column, the overflow line's word for it (a text key)]
const MEMBER_YES_NO = [
  ["us_citizen", "usCitizen", "draft.citizen"],
  ["resident_na", "residentUSCandaMexico", "draft.resident"],
  ["fulltime_student", "fullTimeStudent", "draft.student"],
  ["disabled", "totallyPermanentlyDisabled", "draft.disabled"],
  ["ippin", "issuedIPPIN", "draft.ippin"],
];

// The language of each form's generated lines (spec 2026-10-05 §3.5).
const FORM_LANG = Object.freeze({ en: "en", "zh-s": "zh-Hans", "zh-t": "zh-Hant" });

const familyOf = (form) => {
  if (!Object.hasOwn(FORM_FILES, form)) throw new Error(`Unknown draft form: ${form}`);
  return form === "en" ? FORM_NAMES.en : FORM_NAMES.zh;
};

/** Every field name (with its prefix) that `draftFields` can produce for this form. */
export function draftFieldNames(form) {
  const names = familyOf(form);
  const all = [
    ...Object.values(TEXT).map(([box]) => box),
    ...Object.values(CONSENT_TEXT).map(([box]) => box),
    ...Object.values(YES_NO).flat(),
    names.married_last_day, names.lived_apart_last_6mo, names.inc_rental_home,
    ...Object.values(WHO).flatMap((stem) => Object.values(WHO_SUFFIX).map((suffix) => `${stem}${suffix}[0]`)),
    ...Object.values(CHOICE).flatMap((options) => Object.values(options)),
    ...Object.values(YES_BOX),
    ...Object.values(MULTI).flatMap((stem) => Object.values(RACE_BOXES).map((box) => `${stem}${box}`)),
    ...Array.from({ length: ROWS }, (_, i) => ROW_COLUMNS.map((column) => rowBox(i + 1, column))).flat(),
    "page5[0].AdditionalComments[0].AdditionalNotesComments[0]",
  ].flat();
  return [...new Set(all)].map((name) => PREFIX + name);
}

// ---------------------------------------------------------------------------
// Writing values
// ---------------------------------------------------------------------------

/** One line, no control characters, single spaces. */
export const oneLine = (value) => String(value ?? "").replace(/[\s\p{Cc}]+/gu, " ").trim();

// Split, never new Date(…), which shifts a date by the time zone.
export function usDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  return m ? `${m[2]}/${m[3]}/${m[1]}` : oneLine(value);
}

const initial = (value) => {
  const first = [...oneLine(value)][0] ?? "";
  return first.toLocaleUpperCase("en-US");
};

const PHONE = findQuestion(2, "tp_phone");
export const phone = (value) => oneLine(formatAnswer(PHONE, String(value ?? "")) ?? value);

const write = (value, how) =>
  how === "date" ? usDate(value) : how === "initial" ? initial(value) : how === "phone" ? phone(value) : oneLine(value);

/** "YYYY-MM-DD" for a Date in its own time zone, or the string given. */
export function isoDay(today) {
  if (typeof today === "string") return today;
  const day = today instanceof Date ? today : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** The DRAFT line the builder stamps on each page: shared with the draft Form 14446. */
export function draftStamp(reference, today, { preparerEntries = false } = {}) {
  const lead = preparerEntries ? "DRAFT – online answers and preparer entries" : "DRAFT – prepared from online answers";
  return [lead, usDate(isoDay(today)), oneLine(reference)].filter(Boolean).join(", ");
}

// ---------------------------------------------------------------------------
// Additional Comments
// ---------------------------------------------------------------------------

const HH = findQuestion(2, "hh");
const hhField = (id) => (HH?.fields ?? []).find((field) => field.id === id);
// An option's general label in `lang` (the table rows use English).
const labelIn = (question, value, lang) => {
  const label = (question?.options ?? []).find((option) => option.value === value)?.label?.general;
  return label ? sourceText({ en: label.en, zh: label.zh }, lang) : String(value);
};
const generalWording = (question, lang, answers) => wording(question, { variant: "general", lang, answers });
const YES_NO_WORD = { yes: "draft.yes", no: "draft.no", not_sure: "draft.not_sure_word" };
// The English lines keep the form's own MM/DD/YYYY; Chinese lines read 1961年4月12日.
const lineDate = (value, lang) => (lang === "en" ? usDate(value) : oneLine(formatDate(String(value), lang)));

/**
 * "Person 5: name · relationship · born · months · single or married · citizen: yes · …",
 * in the form's language. Every piece is in `lang` before it is joined; the
 * name is as typed.
 */
function memberLine(member, n, lang) {
  const name = memberNameParts(member).map(oneLine).join(" ");
  const parts = [name];
  if (isAnswered(member.relationship)) parts.push(labelIn(hhField("relationship"), member.relationship, lang));
  if (isAnswered(member.dob)) parts.push(t("member.born", { date: lineDate(member.dob, lang) }, lang));
  // n only picks "month" or "months": exactly "1" is one.
  if (isAnswered(member.months_lived))
    parts.push(t("member.months", { n: member.months_lived === "1" ? 1 : 2, count: oneLine(member.months_lived) }, lang));
  if (isAnswered(member.married)) parts.push(t(member.married === "married" ? "draft.married" : "draft.single", {}, lang));
  for (const [id, , word] of MEMBER_YES_NO)
    if (isAnswered(member[id])) {
      const answer = Object.hasOwn(YES_NO_WORD, member[id]) ? t(YES_NO_WORD[member[id]], {}, lang) : oneLine(member[id]);
      parts.push(t("draft.member_answer", { field: t(word, {}, lang), answer }, lang));
    }
  return t("draft.member_line", { person: t("member.person", { n }, lang), parts: parts.filter(isAnswered).join(" · ") }, lang);
}

const ALL_QUESTIONS = CATALOGUE.steps.flatMap((step) => step.sections.flatMap((section) => section.questions));

/** The wording of every visible not_sure answer, in catalogue order, in `lang`. */
function notSureLabels(answers, lang) {
  const labels = [];
  for (const question of ALL_QUESTIONS) {
    if (!Object.hasOwn(answers, question.id)) continue;
    const value = answers[question.id];
    if (question.type === "group") {
      (Array.isArray(value) ? value : []).forEach((member, i) => {
        for (const field of question.fields ?? [])
          if (member?.[field.id] === "not_sure")
            labels.push(t("draft.not_sure_person", { person: t("member.person", { n: i + 1 }, lang), field: generalWording(field, lang) }, lang));
      });
    } else if (value === "not_sure") labels.push(generalWording(question, lang, answers));
  }
  return labels;
}

/** Additional Comments: the client's notes as typed, then the generated lines in `lang`. */
function commentsFor(answers, members, lang) {
  const blocks = [];
  if (isAnswered(answers.additional_notes)) blocks.push(String(answers.additional_notes).replace(/\r\n?/g, "\n").trim());
  const notSure = notSureLabels(answers, lang);
  if (notSure.length) blocks.push(t("draft.not_sure", { items: notSure.join(t("form.list_separator", {}, lang)) }, lang));
  if (answers.inc_other === "yes" && isAnswered(answers.inc_other_desc))
    blocks.push(t("draft.other_income", { text: oneLine(answers.inc_other_desc) }, lang));
  if (answers.evt_other === "yes" && isAnswered(answers.evt_other_desc))
    blocks.push(t("draft.other_event", { text: oneLine(answers.evt_other_desc) }, lang));
  const overflow = members.slice(ROWS).map((member, i) => memberLine(member, ROWS + i + 1, lang));
  if (overflow.length) blocks.push(overflow.join("\n"));
  return blocks.join("\n\n");
}

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

/**
 * The boxes of one form for these answers.
 * `form` is "en", "zh-s" or "zh-t"; `reference` the Application ID; `today`
 * a "YYYY-MM-DD" string or a Date (the stamp's date). The generated lines of
 * Additional Comments, the table's relationship box and the PDF's own lines
 * (`words`) are in the form's language (English, Simplified, or Traditional
 * through the map); the stamp and the file name stay English.
 * `shaded` is the case's saved shaded section (stored values, see
 * shaded-fields.mjs) or null. Its notes are not in `text`: they come back as
 * `notes: [{ name, text, block, page }]` (`block` is the note's heading without
 * "notes", e.g. "Income") for the builder to wrap and continue; `preparerEntries`
 * is true when any shaded value is set, and words the stamp.
 * Returns `{ text, checks, comments, consentPage, words, notes, preparerEntries }`, plus the `stamp`
 * and the `fileName` the builder and the page use. `words.continuedOn` keeps
 * its `{page}` for the builder, which knows the page.
 */
export function draftFields(answers, { form = "en", reference = "", today, shaded = null, version = 2 } = {}) {
  const names = familyOf(form);
  const visible = visibleAnswers(version, answers ?? {});
  const text = {};
  const checks = [];
  const put = (box, value) => {
    if (value !== "") text[PREFIX + box] = value;
  };
  const tick = (box) => {
    if (box && !checks.includes(PREFIX + box)) checks.push(PREFIX + box);
  };
  const answered = (id) => Object.hasOwn(visible, id) && isAnswered(visible[id]);

  // The spouse's name and birth date are the joint filer's lines: printed only
  // while a joint return is possible (J), never for a 2023 or 2024 death
  // (change add-widowed-spouse-rules, brainstorm Q6). The job title follows J
  // by its own show-if.
  const SPOUSE_LINES = new Set(["sp_first_name", "sp_middle_name", "sp_last_name", "sp_dob"]);
  const joint = spouseShown(visible);
  for (const [id, [box, how]] of Object.entries(TEXT))
    if (answered(id) && (joint || !SPOUSE_LINES.has(id))) put(box, write(visible[id], how));

  const consentPage = visible.gcf_consent === "yes";
  if (consentPage)
    for (const [id, [box, how]] of Object.entries(CONSENT_TEXT)) if (answered(id)) put(box, write(visible[id], how));

  const yesNo = {
    ...YES_NO,
    married_last_day: names.married_last_day,
    lived_apart_last_6mo: names.lived_apart_last_6mo,
  };
  for (const [id, [yes, no]] of Object.entries(yesNo)) {
    if (!answered(id)) continue;
    if (visible[id] === "yes") tick(yes);
    if (visible[id] === "no") tick(no);
  }

  // The Spouse box only counts while there is a spouse: a choice left over
  // from before a change of marital status ticks nothing (spouseShowIf).
  const hasSpouse = joint;
  for (const [id, stem] of Object.entries(WHO)) {
    if (!answered(id) || !Array.isArray(visible[id])) continue;
    for (const choice of ["me", "spouse", "none"])
      if (visible[id].includes(choice) && (choice !== "spouse" || hasSpouse)) tick(`${stem}${WHO_SUFFIX[choice]}[0]`);
  }

  for (const [id, options] of Object.entries(CHOICE)) if (answered(id)) tick(options[visible[id]]);

  const yesBoxes = { ...YES_BOX, inc_rental_home: names.inc_rental_home };
  for (const [id, box] of Object.entries(yesBoxes)) if (visible[id] === "yes") tick(box);

  for (const [id, stem] of Object.entries(MULTI)) {
    if (!answered(id) || !Array.isArray(visible[id])) continue;
    for (const [value, box] of Object.entries(RACE_BOXES)) if (visible[id].includes(value)) tick(`${stem}${box}`);
  }

  const members = Array.isArray(visible.hh) ? visible.hh.filter((m) => m && typeof m === "object") : [];
  members.slice(0, ROWS).forEach((member, i) => {
    const k = i + 1;
    put(rowBox(k, "nameFirstLast"), memberNameParts(member).map(oneLine).join(" "));
    if (isAnswered(member.dob)) put(rowBox(k, "dateOfBirth"), usDate(member.dob));
    if (isAnswered(member.relationship)) put(rowBox(k, "relationshipToYou"), labelIn(hhField("relationship"), member.relationship, FORM_LANG[form]));
    if (isAnswered(member.months_lived)) put(rowBox(k, "monthsLivedHome"), oneLine(member.months_lived));
    if (member.married === "single" || member.married === "married")
      put(rowBox(k, "singleMarried"), member.married === "married" ? "M" : "S");
    for (const [id, column] of MEMBER_YES_NO) {
      if (member[id] === "yes") put(rowBox(k, column), "Y");
      if (member[id] === "no") put(rowBox(k, column), "N");
    }
  });

  const notes = [];
  const values = visibleShaded(shaded && typeof shaded === "object" ? shaded : {}, answers ?? {}, { version });
  let preparerEntries = false;
  for (const field of SHADED_FIELDS) {
    if (!Object.hasOwn(values, field.key)) continue;
    const value = values[field.key];
    if (value === undefined || value === null || value === false || value === "") continue;
    preparerEntries = true;
    const name = shadedName(field.key, form);
    if (field.kind === "note") {
      const page = Number(/\.page(\d+)\[0\]\./.exec(name)?.[1] ?? 1);
      notes.push({ name, text: String(value), block: field.label.replace(/ notes$/, ""), page });
    } else if (field.kind === "box") tick(name.slice(PREFIX.length));
    else put(name.slice(PREFIX.length), shadedPrint(field.key, value));
  }

  const comments = commentsFor(visible, members, FORM_LANG[form]);
  const stamp = draftStamp(reference, today, { preparerEntries });
  const suffix = form === "en" ? "" : `-${form}`;
  const fileName = `13614-C-draft${reference ? `-${oneLine(reference)}` : ""}${suffix}.pdf`;
  const lang = FORM_LANG[form];
  const words = {
    continuedTitle: t("draft.continued_title", {}, lang),
    continuedOn: t("draft.continued_on", { page: "{page}" }, lang),
    notice: t("draft.notice", {}, lang),
  };
  return { text, checks, comments, consentPage, words, notes, preparerEntries, stamp, fileName };
}
