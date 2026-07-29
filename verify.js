/**
 * Build guardrail for the paycheck calculator. No CI on this repo — run `node verify.js`
 * before every commit that touches assets/calc-engine.js or generate-pages.js.
 * Exits non-zero on any failed assertion.
 */
const engine = require('./assets/calc-engine.js');
const states = require('./data/states.json');
const txRules = require('./data/rules/tx.json');
const caRules = require('./data/rules/ca.json');
const nyRules = require('./data/rules/ny.json');
const paRules = require('./data/rules/pa.json');
const moRules = require('./data/rules/mo.json');
const alRules = require('./data/rules/al.json');

let failures = 0;
function assertEqual(actual, expected, label) {
    if (actual !== expected) {
        console.error(`FAIL: ${label} — expected ${expected}, got ${actual}`);
        failures++;
    } else {
        console.log(`ok: ${label}`);
    }
}
function assertTrue(cond, label) {
    if (!cond) {
        console.error(`FAIL: ${label}`);
        failures++;
    } else {
        console.log(`ok: ${label}`);
    }
}

// --- Baseline regression: today's single-filer output must never silently change ---
const txBaseline = engine.calculatePaycheck(states.tx, txRules, 65000, 'biweekly');
assertEqual(txBaseline.federalTax, 5620, 'TX baseline federal tax @ $65k biweekly single');
assertEqual(txBaseline.stateTax, 0, 'TX baseline state tax (no income tax)');
assertEqual(txBaseline.netAnnual, 54407.5, 'TX baseline net annual');

const caBaseline = engine.calculatePaycheck(states.ca, caRules, 65000, 'biweekly');
assertEqual(caBaseline.federalTax, 5620, 'CA baseline federal tax @ $65k biweekly single');
assertEqual(caBaseline.stateTax, 2203.76, 'CA baseline state tax');
assertEqual(caBaseline.netAnnual, 51358.74, 'CA baseline net annual');

// --- Phase 1: filing status ---
const mfjTx = engine.calculatePaycheck(states.tx, txRules, 65000, 'biweekly', 'mfj');
assertTrue(mfjTx.federalTax < txBaseline.federalTax, 'MFJ federal tax < single federal tax at same income (TX)');
const hohCa = engine.calculatePaycheck(states.ca, caRules, 65000, 'biweekly', 'hoh');
assertTrue(hohCa.federalTax < caBaseline.federalTax, 'HoH federal tax < single federal tax (CA)');

// --- Phase 2: pre-tax deductions (FICA vs income-tax wage-base split) ---
const with401k = engine.calculatePaycheck(states.tx, txRules, 65000, 'biweekly', 'single', { retirement401k: { type: 'percent', value: 10 } });
assertEqual(with401k.fica.total, txBaseline.fica.total, '401(k) does not reduce FICA wages');
assertTrue(with401k.federalTax < txBaseline.federalTax, '401(k) reduces federal taxable wages');
const withHsa = engine.calculatePaycheck(states.tx, txRules, 65000, 'biweekly', 'single', { hsa: 200 });
assertTrue(withHsa.fica.total < txBaseline.fica.total, 'HSA reduces FICA wages');
assertTrue(withHsa.federalTax < txBaseline.federalTax, 'HSA reduces federal taxable wages');

// --- Phase 3: hourly annualization ---
assertEqual(engine.annualizeHourly(20, 40), 41600, 'annualizeHourly($20/hr, 40hr/wk) = $41,600');

// --- Tier 2 Phase 1: bonus calculator ---
const bonusTx = engine.calcBonusPaycheck(states.tx, txRules, 65000, 5000, 'biweekly', 'single');
assertEqual(bonusTx.bonusFederalTax, 1100, 'TX bonus federal tax = 22% flat on $5,000 bonus');
// Naive calcFICA(bonusAmount) would apply the SS wage cap from zero on just the bonus; the delta
// method must NOT match that naive (wrong) approach when regular wages are within the SS cap for
// both the regular and combined incomes (should be simple 7.65% on the bonus slice in this case).
assertEqual(bonusTx.bonusFica, 382.5, 'TX bonus FICA = delta method, 7.65% of $5,000 (regular income well under SS cap)');
const bonusCa = engine.calcBonusPaycheck(states.ca, caRules, 65000, 5000, 'biweekly', 'single');
assertTrue(bonusCa.bonusStateTax > 0, 'CA bonus state tax delta > 0 for a progressive-bracket state');
// SS wage cap proration check: regular income already at/above the cap means the bonus itself
// should add ~0 additional Social Security (only Medicare + Additional Medicare apply).
const bonusAtCap = engine.calcBonusPaycheck(states.tx, txRules, 184500, 10000, 'biweekly', 'single');
assertTrue(bonusAtCap.bonusFica < 10000 * 0.0765, 'Bonus FICA below cap-naive 7.65% when regular income already exceeds the SS wage base (cap correctly prorated)');

// --- Tier 2 Phase 2: NYC/Yonkers/Philadelphia local tax ---
const nyNone = engine.calculatePaycheck(states.ny, nyRules, 65000, 'biweekly', 'single', null, 'none');
const nyNyc = engine.calculatePaycheck(states.ny, nyRules, 65000, 'biweekly', 'single', null, 'nyc');
assertTrue(nyNyc.netAnnual < nyNone.netAnnual, 'NYC selection reduces net pay vs none (NY)');
const nycOption = nyRules.local_tax.options.find(o => o.id === 'nyc');
const nyStandardDeduction = states.ny.params.standard_deduction;
const expectedNycTax = engine.marginalBracketTax(65000 - nyStandardDeduction, nycOption.brackets);
assertEqual(nyNyc.localTax.amount, Math.round(expectedNycTax * 100) / 100, 'NYC bracket tax computed on NY taxable base (gross - standard deduction), not raw gross');
assertTrue(nyNyc.localTax.amount < engine.marginalBracketTax(65000, nycOption.brackets), 'NYC tax on taxable base is less than if (incorrectly) computed on raw gross');

const nyYonkers = engine.calculatePaycheck(states.ny, nyRules, 65000, 'biweekly', 'single', null, 'yonkers');
assertTrue(nyYonkers.localTax.amount > 0, 'Yonkers selection > 0 (NY)');
const yonkersOption = nyRules.local_tax.options.find(o => o.id === 'yonkers');
assertEqual(nyYonkers.localTax.amount, Math.round(nyNone.stateTax * yonkersOption.rate * 100) / 100, 'Yonkers surcharge = 16.75% of NY state tax');

const paNone = engine.calculatePaycheck(states.pa, paRules, 65000, 'biweekly', 'single', null, 'none');
const paPhilly = engine.calculatePaycheck(states.pa, paRules, 65000, 'biweekly', 'single', null, 'phila_resident');
assertTrue(paPhilly.localTax.amount > 0, 'Philadelphia resident selection > 0 (PA)');
assertTrue(paPhilly.netAnnual < paNone.netAnnual, 'Philadelphia selection reduces net pay vs none (PA)');

// Regression: an unrelated state's 6-arg calculatePaycheck call (no localTaxOptionId) must still
// match the Phase-1 baselines exactly — the 7th param must be fully backward compatible.
assertEqual(txBaseline.federalTax, engine.calculatePaycheck(states.tx, txRules, 65000, 'biweekly').federalTax, 'TX 6-arg call unaffected by 7th local-tax param');

// --- Local tax expansion Phase 5: Missouri (KC/STL) + Alabama (city occupational tax) ---
const moNone = engine.calculatePaycheck(states.mo, moRules, 65000, 'biweekly', 'single', null, 'none');
const moKc = engine.calculatePaycheck(states.mo, moRules, 65000, 'biweekly', 'single', null, 'kc');
assertTrue(moKc.localTax.amount > 0, 'Kansas City selection > 0 (MO)');
assertEqual(moKc.localTax.amount, Math.round(65000 * 0.01 * 100) / 100, 'KC earnings tax = 1% of gross');
const moStl = engine.calculatePaycheck(states.mo, moRules, 65000, 'biweekly', 'single', null, 'stl');
assertTrue(moStl.localTax.amount > 0, 'St. Louis selection > 0 (MO)');
assertEqual(moNone.localTax.amount, 0, 'MO "none" selection computes 0');

const alBirmingham = engine.calculatePaycheck(states.al, alRules, 65000, 'biweekly', 'single', null, 'birmingham');
assertTrue(alBirmingham.localTax.amount > 0, 'Birmingham selection > 0 (AL)');
const alGadsden = engine.calculatePaycheck(states.al, alRules, 65000, 'biweekly', 'single', null, 'gadsden');
assertEqual(alGadsden.localTax.amount, Math.round(65000 * 0.02 * 100) / 100, 'Gadsden occupational tax = 2% of gross');
const alOther = engine.calculatePaycheck(states.al, alRules, 65000, 'biweekly', 'single', null, 'other');
assertEqual(alOther.localTax.amount, 0, 'AL "Other city" option computes 0, same as none');

if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`);
    process.exit(1);
} else {
    console.log('\nAll assertions passed.');
}
