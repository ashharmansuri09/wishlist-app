const crypto = require("crypto");

// Shopify ka signature: signature ko chhodkar baaki params "key=value" bante hain,
// sort hote hain, bina separator ke jud jaate hain, phir HMAC-SHA256 (secret = Client secret)
function computeSignature(query, secret) {
  const { signature, ...rest } = query;
  const message = Object.keys(rest)
    .map((k) => `${k}=${Array.isArray(rest[k]) ? rest[k].join(",") : rest[k]}`)
    .sort()
    .join("");
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

function unauthorized(res, error) {
  return res.status(401).json({ ok: false, error });
}

// 1) Request sach me Shopify se aayi hai ya nahi
function verifyProxy(req, res, next) {
  const secret = process.env.SHOPIFY_API_SECRET;
  const signature = req.query.signature;

  if (!secret || typeof signature !== "string") {
    return unauthorized(res, "invalid_signature");
  }

  const expected = Buffer.from(computeSignature(req.query, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return unauthorized(res, "invalid_signature");
  }

  const shop = String(req.query.shop || "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    return unauthorized(res, "invalid_shop");
  }

  req.shop = shop.toLowerCase();
  req.customerId = String(req.query.logged_in_customer_id || "");
  next();
}

// 2) Customer login hona zaroori hai (Shopify ne empty bheja = guest)
function requireCustomer(req, res, next) {
  if (!/^\d+$/.test(req.customerId)) return unauthorized(res, "login_required");
  next();
}

module.exports = { verifyProxy, requireCustomer, computeSignature };
