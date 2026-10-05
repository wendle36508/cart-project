// Active trip screen: what's in the cart with each item's price (labeled
// in-store or online), quantity controls and a big Scan button. The running
// total arrives in phase 5.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PriceTag } from '@/components/PriceTag';
import { putBack, setQuantity } from '@/lib/cart';
import { formatCents } from '@/lib/money';
import { currentPrices, type CurrentPrice } from '@/lib/prices';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import type { TripItem } from '@/lib/types';

type TripWithStore = {
  id: string;
  store_id: string;
  budget_cents: number | null;
  store_locations: { name: string } | null;
};

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [trip, setTrip] = useState<TripWithStore | null>(null);
  const [items, setItems] = useState<TripItem[]>([]);
  const [prices, setPrices] = useState<Record<string, CurrentPrice> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [t, i] = await Promise.all([
      supabase.from('trips').select('id, store_id, budget_cents, store_locations(name)').eq('id', id).single(),
      supabase
        .from('trip_items')
        .select('id, trip_id, barcode, quantity, unit_price_cents, added_at, products(name, brand, size_text, image_url)')
        .eq('trip_id', id)
        .is('removed_at', null)
        .order('added_at', { ascending: false }),
    ]);
    setError(t.error?.message ?? i.error?.message ?? null);
    if (t.data) setTrip(t.data as unknown as TripWithStore);
    const loaded = (i.data ?? []) as unknown as TripItem[];
    setItems(loaded);
    if (t.data) {
      try {
        setPrices(await currentPrices(t.data.store_id, loaded.map((it) => it.barcode)));
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }, [id]);

  // Reload whenever we come back from the scanner.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function changeQuantity(item: TripItem, delta: number) {
    const quantity = item.quantity + delta;
    // Optimistic: update the list right away, then save.
    setItems((prev) =>
      quantity > 0
        ? prev.map((it) => (it.id === item.id ? { ...it, quantity } : it))
        : prev.filter((it) => it.id !== item.id),
    );
    try {
      if (quantity > 0) await setQuantity(item.id, quantity);
      else await putBack(item.id);
    } catch (e) {
      setError((e as Error).message);
      void load();
    }
  }

  if (!trip) {
    return (
      <View style={styles.center}>
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator />}
      </View>
    );
  }

  const count = items.reduce((n, it) => n + it.quantity, 0);

  return (
    <View style={styles.screen}>
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.store}>{trip.store_locations?.name}</Text>
            <Text style={styles.muted}>
              {count === 0 ? 'Cart is empty' : `${count} item${count === 1 ? '' : 's'}`}
              {' · '}
              {trip.budget_cents ? `Budget ${formatCents(trip.budget_cents)}` : 'No budget set'}
            </Text>
            {error && <Text style={styles.error}>{error}</Text>}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Scan your first item</Text>
            <Text style={styles.muted}>Tap Scan, point at a barcode, and it lands here.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <ItemRow
            item={item}
            price={prices === null ? undefined : (prices[item.barcode] ?? null)}
            onChange={(d) => changeQuantity(item, d)}
          />
        )}
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          style={styles.scanButton}
          onPress={() => router.push({ pathname: '/trip/[id]/scan', params: { id } })}
          accessibilityRole="button">
          <Text style={styles.scanText}>Scan item</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ItemRow({
  item,
  price,
  onChange,
}: {
  item: TripItem;
  price: CurrentPrice | null | undefined;
  onChange: (delta: number) => void;
}) {
  const p = item.products;
  const details = [p?.brand, p?.size_text].filter(Boolean).join(' · ');
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.name} numberOfLines={2}>
          {p?.name ?? item.barcode}
        </Text>
        {details !== '' && (
          <Text style={styles.muted} numberOfLines={1}>
            {details}
          </Text>
        )}
        <View style={{ marginTop: 4 }}>
          <PriceTag price={price} />
        </View>
      </View>
      <View style={styles.stepper}>
        <Pressable
          style={styles.stepButton}
          onPress={() => onChange(-1)}
          accessibilityLabel={item.quantity === 1 ? `Remove ${p?.name ?? 'item'}` : 'Decrease quantity'}>
          <Text style={styles.stepText}>{item.quantity === 1 ? '×' : '−'}</Text>
        </Pressable>
        <Text style={styles.qty}>{item.quantity}</Text>
        <Pressable style={styles.stepButton} onPress={() => onChange(1)} accessibilityLabel="Increase quantity">
          <Text style={styles.stepText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  list: { padding: 16, gap: 8, paddingBottom: 120 },
  header: { gap: 4, marginBottom: 8 },
  store: { fontSize: 22, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  error: { color: colors.danger },
  empty: {
    marginTop: 16,
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
    gap: 4,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontSize: 20, fontWeight: '600', color: colors.text },
  qty: { minWidth: 24, textAlign: 'center', fontSize: 16, fontWeight: '600', color: colors.text },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: colors.bg,
  },
  scanButton: { backgroundColor: colors.primary, paddingVertical: 18, borderRadius: 14, alignItems: 'center' },
  scanText: { color: colors.primaryText, fontSize: 18, fontWeight: '700' },
});
