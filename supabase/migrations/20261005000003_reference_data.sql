-- =============================================================================
-- Reference data: supported chains, pilot store locations, MA tax rates.
-- Kept in a migration (not seed.sql) so it ships to the hosted database.
-- =============================================================================

-- Massachusetts. See docs/tax-rules.md for sources and caveats.
insert into public.tax_regions (id, state, name, notes) values
  ('MA', 'MA', 'Massachusetts (statewide)',
   'Food incl. candy & soft drinks exempt (M.G.L. c.64H §6(h)). Package alcohol has no sales tax (2010 Question 1). '
   || 'Prepared meals: 6.25% + optional 0.75% local meals tax; add a town region if a pilot store sells hot food.');

insert into public.tax_rates (region_id, category, rate_bps) values
  ('MA', 'food',          0),
  ('MA', 'alcohol',       0),
  ('MA', 'prepared_food', 625),
  ('MA', 'non_food',      625),
  ('MA', 'unknown',       625);  -- unclassified items assumed taxable so totals err high

-- Supported chains. online_source names a price-source adapter in
-- supabase/functions/_sources (null = no legitimate online source yet).
insert into public.chains (id, name, online_source) values
  ('walmart',        'Walmart',          'walmart'),
  ('target',         'Target',           null),
  ('stop_and_shop',  'Stop & Shop',      null),
  ('shaws',          'Shaw''s',          null),
  ('hannaford',      'Hannaford',        null),
  ('whole_foods',    'Whole Foods',      null),
  ('trader_joes',    'Trader Joe''s',    null),
  ('aldi',           'Aldi',             null),
  ('kroger',         'Kroger',           'kroger'),
  ('market_basket',  'Market Basket',    null);

-- Pilot stores near Babson College. Coordinates intentionally left null until
-- verified; the app does not need them for the pilot.
insert into public.store_locations
  (chain_id, name, address, city, state, zip, tax_region_id, is_pilot) values
  ('target',        'Target Framingham',    '400 Cochituate Rd',  'Framingham', 'MA', '01701', 'MA', true),
  ('stop_and_shop', 'Stop & Shop Natick',   '829 Worcester St',   'Natick',     'MA', '01760', 'MA', true),
  ('trader_joes',   'Trader Joe''s Needham', '958 Highland Ave',  'Needham',    'MA', '02494', 'MA', true);
