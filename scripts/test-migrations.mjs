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

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
