// Wishlist ke App Proxy routes.
// Signature check aur Cache-Control index.js me common router par lagta hai, yahan sirf logic hai.
const express = require("express");
const { requireCustomer } = require("../middleware/verifyProxy");
const store = require("../services/wishlistStore");
const alertStore = require("../services/alertStore");
const { cleanEmail } = require("./alerts");

const router = express.Router();

const ID_RE = /^\d{1,20}$/;
const HANDLE_RE = /^[^\s/?#]{1,255}$/;

// Client se aaya data kabhi trust nahi karte, har item saaf karte hain.
// out_of_stock = browser batata hai ki product abhi out of stock hai (Liquid ke product.available se).
// Ye sirf is customer ke apne alert ko decide karta hai, isliye isme dhokha dene ka koi bada nuksan nahi.
function cleanItem(x) {
  if (!x || typeof x !== "object") return null;
  const product_id = String(x.product_id ?? "");
  const product_handle = String(x.product_handle ?? "");
  if (!ID_RE.test(product_id) || !HANDLE_RE.test(product_handle)) return null;
  return { product_id, product_handle, out_of_stock: x.out_of_stock === true };
}

function dedupe(items) {
  return [...new Map(items.map((i) => [i.product_id, i])).values()];
}

// Wishlist me out of stock product aaya to "stock aate hi mail" ka alert banao.
// Ye extra feature hai: fail ho jaaye to bhi wishlist ka kaam fail nahi hona chahiye, isliye error sirf log hota hai.
// Wapas ek status deta hai, taaki browser ko (aur debug karte waqt humein) pata chale ki kya hua:
//   created          = alert ban gaya (ya pehle se tha)
//   not_out_of_stock = product in stock tha, alert ki zarurat nahi
//   no_email         = customer ka email nahi mila, alert nahi ban sakta
//   limit            = is email ke 20 alerts pehle se pending hain
//   error            = database error (log me dekho)
async function createWishlistAlerts(req, items, rawEmail) {
  const outOfStock = items.filter((i) => i.out_of_stock);
  if (!outOfStock.length) return "not_out_of_stock";

  const email = cleanEmail(rawEmail);
  if (!email) {
    console.warn("wishlist alert skipped: email nahi mila (customer", req.customerId + ")");
    return "no_email";
  }

  try {
    let pending = await alertStore.countPendingForEmail(req.shop, email);
    let status = "created";
    for (const item of outOfStock) {
      if (pending >= alertStore.MAX_PENDING_PER_EMAIL) { status = "limit"; break; }
      await alertStore.createAlert({
        shop: req.shop,
        productId: item.product_id,
        productHandle: item.product_handle,
        variantId: "", // wishlist = product ka koi bhi variant available ho to mail
        email,
        customerId: req.customerId,
        source: "wishlist",
      });
      pending += 1;
    }
    console.log("wishlist alert:", status, req.shop, "customer", req.customerId, "products", outOfStock.map((i) => i.product_id).join(","));
    return status;
  } catch (err) {
    console.error("wishlist alert create failed:", err.message);
    return "error";
  }
}

function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err && err.code === "LIMIT") {
        return res.status(400).json({ ok: false, error: "limit_reached" });
      }
      console.error("wishlist error:", err);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  };
}

// GET /apps/wishlist/items
router.get("/items", requireCustomer, handle(async (req, res) => {
  const items = await store.list(req.shop, req.customerId);
  // Har item par batao ki us product ka stock-alert pending hai ya nahi
  let alerted = new Set();
  try {
    alerted = await alertStore.pendingProductIdsForCustomer(req.shop, req.customerId);
  } catch (err) {
    console.error("alert lookup failed:", err.message);
  }
  res.json({ ok: true, items: items.map((i) => ({ ...i, alert: alerted.has(i.product_id) })) });
}));

// POST /apps/wishlist/add   body: { product_id, product_handle, out_of_stock, email }
router.post("/add", requireCustomer, handle(async (req, res) => {
  const item = cleanItem(req.body);
  if (!item) return res.status(400).json({ ok: false, error: "invalid_product" });
  await store.addItems(req.shop, req.customerId, [item]);
  const alert = await createWishlistAlerts(req, [item], req.body.email);
  res.json({ ok: true, alert });
}));

// POST /apps/wishlist/remove   body: { product_id }
router.post("/remove", requireCustomer, handle(async (req, res) => {
  const productId = String((req.body && req.body.product_id) ?? "");
  if (!ID_RE.test(productId)) return res.status(400).json({ ok: false, error: "invalid_product" });
  await store.removeItem(req.shop, req.customerId, productId);
  // Wishlist se hata diya to uska stock-alert bhi band
  try {
    await alertStore.deleteWishlistAlert(req.shop, req.customerId, productId);
  } catch (err) {
    console.error("wishlist alert delete failed:", err.message);
  }
  res.json({ ok: true });
}));

// POST /apps/wishlist/merge   body: { items: [...], email }
// Guest ki local wishlist login ke baad yahan aati hai
router.post("/merge", requireCustomer, handle(async (req, res) => {
  const raw = req.body && Array.isArray(req.body.items) ? req.body.items.slice(0, 50) : null;
  if (!raw) return res.status(400).json({ ok: false, error: "invalid_items" });
  const items = dedupe(raw.map(cleanItem).filter(Boolean));
  if (items.length) {
    await store.addItems(req.shop, req.customerId, items);
    await createWishlistAlerts(req, items, req.body.email);
  }
  res.json({ ok: true });
}));

module.exports = router;
