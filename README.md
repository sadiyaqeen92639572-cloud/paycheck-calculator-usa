# USA Paycheck Calculator

Free 2026 take-home pay estimator for all 50 US states + DC — federal income tax, FICA (Social Security + Medicare), and state income tax, with sourced, cited tax figures per state.

**Live site:** [calcpaycheck.com](https://calcpaycheck.com)

## What it does

- Enter your gross annual salary and pay frequency → get federal tax, FICA, state tax, and net take-home pay broken out
- Every state page cites its official Department of Revenue source and a last-verified date
- Local/municipal tax gaps (Ohio, Pennsylvania, New York, and others) are disclosed explicitly, not silently omitted
- Single-filer estimates for 2026 tax year

## Architecture

Static site generator: `data/states.json` + `data/rules/[state].json` → `generate-pages.js` → one static page per state. Shared tax engine in `assets/calc-engine.js`. See `research/sourcing-tracker.csv` and `research/verification-log.csv` for per-state source citations and worked-example verification.

## Free Companion Tools

- **[Overtime Pay Calculator](https://sadiyaqeen92639572-cloud.github.io/overtime-pay-calculator/)** — Calculate time-and-a-half or double-time gross pay from your hourly rate and hours worked. Shows gross pay only; for net take-home pay after tax by state, use the main calculator above.

## Disclaimer

Estimates only, not tax advice. Consult a tax professional or your payroll department for your exact withholding.
