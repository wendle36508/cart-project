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

## Caveats to verify before launch

- Local meals tax at the pilot towns (Framingham, Natick, Needham) matters only
  for prepared food. Check before relying on it.
- Category assignment starts from Open Food Facts tags (phase 2). The admin
  tool can override it.

Sources: [M.G.L. c.64H §6](https://malegislature.gov/Laws/GeneralLaws/PartI/TitleIX/Chapter64h/Section6),
[830 CMR 64H.6.5](https://www.mass.gov/regulations/830-CMR-64h65-sales-tax-on-meals)
