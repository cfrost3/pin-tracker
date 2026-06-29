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

**Already set for this deployment** -- `worker.js` has:

```js
const ALLOWED_ORIGIN = 'https://cfrost3.github.io';
```

⚠️ **Action needed:** this value is set in the file you have locally, but
the Worker currently live at `pin-valuator-backend.pin-tracker.workers.dev`
was deployed before this change, so it's still running with the old `'*'`
(open to any origin). Run `wrangler deploy` from this folder once to push
the updated `worker.js` and actually lock it down. Until you do, the app
still works fine -- this is a tightening step, not something broken.

For reference, the general version of this step: open `worker.js`, find
the `ALLOWED_ORIGIN` line near the top, and set it to your actual deployed
PWA's origin (scheme + host only, no path):

```js
const ALLOWED_ORIGIN = 'https://yourusername.github.io';
```

Then redeploy with `wrangler deploy`. Leaving this as `'*'` means any
website on the internet could call your Worker and burn through your
Google/eBay quota -- fine for initial testing, but worth tightening once
you have a real deployed URL.

---

## Part 5 -- Point the PWA at your Worker

**Already done for this deployment** -- `js/backend-config.js` in the PWA
project is pre-filled with:

```js
const BackendConfig = {
  WORKER_BASE_URL: 'https://pin-valuator-backend.pin-tracker.workers.dev'
};
```

If you ever redeploy the Worker under a different name or subdomain, this
is the one line to update -- both `image-match-service.js` and
`price-service.js` read from it automatically, no other file needs
touching.

For reference, here's the general version of this step for anyone
starting fresh: open `js/backend-config.js`, change `WORKER_BASE_URL` to
your deployed Worker's base URL (no trailing slash, no `/match` or
`/price` suffix -- those paths get appended automatically):

```js
const BackendConfig = {
  WORKER_BASE_URL: 'https://pin-valuator-backend.YOUR-SUBDOMAIN.workers.dev'
};
```

This is the only file you need to edit -- both `image-match-service.js`
and `price-service.js` read from it automatically.

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
