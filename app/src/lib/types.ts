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
