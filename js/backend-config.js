// backend-config.js — set your deployed Cloudflare Worker URL here ONCE.
// Both image-match-service.js and price-service.js read from this file,
// so after deploying your Worker (see pin-valuator-backend/README.md),
// this is the only file you need to edit.
//
// Leave as null to keep running in demo mode (placeholder matches and
// randomized prices, clearly not real data).

const BackendConfig = {
  WORKER_BASE_URL: 'https://pin-valuator-backend.pin-tracker.workers.dev'
};
