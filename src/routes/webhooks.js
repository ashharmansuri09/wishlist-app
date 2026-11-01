// Shopify ke webhooks yahan aate hain (App Proxy se alag raasta: /webhooks/shopify)
const express = require("express");
const crypto = require("crypto");
const { handleWebhook } = require("../services/restockService");

const router = express.Router();

// Webhook ka signature: poori RAW body ka HMAC-SHA256 (base64), Client secret se.
// Isliye yahan express.raw use hota hai, JSON parse hone ke baad body badal jaati hai aur signature match nahi hota.
function verifyWebhookHmac(rawBody, headerValue, secret) {
  if (!secret || !headerValue) return false;
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(rawBody).digest("base64"));
  const received = Buffer.from(String(headerValue));
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

router.post("/shopify", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
  const rawBody = req.body;
  if (!Buffer.isBuffer(rawBody)) {
    // Hosting ne body pehle hi parse kar di to signature check nahi ho sakta
    console.warn("webhook rejected: body raw Buffer nahi hai, type =", typeof rawBody);
    return res.status(400).send("bad body");
  }

  if (!verifyWebhookHmac(rawBody, req.get("X-Shopify-Hmac-Sha256"), process.env.SHOPIFY_API_SECRET)) {
    console.warn("webhook rejected: HMAC match nahi hua (SHOPIFY_API_SECRET galat ya body badal gayi). topic =", req.get("X-Shopify-Topic"));
    return res.status(401).send("invalid hmac");
  }

  const topic = req.get("X-Shopify-Topic") || "";
  const shop = (req.get("X-Shopify-Shop-Domain") || "").toLowerCase();
  console.log("webhook received:", topic, shop);
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) return res.status(400).send("bad shop");

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch (e) {
    return res.status(400).send("bad json");
  }

  try {
    // Shopify 5 second me jawab maangta hai. Kaam yahin poora karke 200 dete hain.
    // Fail hone par 500 dete hain, to Shopify khud baad me phir bhejta hai (retry safe hai, double mail nahi jaati).
    const result = await handleWebhook(topic, shop, payload);
    console.log("webhook", topic, shop, JSON.stringify(result));
    res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error("webhook error:", topic, err.message);
    res.status(500).json({ ok: false });
  }
});

module.exports = { router, verifyWebhookHmac };
