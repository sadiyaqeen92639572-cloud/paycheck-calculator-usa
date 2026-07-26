const fs = require('fs');
const path = require('path');

const states = require('./data/states.json');
const SITE_URL = 'https://calcpaycheck.com';
const YEAR = 2026;

const GESMINE_ORG = {
    '@type': 'Organization',
    name: 'USA Paycheck Calculator',
    legalName: 'Gesmine-Invest Limited',
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
        <tr><th>Federal standard deduction (single)</th><td>$16,100</td></tr>
        <tr><th>Federal brackets</th><td>10% / 12% / 22% / 24% / 32% / 35% / 37%</td></tr>
        <tr><th>Social Security</th><td>6.2% up to $184,500 wage base</td></tr>
        <tr><th>Medicare</th><td>1.45% on all wages, +0.9% above $200,000</td></tr>
      </table>
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

function methodologySection(state, rules) {
    return `
    <section id="methodology" class="methodology">
      <h2>Methodology &amp; Source</h2>
      <p>${state.name} state tax figures sourced from <strong>${state.source.agency_name}</strong> (<a href="${state.source.url}" target="_blank" rel="nofollow noopener">${state.source.url}</a>), citing ${state.source.statute_ref}. Federal brackets and FICA constants sourced from the IRS (Revenue Procedure 2025-32).</p>
      <p class="deviation-note">${rules.deviation_note}</p>
      <p>Guideline version: ${state.guideline_version} · Effective: ${state.effective_date} · Last verified: ${state.last_verified}</p>
    </section>`;
}

function jsonLd(state) {
    const faqEntities = state.faq_extra.map(f => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a }
    }));
    return JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'WebApplication',
                name: `${state.name} Paycheck Calculator`,
                applicationCategory: 'FinanceApplication',
                operatingSystem: 'Any',
                offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
                dateModified: state.last_verified,
                version: state.guideline_version,
                author: GESMINE_ORG,
                publisher: GESMINE_ORG
            },
            { '@type': 'FAQPage', mainEntity: faqEntities },
            {
                '@type': 'BreadcrumbList',
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
                    { '@type': 'ListItem', position: 2, name: state.name, item: `${SITE_URL}/${state.slug}/` }
                ]
            },
            GESMINE_ORG
        ]
    });
}

function calculatorFormFields() {
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
      <button type="submit">Calculate Take-Home Pay →</button>`;
}

function calculatorScript(state, rules) {
    return `
    <script src="/assets/calc-engine.js"></script>
    <script>
    const STATE_ENTRY = ${JSON.stringify(state)};
    const RULES = ${JSON.stringify(rules)};

    function runCalculation(e) {
        e.preventDefault();
        const gross = parseFloat(document.getElementById('grossIncome').value) || 0;
        const freq = document.getElementById('payFrequency').value;
        const r = calculatePaycheck(STATE_ENTRY, RULES, gross, freq);
        const freqLabel = { annual: 'Annual', monthly: 'Monthly', semimonthly: 'Semi-Monthly', biweekly: 'Bi-Weekly', weekly: 'Weekly' }[freq];

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
        document.getElementById('results-block').hidden = false;
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
  Estimate only — not tax advice. Single-filer assumption, based on standard federal/state calculations. See methodology below for source and last-verified date. For your exact withholding, consult a tax professional or your payroll department.
</div>

<main>
  <section id="calculator">
    <form id="calc-form">
      ${calculatorFormFields()}
    </form>
    <div id="results-block" hidden>
      <div class="result-amount" id="result-amount"></div>
      <div class="result-grid">
        <div class="result-item"><span class="label">Net Annual</span><span class="value" id="result-net-annual"></span></div>
        <div class="result-item"><span class="label">Federal Tax</span><span class="value" id="result-federal"></span></div>
        <div class="result-item"><span class="label">FICA</span><span class="value" id="result-fica"></span></div>
        <div class="result-item"><span class="label">${state.name} State Tax</span><span class="value" id="result-state"></span></div>
        <div class="result-item" id="result-extra-row" hidden><span class="label" id="result-extra-label"></span><span class="value" id="result-extra"></span></div>
      </div>
      ${rules.local_tax_note ? `<div class="result-warning">⚠️ Excludes local/municipal tax — see methodology below.</div>` : ''}
    </div>
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

// ---- Build ----
let built = 0;
for (const state of Object.values(states)) {
    const dir = path.join(__dirname, state.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), renderStatePage(state));
    console.log(`Generated: ${state.slug}/ (${state.formula_model})`);
    built++;
}

const changelogDir = path.join(__dirname, 'changelog');
fs.mkdirSync(changelogDir, { recursive: true });
fs.writeFileSync(path.join(changelogDir, 'index.html'), renderChangelogPage());
console.log('Generated: changelog/');

console.log(`\nDone. ${built} state pages built.`);
