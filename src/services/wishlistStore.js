const { getSupabase } = require("../lib/supabase");

const TABLE = "wishlist_items";
const MAX_ITEMS = 200; // ek customer ki wishlist ki limit

async function list(shop, customerId) {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select("product_id, product_handle, created_at")
    .eq("shop", shop)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

// items = [{ product_id, product_handle }]. Jo pehle se saved hain unhe skip karta hai.
async function addItems(shop, customerId, items) {
  const existing = await list(shop, customerId);
  const have = new Set(existing.map((r) => r.product_id));
  const fresh = items.filter((i) => !have.has(i.product_id));

  if (existing.length + fresh.length > MAX_ITEMS) {
    const err = new Error("limit_reached");
    err.code = "LIMIT";
    throw err;
  }
  if (fresh.length === 0) return;

  const rows = fresh.map((i) => ({
    shop,
    customer_id: customerId,
    product_id: i.product_id,
    product_handle: i.product_handle,
  }));

  const { error } = await getSupabase()
    .from(TABLE)
    .upsert(rows, { onConflict: "shop,customer_id,product_id", ignoreDuplicates: true });
  if (error) throw error;
}

async function removeItem(shop, customerId, productId) {
  const { error } = await getSupabase()
    .from(TABLE)
    .delete()
    .eq("shop", shop)
    .eq("customer_id", customerId)
    .eq("product_id", productId);
  if (error) throw error;
}

module.exports = { list, addItems, removeItem, MAX_ITEMS };
