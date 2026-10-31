// Stock wapas aane par kaun si mail jaani chahiye, ye saara logic yahin hai.
const { adminGraphql } = require("../lib/shopifyAdmin");
const { sendMail } = require("../lib/mailer");
const { buildBackInStockEmail } = require("../lib/emailTemplate");
const alertStore = require("./alertStore");

// inventory_levels/update webhook me sirf inventory_item_id aata hai.
// Usse hum pata karte hain ki wo kaun sa variant aur kaun sa product hai.
const ITEM_QUERY = `
  query ($id: ID!) {
    inventoryItem(id: $id) {
      variant { id product { id } }
    }
  }`;

// Product ka abhi ka sach: kaun se variants bik sakte hain (availableForSale)
const PRODUCT_QUERY = `
  query ($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      status
      featuredMedia { preview { image { url } } }
      variants(first: 100) { nodes { id availableForSale } }
    }
  }`;

const BATCH_SIZE = 10; // ek baar me itni mails claim karke bhejte hain

// "gid://shopify/Product/123" -> "123"
function idFromGid(gid) {
  const m = /(\d+)$/.exec(String(gid || ""));
  return m ? m[1] : null;
}

// Webhook ka entry point. Topic ke hisaab se product ID nikalta hai.
async function handleWebhook(topic, shop, payload) {
  if (topic === "inventory_levels/update") {
    // Sirf tab kaam ki baat jab stock 0 se upar hua. null/0 = stock khatam ya track nahi hota.
    if (!(Number(payload.available) > 0)) return { ignored: "not_a_restock" };
    if (!/^\d+$/.test(String(payload.inventory_item_id))) return { ignored: "bad_inventory_item" };

    const data = await adminGraphql(shop, ITEM_QUERY, {
      id: `gid://shopify/InventoryItem/${payload.inventory_item_id}`,
    });
    const productGid = data.inventoryItem && data.inventoryItem.variant && data.inventoryItem.variant.product
      ? data.inventoryItem.variant.product.id
      : null;
    if (!productGid) return { ignored: "no_product" };
    return processProduct(shop, productGid);
  }

  if (topic === "products/update") {
    // Product active/unarchive hua ya inventory policy badli, to bhi availability badal sakti hai
    const gid = payload.admin_graphql_api_id || (payload.id ? `gid://shopify/Product/${payload.id}` : null);
    if (!gid) return { ignored: "no_product" };
    return processProduct(shop, gid);
  }

  return { ignored: "topic" };
}

// Ek product ke liye: pending alerts dekho, jo ab available hain unhe mail bhejo.
// Ye function idempotent hai: do baar chal jaaye to bhi kisi ko double mail nahi jaati.
async function processProduct(shop, productGid) {
  const productId = idFromGid(productGid);
  if (!productId) return { ignored: "bad_product_id" };

  // 1) Pehle apna DB dekho. Alert hi nahi hai to Shopify ko call karne ki zarurat nahi (products/update bahut baar aata hai)
  const pending = await alertStore.pendingForProduct(shop, productId);
  if (!pending.length) return { ignored: "no_alerts" };

  // 2) Shopify se product ka abhi ka stock status
  const data = await adminGraphql(shop, PRODUCT_QUERY, { id: `gid://shopify/Product/${productId}` });
  const product = data.product;
  if (!product || product.status !== "ACTIVE") return { ignored: "product_not_active" };

  const availableVariants = new Set(
    product.variants.nodes.filter((v) => v.availableForSale).map((v) => idFromGid(v.id))
  );
  const info = {
    title: product.title,
    handle: product.handle,
    imageUrl: product.featuredMedia && product.featuredMedia.preview && product.featuredMedia.preview.image
      ? product.featuredMedia.preview.image.url
      : null,
  };

  // 3) Kaun se alerts ab pure ho sakte hain?
  //    variant_id '' (wishlist) = koi bhi variant available ho
  //    variant_id set (notify me) = wahi variant available ho
  const eligible = pending.filter((a) =>
    a.variant_id === "" ? availableVariants.size > 0 : availableVariants.has(a.variant_id)
  );
  if (!eligible.length) return { ignored: "still_out_of_stock" };

  // 4) Batch me claim karo, mail bhejo, fail ho to release karo
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
    const batchIds = eligible.slice(i, i + BATCH_SIZE).map((a) => a.id);
    const claimed = await alertStore.claim(batchIds);

    // Ek email ke wishlist + notify-me dono alerts ho sakte hain: use sirf EK mail bhejo
    const byEmail = new Map();
    for (const alert of claimed) {
      if (!byEmail.has(alert.email)) byEmail.set(alert.email, []);
      byEmail.get(alert.email).push(alert);
    }

    const results = await Promise.allSettled(
      [...byEmail.entries()].map(async ([email, alerts]) => {
        try {
          await sendRestockMail({ shop, email, alerts, product: info, availableVariants });
          sent += 1;
        } catch (err) {
          failed += 1;
          await alertStore.release(alerts.map((a) => a.id), err.message);
          throw err;
        }
      })
    );
    results.filter((r) => r.status === "rejected").forEach((r) => console.error("restock mail failed:", r.reason.message));
  }

  return { sent, failed };
}

async function sendRestockMail({ shop, email, alerts, product, availableVariants }) {
  const storeName = process.env.STORE_NAME || shop;
  const proxyPath = process.env.PROXY_PATH || "/apps/wishlist";
  const unsubscribeUrl = `https://${shop}${proxyPath}/unsubscribe?token=${alerts[0].token}`;

  // Link me wahi variant jo user ne maanga tha (agar wo ab available hai)
  const wanted = alerts.find((a) => a.variant_id !== "" && availableVariants.has(a.variant_id));
  const { subject, html, text } = buildBackInStockEmail({
    shop,
    storeName,
    product,
    variantId: wanted ? wanted.variant_id : "",
    unsubscribeUrl,
  });

  await sendMail({
    to: email,
    subject,
    html,
    text,
    headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` },
  });
}

module.exports = { handleWebhook, processProduct, idFromGid };
