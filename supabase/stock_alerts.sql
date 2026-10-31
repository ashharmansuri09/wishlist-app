-- Back in stock alerts: har row = "is email ko is product ka stock aate hi mail bhejna hai"
-- Dono flow isi table me aate hain:
--   source = 'notify_me'  -> product page ka "Notify me" form
--   source = 'wishlist'   -> out of stock product wishlist me add hua
create table if not exists public.stock_alerts (
  id              bigint generated always as identity primary key,
  shop            text        not null,
  product_id      text        not null,
  product_handle  text        not null,
  variant_id      text        not null default '',  -- '' = product ka koi bhi variant available ho to mail
  email           text        not null,             -- hamesha lowercase me save hota hai
  customer_id     text,                             -- logged-in customer ho to uski ID
  source          text        not null check (source in ('notify_me', 'wishlist')),
  token           uuid        not null default gen_random_uuid(),  -- unsubscribe link ke liye
  created_at      timestamptz not null default now(),
  notified_at     timestamptz,                      -- NULL = abhi pending, value = mail bhej di (ya bhejne ke liye claim ho gayi)
  last_error      text                              -- mail fail hui to wajah
);

-- Ek hi email ka ek hi product/variant ka pending alert dobara nahi banega
create unique index if not exists stock_alerts_pending_uniq
  on public.stock_alerts (shop, product_id, variant_id, email)
  where notified_at is null;

-- Restock aane par "is product ke pending alerts" jaldi dhundhne ke liye
create index if not exists stock_alerts_product_idx
  on public.stock_alerts (shop, product_id)
  where notified_at is null;

create index if not exists stock_alerts_email_idx
  on public.stock_alerts (shop, email);

-- Security: wishlist table jaisa. RLS on + koi policy nahi = sirf hamara server (secret key) access kar sakta hai
alter table public.stock_alerts enable row level security;
revoke all on public.stock_alerts from anon, authenticated;
