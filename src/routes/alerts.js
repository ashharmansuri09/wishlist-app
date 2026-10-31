// App Proxy routes: "Notify me" form aur unsubscribe link
// (signature check index.js me ho chuka hota hai, yahan sirf logic hai)
const express = require("express");
const alertStore = require("../services/alertStore");
const { esc } = require("../lib/emailTemplate");

const router = express.Router();

const ID_RE = /^\d{1,20}$/;
const HANDLE_RE = /^[^\s/?#]{1,255}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Email saaf karke lowercase me. Galat ho to null.
function cleanEmail(raw) {
  const email = String(raw ?? "").trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

// POST /apps/wishlist/notify
// body: { product_id, product_handle, variant_id, email, website }
router.post("/notify", async (req, res) => {
  try {
    const body = req.body || {};

    // Honeypot: ye field insaan ko dikhta nahi. Bot bharta hai. Bhara ho to chup-chaap "OK" bol do.
    if (body.website) return res.json({ ok: true });

    const email = cleanEmail(body.email);
    if (!email) return res.status(400).json({ ok: false, error: "invalid_email" });

    const productId = String(body.product_id ?? "");
    const productHandle = String(body.product_handle ?? "");
    const variantId = String(body.variant_id ?? "");
    if (!ID_RE.test(productId) || !HANDLE_RE.test(productHandle) || !ID_RE.test(variantId)) {
      return res.status(400).json({ ok: false, error: "invalid_product" });
    }

    if ((await alertStore.countPendingForEmail(req.shop, email)) >= alertStore.MAX_PENDING_PER_EMAIL) {
      return res.status(400).json({ ok: false, error: "limit_reached" });
    }

    await alertStore.createAlert({
      shop: req.shop,
      productId,
      productHandle,
      variantId,
      email,
      customerId: /^\d+$/.test(req.customerId) ? req.customerId : null,
      source: "notify_me",
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("notify error:", err);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

// GET /apps/wishlist/unsubscribe?token=...   (email ke link se khulta hai)
router.get("/unsubscribe", async (req, res) => {
  const token = String(req.query.token || "");
  const page = (title, message, status = 200) =>
    res.status(status).type("html").send(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>` +
      `<body style="font-family:Arial,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;text-align:center;color:#222">` +
      `<h1 style="font-size:22px">${esc(title)}</h1><p style="color:#555">${esc(message)}</p></body></html>`
    );

  // uuid na ho to database ko pooche bina hi rok do
  if (!UUID_RE.test(token)) return page("Invalid link", "This unsubscribe link is not valid.", 400);

  try {
    await alertStore.unsubscribeByToken(req.shop, token);
    // Token mile ya na mile, same jawab: bahar waale ko pata nahi chalta ki token sahi tha ya nahi
    return page("You are unsubscribed", "You will no longer receive back-in-stock emails from this store.");
  } catch (err) {
    console.error("unsubscribe error:", err);
    return page("Something went wrong", "Please try again in a moment.", 500);
  }
});

module.exports = { router, cleanEmail };
