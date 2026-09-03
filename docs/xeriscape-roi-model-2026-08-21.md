# Xeriscape ROI model

The portfolio Water Savings tool uses the shared conversion-cost, rebate, water-rate, maintenance-savings, and 20-year asset-life assumptions. Its generic explicit gallons-per-square-foot calculation remains aligned with the unchanged admin Xeriscape Planner.

## Width-band addendum

The portfolio tool derives an effective width from each mapped polygon as `2 × area ÷ perimeter`, including exterior and interior rings. Narrow turf is modeled with higher avoidable irrigation intensity because overspray and heat losses are greater. Invalid or unavailable widths use the open-lawn baseline.

The confirmed proportional bands are:

| Effective width | Portfolio ratio to the editable open-lawn baseline | Default at 33 gal/ft²/yr |
|---|---:|---:|
| Under 10 ft — tree lawns / islands | 50/33 | 50 gal/ft²/yr |
| 10–15 ft — verges | 44/33 | 44 gal/ft²/yr |
| 15–25 ft — small panels | 38/33 | 38 gal/ft²/yr |
| Over 25 ft — open lawn | 1.0 | 33 gal/ft²/yr |

These are ratios, not fixed gallon constants. For example, changing the open-lawn baseline from 33 to 40 makes the under-10-ft intensity 60.6 gal/ft²/yr.

FB02 is entirely in the open-lawn band. Its existing worked-example figures remain unchanged: **948,684 gal/yr**, **$143,740 net**, **12.0 years payback**, and **$7.58 per 1,000 gallons**.