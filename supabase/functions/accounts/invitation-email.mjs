// The invitation email the accounts function sends. It carries no sign-in code,
// no recipient address and nothing from a case or profile: the person signs in
// on the site, which emails them a code then. Plain module, no imports.

export const INVITATION_DAYS = 7;

const SUBJECTS = {
  client: "You're invited to ViTally · 邀请您使用 ViTally",
  volunteer: "You're invited to ViTally as a PCDC VITA volunteer",
};

const CLIENT_EN = [
  "Hello,",
  "The PCDC VITA free tax site has invited you to ViTally, where you can answer the questions for your tax return and see which documents to bring.",
  "To sign in, go to {link} and enter the email address this message was sent to. We will email you a sign-in code when you sign in.",
  "This invitation is valid until {en}. After that, ask the tax site to invite you again.",
  "ViTally will never ask for your password, Social Security number or bank details by email.",
  "Questions? Reply to this email.",
  "If you weren't expecting this email, you can ignore it.",
];

const CLIENT_ZH = [
  "您好：",
  "PCDC 免费报税站（VITA）邀请您使用 ViTally。您可以在 ViTally 上填写报税所需的资料，并查看需要携带哪些文件。",
  "登录方法：前往 {link}，输入接收这封邮件的电子邮箱地址。登录时，我们会通过电子邮件发送登录验证码。",
  "此邀请有效期至{zh}。过期后，请联系报税站重新发送邀请。",
  "ViTally 绝不会通过电子邮件索取您的密码、社会安全号码或银行信息。",
  "如有疑问，请直接回复此邮件。",
  "如果您不清楚为什么收到这封邮件，请直接忽略。",
];

const VOLUNTEER_EN = [
  "Hello,",
  "You've been added to the PCDC VITA volunteer roster, and your ViTally account is ready. ViTally is where the site prepares, reviews and follows up on returns.",
  "To sign in, go to {link} and enter the email address this message was sent to. We will email you a sign-in code when you sign in.",
  "The first time you sign in, you'll confirm your site with your name and the site's SIDN. Your site coordinator can give you the SIDN.",
  "If anything is still needed for this season, such as your signed Form 13615, ViTally will show you what's missing before you can work on cases.",
  "This invitation is valid until {en}. After that, ask your site coordinator to invite you again.",
  "Questions? Reply to this email.",
  "If you weren't expecting this email, you can ignore it.",
];

const PARAGRAPHS = {
  client: [...CLIENT_EN, ...CLIENT_ZH],
  volunteer: VOLUNTEER_EN,
};

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

function parts(date, locale, options) {
  const found = {};
  for (const { type, value } of new Intl.DateTimeFormat(locale, { timeZone: "America/New_York", ...options }).formatToParts(date)) {
    found[type] = value;
  }
  return found;
}

function englishExpiry(date) {
  const p = parts(date, "en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
  return `${p.weekday}, ${p.month} ${p.day}, ${p.year} at ${p.hour}:${p.minute} ${p.dayPeriod} (New York time)`;
}

function chineseExpiry(date) {
  const p = parts(date, "zh-CN", {
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "2-digit", hourCycle: "h23",
  });
  return `纽约时间 ${p.year}年${p.month}月${p.day}日 ${p.hour.padStart(2, "0")}:${p.minute}`;
}

export function invitationEmail({ kind, siteUrl, expiresAt }) {
  const paragraphs = PARAGRAPHS[kind];
  if (!Object.hasOwn(SUBJECTS, kind)) throw new TypeError(`Unknown invitation kind: ${kind}`);
  if (typeof siteUrl !== "string" || !siteUrl.trim()) throw new TypeError("invitationEmail needs a siteUrl");
  const link = String(siteUrl).replace(/\/+$/, "");
  const en = englishExpiry(expiresAt);
  const zh = chineseExpiry(expiresAt);

  const fill = (template, values) =>
    template.replace(/\{(link|en|zh)\}/g, (_, key) => values[key]);

  const text = paragraphs.map((p) => fill(p, { link, en, zh })).join("\n\n");
  const safeLink = escapeHtml(link);
  const html = paragraphs
    .map((p) => `<p>${fill(escapeHtml(p), {
      link: `<a href="${safeLink}">${safeLink}</a>`,
      en: escapeHtml(en),
      zh: escapeHtml(zh),
    })}</p>`)
    .join("\n");

  return { subject: SUBJECTS[kind], text, html };
}
