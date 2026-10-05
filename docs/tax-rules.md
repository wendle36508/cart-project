# Sales tax rules (Massachusetts)

Each product has a `tax_category`. The rate for each category comes from
`tax_rates`, joined through the store's `tax_region_id`. Rates are stored in
basis points (625 = 6.25%).

| Category | MA rate | Basis |
|---|---|---|
| `food` | 0% | Food for human consumption is exempt, M.G.L. c.64H §6(h). The statutory definition **includes candy, confectionery and soft drinks.** |
| `alcohol` | 0% | Package-store alcohol has had no sales tax since 2010 ballot Question 1 (excise is in the shelf price). Most pilot users are under 21, so this rarely matters. |
| `prepared_food` | 6.25% (+0.75% where the town adopted the local meals tax) | 830 CMR 64H.6.5. Only relevant if a pilot store sells hot or prepared food. |
| `non_food` | 6.25% | Paper goods, cleaning supplies, toiletries, etc. |
| `unknown` | 6.25% | Unclassified items are treated as taxable so estimates err high, never low. |

## Bottle deposit

MA charges a 5¢ deposit on carbonated soft drinks, beer, etc. It's stored per
product in `products.deposit_cents`, added to the total and not taxed.

Deposit applies to sodas, sparkling/carbonated water, beer, hard seltzer and
other malt drinks. It does not apply to still water, juice, wine, spirits or
cider. Multipacks pay per container: the count comes from the label
("12 x 355 ml", "24-pack"), or from total volume ÷ serving size when the label
lists only a total (Open Food Facts lists a Diet Coke 12-pack as "144 fl oz").

## How products get a category

The `lookup-product` Edge Function classifies each new barcode
(`supabase/functions/_shared/classify.ts`):

| Signal | Result |
|---|---|
| Found in Open Products / Beauty / Pet Food Facts | `non_food` |
| Pet food tags in Open Food Facts | `non_food` (pet food isn't "food for human consumption") |
| Alcoholic tags or alcohol ≥ 0.5% (and not tagged non-alcoholic) | `alcohol` |
| Dietary supplements / vitamins | `unknown` (taxed; whether they qualify as food depends on the product) |
| Any other food categories | `food` |
| No categories but has nutrition facts | `food` |
| No categories and no nutrition facts | `unknown` (taxed) |

Many US records have a name but no categories. For those, the name is checked
for beer and soda words ("Budweiser", "IPA", "cola", "seltzer"), because those
change tax or deposit. Soda words are checked first so root beer and ginger ale
stay soda.

Items a shopper names by hand get the type they picked: food or drink,
household / personal, or alcohol.

## Caveats to verify before launch

- Local meals tax at the pilot towns (Framingham, Natick, Needham) matters only
  for prepared food. Check before relying on it.
- Supplements are taxed to be safe. Check the DOR guidance if students buy them often.
- The admin tool (phase 6) can override any product's category.

Sources: [M.G.L. c.64H §6](https://malegislature.gov/Laws/GeneralLaws/PartI/TitleIX/Chapter64h/Section6),
[830 CMR 64H.6.5](https://www.mass.gov/regulations/830-CMR-64h65-sales-tax-on-meals)
