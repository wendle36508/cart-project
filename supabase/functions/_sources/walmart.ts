// Walmart affiliate API (walmart.io; requires an approved affiliate account).
// https://walmart.io/docs/affiliate/product-lookup
// Prices are Walmart.com's national online price, not a specific store's,
// which is exactly why the app labels every online price as online.
//
// Secrets:
//   WALMART_CONSUMER_ID   from the walmart.io dashboard
//   WALMART_KEY_VERSION   key version shown next to your uploaded public key
//   WALMART_PRIVATE_KEY   the matching RSA private key, PKCS#8 PEM
//                         ("-----BEGIN PRIVATE KEY-----")

import { toCents, type Env, type FetchFn, type PriceSource } from './types.ts';

const LOOKUP_URL = 'https://developer.api.walmart.com/api-proxy/service/affil/product/v2/items';

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function toBase64(buf: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
}

/**
 * Walmart's auth headers: an RSA-SHA256 (PKCS#1 v1.5) signature over
 * "consumerId\ntimestamp\nkeyVersion\n", valid for 180 seconds.
 */
export async function walmartHeaders(env: Env, now = Date.now()): Promise<Record<string, string>> {
  const consumerId = env('WALMART_CONSUMER_ID')!;
  const keyVersion = env('WALMART_KEY_VERSION')!;
  const timestamp = String(now);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    // Secrets set from a one-line string carry literal "\n" sequences.
    pemToDer(env('WALMART_PRIVATE_KEY')!.replace(/\\n/g, '\n')),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const payload = new TextEncoder().encode(`${consumerId}\n${timestamp}\n${keyVersion}\n`);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, payload);
  return {
    'WM_CONSUMER.ID': consumerId,
    'WM_CONSUMER.INTIMESTAMP': timestamp,
    'WM_SEC.KEY_VERSION': keyVersion,
    'WM_SEC.AUTH_SIGNATURE': toBase64(signature),
    Accept: 'application/json',
  };
}

export const walmart: PriceSource = {
  id: 'walmart',
  needsStoreId: false,

  isConfigured: (env) =>
    !!env('WALMART_CONSUMER_ID') && !!env('WALMART_KEY_VERSION') && !!env('WALMART_PRIVATE_KEY'),

  async fetchPrice({ gtin13 }, env, fetchFn = fetch) {
    // Walmart looks items up by 12-digit UPC-A; EAN-only items aren't sold there.
    if (!gtin13.startsWith('0')) return null;
    const upc = gtin13.slice(1);

    const res = await fetchFn(`${LOOKUP_URL}?upc=${upc}`, { headers: await walmartHeaders(env) });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`Walmart lookup failed: ${res.status}`);

    const body = (await res.json()) as { items?: { salePrice?: number }[] };
    const price = toCents(body.items?.[0]?.salePrice);
    // Walmart's "salePrice" is simply its current price; no separate regular
    // price is given, so it is stored as a regular online price.
    return price === null ? null : { price_cents: price, regular_price_cents: null, is_sale: false, price_unit: 'each' };
  },
};
