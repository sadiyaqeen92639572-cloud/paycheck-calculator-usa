# State bonus (supplemental wage) withholding audit

Last updated 2026-10-01. Rule: a state shows a flat supplemental rate on the site, and in the calculator,
ONLY if it is read from the state's own employer withholding guide/regulation (`supplemental_source` in
`data/states.json`, enforced by `verify.js`). Everything else stays a marginal-bracket estimate, labelled as such.
No figure from a secondary source (payroll blogs, EY summaries, calculator sites) is used.

## Confirmed from a primary document (flat rate applied)
| State | Rate | Source | Note |
|---|---|---|---|
| CA | 10.23% bonuses/stock options (6.6% other) | EDD Employer's Guide DE 44, 2026, Rev. 52 (4-26), "How to Withhold PIT on Supplemental Wages" | Optional vs. aggregate method when not paid with regular wages. SDI 1.3%, no cap (EDD rates page) is modeled separately. |
| NY | 11.70% | NYS-50-T-NYS, eff. 2026-01-01 to 2026-12-31 | Optional vs. adding to regular wages. NYC/Yonkers not modeled. |
| MN | 6.25% | MN DOR "Supplemental Payments" (updated 2025-12-26) | Flat method when paid separately; aggregate otherwise. MN PFML not modeled. |
| OR | 8% | OR DOR 150-206-430, 2026 (rev. 2025-12-18) | Optional; only for wages paid at a different time than the regular payday. |
| VA | 5.75% | 23VAC10-140-60 | Only where tax is withheld from regular wages; otherwise aggregate. |

## Confirmed: no flat rate -> stays marginal estimate
| State | Finding |
|---|---|
| NJ | Publishes graduated supplemental tables (NJ-WT Supplemental Withholding Tables, Rates A-E), no single flat rate. |

## Not yet confirmed from a primary document (marginal estimate, labelled)
- **Matches the engine numerically per secondary sources only (low risk, still needs a citation):** OH (2.75%; EY summary of ODT tables eff. 2026-08-01), AR (3.7%; DFA `whformula_2026.pdf` is a scanned image, text not extractable).
- **Highest remaining risk: MD.** Engine uses the 4.75% marginal state rate. Maryland withholding also involves local (county) piggyback tax, and prior-year guides were summarized (secondary) as 8.00-8.85% on bonuses. Read the 2026 Comptroller Withholding Guide bonus table before trusting the MD bonus figure. Not found at `marylandtaxes.gov/.../2025/PM225.pdf` (404).
- Other progressive states: AL, CT, DE, DC, HI, KS, ME, MT, NE, NM, ND, OK, RI, SC, VT, WV, WI, MO.
- Flat-tax states (engine = state flat rate): AZ, CO, GA, ID, IL, IN, IA, KY, LA, MA, MI, MS, NC, PA, UT. Likely correct, but supplemental-rate citations and special cases (e.g. MA surtax over $1M, AZ elected rates) not yet read.
- No state income tax (engine 0): AK, FL, NV, NH, SD, TN, TX, WA, WY.

## Separate gap: employee-paid state payroll taxes
Only CA SDI and NY PFL are modeled (`data/rules/*.json` `extra_payroll_tax`). Other states with employee-paid
disability/family-leave/long-term-care contributions (candidates to check: NJ, RI, HI, WA, MA, CT, CO, OR, MN, DE)
are not modeled, which affects every paycheck and bonus page, not just bonuses. Rates not yet verified.

## Method note
Flat supplemental methods are optional for employers in CA, NY, VA and OR (aggregate/differential is the alternative),
so the calculator shows the withholding under the flat method and says so on each page; actual tax is settled at filing.
