// price-service.js — calls YOUR OWN backend, which calls eBay's
// Marketplace Insights API (or a scrape fallback) for sold-listing comps.
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

    if (!data.listings || data.listings.length === 0) throw new Error('No sold listings found');
    return aggregate(data.listings, data.source);
  }

  /// Computes the same low/high/median/sampleSize shape as before, but now
  /// also keeps the individual listings (title, price, url) that fed into
  /// it — sorted and trimmed the same way, so `listings` lines up with
  /// what actually contributed to the aggregate rather than including
  /// outliers that were excluded from the math.
  function aggregate(listings, source) {
    const sorted = [...listings].sort((a, b) => a.price - b.price);
    const trimCount = Math.max(0, Math.floor(sorted.length * 0.1));
    const trimmed = trimCount > 0 && sorted.length > trimCount * 2
      ? sorted.slice(trimCount, sorted.length - trimCount)
      : sorted;
    const prices = trimmed.map(l => l.price);
    const median = prices[Math.floor(prices.length / 2)];

    return {
      low: prices[0],
      high: prices[prices.length - 1],
      median,
      sampleSize: trimmed.length,
      asOf: Date.now(),
      listings: trimmed,
      source: source || null
    };
  }

  function demoEstimate() {
    const base = 20 + Math.random() * 60;
    const sampleSize = Math.floor(Math.random() * 6) + 2;
    const demoTitles = [
      'Disney Pin Trading Lot - Vintage Collection',
      'Disney Parks Authentic Pin - Great Condition',
      'Disney LE Pin Rare HTF Collectible',
      'Disney Pin Bundle - Multiple Characters',
      'Disney Trading Pin - Convention Exclusive',
      'Disney Pin Set - Limited Edition'
    ];
    const listings = Array.from({ length: sampleSize }, (_, i) => ({
      price: Math.round(base * (0.75 + Math.random() * 0.5)),
      title: demoTitles[i % demoTitles.length] + ' (demo data)',
      url: null,
      date: null
    })).sort((a, b) => a.price - b.price);

    return {
      low: listings[0].price,
      high: listings[listings.length - 1].price,
      median: listings[Math.floor(listings.length / 2)].price,
      sampleSize: listings.length,
      asOf: Date.now(),
      listings,
      source: 'demo'
    };
  }

  return { estimateValue };
})();
