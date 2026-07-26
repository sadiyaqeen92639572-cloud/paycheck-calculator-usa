/**
 * USA Paycheck Calculator — shared tax engine.
 * Loaded once as a static asset across all state pages (not inlined per page).
 * One pure function per formula_model, plus a dispatcher, plus shared federal/FICA helpers.
 */

// ---- 2026 federal constants (single filer only, v1 scope) ----
// Source: IRS Revenue Procedure 2025-32, https://www.irs.gov/pub/irs-drop/rp-25-32.pdf
const FEDERAL_STANDARD_DEDUCTION_SINGLE = 16100;
const FEDERAL_BRACKETS_SINGLE = [
    { upTo: 12400, rate: 0.10 },
    { upTo: 50400, rate: 0.12 },
    { upTo: 105700, rate: 0.22 },
    { upTo: 201775, rate: 0.24 },
    { upTo: 256225, rate: 0.32 },
    { upTo: 640600, rate: 0.35 },
    { upTo: null, rate: 0.37 }
];

// FICA constants — Social Security wage base $184,500 (2026), Medicare 1.45% + 0.9% additional over $200,000
const SS_WAGE_BASE_2026 = 184500;
const SS_RATE = 0.062;
const MEDICARE_RATE = 0.0145;
const ADDITIONAL_MEDICARE_RATE = 0.009;
const ADDITIONAL_MEDICARE_THRESHOLD_SINGLE = 200000;

/**
 * Marginal bracket tax over a taxable-income amount.
 * brackets: [{upTo: number|null, rate: number}, ...] sorted ascending, last upTo=null = no ceiling.
 */
function marginalBracketTax(taxableIncome, brackets) {
    if (taxableIncome <= 0) return 0;
    let tax = 0;
    let lower = 0;
    for (const { upTo, rate } of brackets) {
        const ceiling = upTo === null ? Infinity : upTo;
        if (taxableIncome <= lower) break;
        const sliceTop = Math.min(taxableIncome, ceiling);
        tax += (sliceTop - lower) * rate;
        lower = ceiling;
        if (taxableIncome <= ceiling) break;
    }
    return tax;
}

function calcFederalTax(grossAnnualIncome) {
    const taxable = Math.max(0, grossAnnualIncome - FEDERAL_STANDARD_DEDUCTION_SINGLE);
    return marginalBracketTax(taxable, FEDERAL_BRACKETS_SINGLE);
}

function calcFICA(grossAnnualIncome) {
    const ssWages = Math.min(grossAnnualIncome, SS_WAGE_BASE_2026);
    const socialSecurity = ssWages * SS_RATE;
    const medicare = grossAnnualIncome * MEDICARE_RATE;
    const additionalMedicare = Math.max(0, grossAnnualIncome - ADDITIONAL_MEDICARE_THRESHOLD_SINGLE) * ADDITIONAL_MEDICARE_RATE;
    return {
        socialSecurity: round2(socialSecurity),
        medicare: round2(medicare),
        additionalMedicare: round2(additionalMedicare),
        total: round2(socialSecurity + medicare + additionalMedicare)
    };
}

function round2(n) { return Math.round(n * 100) / 100; }

// ---- formula_model implementations ----

function calcNoIncomeTax(grossAnnualIncome, stateEntry, federalTax) {
    return { stateTax: 0, stateTaxBreakdown: 'No state income tax.' };
}

/**
 * federal_tax_deductible: some states (e.g. Alabama) let filers deduct federal income tax
 * paid from the state taxable base. When set, federalTax is subtracted before the state's
 * own deduction/exemption and rate are applied.
 */
function calcFlatTax(grossAnnualIncome, stateEntry, federalTax) {
    const { rate, standard_deduction = 0, personal_exemption = 0, federal_tax_deductible = false, credit = 0, surtax = null } = stateEntry.params;
    const fedDeduction = federal_tax_deductible ? federalTax : 0;
    const deduction = standard_deduction + personal_exemption + fedDeduction;
    const taxable = Math.max(0, grossAnnualIncome - deduction);
    let stateTax = Math.max(0, round2(taxable * rate) - credit);
    let breakdown = `(${fmtMoney(grossAnnualIncome)} - ${fmtMoney(deduction)} deduction${federal_tax_deductible ? ' incl. federal tax paid' : ''}) × ${(rate * 100).toFixed(2)}%${credit ? ` - ${fmtMoney(credit)} credit` : ''} = ${fmtMoney(stateTax)}`;
    if (surtax) {
        const surtaxAmount = round2(Math.max(0, grossAnnualIncome - surtax.threshold) * surtax.rate);
        stateTax = round2(stateTax + surtaxAmount);
        breakdown += surtaxAmount > 0 ? ` + ${fmtMoney(surtaxAmount)} surtax on income over ${fmtMoney(surtax.threshold)}` : '';
    }
    return { stateTax, stateTaxBreakdown: breakdown };
}

function calcProgressiveBrackets(grossAnnualIncome, stateEntry, federalTax) {
    const { brackets, standard_deduction = 0, personal_exemption = 0, federal_tax_deductible = false, surtax = null } = stateEntry.params;
    const fedDeduction = federal_tax_deductible ? federalTax : 0;
    const deduction = standard_deduction + personal_exemption + fedDeduction;
    const taxable = Math.max(0, grossAnnualIncome - deduction);
    let stateTax = round2(marginalBracketTax(taxable, brackets));
    let breakdown = `Marginal tax on ${fmtMoney(taxable)} taxable income (after ${fmtMoney(deduction)} deduction${federal_tax_deductible ? ' incl. federal tax paid' : ''}) = ${fmtMoney(stateTax)}`;
    if (surtax) {
        const surtaxAmount = round2(Math.max(0, grossAnnualIncome - surtax.threshold) * surtax.rate);
        stateTax = round2(stateTax + surtaxAmount);
        breakdown += surtaxAmount > 0 ? ` + ${fmtMoney(surtaxAmount)} surtax on income over ${fmtMoney(surtax.threshold)}` : '';
    }
    return { stateTax, stateTaxBreakdown: breakdown };
}

const FORMULA_DISPATCH = {
    no_income_tax: calcNoIncomeTax,
    flat_tax: calcFlatTax,
    progressive_brackets: calcProgressiveBrackets
};

/**
 * Extra mandatory state payroll tax (SDI, PFL, etc.) — not income tax, but reduces net pay.
 * rules.extra_payroll_tax: { name, rate, wage_cap?, wage_cap_annual_contribution? }
 */
function calcExtraPayrollTax(grossAnnualIncome, rules) {
    const extra = rules && rules.extra_payroll_tax;
    if (!extra) return { amount: 0, name: null };
    let amount;
    if (extra.wage_cap_annual_contribution) {
        amount = Math.min(grossAnnualIncome * extra.rate, extra.wage_cap_annual_contribution);
    } else if (extra.wage_cap) {
        amount = Math.min(grossAnnualIncome, extra.wage_cap) * extra.rate;
    } else {
        amount = grossAnnualIncome * extra.rate;
    }
    return { amount: round2(amount), name: extra.name };
}

const PAY_FREQUENCY_DIVISORS = {
    annual: 1,
    monthly: 12,
    semimonthly: 24,
    biweekly: 26,
    weekly: 52
};

/**
 * Main dispatcher — computes full paycheck breakdown for a given state + annual gross income.
 * Pay-frequency conversion is a pure display-time division of the annual net figure (v1 scope:
 * single-filer only, no separate per-frequency tax computation).
 */
function calculatePaycheck(stateEntry, rules, grossAnnualIncome, payFrequency) {
    grossAnnualIncome = Math.max(0, Number(grossAnnualIncome) || 0);
    const federalTax = round2(calcFederalTax(grossAnnualIncome));
    const fica = calcFICA(grossAnnualIncome);
    const stateFn = FORMULA_DISPATCH[stateEntry.formula_model];
    const { stateTax, stateTaxBreakdown } = stateFn(grossAnnualIncome, stateEntry, federalTax);
    const extraPayroll = calcExtraPayrollTax(grossAnnualIncome, rules);

    const totalWithheld = round2(federalTax + fica.total + stateTax + extraPayroll.amount);
    const netAnnual = round2(grossAnnualIncome - totalWithheld);
    const divisor = PAY_FREQUENCY_DIVISORS[payFrequency] || 1;
    const netPerPeriod = round2(netAnnual / divisor);

    return {
        grossAnnualIncome,
        federalTax,
        fica,
        stateTax,
        stateTaxBreakdown,
        extraPayrollTax: extraPayroll,
        totalWithheld,
        netAnnual,
        netPerPeriod,
        payFrequency
    };
}

function fmtMoney(n) {
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Node (build-time verification) + browser (runtime calculator) export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { calculatePaycheck, calcFederalTax, calcFICA, marginalBracketTax, fmtMoney };
}
