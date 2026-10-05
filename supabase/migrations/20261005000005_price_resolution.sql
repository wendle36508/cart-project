-- =============================================================================
-- Phase 3: online price layer and price resolution
--
-- Which price a shopper sees for an item at a store, best first:
--   1. In-store sale price (sale not yet ended)
--   2. In-store regular price
--   3. Online sale price (sale not yet ended)
--   4. Online regular price
-- An in-store price always wins over any online price, so online prices only
-- fill gaps, and the app always labels them as online.
-- =============================================================================

-- Sale end dates are printed in local (store) time.
create function public.store_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/New_York')::date;
$$;

-- Best current price for each barcode at one store. One row per barcode that
-- has any price; barcodes with no price are simply absent.
create function public.current_prices(p_store_id uuid, p_barcodes text[])
returns table (
  barcode              text,
  price_id             uuid,
  tier                 public.price_tier,
  source               public.price_source,
  price_cents          integer,
  price_unit           public.price_unit,
  is_sale              boolean,
  sale_end_date        date,
  regular_price_cents  integer,   -- same-tier regular price, when showing a sale
  is_verified          boolean,
  confirmation_count   integer,
  last_seen_at         timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (p.barcode)
    p.barcode, p.id, p.tier, p.source, p.price_cents, p.price_unit, p.is_sale,
    p.sale_end_date,
    case when p.is_sale then reg.price_cents end,
    p.is_verified, p.confirmation_count, p.last_seen_at
  from public.prices p
  left join public.prices reg
    on reg.barcode = p.barcode and reg.store_id = p.store_id
   and reg.tier = p.tier and not reg.is_sale
  where p.store_id = p_store_id
    and p.barcode = any (p_barcodes)
    and (not p.is_sale or p.sale_end_date is null or p.sale_end_date >= public.store_today())
  order by p.barcode,
           (p.tier = 'in_store') desc,
           p.is_sale desc,
           p.last_seen_at desc;
$$;

grant execute on function public.store_today() to anon, authenticated;
grant execute on function public.current_prices(uuid, text[]) to anon, authenticated;

-- When an online source was last asked about a product at a store, including
-- "not carried" answers, so each item hits a chain's API at most once a day.
-- Written only by the get-price Edge Function (service role).
create table public.online_price_checks (
  barcode     text not null references public.products (barcode) on delete cascade,
  store_id    uuid not null references public.store_locations (id) on delete cascade,
  source      text not null,          -- adapter id, e.g. 'kroger'
  found       boolean not null,
  checked_at  timestamptz not null default now(),
  primary key (barcode, store_id)
);

alter table public.online_price_checks enable row level security;
