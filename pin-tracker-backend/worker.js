// worker.js — Cloudflare Worker backend for Pin Valuator.
//
// Two endpoints:
//   POST /match  — reverse image search via Google Cloud Vision Web Detection
//   GET  /price  — sold-listing price estimate via eBay
//
// WHY THIS EXISTS: the PWA is a static site with no server of its own.
// Google's and eBay's API credentials must never appear in client-side
// JS (anyone can view-source them), so this Worker holds the real
// credentials as encrypted secrets and the PWA calls this Worker instead
// of calling Google/eBay directly.
//
// SECRETS REQUIRED (set via `wrangler secret put <NAME>`, never in this file):
//   GOOGLE_VISION_API_KEY   — Google Cloud Vision API key
//   EBAY_APP_ID             — eBay application (client) ID
//   EBAY_CERT_ID            — eBay application (client) secret
//   EBAY_MARKETPLACE_TOKEN  — OAuth token for Marketplace Insights, IF you
//                              were approved for that API. Leave unset to
//                              use the scrape-fallback path automatically.
//
// CORS: locked to ALLOWED_ORIGIN below — set this to your actual deployed
// PWA URL (e.g. https://yourusername.github.io) before going live, or any
// website could ride on your API quota using your key.

const ALLOWED_ORIGIN = 'https://cfrost3.github.io'; // TODO: replace with your real PWA origin before going live

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      if (url.pathname === '/match' && request.method === 'POST') {
        return await handleMatch(request, env);
      }
      if (url.pathname === '/price' && request.method === 'GET') {
        return await handlePrice(url, env);
      }
      return jsonResponse({ error: 'Not found' }, 404);
    } catch (err) {
      console.error(err);
      return jsonResponse({ error: err.message || 'Internal error' }, 500);
    }
  }
};

// MARK: - /match — Google Cloud Vision Web Detection

async function handleMatch(request, env) {
  if (!env.GOOGLE_VISION_API_KEY) {
    return jsonResponse({ error: 'GOOGLE_VISION_API_KEY not configured on the server' }, 500);
  }

  const formData = await request.formData();
  const imageFile = formData.get('image');
  if (!imageFile) return jsonResponse({ error: 'No image provided' }, 400);

  const arrayBuffer = await imageFile.arrayBuffer();
  const base64 = arrayBufferToBase64(arrayBuffer);

  const visionResponse = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${env.GOOGLE_VISION_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: base64 },
          features: [{ type: 'WEB_DETECTION' }]
        }]
      })
    }
  );

  if (!visionResponse.ok) {
    const errText = await visionResponse.text();
    console.error('Vision API error:', errText);
    return jsonResponse({ error: 'Vision API request failed' }, 502);
  }

  const data = await visionResponse.json();
  const matches = parseVisionResponse(data);
  return jsonResponse({ matches });
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // avoid call-stack limits on large images
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/// Parses Cloud Vision's webDetection payload into match candidates with
/// parsed name/series/year/identifier guesses from page titles. Real-world
/// pin-trading site titles tend to follow patterns like
/// "Disney Pin 14829 Hercules Hero of Olympus 2023" — tune the regexes
/// below as you observe real results from your own scans.
function parseVisionResponse(data) {
  const webDetection = data.responses?.[0]?.webDetection;
  if (!webDetection) return [];

  const pages = webDetection.pagesWithMatchingImages || [];
  const bestGuess = webDetection.bestGuessLabels?.[0]?.label;

  if (pages.length === 0) {
    if (bestGuess) {
      return [{ name: bestGuess, series: null, releaseYear: null, itemIdentifier: null, confidence: 0.4, pageTitles: [bestGuess] }];
    }
    return [];
  }

  const allTitles = pages.map(p => p.pageTitle).filter(Boolean);

  return pages.slice(0, 8).map((page, index) => {
    const title = page.pageTitle || bestGuess || 'Unknown item';
    const parsed = parseTitle(title);
    const confidence = Math.max(0.3, 0.96 - index * 0.08);
    return {
      name: parsed.name,
      series: parsed.series,
      releaseYear: parsed.year,
      itemIdentifier: parsed.identifier,
      confidence,
      pageTitles: allTitles // pooled across all results for tag extraction client-side
    };
  });
}

function parseTitle(title) {
  let working = title;

  // IMPORTANT: extract the year BEFORE the identifier. Both patterns can
  // match a 4-digit number (e.g. "2022"), and if the identifier regex runs
  // first it will incorrectly claim the year as the trader number, leaving
  // the real identifier (if a separate one exists, e.g. "3000") stuck in
  // the name text instead of being recognized.
  const yearMatch = working.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? parseInt(yearMatch[0]) : null;
  if (yearMatch) working = working.replace(yearMatch[0], '');

  const idMatch = working.match(/\b\d{4,6}\b/);
  const identifier = idMatch ? idMatch[0] : null;
  if (identifier) working = working.replace(identifier, '');

  working = working.replace(/disney pin/gi, '').trim().replace(/^[-–,\s]+|[-–,\s]+$/g, '');

  return { name: working || title, series: null, year, identifier };
}

// MARK: - /price — eBay sold-listing price estimate

async function handlePrice(url, env) {
  const query = url.searchParams.get('q');
  const categoryId = url.searchParams.get('category');
  if (!query) return jsonResponse({ error: 'Missing q parameter' }, 400);

  // Path A: Marketplace Insights API — only works if you were approved
  // for this specific eBay partner program and have a valid OAuth token.
  if (env.EBAY_MARKETPLACE_TOKEN) {
    try {
      const prices = await fetchFromMarketplaceInsights(query, categoryId, env.EBAY_MARKETPLACE_TOKEN);
      if (prices.length > 0) return jsonResponse({ prices, source: 'marketplace_insights' });
    } catch (err) {
      console.warn('Marketplace Insights failed, falling back to scrape:', err.message);
    }
  }

  // Path B: scrape eBay's public "sold listings" search results page.
  // FRAGILE BY NATURE: this depends on eBay's current HTML structure and
  // will break if they change their page layout. It is also against
  // eBay's Terms of Service for automated/programmatic scraping at scale
  // — acceptable here only because this is a low-volume personal tool, not
  // a commercial scraping operation. If eBay blocks the request or changes
  // their markup, this path will start returning empty results; treat
  // that as a signal to apply for real API access instead of patching
  // the scraper repeatedly.
  try {
    const prices = await scrapeEbaySoldListings(query);
    return jsonResponse({ prices, source: 'scrape_fallback' });
  } catch (err) {
    console.error('Scrape fallback failed:', err.message);
    return jsonResponse({ error: 'Could not retrieve price data', prices: [] }, 502);
  }
}

async function fetchFromMarketplaceInsights(query, categoryId, token) {
  const params = new URLSearchParams({ q: query, limit: '25' });
  if (categoryId) params.set('category_ids', categoryId);

  const response = await fetch(
    `https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) throw new Error('Marketplace Insights returned ' + response.status);

  const data = await response.json();
  return (data.itemSales || [])
    .map(sale => parseFloat(sale.lastSoldPrice?.value))
    .filter(p => !isNaN(p));
}

/// Scrapes eBay's sold-listings search page (LH_Sold=1&LH_Complete=1).
/// Parses prices out of the rendered HTML with a regex rather than a full
/// DOM parser, since Workers don't have DOM APIs available — this is
/// brittle (see warning above) but avoids pulling in a heavy HTML-parsing
/// dependency for what's meant to be a lightweight fallback.
async function scrapeEbaySoldListings(query) {
  const searchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1&_sop=13`;

  const response = await fetch(searchUrl, {
    headers: {
      // A realistic User-Agent reduces the chance of being served a
      // bot-detection page instead of real results.
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
    }
  });
  if (!response.ok) throw new Error('eBay search request failed: ' + response.status);

  const html = await response.text();

  // eBay's sold-price spans currently render like: <span class="s-item__price">$42.00</span>
  // This WILL need adjustment if eBay changes their markup — that's the
  // core fragility of this fallback path.
  const priceMatches = [...html.matchAll(/s-item__price[^>]*>\s*\$?([\d,]+\.\d{2})/g)];
  const prices = priceMatches
    .map(m => parseFloat(m[1].replace(/,/g, '')))
    .filter(p => !isNaN(p) && p > 0 && p < 5000); // sanity bounds against parsing garbage

  return prices.slice(0, 30);
}
