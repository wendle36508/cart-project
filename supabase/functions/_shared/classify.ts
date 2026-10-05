// Turns an Open Food Facts (or sister database) record into a CartCheck
// product row: display fields, simplified category, MA tax category and
// bottle deposit. Pure function, no I/O. See docs/tax-rules.md.
//
// When unsure, we choose the outcome that makes the estimate err HIGH
// (taxable `unknown`) so shoppers are never surprised at the register.

/** Which Open*Facts database the record came from. */
export type OffDatabase = 'food' | 'beauty' | 'products' | 'petfood';

export type OffProduct = {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  generic_name?: string;
  generic_name_en?: string;
  brands?: string;
  quantity?: string;
  serving_size?: string;
  categories_tags?: string[];
  image_front_small_url?: string;
  image_front_url?: string;
  image_url?: string;
  nutriments?: Record<string, unknown>;
};

export type TaxCategory = 'food' | 'alcohol' | 'prepared_food' | 'non_food' | 'unknown';

export type ProductCategory =
  | 'produce' | 'dairy' | 'meat_seafood' | 'bakery' | 'frozen' | 'breakfast'
  | 'snacks' | 'beverages' | 'alcohol' | 'pantry' | 'household'
  | 'personal_care' | 'pet' | 'other';

export type ClassifiedProduct = {
  barcode: string;
  name: string;
  brand: string | null;
  size_text: string | null;
  category: ProductCategory;
  off_categories: string[];
  image_url: string | null;
  tax_category: TaxCategory;
  deposit_cents: number;
  is_essential: boolean;
  data_source: string;
};

export const MA_DEPOSIT_CENTS = 5;

const hasAny = (tags: Set<string>, list: string[]) => list.some((t) => tags.has(t));

const PET_TAGS = ['en:pet-food', 'en:pet-foods', 'en:dog-food', 'en:dog-foods', 'en:cat-food', 'en:cat-foods'];
const ALCOHOL_TAGS = [
  'en:alcoholic-beverages', 'en:beers', 'en:wines', 'en:spirits', 'en:ciders',
  'en:hard-seltzers', 'en:liqueurs', 'en:sakes', 'en:malt-beverages',
];
// MA's tax exemption covers "food products for human consumption"; whether
// a given supplement qualifies is fact-specific, so keep these taxable.
const SUPPLEMENT_TAGS = ['en:dietary-supplements', 'en:food-supplements', 'en:vitamins'];

// MA bottle bill: carbonated soft drinks, carbonated/mineral water, beer and
// other malt beverages. Not still water, juice, wine, spirits or cider.
const DEPOSIT_TAGS = [
  'en:sodas', 'en:carbonated-drinks', 'en:carbonated-soft-drinks', 'en:colas',
  'en:sparkling-waters', 'en:carbonated-waters', 'en:beers', 'en:hard-seltzers',
  'en:malt-beverages',
];
// Mixes and concentrates are not sold in a deposit container.
const NO_DEPOSIT_TAGS = ['en:drink-mixes', 'en:syrups', 'en:powdered-drinks', 'en:beverage-preparations-in-powder'];

const ESSENTIAL_TAGS = [
  'en:milks', 'en:eggs', 'en:breads', 'en:fresh-fruits', 'en:fresh-vegetables',
  'en:rices', 'en:pastas', 'en:infant-formulas', 'en:baby-foods',
];

// First match wins, so more specific groups come first.
const CATEGORY_RULES: [ProductCategory, string[]][] = [
  ['frozen', ['en:frozen-foods']],
  ['breakfast', ['en:breakfast-cereals']],
  ['dairy', ['en:dairies', 'en:milks', 'en:cheeses', 'en:yogurts', 'en:eggs', 'en:butters']],
  ['meat_seafood', ['en:meats', 'en:poultries', 'en:seafood', 'en:fishes']],
  ['bakery', ['en:breads', 'en:pastries', 'en:cakes', 'en:viennoiseries']],
  ['snacks', ['en:snacks', 'en:sweet-snacks', 'en:salty-snacks', 'en:confectioneries', 'en:chips-and-fries', 'en:biscuits', 'en:crackers']],
  ['beverages', ['en:beverages']],
  ['produce', ['en:fresh-fruits', 'en:fresh-vegetables', 'en:fruits', 'en:vegetables']],
  ['pantry', [
    'en:canned-foods', 'en:pastas', 'en:noodles', 'en:rices', 'en:sauces', 'en:condiments',
    'en:soups', 'en:spreads', 'en:cereals-and-potatoes', 'en:groceries', 'en:legumes',
  ]],
];

// Many US records have a name but no categories. For the two cases that change
// tax or deposit (beer and soda), infer categories from the name. Soda is
// checked first so "root beer" and "ginger ale" are not treated as beer.
const SODA_NAME = /\b(soda|cola|coke|pepsi|sprite|fanta|dr\.? pepper|mountain dew|root beer|ginger ale|seltzer|sparkling water|club soda|tonic water)\b/i;
const BEER_NAME = /\b(beer|lager|ipa|ale|stout|porter|pilsner|hard seltzer|budweiser|bud light|coors|miller lite|michelob|corona|heineken|modelo|white claw|truly)\b/i;
const NON_ALCOHOLIC_NAME = /\b(non-?alcoholic|alcohol[- ]free|n\/a)\b/i;

export function tagsFromName(name: string): string[] {
  if (/\bhard seltzer\b/i.test(name) || (BEER_NAME.test(name) && !SODA_NAME.test(name))) {
    return NON_ALCOHOLIC_NAME.test(name) ? ['en:beverages', 'en:non-alcoholic-beers'] : ['en:beverages', 'en:alcoholic-beverages', 'en:beers'];
  }
  if (SODA_NAME.test(name)) return ['en:beverages', 'en:carbonated-drinks'];
  return [];
}

function firstNonEmpty(...values: (string | undefined)[]): string | null {
  for (const v of values) {
    const t = v?.trim();
    if (t) return t;
  }
  return null;
}

const FL_OZ_ML = 29.5735;

/** First volume in a string, in ml: "355 ml", "1 can (354.9 mL)", "12 fl oz", "2 L". */
export function parseVolumeMl(text: string | null | undefined): number | null {
  const m = text?.toLowerCase().match(/(\d+(?:[.,]\d+)?)\s*(fl\.?\s*oz|ml|cl|l|liters?|litres?)\b/);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  const unit = m[2];
  if (unit.startsWith('fl')) return n * FL_OZ_ML;
  if (unit === 'ml') return n;
  if (unit === 'cl') return n * 10;
  return n * 1000;
}

/**
 * Number of deposit containers in a package. Reads an explicit count from the
 * printed quantity or the name ("12 x 355 ml", "6 × 12 fl oz", "24-pack"),
 * otherwise divides the total volume by the serving size when the total is
 * too big to be one bottle ("144 fl oz" with a 12 fl oz can = 12). Defaults to 1.
 */
export function containerCount(quantity: string | null, servingSize?: string | null, name?: string | null): number {
  for (const text of [quantity, name]) {
    const q = text?.toLowerCase();
    if (!q) continue;
    const match =
      q.match(/(\d{1,2})\s*[x×]\s*\d/) ??
      q.match(/(\d{1,2})\s*-?\s*(?:pack|pk|ct|count|cans|bottles)\b/);
    const n = match ? Number(match[1]) : 0;
    if (n >= 1 && n <= 48) return n;
  }

  const total = parseVolumeMl(quantity);
  const each = parseVolumeMl(servingSize);
  // The largest single soda bottle sold is 3 L.
  if (total && each && total > 3100) {
    const n = total / each;
    const rounded = Math.round(n);
    if (rounded >= 2 && rounded <= 48 && Math.abs(n - rounded) < 0.15) return rounded;
  }
  return 1;
}

export function classifyTax(db: OffDatabase, tags: Set<string>, nutriments?: Record<string, unknown>): TaxCategory {
  if (db !== 'food') return 'non_food';
  if (hasAny(tags, PET_TAGS)) return 'non_food';
  const nonAlcoholic = [...tags].some((t) => t.includes('non-alcoholic') || t.includes('alcohol-free'));
  const abv = Number(nutriments?.['alcohol_100g'] ?? nutriments?.['alcohol'] ?? 0);
  if (!nonAlcoholic && (hasAny(tags, ALCOHOL_TAGS) || abv >= 0.5)) return 'alcohol';
  if (hasAny(tags, SUPPLEMENT_TAGS)) return 'unknown';
  if (tags.size > 0) return 'food';
  // No categories at all: trust the food database only if it has nutrition facts.
  const hasNutrition = nutriments != null && ('energy-kcal_100g' in nutriments || 'energy_100g' in nutriments);
  return hasNutrition ? 'food' : 'unknown';
}

export function classifyCategory(db: OffDatabase, tags: Set<string>, tax: TaxCategory): ProductCategory {
  if (db === 'petfood' || hasAny(tags, PET_TAGS)) return 'pet';
  if (db === 'beauty') return 'personal_care';
  if (db === 'products') return 'household';
  if (tax === 'alcohol') return 'alcohol';
  for (const [category, list] of CATEGORY_RULES) {
    if (hasAny(tags, list)) return category;
  }
  return 'other';
}

/**
 * Classify a record. Returns null if it has no usable name, in which case
 * the shopper is asked to name the item.
 */
export function classifyOffProduct(barcode: string, db: OffDatabase, off: OffProduct): ClassifiedProduct | null {
  const name = firstNonEmpty(off.product_name_en, off.product_name, off.generic_name_en, off.generic_name);
  if (!name) return null;

  const offCategories = (off.categories_tags ?? []).filter((t) => typeof t === 'string');
  const tags = new Set(offCategories.length > 0 || db !== 'food' ? offCategories : tagsFromName(name));
  const tax = classifyTax(db, tags, off.nutriments);
  const sizeText = firstNonEmpty(off.quantity);

  const takesDeposit = db === 'food' && hasAny(tags, DEPOSIT_TAGS) && !hasAny(tags, NO_DEPOSIT_TAGS);

  return {
    barcode,
    name: name.slice(0, 120),
    brand: firstNonEmpty(off.brands?.split(',')[0])?.slice(0, 80) ?? null,
    size_text: sizeText?.slice(0, 40) ?? null,
    category: classifyCategory(db, tags, tax),
    off_categories: offCategories.slice(0, 40),
    image_url: firstNonEmpty(off.image_front_small_url, off.image_front_url, off.image_url),
    tax_category: tax,
    deposit_cents: takesDeposit ? MA_DEPOSIT_CENTS * containerCount(sizeText, off.serving_size, name) : 0,
    is_essential: db === 'food' && hasAny(tags, ESSENTIAL_TAGS),
    data_source: db === 'food' ? 'open_food_facts' : `open_${db}_facts`,
  };
}
