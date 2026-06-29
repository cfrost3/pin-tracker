// sold-listings-display.js — shared rendering for the "individual sold
// listings" breakdown shown under a price estimate. Used by both the scan
// results screen (right after a fresh search) and the item detail page's
// value history card (when revisiting a previously-checked item).
//
// Deliberately collapsed by default behind a toggle — showing every
// listing inline unconditionally would push the main estimate further
// down the screen for the common case where someone just wants the
// number, not the receipts.

const SOURCE_LABELS = {
  marketplace_insights: 'eBay Marketplace Insights',
  scrape_fallback: 'eBay (public search results)',
  demo: 'Demo data — not real sales'
};

/// Renders the "N sold comps ▾" toggle row plus a hidden listings table,
/// given anything shaped like a PriceEstimate or PriceHistorySnapshot
/// (something with .listings, .source, and a unique-ish key to scope the
/// toggle's element ids so multiple instances on one page don't collide).
function renderSoldListingsToggle(estimateOrSnapshot, uniqueKey) {
  const listings = estimateOrSnapshot.listings || [];
  if (listings.length === 0) return '';

  const source = estimateOrSnapshot.source;
  const sourceLabel = source ? (SOURCE_LABELS[source] || source) : null;
  const toggleId = 'listings-toggle-' + uniqueKey;
  const bodyId = 'listings-body-' + uniqueKey;

  return '<div style="border-top:1px solid var(--border); margin-top:10px; padding-top:8px;">' +
    '<button id="' + toggleId + '" style="background:none; border:none; padding:0; font-size:12px; color:var(--text-secondary); display:flex; align-items:center; gap:4px;">' +
    '<span id="' + toggleId + '-arrow">▾</span> View ' + listings.length + ' sold listing' + (listings.length === 1 ? '' : 's') +
    '</button>' +
    '<div id="' + bodyId + '" style="display:none; margin-top:8px;">' +
    (sourceLabel ? '<p style="font-size:10px; color:var(--text-secondary); margin:0 0 6px;">Source: ' + escapeHtmlShared(sourceLabel) + '</p>' : '') +
    listings.map(listingRowHtml).join('') +
    '</div>' +
    '</div>';
}

function listingRowHtml(listing) {
  const titleText = listing.title ? escapeHtmlShared(listing.title) : 'Untitled listing';
  const titleHtml = listing.url
    ? '<a href="' + escapeAttrShared(listing.url) + '" target="_blank" rel="noopener" style="color:var(--text); text-decoration:none;">' + titleText + '</a>'
    : titleText;

  return '<div style="display:flex; justify-content:space-between; gap:8px; padding:6px 0; border-bottom:1px solid var(--border); font-size:12px;">' +
    '<span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + titleHtml + '</span>' +
    '<span style="font-weight:600; flex-shrink:0;">' + fmtCurrencyShared(listing.price) + '</span>' +
    '</div>';
}

/// Wires up the show/hide click handler for a toggle rendered by
/// renderSoldListingsToggle — call this after the HTML has been inserted
/// into the DOM. Safe to call even when no toggle was rendered (e.g. zero
/// listings) since it just won't find the element.
function attachSoldListingsToggleHandler(uniqueKey) {
  const toggleBtn = document.getElementById('listings-toggle-' + uniqueKey);
  if (!toggleBtn) return;
  const body = document.getElementById('listings-body-' + uniqueKey);
  const arrow = document.getElementById('listings-toggle-' + uniqueKey + '-arrow');

  toggleBtn.addEventListener('click', () => {
    const isHidden = body.style.display === 'none';
    body.style.display = isHidden ? 'block' : 'none';
    if (arrow) arrow.textContent = isHidden ? '▴' : '▾';
  });
}

// Small local copies rather than relying on app.js's globals — this file
// loads before app.js in index.html (it's needed by scan.js, which loads
// first), so app.js's escapeHtml/fmtCurrency aren't guaranteed to exist
// yet at the time this file's own top-level code would run. The functions
// above are only ever called later, after a user action, by which point
// everything has loaded — but keeping these self-contained avoids any
// fragile assumption about load order entirely.
function escapeHtmlShared(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
function escapeAttrShared(str) {
  return (str || '').replace(/"/g, '&quot;');
}
function fmtCurrencyShared(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}
