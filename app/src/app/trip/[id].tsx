// Active trip screen. Phase 1 placeholder: shows the store and budget.
// Phase 2 adds barcode scanning; phase 5 adds the running total.
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { formatCents } from '@/lib/money';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';

type TripWithStore = {
  id: string;
  budget_cents: number | null;
  store_locations: { name: string } | null;
};

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [trip, setTrip] = useState<TripWithStore | null>(null);

  useEffect(() => {
    supabase
      .from('trips')
      .select('id, budget_cents, store_locations(name)')
      .eq('id', id)
      .single()
      .then(({ data }) => setTrip(data as TripWithStore | null));
  }, [id]);

  if (!trip) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.store}>{trip.store_locations?.name}</Text>
      <Text style={styles.muted}>
        {trip.budget_cents ? `Budget ${formatCents(trip.budget_cents)}` : 'No budget set'}
      </Text>
      <View style={styles.placeholder}>
        <Text style={styles.muted}>Scanning arrives in phase 2.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1, padding: 16, gap: 4 },
  store: { fontSize: 22, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  placeholder: {
    marginTop: 24,
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
  },
});
