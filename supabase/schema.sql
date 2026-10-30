-- Wishlist table: har row = ek customer ka ek saved product
create table if not exists public.wishlist_items (
  id              bigint generated always as identity primary key,
  shop            text        not null,   -- jaise ashhar-checkout-extension-theme.myshopify.com
  customer_id     text        not null,   -- Shopify ka logged_in_customer_id
  product_id      text        not null,   -- Shopify product id
  product_handle  text        not null,   -- product ka URL handle
  created_at      timestamptz not null default now(),
  unique (shop, customer_id, product_id)  -- same product do baar save nahi hoga
);

-- Security: RLS on, koi policy nahi => browser wali (publishable/anon) key is table ko chhu bhi nahi sakti.
-- Sirf hamara server secret key se access karega.
alter table public.wishlist_items enable row level security;
revoke all on public.wishlist_items from anon, authenticated;
