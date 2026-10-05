// Unit tests for the Edge Function shared code (barcode normalization and
// Open Food Facts classification). Runs in Node via tsx; no Deno needed.
//
//   npm run test:functions           offline checks only
//   npm run test:functions -- --live also looks up real barcodes on Open Food Facts

import { expandUpcE, normalizeBarcode } from '../supabase/functions/_shared/barcode.ts';
import { classifyOffProduct, containerCount } from '../supabase/functions/_shared/classify.ts';
import { lookupOpenFoodFacts } from '../supabase/functions/_shared/off.ts';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  if (!ok) failures++;
};

// --- Barcodes ---------------------------------------------------------------
// Diet Coke 12 oz can: UPC-A 049000028911.
check('UPC-A pads to GTIN-13', normalizeBarcode('049000028911', 'upc_a'), '0049000028911');
check('iOS-style EAN-13 of a UPC-A is unchanged', normalizeBarcode('0049000028911', 'ean13'), '0049000028911');
check('spaces and dashes are ignored', normalizeBarcode('0 49000-02891 1'), '0049000028911');
check('bad check digit rejected', normalizeBarcode('049000028912'), null);
check('letters rejected', normalizeBarcode('04900002891A'), null);
check('wrong length rejected', normalizeBarcode('12345'), null);
// UPC-E 04252614 expands to 042100005264 (standard GS1 example).
check('UPC-E expands to UPC-A', expandUpcE('04252614'), '042100005264');
check('UPC-E normalizes to GTIN-13', normalizeBarcode('04252614', 'upc_e'), '0042100005264');
check('UPC-E with bad check digit rejected', expandUpcE('04252615'), null);
check('6-digit UPC-E body accepted', normalizeBarcode('425261'), '0042100005264');
check('EAN-8 kept when scanner says so', normalizeBarcode('96385074', 'ean8'), '96385074');
check('GTIN-14 with leading 0 reduces to GTIN-13', normalizeBarcode('00049000028911'), '0049000028911');

// --- Deposit container count -------------------------------------------------
check('12 x 355 ml', containerCount('12 x 355 ml'), 12);
check('6 × 12 fl oz', containerCount('6 × 12 fl oz'), 6);
check('24-pack', containerCount('24-pack'), 24);
check('2 L bottle', containerCount('2 L'), 1);
check('no quantity', containerCount(null), 1);
check('144 fl oz of 12 oz cans = 12', containerCount('144 fl oz', '1 can (354.9 mL)'), 12);
check('2 L bottle with 12 oz serving stays 1', containerCount('2 L', '12 fl oz'), 1);
check('count from name', containerCount('12 fl oz', null, 'Coca-Cola 12 pack'), 12);

// --- Name fallback when a record has no categories ----------------------------
const bud = classifyOffProduct('1', 'food', { product_name: 'Budweiser 355ml can' });
check('uncategorized Budweiser is alcohol', bud?.tax_category, 'alcohol');
check('uncategorized Budweiser has deposit', bud?.deposit_cents, 5);
const rootBeer = classifyOffProduct('1', 'food', { product_name: 'A&W Root Beer' });
check('root beer is food, not beer', [rootBeer?.tax_category, rootBeer?.deposit_cents], ['food', 5]);
const seltzer = classifyOffProduct('1', 'food', { product_name: 'White Claw Hard Seltzer Black Cherry' });
check('hard seltzer is alcohol', seltzer?.tax_category, 'alcohol');
const kale = classifyOffProduct('1', 'food', { product_name: 'Kale chips', nutriments: { 'energy-kcal_100g': 500 } });
check('"kale" is not ale', [kale?.tax_category, kale?.deposit_cents], ['food', 0]);

// --- Classification -----------------------------------------------------------
const soda = classifyOffProduct('0049000028911', 'food', {
  product_name: 'Diet Coke', brands: 'Coke, Coca-Cola', quantity: '12 x 12 fl oz',
  categories_tags: ['en:beverages', 'en:non-alcoholic-beverages', 'en:carbonated-drinks', 'en:sodas'],
});
check('soda is tax-exempt food', soda?.tax_category, 'food');
check('soda 12-pack deposit is 60¢', soda?.deposit_cents, 60);
check('soda category', soda?.category, 'beverages');
check('first brand only', soda?.brand, 'Coke');

const beer = classifyOffProduct('0018200000164', 'food', {
  product_name: 'Bud Light', quantity: '6 x 12 fl oz', categories_tags: ['en:beverages', 'en:alcoholic-beverages', 'en:beers'],
});
check('beer is alcohol', beer?.tax_category, 'alcohol');
check('beer 6-pack deposit is 30¢', beer?.deposit_cents, 30);

const naBeer = classifyOffProduct('1', 'food', {
  product_name: 'Athletic Run Wild', categories_tags: ['en:beverages', 'en:beers', 'en:non-alcoholic-beers'],
});
check('non-alcoholic beer is food', naBeer?.tax_category, 'food');

const wine = classifyOffProduct('1', 'food', { product_name: 'Red wine', categories_tags: ['en:alcoholic-beverages', 'en:wines'] });
check('wine has no MA deposit', wine?.deposit_cents, 0);

const water = classifyOffProduct('1', 'food', { product_name: 'Spring water', categories_tags: ['en:beverages', 'en:waters', 'en:spring-waters'] });
check('still water has no deposit', water?.deposit_cents, 0);

const towels = classifyOffProduct('1', 'products', { product_name: 'Bounty paper towels' });
check('household product is taxable', towels?.tax_category, 'non_food');
check('household category', towels?.category, 'household');

const dogFood = classifyOffProduct('1', 'food', { product_name: 'Kibble', categories_tags: ['en:pet-foods', 'en:dog-foods'] });
check('pet food in food DB is taxable', dogFood?.tax_category, 'non_food');
check('pet food category', dogFood?.category, 'pet');

const vitamins = classifyOffProduct('1', 'food', { product_name: 'Multivitamin', categories_tags: ['en:dietary-supplements'] });
check('supplements err high (unknown = taxed)', vitamins?.tax_category, 'unknown');

const bare = classifyOffProduct('1', 'food', { product_name: 'Mystery item' });
check('no categories, no nutrition -> unknown', bare?.tax_category, 'unknown');
const bareWithNutrition = classifyOffProduct('1', 'food', { product_name: 'Granola', nutriments: { 'energy-kcal_100g': 450 } });
check('no categories but nutrition facts -> food', bareWithNutrition?.tax_category, 'food');

const milk = classifyOffProduct('1', 'food', { product_name: 'Whole milk', categories_tags: ['en:dairies', 'en:milks'] });
check('milk is essential', milk?.is_essential, true);
check('milk category', milk?.category, 'dairy');

check('unnamed record returns null', classifyOffProduct('1', 'food', { brands: 'X' }), null);

// --- Live lookups (optional) ---------------------------------------------------
if (process.argv.includes('--live')) {
  const live = await lookupOpenFoodFacts('0049000028911');
  check('live: Diet Coke found', live.status, 'found');
  if (live.status === 'found') {
    console.log(`      -> ${live.product.name} | ${live.product.size_text} | ${live.product.tax_category} | deposit ${live.product.deposit_cents}¢`);
    check('live: Diet Coke 12-pack is tax-exempt with 60¢ deposit', [live.product.tax_category, live.product.deposit_cents], ['food', 60]);
  }
  const liveBud = await lookupOpenFoodFacts('0018200000164');
  if (liveBud.status === 'found') {
    console.log(`      -> ${liveBud.product.name} | ${liveBud.product.tax_category} | deposit ${liveBud.product.deposit_cents}¢`);
    check('live: uncategorized Budweiser is alcohol', liveBud.product.tax_category, 'alcohol');
  }
  check('live: made-up barcode not found', (await lookupOpenFoodFacts('0000000000017')).status, 'not_found');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
