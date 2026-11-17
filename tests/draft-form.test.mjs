import test from "node:test";
import assert from "node:assert/strict";
import {
  FORM_FILES, FORM_SHA256, draftFields, draftFieldNames, draftStamp,
} from "../src/draft-form.mjs";
import { shadedName } from "../src/shaded-fields.mjs";
import { findQuestion, wording } from "../src/intake-catalogue.mjs";
import { setHantMap } from "../src/hant.mjs";
import * as OpenCC from "opencc-js";
import HANT_MAP from "../src/zh-hant.mjs";

// Every name below is written without the "form1[0]." prefix the module adds.
const F = (name) => `form1[0].${name}`;
const ids = (n) => String(n).padStart(32, "0");

// A fictional married client. Every value is made up.
const MARRIED = Object.freeze({
  form_version: "general",
  service: "drop_off",
  language: "mandarin",
  language_other: "Should not appear",
  language_also: ["cantonese"],
  language_also_other: "Also should not appear",
  best_contact_time: ["weekday_evening"],
  best_contact_note: "After six",
  tp_first_name: "Mei",
  tp_middle_name: "qing",
  tp_last_name: "Lin",
  tp_dob: "1961-04-05",
  tp_job_title: "Bookkeeper",
  tp_phone: "2155550199",
  email: "mei.lin@example.com",
  addr_street: "100 Example Street",
  addr_apt: "2B",
  addr_city: "Philadelphia",
  addr_state: "PA",
  addr_zip: "19107",
  marital_status: "married",
  married_last_day: "yes",
  lived_apart_last_6mo: "no",
  sp_first_name: "José",
  sp_middle_name: "Andrés",
  sp_last_name: "Peña",
  sp_dob: "1960-12-31",
  sp_job_title: "Cook",
  sp_phone: "(267) 555-0142",
  multi_state: "no",
  claimed_by_other: "not_sure",
  us_citizen: ["me", "spouse"],
  on_visa: ["none"],
  fulltime_student: ["spouse"],
  legally_blind: ["none"],
  disabled: ["me"],
  ippin: ["none"],
  digital_assets: ["none"],
  irs_language_pref: ["me"],
  irs_language: "Chinese",
  pecf: ["none"],
  has_household_members: "yes",
  hh: [
    { member_id: ids(1), first_name: "Ana", last_name: "Lin", dob: "2015-06-07", relationship: "son_daughter", months_lived: "12", married: "single", us_citizen: "yes", resident_na: "yes", fulltime_student: "no", disabled: "no", ippin: "not_sure" },
  ],
  inc_wages: "yes",
  inc_wages_job_count: "2",
  inc_tips: "not_sure",
  inc_retirement: "no",
  inc_disability: "no",
  inc_social_security: "yes",
  inc_unemployment: "no",
  inc_state_refund: "no",
  inc_interest_div: "yes",
  inc_sale_assets: "yes",
  inc_sale_assets_prior_loss: "no",
  inc_alimony: "no",
  inc_rental_home: "yes",
  inc_rental_home_under15: "yes",
  inc_rental_property: "no",
  inc_gambling: "no",
  inc_self_employed: "yes",
  inc_self_employed_prior_loss: "not_sure",
  inc_other: "yes",
  inc_other_desc: "Jury duty",
  exp_mortgage_interest: "yes",
  exp_taxes: "no",
  exp_medical: "no",
  exp_charity: "no",
  exp_student_loan: "no",
  exp_dependent_care: "yes",
  exp_retirement_contrib: "no",
  exp_educator: "no",
  exp_alimony_paid: "no",
  evt_education: "no",
  evt_sold_home: "no",
  evt_hsa: "not_sure",
  evt_marketplace: "no",
  evt_energy: "not_sure",
  evt_other: "yes",
  evt_other_desc: "Bought a car",
  evt_debt_canceled: "no",
  evt_disaster: "no",
  evt_credit_disallowed: "no",
  evt_irs_letter: "yes",
  evt_estimated_payments: "no",
  evt_brought_prior_return: "yes",
  refund_method: "other",
  refund_method_other: "Prepaid card",
  payment_method: "installment",
  gcf_consent: "yes",
  gcf_tp_signature: "Mei Lin",
  gcf_tp_date: "2026-02-01",
  gcf_sp_signature: "José Peña",
  gcf_sp_date: "2026-02-02",
  opt_english_speak: "not_well",
  opt_english_read: "prefer_not_to_answer",
  opt_household_disability: "no",
  opt_veteran: "prefer_not_to_answer",
  opt_race_tp: ["asian"],
  opt_race_sp: ["hispanic_latino", "white"],
  additional_notes: "My 1099-INT has not arrived yet.",
});

const OPTIONS = { form: "en", reference: "VT-ABCD-EFGH", today: "2026-10-04" };
const draft = (answers = MARRIED, options = OPTIONS) => draftFields(answers, options);

test("the three forms are named and pinned", () => {
  assert.deepEqual(FORM_FILES, {
    en: "src/forms/f13614c-2025.pdf",
    "zh-s": "src/forms/f13614cn-2025.pdf",
    "zh-t": "src/forms/f13614ct-2025.pdf",
  });
  assert.deepEqual(FORM_SHA256, {
    en: "160507ac6daa8cc5e3126ad51ba5c2050c786337048f434f8336b48d92992c9d",
    "zh-s": "a8c4909bf41a947cd7bcffdca4c106b8e5640fc4f24cc9bb4f29f018f121f5c2",
    "zh-t": "f3eef75ca2683ab106281198b33c7ea0485f06dcadd9f16decfe4d790ac33487",
  });
});

test("a married client: names, dates, phones and the address", () => {
  const { text } = draft();
  const expected = {
    "page1[0].yourFirstName[0]": "Mei",
    "page1[0].yourMiddleInitial[0]": "Q",
    "page1[0].yourLastName[0]": "Lin",
    "page1[0].yourDateOfBirth[0]": "04/05/1961",
    "page1[0].yourJobTitle[0]": "Bookkeeper",
    "page1[0].spousesFirstName[0]": "José",
    "page1[0].spousesMiddleInitial[0]": "A",
    "page1[0].spousesLastName[0]": "Peña",
    "page1[0].spousesDateOfBirth[0]": "12/31/1960",
    "page1[0].spousesJobTitle[0]": "Cook",
    "page1[0].mailingAddress[0]": "100 Example Street",
    "page1[0].maillingApartmentNumber[0]": "2B",
    "page1[0].mailingCity[0]": "Philadelphia",
    "page1[0].mailingState[0]": "PA",
    "page1[0].mailingZIPCode[0]": "19107",
    "page1[0].yourTelephoneNumber[0]": "(215) 555-0199",
    "page1[0].spousesTelephoneNumber[0]": "(267) 555-0142",
    "page1[0].yourEmailAddress[0]": "mei.lin@example.com",
    "page1[0].writtenCommunicationLanguage[0].whatLanguage[0]": "Chinese",
    "page1[0].dueARefund[0].refundOtherExplain[0]": "Prepaid card",
    "page2[0].receivedMoneyFrom[0].howManyJobs[0]": "2",
  };
  for (const [name, value] of Object.entries(expected)) assert.equal(text[F(name)], value, name);
});

test("yes/no pairs, choices and the marital boxes", () => {
  const { checks, text } = draft();
  for (const name of [
    "page1[0].liveWorkStates[0].liveWorkNo[0]",
    "page1[0].maritalStatus[0].statusMarried[0]",
    "page1[0].maritalStatus[0].lastDay[0].lastDayYes[0]",
    "page1[0].maritalStatus[0].liveApart[0].liveApartNo[0]",
    "page1[0].dueARefund[0].refundOther[0]",
    "page1[0].haveBlanceDue[0].blanceInstallmentAgreement[0]",
    "page2[0].receivedMoneyFrom[0].reportALoss[0].reportLossNo[0]",
    "page2[0].receivedMoneyFrom[0].useAsPersonal[0].personalResidenceYes[0]",
    "page4[0].optionalQuestions[0].carryConversationEnglish[0].notWell[0]",
    "page4[0].optionalQuestions[0].readNewspaperEnglish[0].notAnswer[0]",
    "page4[0].optionalQuestions[0].memberHouseholdDisability[0].disabilityNo[0]",
    "page4[0].optionalQuestions[0].youSpouseVeteran[0].notAnswer[0]",
    "page4[0].yourRaceEthnicity[0].asian[0]",
    "page4[0].yourSpousesRaceEthnicity[0].hispanicLatino[0]",
    "page4[0].yourSpousesRaceEthnicity[0].white[0]",
  ])
    assert.ok(checks.includes(F(name)), name);
  // claimed_by_other is not_sure: neither box.
  assert.ok(!checks.some((n) => n.includes("anyoneElseClaim")));
  // inc_self_employed_prior_loss is not_sure: neither box.
  assert.ok(!checks.some((n) => n.includes("lossLastReturn")));
  assert.ok(!checks.some((n) => n.includes("liveWorkYes")));
  assert.equal(new Set(checks).size, checks.length, "no box twice");
  // Every produced name is one the map knows.
  const known = new Set(draftFieldNames("en"));
  for (const name of [...checks, ...Object.keys(text)]) assert.ok(known.has(name), name);
});

test("the not-sure lines quote the wording the client saw", () => {
  const { comments: married } = draft(MARRIED);
  assert.ok(married.includes("claim you or your spouse as a dependent on their tax return?"));
  const { comments: single } = draft({ ...MARRIED, marital_status: "never_married" });
  assert.ok(single.includes("Not sure: Can anyone else (such as a parent or adult child) claim you as a dependent on their tax return?"));
  assert.doesNotMatch(single, /claim you or your spouse/);
});

test("Who answers tick the You, Spouse and No boxes", () => {
  const { checks } = draft();
  const c1 = "page1[0].youSpouseWereIn[0].column1[0].";
  const c2 = "page1[0].youSpouseWereIn[0].column2[0].";
  const ticked = (prefix) => checks.filter((n) => n.startsWith(F(prefix))).map((n) => n.slice(F(prefix).length));
  assert.deepEqual(ticked(`${c1}usCitizen[0].`), ["usCitizenYou[0]", "usCitizenSpouse[0]"]);
  assert.deepEqual(ticked(`${c1}usOnVisa[0].`), ["onVisaNo[0]"]);
  assert.deepEqual(ticked(`${c1}fullTimeStudent[0].`), ["studentSpouse[0]"]);
  assert.deepEqual(ticked(`${c2}legallyBlind[0].`), ["legallyBlindNo[0]"]);
  assert.deepEqual(ticked(`${c2}totallyPermanentlyDisabled[0].`), ["disabledYou[0]"]);
  assert.deepEqual(ticked(`${c2}issuedIdentityProtection[0].`), ["identityProtectionNo[0]"]);
  assert.deepEqual(ticked(`${c2}holdDigitalAssets[0].`), ["digitalAssetsNo[0]"]);
  assert.deepEqual(ticked("page1[0].writtenCommunicationLanguage[0]."), ["otherLanguageYou[0]"]);
  assert.deepEqual(ticked("page1[0].presidentialElectionFund[0]."), ["presidentialElectionFundNo[0]"]);
  // A spouse choice left over from before a change of marital status ticks nothing.
  const single = draft({ ...MARRIED, marital_status: "never_married", us_citizen: ["spouse"] });
  assert.deepEqual(single.checks.filter((n) => n.includes("usCitizen[0].")), []);
});

test("income, expense and event items tick only on yes; not_sure goes to Not sure", () => {
  const { checks, comments } = draft();
  for (const name of [
    "page2[0].receivedMoneyFrom[0].wagesPartFull[0]",
    "page2[0].receivedMoneyFrom[0].socialSecurityRailroad[0]",
    "page2[0].receivedMoneyFrom[0].interestOrDividends[0]",
    "page2[0].receivedMoneyFrom[0].saleStocksBonds[0]",
    "page2[0].receivedMoneyFrom[0].incomeRentingHouse[0]",
    "page2[0].receivedMoneyFrom[0].paymentsContractSelf[0]",
    "page2[0].receivedMoneyFrom[0].otherMoneyReceived[0].otherMoneyReceived[0]",
    "page3[0].paidFollowingExpenses[0].mortgageinterest[0]",
    "page3[0].paidExpenses[0].childDependentCare[0]",
    "page3[0].followingHappenDuring[0].otherPurchase[0]",
    "page3[0].followingHappenDuring[0].receivedLetterBill[0]",
    "page3[0].followingHappenDuring[0].lastYearsReturn[0]",
  ])
    assert.ok(checks.includes(F(name)), name);
  for (const name of ["receivedMoneyTimps", "healthSavingsAccount", "energyEfficientItems", "retirementAccount", "taxesStateLocal"])
    assert.ok(!checks.some((n) => n.includes(name)), name);
  // The volunteer-only columns of pages 2 and 3 stay blank.
  assert.ok(!checks.some((n) => /incomeIncluded|stndardItemized|expensesToReport|informationToReport/.test(n)));
  assert.equal(
    comments,
    [
      "My 1099-INT has not arrived yet.",
      "Not sure: Can anyone else (such as a parent or adult child) claim you or your spouse as a dependent on their tax return?, " +
        "Person 1 Issued an IP PIN?, Tips, Did you report a loss from this work on last year's return?, Had a Health Savings Account (HSA), " +
        "Purchased and installed energy-efficient home improvements (windows, furnace, insulation, etc.)",
      "Other income: Jury duty",
      "Other event: Bought a car",
    ].join("\n\n"),
  );
});

// Six fictional household members: rows 1–4 fit the form, 5–6 overflow.
const SIX = [
  ["Ana", "Lin", "2015-06-07", "son_daughter", "12", "single", "yes", "yes", "no", "no", "no"],
  ["Bo", "Lin", "2012-01-02", "stepchild", "6", "single", "no", "yes", "yes", "no", "yes"],
  ["Cai", "Lin", "1940-03-04", "parent", "12", "married", "yes", "no", "no", "yes", "not_sure"],
  ["Dan", "Lin", "2001-07-08", "sibling", "9", "single", "not_sure", "yes", "yes", "no", "no"],
  ["Eva", "Lin", "2019-09-10", "grandchild", "12", "single", "yes", "yes", "no", "no", "no"],
  ["Fei", "Lin", "1999-11-12", "none", "3", "married", "no", "not_sure", "no", "no", "yes"],
].map(([first, last, dob, rel, months, married, citizen, resident, student, disabled, ippin], i) => ({
  member_id: ids(i + 1), first_name: first, last_name: last, dob, relationship: rel, months_lived: months, married,
  us_citizen: citizen, resident_na: resident, fulltime_student: student, disabled, ippin,
}));

test("household rows 1–4 on the form, members 5–6 in Additional Comments", () => {
  const { text, comments } = draft({ ...MARRIED, hh: SIX });
  const row = (k, column) => text[F(`page1[0].namesOf[0].Row${k}[0].${column}[0]`)];
  assert.equal(row(1, "nameFirstLast"), "Ana Lin");
  assert.equal(row(1, "dateOfBirth"), "06/07/2015");
  assert.equal(row(1, "relationshipToYou"), "Son / Daughter");
  assert.equal(row(1, "monthsLivedHome"), "12");
  assert.equal(row(1, "singleMarried"), "S");
  assert.equal(row(1, "usCitizen"), "Y");
  assert.equal(row(1, "residentUSCandaMexico"), "Y");
  assert.equal(row(1, "fullTimeStudent"), "N");
  assert.equal(row(1, "totallyPermanentlyDisabled"), "N");
  assert.equal(row(1, "issuedIPPIN"), "N");
  assert.equal(row(2, "relationshipToYou"), "Stepchild");
  assert.equal(row(3, "singleMarried"), "M");
  assert.equal(row(3, "issuedIPPIN"), undefined, "not_sure stays blank");
  assert.equal(row(4, "usCitizen"), undefined, "not_sure stays blank");
  assert.equal(row(4, "nameFirstLast"), "Dan Lin");
  assert.ok(!Object.keys(text).some((n) => /Row[5-9]/.test(n)));
  // The volunteer-only columns stay blank.
  assert.ok(!Object.keys(text).some((n) => /qualifyingChildDependent|ownSupport|lessThanIncome|supportForPerson|costMaintainingHome/.test(n)));
  const blocks = comments.split("\n\n");
  assert.equal(
    blocks.at(-1),
    [
      "Person 5: Eva Lin · Grandchild · born 09/10/2019 · lived with you 12 months · single · citizen: yes · U.S./Canada/Mexico resident: yes · student: no · totally and permanently disabled: no · IP PIN: no",
      "Person 6: Fei Lin · None · born 11/12/1999 · lived with you 3 months · married · citizen: no · U.S./Canada/Mexico resident: not sure · student: no · totally and permanently disabled: no · IP PIN: yes",
    ].join("\n"),
  );
  assert.match(comments, /Person 3 Issued an IP PIN\?, Person 4 U\.S\. citizen\?, Person 6 In 2025, was this person a resident/);
});

test("a household member's middle name is on the 13614-C row and in the comment lines", () => {
  const withMiddle = SIX.map((m, i) => (i === 0 ? { ...m, middle_name: "Mei" } : i === 4 ? { ...m, middle_name: "Q" } : m));
  const { text, comments } = draft({ ...MARRIED, hh: withMiddle });
  const name = (k) => text[F(`page1[0].namesOf[0].Row${k}[0].nameFirstLast[0]`)];
  assert.equal(name(1), "Ana Mei Lin");
  assert.equal(name(2), "Bo Lin", "no middle name: unchanged");
  assert.match(comments, /Person 5: Eva Q Lin · Grandchild/);
  assert.match(comments, /Person 6: Fei Lin · /);
});

test("hidden answers are ignored", () => {
  const hidden = {
    ...MARRIED,
    marital_status: "never_married",
    inc_wages: "no",
    inc_other: "no",
    evt_other: "no",
    refund_method: "check",
    irs_language_pref: ["none"],
    has_household_members: "no",
  };
  const { text, checks, comments } = draft(hidden);
  for (const absent of ["spousesFirstName", "spousesTelephoneNumber", "howManyJobs", "refundOtherExplain", "whatLanguage", "namesOf"])
    assert.ok(!Object.keys(text).some((n) => n.includes(absent)), absent);
  for (const absent of ["lastDay", "liveApart", "yourSpousesRaceEthnicity", "wagesPartFull"])
    assert.ok(!checks.some((n) => n.includes(absent)), absent);
  assert.ok(checks.includes(F("page1[0].maritalStatus[0].statusNeverMarried[0]")));
  assert.ok(checks.includes(F("page1[0].dueARefund[0].refundCheckMail[0]")));
  assert.ok(!comments.includes("Other income"));
  assert.ok(!comments.includes("Other event"));
  assert.ok(!comments.includes("Person 1"));
});

test("the 15080 page: only with gcf_consent = yes", () => {
  const yes = draft();
  assert.equal(yes.consentPage, true);
  assert.equal(yes.text[F("page6[0].primaryTaxpayer[0]")], "Mei Lin");
  assert.equal(yes.text[F("page6[0].primaryDateSigned[0]")], "02/01/2026");
  assert.equal(yes.text[F("page6[0].secondaryTaxpayer[0]")], "José Peña");
  assert.equal(yes.text[F("page6[0].secondaryDateSigned[0]")], "02/02/2026");
  for (const consent of ["no", undefined, ""]) {
    const answers = { ...MARRIED, gcf_consent: consent };
    const result = draft(answers);
    assert.equal(result.consentPage, false, String(consent));
    assert.ok(!Object.keys(result.text).some((n) => n.includes("page6[0]")), String(consent));
  }
});

test("the Chinese forms use their own marital and rental names", () => {
  for (const form of ["zh-s", "zh-t"]) {
    const { checks } = draft(MARRIED, { ...OPTIONS, form });
    assert.ok(checks.includes(F("page1[0].maritalStatus[0].marriedForAll[0].forAllYes[0]")), form);
    assert.ok(checks.includes(F("page1[0].maritalStatus[0].liveWithSpouse[0].liveWithNo[0]")), form);
    assert.ok(checks.includes(F("page2[0].receivedMoneyFrom[0].incomeRentingHouse[0].incomeRentingHouse[0]")), form);
    assert.ok(!checks.some((n) => n.includes("lastDay") || n.includes("liveApart")), form);
    const known = new Set(draftFieldNames(form));
    for (const name of checks) assert.ok(known.has(name), `${form} ${name}`);
    assert.ok(!known.has(F("page2[0].receivedMoneyFrom[0].incomeRentingHouse[0]")), form);
  }
  const no = draft({ ...MARRIED, married_last_day: "no", lived_apart_last_6mo: "yes" }, { ...OPTIONS, form: "zh-s" });
  assert.ok(no.checks.includes(F("page1[0].maritalStatus[0].marriedForAll[0].forAllNo[0]")));
  assert.ok(no.checks.includes(F("page1[0].maritalStatus[0].liveWithSpouse[0].liveWithYes[0]")));
});

test("each marital status ticks its own box, with its date", () => {
  const cases = [
    ["never_married", {}, "statusNeverMarried[0]", null],
    ["divorced", { divorce_date: "2020-03-09" }, "statusDivorced[0].statusDivorced[0]", ["statusDivorced[0].dateFinalDecree[0]", "03/09/2020"]],
    ["separated", { separation_date: "2021-10-11" }, "statusLegallySeparated[0].statusLegallySeparated[0]", ["statusLegallySeparated[0].dateSeparateDecree[0]", "10/11/2021"]],
    ["widowed", { spouse_death_year: "2019" }, "statusWidowed[0].statusWidowed[0]", ["statusWidowed[0].yearSpousesDeath[0]", "2019"]],
  ];
  for (const [status, extra, box, date] of cases) {
    const { checks, text } = draft({ ...MARRIED, marital_status: status, ...extra });
    assert.ok(checks.includes(F(`page1[0].maritalStatus[0].${box}`)), status);
    assert.equal(checks.filter((n) => n.includes("maritalStatus")).length, 1, status);
    if (date) assert.equal(text[F(`page1[0].maritalStatus[0].${date[0]}`)], date[1], status);
  }
});

test("the questions with no box never appear", () => {
  const { text, comments } = draft();
  const values = Object.values(text).join("\n") + comments;
  for (const absent of ["Should not appear", "Also should not appear", "cantonese", "After six", "drop_off", "mandarin", "weekday_evening", "general"])
    assert.ok(!values.includes(absent), absent);
  assert.ok(!Object.values(text).includes("yes"));
});

test("an unanswered draft gives no boxes and no comments", () => {
  const empty = draft({});
  assert.deepEqual(empty.text, {});
  assert.deepEqual(empty.checks, []);
  assert.equal(empty.comments, "");
  assert.equal(empty.consentPage, false);
});

test("the stamp and the file name", () => {
  assert.equal(draft().stamp, "DRAFT – prepared from online answers, 10/04/2026, VT-ABCD-EFGH");
  assert.equal(draft().fileName, "13614-C-draft-VT-ABCD-EFGH.pdf");
  assert.equal(draft(MARRIED, { ...OPTIONS, form: "zh-s" }).fileName, "13614-C-draft-VT-ABCD-EFGH-zh-s.pdf");
  assert.equal(draft(MARRIED, { ...OPTIONS, form: "zh-t" }).fileName, "13614-C-draft-VT-ABCD-EFGH-zh-t.pdf");
  assert.throws(() => draft(MARRIED, { ...OPTIONS, form: "fr" }), /form/);
});

test("draftFieldNames covers all four household rows and the 15080 fields", () => {
  for (const form of ["en", "zh-s", "zh-t"]) {
    const names = draftFieldNames(form);
    assert.equal(new Set(names).size, names.length, form);
    for (let k = 1; k <= 4; k++)
      for (const column of ["nameFirstLast", "dateOfBirth", "relationshipToYou", "monthsLivedHome", "singleMarried", "usCitizen", "residentUSCandaMexico", "fullTimeStudent", "totallyPermanentlyDisabled", "issuedIPPIN"])
        assert.ok(names.includes(F(`page1[0].namesOf[0].Row${k}[0].${column}[0]`)), `${form} Row${k} ${column}`);
    for (const name of ["primaryTaxpayer", "primaryDateSigned", "secondaryTaxpayer", "secondaryDateSigned"])
      assert.ok(names.includes(F(`page6[0].${name}[0]`)), name);
    assert.ok(names.includes(F("page5[0].AdditionalComments[0].AdditionalNotesComments[0]")));
  }
});

// ---------------------------------------------------------------------------
// The generated lines in the form's language (spec 2026-10-05 §3.5)
// ---------------------------------------------------------------------------

const zhWording = (id) => wording(findQuestion(2, id), { lang: "zh-Hans" });
const withHant = (fn) => {
  setHantMap(HANT_MAP);
  try {
    return fn();
  } finally {
    setHantMap(null);
  }
};

test("the PDF's own lines come in the form's language, with {page} left for the builder", () => {
  assert.deepEqual(draft(MARRIED).words, {
    continuedTitle: "Additional comments (continued)",
    continuedOn: "(continued on page {page})",
    notice: "Some characters could not be printed. The online answers have them in full.",
  });
  assert.deepEqual(draft(MARRIED, { ...OPTIONS, form: "zh-s" }).words, {
    continuedTitle: "补充说明（续）",
    continuedOn: "（续见第 {page} 页）",
    notice: "部分字符无法打印。网上填写的回答中有完整内容。",
  });
  const traditional = withHant(() => draft(MARRIED, { ...OPTIONS, form: "zh-t" }).words);
  assert.equal(traditional.continuedTitle, HANT_MAP["补充说明（续）"]);
  assert.equal(traditional.continuedOn, HANT_MAP["（续见第 {page} 页）"]);
  assert.match(traditional.continuedOn, /\{page\}/);
});

test("the relationship box follows the form's language; the English form keeps English", () => {
  const row = (fields, k) => fields.text[F(`page1[0].namesOf[0].Row${k}[0].relationshipToYou[0]`)];
  const en = draft({ ...MARRIED, hh: SIX });
  assert.equal(row(en, 1), "Son / Daughter");
  const simplified = draft({ ...MARRIED, hh: SIX }, { ...OPTIONS, form: "zh-s" });
  assert.equal(row(simplified, 1), "子女");
  assert.equal(row(simplified, 2), "继子女");
  const traditional = withHant(() => draft({ ...MARRIED, hh: SIX }, { ...OPTIONS, form: "zh-t" }));
  assert.equal(row(traditional, 1), HANT_MAP["子女"]);
  assert.equal(row(traditional, 2), HANT_MAP["继子女"]);
});

test("the 简体 form: Not sure in Chinese with the catalogue's wording, joined with 、", () => {
  const { comments } = draft(MARRIED, { ...OPTIONS, form: "zh-s" });
  const notSure = [
    zhWording("claimed_by_other"),
    "成员 1：是否持有身份保护码（IP PIN）？",
    "小费",
    zhWording("inc_self_employed_prior_loss"),
    "持有健康储蓄账户（HSA）",
    zhWording("evt_energy"),
  ];
  assert.equal(
    comments,
    [
      "My 1099-INT has not arrived yet.",
      `不确定：${notSure.join("、")}`,
      "其他收入：Jury duty",
      "其他事项：Bought a car",
    ].join("\n\n"),
  );
  assert.ok(comments.includes("不确定：是否有其他人（如父母或成年子女）可以在其报税表上将您或配偶列为受抚养人？、成员 1："));
});

test("the 繁體 form: the same lines through the Traditional map; the client's text as typed", () => {
  const answers = { ...MARRIED, additional_notes: "我的 1099 表还没收到。", inc_other_desc: "陪审员报酬" };
  const { comments } = withHant(() => draft(answers, { ...OPTIONS, form: "zh-t" }));
  const hant = (simplified) => {
    assert.ok(Object.hasOwn(HANT_MAP, simplified), simplified);
    return HANT_MAP[simplified];
  };
  const notSure = [
    hant(zhWording("claimed_by_other")),
    `成員 1：${hant(wording(findQuestion(2, "hh").fields.find((f) => f.id === "ippin"), { lang: "zh-Hans" }))}`,
    hant("小费"),
    hant(zhWording("inc_self_employed_prior_loss")),
    hant("持有健康储蓄账户（HSA）"),
    hant(zhWording("evt_energy")),
  ];
  assert.equal(
    comments,
    [
      "我的 1099 表还没收到。",
      `不確定：${notSure.join("、")}`,
      "其他收入：陪审员报酬",
      "其他事項：Bought a car",
    ].join("\n\n"),
  );
  assert.ok(comments.startsWith("我的 1099 表还没收到。\n\n不確定：是否有其他人（如父母或成年子女）可以在其報稅表上將您或配偶列為受撫養人？、成員 1：是否持有身份保護碼（IP PIN）？、小費、"));
  // Without the map the form would print Simplified: the test above sees the difference.
  assert.notEqual(draft(answers, { ...OPTIONS, form: "zh-t" }).comments, comments);
});

test("the 繁體 form with the map loaded: no generated character is left in Simplified", () => {
  // Not sure answers, six people (two past the form's rows) and client text
  // whose characters are the same in both scripts.
  const answers = { ...MARRIED, hh: SIX, additional_notes: "我的 1099 表", inc_other_desc: "工作", evt_other_desc: "工作" };
  const { comments } = withHant(() => draft(answers, { ...OPTIONS, form: "zh-t" }));
  const converter = OpenCC.Converter({ from: "cn", to: "tw" });
  assert.match(comments, /不確定：/);
  assert.match(comments, /成員 6：/);
  const left = [...comments].filter((ch) => converter(ch) !== ch);
  assert.deepEqual(left, [], `still Simplified: ${left.join("")}`);
  assert.equal(converter(comments), comments);
});

test("Chinese member lines: option labels, dates and words in the form's language", () => {
  const zhLines = [
    "成员 5：Eva Lin · 孙子女/外孙子女 · 2019年9月10日出生 · 居住 12 个月 · 未婚 · 美国公民：是 · 美加墨居民：是 · 全日制学生：否 · 完全且永久性残疾：否 · 身份保护码（IP PIN）：否",
    "成员 6：Fei Lin · 无亲属关系 · 1999年11月12日出生 · 居住 3 个月 · 已婚 · 美国公民：否 · 美加墨居民：不确定 · 全日制学生：否 · 完全且永久性残疾：否 · 身份保护码（IP PIN）：是",
  ];
  const simplified = draft({ ...MARRIED, hh: SIX }, { ...OPTIONS, form: "zh-s" });
  assert.equal(simplified.comments.split("\n\n").at(-1), zhLines.join("\n"));
  assert.match(simplified.comments, /成员 3：是否持有身份保护码（IP PIN）？、成员 4：是否为美国公民？、成员 6：2025 年，此人是否居住在美国/);
  // One month, in Traditional.
  const one = [...SIX.slice(0, 4), { ...SIX[4], months_lived: "1" }];
  const traditional = withHant(() => draft({ ...MARRIED, hh: one }, { ...OPTIONS, form: "zh-t" }));
  assert.equal(
    traditional.comments.split("\n\n").at(-1),
    "成員 5：Eva Lin · 孫子女/外孫子女 · 2019年9月10日出生 · 居住 1 個月 · 未婚 · 美國公民：是 · 美加墨居民：是 · 全日制學生：否 · 完全且永久性殘疾：否 · 身份保護碼（IP PIN）：否",
  );
  // The English form keeps "1 month".
  assert.match(draft({ ...MARRIED, hh: one }).comments, /Person 5: Eva Lin · Grandchild · born 09\/10\/2019 · lived with you 1 month · single · /);
});

test("the English form's generated lines do not change with the Traditional map loaded", () => {
  const plain = draft({ ...MARRIED, hh: SIX });
  const loaded = withHant(() => draft({ ...MARRIED, hh: SIX }));
  assert.equal(loaded.comments, plain.comments);
  assert.ok(!/\p{Script=Han}/u.test(plain.comments));
});

test("a 2025 death's not-sure line quotes the wording with the spouse (add-widowed-spouse-rules)", () => {
  const { comments } = draft({ ...MARRIED, marital_status: "widowed", spouse_death_year: "2025", claimed_by_other: "not_sure" });
  assert.match(comments, /claim you or your spouse as a dependent/);
});

test("the spouse lines print only when a joint return is possible (add-widowed-spouse-rules)", () => {
  const widowed = (year) => draft({ ...MARRIED, marital_status: "widowed", spouse_death_year: year, sp_first_name: "Wei", sp_last_name: "Lin" });
  const died2025 = widowed("2025");
  assert.ok(died2025.checks.includes(F("page1[0].maritalStatus[0].statusWidowed[0].statusWidowed[0]")));
  assert.equal(died2025.text[F("page1[0].maritalStatus[0].statusWidowed[0].yearSpousesDeath[0]")], "2025");
  assert.equal(died2025.text[F("page1[0].spousesFirstName[0]")], "Wei");
  const died2024 = widowed("2024");
  assert.ok(died2024.checks.includes(F("page1[0].maritalStatus[0].statusWidowed[0].statusWidowed[0]")));
  assert.equal(died2024.text[F("page1[0].maritalStatus[0].statusWidowed[0].yearSpousesDeath[0]")], "2024");
  for (const box of ["spousesFirstName", "spousesMiddleInitial", "spousesLastName", "spousesDateOfBirth", "spousesJobTitle", "spousesTelephoneNumber"])
    assert.equal(died2024.text[F(`page1[0].${box}[0]`)], undefined, box);
});

const SHADED = { household1QualifyingChild: "yes", incomeW2s: true, incomeW2sCount: 2, incomeRefundAmount: "412.00" };

test("shaded values fill every form", () => {
  for (const form of ["en", "zh-s", "zh-t"]) {
    const { text, checks, notes, preparerEntries } = draft(MARRIED, { ...OPTIONS, form, shaded: SHADED });
    assert.equal(text[shadedName("household1QualifyingChild", form)], "Yes", form);
    assert.ok(checks.includes(shadedName("incomeW2s", form)), form);
    assert.equal(text[shadedName("incomeW2sCount", form)], "2", form);
    assert.equal(text[shadedName("incomeRefundAmount", form)], "412.00", form);
    assert.deepEqual(notes, [], form);
    assert.equal(preparerEntries, true, form);
  }
});

const KID = MARRIED.hh[0];
const members = (n) => Array.from({ length: n }, (_, i) => ({ ...KID, member_id: ids(i + 1), first_name: `Kid${i + 1}` }));
const ROWS_1_2 = { household1QualifyingChild: "yes", household2QualifyingChild: "yes" };
const twoKept = (answer) => ({ ...MARRIED, has_household_members: answer, hh: members(2) });
test("cells for members the client no longer shows don't print", () => {
  for (const form of ["en", "zh-s", "zh-t"]) {
    const { text, checks } = draft(twoKept("no"), { ...OPTIONS, form, shaded: { ...ROWS_1_2, incomeW2s: true } });
    assert.equal(text[shadedName("household1QualifyingChild", form)], undefined, form);
    assert.equal(text[shadedName("household2QualifyingChild", form)], undefined, form);
    assert.ok(checks.includes(shadedName("incomeW2s", form)), form);
  }
});
test("only hidden cells: the stamp says online answers only", () => {
  assert.equal(draft(twoKept("no"), { ...OPTIONS, shaded: ROWS_1_2 }).preparerEntries, false);
});
test("three visible members print rows 1 to 3", () => {
  const three = { ...MARRIED, has_household_members: "yes", hh: members(3) };
  const shaded = { household1QualifyingChild: "yes", household2OwnSupport: "no", household3LowIncome: "na" };
  const { text } = draft(three, { ...OPTIONS, shaded });
  assert.equal(text[shadedName("household1QualifyingChild")], "Yes");
  assert.equal(text[shadedName("household2OwnSupport")], "No");
  assert.equal(text[shadedName("household3LowIncome")], "N/A");
});

test("shaded notes are kept out of text and listed with their block and page", () => {
  const shaded = { deductionNotes: "Bring the 1098.", incomeNotes: "Two jobs.", infoVin: "1HGCM82633A004352" };
  const { text, notes } = draft(MARRIED, { ...OPTIONS, shaded });
  assert.equal(text[shadedName("deductionNotes", "en")], undefined);
  assert.equal(text[shadedName("infoVin", "en")], "1HGCM82633A004352");
  assert.deepEqual(notes.map((n) => [n.name, n.text, n.block, n.page]), [
    [shadedName("incomeNotes", "en"), "Two jobs.", "Income", 2],
    [shadedName("deductionNotes", "en"), "Bring the 1098.", "Standard or itemized deductions", 3],
  ]);
});

test("stamp wording follows the preparer entries", () => {
  assert.equal(draft(MARRIED, { ...OPTIONS, shaded: SHADED }).stamp, "DRAFT – online answers and preparer entries, 10/04/2026, VT-ABCD-EFGH");
  assert.equal(draft(MARRIED, { ...OPTIONS, shaded: {} }).stamp, "DRAFT – prepared from online answers, 10/04/2026, VT-ABCD-EFGH");
  assert.equal(draft(MARRIED, { ...OPTIONS, shaded: null }).preparerEntries, false);
  assert.equal(draftStamp("VT-ABCD-EFGH", "2026-10-04", { preparerEntries: true }), "DRAFT – online answers and preparer entries, 10/04/2026, VT-ABCD-EFGH");
});
