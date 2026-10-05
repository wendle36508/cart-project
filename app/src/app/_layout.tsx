import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { track } from '@/lib/analytics';
import { ensureSession } from '@/lib/supabase';
import { colors } from '@/lib/theme';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    setError(null);
    ensureSession()
      .then(() => {
        setReady(true);
        track('app_opened');
      })
      .catch((e: Error) => setError(e.message));
  };

  useEffect(start, []);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Can't connect</Text>
        <Text style={styles.muted}>{error}</Text>
        <Pressable style={styles.button} onPress={start}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}>
      <Stack.Screen name="index" options={{ title: 'CartCheck' }} />
      <Stack.Screen name="trip/[id]" options={{ title: 'Your cart' }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: colors.bg },
  title: { fontSize: 20, fontWeight: '600', color: colors.text },
  muted: { color: colors.muted, textAlign: 'center' },
  button: { backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  buttonText: { color: colors.primaryText, fontWeight: '600' },
});
