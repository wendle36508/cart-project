// How a price is shown everywhere in the app. The tier is always visible:
// in-store prices in green, online prices in amber with "may differ in store",
// so a shopper never mistakes an online price for the shelf price.
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { formatCents } from '@/lib/money';
import type { CurrentPrice } from '@/lib/prices';
import { colors } from '@/lib/theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-12" -> "Oct 12" without time-zone shifts. */
function shortDate(isoDate: string): string {
  const [, m, d] = isoDate.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function ageLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return 'over a month ago';
}

const SOURCE_LABEL: Record<CurrentPrice['source'], string> = {
  in_store_tag: 'shelf tag',
  receipt: 'receipt',
  admin: 'CartCheck',
  online: 'online',
};

type Props = {
  /** undefined = still loading, null = no price known. */
  price: CurrentPrice | null | undefined;
  /** Larger price text, for the scan confirmation card. */
  large?: boolean;
};

export function PriceTag({ price, large }: Props) {
  if (price === undefined) {
    return <ActivityIndicator size="small" style={{ alignSelf: 'flex-start' }} />;
  }
  if (price === null) {
    return <Text style={styles.none}>No price yet</Text>;
  }

  const online = price.tier === 'online';
  const unit = price.price_unit === 'lb' ? '/lb' : '';
  const saleBits = [
    price.regular_price_cents ? `was ${formatCents(price.regular_price_cents)}` : null,
    price.sale_end_date ? `ends ${shortDate(price.sale_end_date)}` : null,
  ].filter(Boolean);

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={[styles.price, large && styles.priceLarge, { color: online ? colors.online : colors.text }]}>
          {formatCents(price.price_cents)}
          {unit}
        </Text>
        {price.is_sale && (
          <View style={styles.saleBadge}>
            <Text style={styles.saleText}>Sale</Text>
          </View>
        )}
        {saleBits.length > 0 && <Text style={styles.detail}>{saleBits.join(' · ')}</Text>}
      </View>
      {online ? (
        <View style={styles.onlinePill}>
          <Text style={styles.onlineText}>Online price · may differ in store</Text>
        </View>
      ) : (
        <Text style={styles.inStore}>
          ● In-store · {SOURCE_LABEL[price.source]}, {ageLabel(price.last_seen_at)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 3, alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  price: { fontSize: 16, fontWeight: '700' },
  priceLarge: { fontSize: 22 },
  detail: { fontSize: 13, color: colors.muted },
  none: { fontSize: 13, color: colors.muted, fontStyle: 'italic' },
  saleBadge: { backgroundColor: colors.danger, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  saleText: { color: '#fff', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  inStore: { fontSize: 12, color: colors.inStore, fontWeight: '600' },
  onlinePill: { backgroundColor: colors.onlineBg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  onlineText: { fontSize: 12, color: colors.online, fontWeight: '600' },
});
