# Online price data sources

CartCheck's online-price layer is **pluggable per chain**. `chains.online_source`
names an adapter in `supabase/functions/_sources/`. Online prices are always
labeled as online in the app until a shopper or admin replaces them with an
in-store price.

**Rule: we only use official APIs or licensed data. No scraping that violates a
site's terms.**

## How prices are chosen

`current_prices()` (migration `..._price_resolution.sql`) picks one price per
item per store, best first:

1. In-store sale (not yet ended; dates are in store time, America/New_York)
2. In-store regular
3. Online sale
4. Online regular

The app shows in-store prices in green with where they came from ("shelf tag,
2 days ago") and online prices in amber with "Online price · may differ in
store". A sale shows the regular price and end date next to it.

The `get-price` Edge Function asks a chain's adapter only when there's no
in-store price and the online price is more than 24 hours old. "Not carried"
answers are remembered for 24 hours too (`online_price_checks`), so each item
hits a chain's API at most once a day per store. Every online answer is also
logged to `price_submissions` with `source = 'online'`.

## Turning a source on

1. Get API credentials (below) and set them as Edge Function secrets:
   `npx supabase secrets set KROGER_CLIENT_ID=... KROGER_CLIENT_SECRET=...`
2. Make sure the chain's `online_source` matches the adapter id (already set
   for `kroger` and `walmart`).
3. For per-store sources (Kroger), set `store_locations.external_store_id` to
   the chain's store id.

A source without its secrets is skipped silently, and the app just shows "No
price yet" until an in-store price exists.

| Adapter | Secrets | Notes |
|---|---|---|
| `kroger` | `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET` | Free at developer.kroger.com. Needs the store's Kroger `locationId` in `external_store_id`. |
| `walmart` | `WALMART_CONSUMER_ID`, `WALMART_KEY_VERSION`, `WALMART_PRIVATE_KEY` (PKCS#8 PEM) | Needs walmart.io affiliate approval. National online price, not per store. |

Both adapters are unit-tested against recorded response shapes (`npm run
test:functions`). Neither has run against the real API yet, because we have no
credentials.

## Status by chain

| Chain | Legitimate source | Store-level prices? | Status |
|---|---|---|---|
| Kroger | [Kroger Developer API](https://developer.kroger.com) (free, OAuth client credentials). Product search returns regular and promo price per `locationId` | Yes | Adapter built, waiting on credentials. **No Kroger stores near Babson**, so this mostly proves out the plugin design. |
| Walmart | [Walmart affiliate API](https://walmart.io) (needs an approved affiliate account) | No: national online price | Adapter built, waiting on affiliate approval. Use as a labeled fallback only. |
| Target | No public price API | n/a | Needs a licensed provider or manual data |
| Stop & Shop | No public price API | n/a | Same |
| Trader Joe's | No public price API (no online ordering) | n/a | Same. Admin pre-load and receipts are the main path. |
| Shaw's, Hannaford, Whole Foods, Aldi, Market Basket | No public price API | n/a | Same |

## Licensed providers to evaluate (paid, quote on request)

- Datasembly: store-level grocery price data across major chains
- NielsenIQ / Numerator: retail price and purchase panels (enterprise pricing)

Not price sources: the Instacart Developer Platform builds shopping-list and
recipe links. It does not give price feeds.

## What this means for the pilot

The pilot stores are Target Framingham, Stop & Shop Natick and Trader Joe's
Needham. **None of them has a free, legitimate online price feed.** The pilot
gets its data from:

1. **Admin pre-load** (phase 6): ~200–300 curated items per store, entered by
   hand from a store visit.
2. **Receipt scanning** (phase 6): one receipt seeds dozens of prices.
3. **Shelf-tag snaps** from shoppers.

Adding a source later only needs a new adapter file and setting
`chains.online_source`. No app change is required.
