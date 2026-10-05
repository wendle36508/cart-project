// Prices for scanned items. Resolution (in-store beats online, active sales
// beat regular prices) happens in the database: see current_prices() in the
// price_resolution migration.
import { supabase } from './supabase';

export type CurrentPrice = {
  barcode: string;
  price_id: string;
  tier: 'in_store' | 'online';
  source: 'in_store_tag' | 'receipt' | 'admin' | 'online';
  price_cents: number;
  price_unit: 'each' | 'lb';
  is_sale: boolean;
  sale_end_date: string | null;
  /** Same-tier regular price, present when showing a sale price. */
  regular_price_cents: number | null;
  is_verified: boolean;
  confirmation_count: number;
  last_seen_at: string;
};

/**
 * Price for one item, asking the chain's online source if we have no
 * in-store price yet. Used right after a scan.
 */
export async function fetchPrice(barcode: string, storeId: string): Promise<CurrentPrice | null> {
  const { data, error } = await supabase.functions.invoke<{ price: CurrentPrice | null }>('get-price', {
    body: { barcode, store_id: storeId },
  });
  if (error) throw error;
  return data?.price ?? null;
}

/** Known prices for many items at once (no online lookups). Keyed by barcode. */
export async function currentPrices(storeId: string, barcodes: string[]): Promise<Record<string, CurrentPrice>> {
  if (barcodes.length === 0) return {};
  const { data, error } = await supabase.rpc('current_prices', { p_store_id: storeId, p_barcodes: barcodes });
  if (error) throw error;
  return Object.fromEntries((data as CurrentPrice[]).map((p) => [p.barcode, p]));
}
