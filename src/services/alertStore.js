// stock_alerts table ke saare database queries yahin hain.
const { getSupabase } = require("../lib/supabase");

const TABLE = "stock_alerts";

// Ek email ke itne se zyada pending alerts nahi bante (spam/abuse se bachne ke liye)
const MAX_PENDING_PER_EMAIL = 20;

const COLUMNS = "id, shop, product_id, product_handle, variant_id, email, customer_id, source, token";

// Naya alert banao. Agar wahi alert pehle se pending hai to error nahi, chup-chaap OK.
async function createAlert({ shop, productId, productHandle, variantId = "", email, customerId = null, source }) {
  const { error } = await getSupabase().from(TABLE).insert({
    shop,
    product_id: productId,
    product_handle: productHandle,
    variant_id: variantId,
    email,
    customer_id: customerId,
    source,
  });
  // 23505 = unique violation = same alert pehle se pending hai
  if (error && error.code !== "23505") throw error;
}

async function countPendingForEmail(shop, email) {
  const { count, error } = await getSupabase()
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("shop", shop)
    .eq("email", email)
    .is("notified_at", null);
  if (error) throw error;
  return count || 0;
}

// Is product ke saare pending alerts
async function pendingForProduct(shop, productId) {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select(COLUMNS)
    .eq("shop", shop)
    .eq("product_id", productId)
    .is("notified_at", null)
    .order("id", { ascending: true });
  if (error) throw error;
  return data;
}

// "Claim": mail bhejne se PEHLE rows ko notified_at laga do.
// "WHERE notified_at IS NULL" ki wajah se agar do webhooks ek saath aayein to har row sirf ek ko milti hai,
// isliye user ko double mail nahi jaati. Jo rows sach me humne claim ki, wahi wapas aati hain.
async function claim(ids) {
  if (!ids.length) return [];
  const { data, error } = await getSupabase()
    .from(TABLE)
    .update({ notified_at: new Date().toISOString(), last_error: null })
    .in("id", ids)
    .is("notified_at", null)
    .select(COLUMNS);
  if (error) throw error;
  return data;
}

// Mail fail ho gayi to claim wapas lo, taaki agli baar phir try ho sake
async function release(ids, errorMessage) {
  if (!ids.length) return;
  const { error } = await getSupabase()
    .from(TABLE)
    .update({ notified_at: null, last_error: String(errorMessage).slice(0, 300) })
    .in("id", ids);
  if (error) throw error;
}

// Customer ne wishlist se product hata diya to uska wishlist wala pending alert bhi hata do
async function deleteWishlistAlert(shop, customerId, productId) {
  const { error } = await getSupabase()
    .from(TABLE)
    .delete()
    .eq("shop", shop)
    .eq("customer_id", customerId)
    .eq("product_id", productId)
    .eq("source", "wishlist")
    .is("notified_at", null);
  if (error) throw error;
}

// Unsubscribe link: token se email dhundho, us email ke saare pending alerts hata do
async function unsubscribeByToken(shop, token) {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select("email")
    .eq("shop", shop)
    .eq("token", token)
    .limit(1);
  if (error) throw error;
  if (!data || !data.length) return false;

  const { error: delError } = await getSupabase()
    .from(TABLE)
    .delete()
    .eq("shop", shop)
    .eq("email", data[0].email)
    .is("notified_at", null);
  if (delError) throw delError;
  return true;
}

module.exports = {
  createAlert,
  countPendingForEmail,
  pendingForProduct,
  claim,
  release,
  deleteWishlistAlert,
  unsubscribeByToken,
  MAX_PENDING_PER_EMAIL,
};
