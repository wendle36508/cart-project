// Applies every migration in supabase/migrations to an in-memory Postgres
// (PGlite) with a minimal stub of Supabase's auth schema, then runs RLS smoke
// tests. No Docker or hosted project required.
//
//   node scripts/test-migrations.mjs

import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../supabase/migrations/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const db = new PGlite();

// Minimal stand-ins for what Supabase provides.
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
`);

for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(join(dir, file), 'utf8'));
  console.log(`applied ${file}`);
}

let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
};

const alice = '00000000-0000-0000-0000-00000000000a';
const bob = '00000000-0000-0000-0000-00000000000b';
await db.exec(`insert into auth.users (id) values ('${alice}'), ('${bob}');`);
check('profiles auto-created', (await db.query('select count(*)::int n from public.profiles')).rows[0].n === 2);

const store = (await db.query(`select id from public.store_locations where chain_id = 'target'`)).rows[0].id;
await db.exec(`insert into public.products (barcode, name, tax_category) values ('012345678905', 'Test Ramen', 'food')`);

// Run SQL as a given user through RLS. Returns null on success, error text on failure.
async function asUser(uid, sql) {
  try {
    await db.exec(`begin; set local role authenticated;
      select set_config('request.jwt.claim.sub', '${uid}', true); ${sql}; commit;`);
    return null;
  } catch (e) {
    await db.exec('rollback');
    return e.message;
  }
}
async function countAs(uid, sql) {
  await db.exec(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);`);
  const n = (await db.query(sql)).rows[0].n;
  await db.exec('rollback');
  return n;
}

check('user can read stores', (await countAs(alice, 'select count(*)::int n from public.store_locations')) === 3);
check('user can start own trip',
  (await asUser(alice, `insert into public.trips (user_id, store_id) values ('${alice}', '${store}')`)) === null);
check('user cannot create trip for someone else',
  (await asUser(alice, `insert into public.trips (user_id, store_id) values ('${bob}', '${store}')`)) !== null);
check("user cannot see another user's trips",
  (await countAs(bob, 'select count(*)::int n from public.trips')) === 0);
check('user can submit an in-store tag price',
  (await asUser(alice, `insert into public.price_submissions (barcode, store_id, user_id, source, price_cents)
    values ('012345678905', '${store}', '${alice}', 'in_store_tag', 129)`)) === null);
check('user cannot submit an "online" price',
  (await asUser(alice, `insert into public.price_submissions (barcode, store_id, user_id, source, price_cents)
    values ('012345678905', '${store}', '${alice}', 'online', 99)`)) !== null);
check('user cannot write prices directly',
  (await asUser(alice, `insert into public.prices (barcode, store_id, tier, source, price_cents)
    values ('012345678905', '${store}', 'in_store', 'in_store_tag', 129)`)) !== null);
check('user cannot grant themselves points',
  (await asUser(alice, `update public.profiles set points = 9999 where id = '${alice}'`)) !== null);
check('user can set display name',
  (await asUser(alice, `update public.profiles set display_name = 'Al' where id = '${alice}'`)) === null);
check('user cannot make themselves admin',
  (await asUser(alice, `update public.profiles set role = 'admin' where id = '${alice}'`)) !== null);
check('user can log own analytics event',
  (await asUser(alice, `insert into public.events (user_id, name) values ('${alice}', 'app_opened')`)) === null);
check('user cannot read analytics', (await countAs(alice, 'select count(*)::int n from public.events')) === 0);

await db.exec(`update public.profiles set role = 'admin' where id = '${bob}'`);
check('admin can write prices',
  (await asUser(bob, `insert into public.prices (barcode, store_id, tier, source, price_cents)
    values ('012345678905', '${store}', 'online', 'online', 119)`)) === null);
check('admin can read analytics', (await countAs(bob, 'select count(*)::int n from public.events')) === 1);
check('online tier must use online source',
  (await asUser(bob, `insert into public.prices (barcode, store_id, tier, source, price_cents, is_sale)
    values ('012345678905', '${store}', 'online', 'admin', 119, true)`)) !== null);

// Phase 2: products and the lookup-miss cache are written only by the
// lookup-product Edge Function (service role).
check('user cannot add products directly',
  (await asUser(alice, `insert into public.products (barcode, name) values ('0049000028911', 'Diet Coke')`)) !== null);
check('user can add a scanned item to own trip',
  (await asUser(alice, `insert into public.trip_items (trip_id, barcode)
    select id, '012345678905' from public.trips where user_id = '${alice}' limit 1`)) === null);
await db.exec(`insert into public.product_lookup_misses (barcode) values ('0000000000017')`);
check('user cannot read lookup misses',
  (await countAs(alice, 'select count(*)::int n from public.product_lookup_misses')) === 0);
check('user cannot write lookup misses',
  (await asUser(alice, `insert into public.product_lookup_misses (barcode) values ('0000000000024')`)) !== null);

// Phase 3: price resolution. In-store beats online; within a tier an active
// sale beats the regular price; ended sales are ignored.
async function bestAs(uid, barcodes) {
  await db.exec(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);`);
  const list = barcodes.map((b) => `'${b}'`).join(',');
  const rows = (await db.query(
    `select barcode, tier, price_cents, is_sale, regular_price_cents
       from public.current_prices('${store}', array[${list}]::text[]) order by barcode`)).rows;
  await db.exec('rollback');
  return rows;
}
const P = { a: '0000000000031', b: '0000000000048', c: '0000000000055', d: '0000000000062' };
await db.exec(`
  insert into public.products (barcode, name) values
    ('${P.a}', 'A'), ('${P.b}', 'B'), ('${P.c}', 'C'), ('${P.d}', 'D');
  insert into public.prices (barcode, store_id, tier, source, is_sale, price_cents, sale_end_date) values
    -- A: online regular + online sale + in-store regular -> in-store regular
    ('${P.a}', '${store}', 'online',   'online',       false, 300, null),
    ('${P.a}', '${store}', 'online',   'online',       true,  250, null),
    ('${P.a}', '${store}', 'in_store', 'in_store_tag', false, 329, null),
    -- B: online regular + online sale -> online sale, with regular shown
    ('${P.b}', '${store}', 'online',   'online',       false, 500, null),
    ('${P.b}', '${store}', 'online',   'online',       true,  399, null),
    -- C: in-store regular + in-store sale that ended yesterday -> regular
    ('${P.c}', '${store}', 'in_store', 'in_store_tag', false, 199, null),
    ('${P.c}', '${store}', 'in_store', 'in_store_tag', true,  149, public.store_today() - 1),
    -- D: in-store sale ending today still counts
    ('${P.d}', '${store}', 'in_store', 'in_store_tag', false, 899, null),
    ('${P.d}', '${store}', 'in_store', 'in_store_tag', true,  699, public.store_today());
`);
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(ok ? label : `${label}  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, ok);
};
const best = Object.fromEntries((await bestAs(alice, Object.values(P).concat('0000000000079'))).map((r) => [r.barcode, r]));
eq('in-store price beats online (even an online sale)', [best[P.a].tier, best[P.a].price_cents], ['in_store', 329]);
eq('online sale beats online regular, regular shown alongside',
  [best[P.b].tier, best[P.b].is_sale, best[P.b].price_cents, best[P.b].regular_price_cents], ['online', true, 399, 500]);
eq('ended sale is ignored', [best[P.c].is_sale, best[P.c].price_cents], [false, 199]);
eq('sale ending today still applies', [best[P.d].is_sale, best[P.d].price_cents, best[P.d].regular_price_cents], [true, 699, 899]);
eq('barcode with no price is absent', best['0000000000079'], undefined);
check('online price checks hidden from users',
  (await countAs(alice, 'select count(*)::int n from public.online_price_checks')) === 0);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
