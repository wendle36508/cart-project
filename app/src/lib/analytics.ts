// First-party analytics: events go to our own `events` table, tagged only with
// the pseudonymous auth user id. No third-party SDKs, no device fingerprinting.
import { supabase } from './supabase';

export type EventName =
  | 'app_opened'
  | 'trip_started'
  | 'trip_completed'
  | 'item_scanned'
  | 'price_contributed'
  | 'online_price_replaced'
  | 'price_confirmed'
  | 'receipt_scanned'
  | 'list_estimated';

/** Fire-and-forget; analytics must never block or break the shopping flow. */
export function track(name: EventName, opts: { storeId?: string; props?: Record<string, unknown> } = {}) {
  void (async () => {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return;
    await supabase.from('events').insert({
      user_id: userId,
      name,
      store_id: opts.storeId ?? null,
      props: opts.props ?? {},
    });
  })().catch(() => {});
}
