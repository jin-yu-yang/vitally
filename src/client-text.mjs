// Every client-screen string (spec 2026-10-05 §1, §3): English and the drafted
// Simplified Chinese, for the group's wording review. Traditional comes from
// the generated map (npm run build:hant). Keys are "<area>.<name>".
import { fill, plural, isLang } from "./language.mjs";
import { toHant } from "./hant.mjs";

export const TEXT = Object.freeze({
  // The frame
  "frame.skip": { en: "Skip to content", zh: "跳到主要内容" },
  "frame.language": { en: "Language", zh: "语言" },
  // The browser tab's title (app.mjs after every render; the English is index.html's)
  "frame.title": { en: "ViTally · PCDC community tax help · 2025 tax year", zh: "ViTally · PCDC 社区报税协助 · 2025 报税年度" },
  // The client top bar (views.mjs clientHeader); 长者版 is the catalogue's name for the senior form
  "frame.home": { en: "ViTally home", zh: "ViTally 首页" },
  "frame.senior": { en: "Senior version", zh: "长者版" },
  "frame.help": { en: "Need help?", zh: "需要帮助？" },
  "frame.save_exit": { en: "Save & exit", zh: "保存并退出" },
  "frame.sign_out": { en: "Sign out", zh: "退出登录" },
  // The connection and problem banners (views.mjs)
  "frame.reconnecting": { en: "The connection dropped and is being retried. What you see may be out of date, and actions cannot be confirmed until it is back.", zh: "连接中断了，正在重试。您看到的内容可能不是最新的，连接恢复前无法确认任何操作。" },
  "frame.offline": { en: "No connection to the server. You can read this page, but nothing can be saved or sent until the connection returns.", zh: "无法连接到服务器。您可以阅读此页，但连接恢复前无法保存或发送任何内容。" },
  "frame.try_again": { en: "Try again", zh: "再试一次" },
  "frame.dismiss": { en: "Dismiss", zh: "关闭" },
  // The footer: PCDC's own Chinese name
  "footer.org": { en: "ViTally · Philadelphia Chinatown Development Corporation (PCDC)", zh: "ViTally · 费城华埠发展会（PCDC）" },
  "footer.note": { en: "Course prototype · Tax year 2025 · No real taxpayer data", zh: "课程原型 · 2025 报税年度 · 不含真实纳税人资料" },
  // The unreachable and no-access screens (views.mjs)
  "unreachable.overline": { en: "NO CONNECTION", zh: "无法连接" },
  "unreachable.title": { en: "ViTally cannot reach the server", zh: "ViTally 无法连接到服务器" },
  "unreachable.body": { en: "You are not signed out — this browser simply could not check. Nothing has been lost, and nothing was sent.", zh: "您并没有退出登录，只是这个浏览器暂时无法确认。没有丢失任何内容，也没有发送任何内容。" },
  "unreachable.note": { en: "This page also retries by itself when the connection returns or when you come back to this window.", zh: "连接恢复或您回到这个窗口时，此页也会自动重试。" },
  "no_access.overline": { en: "NOT ON THIS ROSTER", zh: "不在名单上" },
  "no_access.title": { en: "This account has no access", zh: "此账户无权使用" },
  "no_access.body": { en: "ViTally is a closed demo: an organiser adds each address before it can be used. Ask the person running this session to add yours, then sign in again.", zh: "ViTally 是封闭的演示：每个电子邮箱都要由组织者添加后才能使用。请联系本场演示的负责人添加您的电子邮箱，然后重新登录。" },
  // The client dialogs (views.mjs dialog): help, replacing the fictional answers, the reference card
  "dialog.overline": { en: "ViTally · HERE TO HELP", zh: "ViTally · 随时为您提供帮助" },
  "dialog.close": { en: "Close dialog", zh: "关闭对话框" },
  "help.title": { en: "A real person can help.", zh: "有专人可以帮助您。" },
  "help.body": { en: "Need help? Contact us:", zh: "如需帮助，请联系我们：" },
  "help.contact": { en: "Call or email the PCDC office", zh: "致电或发电子邮件给 PCDC 办公室" },
  "help.identity": { en: "Volunteers follow the site’s identity-check process before restoring access or changing contact details.", zh: "恢复访问权限或更改联系方式之前，志愿者会按本站的流程核实身份。" },
  "regenerate.title": { en: "Replace the fictional answers?", zh: "要替换虚构的回答吗？" },
  "regenerate.body": { en: "This replaces every answer in this form with a different fictional example, including answers you edited. Your email address, Application ID and current stage do not change.", zh: "这会用另一组虚构示例替换此表格中的所有回答，包括您修改过的回答。您的电子邮箱、申请编号和当前阶段都不会改变。" },
  "regenerate.note": { en: "Nothing is saved until you save the form, so you can still step back through the form and check it first.", zh: "在您保存表格之前，不会保存任何内容，所以您仍然可以先回头检查表格。" },
  "regenerate.confirm": { en: "Replace with another example", zh: "换成另一组示例" },
  "regenerate.keep": { en: "Keep my answers", zh: "保留我的回答" },
  "print.title": { en: "Your application reference card", zh: "您的申请编号卡" },
  "print.org": { en: "ViTally · PCDC Community Tax Assistance", zh: "ViTally · PCDC 社区报税协助" },
  "print.return": { en: "2025 tax year · Sign in with your email to return.", zh: "2025 报税年度 · 用您的电子邮箱登录即可返回。" },
  "print.note": { en: "This card holds no tax answers and no sign-in code.", zh: "此卡不含任何报税回答，也不含登录验证码。" },
  "print.button": { en: "Print this card", zh: "打印此卡" },
  // Application ID and client number (the capitals are the cards' small labels)
  "id.application": { en: "Application ID", zh: "申请编号" },
  "id.application_caps": { en: "APPLICATION ID", zh: "申请编号" },
  "id.client_number_caps": { en: "CLIENT NUMBER", zh: "客户编号" },
  // Sign-in: the resend countdown and button, patched in place by app.mjs
  "signin.countdown": { en: "You can request another code in {n} seconds.", zh: "{n} 秒后可以再索取一次验证码。" },
  "signin.resend_in": { en: "Resend code in {n}s", zh: "{n} 秒后可重新发送验证码" },
  "signin.resend": { en: "Resend code", zh: "重新发送验证码" },
  // Sign-in (client-views.mjs accessScreen): the email and code steps, troubleshooting and the footnote
  "signin.welcome": { en: "WELCOME TO VITALLY", zh: "欢迎使用 ViTally" },
  "signin.title": { en: "Sign in with your email", zh: "用电子邮箱登录" },
  "signin.intro": { en: "Use the email address the office approved for this demo. No password to remember.", zh: "请使用办公室为此演示批准的电子邮箱。无需记住密码。" },
  "signin.check_inbox": { en: "CHECK YOUR INBOX", zh: "请查看收件箱" },
  "signin.enter_code": { en: "Enter your code", zh: "请输入验证码" },
  "signin.email": { en: "Email address", zh: "电子邮箱" },
  "signin.email_placeholder": { en: "you@example.org", zh: "请输入电子邮箱" },
  "signin.email_note": { en: "We send a one-time code to this address. No password to remember, and no code is ever shown on this page.", zh: "我们会向这个电子邮箱发送一次性验证码。无需记住密码，此页面也绝不会显示验证码。" },
  "signin.send": { en: "Send verification code", zh: "发送验证码" },
  "signin.code": { en: "Verification code", zh: "验证码" },
  "signin.code_placeholder": { en: "6-digit code", zh: "6 位数字验证码" },
  // {email} is the address, already escaped and in <strong>
  "signin.as": { en: "Signing in as {email}. ", zh: "正在以 {email} 登录。" },
  "signin.code_note": { en: "This confirms you can read that inbox. A volunteer verifies taxpayer identity separately.", zh: "这一步只确认您能查看该邮箱。志愿者会另行核实纳税人身份。" },
  "signin.verify": { en: "Verify and continue", zh: "验证并继续" },
  "signin.didnt_receive": { en: "Didn’t receive it?", zh: "没有收到？" },
  "signin.other_email": { en: "Use a different email address", zh: "改用其他电子邮箱" },
  "signin.no_code": { en: "Didn’t get a code?", zh: "没有收到验证码？" },
  "signin.no_code_body": { en: "A code can take a minute to arrive. Check the junk or spam folder, make sure the address is the one the office approved for this demo, and request another code once the timer ends.", zh: "验证码可能要一分钟左右才会送达。请查看垃圾邮件文件夹，确认电子邮箱是办公室为此演示批准的那一个，并在倒计时结束后再索取一次验证码。" },
  "signin.still_stuck": { en: "Still stuck? Call or email the PCDC office.", zh: "仍有问题？请致电或发电子邮件给 PCDC 办公室。" },
  "signin.get_help": { en: "Get help from the office", zh: "向办公室求助" },
  "signin.footnote": { en: "ViTally is a fictional walkthrough of the PCDC community tax service for tax year 2025. Never enter real taxpayer information.", zh: "ViTally 是 PCDC 社区报税服务（2025 报税年度）的虚构演示。请勿输入任何真实的纳税人信息。" },
  // Toasts on client paths (app.mjs); staff-only toasts stay English
  "toast.saved": { en: "Your answers are saved.", zh: "您的回答已保存。" },
  "toast.back_online": { en: "You're back online.", zh: "已重新连接。" },
  "toast.confirm_first": { en: "Confirm that you have checked your answers first.", zh: "请先确认您已核对过您的回答。" },
  "toast.needs_change": { en: "Some answers still need a change before you can send.", zh: "有些回答需要修改后才能发送。" },
  "toast.sent": { en: "Your application was sent to the office.", zh: "您的申请已发送给办公室。" },
  "toast.document_sent": { en: "Your sample document was sent.", zh: "您的示例文件已发送。" },
  "toast.started": { en: "A new fictional application is ready.", zh: "新的虚构申请已准备好。" },
  "toast.id_copied": { en: "Application ID copied.", zh: "已复制申请编号。" },
  "toast.id_select": { en: "Select the ID on the card to copy it.", zh: "请选取卡片上的申请编号，再复制。" },
  "toast.sent_again": { en: "Sent again.", zh: "已重新发送。" },
  "toast.fictional_filled": { en: "Fictional details filled in. Nothing is saved yet.", zh: "已填入虚构资料，尚未保存。" },
  "toast.fictional_replaced": { en: "A different fictional example replaced the answers. Nothing is saved yet.", zh: "已用另一组虚构示例替换了回答，尚未保存。" },
  "toast.reconcile_mine": { en: "Your answers are kept. Save when you are ready.", zh: "已保留您的回答。准备好后请保存。" },
  "toast.reconcile_office": { en: "The office’s answers are loaded. Save when you are ready.", zh: "已载入办公室的回答。准备好后请保存。" },
  // Traditional Chinese loads on demand: the switch's failure, and a saved 繁體 that fell back at startup
  "toast.hant_failed": { en: "Traditional Chinese couldn't load. Try again.", zh: "无法载入繁体中文，请再试一次。" },
  "toast.hant_failed_start": { en: "Traditional Chinese couldn't load. Showing Simplified Chinese.", zh: "无法载入繁体中文，暂以简体中文显示。" },
  // The drafts (app.mjs viewDraft): the new tab's text, the fallback link and the failures; the tab's title is per form
  "draft.tab_title": { en: "Draft 13614-C", zh: "13614-C 草稿" },
  "draft.preparing": { en: "Preparing your draft…", zh: "正在准备您的草稿…" },
  "draft.link": { en: "Your draft is ready: open it", zh: "您的草稿已准备好：打开草稿" },
  "draft.failed": { en: "The draft could not be made. Close this tab and try again.", zh: "无法生成草稿。请关闭此标签页后再试一次。" },
  "draft.font_unchecked": { en: "The draft font could not be checked. Try again later.", zh: "无法核对草稿所用的字体。请稍后再试。" },
  // Counts
  "count.parts": { en: { one: "1 part still needs answers", other: "{n} parts still need answers" }, zh: "还有 {n} 个部分需要回答" },
  // The version-2 form (intake-form.mjs): the long-answer counter
  "count.long": { en: "{length} of {limit} characters", zh: "已输入 {length} / {limit} 个字" },
  // The version-2 form: number range hints
  "range.or_more": { en: "{min} or more", zh: "{min} 或以上" },
  "range.between": { en: "{min} to {max}", zh: "{min} 至 {max}" },
  // The version-2 form: date boxes (Chinese order 年 / 月 / 日; the hints stay YYYY, MM, DD)
  "date.year": { en: "Year", zh: "年" },
  "date.month": { en: "Month", zh: "月" },
  "date.day": { en: "Day", zh: "日" },
  "date.year_hint": { en: "YYYY", zh: "YYYY" },
  "date.month_hint": { en: "MM", zh: "MM" },
  "date.day_hint": { en: "DD", zh: "DD" },
  // The version-2 form: the note under a question and the answer checks built with numbers
  "note.needs_answer": { en: "Needs an answer", zh: "需要回答" },
  "invalid.too_long": { en: "Use at most {limit} characters.", zh: "最多 {limit} 个字。" },
  "invalid.number_range": { en: "Enter a number from {min} to {max}.", zh: "请输入 {min} 至 {max} 之间的数字。" },
  "invalid.year_range": { en: "Enter a year from {min} to {max}.", zh: "请输入 {min} 至 {max} 之间的年份。" },
  "invalid.unknown_field": { en: "Unknown field {field}.", zh: "未知字段 {field}。" },
  "invalid.member_field": { en: "{field}: {reason}", zh: "{field}：{reason}" },
  // The version-2 form: part statuses on the rail
  "status.needs": { en: "Needs answers", zh: "需要回答" },
  "status.docs": { en: "Needs documents", zh: "需要文件" },
  "status.done": { en: "Done", zh: "已完成" },
  // The version-2 form: the household cards
  "member.person": { en: "Person {n}", zh: "成员 {n}" },
  "member.remove": { en: "Remove", zh: "移除" },
  "member.remove_label": { en: "Remove person {n}", zh: "移除成员 {n}" },
  "member.add": { en: "Add a person", zh: "添加一位家庭成员" },
  // The version-2 form: a household member's read-only line (n picks one/other only)
  "member.born": { en: "born {date}", zh: "{date}出生" },
  "member.months": { en: { one: "lived with you {count} month", other: "lived with you {count} months" }, zh: "居住 {count} 个月" },
  // The version-2 form: the select's blank option and the separator between picked choices
  "form.select_option": { en: "Select an option", zh: "请选择" },
  "form.list_separator": { en: ", ", zh: "、" },
  // Stage labels and the client's status message (domain.mjs describeStage; the English is
  // STAGE_DESCRIPTIONS there, kept in step by tests/domain.test.mjs). The label is the
  // client's badge; the staff name lives in domain.mjs and stays English.
  "stage.draft.label": { en: "Draft", zh: "草稿" },
  "stage.draft.client": { en: "Your application is saved and has not been sent to the office yet.", zh: "您的申请已保存，尚未发送给办公室。" },
  "stage.received.label": { en: "Sent to PCDC", zh: "已发送给 PCDC" },
  "stage.received.client": { en: "Your application is with PCDC. The office will review it soon and may call you.", zh: "PCDC 已收到您的申请。办公室会尽快查看，并可能致电您。" },
  "stage.screening.label": { en: "Being reviewed", zh: "审核中" },
  "stage.screening.client": { en: "PCDC is reviewing your application. We may call you to confirm your information and documents.", zh: "PCDC 正在审核您的申请。我们可能会致电您，核对您的信息和文件。" },
  "stage.preparation_ready.label": { en: "Waiting for a volunteer", zh: "等待志愿者" },
  "stage.preparation_ready.client": { en: "Your application has been checked. It is waiting for a volunteer to start preparing your return.", zh: "您的申请已核对完毕，正在等待志愿者开始准备您的报税表。" },
  "stage.preparing.label": { en: "Being prepared", zh: "准备中" },
  "stage.preparing.client": { en: "A volunteer is preparing your return.", zh: "报税志愿者正在准备您的报税表。" },
  "stage.review_ready.label": { en: "Waiting for review", zh: "等待检查" },
  "stage.review_ready.client": { en: "Your return is prepared and is waiting for an independent reviewer.", zh: "您的报税表已准备好，正在等待审核志愿者检查。" },
  "stage.reviewing.label": { en: "Being checked", zh: "检查中" },
  "stage.reviewing.client": { en: "An independent reviewer is checking your return.", zh: "审核志愿者正在检查您的报税表。" },
  "stage.corrections_required.label": { en: "Being corrected", zh: "正在更正" },
  "stage.corrections_required.client": { en: "The reviewer asked your preparer to make corrections. No action is needed from you right now.", zh: "审核志愿者已请报税志愿者进行更正。您目前无需做任何事。" },
  "stage.review_approved.label": { en: "Ready to sign", zh: "等待签名" },
  "stage.review_approved.client": { en: "Your return has been checked. PCDC will contact you to sign it. Your return can't be filed until you sign.", zh: "您的报税表已检查完毕。PCDC 会联系您签署报税表。您签署后才能递交报税表。" },
  // Ready to exit, by how the client will sign Form 8879 (design D11; domain.mjs describeStage picks one by the case's signing plan)
  "stage.review_approved.client.appointment": { en: "Your return has been checked. Please come to PCDC on {when} to sign it. Your return can't be filed until you sign.", zh: "您的报税表已检查完毕。请于 {when} 到 PCDC 签署报税表。您签署后才能递交报税表。" },
  "stage.review_approved.client.same_day": { en: "Your return has been checked. Please sign it with a volunteer before you leave today. Your return can't be filed until you sign.", zh: "您的报税表已检查完毕。请在今天离开前与志愿者一起签署报税表。您签署后才能递交报税表。" },
  "stage.review_approved.client.portal": { en: "Your return has been checked. Please e-sign Form 8879 in the TaxSlayer Customer Portal. Your return can't be filed until you sign.", zh: "您的报税表已检查完毕。请在 TaxSlayer 客户门户（Customer Portal）以电子方式签署 8879 表。您签署后才能递交报税表。（门户为英文页面，可用浏览器翻译）" },
  "stage.review_approved.client.go_over_first": { en: "Your return has been checked. PCDC will contact you to go over your return together. After that, you will sign it. Your return can't be filed until you sign.", zh: "您的报税表已检查完毕。PCDC 会联系您，先和您一起查看报税表，再请您签署。您签署后才能递交报税表。" },
  "stage.ready_to_efile.label": { en: "Ready", zh: "已准备好" },
  "stage.ready_to_efile.client": { en: "Your return is ready. PCDC will take the next step.", zh: "您的报税表已准备好。PCDC 会进行下一步。" },
  "stage.efiled.label": { en: "E-filed", zh: "已电子递交" },
  "stage.efiled.client": { en: "Your return was e-filed. The IRS will confirm whether it is accepted.", zh: "您的报税表已电子递交。国税局会确认是否接受。" },
  // E-filed by filing method (domain.mjs describeStage): one return e-filed and the other on paper
  "stage.efiled.filed.label": { en: "Filed", zh: "已递交" },
  // Accepted with any return on paper: the client still has to mail it
  "stage.accepted.paper.label": { en: "Ready to mail", zh: "待邮寄" },
  "stage.rejected.label": { en: "Needs a correction", zh: "需要更正" },
  "stage.accepted.label": { en: "Complete", zh: "已完成" },
  // Ready to exit after Return to signing (replaces every signing variant)
  "stage.review_approved.client.resign": { en: "PCDC corrected your return. Please sign it again so PCDC can file it. PCDC will contact you to arrange this.", zh: "PCDC 已更正您的报税表。请再次签名，以便 PCDC 递交。PCDC 会联系您安排签名。" },
  // E-filed, Rejected and Accepted: one sentence per return by its state, the combined one when both are the same (domain.mjs filingMessage)
  "filing.federal.waiting": { en: "Your federal return was e-filed. The IRS will confirm whether it is accepted.", zh: "您的联邦报税表已电子递交。国税局会确认是否接受。" },
  "filing.federal.accepted": { en: "The IRS accepted your federal return.", zh: "国税局已接受您的联邦报税表。" },
  "filing.federal.rejected": { en: "Your federal return needs a correction before it can be accepted.", zh: "您的联邦报税表需要更正后才能被接受。" },
  "filing.federal.given_to_client": { en: "PCDC gave your federal return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it.", zh: "PCDC 已将您的联邦报税表纸本交给您或您委托的人。如果还没有签名，请先签名，然后自行邮寄。邮寄后可能需要约 3 个月才会有回复。" },
  "filing.state.waiting": { en: "Your Pennsylvania return was e-filed. Pennsylvania will confirm whether it is accepted.", zh: "您的宾州报税表已电子递交。宾州税务局会确认是否接受。" },
  "filing.state.accepted": { en: "Pennsylvania accepted your Pennsylvania return.", zh: "宾州税务局已接受您的宾州报税表。" },
  "filing.state.rejected": { en: "Your Pennsylvania return needs a correction before it can be accepted.", zh: "您的宾州报税表需要更正后才能被接受。" },
  "filing.state.given_to_client": { en: "PCDC gave your Pennsylvania return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it.", zh: "PCDC 已将您的宾州报税表纸本交给您或您委托的人。如果还没有签名，请先签名，然后自行邮寄。邮寄后可能需要约 3 个月才会有回复。" },
  "filing.both.waiting": { en: "Your federal and Pennsylvania returns were e-filed. The IRS and Pennsylvania will each confirm whether they are accepted.", zh: "您的联邦和宾州报税表已电子递交。国税局和宾州税务局会分别确认是否接受。" },
  "filing.both.accepted": { en: "The IRS and Pennsylvania accepted your returns.", zh: "国税局和宾州税务局都已接受您的报税表。" },
  "filing.both.rejected": { en: "Your federal and Pennsylvania returns need a correction before they can be accepted.", zh: "您的联邦和宾州报税表需要更正后才能被接受。" },
  "filing.both.given_to_client": { en: "PCDC gave your federal and Pennsylvania returns on paper to you or the person you sent. If they aren't signed yet, sign them, then mail them yourself. A reply can take about 3 months after you mail them.", zh: "PCDC 已将您的联邦和宾州报税表纸本交给您或您委托的人。如果还没有签名，请先签名，然后自行邮寄。邮寄后可能需要约 3 个月才会有回复。" },
  "filing.closing.rejected": { en: "PCDC will contact you about the correction.", zh: "PCDC 会就更正事宜联系您。" },
  "filing.closing.accepted": { en: "If you are due a refund, you can check on it with \"Where's My Refund?\" at irs.gov/refunds for your federal return, and with myPATH at mypath.pa.gov for your Pennsylvania return.", zh: "如果您有退税，可以在 irs.gov/refunds 使用 \"Where's My Refund?\" 查询联邦退税，在 mypath.pa.gov 使用 myPATH 查询宾州退税。（网站为英文页面，可用浏览器翻译）" },
  "stage.closed.label": { en: "Closed", zh: "已关闭" },
  "stage.closed.client": { en: "This application was closed by the office. This does not change any return filed elsewhere.", zh: "此申请已由办公室关闭。这不影响在其他地方递交的任何报税表。" },
  // Waiting for documents and Hold (change add-hold-and-closing); a Hold is told by where it came from (domain.mjs holdKind)
  "stage.awaiting_documents.label": { en: "Documents needed", zh: "需要文件" },
  "stage.awaiting_documents.client": { en: "PCDC needs more documents from you before your return can be prepared. See the requests below.", zh: "PCDC 需要您提供更多文件，才能准备您的报税表。请查看下方的文件请求。" },
  "stage.on_hold.label": { en: "Waiting for you", zh: "等待您的回复" },
  "stage.on_hold.client": { en: "PCDC has been trying to reach you about the documents we need. Please upload them below or contact PCDC.", zh: "PCDC 一直在设法联系您，询问所需的文件。请在下方上传，或联系 PCDC。" },
  "stage.on_hold.client.signing": { en: "PCDC has been trying to reach you to sign your return. Please contact PCDC. Your return can't be filed until you sign.", zh: "PCDC 一直在设法联系您签署报税表。请联系 PCDC。您签署后才能递交报税表。" },
  // Closed, by the reason it recorded (domain.mjs describeStage); 'other' and no reason use stage.closed.client
  "stage.closed.client.out_of_scope": { en: "This application was closed because the return is outside what VITA volunteers can prepare. Your return was not filed by PCDC.", zh: "此申请已关闭，因为该报税表超出了 VITA 志愿者可以准备的范围。PCDC 未递交您的报税表。" },
  "stage.closed.client.no_need_to_file": { en: "A PCDC volunteer confirmed with you that you don't need to file a return this year, so this application was closed.", zh: "PCDC 志愿者已与您确认，您今年无需递交报税表，因此此申请已关闭。" },
  "stage.closed.client.duplicate": { en: "This application was closed. Your return continues under your other application with PCDC.", zh: "此申请已关闭。您的报税表将在您在 PCDC 的另一份申请中继续处理。" },
  "stage.closed.client.dismissed": { en: "PCDC could not reach you, so this application was closed. Your return was not filed.", zh: "PCDC 无法联系到您，因此此申请已关闭。您的报税表未递交。" },
  "stage.closed.client.withdrawn": { en: "You withdrew this application. Your return was not filed.", zh: "您已撤回此申请。您的报税表未递交。" },
  "stage.unknown.label": { en: "Application", zh: "申请" },
  "stage.unknown.client": { en: "This application is with the office. Contact PCDC if you have questions.", zh: "此申请正在办公室处理。如有疑问，请联系 PCDC。" },
  // Days on lists (ui.mjs relativeDay); older dates use the language's own month and day
  "day.today": { en: "Today", zh: "今天" },
  "day.yesterday": { en: "Yesterday", zh: "昨天" },
  "day.ago": { en: "{n} days ago", zh: "{n} 天前" },
  // A case without a client number (ui.mjs clientNumberLabel)
  "client_number.none": { en: "No number yet", zh: "尚无客户编号" },
  "client_number.never": { en: "Never sent", zh: "从未发送" },
  // My applications (client-views.mjs applicationsScreen); the placeholder is the Application ID's format
  "apps.overline": { en: "YOUR APPLICATIONS", zh: "您的申请" },
  "apps.title": { en: "My applications", zh: "我的申请" },
  "apps.intro": { en: "Every application you started with this email address. You can keep more than one for testing.", zh: "这里列出您用这个电子邮箱开始的所有申请。测试时可以保留多份申请。" },
  "apps.lookup_placeholder": { en: "VT-XXXX-XXXX", zh: "VT-XXXX-XXXX" },
  "apps.find": { en: "Find", zh: "查找" },
  "apps.show_all": { en: "Show all", zh: "显示全部" },
  "apps.not_found": { en: "We could not find that Application ID", zh: "找不到这个申请编号" },
  "apps.not_found_body": { en: "Check the characters and try again. This search only covers applications started with the email address you signed in with.", zh: "请检查输入的字符后再试一次。此搜索只包括用您登录的电子邮箱开始的申请。" },
  "apps.empty": { en: "No applications yet", zh: "还没有申请" },
  "apps.loading": { en: "Loading your applications…", zh: "正在载入您的申请…" },
  "apps.unloaded": { en: "Your applications couldn't load.", zh: "无法载入您的申请。" },
  "apps.empty_body": { en: "Start one whenever you are ready. Nothing is sent to the office until you submit it.", zh: "准备好后随时可以开始。在您提交之前，不会向办公室发送任何内容。" },
  "apps.start": { en: "Start a new application", zh: "开始新的申请" },
  "apps.start_note": { en: "This creates one new fictional application. Reopening, refreshing or filling a form never creates another.", zh: "这会建立一份新的虚构申请。重新打开、刷新页面或填写表格都不会再建立另一份。" },
  "apps.updated": { en: "Updated {when}", zh: "更新于 {when}" },
  "apps.no_updates": { en: "No updates yet", zh: "尚无更新" },
  // The reference card (client-views.mjs referenceScreen)
  "ref.overline": { en: "YOU’RE READY TO BEGIN", zh: "可以开始了" },
  "ref.title_1": { en: "A small card.", zh: "一张小卡片。" },
  "ref.title_2": { en: "One less thing to remember.", zh: "少记一件事。" },
  "ref.intro_1": { en: "Keep your Application ID somewhere handy.", zh: "请把申请编号放在方便找到的地方。" },
  "ref.intro_2": { en: "You’ll use it whenever you come back.", zh: "每次回来时都会用到它。" },
  "ref.card_org": { en: "PCDC COMMUNITY TAX ASSISTANCE", zh: "PCDC 社区报税协助" },
  "ref.your_id": { en: "YOUR APPLICATION ID", zh: "您的申请编号" },
  "ref.tax_year": { en: "2025 tax year", zh: "2025 报税年度" },
  "ref.keep": { en: "Save this ID · Keep it private", zh: "请保存此编号 · 请勿告诉他人" },
  "ref.copy": { en: "Copy ID", zh: "复制编号" },
  "ref.print": { en: "Print reference card", zh: "打印编号卡" },
  "ref.continue": { en: "Continue to application", zh: "继续填写申请" },
  "ref.footnote": { en: "Signing in with your email is still how you return. Your ID card holds no tax information.", zh: "您仍需用电子邮箱登录才能回到这里。编号卡不含任何报税信息。" },
  // The save chip (client-views.mjs saveStatus)
  "save.saving": { en: "Saving…", zh: "正在保存…" },
  "save.checking": { en: { one: "{n} answer needs checking", other: "{n} answers need checking" }, zh: "有 {n} 个回答需要检查" },
  "save.saved": { en: "Saved", zh: "已保存" },
  "save.not_saved": { en: "Not saved.", zh: "未保存。" },
  "save.unsaved": { en: "Unsaved changes", zh: "有未保存的更改" },
  "save.up_to_date": { en: "Up to date", zh: "已是最新" },
  // The conflict panel's frame (version 2; the rows use the catalogue's wording)
  "conflict.title": { en: "Someone else changed this application", zh: "其他人修改了这份申请" },
  "conflict.body": { en: "Your edits are still here and nothing has been saved. The office now has version {server}; you started from version {base}. Choose which answers to keep.", zh: "您的修改仍在，尚未保存任何内容。办公室现在的是第 {server} 版，您是从第 {base} 版开始修改的。请选择要保留哪些回答。" },
  "conflict.question": { en: "Question", zh: "问题" },
  "conflict.yours": { en: "Your edits", zh: "您的修改" },
  "conflict.office": { en: "The office’s values", zh: "办公室的内容" },
  "conflict.keep_mine": { en: "Keep my edits", zh: "保留我的修改" },
  "conflict.use_office": { en: "Use the office’s values", zh: "使用办公室的内容" },
  "conflict.note": { en: "Whichever you choose stays unsaved until you save it, and the office’s copy decides who wins if it changes again.", zh: "无论选择哪一边，在您保存之前都不会保存。如果办公室的版本在您保存前再次改变，您需要重新选择。" },
  // The progress page (client-views.mjs progressScreen)
  "progress.overline": { en: "YOUR APPLICATION", zh: "您的申请" },
  "progress.hello": { en: "Hello, {name}.", zh: "{name}，您好。" },
  "progress.title": { en: "Your application", zh: "您的申请" },
  "progress.intro": { en: "A little clarity on where things stand.", zh: "看看您的申请目前进展到哪一步。" },
  "progress.your_progress": { en: "Your progress", zh: "您的进度" },
  "progress.step.intake": { en: "Intake", zh: "登记" },
  "progress.step.preparation": { en: "Preparation", zh: "准备" },
  "progress.step.review": { en: "Review", zh: "审核" },
  "progress.step.signing": { en: "Signing", zh: "签名" },
  "progress.step.filing": { en: "Filing", zh: "递交" },
  "progress.step.done": { en: "complete", zh: "已完成" },
  "progress.step.current": { en: "in progress", zh: "进行中" },
  "progress.step.waiting": { en: "not started", zh: "未开始" },
  "progress.all_set": { en: "You’re all set for now.", zh: "目前您无需做任何事。" },
  "progress.all_set_body": { en: "Your next action appears here if the office needs anything else.", zh: "如果办公室还需要什么，下一步会显示在这里。" },
  // A document request: the office's title and message are shown as typed; in Chinese these
  // two labels say whose words they are (spec §3.4). English shows no label, as before.
  "progress.action_needed": { en: "ACTION NEEDED", zh: "需要您处理" },
  "progress.request_title": { en: "Document needed", zh: "需要的文件" },
  "progress.request_message": { en: "Message from the office", zh: "办公室留言" },
  "progress.sample_note": { en: "One fictional sample document. Nothing is uploaded or stored.", zh: "一份虚构的示例文件。不会上传或存储任何内容。" },
  "progress.simulate_failure": { en: "Simulate an upload failure", zh: "模拟上传失败" },
  "progress.upload_failed": { en: "The sample upload failed. Your request is still open and nothing was sent. Try again.", zh: "示例文件上传失败。这项文件请求仍然有效，没有发送任何内容。请再试一次。" },
  "progress.send_sample": { en: "Send sample document", zh: "发送示例文件" },
  "progress.checks_first": { en: "A volunteer checks the document before preparation continues.", zh: "志愿者会先核对文件，然后再继续准备报税表。" },
  "progress.sent": { en: "What you sent", zh: "您发送的文件" },
  "progress.sent_waiting": { en: "Waiting for a volunteer to check it", zh: "等待志愿者核对" },
  "progress.review": { en: "Review progress", zh: "审核进度" },
  "progress.review_note": { en: "An independent reviewer always checks the work of the volunteer who prepared it. Notes between volunteers stay with the office.", zh: "审核志愿者一定会检查报税志愿者所做的工作。志愿者之间的备注只留在办公室。" },
  "progress.history": { en: "Application history", zh: "申请记录" },
  "progress.history_note": { en: "The latest, all in one place", zh: "最新动态，一目了然" },
  "progress.history_empty": { en: "Updates from the office appear here.", zh: "办公室的最新消息会显示在这里。" },
  "progress.glance": { en: "AT A GLANCE", zh: "概览" },
  "progress.details": { en: "Your service details", zh: "您的服务详情" },
  "progress.tax_year": { en: "Tax year", zh: "报税年度" },
  "progress.service": { en: "Service", zh: "服务方式" },
  "progress.language": { en: "Language", zh: "服务语言" },
  "progress.private": { en: "Your application is private to you and the site team.", zh: "只有您和本站团队可以查看您的申请。" },
  "progress.here": { en: "We’re here for you.", zh: "我们随时为您服务。" },
  "progress.questions": { en: "Questions about your application? Our volunteers can help.", zh: "对申请有疑问？我们的志愿者可以帮助您。" },
  "progress.contact": { en: "Contact the office", zh: "联系办公室" },
  "progress.back": { en: "Back to my applications", zh: "返回我的申请" },
  // Withdraw (change add-hold-and-closing): the button, its dialog, and the line from Ready to exit on
  "withdraw.button": { en: "Withdraw this application", zh: "撤回此申请" },
  "withdraw.title": { en: "Withdraw this application?", zh: "撤回此申请？" },
  "withdraw.body": { en: "If you withdraw, PCDC will close this application and your return will not be filed.", zh: "撤回后，PCDC 将关闭此申请，您的报税表将不会被递交。" },
  "withdraw.box": { en: "I want to withdraw this application. My return will not be filed.", zh: "我要撤回此申请。我的报税表将不会被递交。" },
  "withdraw.keep": { en: "Keep my application", zh: "保留我的申请" },
  "withdraw.contact": { en: "To withdraw now, contact PCDC.", zh: "如需撤回，请联系 PCDC。" },
  "toast.withdrawn": { en: "You withdrew your application.", zh: "您已撤回申请。" },
  // The application history: a request line keeps the office's title as typed (spec §3.3)
  "history.requested": { en: "A volunteer requested a document: {title}", zh: "志愿者请求了一份文件：{title}" },
  "history.requested_documents": { en: "PCDC asked for these documents: {titles}.", zh: "PCDC 请您提供以下文件：{titles}。" },
  // Document cards on the client's screens (intake-views.mjs docCard, bringList,
  // progressDocumentsV2); the office's card words (Add a case) stay English
  "doc.bring": { en: "Bring these to your visit", zh: "请携带以下文件" },
  "doc.print": { en: "Print", zh: "打印" },
  "doc.open": { en: "Open documents", zh: "尚未提供的文件" },
  "doc.open_note": { en: "The office still needs these. You can mark each one below.", zh: "办公室仍需要这些文件。您可以在下面逐一标记。" },
  "doc.maybe": { en: "Maybe needed", zh: "可能需要" },
  "doc.take_photo": { en: "Take a photo", zh: "拍照" },
  "doc.choose_file": { en: "Choose a file", zh: "选择文件" },
  "doc.note": { en: "Uploading arrives soon. For now, bring it or mark it below.", zh: "上传功能即将推出。目前请把文件带来，或在下面标记。" },
  "doc.later": { en: "I will send it later", zh: "我稍后再提供" },
  "doc.none": { en: "I don't have this", zh: "我没有这份文件" },
  "doc.mark_not_done": { en: "Mark as not done", zh: "标记为未完成" },
  "doc.status": { en: "Status: ", zh: "状态：" },
  "doc.status.not_done": { en: "Not done", zh: "未完成" },
  "doc.status.later": { en: "Later", zh: "稍后提供" },
  "doc.status.none": { en: "Don't have", zh: "没有" },
  // The version-2 intake's sidebar and rail (intake-views.mjs); "Step {n}: " is read before the step's name
  "intake.overline": { en: "YOUR APPLICATION", zh: "您的申请" },
  "intake.sidebar_1": { en: "A few steps.", zh: "只需几个步骤。" },
  "intake.sidebar_2": { en: "We’re here to help.", zh: "我们随时为您提供帮助。" },
  "intake.help_title": { en: "Prefer to talk it through?", zh: "想和志愿者直接沟通？" },
  "intake.help_body": { en: "Our volunteers can help at the PCDC office, or by phone.", zh: "我们的志愿者可以在 PCDC 办公室或通过电话为您提供帮助。" },
  "rail.nav": { en: "Form steps", zh: "表格步骤" },
  "rail.all_steps": { en: "All steps", zh: "所有步骤" },
  "rail.toggle": { en: "Show or hide the parts of {title}", zh: "显示或隐藏{title}的各个部分" },
  "rail.step": { en: "Step {n}: ", zh: "第 {n} 步：" },
  "rail.here": { en: "You are here", zh: "您在这里" },
  "rail.part": { en: "Part {n} of {total}", zh: "第 {n} 部分，共 {total} 部分" },
  // The version-2 intake's page header, the before.ready line and the actions
  "intake.step_overline": { en: "STEP {n} OF {total} · {name}", zh: "第 {n} 步，共 {total} 步 · {name}" },
  "intake.within": { en: "{n} of {total}", zh: "{n} / {total}" },
  "intake.will_bring": { en: "You will get a list of what to bring.", zh: "您会收到一份需要携带的文件清单。" },
  "intake.will_upload": { en: "You will upload them in the Documents step.", zh: "您稍后会在「上传文件」这一步上传。" },
  "intake.continue": { en: "Continue", zh: "继续" },
  "intake.back": { en: "Back", zh: "返回" },
  "intake.back_to_summary": { en: "Back to summary", zh: "返回申请摘要" },
  "intake.submit": { en: "Submit application", zh: "提交申请" },
  // The fictional-data tools above the form (client-views.mjs)
  "fiction.only": { en: "Fictional data only", zh: "仅限虚构资料" },
  "fiction.fill": { en: "Fill fictional details", zh: "填入虚构资料" },
  "fiction.another": { en: "Generate another example", zh: "生成另一组示例" },
  // The Documents step: the Maybe needed group's toggle
  "doc.maybe_count": { en: "Maybe needed ({n})", zh: "可能需要（{n}）" },
  // Review & submit: the check page (alerts block Submit, warnings don't)
  "review.intro": { en: "Please review your application and check it for accuracy and completeness before you submit it.", zh: "提交之前，请检查您的申请，确认内容准确、完整。" },
  "review.free": { en: "The IRS Volunteer Income Tax Assistance (VITA) program is completely free if you qualify. We will never ask you to pay.", zh: "如果您符合资格，IRS 志愿者报税协助（VITA）计划完全免费。我们绝不会要求您付费。" },
  "review.alerts_title": { en: "Alerts and warnings", zh: "问题和提醒" },
  "review.fix_first": { en: "Fix before you submit", zh: "提交前请先修正" },
  "review.can_submit": { en: "You can still submit", zh: "您仍然可以提交" },
  "review.upload_now": { en: "Upload now", zh: "现在上传" },
  "review.more_maybe": { en: { one: "{n} more document may be needed", other: "{n} more documents may be needed" }, zh: "还有 {n} 份文件可能需要提供" },
  "review.empty": { en: "We found no alerts or warnings in your application.", zh: "您的申请没有需要处理的问题或提醒。" },
  "review.continue_blocked": { en: "Fix the items above to continue.", zh: "请先修正上面的问题，然后继续。" },
  "sign.you": { en: "You", zh: "本人" },
  "sign.spouse": { en: "Your spouse", zh: "配偶" },
  "sign.late_spouse": { en: "Your late spouse", zh: "已故配偶" },
  "sign.name": { en: "Printed name", zh: "姓名" },
  "sign.dob": { en: "Date of birth", zh: "出生日期" },
  "sign.phone": { en: "Telephone number", zh: "电话号码" },
  "sign.email": { en: "Email address", zh: "电子邮箱" },
  "sign.none": { en: "Not given", zh: "未填写" },
  "consent.blocked": { en: "We need this consent to prepare your return. If you'd rather not give it, please call PCDC at 215-922-6156.", zh: "我们需要您的同意才能为您报税。如您不愿同意，请致电 PCDC：215-922-6156。" },
  "rail.locked": { en: "Locked", zh: "未解锁" },
  "alert.missing": { en: "Needs an answer", zh: "需要回答" },
  "alert.invalid": { en: "Needs a change", zh: "需要修改" },
  "alert.member": { en: "Person {n}: {field}", zh: "成员 {n}：{field}" },
  // Review & submit: the summary, its Change links and printed date, and the draft Form 14446 buttons
  // (the current language's form comes first; the others are named in the screen's script)
  "summary.change": { en: "Change", zh: "修改" },
  "summary.none": { en: "Nothing answered yet.", zh: "尚未回答任何问题。" },
  "summary.date": { en: "Date", zh: "日期" },
  // The summary page's intro (gate-review-and-redesign-summary, design D6): {change} is summary.change
  "summary.intro_all": { en: "Here is a summary of everything you told us in your application.", zh: "以下是您在申请中填写的全部信息。" },
  "summary.intro_change": { en: "Before you submit, make sure you have answered everything that applies to you. To change an answer, choose **{change}** next to that part, or choose that part in the list of steps.", zh: "提交之前，请确认所有适用于您的问题都已回答。如需修改，请点击相应部分旁边的“{change}”，或在步骤列表中选择该部分。" },
  "summary.intro_tools": { en: "With the buttons below, you can print this summary, or view and download a draft Form 14446 made from your answers.", zh: "您可以用下方的按钮打印这份汇总，或查看并下载根据您的回答生成的 14446 表草稿。" },
  "summary.expand_all": { en: "Expand all", zh: "全部展开" },
  "summary.collapse_all": { en: "Collapse all", zh: "全部收起" },
  "summary.toggle": { en: "Show or hide {section}", zh: "显示或隐藏{section}" },
  "draft14446.view": { en: "View Draft Form 14446", zh: "查看 14446 表草稿" },
  "draft14446.tab_title": { en: "Draft Form 14446", zh: "14446 表草稿" },
  "draft.form_en": { en: "English version", zh: "英文版" },
  "draft.form_zh_t": { en: "繁體中文版", zh: "繁体中文版" },
  // The draft 13614-C's generated lines in Additional Comments (draft-form.mjs), in the form's
  // language; the English is today's, byte for byte. The member lines also use member.person,
  // member.born and member.months, and the Not sure list form.list_separator.
  "draft.not_sure": { en: "Not sure: {items}", zh: "不确定：{items}" },
  "draft.not_sure_person": { en: "{person} {field}", zh: "{person}：{field}" },
  "draft.other_income": { en: "Other income: {text}", zh: "其他收入：{text}" },
  "draft.other_event": { en: "Other event: {text}", zh: "其他事项：{text}" },
  "draft.member_line": { en: "{person}: {parts}", zh: "{person}：{parts}" },
  "draft.member_answer": { en: "{field}: {answer}", zh: "{field}：{answer}" },
  "draft.married": { en: "married", zh: "已婚" },
  "draft.single": { en: "single", zh: "未婚" },
  "draft.citizen": { en: "citizen", zh: "美国公民" },
  "draft.resident": { en: "U.S./Canada/Mexico resident", zh: "美加墨居民" },
  "draft.student": { en: "student", zh: "全日制学生" },
  "draft.disabled": { en: "totally and permanently disabled", zh: "完全且永久性残疾" },
  "draft.ippin": { en: "IP PIN", zh: "身份保护码（IP PIN）" },
  "draft.yes": { en: "yes", zh: "是" },
  "draft.no": { en: "no", zh: "否" },
  "draft.not_sure_word": { en: "not sure", zh: "不确定" },
  // The PDF's own lines (draft-pdf.mjs), in the form's language: the heading of a page the
  // comments continue on, the box's last line when they do, and the notice for unprintable characters
  "draft.continued_title": { en: "Additional comments (continued)", zh: "补充说明（续）" },
  "draft.continued_on": { en: "(continued on page {page})", zh: "（续见第 {page} 页）" },
  "draft.notice": { en: "Some characters could not be printed. The online answers have them in full.", zh: "部分字符无法打印。网上填写的回答中有完整内容。" },
  // Review & submit: the confirmation
  "submit.confirm": { en: "I have checked my answers", zh: "我已核对过我的回答" },
  "submit.note": { en: "This confirms your answers. It is not a signature on a tax form.", zh: "这只是确认您的回答，并不是在报税表上签名。" },
  // The submitted page (intake-views.mjs submittedV2)
  "submitted.title": { en: "Your answers are with the office", zh: "办公室已收到您的回答" },
  "submitted.note": { en: "A volunteer makes corrections after submission, so these answers are read-only here.", zh: "提交后由志愿者负责更正，所以这里的回答只能查看，不能修改。" },
  "submitted.progress": { en: "See your progress", zh: "查看进度" },
});

// Sentences that arrive in English (spec §3.2, §3.3): errors, sign-in, history.
//
// Only sentences a client can be shown need an entry; staff screens are
// English. case-actions.mjs builds some refusals from a label ("${label} is
// required.", "Choose what happened on the call.") for staff-only actions;
// those stay English (plan 4d Task 6). The client's own actions, SUBMIT and
// RESPOND_DOCUMENT, refuse only with the fixed sentences below.
// 035's mailed sentences, frozen: filing_line wrote them before 037 renamed the
// paper result to given_to_client, and those history rows keep their words.
const LEGACY_MAILED = Object.freeze({
  federal: { en: "Your federal return was mailed. A reply to a mailed return can take several weeks.", zh: "您的联邦报税表已邮寄。邮寄的报税表可能需要几周才会有回复。" },
  state: { en: "Your Pennsylvania return was mailed. A reply to a mailed return can take several weeks.", zh: "您的宾州报税表已邮寄。邮寄的报税表可能需要几周才会有回复。" },
  both: { en: "Your federal and Pennsylvania returns were mailed. A reply to a mailed return can take several weeks.", zh: "您的联邦和宾州报税表已邮寄。邮寄的报税表可能需要几周才会有回复。" },
});

export const SENTENCES = Object.freeze({
  // errors.mjs: one sentence per code (SAFE_MESSAGES)
  "You do not have access to this step.": "您无权进行这一步。",
  "This application is no longer available.": "这份申请已无法查看。",
  "Someone else updated this application. Refresh and try again.": "其他人更新了这份申请。请刷新后再试一次。",
  "This step is not available right now.": "目前无法进行这一步。",
  "A different volunteer has to review this application.": "这份申请必须由另一位志愿者审核。",
  "This volunteer is not qualified for this step.": "这位志愿者不具备进行这一步的资格。",
  "Please check the information and try again.": "请检查信息后再试一次。",
  "Network error. Please try again later.": "网络连接失败，请稍后再试。",
  "Something went wrong. Please try again.": "出了点问题。请再试一次。",
  // case-actions.mjs: the client's Withdraw refuses without its box ticked (draft translation, for the group's wording review)
  "Tick the box to withdraw this application.": "请勾选方框以撤回此申请。", // 036
  // app.mjs: a refused action with no message of its own; the save chip's default
  "Something went wrong.": "出了点问题。",
  "Please try again.": "请再试一次。",
  // app.mjs viewDraft: the banner's words for a draft that couldn't be built
  "The draft could not be made. Try again.": "无法生成草稿。请再试一次。",
  "The draft font could not be checked. Try again later.": "无法核对草稿所用的字体。请稍后再试。",
  // auth.mjs: sign-in (also saved in the window's sign-in record)
  "If this address is eligible, check your inbox for a sign-in code.": "如果这个电子邮箱符合资格，请查看收件箱中的登录验证码。",
  "Enter an email address, for example name@example.org.": "请输入电子邮箱，例如 name@example.org。",
  "That code is invalid or has expired. Request a new code.": "验证码无效或已过期。请索取新的验证码。",
  "Sign-in could not be completed. Please try again.": "无法完成登录。请再试一次。",
  // controller.mjs: the sign-in fallback when an error carries no message
  "Sign-in could not be completed.": "无法完成登录。",
  // controller.mjs: the conflict messages a client sees
  "Someone else changed this application. The newest version is shown — check it and try again.": "其他人修改了这份申请。现在显示的是最新版本，请检查后再试一次。",
  "Someone else changed this application while you were editing. Choose which answers to keep.": "您编辑期间，其他人修改了这份申请。请选择要保留哪些回答。",
  // controller.mjs: controllerError sentences (several are staff-only; they cost nothing)
  "Only a volunteer can start an assisted application.": "只有志愿者才能开始协助申请。",
  "Open an application first.": "请先打开一份申请。",
  "This application changed again. Check the newest values and choose once more.": "这份申请又有了变化。请查看最新内容后再选择一次。",
  "This step is not available.": "无法进行这一步。",
  "This request is no longer on screen.": "这项请求已不在页面上。",
  // The application history: every client_events sentence the migrations write (spec §3.3);
  // the request line ("A volunteer requested a document: …") is historyLine's
  "Application received. A volunteer will check your information and documents.": "已收到申请。志愿者会核对您的信息和文件。",
  "Simulated intake checks are recorded. Your application is waiting for a volunteer to start preparation.": "模拟的登记核查已记录。您的申请正在等待志愿者开始准备报税表。",
  // Migration 034: the real screening checks replace the simulated line above (kept for old rows).
  "PCDC finished screening your application. A volunteer will start preparing your return next.": "PCDC 已完成对您申请的审核。接下来会有志愿者开始准备您的报税表。",
  "A volunteer has started preparing your return.": "志愿者已开始准备您的报税表。",
  "Your document was received and is waiting for a volunteer to verify it.": "已收到您的文件，正在等待志愿者核实。",
  "A sample document was recorded by staff and is awaiting verification.": "工作人员已登记一份示例文件，正在等待核实。",
  "A volunteer verified your document. No further action is needed for this request.": "志愿者已核实您的文件。这项请求您无需再做任何事。",
  "Your application was closed by the office. This does not change any return filed elsewhere. Contact PCDC if you have questions.": "您的申请已由办公室关闭。这不影响在其他地方递交的任何报税表。如有疑问，请联系 PCDC。",
  "Your volunteer recorded that preparation is complete in the tax software. An independent reviewer will check it next.": "报税志愿者已记录：报税软件中的准备工作已完成。接下来由审核志愿者检查。",
  "An independent reviewer is checking your return.": "审核志愿者正在检查您的报税表。",
  "The reviewer asked your preparer to make corrections. No action is needed from you right now.": "审核志愿者已请报税志愿者进行更正。您目前无需做任何事。",
  "Your volunteer recorded the requested corrections in the tax software. An independent reviewer will check the updated return.": "报税志愿者已在报税软件中完成所要求的更正。审核志愿者会检查更新后的报税表。",
  // History rows written before migration 021 keep the old sentence.
  "Independent review is complete. A volunteer will contact you about next steps. Signing and filing are later milestones and are not done yet.": "审核志愿者已检查完您的报税表，很快会有志愿者联系您办理签名和递交。",
  "Your return has been checked by the reviewer. A volunteer will contact you soon to sign and file.": "审核志愿者已检查完您的报税表，很快会有志愿者联系您办理签名和递交。",
  "A volunteer spoke with you about the next service step.": "志愿者已与您沟通下一步的服务。",
  // Migration 032: the main chain's new stages.
  "PCDC started reviewing your application. We may call you.": "PCDC 已开始审核您的申请。我们可能会致电您。",
  "PCDC recorded that you signed Form 8879. Your return is ready to e-file.": "PCDC 已记录您签署了 8879 表。您的报税表可以电子递交了。", // 032, kept for stored rows
  "PCDC e-filed your return.": "PCDC 已电子递交您的报税表。",
  "PCDC is working on your application again.": "PCDC 已继续处理您的申请。", // 036
  "PCDC is trying to reach you.": "PCDC 正在设法联系您。", // 036
  "This application was closed because the return is outside what VITA volunteers can prepare. Your return was not filed by PCDC.": "此申请已关闭，因为该报税表超出了 VITA 志愿者可以准备的范围。PCDC 未递交您的报税表。", // 036
  "A PCDC volunteer confirmed with you that you don't need to file a return this year, so this application was closed.": "PCDC 志愿者已与您确认，您今年无需递交报税表，因此此申请已关闭。", // 036
  "This application was closed. Your return continues under your other application with PCDC.": "此申请已关闭。您的报税表将在您在 PCDC 的另一份申请中继续处理。", // 036
  "PCDC could not reach you, so this application was closed. Your return was not filed.": "PCDC 无法联系到您，因此此申请已关闭。您的报税表未递交。", // 036
  "You withdrew this application. Your return was not filed.": "您已撤回此申请。您的报税表未递交。", // 036
  "You withdrew your application. Your return was not filed.": "您已撤回申请。您的报税表未递交。", // 036
  // Migration 035: Return to signing, Mark e-filed, and Record filing result.
  "PCDC corrected your return. You need to sign it again.": "PCDC 已更正您的报税表，您需要再次签名。",
  "PCDC e-filed your federal return and mailed your Pennsylvania return.": "PCDC 已电子递交您的联邦报税表，并邮寄了您的宾州报税表。",
  "PCDC mailed your returns.": "PCDC 已邮寄您的报税表。",
  "PCDC e-filed your federal return.": "PCDC 已电子递交您的联邦报税表。",
  "PCDC mailed your federal return.": "PCDC 已邮寄您的联邦报税表。",
  "PCDC e-filed your Pennsylvania return.": "PCDC 已电子递交您的宾州报税表。",
  "PCDC mailed your Pennsylvania return.": "PCDC 已邮寄您的宾州报税表。",
  // Migration 037: Mark ready to e-file no longer claims a signature, and a paper return is given to the client.
  "PCDC recorded that your return is ready. PCDC will take the next step.": "PCDC 已记录您的报税表已准备好。PCDC 会进行下一步。",
  "PCDC e-filed your federal return and gave your Pennsylvania return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it.": "PCDC 已电子递交您的联邦报税表，并将您的宾州报税表纸本交给您或您委托的人。如果还没有签名，请先签名，然后自行邮寄。邮寄后可能需要约 3 个月才会有回复。",
  "PCDC gave your federal return on paper to you or the person you sent, and e-filed your Pennsylvania return. If the federal return isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it.": "PCDC 已将您的联邦报税表纸本交给您或您委托的人，并电子递交了您的宾州报税表。如果联邦报税表还没有签名，请先签名，然后自行邮寄。邮寄后可能需要约 3 个月才会有回复。",
  "PCDC gave your returns on paper to you or the person you sent. If they aren't signed yet, sign them, then mail them yourself. A reply can take about 3 months after you mail them.": "PCDC 已将您的报税表纸本交给您或您委托的人。如果还没有签名，请先签名，然后自行邮寄。邮寄后可能需要约 3 个月才会有回复。",
  // Record filing result and a second filing: every combination filing_line and efiled_line can write
  ...filingLines(),
  // The version-2 form: checkValue's fixed messages (intake-catalogue.mjs), shown in the note
  "Enter a valid email address.": "请输入有效的电子邮箱。",
  "Enter a 10-digit phone number.": "请输入 10 位数字的电话号码。",
  "Enter a 5-digit ZIP code.": "请输入 5 位数字的邮编。",
  "Enter a real date as YYYY-MM-DD.": "请输入有效的日期，格式为 YYYY-MM-DD。",
  "Enter a 4-digit year.": "请输入 4 位数字的年份。",
  "Digits only.": "只能输入数字。",
  "At most 6 digits.": "最多 6 位数字。",
  "Not one of the choices.": "请从给出的选项中选择。",
  "Choose yes or no.": "请选择\"是\"或\"否\"。",
  "Expected a list of choices.": "请从选项中选择。",
  "No duplicates.": "选项不能重复。",
  "\"No one\" can't be combined.": "\"均无\"不能与其他选项同时选择。",
  "Expected text.": "请输入文字。",
  "Not a valid id.": "编号无效。",
  "Unknown question type.": "未知的问题类型。",
  // The version-2 form: checkGroup's messages (the household)
  "Expected a list.": "应为成员列表。",
  "At most 10 people.": "最多 10 位成员。",
  "Each person must be an object.": "成员资料格式不正确。",
  "Each person needs an id.": "每位成员都需要编号。",
  "Two people share an id.": "两位成员的编号相同。",
});

// An unknown language is English; null params mean none.
export function t(key, params = {}, lang = "en") {
  const entry = TEXT[key];
  if (!entry) throw new Error(`Unknown text key: ${key}`);
  const given = params ?? {};
  if (!isLang(lang) || lang === "en") return fill(plural(entry.en, given), given);
  const zh = lang === "zh-Hant" ? toHant(entry.zh) : entry.zh;
  return fill(zh, given);
}

// What the client reads about their returns: one sentence for each, federal
// first, or the combined sentence when both are in the same state. A null state
// leaves that return out. Chinese sentences run together without a space.
export function filingSentences(federal, state, lang = "en") {
  const parts =
    federal === state
      ? federal ? [t(`filing.both.${federal}`, {}, lang)] : []
      : [federal && t(`filing.federal.${federal}`, {}, lang), state && t(`filing.state.${state}`, {}, lang)];
  return parts.filter(Boolean).join(!isLang(lang) || lang === "en" ? " " : "");
}

// Every history line filing_line can write (035's mailed ones included), English to 简体.
function filingLines() {
  const lines = {};
  const states = [null, "waiting", "accepted", "rejected", "given_to_client"];
  for (const federal of states)
    for (const state of states)
      if (federal || state) lines[filingSentences(federal, state)] = filingSentences(federal, state, "zh-Hans");
  // The same pairs with 035's mailed sentence standing for given_to_client.
  const legacy = (kind, state) => (state === "given_to_client" ? LEGACY_MAILED[kind] : null);
  const sentenceOf = (kind, state, lang) =>
    legacy(kind, state)?.[lang] ?? t(`filing.${kind}.${state}`, {}, lang === "zh" ? "zh-Hans" : "en");
  const mailed = [...states.slice(1)];
  for (const federal of [null, ...mailed])
    for (const state of [null, ...mailed]) {
      if (!federal && !state) continue;
      if (federal !== "given_to_client" && state !== "given_to_client") continue;
      const both = federal === state;
      const parts = (lang) =>
        (both
          ? [sentenceOf("both", federal, lang)]
          : [federal && sentenceOf("federal", federal, lang), state && sentenceOf("state", state, lang)]
        ).filter(Boolean).join(lang === "en" ? " " : "");
      lines[parts("en")] = parts("zh");
    }
  return lines;
}

export function sentence(text, lang = "en") {
  if (typeof text !== "string") return "";
  if (!isLang(lang) || lang === "en" || !Object.hasOwn(SENTENCES, text)) return text;
  return lang === "zh-Hant" ? toHant(SENTENCES[text]) : SENTENCES[text];
}

// One line of the application history (spec §3.3). The request line's English
// prefix is replaced and the office's title kept as typed; every other line is
// a sentence, and an unknown one stays English.
const REQUEST_PREFIX = "A volunteer requested a document: ";
// Migration 036: the office's request at intake. The titles are typed by the
// office, so the rest of the line (minus its final ".") fills {titles}.
const DOCUMENTS_PREFIX = "PCDC asked for these documents: ";
export function historyLine(message, lang = "en") {
  if (typeof message !== "string") return "";
  if (message.startsWith(DOCUMENTS_PREFIX)) {
    if (!isLang(lang) || lang === "en") return message;
    const rest = message.slice(DOCUMENTS_PREFIX.length);
    return t("history.requested_documents", { titles: rest.endsWith(".") ? rest.slice(0, -1) : rest }, lang);
  }
  if (!message.startsWith(REQUEST_PREFIX)) return sentence(message, lang);
  if (!isLang(lang) || lang === "en") return message;
  return t("history.requested", { title: message.slice(REQUEST_PREFIX.length) }, lang);
}
