// lookup-product: turn a scanned barcode into a product row.
//
// POST { barcode, type?, manual? }
//   barcode  raw digits from the scanner or keyboard
//   type     scanner's barcode type (ean13, upc_a, upc_e, ean8), helps normalize
//   manual   { name, tax_category } when the shopper names an unknown item
//
// Responses (always 200 unless the request itself is malformed):
//   { status: 'found', product }      product is in our table (cached or new)
//   { status: 'needs_name', barcode } unknown everywhere; ask the shopper
//   { status: 'unavailable', barcode} Open Food Facts unreachable; offer manual entry
//   { status: 'invalid' }             not a valid retail barcode
//
// Products are admin-write under RLS, so this function writes with the
// service role after validating input.

import { createClient } from '@supabase/supabase-js';

import { normalizeBarcode } from '../_shared/barcode.ts';
import { lookupOpenFoodFacts } from '../_shared/off.ts';

const PRODUCT_COLUMNS =
  'barcode, name, brand, size_text, category, image_url, tax_category, deposit_cents, is_weighed, is_essential';

// Recheck Open Food Facts for a missed barcode after this long; new products
// are added there by the community all the time.
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const MANUAL_TAX = new Set(['food', 'non_food', 'alcohol']);

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

async function userIdFrom(req: Request): Promise<string | null> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  return data.user?.id ?? null;
}

async function getProduct(barcode: string) {
  const { data, error } = await admin.from('products').select(PRODUCT_COLUMNS).eq('barcode', barcode).maybeSingle();
  if (error) throw error;
  return data;
}

async function insertProduct(row: Record<string, unknown>) {
  // Another shopper may have added it a moment ago; keep whichever came first.
  const { error } = await admin.from('products').upsert(row, { onConflict: 'barcode', ignoreDuplicates: true });
  if (error) throw error;
  return getProduct(row.barcode as string);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: { barcode?: unknown; type?: unknown; manual?: { name?: unknown; tax_category?: unknown } };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (typeof body.barcode !== 'string') return json({ error: 'barcode is required' }, 400);

  const barcode = normalizeBarcode(body.barcode, typeof body.type === 'string' ? body.type : undefined);
  if (!barcode) return json({ status: 'invalid' });

  try {
    const existing = await getProduct(barcode);
    if (existing) return json({ status: 'found', product: existing });

    // Shopper is naming an item we couldn't find.
    if (body.manual) {
      const name = typeof body.manual.name === 'string' ? body.manual.name.trim().replace(/\s+/g, ' ') : '';
      const tax = body.manual.tax_category;
      if (name.length < 2 || name.length > 80 || typeof tax !== 'string' || !MANUAL_TAX.has(tax)) {
        return json({ error: 'Give the item a name (2-80 characters) and a type' }, 400);
      }
      const product = await insertProduct({
        barcode,
        name,
        tax_category: tax,
        category: tax === 'alcohol' ? 'alcohol' : tax === 'non_food' ? 'household' : 'other',
        data_source: 'user',
        created_by: await userIdFrom(req),
      });
      await admin.from('product_lookup_misses').delete().eq('barcode', barcode);
      return json({ status: 'found', product });
    }

    const { data: miss } = await admin
      .from('product_lookup_misses')
      .select('miss_count, last_checked_at')
      .eq('barcode', barcode)
      .maybeSingle();
    if (miss && Date.now() - new Date(miss.last_checked_at).getTime() < MISS_TTL_MS) {
      return json({ status: 'needs_name', barcode });
    }

    const result = await lookupOpenFoodFacts(barcode);
    if (result.status === 'found') {
      const product = await insertProduct(result.product);
      return json({ status: 'found', product });
    }
    if (result.status === 'unavailable') return json({ status: 'unavailable', barcode });

    await admin.from('product_lookup_misses').upsert({
      barcode,
      miss_count: (miss?.miss_count ?? 0) + 1,
      last_checked_at: new Date().toISOString(),
    });
    return json({ status: 'needs_name', barcode });
  } catch (e) {
    console.error('lookup-product failed', barcode, e);
    return json({ error: 'Lookup failed' }, 500);
  }
});
