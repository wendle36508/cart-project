-- =============================================================================
-- Row-level security
--
-- Principles
--   * Reference data (chains, stores, tax, products, current prices, swaps) is
--     readable by everyone, writable only by admins (or server-side functions).
--   * Personal data (trips, lists, feedback, own submissions) is visible only
--     to its owner. No user can read another user's activity.
--   * Points and verification are changed only by security-definer functions,
--     never directly by clients.
-- =============================================================================

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

alter table public.profiles            enable row level security;
alter table public.tax_regions         enable row level security;
alter table public.tax_rates           enable row level security;
alter table public.chains              enable row level security;
alter table public.store_locations     enable row level security;
alter table public.products            enable row level security;
alter table public.price_submissions   enable row level security;
alter table public.prices              enable row level security;
alter table public.price_feedback      enable row level security;
alter table public.trips               enable row level security;
alter table public.trip_items          enable row level security;
alter table public.shopping_lists      enable row level security;
alter table public.shopping_list_items enable row level security;
alter table public.point_events        enable row level security;
alter table public.swaps               enable row level security;
alter table public.events              enable row level security;

-- ---------------------------------------------------------------------------
-- Profiles: users see and rename themselves; role/points are not client-writable.
-- ---------------------------------------------------------------------------
create policy "profiles: read own" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

revoke update on public.profiles from anon, authenticated;
grant update (display_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Public reference data: read for all, write for admins.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'tax_regions', 'tax_rates', 'chains', 'store_locations',
    'products', 'prices', 'swaps'
  ] loop
    execute format(
      'create policy "%1$s: public read" on public.%1$I for select to anon, authenticated using (true)', t);
    execute format(
      'create policy "%1$s: admin write" on public.%1$I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Price submissions: shoppers may add in-store observations as themselves.
-- 'admin' and 'online' sources are reserved for admins / server jobs.
-- ---------------------------------------------------------------------------
create policy "price_submissions: insert own in-store" on public.price_submissions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (source in ('in_store_tag', 'receipt') or (select public.is_admin()))
  );

create policy "price_submissions: read own" on public.price_submissions
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy "price_submissions: admin manage" on public.price_submissions
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Price feedback ("still correct?" / "wrong price")
-- ---------------------------------------------------------------------------
create policy "price_feedback: insert own" on public.price_feedback
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "price_feedback: read own" on public.price_feedback
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Trips & lists: owner only.
-- ---------------------------------------------------------------------------
create policy "trips: owner" on public.trips
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "trip_items: owner" on public.trip_items
  for all to authenticated
  using (exists (
    select 1 from public.trips t
    where t.id = trip_id and t.user_id = (select auth.uid())))
  with check (exists (
    select 1 from public.trips t
    where t.id = trip_id and t.user_id = (select auth.uid())));

create policy "shopping_lists: owner" on public.shopping_lists
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "shopping_list_items: owner" on public.shopping_list_items
  for all to authenticated
  using (exists (
    select 1 from public.shopping_lists l
    where l.id = list_id and l.user_id = (select auth.uid())))
  with check (exists (
    select 1 from public.shopping_lists l
    where l.id = list_id and l.user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Points: read own only. Awarded by security-definer functions (phase 7).
-- ---------------------------------------------------------------------------
create policy "point_events: read own" on public.point_events
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Analytics: users may log their own events; only admins can read.
-- ---------------------------------------------------------------------------
create policy "events: insert own" on public.events
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "events: admin read" on public.events
  for select to authenticated
  using ((select public.is_admin()));
