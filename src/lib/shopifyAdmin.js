// Shopify Admin GraphQL API se baat karne ka helper.
//
// Token kaise milta hai? Dev Dashboard ke app me static token nahi dikhta.
// "client credentials grant" se hum apna Client ID + Client secret dekar token mangte hain.
// Token 24 ghante chalta hai, isliye memory me cache karte hain.
// Shart: app aur store same Shopify organization me hone chahiye.

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";

// shop -> { token, expiresAt }
const tokenCache = new Map();

async function getToken(shop) {
  const cached = tokenCache.get(shop);
  // 5 minute pehle hi naya le lo, taaki beech me expire na ho
  if (cached && cached.expiresAt - 5 * 60 * 1000 > Date.now()) return cached.token;

  const clientId = process.env.SHOPIFY_API_KEY;
  const clientSecret = process.env.SHOPIFY_API_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("SHOPIFY_API_KEY ya SHOPIFY_API_SECRET set nahi hai");
  }

  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // "shop_not_permitted" = app aur store alag organization me hain
    throw new Error(`token_request_failed ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  tokenCache.set(shop, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 86399) * 1000,
  });
  return data.access_token;
}

// query = GraphQL string, variables = object. Sirf "data" wapas deta hai.
async function adminGraphql(shop, query, variables = {}, isRetry = false) {
  const token = await getToken(shop);

  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });

  // Token expire ya revoke ho gaya ho to ek baar naya lekar dobara try karo
  if (res.status === 401 && !isRetry) {
    tokenCache.delete(shop);
    return adminGraphql(shop, query, variables, true);
  }
  if (!res.ok) throw new Error(`admin_api_failed ${res.status}`);

  const json = await res.json();
  if (json.errors) throw new Error(`admin_graphql_error: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data;
}

module.exports = { adminGraphql, getToken, API_VERSION };
