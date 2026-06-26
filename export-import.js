// price-service.js — calls YOUR OWN backend, which calls eBay's
// Marketplace Insights API for sold-listing comps.
//
// Same constraint as image-match-service.js: eBay OAuth tokens cannot live
// in client-side JS. This needs a backend proxy. Until BACKEND_URL is set,
// runs in DEMO MODE with a plausible-looking randomized estimate so you can
// exercise the rest of the app (re-check value, charts, stats) without a
// working backend yet — these numbers are NOT real and must not be treated
// as actual valuations.

const PriceService = (() => {
  function backendUrl() {
    return BackendConfig.WORKER_BASE_URL ? BackendConfig.WORKER_BASE_URL + '/price' : null;
  }

  async function estimateValue(item) {
    const baseUrl = backendUrl();
    if (!baseUrl) {
      return demoEstimate();
    }

    const cat = DB.CATEGORIES[item.category];
    const query = item.itemIdentifier
      ? cat.ebayKeyword + ' ' + item.itemIdentifier
      : [cat.ebayKeyword, item.name, item.series].filter(Boolean).join(' ');

    const response = await fetch(baseUrl + '?q=' + encodeURIComponent(query) + '&category=' + cat.ebayCategoryId);
    if (!response.ok) throw new Error('Could not reach price service');
    const data = await response.json();

    if (!data.prices || data.prices.length === 0) throw new Error('No sold listings found');
    return aggregate(data.prices);
  }

  function aggregate(prices) {
    const sorted = [...prices].sort((a, b) => a - b);
    const trimCount = Math.max(0, Math.floor(sorted.length * 0.1));
    const trimmed = trimCount > 0 && sorted.length > trimCount * 2
      ? sorted.slice(trimCount, sorted.length - trimCount)
      : sorted;
    const median = trimmed[Math.floor(trimmed.length / 2)];
    return { low: trimmed[0], high: trimmed[trimmed.length - 1], median, sampleSize: trimmed.length, asOf: Date.now() };
  }

  function demoEstimate() {
    const base = 20 + Math.random() * 60;
    return {
      low: Math.round(base * 0.8),
      high: Math.round(base * 1.3),
      median: Math.round(base),
      sampleSize: Math.floor(Math.random() * 12) + 1,
      asOf: Date.now()
    };
  }

  return { estimateValue };
})();
