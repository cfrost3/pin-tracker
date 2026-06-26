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

    const response = await fetch(url, { method: 'POST', body: formData });
    if (!response.ok) throw new Error('Match service returned an error');
    const data = await response.json();

    return (data.matches || []).map(m => ({
      ...m,
      extractedTags: PinTagExtractor.extractFromTexts(m.pageTitles || [m.name], vocabulary)
    }));
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

  return { search };
})();
