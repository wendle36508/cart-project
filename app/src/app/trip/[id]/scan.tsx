// Scanner. Stays open so a shopper can scan item after item; each scan is
// looked up, added to the cart, and confirmed in a card with an Undo button.
// Unknown items get a quick "what is it?" form. Typing a barcode is always
// available for damaged labels, denied camera access, or web.
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { track } from '@/lib/analytics';
import { addToTrip, undoAdd, type AddResult } from '@/lib/cart';
import { lookupProduct, type ManualTaxCategory } from '@/lib/products';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import type { Product } from '@/lib/types';

// Retail barcodes only; QR codes and shipping labels are ignored.
const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;
// The camera reports the same code many times a second while it's in view.
const SAME_CODE_COOLDOWN_MS = 2500;

const TAX_CHOICES: { value: ManualTaxCategory; label: string }[] = [
  { value: 'food', label: 'Food or drink' },
  { value: 'non_food', label: 'Household / personal' },
  { value: 'alcohol', label: 'Alcohol' },
];

type Panel =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'added'; product: Product; added: AddResult }
  | { kind: 'needs_name'; barcode: string; offline: boolean }
  | { kind: 'error'; message: string }
  | { kind: 'type_barcode' };

export default function ScanScreen() {
  const { id: tripId } = useLocalSearchParams<{ id: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [storeId, setStoreId] = useState<string | undefined>();
  const [panel, setPanel] = useState<Panel>({ kind: 'idle' });
  const [torch, setTorch] = useState(false);
  const lastScan = useRef({ data: '', at: 0 });
  const insets = useSafeAreaInsets();

  useEffect(() => {
    supabase
      .from('trips')
      .select('store_id')
      .eq('id', tripId)
      .single()
      .then(({ data }) => setStoreId(data?.store_id));
  }, [tripId]);

  async function handleCode(raw: string, type: string | undefined, source: 'camera' | 'typed') {
    setPanel({ kind: 'busy' });
    try {
      const result = await lookupProduct(raw, type);
      if (result.status === 'invalid') {
        setPanel({ kind: 'error', message: "That doesn't look like a product barcode." });
        return;
      }
      if (result.status !== 'found') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setPanel({ kind: 'needs_name', barcode: result.barcode, offline: result.status === 'unavailable' });
        return;
      }
      await addProduct(result.product, source);
    } catch (e) {
      setPanel({ kind: 'error', message: (e as Error).message });
    }
  }

  async function addProduct(product: Product, source: 'camera' | 'typed' | 'named') {
    const added = await addToTrip(tripId, product.barcode);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setPanel({ kind: 'added', product, added });
    track('item_scanned', { storeId, props: { barcode: product.barcode, source, tax: product.tax_category } });
  }

  function onBarcodeScanned({ data, type }: BarcodeScanningResult) {
    const now = Date.now();
    if (data === lastScan.current.data && now - lastScan.current.at < SAME_CODE_COOLDOWN_MS) return;
    lastScan.current = { data, at: now };
    void handleCode(data, type, 'camera');
  }

  // Only scan while nothing needs the shopper's attention.
  const scanning = panel.kind === 'idle' || panel.kind === 'added' || panel.kind === 'error';

  return (
    <View style={styles.screen}>
      {permission?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
          onBarcodeScanned={scanning ? onBarcodeScanned : undefined}
        />
      ) : (
        <PermissionPrompt
          loading={!permission}
          canAsk={permission?.canAskAgain ?? true}
          onAllow={requestPermission}
          onType={() => setPanel({ kind: 'type_barcode' })}
        />
      )}

      {permission?.granted && (
        <View style={styles.viewfinderWrap} pointerEvents="none">
          <View style={styles.viewfinder} />
          <Text style={styles.hint}>Point at the barcode</Text>
        </View>
      )}

      <View style={[styles.topBar, { top: insets.top + 12 }]}>
        {permission?.granted && (
          <Pressable style={styles.chip} onPress={() => setTorch((t) => !t)} accessibilityLabel="Toggle flashlight">
            <Text style={styles.chipText}>{torch ? 'Light off' : 'Light'}</Text>
          </Pressable>
        )}
        <View style={{ flex: 1 }} />
        <Pressable style={[styles.chip, styles.doneChip]} onPress={() => router.back()}>
          <Text style={[styles.chipText, styles.doneText]}>Done</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]}
        pointerEvents="box-none">
        <BottomPanel
          panel={panel}
          setPanel={setPanel}
          onTyped={(code) => handleCode(code, undefined, 'typed')}
          onNamed={async (barcode, name, tax) => {
            setPanel({ kind: 'busy' });
            try {
              const result = await lookupProduct(barcode, undefined, { name, tax_category: tax });
              if (result.status !== 'found') throw new Error('Could not save that item');
              await addProduct(result.product, 'named');
            } catch (e) {
              setPanel({ kind: 'error', message: (e as Error).message });
            }
          }}
        />
      </KeyboardAvoidingView>
    </View>
  );
}

function PermissionPrompt(props: { loading: boolean; canAsk: boolean; onAllow: () => void; onType: () => void }) {
  if (props.loading) {
    return (
      <View style={styles.permission}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  return (
    <View style={styles.permission}>
      <Text style={styles.permissionTitle}>Scan with your camera</Text>
      <Text style={styles.permissionBody}>
        CartCheck only uses the camera to read barcodes. Nothing is recorded or saved.
      </Text>
      <Pressable style={styles.primary} onPress={props.canAsk ? props.onAllow : () => Linking.openSettings()}>
        <Text style={styles.primaryText}>{props.canAsk ? 'Allow camera' : 'Open Settings'}</Text>
      </Pressable>
      <Pressable onPress={props.onType} style={styles.linkButton}>
        <Text style={styles.linkOnDark}>Type a barcode instead</Text>
      </Pressable>
    </View>
  );
}

function NameForm(props: {
  offline: boolean;
  onCancel: () => void;
  onSave: (name: string, tax: ManualTaxCategory) => void;
}) {
  const [name, setName] = useState('');
  const [tax, setTax] = useState<ManualTaxCategory | null>(null);
  const ready = name.trim().length >= 2 && tax !== null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{props.offline ? "Couldn't look this up" : "We don't know this one yet"}</Text>
      <Text style={styles.muted}>
        {props.offline
          ? 'The product database is not responding. Name it now, or go back and scan again.'
          : 'Tell us what it is. You only have to do this once, for everyone.'}
      </Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="e.g. Store-brand oat milk 64 oz"
        style={styles.input}
        autoFocus
        maxLength={80}
        returnKeyType="done"
      />
      <View style={styles.choices}>
        {TAX_CHOICES.map((c) => (
          <Pressable
            key={c.value}
            onPress={() => setTax(c.value)}
            style={[styles.choice, tax === c.value && styles.choiceSelected]}
            accessibilityRole="radio"
            accessibilityState={{ selected: tax === c.value }}>
            <Text style={[styles.choiceText, tax === c.value && styles.choiceTextSelected]}>{c.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.row}>
        <Pressable style={styles.secondary} onPress={props.onCancel}>
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.primary, { flex: 1 }, !ready && styles.disabled]}
          disabled={!ready}
          onPress={() => props.onSave(name.trim(), tax!)}>
          <Text style={styles.primaryText}>Save and add</Text>
        </Pressable>
      </View>
    </View>
  );
}

function BottomPanel(props: {
  panel: Panel;
  setPanel: (p: Panel) => void;
  onTyped: (code: string) => void;
  onNamed: (barcode: string, name: string, tax: ManualTaxCategory) => void;
}) {
  const { panel, setPanel } = props;
  const [typed, setTyped] = useState('');
  const [undoing, setUndoing] = useState(false);

  const typeLink = (
    <Pressable onPress={() => setPanel({ kind: 'type_barcode' })} style={styles.linkButton}>
      <Text style={styles.link}>Type a barcode</Text>
    </Pressable>
  );

  switch (panel.kind) {
    case 'idle':
      return <View style={[styles.card, styles.cardCompact]}>{typeLink}</View>;

    case 'busy':
      return (
        <View style={[styles.card, styles.row]}>
          <ActivityIndicator />
          <Text style={styles.body}>Looking it up…</Text>
        </View>
      );

    case 'added': {
      const { product, added } = panel;
      const details = [product.brand, product.size_text].filter(Boolean).join(' · ');
      return (
        <View style={styles.card}>
          <Text style={styles.addedLabel}>{added.quantity > 1 ? `Added · ${added.quantity} in cart` : 'Added to cart'}</Text>
          <Text style={styles.productName} numberOfLines={2}>
            {product.name}
          </Text>
          {details !== '' && <Text style={styles.muted}>{details}</Text>}
          <View style={styles.row}>
            <Pressable
              disabled={undoing}
              style={styles.secondary}
              onPress={async () => {
                setUndoing(true);
                try {
                  await undoAdd(added);
                  setPanel({ kind: 'idle' });
                } catch (e) {
                  setPanel({ kind: 'error', message: (e as Error).message });
                } finally {
                  setUndoing(false);
                }
              }}>
              <Text style={styles.secondaryText}>{undoing ? 'Undoing…' : 'Undo'}</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
            {typeLink}
          </View>
        </View>
      );
    }

    case 'needs_name':
      // Keyed by barcode so each unknown item starts with an empty form.
      return (
        <NameForm
          key={panel.barcode}
          offline={panel.offline}
          onCancel={() => setPanel({ kind: 'idle' })}
          onSave={(name, tax) => props.onNamed(panel.barcode, name, tax)}
        />
      );

    case 'type_barcode': {
      const digits = typed.replace(/\D/g, '');
      const ok = digits.length >= 6 && digits.length <= 14;
      const submit = () => {
        if (!ok) return;
        setTyped('');
        props.onTyped(digits);
      };
      return (
        <View style={styles.card}>
          <Text style={styles.title}>Type the barcode</Text>
          <Text style={styles.muted}>All the numbers under the bars, including the small ones at each end.</Text>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder="e.g. 049000028911"
            keyboardType="number-pad"
            style={styles.input}
            autoFocus
            maxLength={18}
            onSubmitEditing={submit}
          />
          <View style={styles.row}>
            <Pressable style={styles.secondary} onPress={() => setPanel({ kind: 'idle' })}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.primary, { flex: 1 }, !ok && styles.disabled]} disabled={!ok} onPress={submit}>
              <Text style={styles.primaryText}>Look up</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    case 'error':
      return (
        <View style={styles.card}>
          <Text style={[styles.body, { color: colors.danger }]}>{panel.message}</Text>
          <View style={styles.row}>
            <Text style={styles.muted}>Scan again, or</Text>
            {typeLink}
          </View>
        </View>
      );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  viewfinderWrap: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: 12 },
  viewfinder: {
    width: '78%',
    aspectRatio: 1.8,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  hint: { color: '#fff', fontSize: 15, fontWeight: '600', textShadowColor: '#000', textShadowRadius: 4 },
  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row' },
  chip: { backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  chipText: { color: '#fff', fontWeight: '600' },
  doneChip: { backgroundColor: '#fff' },
  doneText: { color: colors.text },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12 },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, gap: 10 },
  cardCompact: { paddingVertical: 4, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 17, fontWeight: '700', color: colors.text },
  body: { fontSize: 15, color: colors.text },
  muted: { color: colors.muted },
  addedLabel: { color: colors.inStore, fontWeight: '700', fontSize: 13, textTransform: 'uppercase' },
  productName: { fontSize: 18, fontWeight: '600', color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: colors.text,
  },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  choiceSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceText: { color: colors.text, fontWeight: '500' },
  choiceTextSelected: { color: colors.primaryText },
  primary: { backgroundColor: colors.primary, paddingVertical: 14, paddingHorizontal: 20, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: colors.primaryText, fontWeight: '600', fontSize: 16 },
  secondary: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  secondaryText: { color: colors.text, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  linkButton: { paddingVertical: 12, paddingHorizontal: 4 },
  link: { color: colors.primary, fontWeight: '600' },
  linkOnDark: { color: '#fff', fontWeight: '600', textDecorationLine: 'underline' },
  permission: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  permissionTitle: { color: '#fff', fontSize: 22, fontWeight: '700' },
  permissionBody: { color: '#ccc', textAlign: 'center', fontSize: 15 },
});
