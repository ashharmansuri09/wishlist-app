// Email bhejne ka ek hi function: sendMail({ to, subject, html, text, headers }).
// Baaki poora code isi ko bulata hai, isliye provider badalna ho to sirf is file me badlav hota hai.
//
// Provider .env ke MAIL_PROVIDER se chunte hain:
//   brevo  (default) -> free me 300 mail/din, kisi bhi customer ko mail ja sakti hai, bas sender email verify karna padta hai
//   resend           -> free plan me domain verify kiye bina sirf apne email par mail jaati hai
//
// MAIL_FROM dono me same format me: Store Name <you@example.com>

// "Store Name <you@example.com>" -> { name: "Store Name", email: "you@example.com" }
function parseFrom(value) {
  const m = /^\s*(.*?)\s*<([^<>]+)>\s*$/.exec(String(value || ""));
  if (m) return { name: m[1].replace(/^"|"$/g, ""), email: m[2].trim() };
  return { name: "", email: String(value || "").trim() };
}

async function failIfBad(res, label) {
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  throw new Error(`${label} ${res.status}: ${body.slice(0, 200)}`);
}

// ---------- Brevo ----------
async function sendWithBrevo({ to, subject, html, text, headers }) {
  const apiKey = process.env.BREVO_API_KEY;
  const from = parseFrom(process.env.MAIL_FROM);
  if (!apiKey || !from.email) throw new Error("BREVO_API_KEY ya MAIL_FROM set nahi hai");

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      sender: from.name ? { name: from.name, email: from.email } : { email: from.email },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
      headers, // List-Unsubscribe etc.
    }),
  });
  await failIfBad(res, "brevo_mail_failed");
}

// ---------- Resend ----------
async function sendWithResend({ to, subject, html, text, headers }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!apiKey || !from) throw new Error("RESEND_API_KEY ya MAIL_FROM set nahi hai");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html, text, headers }),
  });
  await failIfBad(res, "resend_mail_failed");
}

async function sendMail(message) {
  const provider = (process.env.MAIL_PROVIDER || "brevo").toLowerCase();
  if (provider === "brevo") return sendWithBrevo(message);
  if (provider === "resend") return sendWithResend(message);
  throw new Error(`Unknown MAIL_PROVIDER: ${provider}`);
}

module.exports = { sendMail, parseFrom };
