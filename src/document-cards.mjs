// The Documents step's card rules (intake redesign spec §6.1 and Appendix A).
//
// Pure: no DOM, no store, no timers. `cardsFor` turns a client's version-2
// answers plus the stored card state into the cards the Documents step shows.
// The server's migration copies the rule ids and their card types (RULE_TYPES);
// a test keeps the two lists in step.
import { visibleAnswers, isMemberId, spouseShown } from "./intake-catalogue.mjs";

export const CARD_SUBSTEPS = Object.freeze(["identity", "income", "expenses", "events", "other"]);
export const SLOT_PATTERN = /^[a-z0-9_]+\.(tp|sp|household|hh\.[0-9a-f]{32})$/;

// ---------------------------------------------------------------------------
// Card text (Part 4d, spec 2026-10-05 §2, §4). Every Chinese source string a
// card can show sits in CARD_RULES, CARD_WHY or CARD_TEMPLATES, so
// tools/hant-sources.mjs collects it for the Traditional map. A card field's
// `en` is the finished English string; `zh` is a static string, or a template
// filled with the client's data after conversion. Names are literal. An
// optional `office` is the office's English for Add a case, where the client's
// own voice ("You said…", "For you") would be wrong.
// ---------------------------------------------------------------------------

const pair = (en, zh, office) => Object.freeze(office ? { en, zh, office } : { en, zh });
const said = (en, zh) => pair(`You said ${en}`, `您说${zh}`);

// Text built from the client's answers, and the static pairs the matchers and
// owner lines use. Strings are zh templates; the English is built in code.
export const CARD_TEMPLATES = Object.freeze({
  // The W-2 card's job-count hint ({n} jobs)
  w2_hint: "您说有 {n} 份工作，请上传 {n} 张 W-2。",
  // "You wrote: …" (the client's own description)
  wrote: "您填写的是：{written}",
  // A household member with no name on the owner line
  person: "成员 {n}",
  // Owner lines
  you: pair("You", "本人", "Client"),
  spouse: pair("Your spouse", "配偶", "Spouse"),
  for_you_and_spouse: pair("For you and your spouse", "您和配偶", "Client and spouse"),
  for_you: pair("For you", "本人", "Client"),
  for_household: pair("For your household", "全家共用", "Household"),
  // Hints given by a matcher rather than the rule
  spouse_hint: pair("Needed if you file together", "如合并申报则需要", "Needed if filing jointly"),
  prior_return_hint: pair("If you filed together last year, upload one return. If you filed separately, upload both.", "去年合并申报的，上传一份；分开申报的，两份都上传。", "If they filed jointly last year, one return. If separately, both."),
  // The direct-deposit card's hint: the spouse when married, the late spouse
  // when widowed with a joint return possible (changes add-unmarried-intake-wording
  // D7 and add-widowed-spouse-rules D6), else the client alone.
  bank_hint: pair("The account must be in your name (or your spouse's).", "账户必须是您（或配偶）名下的账户。", "The account must be in the client's or spouse's name."),
  bank_hint_single: pair("The account must be in your name.", "账户必须是您名下的账户。", "The account must be in the client's name."),
  bank_hint_late: pair(
    "The account must be in the name of one of the taxpayers on this return: your own account, or a joint account with your late spouse.",
    "账户必须在该税单任一纳税人名下：您本人的账户，或您与已故配偶的联名账户。",
    "The account must be in the name of one of the taxpayers on this return: the client's own account, or a joint account with their late spouse.",
  ),
});

// Why lines, keyed <rule id>_<the answer it reports>. The said() lines read
// "You said …" / "您说…".
export const CARD_WHY = Object.freeze({
  ippin_ippin: said("you were issued an IP PIN", "持有国税局发放的身份保护码（IP PIN）"),
  ippin_hh: said("this person has an IP PIN", "这位成员持有身份保护码（IP PIN）"),
  prior_return_evt_brought_prior_return: said("you have last year's tax return", "有去年的报税表"),
  tip_records_inc_tips: said("you had tips", "有小费收入"),
  "1099r_inc_retirement": said("you had retirement account, pension or annuity income", "有退休账户、养老金或年金收入"),
  disability_inc_disability: said("you had disability benefits", "有残障补助"),
  ssa1099_inc_social_security: said("you had Social Security or Railroad Retirement benefits", "有社会安全金或铁路退休金"),
  "1099g_unemployment_inc_unemployment": said("you had unemployment benefits", "有失业金"),
  "1099g_refund_inc_state_refund": said("you had a state or local income tax refund", "有州或地方所得税退税"),
  "1099int_div_inc_interest_div": said("you had interest or dividends", "有利息或股息"),
  "1099b_inc_sale_assets": said("you sold stocks, bonds or real estate", "出售过股票、债券或房地产"),
  digital_assets_digital_assets: said("you held digital assets", "持有数字资产"),
  alimony_received_inc_alimony: said("you received alimony", "收到了赡养费"),
  rental_home_inc_rental_home: said("you rented out your house or a room", "出租过房屋或房间"),
  rental_property_inc_rental_property: said("you rented out personal property", "出租过个人物品"),
  w2g_inc_gambling: said("you had gambling or lottery winnings", "有赌博或彩票奖金"),
  "1099nec_k_misc_inc_self_employed": said("you had contract or self-employment income", "有合同工或自雇收入"),
  app_tax_summary_inc_self_employed: said("you had contract or self-employment income", "有合同工或自雇收入"),
  business_costs_inc_self_employed: said("you had contract or self-employment income", "有合同工或自雇收入"),
  other_income_inc_other: said("you had other income", "有其他收入"),
  "1098_exp_mortgage_interest": said("you paid mortgage interest", "支付过房贷利息"),
  taxes_paid_exp_taxes: said("you paid state, local, real estate or sales taxes", "缴纳过州税、地方税、房产税或销售税"),
  medical_exp_medical: said("you had medical, dental or prescription expenses", "有医疗、牙科或处方药费用"),
  charity_exp_charity: said("you made charitable contributions", "有慈善捐款"),
  "1098e_exp_student_loan": said("you paid student loan interest", "支付过学生贷款利息"),
  dependent_care_exp_dependent_care: said("you paid for child or dependent care", "支付过子女或受抚养人照护费用"),
  ira_contrib_exp_retirement_contrib: said("you contributed to a retirement account", "向退休账户供过款"),
  educator_exp_educator: said("you bought classroom supplies as an educator", "作为教育工作者自费购买过教学用品"),
  alimony_paid_exp_alimony_paid: said("you paid alimony", "支付过赡养费"),
  education_evt_education: said("you or a family member took classes", "自己或家人参加过课程"),
  home_sale_evt_sold_home: said("you sold a home", "出售过房屋"),
  hsa_evt_hsa: said("you had a Health Savings Account (HSA)", "持有健康储蓄账户（HSA）"),
  "1095a_evt_marketplace": said("you bought health insurance through the Marketplace", "通过医保交易市场购买了医疗保险"),
  energy_evt_energy: said("you made energy-efficient home improvements", "做过节能家居改造"),
  other_event_evt_other: said("something else happened this year", "今年还有其他事项"),
  debt_canceled_evt_debt_canceled: said("a debt was canceled or forgiven", "有债务被取消或免除"),
  disaster_evt_disaster: said("you had a loss in a federally declared disaster area", "在联邦宣布的灾区遭受过损失"),
  credit_disallowed_evt_credit_disallowed: said("a tax credit was disallowed in a prior year", "以往年度有税收抵免被拒"),
  irs_letter_evt_irs_letter: said("you received a letter or bill from the IRS", "收到过国税局的信件或账单"),
  estimated_payments_evt_estimated_payments: said("you made estimated tax payments or applied last year's refund to this year's tax", "缴纳过预估税，或将去年的退税用于抵缴税款"),
  visa_on_visa: said("you were in the U.S. on a visa in 2025", " 2025 年持签证在美国"),
  bank_refund_method: said("you want your refund paid into a bank account", "希望退税存入银行账户"),
  bank_payment_method: said("you would pay a balance due from a bank account", "如需补税，将从银行账户扣款"),
  ssn_hh_listed: pair("You listed this person in your household", "您列出了这位家庭成员"),
  prior_return_missing: pair("If you can find it, last year's return helps the volunteer", "如果能找到，去年的报税表对志愿者很有帮助。"),
});

// ---------------------------------------------------------------------------
// Match helpers. A rule's `match(answers)` returns [{ owner, group, hint?, why?, ask? }].
// `answers` here is already limited to visible answers.
// ---------------------------------------------------------------------------

const HOUSEHOLD = "household";
// Married today. Only the custody card and the bank hint read it: Form 8332
// concerns the child's parents, so a widowed client of any year can get it.
// Everything about a spouse on the return reads spouseShown (J, change
// add-widowed-spouse-rules, design D6).
const isMarriedNow = (a) => a.marital_status === "married";
const text = (value) => (typeof value === "string" ? value.trim() : "");

// Household members that can own a card: a valid member_id, first one wins.
function members(a) {
  const seen = new Set();
  const list = [];
  (Array.isArray(a.hh) ? a.hh : []).forEach((member, index) => {
    if (!member || typeof member !== "object" || !isMemberId(member.member_id) || seen.has(member.member_id)) return;
    seen.add(member.member_id);
    list.push({ member, index, owner: `hh.${member.member_id}` });
  });
  return list;
}

// yes -> needed, not_sure -> maybe, anything else -> no card.
const groupOfYesNo = (value) => (value === "yes" ? "needed" : value === "not_sure" ? "maybe" : null);

// A household or shared card from one yes/no question. `extra(answers)` may add { hint, why }.
const yesOrUnsure = (field, extra) => (a) => {
  const group = groupOfYesNo(a[field]);
  return group ? [{ owner: HOUSEHOLD, group, ...(extra ? extra(a) : {}) }] : [];
};

// Who questions: me -> tp, spouse -> sp (only when there is a spouse on the return).
const whoOwners = (a, field) => {
  const chosen = Array.isArray(a[field]) ? a[field] : [];
  return [
    ...(chosen.includes("me") ? ["tp"] : []),
    ...(chosen.includes("spouse") && spouseShown(a) ? ["sp"] : []),
  ];
};
const whoPerson = (field, group = "needed") => (a) => whoOwners(a, field).map((owner) => ({ owner, group }));
const whoOne = (field, group) => (a) => (whoOwners(a, field).length ? [{ owner: HOUSEHOLD, group }] : []);

const spouseHint = CARD_TEMPLATES.spouse_hint;

const w2Hint = (a) => {
  const count = text(a.inc_wages_job_count);
  if (!/^[1-9][0-9]*$/.test(count)) return {};
  const n = Number(count);
  return {
    hint: {
      en: `You said ${n} ${n === 1 ? "job" : "jobs"}. Upload ${n} ${n === 1 ? "W-2" : "W-2s"}.`,
      office: `Client said ${n} ${n === 1 ? "job" : "jobs"}. Expect ${n} ${n === 1 ? "W-2" : "W-2s"}.`,
      zh: { template: CARD_TEMPLATES.w2_hint, params: { n } },
    },
  };
};

const wroteWhy = (field) => (a) => {
  const written = text(a[field]);
  return written ? { why: { en: `You wrote: ${written}`, zh: { template: CARD_TEMPLATES.wrote, params: { written } } } } : {};
};

const PRIOR_RETURN_FEEDERS = [
  "inc_state_refund", "inc_sale_assets_prior_loss", "inc_self_employed_prior_loss",
  "evt_credit_disallowed", "evt_estimated_payments",
];

// ---------------------------------------------------------------------------
// The rules, in Appendix A order. type: person | shared | household.
// ---------------------------------------------------------------------------

export const CARD_RULES = Object.freeze([
  // A.1 Identity
  {
    id: "photo_id", type: "person", substep: "identity",
    label: { en: "Photo ID (driver's license, state ID, passport)", zh: "带照片的身份证件" },
    hint: { en: "Any document with your photo, name and birth date counts: a driver's license, state ID, passport, green card, EAD, Philadelphia city ID or Certificate of Naturalization.", zh: "任何带照片、姓名和出生日期的证件均可：驾照、州身份证、护照、绿卡、工卡（EAD）、费城市民卡或入籍证书。" },
    match: (a) => [{ owner: "tp", group: "needed" }, ...(spouseShown(a) ? [{ owner: "sp", group: "needed", hint: spouseHint }] : [])],
  },
  {
    id: "ssn", type: "person", substep: "identity",
    label: { en: "Social Security card or ITIN letter", zh: "社安卡或 ITIN 信" },
    match: (a) => [
      { owner: "tp", group: "needed" },
      ...(spouseShown(a) ? [{ owner: "sp", group: "needed", hint: spouseHint }] : []),
      ...members(a).map(({ owner }) => ({
        owner, group: "maybe", ask: "hh",
        why: CARD_WHY.ssn_hh_listed,
      })),
    ],
  },
  {
    id: "ippin", type: "person", substep: "identity", ask: "ippin",
    label: { en: "This year's IP PIN letter (CP01A), or a screenshot from your IRS online account", zh: "今年的身份保护码（IP PIN）信（CP01A）或国税局网上账户截图" },
    why: CARD_WHY.ippin_ippin,
    match: (a) => [
      ...whoPerson("ippin")(a),
      ...members(a).flatMap(({ member, owner }) => {
        const group = groupOfYesNo(member.ippin);
        return group ? [{ owner, group, ask: "hh", why: CARD_WHY.ippin_hh }] : [];
      }),
    ],
  },
  {
    id: "prior_return", type: "household", substep: "identity", ask: "evt_brought_prior_return",
    label: { en: "Last year's tax return (federal and state), and city or local tax return", zh: "去年的报税表（联邦和州）；以及市级/地方纳税申报表" },
    match: (a) => {
      if (a.evt_brought_prior_return === "yes") {
        return [{
          owner: HOUSEHOLD, group: "needed",
          why: CARD_WHY.prior_return_evt_brought_prior_return,
          hint: CARD_TEMPLATES.prior_return_hint,
        }];
      }
      if (a.evt_brought_prior_return === "no" && PRIOR_RETURN_FEEDERS.some((field) => a[field] === "yes")) {
        return [{
          owner: HOUSEHOLD, group: "maybe",
          why: CARD_WHY.prior_return_missing,
        }];
      }
      return [];
    },
  },

  // A.2 Income forms (shared unless noted)
  {
    id: "w2", type: "shared", substep: "income", ask: "inc_wages",
    label: { en: "W-2 from each job", zh: "每份工作的 W-2" },
    why: { en: "You said you had wages from a job", zh: "您说有工资收入" },
    match: yesOrUnsure("inc_wages", w2Hint),
  },
  {
    id: "tip_records", type: "shared", substep: "income", ask: "inc_tips",
    label: { en: "Tip records: your tip log, or the tip page of your app's tax summary", zh: "小费记录：自己记的小费账，或平台年度报税摘要中的小费页" },
    why: CARD_WHY.tip_records_inc_tips,
    match: yesOrUnsure("inc_tips"),
  },
  {
    id: "1099r", type: "shared", substep: "income", ask: "inc_retirement",
    label: { en: "1099-R (each one)", zh: "1099-R（每一张）" },
    why: CARD_WHY["1099r_inc_retirement"],
    match: yesOrUnsure("inc_retirement"),
  },
  {
    id: "disability", type: "shared", substep: "income", ask: "inc_disability",
    label: { en: "W-2 or 1099-R for disability pay, or the benefit letter", zh: "残障补助的 W-2、1099-R 或补助通知信" },
    why: CARD_WHY.disability_inc_disability,
    match: yesOrUnsure("inc_disability"),
  },
  {
    id: "ssa1099", type: "shared", substep: "income", ask: "inc_social_security",
    label: { en: "SSA-1099 or RRB-1099", zh: "SSA-1099 或 RRB-1099" },
    why: CARD_WHY.ssa1099_inc_social_security,
    match: yesOrUnsure("inc_social_security"),
  },
  {
    id: "1099g_unemployment", type: "shared", substep: "income", ask: "inc_unemployment",
    label: { en: "1099-G for unemployment", zh: "失业金 1099-G" },
    why: CARD_WHY["1099g_unemployment_inc_unemployment"],
    match: yesOrUnsure("inc_unemployment"),
  },
  {
    id: "1099g_refund", type: "shared", substep: "income", ask: "inc_state_refund",
    label: { en: "1099-G for the state or city tax refund", zh: "州或市退税 1099-G" },
    why: CARD_WHY["1099g_refund_inc_state_refund"],
    match: yesOrUnsure("inc_state_refund"),
  },
  {
    id: "1099int_div", type: "shared", substep: "income", ask: "inc_interest_div",
    label: { en: "1099-INT, 1099-DIV, or 1099-OID", zh: "1099-INT、1099-DIV 或 1099-OID" },
    why: CARD_WHY["1099int_div_inc_interest_div"],
    hint: { en: "Or Form 1042-S, if your bank or broker sent one", zh: "如银行或券商寄来的是 1042-S 表，也请上传" },
    match: yesOrUnsure("inc_interest_div"),
  },
  {
    id: "1099b", type: "shared", substep: "income", ask: "inc_sale_assets",
    label: { en: "1099-B and the full brokerage statement; 1099-S if the sale was real estate", zh: "1099-B 及完整券商对账单；如卖的是房地产，上传 1099-S" },
    why: CARD_WHY["1099b_inc_sale_assets"],
    match: yesOrUnsure("inc_sale_assets"),
  },
  {
    id: "digital_assets", type: "shared", substep: "income", ask: "digital_assets",
    label: { en: "1099-DA or the exchange's 2025 gain/loss report", zh: "1099-DA 或交易所的 2025 年盈亏报告" },
    why: CARD_WHY.digital_assets_digital_assets,
    match: whoOne("digital_assets", "maybe"),
  },
  {
    id: "alimony_received", type: "household", substep: "income", ask: "inc_alimony",
    label: { en: "Divorce or separation agreement: the page with the date and the alimony terms", zh: "离婚或分居协议中写有日期和赡养费条款的页面" },
    why: CARD_WHY.alimony_received_inc_alimony,
    match: yesOrUnsure("inc_alimony"),
  },
  {
    id: "rental_home", type: "shared", substep: "income", ask: "inc_rental_home",
    label: { en: "Rent records (income and costs), and any 1099-MISC or 1099-K for rent", zh: "租金收支记录，以及租金相关的 1099-MISC 或 1099-K" },
    why: CARD_WHY.rental_home_inc_rental_home,
    match: yesOrUnsure("inc_rental_home"),
  },
  {
    id: "rental_property", type: "shared", substep: "income", ask: "inc_rental_property",
    label: { en: "Rent records and any 1099-MISC or 1099-K", zh: "出租记录及 1099-MISC 或 1099-K" },
    why: CARD_WHY.rental_property_inc_rental_property,
    match: yesOrUnsure("inc_rental_property"),
  },
  {
    id: "w2g", type: "shared", substep: "income", ask: "inc_gambling",
    label: { en: "W-2G (each one), and loss records if you have them (a handwritten record is fine)", zh: "W-2G（每一张），如有输钱记录也请上传（可以接受手写记录）" },
    why: CARD_WHY.w2g_inc_gambling,
    match: yesOrUnsure("inc_gambling"),
  },
  {
    id: "1099nec_k_misc", type: "shared", substep: "income", ask: "inc_self_employed",
    label: { en: "1099-NEC, 1099-K, 1099-MISC (each one)", zh: "1099-NEC、1099-K、1099-MISC（每一张）" },
    why: CARD_WHY["1099nec_k_misc_inc_self_employed"],
    match: yesOrUnsure("inc_self_employed"),
  },
  {
    id: "app_tax_summary", type: "shared", substep: "income", ask: "inc_self_employed",
    label: { en: "Rideshare or delivery app annual tax summary (for example, the Uber or Lyft Tax Summary)", zh: "网约车或外卖平台的年度报税摘要" },
    why: CARD_WHY.app_tax_summary_inc_self_employed,
    hint: { en: "If you drive or deliver with an app", zh: "如果您开网约车或送外卖" },
    match: yesOrUnsure("inc_self_employed"),
  },
  {
    id: "business_costs", type: "household", substep: "income", ask: "inc_self_employed",
    label: { en: "Business costs: mileage log, receipts or summaries (phone, tolls, parking, supplies)", zh: "经营支出：里程记录、收据或汇总（手机费、过路费、停车费、用品）" },
    why: CARD_WHY.business_costs_inc_self_employed,
    hint: { en: "A one-page summary of your costs is fine.", zh: "一页费用汇总即可。" },
    match: yesOrUnsure("inc_self_employed"),
  },
  {
    id: "other_income", type: "shared", substep: "income", ask: "inc_other",
    label: { en: "Any form or statement for this income (for example, 1099-MISC, a jury duty pay letter, a union strike pay statement)", zh: "该收入的任何税表或证明（如 1099-MISC、陪审报酬通知、工会罢工补助证明）" },
    why: CARD_WHY.other_income_inc_other,
    match: yesOrUnsure("inc_other", wroteWhy("inc_other_desc")),
  },

  // A.3 Expenses (household unless noted)
  {
    id: "1098", type: "household", substep: "expenses", ask: "exp_mortgage_interest",
    label: { en: "1098 mortgage interest statement", zh: "房贷利息 1098 表" },
    why: CARD_WHY["1098_exp_mortgage_interest"],
    match: yesOrUnsure("exp_mortgage_interest"),
  },
  {
    id: "taxes_paid", type: "household", substep: "expenses", ask: "exp_taxes",
    label: { en: "Property tax bill or receipt; receipts for large purchases with sales tax (for example, a car)", zh: "房产税单或收据；大额消费的销售税收据（如买车）" },
    why: CARD_WHY.taxes_paid_exp_taxes,
    match: yesOrUnsure("exp_taxes"),
  },
  {
    id: "medical", type: "household", substep: "expenses", ask: "exp_medical",
    label: { en: "Medical, dental, and prescription receipts, or a yearly summary from the pharmacy or insurer", zh: "医疗、牙科、处方药收据，或药房/保险公司的年度汇总" },
    why: CARD_WHY.medical_exp_medical,
    match: yesOrUnsure("exp_medical"),
  },
  {
    id: "charity", type: "household", substep: "expenses", ask: "exp_charity",
    label: { en: "Donation receipts or thank-you letters", zh: "捐款收据或感谢信" },
    why: CARD_WHY.charity_exp_charity,
    match: yesOrUnsure("exp_charity"),
  },
  {
    id: "1098e", type: "shared", substep: "expenses", ask: "exp_student_loan",
    label: { en: "1098-E", zh: "1098-E 表" },
    why: CARD_WHY["1098e_exp_student_loan"],
    match: yesOrUnsure("exp_student_loan"),
  },
  {
    id: "dependent_care", type: "household", substep: "expenses", ask: "exp_dependent_care",
    label: { en: "Care provider's statement or receipts showing name, address, tax ID, and amount paid", zh: "照护机构或照护者的证明或收据（含名称、地址、税号、金额）" },
    why: CARD_WHY.dependent_care_exp_dependent_care,
    match: yesOrUnsure("exp_dependent_care"),
  },
  {
    id: "ira_contrib", type: "shared", substep: "expenses", ask: "exp_retirement_contrib",
    label: { en: "IRA contribution statement or receipt (Form 5498 if you have it)", zh: "IRA 供款证明或收据（如有 5498 表）" },
    why: CARD_WHY.ira_contrib_exp_retirement_contrib,
    match: yesOrUnsure("exp_retirement_contrib"),
  },
  {
    id: "educator", type: "household", substep: "expenses", ask: "exp_educator",
    label: { en: "Receipts for classroom supplies", zh: "教学用品收据" },
    why: CARD_WHY.educator_exp_educator,
    match: yesOrUnsure("exp_educator"),
  },
  {
    id: "alimony_paid", type: "household", substep: "expenses", ask: "exp_alimony_paid",
    label: { en: "Divorce or separation agreement: the page with the date and the alimony terms", zh: "离婚或分居协议中写有日期和赡养费条款的页面" },
    why: CARD_WHY.alimony_paid_exp_alimony_paid,
    match: yesOrUnsure("exp_alimony_paid"),
  },

  // A.4 Health and other events (household unless noted)
  {
    id: "education", type: "shared", substep: "events", ask: "evt_education",
    label: { en: "1098-T for each student, plus tuition, fee, and book receipts and any scholarship letter", zh: "每位学生的 1098-T，以及学费、杂费、书费收据和奖学金信" },
    why: CARD_WHY.education_evt_education,
    match: yesOrUnsure("evt_education"),
  },
  {
    id: "home_sale", type: "household", substep: "events", ask: "evt_sold_home",
    label: { en: "1099-S and the closing statements for the sale and for the original purchase", zh: "1099-S，以及卖房和当初买房的交割文件" },
    why: CARD_WHY.home_sale_evt_sold_home,
    match: yesOrUnsure("evt_sold_home"),
  },
  {
    id: "hsa", type: "shared", substep: "events", ask: "evt_hsa",
    label: { en: "1099-SA and 5498-SA", zh: "1099-SA 和 5498-SA" },
    why: CARD_WHY.hsa_evt_hsa,
    match: yesOrUnsure("evt_hsa"),
  },
  {
    id: "1095a", type: "household", substep: "events", ask: "evt_marketplace",
    label: { en: "Every 1095-A you got", zh: "收到的所有 1095-A" },
    why: CARD_WHY["1095a_evt_marketplace"],
    hint: { en: "1095-B and 1095-C are not needed", zh: "不需要 1095-B 和 1095-C" },
    match: yesOrUnsure("evt_marketplace"),
  },
  {
    id: "energy", type: "household", substep: "events", ask: "evt_energy",
    label: { en: "Receipts or invoices showing each item, its cost, the labor cost (if listed separately), and the install date; the Qualified Manufacturer ID (QMID) for each item; any rebate or subsidy letter; the home energy audit report, if you had one", zh: "每项设备的收据或发票（含金额、单列的安装人工费、安装日期）；每项设备的制造商识别号（QMID）；任何返利或补贴证明；如做过家庭能源审计，请上传审计报告" },
    why: CARD_WHY.energy_evt_energy,
    match: yesOrUnsure("evt_energy"),
  },
  {
    id: "other_event", type: "household", substep: "events", ask: "evt_other",
    label: { en: "Any paper about this event", zh: "与此事相关的任何文件" },
    why: CARD_WHY.other_event_evt_other,
    match: yesOrUnsure("evt_other", wroteWhy("evt_other_desc")),
  },
  {
    id: "debt_canceled", type: "household", substep: "events", ask: "evt_debt_canceled",
    label: { en: "1099-C or 1099-A", zh: "1099-C 或 1099-A" },
    why: CARD_WHY.debt_canceled_evt_debt_canceled,
    match: yesOrUnsure("evt_debt_canceled"),
  },
  {
    id: "disaster", type: "household", substep: "events", ask: "evt_disaster",
    label: { en: "FEMA or insurance papers, and records of the loss", zh: "FEMA 或保险理赔文件，以及损失记录" },
    why: CARD_WHY.disaster_evt_disaster,
    match: yesOrUnsure("evt_disaster"),
  },
  {
    id: "credit_disallowed", type: "household", substep: "events", ask: "evt_credit_disallowed",
    label: { en: "The IRS letter that denied the credit", zh: "国税局拒绝抵免的信" },
    why: CARD_WHY.credit_disallowed_evt_credit_disallowed,
    match: yesOrUnsure("evt_credit_disallowed"),
  },
  {
    id: "irs_letter", type: "household", substep: "events", ask: "evt_irs_letter",
    label: { en: "Each IRS letter or bill", zh: "每一封国税局信件或账单" },
    why: CARD_WHY.irs_letter_evt_irs_letter,
    match: yesOrUnsure("evt_irs_letter"),
  },
  {
    id: "estimated_payments", type: "household", substep: "events", ask: "evt_estimated_payments",
    label: { en: "Payment records: IRS Direct Pay confirmations, IRS online account payment history, or cancelled checks", zh: "付款记录：国税局 Direct Pay 确认、网上账户付款记录或已兑现支票" },
    why: CARD_WHY.estimated_payments_evt_estimated_payments,
    hint: { en: "Include state payments", zh: "请包括州税的付款" },
    match: yesOrUnsure("evt_estimated_payments"),
  },
  {
    id: "visa", type: "person", substep: "events", ask: "on_visa",
    label: { en: "Visa and entry papers (for example, I-94, I-20, DS-2019)", zh: "签证及入境文件（如 I-94、I-20、DS-2019）" },
    why: CARD_WHY.visa_on_visa,
    hint: { en: "Helps the volunteer check your residency status.", zh: "有助于志愿者核对您的居民身份。", office: "Helps check residency status." },
    match: whoPerson("on_visa", "maybe"),
  },
  {
    id: "custody", type: "household", substep: "events", ask: "hh",
    label: { en: "Form 8332 or the custody pages of the court order, if you have them", zh: "8332 表或法院监护权文件（如有）" },
    why: { en: "You said a child lived with you for less than 6 months", zh: "您说有孩子与您同住不足 6 个月" },
    match: (a) =>
      !isMarriedNow(a) && Array.isArray(a.hh) && a.hh.some((m) => text(m?.months_lived) !== "" && Number(m.months_lived) < 6)
        ? [{ owner: HOUSEHOLD, group: "maybe" }] : [],
  },
  {
    id: "bank", type: "household", substep: "events",
    label: { en: "A voided check or a bank letter with routing and account numbers", zh: "作废支票或写有路由号和账号的银行信" },
    match: (a) => {
      const hint = isMarriedNow(a)
        ? CARD_TEMPLATES.bank_hint
        : spouseShown(a)
          ? CARD_TEMPLATES.bank_hint_late
          : CARD_TEMPLATES.bank_hint_single;
      return [
        ...(a.refund_method === "direct_deposit" || a.refund_method === "split"
          ? [{ owner: HOUSEHOLD, group: "needed", ask: "refund_method", why: CARD_WHY.bank_refund_method, hint }] : []),
        ...(a.payment_method === "bank_account"
          ? [{ owner: HOUSEHOLD, group: "maybe", ask: "payment_method", why: CARD_WHY.bank_payment_method, hint }] : []),
      ];
    },
  },

  // A.5 Other documents: optional, always shown
  {
    id: "other", type: "household", substep: "other",
    label: { en: "Other documents", zh: "其他文件" },
    hint: { en: "For example, a city tax notice, or a blank local tax form you received.", zh: "例如市政府的税务通知，或您收到的空白地方税表。" },
    match: () => [{ owner: HOUSEHOLD, group: "optional" }],
  },
]);

export const RULE_TYPES = new Map(CARD_RULES.map((rule) => [rule.id, rule.type]));

// ---------------------------------------------------------------------------
// cardsFor
// ---------------------------------------------------------------------------

const GROUP_RANK = { needed: 0, maybe: 1, optional: 2 };

const fullName = (first, last) => [text(first), text(last)].filter(Boolean).join(" ");
// The client's own words: shown as typed in every language.
const literal = (value) => ({ en: value, zh: value, literal: true });

function ownerLineOf(owner, rule, a, position) {
  if (owner === "tp") {
    const name = fullName(a.tp_first_name, a.tp_last_name);
    return name ? literal(name) : CARD_TEMPLATES.you;
  }
  if (owner === "sp") {
    const name = fullName(a.sp_first_name, a.sp_last_name);
    return name ? literal(name) : CARD_TEMPLATES.spouse;
  }
  if (owner.startsWith("hh.")) {
    const member = (Array.isArray(a.hh) ? a.hh : [])[position];
    const name = fullName(member?.first_name, member?.last_name);
    return name
      ? literal(name)
      : { en: `Person ${position + 1}`, zh: { template: CARD_TEMPLATES.person, params: { n: position + 1 } } };
  }
  if (rule.type === "shared") {
    return spouseShown(a) ? CARD_TEMPLATES.for_you_and_spouse : CARD_TEMPLATES.for_you;
  }
  return CARD_TEMPLATES.for_household;
}

export function cardsFor(answers, cardState = []) {
  const a = visibleAnswers(2, answers ?? {});
  const stored = new Map();
  for (const item of Array.isArray(cardState) ? cardState : []) {
    if (item && typeof item.slotId === "string") stored.set(item.slotId, item);
  }
  const positions = new Map(members(a).map(({ owner, index }) => [owner, index]));
  const ownerOrder = (owner) => (owner === "tp" ? 0 : owner === "sp" ? 1 : owner === "household" ? 1e9 : 2 + positions.get(owner));

  const cards = [];
  CARD_RULES.forEach((rule, ruleIndex) => {
    // Rows sharing an id and an owner make one card; Needed wins.
    const best = new Map();
    for (const m of rule.match(a) ?? []) {
      const fits = rule.type === "person"
        ? m.owner === "tp" || m.owner === "sp" || positions.has(m.owner)
        : m.owner === HOUSEHOLD;
      if (!fits || !(m.group in GROUP_RANK)) continue;
      const current = best.get(m.owner);
      if (!current || GROUP_RANK[m.group] < GROUP_RANK[current.group]) best.set(m.owner, m);
    }
    for (const [owner, m] of best) {
      const slotId = `${rule.id}.${owner}`;
      const state = stored.get(slotId);
      const baseGroup = m.group;
      const group = baseGroup === "maybe" && state?.groupOverride === "needed" ? "needed" : baseGroup;
      cards.push({
        slotId,
        ruleId: rule.id,
        owner,
        ownerLine: ownerLineOf(owner, rule, a, positions.get(owner)),
        group,
        baseGroup,
        status: ["later", "none", "sent", "received", "verified"].includes(state?.status) ? state.status : "not_done",
        substep: rule.substep,
        label: rule.label,
        why: m.why ?? rule.why ?? null,
        hint: m.hint ?? rule.hint ?? null,
        ask: m.ask ?? rule.ask ?? null,
        _sort: [CARD_SUBSTEPS.indexOf(rule.substep), GROUP_RANK[group], ruleIndex, ownerOrder(owner)],
      });
    }
  });

  cards.sort((x, y) => {
    for (let i = 0; i < 4; i++) if (x._sort[i] !== y._sort[i]) return x._sort[i] - y._sort[i];
    return 0;
  });
  return cards.map(({ _sort, ...card }) => card);
}
