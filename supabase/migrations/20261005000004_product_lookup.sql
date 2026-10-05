-- =============================================================================
-- Phase 2: barcode lookup support
-- =============================================================================

-- Who added a product by hand (shopper-named items not found in Open Food
-- Facts). Lets admins review or clean up user-created products.
alter table public.products
  add column created_by uuid references public.profiles (id) on delete set null;

-- Barcodes that Open Food Facts (and its sister databases) did not have.
-- Stops every scan of an unknown item from hitting their API again. Written
-- and read only by the lookup-product Edge Function (service role), so RLS
-- is on with no policies.
create table public.product_lookup_misses (
  barcode          text primary key check (barcode ~ '^[0-9]{6,14}$'),
  miss_count       integer not null default 1,
  last_checked_at  timestamptz not null default now()
);

alter table public.product_lookup_misses enable row level security;

-- Finds the active cart line for a barcode when the same item is scanned again.
create index trip_items_trip_barcode_idx on public.trip_items (trip_id, barcode) where removed_at is null;
