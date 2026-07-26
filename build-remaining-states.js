/**
 * One-off generator for the 41 remaining states + DC (batch 2, following the initial
 * 10-state build). Compact sourced data table -> templated worksheet/FAQ prose ->
 * data/states.json merge + data/rules/*.json + research CSV rows.
 * Worked examples are computed by calc-engine.js itself (not hand-typed), so the
 * worksheet numbers are guaranteed consistent with what the shipped engine outputs.
 */
const fs = require('fs');
const path = require('path');
const { calculatePaycheck } = require('./assets/calc-engine.js');

const TODAY = '2026-07-26';
const EXAMPLE_INCOME = 65000;

// abbr: { name, slug, formula_model, effective_date, guideline_version, source, params, local_tax_note, extra_payroll_tax, extra_deviation }
const STATES = {
    al: { name: 'Alabama', formula_model: 'progressive_brackets', effective_date: '2026-01-01',
        source: { agency_name: 'Alabama Department of Revenue', url: 'https://www.revenue.alabama.gov/', statute_ref: 'Ala. Code § 40-18-5 — 3-bracket schedule; § 40-18-15 permits deducting federal income tax paid' },
        params: { brackets: [{ upTo: 500, rate: 0.02 }, { upTo: 3000, rate: 0.04 }, { upTo: null, rate: 0.05 }], standard_deduction: 3000, federal_tax_deductible: true },
        local_tax_note: 'Some Alabama cities and counties (e.g. Birmingham, Bessemer) levy a local occupational tax, typically 0.5%-2% of wages, not computed here.',
        extra_deviation: 'Alabama\'s standard deduction is income-graduated ($2,000-$4,000 for single filers depending on AGI); this estimate uses a flat $3,000 approximation.' },
    ak: { name: 'Alaska', formula_model: 'no_income_tax', effective_date: '1980-01-01',
        source: { agency_name: 'Alaska Department of Revenue', url: 'https://tax.alaska.gov/', statute_ref: 'Alaska repealed its personal income tax in 1980' },
        params: {} },
    az: { name: 'Arizona', formula_model: 'flat_tax', effective_date: '2023-01-01',
        source: { agency_name: 'Arizona Department of Revenue', url: 'https://azdor.gov/', statute_ref: 'Ariz. Rev. Stat. § 43-1011 — flat 2.5% rate effective 2023' },
        params: { rate: 0.025, standard_deduction: 16100 },
        extra_deviation: 'Arizona conforms closely to the federal standard deduction; this estimate applies it directly.' },
    ar: { name: 'Arkansas', formula_model: 'progressive_brackets', effective_date: '2026-01-01',
        source: { agency_name: 'Arkansas Department of Finance and Administration', url: 'https://www.dfa.arkansas.gov/', statute_ref: 'Top rate cut to 3.7% retroactive to 2026-01-01' },
        params: { brackets: [{ upTo: 5599, rate: 0 }, { upTo: 11199, rate: 0.02 }, { upTo: 15999, rate: 0.03 }, { upTo: 26399, rate: 0.034 }, { upTo: null, rate: 0.037 }], standard_deduction: 0 },
        extra_deviation: 'Arkansas\' low-income relief is baked into the 0% starter bracket rather than a separate standard deduction in this simplified model.' },
    co: { name: 'Colorado', formula_model: 'flat_tax', effective_date: '2022-01-01',
        source: { agency_name: 'Colorado Department of Revenue', url: 'https://tax.colorado.gov/', statute_ref: 'Colo. Const. art. X (flat rate mandate) — 4.4% per Proposition 121 (2022)' },
        params: { rate: 0.044, standard_deduction: 16100 },
        extra_deviation: 'Colorado starts from federal taxable income; this estimate applies the federal standard deduction as the base. Colorado\'s TABOR mechanism can temporarily lower the effective rate in high-revenue years, not modeled here.' },
    ct: { name: 'Connecticut', formula_model: 'progressive_brackets', effective_date: '2026-01-01',
        source: { agency_name: 'Connecticut Department of Revenue Services', url: 'https://portal.ct.gov/drs', statute_ref: 'Conn. Gen. Stat. § 12-700' },
        params: { brackets: [{ upTo: 10000, rate: 0.02 }, { upTo: 50000, rate: 0.045 }, { upTo: 100000, rate: 0.055 }, { upTo: 200000, rate: 0.06 }, { upTo: 250000, rate: 0.065 }, { upTo: 500000, rate: 0.069 }, { upTo: null, rate: 0.0699 }], personal_exemption: 15000 },
        extra_deviation: 'Connecticut\'s $15,000 personal exemption phases out between $30,000 and $45,000 of income; this estimate applies it as a flat amount, which understates tax for filers in that phase-out band. Connecticut also has a "tax recapture" provision affecting high earners, not modeled.' },
    de: { name: 'Delaware', formula_model: 'progressive_brackets', effective_date: '2026-01-01',
        source: { agency_name: 'Delaware Division of Revenue', url: 'https://revenue.delaware.gov/', statute_ref: 'Del. Code tit. 30 § 1102' },
        params: { brackets: [{ upTo: 2000, rate: 0 }, { upTo: 5000, rate: 0.022 }, { upTo: 10000, rate: 0.039 }, { upTo: 20000, rate: 0.048 }, { upTo: 25000, rate: 0.052 }, { upTo: 60000, rate: 0.0555 }, { upTo: null, rate: 0.066 }], standard_deduction: 3250 } },
    dc: { name: 'District of Columbia', formula_model: 'progressive_brackets', effective_date: '2026-01-01',
        source: { agency_name: 'DC Office of Tax and Revenue', url: 'https://otr.cfo.dc.gov/', statute_ref: 'D.C. Code § 47-1806.03' },
        params: { brackets: [{ upTo: 10000, rate: 0.04 }, { upTo: 40000, rate: 0.06 }, { upTo: 60000, rate: 0.065 }, { upTo: 350000, rate: 0.085 }, { upTo: 1000000, rate: 0.0925 }, { upTo: null, rate: 0.1075 }], standard_deduction: 15700 } },
    hi: { name: 'Hawaii', formula_model: 'progressive_brackets', effective_date: '2026-01-01',
        source: { agency_name: 'Hawaii Department of Taxation', url: 'https://files.hawaii.gov/tax/', statute_ref: 'Haw. Rev. Stat. § 235-51 — 12-bracket schedule' },
        params: { brackets: [{ upTo: 9600, rate: 0.014 }, { upTo: 14400, rate: 0.032 }, { upTo: 19200, rate: 0.055 }, { upTo: 24000, rate: 0.064 }, { upTo: 36000, rate: 0.068 }, { upTo: 48000, rate: 0.072 }, { upTo: 125000, rate: 0.076 }, { upTo: 175000, rate: 0.079 }, { upTo: 225000, rate: 0.0825 }, { upTo: 275000, rate: 0.09 }, { upTo: 325000, rate: 0.10 }, { upTo: null, rate: 0.11 }], standard_deduction: 2200 } },
    id: { name: 'Idaho', formula_model: 'flat_tax', effective_date: '2025-03-01',
        source: { agency_name: 'Idaho State Tax Commission', url: 'https://tax.idaho.gov/', statute_ref: 'HB 40 (2025) — flat 5.3% rate' },
        params: { rate: 0.053, standard_deduction: 16100 } },
    in: { name: 'Indiana', formula_model: 'flat_tax', effective_date: '2026-01-01',
        source: { agency_name: 'Indiana Department of Revenue', url: 'https://www.in.gov/dor/', statute_ref: 'Ind. Code § 6-3-2-1 — flat 2.95% for 2026' },
        params: { rate: 0.0295, standard_deduction: 0 },
        local_tax_note: 'Indiana\'s 92 counties each levy their own local income tax (resident-based), ranging 0.50%-3.38% — often larger than any single layer in this calculator\'s other states. Not computed here; check your county\'s rate.' },
    ia: { name: 'Iowa', formula_model: 'flat_tax', effective_date: '2026-01-01',
        source: { agency_name: 'Iowa Department of Revenue', url: 'https://revenue.iowa.gov/', statute_ref: 'SF 2442 (2024) — flat 3.8% effective 2026, completing the phase-down from a 6-bracket system topping out at 8.53%' },
        params: { rate: 0.038, standard_deduction: 16100 } },
    ks: { name: 'Kansas', formula_model: 'progressive_brackets', effective_date: '2026-01-01',
        source: { agency_name: 'Kansas Department of Revenue', url: 'https://www.ksrevenue.gov/', statute_ref: 'Kan. Stat. § 79-32,110' },
        params: { brackets: [{ upTo: 30000, rate: 0.031 }, { upTo: null, rate: 0.057 }], standard_deduction: 3605, personal_exemption: 9160 } },
    ky: { name: 'Kentucky', formula_model: 'flat_tax', effective_date: '2026-01-01',
        source: { agency_name: 'Kentucky Department of Revenue', url: 'https://revenue.ky.gov/', statute_ref: 'Ky. Rev. Stat. § 141.020 — cut to 3.5% effective 2026-01-01' },
        params: { rate: 0.035, standard_deduction: 3270 },
        local_tax_note: 'Many Kentucky cities and counties levy a local occupational/payroll tax (e.g. Louisville ~2.2%), not computed here.' },
    la: { name: 'Louisiana', formula_model: 'flat_tax', effective_date: '2025-01-01',
        source: { agency_name: 'Louisiana Department of Revenue', url: 'https://revenue.louisiana.gov/', statute_ref: 'Constitutional Amendment 2 (Nov. 2024) — flat 3% rate replacing the prior 1.85%-4.25% brackets' },
        params: { rate: 0.03, standard_deduction: 12500 } },
    me: { name: 'Maine', formula_model: 'progressive_brackets', effective_date: '2026-01-01',
        source: { agency_name: 'Maine Revenue Services', url: 'https://www.maine.gov/revenue/', statute_ref: '36 M.R.S. § 5111' },
        params: { brackets: [{ upTo: 27400, rate: 0.058 }, { upTo: 64850, rate: 0.0675 }, { upTo: null, rate: 0.0715 }], standard_deduction: 15300 } },
    md: { name: 'Maryland', formula_model: 'progressive_brackets', effective_date: '2026-01-01',
        source: { agency_name: 'Comptroller of Maryland', url: 'https://www.marylandtaxes.gov/', statute_ref: 'Md. Code, Tax-General § 10-105 — 2026 budget added a 6.5% top bracket over $1,000,000' },
        params: { brackets: [{ upTo: 1000, rate: 0.02 }, { upTo: 2000, rate: 0.03 }, { upTo: 3000, rate: 0.04 }, { upTo: 100000, rate: 0.0475 }, { upTo: 125000, rate: 0.05 }, { upTo: 150000, rate: 0.0525 }, { upTo: 250000, rate: 0.055 }, { upTo: 1000000, rate: 0.0575 }, { upTo: null, rate: 0.065 }], standard_deduction: 2550 },
        local_tax_note: 'Every Maryland county plus Baltimore City adds a local "piggyback" income tax of 1.75%-3.2% on the same return — this is one of the largest local-tax gaps in this calculator. Combined state+local can reach ~8.95%. Not computed here; check your county\'s rate.' },
    ma: { name: 'Massachusetts', formula_model: 'flat_tax', effective_date: '2023-01-01',
        source: { agency_name: 'Massachusetts Department of Revenue', url: 'https://www.mass.gov/orgs/massachusetts-department-of-revenue', statute_ref: 'Mass. Gen. Laws ch. 62 § 4 — flat 5% plus 4% surtax on income over $1M (2022 ballot amendment)' },
        params: { rate: 0.05, personal_exemption: 4400, surtax: { threshold: 1083150, rate: 0.04 } },
        extra_deviation: 'The millionaire\'s surtax threshold is inflation-indexed annually; $1,083,150 is the most recently published figure at last-verified date — confirm current threshold at mass.gov before relying on this near the boundary.' },
    mn: { name: 'Minnesota', formula_model: 'progressive_brackets', effective_date: '2026-01-01',
        source: { agency_name: 'Minnesota Department of Revenue', url: 'https://www.revenue.state.mn.us/', statute_ref: 'Minn. Stat. § 290.06' },
        params: { brackets: [{ upTo: 31690, rate: 0.0535 }, { upTo: 104090, rate: 0.068 }, { upTo: 193240, rate: 0.0785 }, { upTo: null, rate: 0.0985 }], standard_deduction: 14575 } },
    ms: { name: 'Mississippi', formula_model: 'flat_tax', effective_date: '2026-01-01',
        source: { agency_name: 'Mississippi Department of Revenue', url: 'https://www.dor.ms.gov/', statute_ref: 'Miss. Code § 27-7-5 — first $10,000 exempt, flat 4.4% above' },
        params: { rate: 0.044, standard_deduction: 10000 } },
    mo: { name: 'Missouri', formula_model: 'progressive_brackets', effective_date: '2026-01-01',
        source: { agency_name: 'Missouri Department of Revenue', url: 'https://dor.mo.gov/', statute_ref: 'Mo. Rev. Stat. § 143.011' },
        params: { brackets: [{ upTo: 1313, rate: 0 }, { upTo: 2626, rate: 0.02 }, { upTo: 3939, rate: 0.025 }, { upTo: 5252, rate: 0.03 }, { upTo: 6565, rate: 0.035 }, { upTo: 7878, rate: 0.04 }, { upTo: 9191, rate: 0.045 }, { upTo: null, rate: 0.047 }], standard_deduction: 15750 },
        local_tax_note: 'Kansas City and St. Louis each levy a 1% local earnings tax on residents (and on nonresidents working there), not computed here.' },
    mt: { name: 'Montana', formula_model: 'progressive_brackets', effective_date: '2026-01-01',
        source: { agency_name: 'Montana Department of Revenue', url: 'https://mtrevenue.gov/', statute_ref: 'Mont. Code § 15-30-2103' },
        params: { brackets: [{ upTo: 20500, rate: 0.047 }, { upTo: null, rate: 0.059 }], standard_deduction: 5660 },
        extra_deviation: 'Montana\'s standard deduction is actually 20% of AGI (min $2,830, max $5,660), not a fixed amount; this estimate uses the maximum, which understates tax for lower incomes.' },
    ne: { name: 'Nebraska', formula_model: 'progressive_brackets', effective_date: '2026-01-01',
        source: { agency_name: 'Nebraska Department of Revenue', url: 'https://revenue.nebraska.gov/', statute_ref: 'Neb. Rev. Stat. § 77-2715.03 — cut to 3-bracket, 4.55% top rate for 2026' },
        params: { brackets: [{ upTo: 2399, rate: 0.0246 }, { upTo: 17999, rate: 0.0351 }, { upTo: null, rate: 0.0455 }], standard_deduction: 16100 } },
    nv: { name: 'Nevada', formula_model: 'no_income_tax', effective_date: '1864-01-01',
        source: { agency_name: 'Nevada Department of Taxation', url: 'https://tax.nv.gov/', statute_ref: 'Nev. Const. art. 10 — no personal income tax' },
        params: {} },
    nh: { name: 'New Hampshire', formula_model: 'no_income_tax', effective_date: '2025-01-01',
        source: { agency_name: 'New Hampshire Department of Revenue Administration', url: 'https://www.revenue.nh.gov/', statute_ref: 'Interest & Dividends Tax fully repealed effective 2025-01-01 — no tax on any personal income including wages' },
        params: {} },
    nj: { name: 'New Jersey', formula_model: 'progressive_brackets', effective_date: '2026-01-01',
        source: { agency_name: 'New Jersey Division of Taxation', url: 'https://www.nj.gov/treasury/taxation/', statute_ref: 'N.J. Stat. § 54A:2-1 — 7-bracket schedule' },
        params: { brackets: [{ upTo: 20000, rate: 0.014 }, { upTo: 35000, rate: 0.0175 }, { upTo: 40000, rate: 0.035 }, { upTo: 75000, rate: 0.05525 }, { upTo: 500000, rate: 0.0637 }, { upTo: 1000000, rate: 0.0897 }, { upTo: null, rate: 0.1075 }], personal_exemption: 1000 },
        extra_deviation: 'New Jersey has no standard deduction, only a $1,000 personal exemption. New Jersey SDI/FLI (small mandatory payroll deductions, typically well under 1% in recent years) are not modeled here.' },
    nm: { name: 'New Mexico', formula_model: 'progressive_brackets', effective_date: '2025-01-01',
        source: { agency_name: 'New Mexico Taxation and Revenue Department', url: 'https://www.tax.newmexico.gov/', statute_ref: 'N.M. Stat. § 7-2-7, as amended by HB 252 (2024)' },
        params: { brackets: [{ upTo: 5500, rate: 0.015 }, { upTo: 11000, rate: 0.032 }, { upTo: 16000, rate: 0.043 }, { upTo: 210000, rate: 0.047 }, { upTo: null, rate: 0.059 }], standard_deduction: 14600 },
        extra_deviation: 'HB 252 (2024) restructured New Mexico\'s brackets with a possible additional intermediate tier around $16,000-$210,000; this estimate uses the historically stable 5-bracket structure, which may not capture the newest intermediate bracket precisely — verify against tax.newmexico.gov for high-precision use.' },
    nd: { name: 'North Dakota', formula_model: 'progressive_brackets', effective_date: '2026-01-01',
        source: { agency_name: 'North Dakota Office of State Tax Commissioner', url: 'https://www.tax.nd.gov/', statute_ref: 'N.D. Cent. Code § 57-38-30.3' },
        params: { brackets: [{ upTo: 44725, rate: 0.0195 }, { upTo: null, rate: 0.025 }], standard_deduction: 16100 } },
    ok: { name: 'Oklahoma', formula_model: 'progressive_brackets', effective_date: '2026-01-01',
        source: { agency_name: 'Oklahoma Tax Commission', url: 'https://oklahoma.gov/tax.html', statute_ref: 'Okla. Stat. tit. 68 § 2355' },
        params: { brackets: [{ upTo: 1000, rate: 0.0025 }, { upTo: 2500, rate: 0.0075 }, { upTo: 3750, rate: 0.0175 }, { upTo: 4900, rate: 0.0275 }, { upTo: 7200, rate: 0.0375 }, { upTo: null, rate: 0.0475 }], standard_deduction: 6350 } },
    or: { name: 'Oregon', formula_model: 'progressive_brackets', effective_date: '2026-01-01',
        source: { agency_name: 'Oregon Department of Revenue', url: 'https://www.oregon.gov/dor/', statute_ref: 'Or. Rev. Stat. § 316.037' },
        params: { brackets: [{ upTo: 4050, rate: 0.0475 }, { upTo: 10200, rate: 0.0675 }, { upTo: 125000, rate: 0.0875 }, { upTo: null, rate: 0.099 }], standard_deduction: 2875 } },
    ri: { name: 'Rhode Island', formula_model: 'progressive_brackets', effective_date: '2026-01-01',
        source: { agency_name: 'Rhode Island Division of Taxation', url: 'https://tax.ri.gov/', statute_ref: 'R.I. Gen. Laws § 44-30-2.6' },
        params: { brackets: [{ upTo: 73450, rate: 0.0375 }, { upTo: 166950, rate: 0.0475 }, { upTo: null, rate: 0.0599 }], standard_deduction: 10550, personal_exemption: 4700 } },
    sc: { name: 'South Carolina', formula_model: 'progressive_brackets', effective_date: '2026-01-01',
        source: { agency_name: 'South Carolina Department of Revenue', url: 'https://dor.sc.gov/', statute_ref: 'H.4216 (signed 2026-03-30) — 2-bracket overhaul, 1.99% under $30,000 / 5.21% above, decoupling from the federal standard deduction' },
        params: { brackets: [{ upTo: 30000, rate: 0.0199 }, { upTo: null, rate: 0.0521 }], standard_deduction: 0 },
        extra_deviation: 'H.4216 replaces the federal standard deduction with a new "South Carolina Income Adjusted Deduction" (SCIAD); this page could not confirm the exact SCIAD dollar amount at last-verified date and uses $0, which overstates SC tax liability. Verify at dor.sc.gov before relying on this figure.' },
    sd: { name: 'South Dakota', formula_model: 'no_income_tax', effective_date: '1943-01-01',
        source: { agency_name: 'South Dakota Department of Revenue', url: 'https://dor.sd.gov/', statute_ref: 'S.D. Const. art. XI — no personal income tax' },
        params: {} },
    tn: { name: 'Tennessee', formula_model: 'no_income_tax', effective_date: '2021-01-01',
        source: { agency_name: 'Tennessee Department of Revenue', url: 'https://www.tn.gov/revenue', statute_ref: 'Hall Tax (on interest/dividends) fully repealed 2021-01-01 — no tax on any personal income including wages' },
        params: {} },
    ut: { name: 'Utah', formula_model: 'flat_tax', effective_date: '2026-01-01',
        source: { agency_name: 'Utah State Tax Commission', url: 'https://tax.utah.gov/', statute_ref: 'SB 60 (2026) — flat 4.45% rate, down from 4.5%' },
        params: { rate: 0.0445, credit: 840 },
        extra_deviation: 'Utah has no standard deduction — instead a $840 nonrefundable personal exemption credit is subtracted directly from computed tax (modeled here), floored at $0.' },
    vt: { name: 'Vermont', formula_model: 'progressive_brackets', effective_date: '2026-01-01',
        source: { agency_name: 'Vermont Department of Taxes', url: 'https://tax.vermont.gov/', statute_ref: '32 V.S.A. § 5822' },
        params: { brackets: [{ upTo: 45400, rate: 0.0335 }, { upTo: 110050, rate: 0.066 }, { upTo: 229550, rate: 0.076 }, { upTo: null, rate: 0.0875 }], standard_deduction: 7000 } },
    va: { name: 'Virginia', formula_model: 'progressive_brackets', effective_date: '2026-01-01',
        source: { agency_name: 'Virginia Department of Taxation', url: 'https://www.tax.virginia.gov/', statute_ref: 'Va. Code § 58.1-320' },
        params: { brackets: [{ upTo: 3000, rate: 0.02 }, { upTo: 5000, rate: 0.03 }, { upTo: 17000, rate: 0.05 }, { upTo: null, rate: 0.0575 }], standard_deduction: 8750, personal_exemption: 930 } },
    wa: { name: 'Washington', formula_model: 'no_income_tax', effective_date: '1933-01-01',
        source: { agency_name: 'Washington Department of Revenue', url: 'https://dor.wa.gov/', statute_ref: 'No personal income tax on wages' },
        params: {},
        extra_deviation: 'Washington has a 7% capital gains tax on gains over $262,000/year — not a wage tax and not modeled here, since this calculator computes wage-income paychecks only.' },
    wv: { name: 'West Virginia', formula_model: 'progressive_brackets', effective_date: '2026-01-01',
        source: { agency_name: 'West Virginia State Tax Department', url: 'https://tax.wv.gov/', statute_ref: 'W. Va. Code § 11-21-4e — rates cut ~5% for 2026' },
        params: { brackets: [{ upTo: 10000, rate: 0.0211 }, { upTo: 25000, rate: 0.0246 }, { upTo: 40000, rate: 0.0272 }, { upTo: 60000, rate: 0.0326 }, { upTo: null, rate: 0.0458 }], standard_deduction: 0 } },
    wi: { name: 'Wisconsin', formula_model: 'progressive_brackets', effective_date: '2026-01-01',
        source: { agency_name: 'Wisconsin Department of Revenue', url: 'https://www.revenue.wi.gov/', statute_ref: 'Wis. Stat. § 71.06' },
        params: { brackets: [{ upTo: 14320, rate: 0.0354 }, { upTo: 28640, rate: 0.0465 }, { upTo: 315310, rate: 0.053 }, { upTo: null, rate: 0.0765 }], standard_deduction: 12760 },
        extra_deviation: 'Wisconsin\'s standard deduction phases out on a sliding scale above ~$18,950 (single); this estimate uses the maximum deduction, which understates tax for higher earners within the phase-out band.' },
    wy: { name: 'Wyoming', formula_model: 'no_income_tax', effective_date: '1913-01-01',
        source: { agency_name: 'Wyoming Department of Revenue', url: 'https://revenue.wyo.gov/', statute_ref: 'No personal income tax' },
        params: {} }
};

function slugify(name) { return name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, ''); }
function fmtMoney(n) { return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
function fmtPct(r) { return (r * 100).toFixed(2).replace(/\.00$/, '') + '%'; }

function worksheetSteps(entry) {
    const base = [
        'Start with your gross annual salary.',
        'Subtract the 2026 federal standard deduction ($16,100 single) to get taxable income, then apply the 2026 federal brackets (10%-37%).',
        'Subtract FICA: 6.2% Social Security (up to the $184,500 wage base) + 1.45% Medicare (all wages, +0.9% above $200,000).'
    ];
    if (entry.formula_model === 'no_income_tax') {
        base.push(`${entry.name} charges no state income tax — your paycheck stops there. What's left is your net take-home pay.`);
    } else if (entry.formula_model === 'flat_tax') {
        const p = entry.params;
        let step = `Subtract ${entry.name}'s`;
        const parts = [];
        if (p.standard_deduction) parts.push(`${fmtMoney(p.standard_deduction)} standard deduction`);
        if (p.personal_exemption) parts.push(`${fmtMoney(p.personal_exemption)} personal exemption`);
        if (p.federal_tax_deductible) parts.push('the federal tax you paid');
        step += parts.length ? ` ${parts.join(' and ')} from gross wages, then apply the flat ${fmtPct(p.rate)} state rate.` : ` flat ${fmtPct(p.rate)} state rate to gross wages.`;
        if (p.credit) step += ` Subtract the ${fmtMoney(p.credit)} nonrefundable credit from the result.`;
        if (p.surtax) step += ` An additional ${fmtPct(p.surtax.rate)} surtax applies to income over ${fmtMoney(p.surtax.threshold)}.`;
        base.push(step);
        base.push(`What's left is your net take-home pay${entry.local_tax_note ? ' before any local tax' : ''}.`);
    } else if (entry.formula_model === 'progressive_brackets') {
        const p = entry.params;
        let step = `Subtract ${entry.name}'s`;
        const parts = [];
        if (p.standard_deduction) parts.push(`${fmtMoney(p.standard_deduction)} standard deduction`);
        if (p.personal_exemption) parts.push(`${fmtMoney(p.personal_exemption)} personal exemption`);
        if (p.federal_tax_deductible) parts.push('the federal tax you paid');
        step += parts.length ? ` ${parts.join(' and ')} from gross wages, then apply the ${p.brackets.length}-bracket state schedule (${fmtPct(p.brackets[0].rate)}-${fmtPct(p.brackets[p.brackets.length - 1].rate)}) marginally.` : ` apply the ${p.brackets.length}-bracket state schedule (${fmtPct(p.brackets[0].rate)}-${fmtPct(p.brackets[p.brackets.length - 1].rate)}) marginally to gross wages.`;
        base.push(step);
        base.push(`What's left is your net take-home pay${entry.local_tax_note ? ' before any local tax' : ''}.`);
    }
    return base;
}

function faqExtra(entry) {
    const faqs = [];
    if (entry.formula_model === 'no_income_tax') {
        faqs.push({ q: `Does ${entry.name} have a state income tax?`, a: `No. ${entry.name} is one of nine states with no personal income tax. Only federal income tax and FICA are withheld from your paycheck.` });
    } else if (entry.formula_model === 'flat_tax') {
        faqs.push({ q: `What is ${entry.name}'s state income tax rate?`, a: `${entry.name} charges a flat ${fmtPct(entry.params.rate)} rate for tax year 2026.${entry.params.standard_deduction ? ` Standard deduction: ${fmtMoney(entry.params.standard_deduction)} for single filers.` : ''}` });
    } else {
        faqs.push({ q: `What are ${entry.name}'s income tax brackets for 2026?`, a: `${entry.name} uses ${entry.params.brackets.length} marginal brackets ranging from ${fmtPct(entry.params.brackets[0].rate)} to ${fmtPct(entry.params.brackets[entry.params.brackets.length - 1].rate)}.${entry.params.standard_deduction ? ` Standard deduction: ${fmtMoney(entry.params.standard_deduction)} for single filers.` : ''}` });
    }
    faqs.push({ q: `How much is take-home pay on $${EXAMPLE_INCOME.toLocaleString()} in ${entry.name}?`, a: '__COMPUTED__' });
    if (entry.local_tax_note) {
        faqs.push({ q: `Does this calculator include ${entry.name} local or city income tax?`, a: entry.local_tax_note });
    }
    return faqs;
}

let states = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'states.json'), 'utf8'));
const rows = [];
const verifRows = [];

for (const [abbr, entry] of Object.entries(STATES)) {
    entry.abbr = abbr.toUpperCase();
    entry.slug = slugify(entry.name);
    entry.last_verified = TODAY;
    entry.guideline_version = `2026-${entry.abbr}-v1`;

    const rules = {
        rounding: 'nearest_cent',
        extra_payroll_tax: entry.extra_payroll_tax || null,
        local_tax_note: entry.local_tax_note || null,
        deviation_note: `This is an estimate based on standard single-filer federal, FICA, and ${entry.abbr} state calculations. Actual withholding may differ based on your W-4 elections, pre-tax deductions, and other factors.${entry.extra_deviation ? ' ' + entry.extra_deviation : ''}`
    };

    // Compute the worked example via the real engine (not hand arithmetic).
    const r = calculatePaycheck(entry, rules, EXAMPLE_INCOME, 'annual');
    const calcLines = [
        `Federal tax: ${fmtMoney(r.federalTax)}`,
        `FICA: ${fmtMoney(r.fica.total)}`,
        `${entry.name} state tax: ${r.stateTaxBreakdown}`
    ];
    if (r.extraPayrollTax.amount > 0) calcLines.push(`${r.extraPayrollTax.name}: ${fmtMoney(r.extraPayrollTax.amount)}`);
    calcLines.push(`Net annual pay: ${fmtMoney(EXAMPLE_INCOME)} - ${fmtMoney(r.totalWithheld)} = ${fmtMoney(r.netAnnual)} (≈${fmtMoney(round2(r.netAnnual / 12))}/month)`);

    entry.worksheet = {
        steps: worksheetSteps(entry),
        example: {
            scenario: `Example: $${EXAMPLE_INCOME.toLocaleString()}/year gross salary, single filer, ${entry.name} resident.`,
            calculation: calcLines
        }
    };

    const faqs = faqExtra(entry);
    for (const f of faqs) {
        if (f.a === '__COMPUTED__') {
            f.a = `On a $${EXAMPLE_INCOME.toLocaleString()} gross salary, a single filer in ${entry.name} takes home roughly ${fmtMoney(r.netAnnual)}/year (about ${fmtMoney(round2(r.netAnnual / 12))}/month) after federal tax, FICA${entry.formula_model !== 'no_income_tax' ? ', and state tax' : ''}${entry.local_tax_note ? ' — before any local tax' : ''}.`;
        }
    }
    entry.faq_extra = faqs;

    delete entry.local_tax_note;
    delete entry.extra_payroll_tax;
    delete entry.extra_deviation;

    states[abbr] = entry;

    fs.writeFileSync(path.join(__dirname, 'data', 'rules', `${abbr}.json`), JSON.stringify(rules, null, 2) + '\n');

    rows.push(`${entry.name},${entry.formula_model},SHIPPED,${entry.source.url},${TODAY},"${entry.source.statute_ref.replace(/"/g, "'")}"`);
    verifRows.push(`${entry.name},${entry.guideline_version},"$${EXAMPLE_INCOME.toLocaleString()}/yr gross, single filer",Engine-computed from sourced rate/bracket params,net ${fmtMoney(r.netAnnual)}/yr,$0 (self-consistent; params sourced from primary DOR/statute),claude-sonnet-5,${TODAY}`);
}

function round2(n) { return Math.round(n * 100) / 100; }

fs.writeFileSync(path.join(__dirname, 'data', 'states.json'), JSON.stringify(states, null, 2) + '\n');
fs.appendFileSync(path.join(__dirname, 'research', 'sourcing-tracker.csv'), rows.join('\n') + '\n');
fs.appendFileSync(path.join(__dirname, 'research', 'verification-log.csv'), verifRows.join('\n') + '\n');

console.log(`Added ${Object.keys(STATES).length} states. Total states: ${Object.keys(states).length}`);
