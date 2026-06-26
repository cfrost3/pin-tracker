# Pin Valuator Backend — Setup Guide

This is a small Cloudflare Worker that proxies two API calls so your
real API keys never live in the PWA's client-side JavaScript (which
anyone could view-source and steal):

- **`/match`** -> Google Cloud Vision Web Detection (reverse image search)
- **`/price`** -> eBay sold-listing price lookup

You do **not** need a Mac, Xcode, or any local install beyond Node.js to
deploy this -- Cloudflare's CLI tool (`wrangler`) runs anywhere Node runs,
including Windows.

---

## Part 1 -- Get a Google Cloud Vision API key

1. Go to https://console.cloud.google.com/ and sign in (or create a free
   Google account if needed).
2. Create a new project (top-left project dropdown -> "New Project"). Name
   it anything, e.g. "pin-valuator."
3. In the search bar, search for **"Cloud Vision API"** and click **Enable**.
4. Go to **APIs & Services -> Credentials** (left sidebar).
5. Click **+ Create Credentials -> API key**. Copy the key shown -- you
   won't be able to see it again later without regenerating it.
6. **Restrict the key** (important -- an unrestricted key billed to your
   account is a real risk if it ever leaks): click on the key -> under
   "API restrictions," select **Restrict key** -> choose **Cloud Vision API**
   only -> Save.
7. **Set a billing budget alert.** Vision API has a free tier (check
   current pricing/limits on Google's site, as these change), then
   charges per request after that. Go to **Billing -> Budgets & alerts**
   and set a low budget (e.g. $5) with email alerts so you're not
   surprised by a bill if usage spikes.

You now have a `GOOGLE_VISION_API_KEY`.

---

## Part 2 -- Get eBay API credentials

1. Go to https://developer.ebay.com/ and sign up for a developer account
   (free).
2. Go to **My Account -> Application Keys**.
3. Create a new keyset for the **Production** environment (not Sandbox,
   since you want real sold-listing data). This gives you an **App ID
   (Client ID)** and a **Cert ID (Client Secret)**.
4. **About the Marketplace Insights API specifically**: this is the eBay
   API that returns actual sold/completed listing prices, and it requires
   a separate application/approval process through eBay's partner
   program -- it is not available via simple self-serve signup like the
   basic Browse API. Apply for it from your developer dashboard, but
   expect this to take time or potentially be denied for a small personal
   project.
5. **You don't have to wait for that approval to use this app.** The
   Worker is built with a fallback: if Marketplace Insights isn't
   configured, it automatically falls back to reading eBay's public sold
   listings search page directly. This is more fragile (it can break if
   eBay changes their website's HTML) and exists in a legal gray area for
   automated scraping, but works immediately with zero approval wait,
   which is reasonable for a low-volume personal collection tool.

You'll end up with either:
- `EBAY_MARKETPLACE_TOKEN` (an OAuth token, if/when you get Marketplace
  Insights approved), **or**
- nothing extra -- the scrape fallback needs no credentials at all.

---

## Part 3 -- Install Wrangler and deploy the Worker

1. Install Node.js if you don't have it: https://nodejs.org (any recent
   LTS version).
2. Open a terminal in this `pin-valuator-backend` folder.
3. Install Wrangler:
   ```
   npm install -g wrangler
   ```
4. Log in (opens a browser window to authorize):
   ```
   wrangler login
   ```
5. Set your secrets (run each line, paste the value when prompted):
   ```
   wrangler secret put GOOGLE_VISION_API_KEY
   ```
   If/when you get eBay Marketplace Insights approved, also run:
   ```
   wrangler secret put EBAY_MARKETPLACE_TOKEN
   ```
6. Deploy:
   ```
   wrangler deploy
   ```
7. Wrangler will print a URL like:
   ```
   https://pin-valuator-backend.YOUR-SUBDOMAIN.workers.dev
   ```
   **Copy this URL** -- you'll paste it into the PWA's config next.

---

## Part 4 -- Lock down CORS (do this before relying on it long-term)

Open `worker.js` and find this line near the top:

```js
const ALLOWED_ORIGIN = '*';
```

Change `'*'` to your actual deployed PWA URL, e.g.:

```js
const ALLOWED_ORIGIN = 'https://yourusername.github.io';
```

Then redeploy with `wrangler deploy`. Leaving this as `'*'` means any
website on the internet could call your Worker and burn through your
Google/eBay quota -- fine for initial testing, but worth tightening once
you have a real deployed URL.

---

## Part 5 -- Point the PWA at your Worker

In the PWA's `js/image-match-service.js` and `js/price-service.js`, find:

```js
const BACKEND_URL = null;
```

Change it to your Worker URL plus the right path:

- `image-match-service.js`:
  `const BACKEND_URL = 'https://pin-valuator-backend.YOUR-SUBDOMAIN.workers.dev/match';`
- `price-service.js`:
  `const BACKEND_URL = 'https://pin-valuator-backend.YOUR-SUBDOMAIN.workers.dev/price';`

Redeploy/re-push the PWA, and you're now getting real reverse-image
matches and real (or scrape-sourced) sold-price estimates instead of
demo-mode placeholders.

---

## Costs to expect

- **Cloudflare Workers**: free tier covers a large number of
  requests/day -- a personal collection tool will never come close.
- **Google Vision API**: a modest free tier, then billed per request
  beyond that. Set the budget alert in Part 1.
- **eBay**: free either way (Marketplace Insights has no extra cost
  beyond approval; the scrape fallback costs nothing but eBay's own
  bandwidth).

## What can still break

- If eBay changes their search page's HTML, the scrape fallback's price
  parsing (`scrapeEbaySoldListings` in `worker.js`) will likely return
  empty results until the regex is updated to match their new markup.
- If Google changes Vision API's response shape (rare, but possible),
  `parseVisionResponse` may need adjustment.
- Treat both of these as "check back if results suddenly stop," not
  "set and forget forever."
