/**
 * Gross-to-net breakdown chart — a single horizontal stacked bar drawn on Canvas 2D.
 * No dependency, no CDN library, consistent with this site's zero-external-dependency posture.
 */
function drawBreakdownChart(canvasEl, r) {
    if (!canvasEl) return;
    const segments = [
        { value: r.federalTax || 0, color: '#047857', label: 'Federal' },
        { value: (r.ficaTotal != null ? r.ficaTotal : 0), color: '#059669', label: 'FICA' },
        { value: r.stateTax || 0, color: '#10b981', label: 'State' },
        { value: (r.localTax || 0), color: '#34d399', label: 'Local' },
        { value: (r.extraPayrollTax || 0), color: '#6ee7b7', label: 'Extra' },
        { value: r.netAnnual || 0, color: '#d1fae5', label: 'Net' }
    ].filter(s => s.value > 0);

    const gross = r.gross || segments.reduce((sum, s) => sum + s.value, 0);
    if (gross <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    // Measure the parent's width, not canvasEl.clientWidth: once we set an inline width below,
    // clientWidth would just read that fixed pixel value back on every later redraw instead of
    // tracking the container — the chart would stop following container/viewport size changes.
    const cssWidth = (canvasEl.parentElement && canvasEl.parentElement.clientWidth) || 600;
    // Read the intended CSS height from a stable data attribute, never from canvasEl's own
    // width/height attributes — those get overwritten below with the dpr-scaled backing-store
    // size, so reading them back on a later redraw would compound by dpr each time.
    const cssHeight = parseInt(canvasEl.dataset.chartHeight, 10) || 40;
    canvasEl.width = cssWidth * dpr;
    canvasEl.height = cssHeight * dpr;
    canvasEl.style.width = cssWidth + 'px';
    canvasEl.style.height = cssHeight + 'px';
    const ctx = canvasEl.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    let x = 0;
    for (const seg of segments) {
        const w = (seg.value / gross) * cssWidth;
        ctx.fillStyle = seg.color;
        ctx.fillRect(x, 0, Math.max(w, 0), cssHeight);
        x += w;
    }
}

// Node (build-time / test) + browser export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { drawBreakdownChart };
}
