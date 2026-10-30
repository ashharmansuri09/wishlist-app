const express = require("express");
const { verifyProxy, requireCustomer } = require("../middleware/verifyProxy");
const store = require("../services/wishlistStore");

const router = express.Router();

const ID_RE = /^\d{1,20}$/;
const HANDLE_RE = /^[^\s/?#]{1,255}$/;

// Client se aaya data kabhi trust nahi karte, har item saaf karte hain
function cleanItem(x) {
  if (!x || typeof x !== "object") return null;
  const product_id = String(x.product_id ?? "");
  const product_handle = String(x.product_handle ?? "");
  if (!ID_RE.test(product_id) || !HANDLE_RE.test(product_handle)) return null;
  return { product_id, product_handle };
}

function dedupe(items) {
  return [...new Map(items.map((i) => [i.product_id, i])).values()];
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

// Har response fresh ho, cache na ho
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// Pehle signature check, phir customer check. customer_id hamesha Shopify ke signed param se aata hai.
router.use(verifyProxy);

// GET /apps/wishlist/items
router.get("/items", requireCustomer, handle(async (req, res) => {
  const items = await store.list(req.shop, req.customerId);
  res.json({ ok: true, items });
}));

// POST /apps/wishlist/add   body: { product_id, product_handle }
router.post("/add", requireCustomer, handle(async (req, res) => {
  const item = cleanItem(req.body);
  if (!item) return res.status(400).json({ ok: false, error: "invalid_product" });
  await store.addItems(req.shop, req.customerId, [item]);
  res.json({ ok: true });
}));

// POST /apps/wishlist/remove   body: { product_id }
router.post("/remove", requireCustomer, handle(async (req, res) => {
  const productId = String((req.body && req.body.product_id) ?? "");
  if (!ID_RE.test(productId)) return res.status(400).json({ ok: false, error: "invalid_product" });
  await store.removeItem(req.shop, req.customerId, productId);
  res.json({ ok: true });
}));

// POST /apps/wishlist/merge   body: { items: [...] }  (guest ki local wishlist login ke baad yahan aati hai)
router.post("/merge", requireCustomer, handle(async (req, res) => {
  const raw = req.body && Array.isArray(req.body.items) ? req.body.items.slice(0, 50) : null;
  if (!raw) return res.status(400).json({ ok: false, error: "invalid_items" });
  const items = dedupe(raw.map(cleanItem).filter(Boolean));
  if (items.length) await store.addItems(req.shop, req.customerId, items);
  res.json({ ok: true });
}));

module.exports = router;
