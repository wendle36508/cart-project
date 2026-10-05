# CartCheck

Scan groceries as you shop at major chain stores and see a running total, with
estimated tax, before you reach checkout. Built first for budget-conscious
college students near Babson College (Wellesley/Needham, MA).

## Repo layout

```
app/                 Expo (React Native + TypeScript) mobile app
  src/app/           screens (Expo Router)
  src/lib/           Supabase client, money helpers, analytics, theme
admin/               web admin for price pre-loading (phase 6)
supabase/
  migrations/        schema, row-level security, reference data
  functions/         Edge Functions: AI tag/receipt reading, online price sources (later phases)
scripts/             dev tooling (migration tests)
docs/                data sources, tax rules
```

## Stack

- **App:** Expo SDK 57 with Expo Router. One codebase for iOS and Android.
- **Backend:** Supabase (Postgres, Auth with anonymous sign-in, Edge Functions).
- **AI:** a vision model called only from Edge Functions, so no AI keys are in the app.
- **Product data:** Open Food Facts, cached in our `products` table.

## Setup

**Live web app:** https://wendle36508.github.io/cart-project/ (open on a phone, then Share → Add to Home Screen). Every push to `main` that touches `app/` redeploys it via `.github/workflows/deploy-web.yml`.

Prerequisites for local development: Node 20.19+, and optionally the Expo Go app on your phone.

```bash
npm install                 # root: Supabase CLI + test tooling
npm test                    # DB migrations + RLS checks, then Edge Function unit tests
npm run test:functions -- --live   # also looks up real barcodes on Open Food Facts

cd app
npm install
cp .env.example .env        # then fill in your Supabase URL + publishable key
npx expo start              # scan the QR code with Expo Go
```

### Supabase project (one time)

```bash
npx supabase login
npx supabase projects create cartcheck --region us-east-1
npx supabase link --project-ref <ref>
npx supabase db push        # applies supabase/migrations
npx supabase config push    # enables anonymous sign-ins (from supabase/config.toml)
npx supabase functions deploy lookup-product
```

## Scanning and product lookup

The app sends the raw barcode to the `lookup-product` Edge Function, which:

1. Normalizes it (UPC-A, UPC-E and EAN all become one 13-digit key, so iOS,
   Android and typed codes match the same product).
2. Returns the product if we already have it.
3. Otherwise looks it up in Open Food Facts, then the household, beauty and pet
   food sister databases, and classifies tax category and bottle deposit
   ([docs/tax-rules.md](docs/tax-rules.md)).
4. If nobody has it, the shopper names it once (name + food / household /
   alcohol) and it is saved for everyone. Misses are cached for 7 days so
   unknown items don't hit Open Food Facts on every scan.

Scanning the same item again adds 1 to its quantity. A scan can be undone from
the confirmation card.

To make yourself an admin, run this in the SQL editor after opening the app once:
`update profiles set role = 'admin' where id = '<your user id>';`

## Data model (summary)

| Table | Purpose |
|---|---|
| `profiles` | One per user (anonymous OK). Display name, role, points. |
| `chains`, `store_locations` | Fixed list of supported chains and specific stores |
| `tax_regions`, `tax_rates` | Tax rate per category per region. See [docs/tax-rules.md](docs/tax-rules.md). |
| `products` | Keyed by barcode (normalized GTIN-13). Tax category, deposit, weighed, curated, essential. |
| `product_lookup_misses` | Barcodes Open Food Facts didn't have; Edge Function only |
| `price_submissions` | Append-only log of every price seen: who, when, source, sale info, AI confidence |
| `prices` | Current price per product × store × tier (in-store/online) × regular/sale |
| `price_feedback` | "Still correct?" / "Wrong price" votes |
| `trips`, `trip_items` | Shopping trips, scanned items, quantities/weights, price snapshot |
| `shopping_lists`, `shopping_list_items` | Pre-trip lists |
| `point_events` | Contribution points ledger |
| `swaps` | Cheaper alternatives; nullable `sponsor_name` reserved for future sponsored deals |
| `events` | First-party analytics (pseudonymous user id only) |

Price sources: `in_store_tag`, `receipt`, `admin`, `online`. Online prices are
always shown as online until an in-store price replaces them. See
[docs/data-sources.md](docs/data-sources.md) for which chains have a legitimate
online feed.

## Privacy

- Shoppers start anonymous. No email or name is required.
- Photos are processed in memory by an Edge Function and not stored.
- Row-level security: users can only read their own trips, lists and submissions.
- Analytics are first-party and tied only to a random user id. Personal data is never sold or shared.

## Build phases

1. ✅ Setup, data model, backend, chain and store list
2. ✅ Barcode scanning and product lookup
3. Online price layer (pluggable sources) and labeling
4. In-store prices, snap-the-tag flow, crowdsourced replacement
5. Running total, tax, budget alerts, put-back suggestions
6. Admin pre-load tool and receipt scanning
7. Shopping list estimates, verification, points, analytics views
