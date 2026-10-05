# Online price data sources

CartCheck's online-price layer is **pluggable per chain**. `chains.online_source`
names an adapter in `supabase/functions/_sources/` (built in phase 3). Online
prices are always labeled as online in the app until a shopper or admin
replaces them with an in-store price.

**Rule: we only use official APIs or licensed data. No scraping that violates a
site's terms.**

## Status by chain

| Chain | Legitimate source | Store-level prices? | Status |
|---|---|---|---|
| Kroger | [Kroger Developer API](https://developer.kroger.com) (free, OAuth client credentials). Product search returns regular and promo price per `locationId` | Yes | Adapter planned. **No Kroger stores near Babson**, so this mostly proves out the plugin design. |
| Walmart | [Walmart affiliate API](https://walmart.io) (needs an approved affiliate account) | Mostly no: national online price | Adapter planned. Use as a labeled fallback only. |
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
