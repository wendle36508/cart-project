// Contract every online price source implements. Adding a chain means one new
// adapter file, an entry in index.ts, and setting chains.online_source.
//
// Rule: adapters use official APIs or licensed data only. No scraping.

/** Reads a secret, e.g. Deno.env.get. Injected so adapters are testable in Node. */
export type Env = (name: string) => string | undefined;

export type FetchFn = typeof fetch;

export type OnlinePriceQuery = {
  /** Canonical 13-digit barcode (see _shared/barcode.ts). */
  gtin13: string;
  /** The chain's own id for the store (store_locations.external_store_id), if any. */
  externalStoreId: string | null;
};

export type OnlinePrice = {
  /** Price the shopper would pay now (the sale price when on sale). */
  price_cents: number;
  /** Regular price when the item is on sale. */
  regular_price_cents: number | null;
  is_sale: boolean;
  price_unit: 'each' | 'lb';
};

export interface PriceSource {
  /** Matches chains.online_source. */
  id: string;
  /** Prices differ per store, so the store must have an external_store_id. */
  needsStoreId: boolean;
  /** True when all required secrets are set. Unconfigured sources are skipped. */
  isConfigured(env: Env): boolean;
  /** Null when the chain doesn't carry the item (or has no price for it). Throws on API errors. */
  fetchPrice(query: OnlinePriceQuery, env: Env, fetchFn?: FetchFn): Promise<OnlinePrice | null>;
}

/** Dollars (as the APIs return them) to integer cents. */
export function toCents(dollars: unknown): number | null {
  const n = typeof dollars === 'string' ? Number(dollars) : dollars;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  // toFixed first: 1.005 * 100 is 100.49999999999999 in floating point.
  return Math.round(Number((n * 100).toFixed(6)));
}
