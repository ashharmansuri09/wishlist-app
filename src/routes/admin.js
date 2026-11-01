// Debug aur manual tools. Browser me kholkar dekh sakte ho ki pipeline me kahan gadbad hai.
//
//   /admin/diagnose?key=SECRET                    -> env, database, Shopify Admin API aur scopes ka check
//   /admin/diagnose?key=SECRET&testMail=a@b.com   -> Brevo se ek test mail bhi
//   /admin/process?key=SECRET                     -> pending alerts ko abhi check karo (webhook ka intezaar kiye bina)
//
// Ye routes tabhi chalte hain jab Vercel me CRON_SECRET set ho. Kaam khatam hone par CRON_SECRET hata do, routes band ho jaate hain.
const express = require("express");
const crypto = require("crypto");
const alertStore = require("../services/alertStore");
const { processProduct } = require("../services/restockService");
const { adminGraphql, API_VERSION } = require("../lib/shopifyAdmin");
const { sendMail } = require("../lib/mailer");
const { cleanEmail } = require("./alerts");

const router = express.Router();

// Secret ya header (Authorization: Bearer ...) ya ?key=... se aata hai
function isAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = (req.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const given = Buffer.from(String(req.query.key || bearer));
  const expected = Buffer.from(secret);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  // Secret set hi nahi hai to route exist hi nahi karta (404). Galat key par 401.
  if (!process.env.CRON_SECRET) return res.status(404).json({ ok: false, error: "not_found" });
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  next();
});

// Sirf haan/naa batate hain, kisi key ki value kabhi nahi dikhate
const ENV_NAMES = [
  "SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SUPABASE_URL", "SUPABASE_SECRET_KEY",
  "BREVO_API_KEY", "MAIL_FROM", "STORE_NAME",
];

const DIAG_QUERY = `query { shop { name } currentAppInstallation { accessScopes { handle } } }`;

router.get("/diagnose", async (req, res) => {
  const out = { ok: true, apiVersion: API_VERSION, mailProvider: process.env.MAIL_PROVIDER || "brevo" };

  out.env = Object.fromEntries(ENV_NAMES.map((n) => [n, Boolean(process.env[n])]));

  // 1) Database + pending alerts
  let pending = [];
  try {
    pending = await alertStore.pendingProducts();
    out.database = { ok: true, pendingProducts: pending };
  } catch (err) {
    out.database = { ok: false, error: err.message };
  }

  // 2) Shopify Admin API: token milta hai? scopes grant hue?
  const shop = String(req.query.shop || (pending[0] && pending[0].shop) || "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    out.shopifyAdmin = { ok: false, error: "shop nahi mila. ?shop=your-store.myshopify.com jodo" };
  } else {
    try {
      const data = await adminGraphql(shop, DIAG_QUERY);
      const scopes = data.currentAppInstallation.accessScopes.map((s) => s.handle);
      out.shopifyAdmin = {
        ok: true,
        shop,
        shopName: data.shop.name,
        scopes,
        // Zaroori scopes mile ya nahi
        missingScopes: ["read_products", "read_inventory"].filter((s) => !scopes.includes(s)),
      };
    } catch (err) {
      out.shopifyAdmin = { ok: false, shop, error: err.message };
    }
  }

  // 3) Optional: test mail
  if (req.query.testMail) {
    const to = cleanEmail(req.query.testMail);
    if (!to) {
      out.mail = { ok: false, error: "testMail ka email galat hai" };
    } else {
      try {
        await sendMail({
          to,
          subject: "Wishlist app: test mail",
          html: "<p>Agar ye mail mili to Brevo sahi se kaam kar raha hai.</p>",
          text: "Agar ye mail mili to Brevo sahi se kaam kar raha hai.",
        });
        out.mail = { ok: true, sentTo: to };
      } catch (err) {
        out.mail = { ok: false, error: err.message };
      }
    }
  }

  out.ok = Boolean(out.database.ok && out.shopifyAdmin.ok && (!out.mail || out.mail.ok));
  res.json(out);
});

// Sab pending products ko abhi process karo. Webhook jaisa hi kaam, bas haath se chalta hai.
router.get("/process", async (req, res) => {
  try {
    const products = (await alertStore.pendingProducts()).slice(0, 20);
    const results = [];
    for (const p of products) {
      try {
        results.push({ ...p, result: await processProduct(p.shop, `gid://shopify/Product/${p.productId}`) });
      } catch (err) {
        // Asli error yahin dikh jaata hai (token, scope, GraphQL, mail)
        results.push({ ...p, error: err.message });
      }
    }
    res.json({ ok: true, checked: products.length, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
