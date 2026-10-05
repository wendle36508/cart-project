// Start a trip: pick a supported store location, optionally set a budget.
// Designed for minimal taps: the last-used store is preselected.
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { track } from '@/lib/analytics';
import { parseDollars } from '@/lib/money';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import type { Chain, StoreLocation } from '@/lib/types';

const LAST_STORE_KEY = 'cartcheck.lastStoreId';
const BUDGET_PRESETS = [2000, 4000, 6000, 8000];

export default function StartTrip() {
  const [chains, setChains] = useState<Chain[]>([]);
  const [stores, setStores] = useState<StoreLocation[]>([]);
  const [storeId, setStoreId] = useState<string | null>(() => localStorage.getItem(LAST_STORE_KEY));
  const [budgetText, setBudgetText] = useState('');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [c, s] = await Promise.all([
        supabase.from('chains').select('id, name, online_source').eq('active', true).order('name'),
        supabase
          .from('store_locations')
          .select('id, chain_id, name, address, city, state, zip, is_pilot')
          .eq('active', true)
          .order('name'),
      ]);
      if (c.error || s.error) setError((c.error ?? s.error)!.message);
      setChains(c.data ?? []);
      setStores(s.data ?? []);
      setLoading(false);
    })();
  }, []);

  // Group stores under their chain; chains without stores are hidden.
  const grouped = useMemo(
    () =>
      chains
        .map((chain) => ({ chain, stores: stores.filter((s) => s.chain_id === chain.id) }))
        .filter((g) => g.stores.length > 0),
    [chains, stores],
  );

  const budgetCents = budgetText.trim() === '' ? null : parseDollars(budgetText);
  const budgetInvalid = budgetText.trim() !== '' && (budgetCents === null || budgetCents === 0);

  async function startTrip() {
    if (!storeId || budgetInvalid) return;
    setStarting(true);
    setError(null);
    const { data: session } = await supabase.auth.getSession();
    const { data, error: err } = await supabase
      .from('trips')
      .insert({ user_id: session.session!.user.id, store_id: storeId, budget_cents: budgetCents })
      .select('id')
      .single();
    setStarting(false);
    if (err || !data) {
      setError(err?.message ?? 'Could not start trip');
      return;
    }
    localStorage.setItem(LAST_STORE_KEY, storeId);
    track('trip_started', { storeId, props: { has_budget: budgetCents !== null } });
    router.push({ pathname: '/trip/[id]', params: { id: data.id } });
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>Where are you shopping?</Text>

      {grouped.map(({ chain, stores: chainStores }) => (
        <View key={chain.id} style={styles.group}>
          <Text style={styles.chainName}>{chain.name}</Text>
          {chainStores.map((store) => {
            const selected = store.id === storeId;
            return (
              <Pressable
                key={store.id}
                onPress={() => setStoreId(store.id)}
                style={[styles.storeRow, selected && styles.storeRowSelected]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}>
                <Text style={styles.storeName}>{store.name}</Text>
                <Text style={styles.muted}>
                  {store.address}, {store.city}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}

      <Text style={styles.heading}>Budget (optional)</Text>
      <View style={styles.presets}>
        {BUDGET_PRESETS.map((cents) => {
          const selected = budgetCents === cents;
          return (
            <Pressable
              key={cents}
              onPress={() => setBudgetText(selected ? '' : String(cents / 100))}
              style={[styles.preset, selected && styles.presetSelected]}>
              <Text style={[styles.presetText, selected && styles.presetTextSelected]}>${cents / 100}</Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput
        value={budgetText}
        onChangeText={setBudgetText}
        placeholder="Or type an amount, e.g. 35"
        keyboardType="decimal-pad"
        style={[styles.input, budgetInvalid && { borderColor: colors.danger }]}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        onPress={startTrip}
        disabled={!storeId || budgetInvalid || starting}
        style={[styles.button, (!storeId || budgetInvalid) && styles.buttonDisabled]}>
        <Text style={styles.buttonText}>{starting ? 'Starting…' : 'Start shopping'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 16, gap: 12, paddingBottom: 48 },
  heading: { fontSize: 18, fontWeight: '600', color: colors.text, marginTop: 8 },
  group: { gap: 8 },
  chainName: { fontSize: 13, fontWeight: '600', color: colors.muted, textTransform: 'uppercase' },
  storeRow: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    padding: 14,
    gap: 2,
  },
  storeRowSelected: { borderColor: colors.primary },
  storeName: { fontSize: 16, fontWeight: '600', color: colors.text },
  muted: { color: colors.muted },
  presets: { flexDirection: 'row', gap: 8 },
  preset: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
  },
  presetSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  presetText: { fontWeight: '600', color: colors.text },
  presetTextSelected: { color: colors.primaryText },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
  },
  error: { color: colors.danger },
  button: { backgroundColor: colors.primary, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: colors.primaryText, fontSize: 17, fontWeight: '600' },
});
