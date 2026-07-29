/**
 * Build guardrail for the paycheck calculator. No CI on this repo — run `node verify.js`
 * before every commit that touches assets/calc-engine.js or generate-pages.js.
 * Exits non-zero on any failed assertion.
 */
const engine = require('./assets/calc-engine.js');
const states = require('./data/states.json');
const txRules = require('./data/rules/tx.json');
const caRules = require('./data/rules/ca.json');

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

if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`);
    process.exit(1);
} else {
    console.log('\nAll assertions passed.');
}
