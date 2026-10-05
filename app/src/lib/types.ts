// Row types for the tables the app reads. Hand-written for now; once the
// hosted project is linked, replace with `supabase gen types typescript`.

export type Chain = {
  id: string;
  name: string;
  online_source: string | null;
};

export type StoreLocation = {
  id: string;
  chain_id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  is_pilot: boolean;
};

export type Trip = {
  id: string;
  user_id: string;
  store_id: string;
  budget_cents: number | null;
  status: 'active' | 'completed' | 'abandoned';
  started_at: string;
};

export type TaxCategory = 'food' | 'alcohol' | 'prepared_food' | 'non_food' | 'unknown';

/** Columns returned by the lookup-product Edge Function. */
export type Product = {
  barcode: string;
  name: string;
  brand: string | null;
  size_text: string | null;
  category: string | null;
  image_url: string | null;
  tax_category: TaxCategory;
  deposit_cents: number;
  is_weighed: boolean;
  is_essential: boolean;
};

export type TripItem = {
  id: string;
  trip_id: string;
  barcode: string;
  quantity: number;
  unit_price_cents: number | null;
  added_at: string;
  products: Pick<Product, 'name' | 'brand' | 'size_text' | 'image_url'> | null;
};
