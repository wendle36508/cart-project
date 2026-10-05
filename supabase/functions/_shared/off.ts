// Open Food Facts lookup. Food is checked first; if it is not there we try the
// sister databases (household products, beauty, pet food), which tells us the
// item is non-food and therefore taxable in MA.
//
// Open Food Facts asks every app to send a descriptive User-Agent.
// https://openfoodfacts.github.io/openfoodfacts-server/api/

import { classifyOffProduct, type ClassifiedProduct, type OffDatabase, type OffProduct } from './classify.ts';

const HOSTS: Record<OffDatabase, string> = {
  food: 'world.openfoodfacts.org',
  products: 'world.openproductsfacts.org',
  beauty: 'world.openbeautyfacts.org',
  petfood: 'world.openpetfoodfacts.org',
};

const FIELDS = [
  'code', 'product_name', 'product_name_en', 'generic_name', 'generic_name_en',
  'brands', 'quantity', 'serving_size', 'categories_tags', 'image_front_small_url',
  'image_front_url', 'image_url', 'nutriments',
].join(',');

const USER_AGENT = 'CartCheck/0.1 (https://github.com/wendle36508/cart-project)';
const TIMEOUT_MS = 4000;

export type OffLookup =
  | { status: 'found'; product: ClassifiedProduct }
  // The database has the barcode but no name, so we still need the shopper's help.
  | { status: 'unnamed'; database: OffDatabase }
  | { status: 'not_found' }
  // A database could not be reached; don't cache this as a miss.
  | { status: 'unavailable' };

async function fetchOne(db: OffDatabase, barcode: string): Promise<OffProduct | null | 'error'> {
  try {
    const res = await fetch(`https://${HOSTS[db]}/api/v2/product/${barcode}.json?fields=${FIELDS}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 404 with {status: 0} means "not in this database".
    if (res.status === 404) return null;
    if (!res.ok) return 'error';
    const body = (await res.json()) as { status?: number; product?: OffProduct };
    return body.status === 1 && body.product ? body.product : null;
  } catch {
    return 'error';
  }
}

export async function lookupOpenFoodFacts(barcode: string): Promise<OffLookup> {
  const food = await fetchOne('food', barcode);
  if (food !== null && food !== 'error') {
    const product = classifyOffProduct(barcode, 'food', food);
    return product ? { status: 'found', product } : { status: 'unnamed', database: 'food' };
  }

  // Not food (or food DB down): ask the sister databases in parallel.
  const others: OffDatabase[] = ['products', 'beauty', 'petfood'];
  const results = await Promise.all(others.map((db) => fetchOne(db, barcode)));
  for (let i = 0; i < others.length; i++) {
    const record = results[i];
    if (record === null || record === 'error') continue;
    const product = classifyOffProduct(barcode, others[i], record);
    return product ? { status: 'found', product } : { status: 'unnamed', database: others[i] };
  }

  const anyError = food === 'error' || results.includes('error');
  return anyError ? { status: 'unavailable' } : { status: 'not_found' };
}
