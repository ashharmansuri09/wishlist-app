// "Back in stock" email ka HTML aur text version.

// Product ka naam kuch bhi ho sakta hai, isliye HTML me daalne se pehle escape karna zaroori hai
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// product = { title, handle, imageUrl }
function buildBackInStockEmail({ shop, storeName, product, variantId, unsubscribeUrl }) {
  const productUrl =
    `https://${shop}/products/${encodeURIComponent(product.handle)}` +
    (variantId ? `?variant=${encodeURIComponent(variantId)}` : "");

  const subject = `${product.title} is back in stock`;

  const text = [
    `Good news! ${product.title} is back in stock at ${storeName}.`,
    ``,
    `Get it before it sells out again: ${productUrl}`,
    ``,
    `You are receiving this because you asked to be notified.`,
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");

  const image = product.imageUrl
    ? `<img src="${esc(product.imageUrl)}" alt="${esc(product.title)}" width="240" style="display:block;margin:0 auto 16px;border-radius:8px;max-width:100%;height:auto;">`
    : "";

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f6f6;font-family:Arial,Helvetica,sans-serif;color:#222;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;text-align:center;">
    ${image}
    <h1 style="margin:0 0 8px;font-size:22px;">${esc(product.title)} is back in stock</h1>
    <p style="margin:0 0 20px;color:#555;">Good news! It is available again at ${esc(storeName)}.</p>
    <a href="${esc(productUrl)}" style="display:inline-block;padding:12px 24px;background:#1f6f4a;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Shop now</a>
    <p style="margin:24px 0 0;font-size:12px;color:#888;">
      You are receiving this because you asked to be notified.<br>
      <a href="${esc(unsubscribeUrl)}" style="color:#888;">Unsubscribe</a>
    </p>
  </div>
</body></html>`;

  return { subject, html, text };
}

module.exports = { buildBackInStockEmail, esc };
