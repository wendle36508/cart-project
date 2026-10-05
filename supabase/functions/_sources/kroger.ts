// Kroger Developer API (free; OAuth2 client credentials, scope product.compact).
// https://developer.kroger.com
// Returns store-level regular and promo prices when given a locationId.
//
// Secrets: KROGER_CLIENT_ID, KROGER_CLIENT_SECRET
// Store setup: store_locations.external_store_id = Kroger locationId

import { toCents, type Env, type FetchFn, type PriceSource } from './types.ts';

const API = 'https://api.kroger.com/v1';

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(env: Env, fetchFn: FetchFn): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;
  const basic = btoa(`${env('KROGER_CLIENT_ID')}:${env('KROGER_CLIENT_SECRET')}`);
  const res = await fetchFn(`${API}/connect/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=product.compact',
  });
  if (!res.ok) throw new Error(`Kroger token request failed: ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  // Refresh a minute early.
  cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
  return body.access_token;
}

/** For tests. */
export function resetKrogerToken() {
  cachedToken = null;
}

/**
 * Kroger product ids are 13 digits: the GTIN without its check digit,
 * left-padded with zeros (UPC 0 11110 41700 5 -> 0001111041700). Some
 * listings use the full GTIN-13, so try both.
 */
export function krogerProductIds(gtin13: string): string[] {
  const withoutCheck = gtin13.slice(0, -1).padStart(13, '0');
  return withoutCheck === gtin13 ? [gtin13] : [withoutCheck, gtin13];
}

type KrogerItem = {
  price?: { regular?: number; promo?: number };
  soldBy?: string; // 'UNIT' | 'WEIGHT'
};

export const kroger: PriceSource = {
  id: 'kroger',
  needsStoreId: true,

  isConfigured: (env) => !!env('KROGER_CLIENT_ID') && !!env('KROGER_CLIENT_SECRET'),

  async fetchPrice({ gtin13, externalStoreId }, env, fetchFn = fetch) {
    if (!externalStoreId) return null;
    const token = await getToken(env, fetchFn);

    for (const productId of krogerProductIds(gtin13)) {
      const res = await fetchFn(
        `${API}/products/${productId}?filter.locationId=${encodeURIComponent(externalStoreId)}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      );
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`Kroger product request failed: ${res.status}`);

      const body = (await res.json()) as { data?: { items?: KrogerItem[] } };
      const item = body.data?.items?.find((i) => toCents(i.price?.regular) !== null);
      if (!item) return null; // listed, but not priced or sold at this store

      const regular = toCents(item.price!.regular)!;
      const promo = toCents(item.price!.promo);
      const onSale = promo !== null && promo < regular;
      return {
        price_cents: onSale ? promo : regular,
        regular_price_cents: onSale ? regular : null,
        is_sale: onSale,
        price_unit: item.soldBy === 'WEIGHT' ? 'lb' : 'each',
      };
    }
    return null;
  },
};
