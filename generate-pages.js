const fs = require('fs');
const path = require('path');

const states = require('./data/states.json');
const SITE_URL = 'https://calcpaycheck.com';
const YEAR = 2026;

const GESMINE_ORG = {
    '@type': 'Organization',
    name: 'USA Paycheck Calculator',
    legalName: 'Gesmine-Invest Limited',
    url: SITE_URL + '/about/',
    identifier: { '@type': 'PropertyValue', propertyID: 'UK Company Number', value: '14120136' },
    address: { '@type': 'PostalAddress', streetAddress: 'Hardy House, 269 Poynders Gardens', addressLocality: 'London', postalCode: 'SW4 8PQ', addressCountry: 'GB' }
};

function assertComplete(state) {
    const missing = [];
    if (!state.source || !state.source.url) missing.push('source.url');
    if (!state.source || !state.source.agency_name) missing.push('source.agency_name');
    if (!state.last_verified) missing.push('last_verified');
    if (!state.guideline_version) missing.push('guideline_version');
    if (missing.length) {
        throw new Error(`State ${state.abbr || '?'} missing required field(s): ${missing.join(', ')} — no page ships without a cited, dated source.`);
    }
}

function loadRules(abbr) {
    const file = path.join(__dirname, 'data', 'rules', `${abbr}.json`);
    if (!fs.existsSync(file)) throw new Error(`Missing rules file: ${file}`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fmtPct(rate) { return (rate * 100).toFixed(2).replace(/\.00$/, '') + '%'; }
function fmtMoney(n) { return '$' + Number(n).toLocaleString('en-US'); }

function formulaSection(state, rules) {
    const { formula_model, params } = state;
    let body = '';

    if (formula_model === 'no_income_tax') {
        body = `<p>${state.name} charges <strong>no state income tax</strong>. Only federal income tax and FICA are withheld from your paycheck.</p>`;
    } else if (formula_model === 'flat_tax') {
        const ded = (params.standard_deduction || 0) + (params.personal_exemption || 0);
        body = `
        <table>
          <tr><th>Flat state rate</th><td>${fmtPct(params.rate)}</td></tr>
          ${params.standard_deduction ? `<tr><th>Standard deduction (single)</th><td>${fmtMoney(params.standard_deduction)}</td></tr>` : ''}
          ${params.personal_exemption ? `<tr><th>Personal exemption</th><td>${fmtMoney(params.personal_exemption)}</td></tr>` : ''}
        </table>
        <div class="formula-code">state_tax = max(0, gross_income - ${ded}) × ${params.rate}</div>`;
    } else if (formula_model === 'progressive_brackets') {
        const rows = params.brackets.map((b, i) => {
            const lower = i === 0 ? 0 : params.brackets[i - 1].upTo;
            const upper = b.upTo === null ? '+' : fmtMoney(b.upTo);
            return `<tr><td>${fmtMoney(lower)} – ${upper}</td><td>${fmtPct(b.rate)}</td></tr>`;
        }).join('');
        body = `
        <table>
          <tr><th>Taxable income bracket</th><th>Rate</th></tr>
          ${rows}
        </table>
        ${params.standard_deduction ? `<p>Standard deduction (single): ${fmtMoney(params.standard_deduction)}, subtracted from gross income before applying brackets.</p>` : ''}
        <div class="formula-code">state_tax = marginal_bracket_tax(gross_income - ${params.standard_deduction || 0}, brackets)</div>`;
    }

    const extra = rules.extra_payroll_tax;
    const extraHtml = extra
        ? `<p><strong>${extra.name}:</strong> ${extra.rate * 100}% of wages${extra.wage_cap_annual_contribution ? `, capped at ${fmtMoney(extra.wage_cap_annual_contribution)}/year` : extra.wage_cap ? `, up to ${fmtMoney(extra.wage_cap)}` : ', no wage cap'}. ${extra.note}</p>`
        : '';

    const localNote = rules.local_tax_note
        ? `<div class="local-tax-note">⚠️ ${rules.local_tax_note}</div>`
        : '';

    return `
    <section id="formula" class="seo-section formula-section">
      <h2>How ${state.name} Paycheck Tax Is Calculated (${YEAR})</h2>
      <span class="source-line">Source: ${state.source.agency_name}</span>
      ${body}
      ${extraHtml}
      <h3>Federal Tax &amp; FICA (shared across all states)</h3>
      <table>
        <tr><th>Filing status</th><th>Standard deduction</th></tr>
        <tr><td>Single</td><td>$16,100</td></tr>
        <tr><td>Married Filing Jointly</td><td>$32,200</td></tr>
        <tr><td>Head of Household</td><td>$24,150</td></tr>
      </table>
      <table>
        <tr><th>Federal brackets (all filing statuses)</th><td>10% / 12% / 22% / 24% / 32% / 35% / 37%</td></tr>
        <tr><th>Social Security</th><td>6.2% up to $184,500 wage base</td></tr>
        <tr><th>Medicare</th><td>1.45% on all wages, +0.9% above $200,000 single/HoH, $250,000 MFJ</td></tr>
      </table>
      ${!state.filing_status_backfilled ? `<p class="deviation-note">⚠️ ${state.name}'s married-filing-jointly and head-of-household state brackets have not yet been independently verified against the primary source above — this calculator uses ${state.name}'s single-filer brackets as an estimate when those statuses are selected.</p>` : ''}
      ${localNote}
      <p class="formula-footnote">Guideline version ${state.guideline_version} · Last verified ${state.last_verified}</p>
    </section>`;
}

function worksheetSection(state) {
    const steps = state.worksheet.steps.map(s => `<li>${s}</li>`).join('');
    const calc = state.worksheet.example.calculation.map(c => `<li>${c}</li>`).join('');
    return `
    <section id="worksheet" class="seo-section">
      <h2>How to Calculate Your ${state.name} Take-Home Pay</h2>
      <ol>${steps}</ol>
      <h3>${state.worksheet.example.scenario}</h3>
      <ol>${calc}</ol>
    </section>`;
}

function faqSection(state) {
    const items = state.faq_extra.map(f => `
      <details class="faq-item">
        <summary>${f.q}</summary>
        <p>${f.a}</p>
      </details>`).join('');
    return `
    <section id="faq" class="seo-section">
      <h2>${state.name} Paycheck Calculator FAQ</h2>
      ${items}
    </section>`;
}

function methodologySection(state, rules, opts = {}) {
    const { bonus = false, selfEmployed = false } = opts;
    return `
    <section id="methodology" class="methodology">
      <h2>Methodology &amp; Source</h2>
      <p>${state.name} state tax figures sourced from <strong>${state.source.agency_name}</strong> (<a href="${state.source.url}" target="_blank" rel="nofollow noopener">${state.source.url}</a>), citing ${state.source.statute_ref}. Federal brackets, standard deductions (single/MFJ/HoH), and FICA constants sourced from the IRS (Revenue Procedure 2025-32; married-filing-jointly Additional Medicare threshold of $250,000 is a separate, unindexed statutory figure). ${state.filing_status_backfilled ? `${state.name}'s married-filing-jointly and head-of-household figures have been independently verified against the source above.` : `${state.name}'s married-filing-jointly and head-of-household figures are not yet independently verified and currently fall back to single-filer brackets — see the caveat in the formula section above.`}</p>
      ${rules.local_tax ? `<p>Local tax figures sourced from <strong>${rules.local_tax.source.agency_name}</strong>${rules.local_tax.source.url ? ` (<a href="${rules.local_tax.source.url}" target="_blank" rel="nofollow noopener">${rules.local_tax.source.url}</a>)` : ''}. ${rules.local_tax.source.note}</p>` : ''}
      ${bonus ? `<p>Bonus federal withholding uses the flat supplemental-wage rate (22%, 37% above $1,000,000 cumulative supplemental wages/year), per IRS Publication 15 (Circular E), Employer's Tax Guide, 2026 edition — the alternative "aggregate method" is not modeled.</p>` : ''}
      ${selfEmployed ? `<p>Self-employment tax uses the statutory 15.3% rate (12.4% Social Security + 2.9% Medicare) on 92.35% of net self-employment income, with half of the SE tax deducted from federal taxable income above-the-line — per IRS Schedule SE (Form 1040) instructions, IRC §1401 and §164(f), 2026 edition. The 20% Qualified Business Income deduction (IRC §199A) is not modeled — it phases out by income and business type and is too state/entity-dependent to compute generically. This assumes the self-employment income is your only earnings for the year; if you also have W-2 wages, the Social Security wage-base cap and Additional Medicare threshold are actually based on your combined earnings, so this will overstate SE tax if you have significant wage income too.</p>` : ''}
      <p class="deviation-note">${rules.deviation_note}</p>
      ${rules.extra_payroll_tax ? `<p>Pre-tax deductions assumption: HSA and health insurance premium contributions are assumed to also reduce the ${rules.extra_payroll_tax.name} wage base, consistent with their FICA wage treatment. This is a reasonable default, not independently verified against ${state.name}'s specific ${rules.extra_payroll_tax.name} statute.</p>` : ''}
      <p>Guideline version: ${state.guideline_version} · Effective: ${state.effective_date} · Last verified: ${state.last_verified}</p>
    </section>`;
}

function jsonLd(state, opts = {}) {
    const { hourly = false, bonus = false, selfEmployed = false } = opts;
    const faqEntities = state.faq_extra.map(f => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a }
    }));
    const breadcrumbItems = [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
        { '@type': 'ListItem', position: 2, name: state.name, item: `${SITE_URL}/${state.slug}/` }
    ];
    if (hourly) breadcrumbItems.push({ '@type': 'ListItem', position: 3, name: 'Hourly', item: `${SITE_URL}/${state.slug}/hourly/` });
    if (bonus) breadcrumbItems.push({ '@type': 'ListItem', position: 3, name: 'Bonus', item: `${SITE_URL}/${state.slug}/bonus/` });
    if (selfEmployed) breadcrumbItems.push({ '@type': 'ListItem', position: 3, name: 'Self-Employed', item: `${SITE_URL}/${state.slug}/self-employed/` });
    return JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'WebApplication',
                name: `${state.name} ${selfEmployed ? 'Self-Employed Tax ' : bonus ? 'Bonus ' : hourly ? 'Hourly ' : ''}Paycheck Calculator`,
                applicationCategory: 'FinanceApplication',
                operatingSystem: 'Any',
                offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
                dateModified: state.last_verified,
                version: state.guideline_version,
                author: GESMINE_ORG,
                publisher: GESMINE_ORG
            },
            { '@type': 'FAQPage', mainEntity: faqEntities },
            { '@type': 'BreadcrumbList', itemListElement: breadcrumbItems },
            GESMINE_ORG
        ]
    });
}

function filingStatusAndDeductionFields() {
    return `
      <label>Filing Status
        <select id="filingStatus">
          <option value="single" selected>Single</option>
          <option value="mfj">Married Filing Jointly</option>
          <option value="hoh">Head of Household</option>
        </select>
      </label>
      <details class="pretax-deductions">
        <summary>+ Pre-tax deductions (401k, HSA, health insurance)</summary>
        <label>401(k) contribution (% of salary)
          <input type="number" id="retirement401kPct" min="0" max="100" step="0.5" value="0">
        </label>
        <label>HSA contribution ($/pay period)
          <input type="number" id="hsaAmount" min="0" step="10" value="0">
        </label>
        <label>Health insurance premium ($/pay period)
          <input type="number" id="healthPremium" min="0" step="10" value="0">
        </label>
      </details>`;
}

function localTaxResultNote(rules, extra = '') {
    if (rules.local_tax) {
        return rules.local_tax.coverage === 'partial'
            ? `<p class="result-note">💡 Select your city/county above — the largest jurisdictions are computed; smaller ones still aren't covered (see methodology below).${extra}</p>`
            : `<p class="result-note">💡 Select your city above — local tax now supported.${extra}</p>`;
    }
    return rules.local_tax_note ? `<div class="result-warning">⚠️ Excludes local/municipal tax — see methodology below.</div>` : '';
}

function localTaxField(rules) {
    if (!rules.local_tax) return '';
    const options = rules.local_tax.options.map(o => `<option value="${o.id}"${o.id === 'none' ? ' selected' : ''}>${o.label}</option>`).join('');
    return `
      <label>Local Tax
        <select id="localTaxOption">${options}</select>
      </label>`;
}

function calculatorFormFields(rules) {
    return `
      <label>Gross Annual Salary ($)
        <input type="number" id="grossIncome" min="0" step="100" value="65000" required>
      </label>
      <label>Pay Frequency
        <select id="payFrequency">
          <option value="annual">Annual</option>
          <option value="monthly">Monthly</option>
          <option value="semimonthly">Semi-Monthly (24/yr)</option>
          <option value="biweekly" selected>Bi-Weekly (26/yr)</option>
          <option value="weekly">Weekly</option>
        </select>
      </label>
      ${filingStatusAndDeductionFields()}
      ${localTaxField(rules)}
      <button type="submit">Calculate Take-Home Pay →</button>`;
}

function hourlyFormFields(rules) {
    return `
      <label>Hourly Rate ($)
        <input type="number" id="hourlyRate" min="0" step="0.25" value="25" required>
      </label>
      <label>Hours per Week
        <input type="number" id="hoursPerWeek" min="0" max="80" step="1" value="40" required>
      </label>
      <label>Overtime Hours per Week (over 40)
        <input type="number" id="otHoursPerWeek" min="0" max="80" step="1" value="0">
      </label>
      <label>Pay Frequency
        <select id="payFrequency">
          <option value="annual">Annual</option>
          <option value="monthly">Monthly</option>
          <option value="semimonthly">Semi-Monthly (24/yr)</option>
          <option value="biweekly" selected>Bi-Weekly (26/yr)</option>
          <option value="weekly">Weekly</option>
        </select>
      </label>
      ${filingStatusAndDeductionFields()}
      ${localTaxField(rules)}
      <button type="submit">Calculate Take-Home Pay →</button>`;
}

function bonusFormFields(rules) {
    return `
      <label>Regular Annual Salary ($)
        <input type="number" id="regularAnnualGross" min="0" step="100" value="65000" required>
      </label>
      <label>Bonus Amount ($)
        <input type="number" id="bonusAmount" min="0" step="50" value="5000" required>
      </label>
      <label>Pay Frequency (for reference only — bonus tax uses the flat-rate method, not per-period withholding)
        <select id="payFrequency">
          <option value="annual">Annual</option>
          <option value="monthly">Monthly</option>
          <option value="semimonthly">Semi-Monthly (24/yr)</option>
          <option value="biweekly" selected>Bi-Weekly (26/yr)</option>
          <option value="weekly">Weekly</option>
        </select>
      </label>
      <label>Filing Status
        <select id="filingStatus">
          <option value="single" selected>Single</option>
          <option value="mfj">Married Filing Jointly</option>
          <option value="hoh">Head of Household</option>
        </select>
      </label>
      ${localTaxField(rules)}
      <button type="submit">Calculate Bonus Take-Home Pay →</button>`;
}

function selfEmployedFormFields() {
    return `
      <label>Net Self-Employment Income ($/year)
        <input type="number" id="netSEIncome" min="0" step="500" value="65000" required>
      </label>
      <label>Filing Status
        <select id="filingStatus">
          <option value="single" selected>Single</option>
          <option value="mfj">Married Filing Jointly</option>
          <option value="hoh">Head of Household</option>
        </select>
      </label>
      <button type="submit">Calculate Self-Employment Tax →</button>`;
}

function calculatorScript(state, rules, mode = 'salary') {
    const grossComputation = mode === 'hourly'
        ? `const hourlyRate = parseFloat(document.getElementById('hourlyRate').value) || 0;
        const hoursPerWeek = parseFloat(document.getElementById('hoursPerWeek').value) || 0;
        const otHoursPerWeek = parseFloat(document.getElementById('otHoursPerWeek').value) || 0;
        const gross = annualizeHourly(hourlyRate, hoursPerWeek, otHoursPerWeek);`
        : `const gross = parseFloat(document.getElementById('grossIncome').value) || 0;`;
    return `
    <script src="/assets/calc-engine.js"></script>
    <script src="/assets/chart.js"></script>
    <script>
    const STATE_ENTRY = ${JSON.stringify(state)};
    const RULES = ${JSON.stringify(rules)};

    function runCalculation(e) {
        e.preventDefault();
        ${grossComputation}
        const freq = document.getElementById('payFrequency').value;
        const filingStatus = document.getElementById('filingStatus').value;
        const retirement401kPct = parseFloat(document.getElementById('retirement401kPct').value) || 0;
        const hsaAmount = parseFloat(document.getElementById('hsaAmount').value) || 0;
        const healthPremium = parseFloat(document.getElementById('healthPremium').value) || 0;
        const hasPreTaxDeductions = retirement401kPct > 0 || hsaAmount > 0 || healthPremium > 0;
        const preTaxDeductions = hasPreTaxDeductions
            ? { retirement401k: { type: 'percent', value: retirement401kPct }, hsa: hsaAmount, healthPremium: healthPremium }
            : null;
        const localTaxEl = document.getElementById('localTaxOption');
        const localTaxOption = localTaxEl ? localTaxEl.value : null;
        const r = calculatePaycheck(STATE_ENTRY, RULES, gross, freq, filingStatus, preTaxDeductions, localTaxOption);
        const freqLabel = { annual: 'Annual', monthly: 'Monthly', semimonthly: 'Semi-Monthly', biweekly: 'Bi-Weekly', weekly: 'Weekly' }[freq];

        const caveat = document.getElementById('result-filing-status-caveat');
        if (filingStatus !== 'single' && !STATE_ENTRY.filing_status_backfilled) {
            caveat.hidden = false;
            caveat.textContent = '⚠️ ' + STATE_ENTRY.name + ' married/head-of-household brackets are not yet independently verified — this estimate uses single-filer state brackets.';
        } else {
            caveat.hidden = true;
        }

        document.getElementById('result-amount').textContent = fmtMoney(r.netPerPeriod) + ' / ' + freqLabel.toLowerCase();
        document.getElementById('result-net-annual').textContent = fmtMoney(r.netAnnual);
        document.getElementById('result-federal').textContent = fmtMoney(r.federalTax);
        document.getElementById('result-fica').textContent = fmtMoney(r.fica.total);
        document.getElementById('result-state').textContent = fmtMoney(r.stateTax);
        const extraRow = document.getElementById('result-extra-row');
        if (r.extraPayrollTax.amount > 0) {
            extraRow.hidden = false;
            document.getElementById('result-extra-label').textContent = r.extraPayrollTax.name;
            document.getElementById('result-extra').textContent = fmtMoney(r.extraPayrollTax.amount);
        } else {
            extraRow.hidden = true;
        }

        const localTaxRow = document.getElementById('result-local-tax-row');
        if (localTaxRow) {
            if (r.localTax && r.localTax.amount > 0) {
                localTaxRow.hidden = false;
                document.getElementById('result-local-tax-label').textContent = r.localTax.label;
                document.getElementById('result-local-tax').textContent = fmtMoney(r.localTax.amount);
            } else {
                localTaxRow.hidden = true;
            }
        }

        const preTaxRow = document.getElementById('result-pretax-row');
        const preTaxRowTotal = document.getElementById('result-pretax-row-total');
        const preTaxLimitWarning = document.getElementById('result-pretax-limit-warning');
        if (r.preTaxDeductions) {
            preTaxRow.hidden = false;
            preTaxRowTotal.hidden = false;
            const total = r.preTaxDeductions.retirement401kAnnual + r.preTaxDeductions.section125Annual;
            document.getElementById('result-pretax-401k').textContent = fmtMoney(r.preTaxDeductions.retirement401kAnnual);
            document.getElementById('result-pretax-total').textContent = fmtMoney(total);
            const warnings = [];
            if (r.preTaxDeductions.over401kLimit) warnings.push('401(k) contribution capped at the 2026 IRS elective deferral limit ($24,500/year).');
            if (r.preTaxDeductions.overHsaLimit) warnings.push('HSA contribution capped at the 2026 IRS limit ($4,400/year self-only, $8,750/year family coverage).');
            if (warnings.length) {
                preTaxLimitWarning.hidden = false;
                preTaxLimitWarning.textContent = '⚠️ ' + warnings.join(' ');
            } else {
                preTaxLimitWarning.hidden = true;
            }
        } else {
            preTaxRow.hidden = true;
            preTaxRowTotal.hidden = true;
            preTaxLimitWarning.hidden = true;
        }

        document.getElementById('results-block').hidden = false;
        drawBreakdownChart(document.getElementById('breakdown-chart'), {
            gross: r.grossAnnualIncome,
            federalTax: r.federalTax,
            ficaTotal: r.fica.total,
            stateTax: r.stateTax,
            localTax: r.localTax ? r.localTax.amount : 0,
            extraPayrollTax: r.extraPayrollTax.amount,
            netAnnual: r.netAnnual
        });
    }
    document.getElementById('calc-form').addEventListener('submit', runCalculation);
    document.addEventListener('DOMContentLoaded', () => { document.getElementById('calc-form').dispatchEvent(new Event('submit')); });
    </script>`;
}

function bonusCalculatorScript(state, rules) {
    return `
    <script src="/assets/calc-engine.js"></script>
    <script src="/assets/chart.js"></script>
    <script>
    const STATE_ENTRY = ${JSON.stringify(state)};
    const RULES = ${JSON.stringify(rules)};

    function runCalculation(e) {
        e.preventDefault();
        const regularAnnualGross = parseFloat(document.getElementById('regularAnnualGross').value) || 0;
        const bonusAmount = parseFloat(document.getElementById('bonusAmount').value) || 0;
        const freq = document.getElementById('payFrequency').value;
        const filingStatus = document.getElementById('filingStatus').value;
        const localTaxEl = document.getElementById('localTaxOption');
        const localTaxOption = localTaxEl ? localTaxEl.value : null;
        const r = calcBonusPaycheck(STATE_ENTRY, RULES, regularAnnualGross, bonusAmount, freq, filingStatus, localTaxOption);

        document.getElementById('result-amount').textContent = fmtMoney(r.bonusNet) + ' net bonus';
        document.getElementById('result-bonus-gross').textContent = fmtMoney(r.bonusAmount);
        document.getElementById('result-federal').textContent = fmtMoney(r.bonusFederalTax);
        document.getElementById('result-fica').textContent = fmtMoney(r.bonusFica);
        document.getElementById('result-state').textContent = fmtMoney(r.bonusStateTax);
        const extraRow = document.getElementById('result-extra-row');
        if (r.bonusExtraPayrollTax > 0) {
            extraRow.hidden = false;
            document.getElementById('result-extra-label').textContent = (RULES.extra_payroll_tax && RULES.extra_payroll_tax.name) || 'Extra payroll tax';
            document.getElementById('result-extra').textContent = fmtMoney(r.bonusExtraPayrollTax);
        } else {
            extraRow.hidden = true;
        }

        const localTaxRow = document.getElementById('result-local-tax-row');
        if (localTaxRow) {
            if (r.bonusLocalTax && r.bonusLocalTax.amount > 0) {
                localTaxRow.hidden = false;
                document.getElementById('result-local-tax-label').textContent = r.bonusLocalTax.label;
                document.getElementById('result-local-tax').textContent = fmtMoney(r.bonusLocalTax.amount);
            } else {
                localTaxRow.hidden = true;
            }
        }

        document.getElementById('results-block').hidden = false;
        drawBreakdownChart(document.getElementById('breakdown-chart'), {
            gross: r.bonusAmount,
            federalTax: r.bonusFederalTax,
            ficaTotal: r.bonusFica,
            stateTax: r.bonusStateTax,
            localTax: r.bonusLocalTax ? r.bonusLocalTax.amount : 0,
            extraPayrollTax: r.bonusExtraPayrollTax,
            netAnnual: r.bonusNet
        });
    }
    document.getElementById('calc-form').addEventListener('submit', runCalculation);
    document.addEventListener('DOMContentLoaded', () => { document.getElementById('calc-form').dispatchEvent(new Event('submit')); });
    </script>`;
}

function selfEmployedCalculatorScript(state, rules) {
    return `
    <script src="/assets/calc-engine.js"></script>
    <script src="/assets/chart.js"></script>
    <script>
    const STATE_ENTRY = ${JSON.stringify(state)};
    const RULES = ${JSON.stringify(rules)};

    function runCalculation(e) {
        e.preventDefault();
        const netSEIncome = parseFloat(document.getElementById('netSEIncome').value) || 0;
        const filingStatus = document.getElementById('filingStatus').value;
        const r = calcSelfEmployedTax(STATE_ENTRY, RULES, netSEIncome, filingStatus);

        document.getElementById('result-amount').textContent = fmtMoney(r.netIncome) + ' net / year';
        document.getElementById('result-se-tax').textContent = fmtMoney(r.seTax);
        document.getElementById('result-federal').textContent = fmtMoney(r.federalTax);
        document.getElementById('result-state').textContent = fmtMoney(r.stateTax);
        document.getElementById('result-quarterly').textContent = fmtMoney(r.quarterlyEstimate);

        document.getElementById('results-block').hidden = false;
        drawBreakdownChart(document.getElementById('breakdown-chart'), {
            gross: r.netSEIncome,
            federalTax: r.federalTax,
            ficaTotal: r.seTax,
            stateTax: r.stateTax,
            localTax: 0,
            extraPayrollTax: 0,
            netAnnual: r.netIncome
        });
    }
    document.getElementById('calc-form').addEventListener('submit', runCalculation);
    document.addEventListener('DOMContentLoaded', () => { document.getElementById('calc-form').dispatchEvent(new Event('submit')); });
    </script>`;
}

function renderStatePage(state) {
    assertComplete(state);
    const rules = loadRules(state.abbr.toLowerCase());
    const title = `${state.name} Paycheck Calculator — Take-Home Pay ${YEAR}`;
    const description = `Free ${state.name} paycheck calculator. Estimate your ${YEAR} take-home pay after federal tax, FICA, and ${state.name} state tax — updated ${state.last_verified}.`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${SITE_URL}/${state.slug}/">
<link rel="stylesheet" href="/assets/styles.css">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${SITE_URL}/${state.slug}/">
<meta property="og:type" content="website">
<script type="application/ld+json">${jsonLd(state)}</script>
</head>
<body>
<header>
  <p><a href="/">← USA Paycheck Calculator</a></p>
  <h1>${state.name} Paycheck Calculator</h1>
  <p class="badge">Estimate your ${YEAR} take-home pay after federal tax, FICA${state.formula_model === 'no_income_tax' ? '' : `, and ${state.name} state tax`}</p>
</header>

<div class="disclaimer-banner">
  Estimate only — not tax advice. Supports single, married-filing-jointly, and head-of-household filing status, plus optional pre-tax 401(k), HSA, and health insurance deductions (401(k) reduces federal/state taxable wages only; HSA and health premiums also reduce FICA wages, per standard IRS treatment). See methodology below for source and last-verified date. For your exact withholding, consult a tax professional or your payroll department.
</div>

<main>
  <section id="calculator">
    <form id="calc-form">
      ${calculatorFormFields(rules)}
    </form>
    <div id="results-block" hidden>
      <div class="result-warning" id="result-filing-status-caveat" hidden></div>
      <div class="result-amount" id="result-amount"></div>
      <canvas id="breakdown-chart" data-chart-height="40"></canvas>
      <div class="result-grid">
        <div class="result-item"><span class="label">Net Annual</span><span class="value" id="result-net-annual"></span></div>
        <div class="result-item"><span class="label">Federal Tax</span><span class="value" id="result-federal"></span></div>
        <div class="result-item"><span class="label">FICA</span><span class="value" id="result-fica"></span></div>
        <div class="result-item"><span class="label">${state.name} State Tax</span><span class="value" id="result-state"></span></div>
        <div class="result-item" id="result-extra-row" hidden><span class="label" id="result-extra-label"></span><span class="value" id="result-extra"></span></div>
        <div class="result-item" id="result-local-tax-row" hidden><span class="label" id="result-local-tax-label"></span><span class="value" id="result-local-tax"></span></div>
        <div class="result-item" id="result-pretax-row" hidden><span class="label">401(k) Contribution</span><span class="value" id="result-pretax-401k"></span></div>
        <div class="result-item" id="result-pretax-row-total" hidden><span class="label">Pre-Tax Deductions Total</span><span class="value" id="result-pretax-total"></span></div>
      </div>
      <div class="result-warning" id="result-pretax-limit-warning" hidden></div>
      ${localTaxResultNote(rules)}
      <button type="button" class="print-btn no-print" onclick="window.print()">🖨️ Print / Save as PDF →</button>
    </div>
    <p class="cross-link"><a href="/${state.slug}/hourly/">Paid hourly instead? Try our ${state.name} hourly paycheck calculator →</a></p>
    <p class="cross-link"><a href="/${state.slug}/bonus/">Calculating a bonus? Try our ${state.name} bonus paycheck calculator →</a></p>
    <p class="cross-link"><a href="/${state.slug}/self-employed/">1099 or self-employed? Try our ${state.name} self-employment tax calculator →</a></p>
  </section>

  ${worksheetSection(state)}
  ${formulaSection(state, rules)}
  ${faqSection(state)}
  ${methodologySection(state, rules)}
</main>

<footer>
  <p>USA Paycheck Calculator is part of Gesmine-Invest Limited, registered UK company number 14120136, registered office address at Hardy House, 269 Poynders Gardens, London, London, United Kingdom, SW4 8PQ.</p>
  <p><a href="/about/">About</a> · <a href="/privacy/">Privacy</a> · <a href="/changelog/">Changelog</a> · &copy; ${YEAR} USA Paycheck Calculator. Estimates only — not tax advice.</p>
</footer>
${calculatorScript(state, rules)}
</body>
</html>
`;
}

function renderHourlyStatePage(state) {
    assertComplete(state);
    const rules = loadRules(state.abbr.toLowerCase());
    const title = `${state.name} Hourly Paycheck Calculator — Take-Home Pay ${YEAR}`;
    const description = `Free ${state.name} hourly paycheck calculator. Enter your hourly rate and hours worked to estimate take-home pay after federal tax, FICA, and ${state.name} state tax — updated ${state.last_verified}.`;
    const dailyOtStates = new Set(['CA', 'AK', 'CO', 'NV']);
    const dailyOtNote = dailyOtStates.has(state.abbr)
        ? `<p class="deviation-note">⚠️ This calculator models standard weekly overtime (over 40 hours/week) only. ${state.name} has additional daily-overtime rules (e.g. daily hours beyond a state-specific threshold at 1.5x/2x) that this calculator does not yet compute — treat overtime pay as an estimate.</p>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${SITE_URL}/${state.slug}/hourly/">
<link rel="stylesheet" href="/assets/styles.css">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${SITE_URL}/${state.slug}/hourly/">
<meta property="og:type" content="website">
<script type="application/ld+json">${jsonLd(state, { hourly: true })}</script>
</head>
<body>
<header>
  <p><a href="/">← USA Paycheck Calculator</a> · <a href="/${state.slug}/">${state.name} Paycheck Calculator</a></p>
  <h1>${state.name} Hourly Paycheck Calculator</h1>
  <p class="badge">Estimate your ${YEAR} take-home pay after federal tax, FICA${state.formula_model === 'no_income_tax' ? '' : `, and ${state.name} state tax`} from an hourly rate</p>
</header>

<div class="disclaimer-banner">
  Estimate only — not tax advice. Supports single, married-filing-jointly, and head-of-household filing status, plus optional pre-tax 401(k), HSA, and health insurance deductions. Models standard weekly overtime only. See methodology below for source and last-verified date. For your exact withholding, consult a tax professional or your payroll department.
</div>

<main>
  <section id="calculator">
    <form id="calc-form">
      ${hourlyFormFields(rules)}
    </form>
    <div id="results-block" hidden>
      <div class="result-warning" id="result-filing-status-caveat" hidden></div>
      <div class="result-amount" id="result-amount"></div>
      <canvas id="breakdown-chart" data-chart-height="40"></canvas>
      <div class="result-grid">
        <div class="result-item"><span class="label">Net Annual</span><span class="value" id="result-net-annual"></span></div>
        <div class="result-item"><span class="label">Federal Tax</span><span class="value" id="result-federal"></span></div>
        <div class="result-item"><span class="label">FICA</span><span class="value" id="result-fica"></span></div>
        <div class="result-item"><span class="label">${state.name} State Tax</span><span class="value" id="result-state"></span></div>
        <div class="result-item" id="result-extra-row" hidden><span class="label" id="result-extra-label"></span><span class="value" id="result-extra"></span></div>
        <div class="result-item" id="result-local-tax-row" hidden><span class="label" id="result-local-tax-label"></span><span class="value" id="result-local-tax"></span></div>
        <div class="result-item" id="result-pretax-row" hidden><span class="label">401(k) Contribution</span><span class="value" id="result-pretax-401k"></span></div>
        <div class="result-item" id="result-pretax-row-total" hidden><span class="label">Pre-Tax Deductions Total</span><span class="value" id="result-pretax-total"></span></div>
      </div>
      <div class="result-warning" id="result-pretax-limit-warning" hidden></div>
      ${localTaxResultNote(rules)}
      <button type="button" class="print-btn no-print" onclick="window.print()">🖨️ Print / Save as PDF →</button>
    </div>
    <p class="cross-link"><a href="/${state.slug}/">Paid a salary instead? Try our ${state.name} paycheck calculator →</a></p>
    <p class="cross-link"><a href="/${state.slug}/bonus/">Calculating a bonus? Try our ${state.name} bonus paycheck calculator →</a></p>
    <p class="cross-link"><a href="/${state.slug}/self-employed/">1099 or self-employed? Try our ${state.name} self-employment tax calculator →</a></p>
  </section>

  ${worksheetSection(state)}
  ${formulaSection(state, rules)}
  ${dailyOtNote}
  ${faqSection(state)}
  ${methodologySection(state, rules)}
</main>

<footer>
  <p>USA Paycheck Calculator is part of Gesmine-Invest Limited, registered UK company number 14120136, registered office address at Hardy House, 269 Poynders Gardens, London, London, United Kingdom, SW4 8PQ.</p>
  <p><a href="/about/">About</a> · <a href="/privacy/">Privacy</a> · <a href="/changelog/">Changelog</a> · &copy; ${YEAR} USA Paycheck Calculator. Estimates only — not tax advice.</p>
</footer>
${calculatorScript(state, rules, 'hourly')}
</body>
</html>
`;
}

function renderBonusStatePage(state) {
    assertComplete(state);
    const rules = loadRules(state.abbr.toLowerCase());
    const title = `${state.name} Bonus Tax Calculator — Take-Home Pay ${YEAR}`;
    const description = `Free ${state.name} bonus paycheck calculator. Estimate take-home pay on a bonus using the flat 22% federal supplemental withholding method, plus FICA and ${state.name} state tax — updated ${state.last_verified}.`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${SITE_URL}/${state.slug}/bonus/">
<link rel="stylesheet" href="/assets/styles.css">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${SITE_URL}/${state.slug}/bonus/">
<meta property="og:type" content="website">
<script type="application/ld+json">${jsonLd(state, { bonus: true })}</script>
</head>
<body>
<header>
  <p><a href="/">← USA Paycheck Calculator</a> · <a href="/${state.slug}/">${state.name} Paycheck Calculator</a></p>
  <h1>${state.name} Bonus Tax Calculator</h1>
  <p class="badge">Estimate take-home pay on a bonus, using the federal flat-rate supplemental withholding method</p>
</header>

<div class="disclaimer-banner">
  Estimate only — not tax advice. Federal tax on the bonus uses the flat 22% supplemental withholding rate (37% on cumulative supplemental wages over $1,000,000/year) — the alternative "aggregate method" some employers use instead is not modeled. FICA and any state SDI/PFL are computed as the difference between your regular income with and without the bonus added, so the Social Security wage cap applies correctly. State tax on the bonus is a marginal-bracket estimate, not necessarily any special state supplemental rate. See methodology below for source and last-verified date.
</div>

<main>
  <section id="calculator">
    <form id="calc-form">
      ${bonusFormFields(rules)}
    </form>
    <div id="results-block" hidden>
      <div class="result-amount" id="result-amount"></div>
      <canvas id="breakdown-chart" data-chart-height="40"></canvas>
      <div class="result-grid">
        <div class="result-item"><span class="label">Bonus Amount</span><span class="value" id="result-bonus-gross"></span></div>
        <div class="result-item"><span class="label">Federal Tax (22% flat)</span><span class="value" id="result-federal"></span></div>
        <div class="result-item"><span class="label">FICA</span><span class="value" id="result-fica"></span></div>
        <div class="result-item"><span class="label">${state.name} State Tax</span><span class="value" id="result-state"></span></div>
        <div class="result-item" id="result-extra-row" hidden><span class="label" id="result-extra-label"></span><span class="value" id="result-extra"></span></div>
        <div class="result-item" id="result-local-tax-row" hidden><span class="label" id="result-local-tax-label"></span><span class="value" id="result-local-tax"></span></div>
      </div>
      ${localTaxResultNote(rules, ' Bonus state-tax and local-tax figures are marginal-bracket estimates, not necessarily any special supplemental rate your state or city may apply to bonus payments specifically.')}
      <button type="button" class="print-btn no-print" onclick="window.print()">🖨️ Print / Save as PDF →</button>
    </div>
    <p class="cross-link"><a href="/${state.slug}/">Calculating a regular paycheck? Try our ${state.name} paycheck calculator →</a></p>
    <p class="cross-link"><a href="/${state.slug}/hourly/">Paid hourly? Try our ${state.name} hourly paycheck calculator →</a></p>
  </section>

  ${formulaSection(state, rules)}
  ${faqSection(state)}
  ${methodologySection(state, rules, { bonus: true })}
</main>

<footer>
  <p>USA Paycheck Calculator is part of Gesmine-Invest Limited, registered UK company number 14120136, registered office address at Hardy House, 269 Poynders Gardens, London, London, United Kingdom, SW4 8PQ.</p>
  <p><a href="/about/">About</a> · <a href="/privacy/">Privacy</a> · <a href="/changelog/">Changelog</a> · &copy; ${YEAR} USA Paycheck Calculator. Estimates only — not tax advice.</p>
</footer>
${bonusCalculatorScript(state, rules)}
</body>
</html>
`;
}

function renderSelfEmployedStatePage(state) {
    assertComplete(state);
    const rules = loadRules(state.abbr.toLowerCase());
    const title = `${state.name} Self-Employment Tax Calculator (1099) — ${YEAR}`;
    const description = `Free ${state.name} self-employment / 1099 tax calculator. Estimate SE tax (Social Security + Medicare), federal tax, ${state.name} state tax, and a quarterly estimated-payment amount — updated ${state.last_verified}.`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${SITE_URL}/${state.slug}/self-employed/">
<link rel="stylesheet" href="/assets/styles.css">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${SITE_URL}/${state.slug}/self-employed/">
<meta property="og:type" content="website">
<script type="application/ld+json">${jsonLd(state, { selfEmployed: true })}</script>
</head>
<body>
<header>
  <p><a href="/">← USA Paycheck Calculator</a> · <a href="/${state.slug}/">${state.name} Paycheck Calculator</a></p>
  <h1>${state.name} Self-Employment Tax Calculator</h1>
  <p class="badge">Estimate SE tax, federal and state tax, and a quarterly estimated-payment amount on 1099/self-employment income</p>
</header>

<div class="disclaimer-banner">
  Estimate only — not tax advice. Self-employment tax is 15.3% (12.4% Social Security + 2.9% Medicare) on 92.35% of net SE income, with half of it deducted from federal taxable income. Assumes this is your only income for the year — if you also have W-2 wages, results will run high (see methodology below). Does not model the 20% Qualified Business Income deduction. The quarterly figure is an even 4-way split of annual liability, not the IRS's actual (unevenly spaced) estimated-payment due dates.
</div>

<main>
  <section id="calculator">
    <form id="calc-form">
      ${selfEmployedFormFields()}
    </form>
    <div id="results-block" hidden>
      <div class="result-amount" id="result-amount"></div>
      <canvas id="breakdown-chart" data-chart-height="40"></canvas>
      <div class="result-grid">
        <div class="result-item"><span class="label">Self-Employment Tax</span><span class="value" id="result-se-tax"></span></div>
        <div class="result-item"><span class="label">Federal Tax</span><span class="value" id="result-federal"></span></div>
        <div class="result-item"><span class="label">${state.name} State Tax</span><span class="value" id="result-state"></span></div>
        <div class="result-item"><span class="label">Quarterly Estimated Payment</span><span class="value" id="result-quarterly"></span></div>
      </div>
      <button type="button" class="print-btn no-print" onclick="window.print()">🖨️ Print / Save as PDF →</button>
    </div>
    <p class="cross-link"><a href="/${state.slug}/">Paid a W-2 salary instead? Try our ${state.name} paycheck calculator →</a></p>
  </section>

  ${faqSection(state)}
  ${methodologySection(state, rules, { selfEmployed: true })}
</main>

<footer>
  <p>USA Paycheck Calculator is part of Gesmine-Invest Limited, registered UK company number 14120136, registered office address at Hardy House, 269 Poynders Gardens, London, London, United Kingdom, SW4 8PQ.</p>
  <p><a href="/about/">About</a> · <a href="/privacy/">Privacy</a> · <a href="/changelog/">Changelog</a> · &copy; ${YEAR} USA Paycheck Calculator. Estimates only — not tax advice.</p>
</footer>
${selfEmployedCalculatorScript(state, rules)}
</body>
</html>
`;
}

function renderChangelogPage() {
    const rows = Object.values(states)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(s => `<tr><td><a href="/${s.slug}/">${s.name}</a></td><td>${s.guideline_version}</td><td>${s.effective_date}</td><td>${s.last_verified}</td><td><a href="${s.source.url}" target="_blank" rel="nofollow noopener">${s.source.agency_name}</a></td></tr>`)
        .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Changelog — USA Paycheck Calculator</title>
<meta name="description" content="Guideline version and last-verified date for every state on USA Paycheck Calculator.">
<link rel="canonical" href="${SITE_URL}/changelog/">
<link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
<header>
  <p><a href="/">← USA Paycheck Calculator</a></p>
  <h1>Changelog</h1>
  <p class="badge">Guideline version and last-verified date, by state</p>
</header>
<main>
  <section>
    <table>
      <tr><th>State</th><th>Guideline Version</th><th>Effective Date</th><th>Last Verified</th><th>Source</th></tr>
      ${rows}
    </table>
  </section>
</main>
<footer>
  <p><a href="/about/">About</a> · <a href="/privacy/">Privacy</a> · &copy; ${YEAR} USA Paycheck Calculator.</p>
</footer>
</body>
</html>
`;
}

function renderComparatorPage() {
    const allRules = {};
    for (const state of Object.values(states)) {
        allRules[state.abbr] = loadRules(state.abbr.toLowerCase());
    }
    const stateOptions = Object.values(states)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(s => `<option value="${s.abbr}"${s.abbr === 'TX' ? ' selected' : ''}>${s.name}</option>`)
        .join('');
    const stateOptionsB = Object.values(states)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(s => `<option value="${s.abbr}"${s.abbr === 'CA' ? ' selected' : ''}>${s.name}</option>`)
        .join('');

    const title = 'Compare Take-Home Pay by State — USA Paycheck Calculator';
    const description = 'Compare take-home pay between two US states at the same gross salary — see the net-pay difference after federal tax, FICA, and each state\'s income tax.';

    const jsonLd = JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'WebApplication',
                name: 'Compare Take-Home Pay by State',
                applicationCategory: 'FinanceApplication',
                operatingSystem: 'Any',
                offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
                author: GESMINE_ORG,
                publisher: GESMINE_ORG
            },
            GESMINE_ORG
        ]
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${SITE_URL}/compare/">
<link rel="stylesheet" href="/assets/styles.css">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${SITE_URL}/compare/">
<meta property="og:type" content="website">
<script type="application/ld+json">${jsonLd}</script>
</head>
<body>
<header>
  <p><a href="/">← USA Paycheck Calculator</a></p>
  <h1>Compare Take-Home Pay by State</h1>
  <p class="badge">Same salary, two states — see the net-pay difference after federal tax, FICA, and state income tax</p>
</header>

<div class="disclaimer-banner">
  Estimate only — not tax advice. Excludes local/municipal tax (e.g. NYC, Yonkers, Philadelphia) — for a locality-specific estimate, use that state's dedicated calculator page. State-specific mandatory payroll deductions like SDI/PFL are included in each state's net figure where applicable.
</div>

<main>
  <section id="calculator">
    <form id="calc-form">
      <label>Gross Annual Salary ($)
        <input type="number" id="grossIncome" min="0" step="100" value="65000" required>
      </label>
      <label>Pay Frequency
        <select id="payFrequency">
          <option value="annual">Annual</option>
          <option value="monthly">Monthly</option>
          <option value="semimonthly">Semi-Monthly (24/yr)</option>
          <option value="biweekly" selected>Bi-Weekly (26/yr)</option>
          <option value="weekly">Weekly</option>
        </select>
      </label>
      <label>Filing Status
        <select id="filingStatus">
          <option value="single" selected>Single</option>
          <option value="mfj">Married Filing Jointly</option>
          <option value="hoh">Head of Household</option>
        </select>
      </label>
      <label>State A
        <select id="stateA">${stateOptions}</select>
      </label>
      <label>State B
        <select id="stateB">${stateOptionsB}</select>
      </label>
      <button type="submit">Compare Take-Home Pay →</button>
    </form>
    <div id="results-block" hidden>
      <div class="result-grid">
        <div class="result-item"><span class="label" id="result-a-label">State A</span><span class="value" id="result-a-net"></span></div>
        <div class="result-item"><span class="label" id="result-b-label">State B</span><span class="value" id="result-b-net"></span></div>
        <div class="result-item"><span class="label">Difference</span><span class="value" id="result-diff"></span></div>
      </div>
      <button type="button" class="print-btn no-print" onclick="window.print()">🖨️ Print / Save as PDF →</button>
    </div>
  </section>
</main>

<footer>
  <p>USA Paycheck Calculator is part of Gesmine-Invest Limited, registered UK company number 14120136, registered office address at Hardy House, 269 Poynders Gardens, London, London, United Kingdom, SW4 8PQ.</p>
  <p><a href="/about/">About</a> · <a href="/privacy/">Privacy</a> · <a href="/changelog/">Changelog</a> · &copy; ${YEAR} USA Paycheck Calculator. Estimates only — not tax advice.</p>
</footer>
<script src="/assets/calc-engine.js"></script>
<script>
const ALL_STATES = ${JSON.stringify(states)};
const ALL_RULES = ${JSON.stringify(allRules)};

function runCalculation(e) {
    e.preventDefault();
    const gross = parseFloat(document.getElementById('grossIncome').value) || 0;
    const freq = document.getElementById('payFrequency').value;
    const filingStatus = document.getElementById('filingStatus').value;
    const abbrA = document.getElementById('stateA').value;
    const abbrB = document.getElementById('stateB').value;
    const stateA = ALL_STATES[abbrA.toLowerCase()];
    const stateB = ALL_STATES[abbrB.toLowerCase()];
    const rA = calculatePaycheck(stateA, ALL_RULES[abbrA], gross, freq, filingStatus);
    const rB = calculatePaycheck(stateB, ALL_RULES[abbrB], gross, freq, filingStatus);

    document.getElementById('result-a-label').textContent = stateA.name;
    document.getElementById('result-b-label').textContent = stateB.name;
    document.getElementById('result-a-net').textContent = fmtMoney(rA.netAnnual) + '/yr';
    document.getElementById('result-b-net').textContent = fmtMoney(rB.netAnnual) + '/yr';
    const diff = rA.netAnnual - rB.netAnnual;
    document.getElementById('result-diff').textContent = (diff >= 0 ? '+' : '') + fmtMoney(diff) + '/yr ' + (diff >= 0 ? '(' + stateA.name + ' ahead)' : '(' + stateB.name + ' ahead)');

    document.getElementById('results-block').hidden = false;
}
document.getElementById('calc-form').addEventListener('submit', runCalculation);
document.addEventListener('DOMContentLoaded', () => { document.getElementById('calc-form').dispatchEvent(new Event('submit')); });
</script>
</body>
</html>
`;
}

function renderWithholdingCheckupPage() {
    const title = 'Withholding Pace Checkup — USA Paycheck Calculator';
    const description = 'Check whether your federal tax withholding is on pace to cover your expected tax bill, and how much extra to withhold per paycheck (W-4 Step 4c) to close any gap.';

    const jsonLd = JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'WebApplication',
                name: 'Withholding Pace Checkup',
                applicationCategory: 'FinanceApplication',
                operatingSystem: 'Any',
                offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
                author: GESMINE_ORG,
                publisher: GESMINE_ORG
            },
            GESMINE_ORG
        ]
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${SITE_URL}/withholding-checkup/">
<link rel="stylesheet" href="/assets/styles.css">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${SITE_URL}/withholding-checkup/">
<meta property="og:type" content="website">
<script type="application/ld+json">${jsonLd}</script>
</head>
<body>
<header>
  <p><a href="/">← USA Paycheck Calculator</a></p>
  <h1>Withholding Pace Checkup</h1>
  <p class="badge">Are you on track to owe or get a refund? See a recommended extra per-paycheck withholding amount</p>
</header>

<div class="disclaimer-banner">
  Estimate only — not tax advice, and not a replacement for the IRS's own Tax Withholding Estimator or the Form W-4 multiple-jobs worksheet (those use lookup tables this tool doesn't replicate). This projects your remaining withholding at the same per-paycheck pace you've withheld so far this year, compares it to your expected annual federal tax, and suggests an extra per-paycheck amount for Form W-4 Step 4(c) to close any gap. Federal tax only — state withholding isn't included.
</div>

<main>
  <section id="calculator">
    <form id="calc-form">
      <label>Expected Annual Gross Income ($)
        <input type="number" id="grossIncome" min="0" step="100" value="65000" required>
      </label>
      <label>Filing Status
        <select id="filingStatus">
          <option value="single" selected>Single</option>
          <option value="mfj">Married Filing Jointly</option>
          <option value="hoh">Head of Household</option>
        </select>
      </label>
      <label>Pay Frequency
        <select id="payFrequency">
          <option value="monthly">Monthly (12/yr)</option>
          <option value="semimonthly">Semi-Monthly (24/yr)</option>
          <option value="biweekly" selected>Bi-Weekly (26/yr)</option>
          <option value="weekly">Weekly (52/yr)</option>
        </select>
      </label>
      <label>Federal Tax Withheld So Far This Year ($)
        <input type="number" id="ytdWithheld" min="0" step="50" value="2500" required>
      </label>
      <label>Pay Periods Remaining This Year
        <input type="number" id="periodsRemaining" min="0" step="1" value="13" required>
      </label>
      <button type="submit">Check My Withholding Pace →</button>
    </form>
    <div id="results-block" hidden>
      <div class="result-amount" id="result-amount"></div>
      <div class="result-grid">
        <div class="result-item"><span class="label">Expected Annual Federal Tax</span><span class="value" id="result-expected"></span></div>
        <div class="result-item"><span class="label">Projected Total Withholding</span><span class="value" id="result-projected"></span></div>
        <div class="result-item"><span class="label">Projected Gap</span><span class="value" id="result-gap"></span></div>
        <div class="result-item" id="result-extra-row" hidden><span class="label">Recommended Extra / Paycheck</span><span class="value" id="result-extra"></span></div>
      </div>
      <button type="button" class="print-btn no-print" onclick="window.print()">🖨️ Print / Save as PDF →</button>
    </div>
  </section>
</main>

<footer>
  <p>USA Paycheck Calculator is part of Gesmine-Invest Limited, registered UK company number 14120136, registered office address at Hardy House, 269 Poynders Gardens, London, London, United Kingdom, SW4 8PQ.</p>
  <p><a href="/about/">About</a> · <a href="/privacy/">Privacy</a> · <a href="/changelog/">Changelog</a> · <a href="/compare/">Compare States</a> · &copy; ${YEAR} USA Paycheck Calculator. Estimates only — not tax advice.</p>
</footer>
<script src="/assets/calc-engine.js"></script>
<script>
const PERIODS_PER_YEAR = { monthly: 12, semimonthly: 24, biweekly: 26, weekly: 52 };

function runCalculation(e) {
    e.preventDefault();
    const gross = parseFloat(document.getElementById('grossIncome').value) || 0;
    const filingStatus = document.getElementById('filingStatus').value;
    const freq = document.getElementById('payFrequency').value;
    const ytdWithheld = parseFloat(document.getElementById('ytdWithheld').value) || 0;
    const periodsRemaining = parseFloat(document.getElementById('periodsRemaining').value) || 0;
    const totalPeriods = PERIODS_PER_YEAR[freq] || 26;
    const periodsElapsed = Math.max(0, totalPeriods - periodsRemaining);

    const expectedAnnualFederalTax = calcFederalTax(gross, filingStatus);
    const r = calcWithholdingGap(expectedAnnualFederalTax, ytdWithheld, periodsElapsed, periodsRemaining);

    document.getElementById('result-amount').textContent = r.onTrack
        ? '✅ On pace — projected refund of ' + fmtMoney(Math.abs(r.projectedShortfall))
        : '⚠️ Projected shortfall of ' + fmtMoney(r.projectedShortfall);
    document.getElementById('result-expected').textContent = fmtMoney(expectedAnnualFederalTax);
    document.getElementById('result-projected').textContent = fmtMoney(r.projectedTotalWithholding);
    document.getElementById('result-gap').textContent = fmtMoney(r.projectedShortfall);
    const extraRow = document.getElementById('result-extra-row');
    if (r.recommendedExtraPerPeriod > 0) {
        extraRow.hidden = false;
        document.getElementById('result-extra').textContent = fmtMoney(r.recommendedExtraPerPeriod);
    } else {
        extraRow.hidden = true;
    }

    document.getElementById('results-block').hidden = false;
}
document.getElementById('calc-form').addEventListener('submit', runCalculation);
document.addEventListener('DOMContentLoaded', () => { document.getElementById('calc-form').dispatchEvent(new Event('submit')); });
</script>
</body>
</html>
`;
}

// ---- Build ----
let built = 0;
for (const state of Object.values(states)) {
    const dir = path.join(__dirname, state.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), renderStatePage(state));
    built++;

    const hourlyDir = path.join(dir, 'hourly');
    fs.mkdirSync(hourlyDir, { recursive: true });
    fs.writeFileSync(path.join(hourlyDir, 'index.html'), renderHourlyStatePage(state));
    built++;

    const bonusDir = path.join(dir, 'bonus');
    fs.mkdirSync(bonusDir, { recursive: true });
    fs.writeFileSync(path.join(bonusDir, 'index.html'), renderBonusStatePage(state));
    built++;

    const selfEmployedDir = path.join(dir, 'self-employed');
    fs.mkdirSync(selfEmployedDir, { recursive: true });
    fs.writeFileSync(path.join(selfEmployedDir, 'index.html'), renderSelfEmployedStatePage(state));
    built++;

    console.log(`Generated: ${state.slug}/ + ${state.slug}/hourly/ + ${state.slug}/bonus/ + ${state.slug}/self-employed/ (${state.formula_model})`);
}

const changelogDir = path.join(__dirname, 'changelog');
fs.mkdirSync(changelogDir, { recursive: true });
fs.writeFileSync(path.join(changelogDir, 'index.html'), renderChangelogPage());
console.log('Generated: changelog/');

const compareDir = path.join(__dirname, 'compare');
fs.mkdirSync(compareDir, { recursive: true });
fs.writeFileSync(path.join(compareDir, 'index.html'), renderComparatorPage());
console.log('Generated: compare/');

const withholdingCheckupDir = path.join(__dirname, 'withholding-checkup');
fs.mkdirSync(withholdingCheckupDir, { recursive: true });
fs.writeFileSync(path.join(withholdingCheckupDir, 'index.html'), renderWithholdingCheckupPage());
console.log('Generated: withholding-checkup/');

console.log(`\nDone. ${built} state pages built.`);
