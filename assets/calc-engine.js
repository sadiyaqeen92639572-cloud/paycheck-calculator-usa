/**
 * USA Paycheck Calculator — shared tax engine.
 * Loaded once as a static asset across all state pages (not inlined per page).
 * One pure function per formula_model, plus a dispatcher, plus shared federal/FICA helpers.
 */

// ---- 2026 federal constants, by filing status ----
// Source: IRS Revenue Procedure 2025-32, https://www.irs.gov/pub/irs-drop/rp-25-32.pdf
// MFJ figures cross-checked against https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill
// HoH bracket thresholds cross-checked against Tax Foundation's 2026 bracket table (taxfoundation.org/data/all/federal/2026-tax-brackets/);
// HoH converges with single-filer thresholds at the 32%/35%/37% breakpoints, consistent with IRS's published bracket design.
// Verified 2026-07-29.
const FEDERAL_STANDARD_DEDUCTION = {
    single: 16100,
    mfj: 32200,
    hoh: 24150
};
const FEDERAL_BRACKETS = {
    single: [
        { upTo: 12400, rate: 0.10 },
        { upTo: 50400, rate: 0.12 },
        { upTo: 105700, rate: 0.22 },
        { upTo: 201775, rate: 0.24 },
        { upTo: 256225, rate: 0.32 },
        { upTo: 640600, rate: 0.35 },
        { upTo: null, rate: 0.37 }
    ],
    mfj: [
        { upTo: 24800, rate: 0.10 },
        { upTo: 100800, rate: 0.12 },
        { upTo: 211400, rate: 0.22 },
        { upTo: 403550, rate: 0.24 },
        { upTo: 512450, rate: 0.32 },
        { upTo: 768700, rate: 0.35 },
        { upTo: null, rate: 0.37 }
    ],
    hoh: [
        { upTo: 17700, rate: 0.10 },
        { upTo: 67450, rate: 0.12 },
        { upTo: 105700, rate: 0.22 },
        { upTo: 201775, rate: 0.24 },
        { upTo: 256200, rate: 0.32 },
        { upTo: 640600, rate: 0.35 },
        { upTo: null, rate: 0.37 }
    ]
};

// 2026 IRS pre-tax deduction limits.
// 401(k) elective deferral limit: IRS Notice 2025-67 (retirement plan cost-of-living adjustments).
// HSA contribution limits: IRS Notice 2026-05, https://www.irs.gov/pub/irs-drop/n-26-05.pdf — $4,400 self-only / $8,750 family coverage.
// Verified 2026-07-29.
const RETIREMENT_401K_LIMIT_2026 = 24500;
const HSA_LIMIT_SELF_ONLY_2026 = 4400;
const HSA_LIMIT_FAMILY_2026 = 8750;

// Federal flat-rate supplemental (bonus) withholding — IRS Pub 15 (Circular E), 2026 edition.
// Employers may withhold federal tax on bonuses/supplemental wages at a flat 22% (37% on the
// portion of cumulative supplemental wages over $1,000,000 in a year) instead of the aggregate
// method. This calculator models the flat-rate method only — the aggregate method (adding the
// bonus to a regular paycheck and withholding as if it were the whole period's pay) is not modeled.
// Verified 2026-07-29.
const SUPPLEMENTAL_FLAT_RATE = 0.22;
const SUPPLEMENTAL_HIGH_RATE = 0.37;
const SUPPLEMENTAL_HIGH_THRESHOLD = 1000000;

// FICA constants — Social Security wage base $184,500 (2026), Medicare 1.45% + 0.9% additional
// (statutory, unindexed thresholds: $250,000 MFJ / $200,000 single & HoH)
const SS_WAGE_BASE_2026 = 184500;
const SS_RATE = 0.062;
const MEDICARE_RATE = 0.0145;
const ADDITIONAL_MEDICARE_RATE = 0.009;
const ADDITIONAL_MEDICARE_THRESHOLD = {
    single: 200000,
    mfj: 250000,
    hoh: 200000
};

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

function calcFederalTax(grossAnnualIncome, filingStatus = 'single') {
    const status = FEDERAL_STANDARD_DEDUCTION[filingStatus] !== undefined ? filingStatus : 'single';
    const taxable = Math.max(0, grossAnnualIncome - FEDERAL_STANDARD_DEDUCTION[status]);
    return marginalBracketTax(taxable, FEDERAL_BRACKETS[status]);
}

function calcFICA(grossAnnualIncome, filingStatus = 'single') {
    const threshold = ADDITIONAL_MEDICARE_THRESHOLD[filingStatus] ?? ADDITIONAL_MEDICARE_THRESHOLD.single;
    const ssWages = Math.min(grossAnnualIncome, SS_WAGE_BASE_2026);
    const socialSecurity = ssWages * SS_RATE;
    const medicare = grossAnnualIncome * MEDICARE_RATE;
    const additionalMedicare = Math.max(0, grossAnnualIncome - threshold) * ADDITIONAL_MEDICARE_RATE;
    return {
        socialSecurity: round2(socialSecurity),
        medicare: round2(medicare),
        additionalMedicare: round2(additionalMedicare),
        total: round2(socialSecurity + medicare + additionalMedicare)
    };
}

function round2(n) { return Math.round(n * 100) / 100; }

// ---- formula_model implementations ----

function calcNoIncomeTax(grossAnnualIncome, stateEntry, federalTax, filingStatus = 'single') {
    return { stateTax: 0, stateTaxBreakdown: 'No state income tax.', taxableBase: grossAnnualIncome };
}

/**
 * federal_tax_deductible: some states (e.g. Alabama) let filers deduct federal income tax
 * paid from the state taxable base. When set, federalTax is subtracted before the state's
 * own deduction/exemption and rate are applied.
 *
 * filingStatus: looks for params.standard_deduction_mfj/standard_deduction_hoh overrides,
 * falling back to the single-filer params.standard_deduction when a state hasn't been
 * backfilled with status-specific figures yet (see states.json.filing_status_backfilled).
 */
function calcFlatTax(grossAnnualIncome, stateEntry, federalTax, filingStatus = 'single') {
    const p = stateEntry.params;
    const { rate, federal_tax_deductible = false, credit = 0, surtax = null } = p;
    const standard_deduction = (filingStatus === 'mfj' && p.standard_deduction_mfj !== undefined) ? p.standard_deduction_mfj
                              : (filingStatus === 'hoh' && p.standard_deduction_hoh !== undefined) ? p.standard_deduction_hoh
                              : (p.standard_deduction || 0);
    const personal_exemption = (filingStatus === 'mfj' && p.personal_exemption_mfj !== undefined) ? p.personal_exemption_mfj
                              : (filingStatus === 'hoh' && p.personal_exemption_hoh !== undefined) ? p.personal_exemption_hoh
                              : (p.personal_exemption || 0);
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
    return { stateTax, stateTaxBreakdown: breakdown, taxableBase: taxable };
}

function calcProgressiveBrackets(grossAnnualIncome, stateEntry, federalTax, filingStatus = 'single') {
    const p = stateEntry.params;
    const { federal_tax_deductible = false, surtax = null } = p;
    const brackets = (filingStatus === 'mfj' && p.brackets_mfj) ? p.brackets_mfj
                    : (filingStatus === 'hoh' && p.brackets_hoh) ? p.brackets_hoh
                    : p.brackets;
    const standard_deduction = (filingStatus === 'mfj' && p.standard_deduction_mfj !== undefined) ? p.standard_deduction_mfj
                              : (filingStatus === 'hoh' && p.standard_deduction_hoh !== undefined) ? p.standard_deduction_hoh
                              : (p.standard_deduction || 0);
    const personal_exemption = (filingStatus === 'mfj' && p.personal_exemption_mfj !== undefined) ? p.personal_exemption_mfj
                              : (filingStatus === 'hoh' && p.personal_exemption_hoh !== undefined) ? p.personal_exemption_hoh
                              : (p.personal_exemption || 0);
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
    return { stateTax, stateTaxBreakdown: breakdown, taxableBase: taxable };
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

/**
 * Local/municipal tax (NYC, Yonkers, Philadelphia, etc.) — see rules.local_tax.options.
 * stateTaxableBase: the state's own taxable income base (post state standard deduction/exemption),
 * as returned by FORMULA_DISPATCH — NYC brackets apply to this, NOT raw gross, since NYC tax
 * piggybacks on the NY state taxable-income calculation rather than a separate deduction scheme.
 * kind: 'none' -> 0; 'brackets' -> marginal bracket tax on stateTaxableBase (e.g. NYC);
 * 'surcharge_pct_of_state_tax' -> stateTax * rate (e.g. Yonkers, a surcharge on state tax liability);
 * 'flat_rate_on_gross' -> grossAnnualIncome * rate (e.g. Philadelphia Wage Tax, genuinely gross-based);
 * 'flat_rate_on_state_taxable_base' -> stateTaxableBase * rate (e.g. MD county piggyback tax,
 * IN county income tax — both apply to the same base as the state's own income tax, not gross).
 */
function calcLocalTax(stateTaxableBase, grossAnnualIncome, stateTax, option) {
    if (!option || option.kind === 'none') return { amount: 0, label: null };
    let amount;
    if (option.kind === 'brackets') {
        amount = marginalBracketTax(stateTaxableBase, option.brackets);
    } else if (option.kind === 'surcharge_pct_of_state_tax') {
        amount = stateTax * option.rate;
    } else if (option.kind === 'flat_rate_on_gross') {
        amount = grossAnnualIncome * option.rate;
    } else if (option.kind === 'flat_rate_on_state_taxable_base') {
        amount = stateTaxableBase * option.rate;
    } else {
        amount = 0;
    }
    return { amount: round2(amount), label: option.label };
}

/**
 * Pre-tax deduction split, by IRS wage-base treatment:
 * - Traditional 401(k): reduces federal + state taxable wages, NOT FICA wages.
 * - HSA / employer health insurance premium (Section 125 cafeteria plan): reduces
 *   federal + state + FICA wages.
 * deductions: { retirement401k?: {type:'percent'|'amount', value}, hsa?: number, healthPremium?: number }
 * hsa/healthPremium are $/pay-period; retirement401k.value is either % of salary or $/pay-period.
 */
function calcPreTaxDeductions(grossAnnualIncome, deductions, payFrequency) {
    const divisor = PAY_FREQUENCY_DIVISORS[payFrequency] || 1;
    let retirement401kAnnual = deductions.retirement401k
        ? (deductions.retirement401k.type === 'percent'
            ? grossAnnualIncome * ((deductions.retirement401k.value || 0) / 100)
            : (deductions.retirement401k.value || 0) * divisor)
        : 0;
    const capped401k = Math.min(retirement401kAnnual, RETIREMENT_401K_LIMIT_2026);
    const over401kLimit = retirement401kAnnual > RETIREMENT_401K_LIMIT_2026;
    retirement401kAnnual = capped401k;

    const hsaLimit = (deductions.hsaCoverage === 'family') ? HSA_LIMIT_FAMILY_2026 : HSA_LIMIT_SELF_ONLY_2026;
    let hsaAnnual = (deductions.hsa || 0) * divisor;
    const overHsaLimit = hsaAnnual > hsaLimit;
    hsaAnnual = Math.min(hsaAnnual, hsaLimit);

    const healthPremiumAnnual = (deductions.healthPremium || 0) * divisor;
    const section125Annual = round2(hsaAnnual + healthPremiumAnnual);

    return {
        retirement401kAnnual: round2(retirement401kAnnual),
        section125Annual,
        ficaWages: round2(Math.max(0, grossAnnualIncome - section125Annual)),
        incomeTaxWages: round2(Math.max(0, grossAnnualIncome - retirement401kAnnual - section125Annual)),
        over401kLimit,
        overHsaLimit
    };
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
 * Pay-frequency conversion is a pure display-time division of the annual net figure (no
 * separate per-frequency tax computation). filingStatus: 'single' | 'mfj' | 'hoh'.
 * preTaxDeductions (optional): { retirement401k?, hsa?, hsaCoverage?, healthPremium? } — see calcPreTaxDeductions.
 * SDI/PFL (extra_payroll_tax) is computed on FICA-equivalent wages, consistent with Section 125's FICA
 * wage-base treatment — a documented assumption, not verified against every state's own SDI statute.
 */
function calculatePaycheck(stateEntry, rules, grossAnnualIncome, payFrequency, filingStatus = 'single', preTaxDeductions = null, localTaxOptionId = null) {
    grossAnnualIncome = Math.max(0, Number(grossAnnualIncome) || 0);
    let ficaBase = grossAnnualIncome;
    let taxableBase = grossAnnualIncome;
    let preTax = null;
    if (preTaxDeductions) {
        preTax = calcPreTaxDeductions(grossAnnualIncome, preTaxDeductions, payFrequency);
        ficaBase = preTax.ficaWages;
        taxableBase = preTax.incomeTaxWages;
    }

    const federalTax = round2(calcFederalTax(taxableBase, filingStatus));
    const fica = calcFICA(ficaBase, filingStatus);
    const stateFn = FORMULA_DISPATCH[stateEntry.formula_model];
    const stateResult = stateFn(taxableBase, stateEntry, federalTax, filingStatus);
    const { stateTax, stateTaxBreakdown } = stateResult;
    const extraPayroll = calcExtraPayrollTax(ficaBase, rules);

    let localTax = null;
    if (rules && rules.local_tax && localTaxOptionId) {
        const option = rules.local_tax.options.find(o => o.id === localTaxOptionId);
        if (option) localTax = calcLocalTax(stateResult.taxableBase, grossAnnualIncome, stateTax, option);
    }

    const preTaxTotal = preTax ? round2(preTax.retirement401kAnnual + preTax.section125Annual) : 0;
    const totalWithheld = round2(federalTax + fica.total + stateTax + extraPayroll.amount + (localTax ? localTax.amount : 0));
    const netAnnual = round2(grossAnnualIncome - totalWithheld - preTaxTotal);
    const divisor = PAY_FREQUENCY_DIVISORS[payFrequency] || 1;
    const netPerPeriod = round2(netAnnual / divisor);

    return {
        grossAnnualIncome,
        federalTax,
        fica,
        stateTax,
        stateTaxBreakdown,
        extraPayrollTax: extraPayroll,
        localTax,
        preTaxDeductions: preTax,
        totalWithheld,
        netAnnual,
        netPerPeriod,
        payFrequency,
        filingStatus
    };
}

/**
 * Bonus / supplemental-pay withholding estimate. Federal tax uses the flat-rate supplemental
 * method (22%, 37% above $1M cumulative supplemental wages/year — see SUPPLEMENTAL_FLAT_RATE
 * above). FICA and state SDI/PFL are computed as a delta — calc(regular + bonus) - calc(regular)
 * — rather than calling calcFICA(bonusAmount) directly, so the Social Security wage cap (and any
 * payroll-tax wage cap) prorates correctly against wages already earned in the year instead of
 * re-applying from zero. State income tax is likewise a marginal-bracket delta, which approximates
 * actual liability but is not necessarily the flat supplemental rate some states (e.g. CA, NY)
 * apply to bonus payments specifically — a known scope limitation, not modeled here.
 * No pre-tax deductions (401k/HSA) support in the bonus flow — out of scope for this calculator.
 */
function calcBonusPaycheck(stateEntry, rules, regularAnnualGross, bonusAmount, payFrequency, filingStatus = 'single', localTaxOptionId = null) {
    regularAnnualGross = Math.max(0, Number(regularAnnualGross) || 0);
    bonusAmount = Math.max(0, Number(bonusAmount) || 0);
    const combinedGross = regularAnnualGross + bonusAmount;

    const bonusFederalTax = bonusAmount <= SUPPLEMENTAL_HIGH_THRESHOLD
        ? round2(bonusAmount * SUPPLEMENTAL_FLAT_RATE)
        : round2(SUPPLEMENTAL_HIGH_THRESHOLD * SUPPLEMENTAL_FLAT_RATE + (bonusAmount - SUPPLEMENTAL_HIGH_THRESHOLD) * SUPPLEMENTAL_HIGH_RATE);

    const ficaAtRegular = calcFICA(regularAnnualGross, filingStatus).total;
    const ficaAtCombined = calcFICA(combinedGross, filingStatus).total;
    const bonusFica = round2(ficaAtCombined - ficaAtRegular);

    const federalAtRegular = round2(calcFederalTax(regularAnnualGross, filingStatus));
    const federalAtCombined = round2(calcFederalTax(combinedGross, filingStatus));
    const stateFn = FORMULA_DISPATCH[stateEntry.formula_model];
    const stateResultAtRegular = stateFn(regularAnnualGross, stateEntry, federalAtRegular, filingStatus);
    const stateResultAtCombined = stateFn(combinedGross, stateEntry, federalAtCombined, filingStatus);
    const bonusStateTax = round2(stateResultAtCombined.stateTax - stateResultAtRegular.stateTax);

    const extraAtRegular = calcExtraPayrollTax(regularAnnualGross, rules).amount;
    const extraAtCombined = calcExtraPayrollTax(combinedGross, rules).amount;
    const bonusExtraPayrollTax = round2(extraAtCombined - extraAtRegular);

    let bonusLocalTax = null;
    if (rules && rules.local_tax && localTaxOptionId) {
        const option = rules.local_tax.options.find(o => o.id === localTaxOptionId);
        if (option) {
            const localAtRegular = calcLocalTax(stateResultAtRegular.taxableBase, regularAnnualGross, stateResultAtRegular.stateTax, option);
            const localAtCombined = calcLocalTax(stateResultAtCombined.taxableBase, combinedGross, stateResultAtCombined.stateTax, option);
            bonusLocalTax = { amount: round2(localAtCombined.amount - localAtRegular.amount), label: option.label };
        }
    }

    const bonusNet = round2(bonusAmount - bonusFederalTax - bonusFica - bonusStateTax - bonusExtraPayrollTax - (bonusLocalTax ? bonusLocalTax.amount : 0));

    return {
        regularAnnualGross,
        bonusAmount,
        bonusFederalTax,
        bonusFica,
        bonusStateTax,
        bonusExtraPayrollTax,
        bonusLocalTax,
        bonusNet,
        payFrequency,
        filingStatus
    };
}

function fmtMoney(n) {
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * Annualizes an hourly wage into a gross annual salary, for feeding into calculatePaycheck().
 * otMultiplier: 1.5 for standard time-and-a-half. Models generic weekly overtime (>40hr/week)
 * only — not state-specific daily-OT rules (e.g. California's daily >8hr/1.5x, >12hr/2x).
 */
function annualizeHourly(hourlyRate, hoursPerWeek, otHoursPerWeek = 0, otMultiplier = 1.5) {
    const regularAnnual = hourlyRate * hoursPerWeek * 52;
    const otAnnual = hourlyRate * otMultiplier * otHoursPerWeek * 52;
    return round2(regularAnnual + otAnnual);
}

// Self-employment (SE) tax constants — IRC §1401 (15.3% = 12.4% Social Security + 2.9%
// Medicare, on 92.35% of net SE income), IRC §164(f) (half of SE tax is an above-the-line
// federal deduction). Same SS_WAGE_BASE_2026 / ADDITIONAL_MEDICARE_THRESHOLD as FICA above.
// Source: IRS Schedule SE (Form 1040) instructions, 2026. Verified 2026-07-29.
const SE_NET_EARNINGS_FACTOR = 0.9235;
const SE_SOCIAL_SECURITY_RATE = 0.124;
const SE_MEDICARE_RATE = 0.029;

/**
 * Self-employment / 1099 tax estimate. Assumes netSEIncome is the filer's ONLY earnings for
 * the year — if the filer also has W-2 wages (common for side 1099 work alongside a day job),
 * the Social Security wage-base cap and Additional Medicare threshold are actually computed
 * against COMBINED W-2 + SE earnings, not SE income alone, so results run high for anyone with
 * substantial W-2 income too. Does not model the 20% Qualified Business Income (QBI) deduction
 * (IRC §199A) — phases out by income and business type, too state/entity-dependent to model
 * generically. quarterlyEstimate is an even 4-way split, not the real (unevenly spaced) IRS
 * estimated-payment due dates (mid-April/June/September, January).
 */
function calcSelfEmployedTax(stateEntry, rules, netSEIncome, filingStatus = 'single') {
    netSEIncome = Math.max(0, Number(netSEIncome) || 0);
    const threshold = ADDITIONAL_MEDICARE_THRESHOLD[filingStatus] ?? ADDITIONAL_MEDICARE_THRESHOLD.single;

    const seTaxableBase = netSEIncome * SE_NET_EARNINGS_FACTOR;
    const ssPortion = Math.min(seTaxableBase, SS_WAGE_BASE_2026) * SE_SOCIAL_SECURITY_RATE;
    const medicarePortion = seTaxableBase * SE_MEDICARE_RATE;
    const additionalMedicare = Math.max(0, seTaxableBase - threshold) * ADDITIONAL_MEDICARE_RATE;
    const seTax = round2(ssPortion + medicarePortion + additionalMedicare);

    const standardDeduction = FEDERAL_STANDARD_DEDUCTION[filingStatus] ?? FEDERAL_STANDARD_DEDUCTION.single;
    const federalTaxableIncome = Math.max(0, netSEIncome - seTax / 2 - standardDeduction);
    const federalTax = round2(marginalBracketTax(federalTaxableIncome, FEDERAL_BRACKETS[filingStatus] ?? FEDERAL_BRACKETS.single));

    const stateFn = FORMULA_DISPATCH[stateEntry.formula_model];
    const stateTaxableIncome = Math.max(0, netSEIncome - seTax / 2);
    const stateResult = stateFn(stateTaxableIncome, stateEntry, federalTax, filingStatus);

    const quarterlyEstimate = round2((federalTax + seTax + stateResult.stateTax) / 4);
    const netIncome = round2(netSEIncome - federalTax - seTax - stateResult.stateTax);

    return {
        netSEIncome,
        seTax,
        federalTax,
        stateTax: stateResult.stateTax,
        quarterlyEstimate,
        netIncome,
        filingStatus
    };
}

/**
 * Withholding pace checkup — pure arithmetic, no tax constants. Not a replica of the IRS's
 * multiple-jobs worksheet (which uses lookup tables, not simple brackets); this is a "will your
 * current withholding pace cover your expected federal tax bill" projection, meant to inform the
 * extra-withholding amount on Form W-4 Step 4(c). Projects your remaining withholding at the same
 * per-period pace you've withheld so far this year (ytdWithheld / periodsElapsed), then compares
 * the projected annual total against expectedAnnualFederalTax.
 */
function calcWithholdingGap(expectedAnnualFederalTax, ytdWithheld, periodsElapsed, payPeriodsRemaining) {
    expectedAnnualFederalTax = Math.max(0, Number(expectedAnnualFederalTax) || 0);
    ytdWithheld = Math.max(0, Number(ytdWithheld) || 0);
    periodsElapsed = Math.max(0, Number(periodsElapsed) || 0);
    payPeriodsRemaining = Math.max(0, Number(payPeriodsRemaining) || 0);

    const currentPacePerPeriod = periodsElapsed > 0 ? ytdWithheld / periodsElapsed : 0;
    const projectedTotalWithholding = round2(ytdWithheld + currentPacePerPeriod * payPeriodsRemaining);
    const projectedShortfall = round2(expectedAnnualFederalTax - projectedTotalWithholding);
    const recommendedExtraPerPeriod = (projectedShortfall > 0 && payPeriodsRemaining > 0)
        ? round2(projectedShortfall / payPeriodsRemaining)
        : 0;

    return {
        currentPacePerPeriod: round2(currentPacePerPeriod),
        projectedTotalWithholding,
        projectedShortfall,
        recommendedExtraPerPeriod,
        onTrack: projectedShortfall <= 0
    };
}

// Node (build-time verification) + browser (runtime calculator) export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { calculatePaycheck, calcBonusPaycheck, calcSelfEmployedTax, calcWithholdingGap, calcFederalTax, calcFICA, marginalBracketTax, fmtMoney, annualizeHourly };
}
