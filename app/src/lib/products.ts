// Barcode -> product, via the lookup-product Edge Function. The function owns
// barcode normalization, the Open Food Facts lookup and tax classification,
// so the app only passes along what the scanner read.
import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from './supabase';
import type { Product } from './types';

/** Tax types a shopper can pick when naming an item we couldn't find. */
export type ManualTaxCategory = 'food' | 'non_food' | 'alcohol';

export type LookupResult =
  | { status: 'found'; product: Product }
  | { status: 'needs_name'; barcode: string }
  | { status: 'unavailable'; barcode: string }
  | { status: 'invalid' };

export async function lookupProduct(
  barcode: string,
  type?: string,
  manual?: { name: string; tax_category: ManualTaxCategory },
): Promise<LookupResult> {
  const { data, error } = await supabase.functions.invoke<LookupResult>('lookup-product', {
    body: { barcode, type, manual },
  });
  if (error) {
    // 4xx/5xx carry a JSON { error } message worth showing.
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.json().catch(() => null);
      throw new Error(body?.error ?? 'Lookup failed');
    }
    throw new Error("Can't reach CartCheck. Check your connection.");
  }
  return data!;
}
