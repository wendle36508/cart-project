// Adding and removing scanned items on a trip. Scanning the same item again
// bumps the quantity on its existing line instead of adding a duplicate.
import { supabase } from './supabase';

export type AddResult = { itemId: string; quantity: number; isNewLine: boolean };

export async function addToTrip(tripId: string, barcode: string): Promise<AddResult> {
  const { data: existing, error: findError } = await supabase
    .from('trip_items')
    .select('id, quantity')
    .eq('trip_id', tripId)
    .eq('barcode', barcode)
    .is('removed_at', null)
    .maybeSingle();
  if (findError) throw findError;

  if (existing) {
    const quantity = existing.quantity + 1;
    const { error } = await supabase.from('trip_items').update({ quantity }).eq('id', existing.id);
    if (error) throw error;
    return { itemId: existing.id, quantity, isNewLine: false };
  }

  const { data, error } = await supabase
    .from('trip_items')
    .insert({ trip_id: tripId, barcode })
    .select('id')
    .single();
  if (error) throw error;
  return { itemId: data.id, quantity: 1, isNewLine: true };
}

/** Undo an accidental scan: drop the new line, or take one back off the quantity. */
export async function undoAdd(added: AddResult): Promise<void> {
  const { error } = added.isNewLine
    ? await supabase.from('trip_items').delete().eq('id', added.itemId)
    : await supabase.from('trip_items').update({ quantity: added.quantity - 1 }).eq('id', added.itemId);
  if (error) throw error;
}

export async function setQuantity(itemId: string, quantity: number): Promise<void> {
  const { error } = await supabase.from('trip_items').update({ quantity }).eq('id', itemId);
  if (error) throw error;
}

/** "Put back": the line is kept with removed_at set, for analytics. */
export async function putBack(itemId: string): Promise<void> {
  const { error } = await supabase
    .from('trip_items')
    .update({ removed_at: new Date().toISOString() })
    .eq('id', itemId);
  if (error) throw error;
}
