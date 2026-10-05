// get-price: best current price for one item at one store.
//
// POST { barcode, store_id }
// -> { price: CurrentPrice | null, online_source: string | null }
//
// In-store prices (shelf tags, receipts, admin) always win; see
// current_prices() in the price_resolution migration. Only when there is no
// in-store price do we ask the chain's online source, at most once a day per
// item and store, and store the answer as a tier='online' price so the app
// labels it as online.

import { createClient } from '@supabase/supabase-js';

import { normalizeBarcode } from '../_shared/barcode.ts';
import { SOURCES } from '../_sources/index.ts';

const ONLINE_TTL_MS = 24 * 60 * 60 * 1000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const env = (name: string) => Deno.env.get(name);

const isFresh = (iso: string | null | undefined) => !!iso && Date.now() - new Date(iso).getTime() < ONLINE_TTL_MS;

async function bestPrice(storeId: string, barcode: string) {
  const { data, error } = await admin.rpc('current_prices', { p_store_id: storeId, p_barcodes: [barcode] });
  if (error) throw error;
  return (data as { tier: string; last_seen_at: string }[])[0] ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: { barcode?: unknown; store_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const barcode = typeof body.barcode === 'string' ? normalizeBarcode(body.barcode) : null;
  const storeId = typeof body.store_id === 'string' ? body.store_id : null;
  if (!barcode || !storeId) return json({ error: 'barcode and store_id are required' }, 400);

  try {
    const { data: store, error: storeError } = await admin
      .from('store_locations')
      .select('id, external_store_id, chains(online_source)')
      .eq('id', storeId)
      .maybeSingle();
    if (storeError) throw storeError;
    if (!store) return json({ error: 'Unknown store' }, 404);

    const sourceId = (store.chains as unknown as { online_source: string | null } | null)?.online_source ?? null;
    const source = sourceId ? SOURCES[sourceId] : undefined;
    const usable = !!source && source.isConfigured(env) && (!source.needsStoreId || !!store.external_store_id);

    const current = await bestPrice(storeId, barcode);
    // Done if we have an in-store price, an online price from today, or no
    // online source to ask.
    if (!usable || current?.tier === 'in_store' || (current?.tier === 'online' && isFresh(current.last_seen_at))) {
      return json({ price: current, online_source: usable ? sourceId : null });
    }

    // Already asked today and the chain didn't have it.
    const { data: check } = await admin
      .from('online_price_checks')
      .select('checked_at')
      .eq('barcode', barcode)
      .eq('store_id', storeId)
      .maybeSingle();
    if (isFresh(check?.checked_at)) return json({ price: current, online_source: sourceId });

    // The product must exist (prices reference products); lookup-product creates it on scan.
    const { count } = await admin.from('products').select('barcode', { count: 'exact', head: true }).eq('barcode', barcode);
    if (!count) return json({ price: null, online_source: sourceId });

    let online;
    try {
      online = await source!.fetchPrice({ gtin13: barcode, externalStoreId: store.external_store_id }, env);
    } catch (e) {
      // Source down: show whatever we had (possibly an older online price).
      console.error(`online source ${sourceId} failed`, barcode, e);
      return json({ price: current, online_source: sourceId });
    }

    const now = new Date().toISOString();
    await admin
      .from('online_price_checks')
      .upsert({ barcode, store_id: storeId, source: sourceId, found: !!online, checked_at: now });

    if (online) {
      // Audit log, like every other price observation.
      await admin.from('price_submissions').insert({
        barcode,
        store_id: storeId,
        source: 'online',
        price_cents: online.price_cents,
        price_unit: online.price_unit,
        is_sale: online.is_sale,
        regular_price_cents: online.regular_price_cents,
      });

      const row = { barcode, store_id: storeId, tier: 'online', source: 'online', price_unit: online.price_unit, last_seen_at: now };
      const regularCents = online.is_sale ? online.regular_price_cents : online.price_cents;
      const writes = [];
      if (regularCents) {
        writes.push(admin.from('prices').upsert({ ...row, is_sale: false, price_cents: regularCents }, { onConflict: 'barcode,store_id,tier,is_sale' }));
      }
      writes.push(
        online.is_sale
          ? admin.from('prices').upsert({ ...row, is_sale: true, price_cents: online.price_cents }, { onConflict: 'barcode,store_id,tier,is_sale' })
          : // Sale is over: drop the old online sale row.
            admin.from('prices').delete().match({ barcode, store_id: storeId, tier: 'online', is_sale: true }),
      );
      for (const { error } of await Promise.all(writes)) if (error) throw error;
    }

    return json({ price: await bestPrice(storeId, barcode), online_source: sourceId });
  } catch (e) {
    console.error('get-price failed', barcode, storeId, e);
    return json({ error: 'Price lookup failed' }, 500);
  }
});
