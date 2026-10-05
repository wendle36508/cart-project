-- =============================================================================
-- CartCheck core schema
--
-- Conventions
--   * Money is stored as integer cents (never floats).
--   * Weighed items are priced per pound (price_unit = 'lb'); everything else 'each'.
--   * Products are keyed by barcode (GTIN/UPC/EAN as a digit string).
--   * `price_submissions` is the append-only audit log of every price anyone
--     reported. `prices` holds the current resolved price per product/store/tier
--     and is derived from submissions (resolution logic lands in phase 4/7).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Where a price observation came from.
create type public.price_source as enum (
  'in_store_tag',  -- shopper photographed a shelf tag
  'receipt',       -- extracted from a shopper's receipt
  'admin',         -- pre-loaded by an admin
  'online'         -- pulled from a chain's online/API price feed
);

-- Online prices are a labeled fallback; in-store prices always win.
create type public.price_tier as enum ('in_store', 'online');

create type public.price_unit as enum ('each', 'lb');

-- Tax treatment. Rates per category live in tax_rates so other states can be
-- added without code changes.
create type public.tax_category as enum (
  'food',           -- grocery food (MA: exempt; includes candy & soft drinks)
  'alcohol',        -- MA: no sales tax on package alcohol (excise only)
  'prepared_food',  -- hot/prepared meals (MA: meals tax)
  'non_food',       -- paper goods, cleaning, toiletries, etc. (MA: taxable)
  'unknown'         -- not yet classified; treated as taxable to be safe
);

create type public.trip_status as enum ('active', 'completed', 'abandoned');

create type public.user_role as enum ('user', 'admin');

create type public.point_reason as enum (
  'price_added',            -- new in-store price where none existed
  'online_price_replaced',  -- in-store price replaced an online price (bonus)
  'price_confirmed',        -- tapped "still correct"
  'price_corrected',        -- fixed a wrong price
  'receipt_uploaded'
);

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

-- One row per auth user (including anonymous users). Holds no PII beyond an
-- optional display name the user picks for leaderboards.
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text check (char_length(display_name) <= 40),
  role          public.user_role not null default 'user',
  points        integer not null default 0,
  created_at    timestamptz not null default now()
);

-- Auto-create a profile whenever an auth user is created.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Tax
-- ---------------------------------------------------------------------------

create table public.tax_regions (
  id          text primary key,              -- e.g. 'MA', 'MA-NEEDHAM'
  state       char(2) not null,
  name        text not null,
  notes       text
);

-- Rate per category per region, in basis points (625 = 6.25%).
create table public.tax_rates (
  region_id     text not null references public.tax_regions (id) on delete cascade,
  category      public.tax_category not null,
  rate_bps      integer not null check (rate_bps between 0 and 2000),
  primary key (region_id, category)
);

-- ---------------------------------------------------------------------------
-- Chains & store locations (fixed, curated list — no arbitrary stores)
-- ---------------------------------------------------------------------------

create table public.chains (
  id              text primary key,          -- slug, e.g. 'target'
  name            text not null,
  -- Key of the pluggable online-price source adapter, or null if none.
  online_source   text,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

create table public.store_locations (
  id                  uuid primary key default gen_random_uuid(),
  chain_id            text not null references public.chains (id),
  name                text not null,            -- e.g. 'Target Framingham'
  address             text not null,
  city                text not null,
  state               char(2) not null,
  zip                 text not null,
  lat                 double precision,
  lng                 double precision,
  tax_region_id       text not null references public.tax_regions (id),
  -- The chain's own store id, used by online-price adapters (e.g. Kroger locationId).
  external_store_id   text,
  is_pilot            boolean not null default false,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (chain_id, address)
);

create index store_locations_chain_idx on public.store_locations (chain_id);

-- ---------------------------------------------------------------------------
-- Products (keyed by barcode)
-- ---------------------------------------------------------------------------

create table public.products (
  barcode         text primary key check (barcode ~ '^[0-9]{6,14}$'),
  name            text not null,
  brand           text,
  size_text       text,                        -- as printed, e.g. '16 oz'
  category        text,                        -- our simplified category, e.g. 'snacks'
  off_categories  text[],                      -- raw Open Food Facts tags, for reference
  image_url       text,
  tax_category    public.tax_category not null default 'unknown',
  -- MA bottle deposit (5¢ on carbonated soft drinks, beer, etc.). Added to totals, not taxed.
  deposit_cents   integer not null default 0 check (deposit_cents >= 0),
  is_weighed      boolean not null default false,  -- sold by the pound
  -- Curated "common student item": the app should feel complete for these.
  is_curated      boolean not null default false,
  -- Essentials are never suggested as the first thing to put back.
  is_essential    boolean not null default false,
  data_source     text not null default 'open_food_facts', -- or 'admin', 'user'
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index products_curated_idx on public.products (is_curated) where is_curated;
create index products_category_idx on public.products (category);

-- ---------------------------------------------------------------------------
-- Prices
-- ---------------------------------------------------------------------------

-- Append-only log of every price observation. Never updated except by admins.
create table public.price_submissions (
  id              uuid primary key default gen_random_uuid(),
  barcode         text not null references public.products (barcode),
  store_id        uuid not null references public.store_locations (id),
  user_id         uuid references public.profiles (id) on delete set null,
  source          public.price_source not null,
  price_cents     integer not null check (price_cents > 0),
  price_unit      public.price_unit not null default 'each',
  is_sale         boolean not null default false,
  sale_end_date   date,
  -- Regular price printed on a sale tag, if the AI could read it.
  regular_price_cents integer check (regular_price_cents > 0),
  ai_confidence   numeric(3,2) check (ai_confidence between 0 and 1),
  -- True if the user edited the AI-extracted value before confirming.
  user_edited     boolean not null default false,
  created_at      timestamptz not null default now(),
  check (is_sale or sale_end_date is null)
);

create index price_submissions_lookup_idx
  on public.price_submissions (barcode, store_id, created_at desc);
create index price_submissions_user_idx on public.price_submissions (user_id);

-- Current resolved price per (product, store, tier, regular|sale).
-- A sale row is separate so it never overwrites the regular price; it is
-- ignored once sale_end_date has passed.
create table public.prices (
  id                  uuid primary key default gen_random_uuid(),
  barcode             text not null references public.products (barcode),
  store_id            uuid not null references public.store_locations (id),
  tier                public.price_tier not null,
  source              public.price_source not null,
  is_sale             boolean not null default false,
  price_cents         integer not null check (price_cents > 0),
  price_unit          public.price_unit not null default 'each',
  sale_end_date       date,
  confirmation_count  integer not null default 1,
  is_verified         boolean not null default false,
  -- Most recent submission/confirmation that supports this price.
  last_seen_at        timestamptz not null default now(),
  -- The submission this row currently reflects (null for online prices).
  submission_id       uuid references public.price_submissions (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (barcode, store_id, tier, is_sale),
  check (tier = 'online' or source <> 'online'),
  check (tier = 'in_store' or source = 'online')
);

create index prices_store_idx on public.prices (store_id);

-- "Still correct?" / "Wrong price" votes on a displayed price.
create table public.price_feedback (
  id          uuid primary key default gen_random_uuid(),
  price_id    uuid not null references public.prices (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  is_correct  boolean not null,
  created_at  timestamptz not null default now()
);

create index price_feedback_price_idx on public.price_feedback (price_id);

-- ---------------------------------------------------------------------------
-- Trips
-- ---------------------------------------------------------------------------

create table public.trips (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  store_id      uuid not null references public.store_locations (id),
  budget_cents  integer check (budget_cents > 0),
  status        public.trip_status not null default 'active',
  -- Optional: the shopping list this trip was started from.
  list_id       uuid,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz
);

create index trips_user_idx on public.trips (user_id, started_at desc);

create table public.trip_items (
  id                uuid primary key default gen_random_uuid(),
  trip_id           uuid not null references public.trips (id) on delete cascade,
  barcode           text not null references public.products (barcode),
  quantity          integer not null default 1 check (quantity > 0),
  -- For weighed items: pounds (quantity stays 1).
  weight_lb         numeric(6,3) check (weight_lb > 0),
  -- Snapshot of the price used, so totals don't shift mid-trip unless the
  -- user refreshes. Null = no price known yet.
  unit_price_cents  integer check (unit_price_cents > 0),
  price_unit        public.price_unit,
  price_tier        public.price_tier,
  price_id          uuid references public.prices (id) on delete set null,
  is_sale           boolean not null default false,
  removed_at        timestamptz,  -- "put back"; kept for analytics
  added_at          timestamptz not null default now()
);

create index trip_items_trip_idx on public.trip_items (trip_id);

-- ---------------------------------------------------------------------------
-- Shopping lists
-- ---------------------------------------------------------------------------

create table public.shopping_lists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  name        text not null default 'My list',
  store_id    uuid references public.store_locations (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.trips
  add constraint trips_list_fk foreign key (list_id)
  references public.shopping_lists (id) on delete set null;

create table public.shopping_list_items (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid not null references public.shopping_lists (id) on delete cascade,
  -- Either a known product or free text (e.g. "bananas") the user typed/picked.
  barcode     text references public.products (barcode),
  free_text   text,
  quantity    integer not null default 1 check (quantity > 0),
  checked     boolean not null default false,
  created_at  timestamptz not null default now(),
  check (barcode is not null or free_text is not null)
);

create index shopping_list_items_list_idx on public.shopping_list_items (list_id);

-- ---------------------------------------------------------------------------
-- Contribution points
-- ---------------------------------------------------------------------------

create table public.point_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  store_id        uuid references public.store_locations (id),
  reason          public.point_reason not null,
  points          integer not null,
  submission_id   uuid references public.price_submissions (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index point_events_store_idx on public.point_events (store_id, created_at desc);
create index point_events_user_idx on public.point_events (user_id);

-- ---------------------------------------------------------------------------
-- Swaps (cheaper alternatives) — includes room for future sponsored deals.
-- Not built out in the MVP UI beyond plain cheaper swaps.
-- ---------------------------------------------------------------------------

create table public.swaps (
  id              uuid primary key default gen_random_uuid(),
  from_barcode    text not null references public.products (barcode),
  to_barcode      text not null references public.products (barcode),
  chain_id        text references public.chains (id),   -- null = all chains
  -- Monetization hook: null sponsor = organic swap. Sponsored swaps must be
  -- labeled "Sponsored" in the UI.
  sponsor_name    text,
  starts_at       timestamptz,
  ends_at         timestamptz,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  check (from_barcode <> to_barcode)
);

create index swaps_from_idx on public.swaps (from_barcode) where active;

-- ---------------------------------------------------------------------------
-- Analytics events (first-party, pseudonymous: auth user id only, no PII)
-- ---------------------------------------------------------------------------

create table public.events (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles (id) on delete set null,
  name        text not null check (name in (
                'trip_started', 'trip_completed', 'item_scanned',
                'price_contributed', 'online_price_replaced',
                'price_confirmed', 'receipt_scanned', 'list_estimated',
                'app_opened')),
  store_id    uuid references public.store_locations (id),
  props       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index events_name_time_idx on public.events (name, created_at);
create index events_user_time_idx on public.events (user_id, created_at);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();
create trigger prices_touch before update on public.prices
  for each row execute function public.touch_updated_at();
create trigger shopping_lists_touch before update on public.shopping_lists
  for each row execute function public.touch_updated_at();
