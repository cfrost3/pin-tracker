// image-match-service.js — calls YOUR OWN backend, which in turn calls
// Google Cloud Vision's Web Detection API.
//
// WHY A BACKEND IS REQUIRED: API keys embedded in client-side JS are
// visible to anyone who opens browser dev tools or views page source.
// There is no way to hide them in a pure static PWA. You must proxy this
// call through a small backend you control (a Cloudflare Worker, Vercel
// function, or similar) that holds the real API key server-side.
//
// Until BACKEND_URL is configured, this runs in DEMO MODE: it returns a
// single low-confidence placeholder match so the rest of the app (tagging,
// pricing, saving) is fully exercisable without a working backend yet.

const ImageMatchService = (() => {
  function backendUrl() {
    return BackendConfig.WORKER_BASE_URL ? BackendConfig.WORKER_BASE_URL + '/match' : null;
  }

  async function search(blob, vocabulary) {
    const url = backendUrl();
    if (!url) {
      return demoMatch();
    }

    const formData = new FormData();
    formData.append('image', blob);

    let response;
    try {
      response = await fetch(url, { method: 'POST', body: formData });
    } catch (err) {
      // Network-level failure — the Worker URL is unreachable, misspelled,
      // or CORS rejected the request before a response ever came back.
      throw new Error('Could not reach the backend at all. Check that WORKER_BASE_URL in backend-config.js is correct and that the Worker is deployed.');
    }

    if (!response.ok) {
      // Surface whatever the Worker actually said went wrong, rather than
      // a generic message — this is almost always either a Google Vision
      // error (key, billing, API not enabled) or a CORS misconfiguration.
      let detail = 'Match service returned ' + response.status;
      try {
        const errJson = await response.json();
        if (errJson.error) detail = errJson.error;
      } catch (e) {
        // Response wasn't JSON — keep the generic status-only message.
      }
      throw new Error(detail);
    }

    const data = await response.json();
    lastDiagnostics = data.diagnostics || null;

    return (data.matches || []).map(m => ({
      ...m,
      extractedTags: PinTagExtractor.extractFromTexts(m.pageTitles || [m.name], vocabulary)
    }));
  }

  let lastDiagnostics = null;

  /// Hits the Worker's /health endpoint — no image upload, no Vision API
  /// call, no API quota spent. Use this first when search isn't behaving:
  /// it tells you whether the Worker is even reachable and which secrets
  /// it has configured, before you spend a real request finding out the
  /// hard way.
  async function testConnection() {
    if (!BackendConfig.WORKER_BASE_URL) {
      return { reachable: false, error: 'No WORKER_BASE_URL set in backend-config.js — still in demo mode.' };
    }
    try {
      const response = await fetch(BackendConfig.WORKER_BASE_URL + '/health');
      if (!response.ok) {
        return { reachable: false, error: 'Worker responded with status ' + response.status };
      }
      const data = await response.json();
      return { reachable: true, ...data };
    } catch (err) {
      return { reachable: false, error: 'Could not reach the Worker at all (network error or wrong URL).' };
    }
  }

  function getLastDiagnostics() {
    return lastDiagnostics;
  }

  function demoMatch() {
    return [{
      name: 'Unidentified item (demo mode)',
      series: null,
      releaseYear: null,
      itemIdentifier: null,
      confidence: 0.3,
      extractedTags: { characters: [], movie: null, holiday: null, park: null, attraction: null }
    }];
  }

  return { search, testConnection, getLastDiagnostics };
})();
