/**
 * Adds 2 more FAQ questions to each of the 41 batch-2 (templated) states, closing the
 * content-depth gap flagged in audit vs the original 10 hand-written states.
 * Does not touch the original 10 states (tx,fl,pa,il,ga,nc,mi,ca,ny,oh) — already at 3 FAQ.
 */
const fs = require('fs');
const path = require('path');

const ORIGINAL_10 = new Set(['tx', 'fl', 'pa', 'il', 'ga', 'nc', 'mi', 'ca', 'ny', 'oh']);

function fmtMoney(n) { return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
function fmtPct(r) { return (r * 100).toFixed(2).replace(/\.00$/, '') + '%'; }

function deductionFaq(entry) {
    const p = entry.params;
    if (entry.formula_model === 'no_income_tax') {
        return { q: `Why doesn't ${entry.name} have a state income tax?`, a: `${entry.name} is constitutionally or statutorily barred from levying a personal income tax on wages. See the Methodology section below for the specific citation.` };
    }
    const parts = [];
    if (p.standard_deduction) parts.push(`a ${fmtMoney(p.standard_deduction)} standard deduction`);
    if (p.personal_exemption) parts.push(`a ${fmtMoney(p.personal_exemption)} personal exemption`);
    if (p.federal_tax_deductible) parts.push('a deduction for federal income tax paid');
    if (p.credit) parts.push(`a ${fmtMoney(p.credit)} nonrefundable tax credit (subtracted from computed tax, not from taxable income)`);
    if (p.surtax) parts.push(`an additional ${fmtPct(p.surtax.rate)} surtax on income over ${fmtMoney(p.surtax.threshold)}`);
    const desc = parts.length ? parts.join(', plus ') : 'no standard deduction — the full rate applies to gross wages';
    return { q: `What deductions does ${entry.name} apply before taxing my income?`, a: `${entry.name} applies ${desc}, before ${entry.formula_model === 'flat_tax' ? `the flat ${fmtPct(p.rate)} rate` : 'its marginal bracket schedule'}. See the "How ${entry.name} Paycheck Tax Is Calculated" section above for the exact formula.` };
}

function filingStatusFaq(entry) {
    return { q: `Does this estimate change if I'm married or have dependents?`, a: `This calculator uses single-filer figures only (v1 scope). Married filing jointly typically uses different ${entry.formula_model === 'no_income_tax' ? 'federal' : 'federal and ' + entry.name + ' state'} brackets and a larger standard deduction — your actual take-home pay will differ. Dependents can also reduce federal withholding via the W-4. Check ${entry.source.agency_name}'s married-filing-jointly tables for a precise figure.` };
}

const statesPath = path.join(__dirname, 'data', 'states.json');
const states = JSON.parse(fs.readFileSync(statesPath, 'utf8'));

let updated = 0;
for (const [abbr, entry] of Object.entries(states)) {
    if (ORIGINAL_10.has(abbr)) continue;
    if (!entry.faq_extra) continue;
    // Insert the 2 new FAQs before the last one (local-tax FAQ, if present) so it stays last.
    const hasLocalFaq = entry.local_tax_note_faq_marker || (entry.faq_extra.length > 2);
    const newFaqs = [deductionFaq(entry), filingStatusFaq(entry)];
    // faq_extra currently ends with [rate/bracket, take-home, (local-tax if any)]
    // Insert new ones right after the take-home question (index 1), before any trailing local-tax FAQ.
    entry.faq_extra.splice(2, 0, ...newFaqs);
    updated++;
}

fs.writeFileSync(statesPath, JSON.stringify(states, null, 2) + '\n');
console.log(`Updated FAQ for ${updated} batch-2 states.`);
