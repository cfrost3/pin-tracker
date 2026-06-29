// app.js — view router + screens for Collection and Stats tabs.
// Scan tab logic lives in scan.js since it's substantial on its own.

const VIEW_MODE_STORAGE_KEY = 'pin-valuator-view-mode';

/// Grid (photo thumbnails) vs. list (compact text rows, no images
/// rendered) for the inventory. This is a UI preference, not collection
/// data, so it's stored in localStorage rather than IndexedDB — it
/// doesn't need to be part of an export/import, and reading it
/// synchronously at startup avoids a flash of the wrong layout before an
/// async IndexedDB read could resolve.
function loadViewMode() {
  try {
    const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return saved === 'list' ? 'list' : 'grid';
  } catch (err) {
    return 'grid'; // localStorage can throw in some locked-down contexts (e.g. private browsing edge cases)
  }
}

function saveViewMode(mode) {
  try {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  } catch (err) {
    // Non-fatal — the preference just won't persist this session.
  }
}

const state = {
  activeTab: 'scan',
  collectionSegment: 'inventory', // inventory | wishlist | ledger
  categoryFilter: null,
  activeFilter: Filtering.createActiveFilter(),
  sortOption: 'dateAcquiredNewest',
  activeCollectionId: DB.OWN_COLLECTION_ID,
  viewMode: loadViewMode() // grid | list
};

/// True when the currently-viewed collection is read-only (i.e. it's an
/// imported friend's collection, not your own). Every add/edit/delete/sell
/// action in the Collection tab checks this before doing anything —
/// centralizing the check here means a single source of truth for "can
/// the user modify what they're looking at right now."
function isViewingReadOnlyCollection() {
  return state.activeCollectionId !== DB.OWN_COLLECTION_ID;
}

const mainEl = document.getElementById('main-content');
const headerTitleEl = document.getElementById('header-title');
const headerActionsEl = document.getElementById('header-actions');
const sheetRoot = document.getElementById('sheet-root');
const toastRoot = document.getElementById('toast-root');

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.activeTab = btn.dataset.tab;
    render();
  });
});

function setActiveTabUI() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === state.activeTab);
  });
}

async function attachItems(entries) {
  const items = await DB.getAllItems();
  const itemsById = Object.fromEntries(items.map(i => [i.id, i]));
  return entries.map(e => ({ ...e, _item: itemsById[e.itemId] || null }));
}

function fmtCurrency(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function fmtSignedCurrency(value) {
  const sign = value >= 0 ? '+' : '-';
  return sign + fmtCurrency(Math.abs(value));
}

function fmtDate(ms) {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function showToast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  toastRoot.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

let sheetGeneration = 0;

function openSheet(html, onMount) {
  sheetGeneration++;
  sheetRoot.innerHTML = '<div class="sheet-overlay" id="sheet-overlay"><div class="sheet">' + html + '</div></div>';
  document.getElementById('sheet-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'sheet-overlay') closeSheet();
  });
  if (onMount) onMount();
  return sheetGeneration;
}

function closeSheet() {
  sheetGeneration++;
  sheetRoot.innerHTML = '';
}

async function render() {
  setActiveTabUI();
  headerActionsEl.innerHTML = '';

  if (state.activeTab === 'scan') {
    headerTitleEl.textContent = 'Scan an item';
    await Scan.renderCaptureScreen(mainEl);
  } else if (state.activeTab === 'collection') {
    headerTitleEl.textContent = 'Collection';
    await renderCollectionTab();
  } else if (state.activeTab === 'stats') {
    headerTitleEl.textContent = 'Stats';
    await renderStatsTab();
  }
}

async function renderCollectionTab() {
  const collections = await DB.getAllCollections();
  // The "own" collection always exists conceptually even before its
  // record is explicitly created (e.g. brand-new install that hasn't hit
  // the v2 migration's seed yet) — fall back to a synthetic entry so the
  // switcher never renders empty.
  const hasOwnRecord = collections.some(c => c.id === DB.OWN_COLLECTION_ID);
  const allCollections = hasOwnRecord ? collections : [{ id: DB.OWN_COLLECTION_ID, name: 'My Collection', isOwn: true }, ...collections];
  const importedCollections = allCollections.filter(c => !c.isOwn);

  const readOnly = isViewingReadOnlyCollection();
  const activeCollection = allCollections.find(c => c.id === state.activeCollectionId) || allCollections[0];

  mainEl.innerHTML =
    (importedCollections.length > 0
      ? '<div class="field" style="margin-bottom:10px;">' +
        '<select id="collection-switcher" style="width:100%; font-size:13px; padding:8px 10px; border-radius:8px; border:1px solid var(--border); background:var(--surface);">' +
        '<option value="' + DB.OWN_COLLECTION_ID + '" ' + (!readOnly ? 'selected' : '') + '>📁 My Collection</option>' +
        importedCollections.map(c => '<option value="' + c.id + '" ' + (c.id === state.activeCollectionId ? 'selected' : '') + '>👤 ' + escapeHtml(c.name) + ' (read-only)</option>').join('') +
        '</select>' +
        '</div>'
      : '') +
    (readOnly
      ? '<div class="card" style="background:rgba(200,140,40,0.08); display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">' +
        '<span style="font-size:12px;">👀 Viewing <strong>' + escapeHtml(activeCollection.name) + '</strong> — read-only</span>' +
        '<button id="remove-collection-btn" style="background:none; border:none; color:var(--enamel-red); font-size:12px;">Remove</button>' +
        '</div>'
      : '<div style="display:flex; justify-content:flex-end; gap:8px; margin-bottom:8px; flex-wrap:wrap;">' +
        '<button class="chip" id="backend-diag-btn">🔌 Backend</button>' +
        '<button class="chip" id="refresh-all-btn">↻ Refresh all values</button>' +
        '<button class="chip" id="export-import-btn">⇄ Export / Import</button>' +
        '</div>') +
    '<div class="segmented" id="collection-segmented">' +
      '<button data-seg="inventory">My items</button>' +
      '<button data-seg="wishlist">Wishlist</button>' +
      '<button data-seg="ledger">Bought / sold</button>' +
    '</div>' +
    '<div id="collection-body"></div>';

  const switcher = document.getElementById('collection-switcher');
  if (switcher) switcher.addEventListener('change', (e) => {
    state.activeCollectionId = e.target.value;
    state.categoryFilter = null;
    Filtering.clearFilter(state.activeFilter);
    renderCollectionTab();
  });

  document.getElementById('export-import-btn')?.addEventListener('click', openExportImportSheet);
  document.getElementById('refresh-all-btn')?.addEventListener('click', openRefreshAllValuesSheet);
  document.getElementById('backend-diag-btn')?.addEventListener('click', openBackendDiagnosticsSheet);
  document.getElementById('remove-collection-btn')?.addEventListener('click', async () => {
    if (confirm('Remove "' + activeCollection.name + '" from your view? This deletes the imported copy on this device only — it does not affect their actual collection.')) {
      await DB.deleteCollectionCascade(activeCollection.id);
      state.activeCollectionId = DB.OWN_COLLECTION_ID;
      renderCollectionTab();
    }
  });

  document.querySelectorAll('#collection-segmented button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.seg === state.collectionSegment);
    btn.addEventListener('click', () => {
      state.collectionSegment = btn.dataset.seg;
      renderCollectionTab();
    });
  });

  if (state.collectionSegment === 'inventory') {
    await renderInventoryBody();
  } else if (state.collectionSegment === 'wishlist') {
    await renderWishlistBody();
  } else {
    await renderLedgerBody();
  }
}

// MARK: - Export / Import

// MARK: - Backend connectivity diagnostics

/// Two-step diagnostic: first a /health check (no API calls spent, just
/// confirms the Worker is deployed and which secrets it sees), then an
/// optional real test search against a tiny synthetic image, which
/// exercises the actual Vision API call end to end and shows you exactly
/// what came back — real matches, a real error message, or a clear
/// explanation of why zero results is the expected (not broken) outcome
/// for that particular test image.
function openBackendDiagnosticsSheet() {
  const myGeneration = openSheet(
    '<div class="sheet-header"><h2>Backend connection</h2><button id="sheet-close">Done</button></div>' +
    '<div class="card">' +
    '<p style="font-size:13px; font-weight:500; margin:0 0 4px;">Step 1 — Is the Worker reachable?</p>' +
    '<p style="font-size:12px; color:var(--text-secondary); margin:0 0 10px;">Checks that your Cloudflare Worker is deployed and which API keys it can see. This makes no Google or eBay calls and costs nothing.</p>' +
    '<button class="btn block" id="health-check-btn">Check connection</button>' +
    '<div id="health-result" style="margin-top:10px; font-size:12px;"></div>' +
    '</div>' +
    '<div class="card">' +
    '<p style="font-size:13px; font-weight:500; margin:0 0 4px;">Step 2 — Does image search actually work?</p>' +
    '<p style="font-size:12px; color:var(--text-secondary); margin:0 0 10px;">Sends a small test image through the real search pipeline and shows you exactly what comes back — including the real error message if something fails. This does use one Vision API request.</p>' +
    '<button class="btn block" id="test-search-btn">Run test search</button>' +
    '<div id="test-search-result" style="margin-top:10px; font-size:12px;"></div>' +
    '</div>',
    () => {
      document.getElementById('sheet-close').addEventListener('click', closeSheet);

      document.getElementById('health-check-btn').addEventListener('click', async () => {
        const resultEl = document.getElementById('health-result');
        if (resultEl) resultEl.textContent = 'Checking…';
        const health = await ImageMatchService.testConnection();

        // Guard against the sheet having been closed (or a new one
        // opened) while this await was pending — checking sheetGeneration
        // catches that even in cases where a stale-but-still-existing
        // element of the same id could otherwise be written to by mistake.
        if (sheetGeneration !== myGeneration) return;
        const freshResultEl = document.getElementById('health-result');
        if (!freshResultEl) return;

        if (!health.reachable) {
          freshResultEl.innerHTML = '<span style="color:var(--enamel-red);">✗ ' + escapeHtml(health.error) + '</span>';
          return;
        }

        freshResultEl.innerHTML =
          '<div style="color:var(--enamel-teal); margin-bottom:6px;">✓ Worker is deployed and reachable</div>' +
          '<div>Google Vision key configured: ' + (health.googleVisionKeyConfigured ? '✓ yes' : '✗ no — run wrangler secret put GOOGLE_VISION_API_KEY') + '</div>' +
          '<div>eBay Marketplace token configured: ' + (health.ebayMarketplaceTokenConfigured ? '✓ yes' : '— no (using scrape fallback instead, this is expected if you have not been approved)') + '</div>';
      });

      document.getElementById('test-search-btn').addEventListener('click', async () => {
        const resultEl = document.getElementById('test-search-result');
        if (resultEl) resultEl.textContent = 'Running test search…';

        let html;
        try {
          const testBlob = await makeTestImageBlob();
          const vocabulary = await PinTagExtractor.liveVocabulary();
          const matches = await ImageMatchService.search(testBlob, vocabulary);
          const diagnostics = ImageMatchService.getLastDiagnostics();

          html = '<div style="color:var(--enamel-teal); margin-bottom:6px;">✓ Request succeeded — the Vision API call itself is working.</div>';

          if (diagnostics) {
            html += '<div style="color:var(--text-secondary); margin-bottom:6px;">' +
              'Pages with matching images found: ' + diagnostics.pagesWithMatchingImagesCount + '<br>' +
              'Visually similar images found: ' + diagnostics.visuallySimilarImagesCount + '<br>' +
              (diagnostics.bestGuessLabel ? 'Best guess label: "' + escapeHtml(diagnostics.bestGuessLabel) + '"' : 'No best-guess label returned') +
              '</div>';
          }

          if (matches.length === 0 || matches[0].name.includes('demo mode')) {
            html += '<div style="color:#a06b1f;">This test image is a plain solid color, so finding zero real catalog matches for it is EXPECTED — it has nothing distinctive for Vision to match against the web. ' +
              'This step succeeding just confirms the API call itself works end to end. ' +
              'If a real pin photo still returns nothing, the most common causes are: the pin/listing simply isn\'t indexed by Google anywhere online (common for less popular or off-brand pins), the photo is too blurry/dark/cluttered for Vision to extract a useful signature, or the photo needs to be cropped tighter to just the pin against a plain background.</div>';
          } else {
            html += '<div>Top match: "' + escapeHtml(matches[0].name) + '" (confidence ' + Math.round(matches[0].confidence * 100) + '%)</div>';
          }
        } catch (err) {
          html = '<span style="color:var(--enamel-red);">✗ ' + escapeHtml(err.message) + '</span>';
        }

        // Same generation guard as above.
        if (sheetGeneration !== myGeneration) return;
        const freshResultEl = document.getElementById('test-search-result');
        if (freshResultEl) freshResultEl.innerHTML = html;
      });
    }
  );
}

/// A small, deliberately plain test image (a solid-color square) used only
/// to exercise the request/response plumbing end to end. It is NOT meant
/// to produce a real catalog match — see the explanation shown alongside
/// the result in openBackendDiagnosticsSheet.
async function makeTestImageBlob() {
  const canvas = document.createElement('canvas');
  canvas.width = 200;
  canvas.height = 200;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#4477aa';
  ctx.fillRect(0, 0, 200, 200);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
}

function openExportImportSheet() {
  openSheet(
    '<div class="sheet-header"><h2>Export / Import</h2><button id="sheet-close">Done</button></div>' +
    '<div class="card">' +
    '<p style="font-size:13px; font-weight:500; margin:0 0 4px;">Export your collection</p>' +
    '<p style="font-size:12px; color:var(--text-secondary); margin:0 0 10px;">Saves everything — items, inventory, wishlist, sale history, and photos — into one file you can send to someone else or keep as a backup.</p>' +
    '<div class="field"><label>Your name (shown to whoever you send this to)</label><input type="text" id="export-owner-name" placeholder="e.g. Alex"></div>' +
    '<button class="btn block primary" id="export-btn">⬇ Export collection</button>' +
    '</div>' +
    '<div class="card">' +
    '<p style="font-size:13px; font-weight:500; margin:0 0 4px;">Import a friend\'s collection</p>' +
    '<p style="font-size:12px; color:var(--text-secondary); margin:0 0 10px;">Adds their collection as a separate, read-only view you can browse and compare against your own — it never changes or merges into your collection.</p>' +
    '<button class="btn block" id="import-btn">⬆ Choose file to import</button>' +
    '<input type="file" id="import-file-input" accept=".json,application/json" style="display:none;">' +
    '</div>' +
    '<div id="export-import-status" style="font-size:12px; color:var(--text-secondary); text-align:center;"></div>',
    () => {
      document.getElementById('sheet-close').addEventListener('click', () => { closeSheet(); renderCollectionTab(); });

      document.getElementById('export-btn').addEventListener('click', async () => {
        const statusEl = document.getElementById('export-import-status');
        const ownerName = document.getElementById('export-owner-name').value.trim();
        statusEl.textContent = 'Preparing export…';
        try {
          const result = await ExportImport.exportToFile(ownerName);
          statusEl.textContent = 'Exported ' + result.itemCount + ' item' + (result.itemCount === 1 ? '' : 's') + ' to ' + result.filename;
        } catch (err) {
          statusEl.textContent = 'Export failed: ' + (err.message || 'unknown error');
        }
      });

      document.getElementById('import-btn').addEventListener('click', () => {
        document.getElementById('import-file-input').click();
      });

      document.getElementById('import-file-input').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const statusEl = document.getElementById('export-import-status');
        statusEl.textContent = 'Reading file…';
        try {
          const { payload, summary } = await ExportImport.parseImportFile(file);
          openImportPreviewSheet(payload, summary);
        } catch (err) {
          statusEl.textContent = err.message;
        }
      });
    }
  );
}

function openImportPreviewSheet(payload, summary) {
  const exportedDate = summary.exportedAt ? new Date(summary.exportedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'unknown date';
  const suggestedName = payload.ownerName ? payload.ownerName + "'s Collection" : 'Imported Collection';

  openSheet(
    '<div class="sheet-header"><h2>Import preview</h2><button id="sheet-close">Cancel</button></div>' +
    '<div class="card">' +
    '<p style="font-size:13px; color:var(--text-secondary); margin:0 0 10px;">This file was exported on ' + exportedDate + ' and contains:</p>' +
    '<div style="display:flex; justify-content:space-between; padding:4px 0;"><span style="font-size:13px;">Items</span><span style="font-size:13px; font-weight:600;">' + summary.itemCount + '</span></div>' +
    '<div style="display:flex; justify-content:space-between; padding:4px 0;"><span style="font-size:13px;">In inventory</span><span style="font-size:13px; font-weight:600;">' + summary.inventoryCount + '</span></div>' +
    '<div style="display:flex; justify-content:space-between; padding:4px 0;"><span style="font-size:13px;">On wishlist</span><span style="font-size:13px; font-weight:600;">' + summary.wishlistCount + '</span></div>' +
    '<div style="display:flex; justify-content:space-between; padding:4px 0;"><span style="font-size:13px;">Sale records</span><span style="font-size:13px; font-weight:600;">' + summary.transactionCount + '</span></div>' +
    '</div>' +
    '<div class="field"><label>Name this collection</label><input type="text" id="import-collection-name" value="' + escapeHtml(suggestedName) + '"></div>' +
    '<p style="font-size:12px; color:var(--text-secondary); margin:10px 0;">This will be added as a new, separate collection you can switch to and browse — read-only, and completely independent from your own collection.</p>' +
    '<button class="btn block primary" id="confirm-import-btn">Import ' + summary.itemCount + ' item' + (summary.itemCount === 1 ? '' : 's') + '</button>' +
    '<div id="import-status" style="font-size:12px; color:var(--text-secondary); text-align:center; margin-top:10px;"></div>',
    () => {
      document.getElementById('sheet-close').addEventListener('click', () => { closeSheet(); renderCollectionTab(); });
      document.getElementById('confirm-import-btn').addEventListener('click', async () => {
        const statusEl = document.getElementById('import-status');
        const collectionName = document.getElementById('import-collection-name').value.trim() || suggestedName;
        statusEl.textContent = 'Importing…';
        try {
          const result = await ExportImport.commitImport(payload, collectionName);
          statusEl.textContent = 'Imported ' + result.importedItems + ' items into "' + collectionName + '".';
          showToast('Import complete');
          state.activeCollectionId = result.collection.id;
          setTimeout(() => { closeSheet(); renderCollectionTab(); }, 800);
        } catch (err) {
          statusEl.textContent = 'Import failed: ' + (err.message || 'unknown error');
        }
      });
    }
  );
}

async function renderInventoryBody() {
  const body = document.getElementById('collection-body');
  const readOnly = isViewingReadOnlyCollection();

  headerActionsEl.innerHTML =
    '<button id="view-toggle-btn" title="Toggle grid/list view">' + (state.viewMode === 'grid' ? '☰' : '⊞') + '</button>' +
    '<button id="sort-btn">⇅</button><button id="filter-btn">▽</button>';
  document.getElementById('view-toggle-btn').addEventListener('click', () => {
    state.viewMode = state.viewMode === 'grid' ? 'list' : 'grid';
    saveViewMode(state.viewMode);
    renderInventoryBody();
  });
  document.getElementById('sort-btn').addEventListener('click', openSortSheet);
  document.getElementById('filter-btn').addEventListener('click', () => openFilterSheet());

  const collectionInventory = await DB.getInventoryEntriesByCollection(state.activeCollectionId);
  const allEntries = await attachItems(collectionInventory);

  let entries = allEntries;
  if (state.categoryFilter) {
    entries = entries.filter(e => e._item && e._item.category === state.categoryFilter);
  }
  if (Filtering.filterIsActive(state.activeFilter)) {
    entries = entries.filter(e => Filtering.filterMatches(state.activeFilter, e._item));
  }
  entries = Filtering.SORT_OPTIONS[state.sortOption].sort(entries);

  const totalValue = entries.reduce((sum, e) => sum + (e.currentEstimatedValue || 0), 0);
  const presentCategories = [...new Set(allEntries.map(e => e._item && e._item.category).filter(Boolean))];

  let html = '<div class="metric-row">' +
    '<div class="metric-card"><p class="label">' + (Filtering.filterIsActive(state.activeFilter) ? 'Filtered value' : 'Collection value') + '</p><p class="value gain">' + fmtCurrency(totalValue) + '</p></div>' +
    '<div class="metric-card"><p class="label">Items</p><p class="value">' + entries.length + '</p></div>' +
    '</div>';

  if (presentCategories.length > 1) {
    html += '<div class="chip-row" id="category-chips">' +
      '<button class="chip ' + (!state.categoryFilter ? 'active' : '') + '" data-cat="">All</button>' +
      presentCategories.map(c => '<button class="chip ' + (state.categoryFilter === c ? 'active' : '') + '" data-cat="' + c + '">' + DB.CATEGORIES[c].icon + ' ' + DB.CATEGORIES[c].pluralLabel + '</button>').join('') +
      '</div>';
  }

  if (Filtering.filterIsActive(state.activeFilter)) {
    const facet = Filtering.FACETS[state.activeFilter.facetKey];
    html += '<div class="filter-banner">' +
      '<span>' + facet.icon + ' ' + facet.label + ': ' + [...state.activeFilter.selectedValues].join(', ') + '</span>' +
      '<button id="clear-filter-btn">Clear</button>' +
      '</div>';
  }

  if (entries.length === 0) {
    html += '<div class="empty-state">' +
      '<div class="icon">🗃️</div>' +
      '<p class="title">' + (allEntries.length === 0 ? 'No items yet' : 'No matches') + '</p>' +
      '<p class="message">' + (allEntries.length === 0 ? (readOnly ? 'This collection has no items.' : 'Scan a pin or other collectible to add it to your collection.') : 'Try a different filter.') + '</p>' +
      '</div>';
  } else if (state.viewMode === 'list') {
    html += '<div class="pin-list">' + entries.map(renderPinListRow).join('') + '</div>';
  } else {
    html += '<div class="grid">' + entries.map(renderPinCard).join('') + '</div>';
  }

  body.innerHTML = html;

  document.querySelectorAll('#category-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      state.categoryFilter = chip.dataset.cat || null;
      renderInventoryBody();
    });
  });
  const clearBtn = document.getElementById('clear-filter-btn');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    Filtering.clearFilter(state.activeFilter);
    renderInventoryBody();
  });

  document.querySelectorAll('.pin-card').forEach(card => {
    card.addEventListener('click', () => openItemDetail(card.dataset.entryId));
  });
  document.querySelectorAll('.pin-list-row').forEach(row => {
    row.addEventListener('click', () => openItemDetail(row.dataset.entryId));
  });

  hydrateThumbnails(body);
}

function renderPinCard(entry) {
  const item = entry._item;
  if (!item) return '';
  const pct = DB.percentChange(entry);
  const badge = pct != null ? '<span class="badge ' + (pct >= 0 ? 'gain' : 'loss') + '">' + (pct >= 0 ? '+' : '') + Math.round(pct) + '%</span>' : '';
  return '<button class="pin-card" data-entry-id="' + entry.id + '">' +
    '<div class="thumb" data-photo-key="' + (item.userImagePhotoBlobKey || '') + '">' + badge + '<span class="thumb-fallback">' + DB.CATEGORIES[item.category].icon + '</span></div>' +
    '<p class="name">' + escapeHtml(item.name) + '</p>' +
    '<p class="series">' + escapeHtml(item.series || '') + '</p>' +
    '<p class="value">' + fmtCurrency(entry.currentEstimatedValue) + '</p>' +
    '</button>';
}

/// Text-only row — deliberately never references userImagePhotoBlobKey or
/// renders a <img>/.thumb element, so list mode never triggers a single
/// Photos.loadPhotoURL() call. This is the point of the toggle: a fast,
/// lightweight way to browse a large collection without loading any image
/// data at all, not just a visually-compact view that still loads photos
/// in the background.
function renderPinListRow(entry) {
  const item = entry._item;
  if (!item) return '';
  const pct = DB.percentChange(entry);
  const pctHtml = pct != null
    ? '<span class="list-pct ' + (pct >= 0 ? 'gain-text' : 'loss-text') + '">' + (pct >= 0 ? '+' : '') + Math.round(pct) + '%</span>'
    : '';
  return '<button class="pin-list-row" data-entry-id="' + entry.id + '">' +
    '<span class="list-icon">' + DB.CATEGORIES[item.category].icon + '</span>' +
    '<span class="list-text">' +
    '<span class="list-name">' + escapeHtml(item.name) + '</span>' +
    '<span class="list-series">' + escapeHtml(item.series || '') + '</span>' +
    '</span>' +
    '<span class="list-value-col">' +
    '<span class="list-value">' + fmtCurrency(entry.currentEstimatedValue) + '</span>' +
    pctHtml +
    '</span>' +
    '</button>';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

async function hydrateThumbnails(root) {
  root = root || document;
  const thumbs = root.querySelectorAll('.thumb[data-photo-key]');
  for (const thumb of thumbs) {
    const key = thumb.dataset.photoKey;
    if (!key) continue;
    const url = await Photos.loadPhotoURL(key);
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      const fallback = thumb.querySelector('.thumb-fallback');
      if (fallback) fallback.remove();
      thumb.prepend(img);
    }
  }
}

function openSortSheet() {
  const options = Filtering.SORT_OPTIONS;
  openSheet(
    '<div class="sheet-header"><h2>Sort by</h2><button id="sheet-close">Done</button></div>' +
    Object.entries(options).map(([key, opt]) =>
      '<button class="btn block" style="justify-content:flex-start; margin-bottom:6px;" data-sort="' + key + '">' +
      (state.sortOption === key ? '✓ ' : '') + opt.label +
      '</button>'
    ).join(''),
    () => {
      document.getElementById('sheet-close').addEventListener('click', closeSheet);
      document.querySelectorAll('[data-sort]').forEach(btn => {
        btn.addEventListener('click', () => {
          state.sortOption = btn.dataset.sort;
          closeSheet();
          renderInventoryBody();
        });
      });
    }
  );
}

async function openFilterSheet(facetKeyToShow) {
  const allEntries = await attachItems(await DB.getAllInventoryEntries());
  const scoped = state.categoryFilter ? allEntries.filter(e => e._item && e._item.category === state.categoryFilter) : allEntries;
  const facetKeys = facetKeyToShow ? [facetKeyToShow] : Filtering.availableFacets(scoped);

  if (!facetKeyToShow) {
    openSheet(
      '<div class="sheet-header"><h2>Filter by</h2><button id="sheet-close">Done</button></div>' +
      (facetKeys.length === 0
        ? '<p class="empty-state message">No tags found yet — add character, movie, holiday, park, or attraction tags to items to filter by them.</p>'
        : facetKeys.map(key => {
            const facet = Filtering.FACETS[key];
            const selectedCount = state.activeFilter.facetKey === key ? state.activeFilter.selectedValues.size : 0;
            return '<button class="btn block" style="justify-content:space-between; margin-bottom:6px;" data-facet="' + key + '">' +
              '<span>' + facet.icon + ' ' + facet.label + '</span>' +
              '<span style="color:var(--text-secondary); font-size:12px;">' + (selectedCount > 0 ? selectedCount + ' selected ›' : '›') + '</span>' +
              '</button>';
          }).join('')) +
      (Filtering.filterIsActive(state.activeFilter) ? '<button class="btn block" id="clear-filter-sheet-btn" style="color:var(--enamel-red); margin-top:10px;">Clear filter</button>' : ''),
      () => {
        document.getElementById('sheet-close').addEventListener('click', closeSheet);
        document.querySelectorAll('[data-facet]').forEach(btn => {
          btn.addEventListener('click', () => openFilterSheet(btn.dataset.facet));
        });
        const clearBtn = document.getElementById('clear-filter-sheet-btn');
        if (clearBtn) clearBtn.addEventListener('click', () => {
          Filtering.clearFilter(state.activeFilter);
          closeSheet();
          renderInventoryBody();
        });
      }
    );
    return;
  }

  const facet = Filtering.FACETS[facetKeyToShow];
  const summaries = Filtering.groupSummaries(facetKeyToShow, scoped);

  openSheet(
    '<div class="sheet-header"><button id="sheet-back">‹ Back</button><h2>' + facet.label + '</h2><button id="sheet-close">Done</button></div>' +
    summaries.map(s => {
      const isSelected = state.activeFilter.facetKey === facetKeyToShow && state.activeFilter.selectedValues.has(s.value);
      return '<button class="btn block" style="justify-content:space-between; margin-bottom:6px;" data-value="' + escapeHtml(s.value) + '">' +
        '<span>' + (isSelected ? '✓' : '○') + ' ' + escapeHtml(s.value) + ' <span style="color:var(--text-secondary); font-size:11px;">(' + s.itemCount + ')</span></span>' +
        '<span style="font-size:13px; font-weight:600;">' + fmtCurrency(s.totalValue) + '</span>' +
        '</button>';
    }).join(''),
    () => {
      document.getElementById('sheet-close').addEventListener('click', () => { closeSheet(); renderInventoryBody(); });
      document.getElementById('sheet-back').addEventListener('click', () => openFilterSheet(null));
      document.querySelectorAll('[data-value]').forEach(btn => {
        btn.addEventListener('click', () => {
          Filtering.toggleFilterValue(state.activeFilter, facetKeyToShow, btn.dataset.value);
          openFilterSheet(facetKeyToShow);
        });
      });
    }
  );
}

async function renderWishlistBody() {
  const body = document.getElementById('collection-body');
  const readOnly = isViewingReadOnlyCollection();
  const collectionWishlist = await DB.getWishlistEntriesByCollection(state.activeCollectionId);
  const entries = await attachItems(collectionWishlist);
  entries.sort((a, b) => b.dateAdded - a.dateAdded);

  const addButtonHtml = readOnly ? '' : '<button class="btn block primary" id="add-wishlist-btn" style="margin-top:6px;">+ Add to wishlist</button>';

  if (entries.length === 0) {
    body.innerHTML =
      '<div class="empty-state">' +
      '<div class="icon">💗</div>' +
      '<p class="title">Wishlist is empty</p>' +
      '<p class="message">' + (readOnly ? 'This collection has nothing on its wishlist.' : 'Scan an item or add one manually to start tracking it.') + '</p>' +
      '</div>' +
      addButtonHtml;
  } else {
    body.innerHTML = entries.map(e => {
      const item = e._item;
      const below = DB.isBelowTarget(e);
      return '<div class="card" style="display:flex; align-items:center; gap:12px;">' +
        '<div class="thumb" data-photo-key="' + (item && item.userImagePhotoBlobKey || '') + '" style="width:52px; height:52px; flex-shrink:0; margin-bottom:0;"><span class="thumb-fallback">' + (item ? DB.CATEGORIES[item.category].icon : '📦') + '</span></div>' +
        '<div style="flex:1; min-width:0;">' +
        '<p style="font-size:13px; font-weight:500; margin:0 0 2px;">' + escapeHtml(item && item.name || 'Unknown') + '</p>' +
        '<p style="font-size:11px; color:var(--text-secondary); margin:0;">' + escapeHtml(item && item.series || '') + '</p>' +
        '</div>' +
        '<div style="text-align:right;">' +
        (below ? '<span style="font-size:10px; background:rgba(29,158,117,0.15); color:var(--enamel-teal); padding:2px 8px; border-radius:6px; display:inline-block; margin-bottom:3px;">Below target</span><br>' : '') +
        '<span style="font-size:13px; font-weight:500;">' + fmtCurrency(e.lastKnownMarketLow) + ' / ' + fmtCurrency(e.maxPriceWillingToPay) + '</span>' +
        '</div>' +
        '</div>';
    }).join('') + addButtonHtml;
  }

  const addBtn = document.getElementById('add-wishlist-btn');
  if (addBtn) addBtn.addEventListener('click', () => Scan.openManualEntrySheet({ defaultDestination: 'wishlist', onSaved: renderCollectionTab }));
  hydrateThumbnails(body);
}

async function renderLedgerBody() {
  const body = document.getElementById('collection-body');
  const collectionItems = await DB.getItemsByCollection(state.activeCollectionId);
  const collectionItemIds = new Set(collectionItems.map(i => i.id));
  const allTx = await attachItems(await DB.getAllTransactions());
  const sold = allTx.filter(t => t.type === 'sold' && collectionItemIds.has(t.itemId)).sort((a, b) => b.date - a.date);
  const realizedPL = sold.reduce((sum, t) => sum + (t.profitLoss || 0), 0);

  let html = '<div class="card" style="display:flex; justify-content:space-between; align-items:center;">' +
    '<span style="font-size:13px; color:var(--text-secondary);">Realized profit / loss</span>' +
    '<span style="font-size:18px; font-weight:600; color:' + (realizedPL >= 0 ? 'var(--enamel-teal)' : 'var(--enamel-red)') + ';">' + fmtSignedCurrency(realizedPL) + '</span>' +
    '</div>';

  if (sold.length === 0) {
    html += '<div class="empty-state">' +
      '<div class="icon">🏷️</div>' +
      '<p class="title">No sales logged</p>' +
      '<p class="message">Mark an item as sold from its detail view to start tracking your trades.</p>' +
      '</div>';
  } else {
    html += '<div class="card">' + sold.map(t =>
      '<div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border);">' +
      '<div>' +
      '<p style="font-size:13px; margin:0;">' + escapeHtml(t._item && t._item.name || 'Unknown') + '</p>' +
      '<p style="font-size:11px; color:var(--text-secondary); margin:0;">' + fmtDate(t.date) + '</p>' +
      '</div>' +
      '<span style="font-size:13px; font-weight:600; color:' + ((t.profitLoss || 0) >= 0 ? 'var(--enamel-teal)' : 'var(--enamel-red)') + ';">' + fmtSignedCurrency(t.profitLoss || 0) + '</span>' +
      '</div>'
    ).join('') + '</div>';
  }

  body.innerHTML = html;
}

async function openItemDetail(entryId) {
  const readOnly = isViewingReadOnlyCollection();
  const entries = await attachItems(await DB.getInventoryEntriesByCollection(state.activeCollectionId));
  const entry = entries.find(e => e.id === entryId);
  if (!entry) return;
  const item = entry._item;
  const history = await DB.getPriceHistoryForItem(item.id);
  const latest = history[history.length - 1];
  const pct = DB.percentChange(entry);

  const tagPairs = []
    .concat((item.characters || []).map(c => ['🧑', c]))
    .concat(item.movie ? [['🎬', item.movie]] : [])
    .concat(item.holiday ? [['🎁', item.holiday]] : [])
    .concat(item.editionSize ? [['#️⃣', 'LE ' + item.editionSize]] : [])
    .concat(item.park ? [['🗺️', item.park]] : [])
    .concat(item.attraction ? [['🎡', item.attraction]] : []);

  mainEl.innerHTML =
    '<button class="btn" id="back-btn" style="margin-bottom:10px; border:none; padding-left:0;">‹ Back</button>' +
    (readOnly ? '<div class="card" style="background:rgba(200,140,40,0.08); font-size:12px; margin-bottom:10px;">👀 From a friend\'s collection — read-only</div>' : '') +
    '<div class="card">' +
    '<div style="display:flex; gap:14px; margin-bottom:12px;">' +
    '<div class="thumb" data-photo-key="' + (item.userImagePhotoBlobKey || '') + '" style="width:84px; height:84px; flex-shrink:0; margin-bottom:0;"><span class="thumb-fallback">' + DB.CATEGORIES[item.category].icon + '</span></div>' +
    '<div>' +
    '<p style="font-size:16px; font-weight:600; margin:0 0 2px;">' + escapeHtml(item.name) + '</p>' +
    '<p style="font-size:12px; color:var(--text-secondary); margin:0 0 6px;">' + escapeHtml(item.series || '') + '</p>' +
    (item.itemIdentifier ? '<span style="font-size:11px; background:var(--surface-3); padding:2px 8px; border-radius:6px;">' + DB.CATEGORIES[item.category].identifierLabel + ' ' + escapeHtml(item.itemIdentifier) + '</span>' : '') +
    '</div>' +
    '</div>' +
    '<div class="metric-row" style="margin-bottom:0;">' +
    '<div class="metric-card"><p class="label">Paid</p><p class="value">' + fmtCurrency(entry.purchasePrice) + '</p></div>' +
    '<div class="metric-card"><p class="label">Current est.</p><p class="value ' + (pct >= 0 ? 'gain' : 'loss') + '">' + fmtCurrency(entry.currentEstimatedValue) + '</p></div>' +
    '</div>' +
    '</div>' +

    '<div class="card">' +
    '<div style="display:flex; justify-content:space-between; margin-bottom:8px;">' +
    '<span style="font-size:13px; font-weight:500;">Value history</span>' +
    (latest ? '<span style="font-size:11px; color:var(--text-secondary);">Based on ' + latest.sampleSize + ' sold comps</span>' : '') +
    '</div>' +
    (history.length >= 2 ? '<canvas id="value-chart" height="120"></canvas>' : '<p style="font-size:12px; color:var(--text-secondary);">Re-check value a few times to build a history chart.</p>') +
    (latest && DB.isLowConfidence(latest) ? '<p style="font-size:11px; color:#a06b1f; margin-top:8px;">⚠️ Low confidence — fewer than ' + DB.LOW_CONFIDENCE_THRESHOLD + ' sold comps found</p>' : '') +
    (latest ? renderSoldListingsToggle(latest, 'item-detail') : '') +
    (readOnly ? '' : '<button class="btn block" id="recheck-btn" style="margin-top:10px;">↻ Re-check value</button>') +
    '</div>' +

    (tagPairs.length > 0 ? '<div class="card"><p style="font-size:13px; font-weight:500; margin:0 0 8px;">Tags</p><div class="tags">' + tagPairs.map(p => '<span class="tag-chip">' + p[0] + ' ' + escapeHtml(p[1]) + '</span>').join('') + '</div></div>' : '') +

    '<div class="card">' +
    '<div style="display:flex; justify-content:space-between; padding:5px 0;"><span style="font-size:13px; color:var(--text-secondary);">📅 Acquired</span><span style="font-size:13px;">' + fmtDate(entry.dateAcquired) + ' · ' + entry.acquiredVia + '</span></div>' +
    '<div style="display:flex; justify-content:space-between; padding:5px 0;"><span style="font-size:13px; color:var(--text-secondary);">✨ Condition</span><span style="font-size:13px;">' + entry.condition + '</span></div>' +
    '<div style="display:flex; justify-content:space-between; padding:5px 0;"><span style="font-size:13px; color:var(--text-secondary);">📦 Storage</span><span style="font-size:13px;">' + escapeHtml(entry.storageLocation || 'Not set') + '</span></div>' +
    '</div>' +

    (item.notes ? '<div class="card"><p style="font-size:13px; font-weight:500; margin:0 0 6px;">Notes</p><p style="font-size:13px; color:var(--text-secondary); margin:0;">' + escapeHtml(item.notes) + '</p></div>' : '') +

    (readOnly ? '' :
      '<div class="btn-row">' +
      '<button class="btn" id="mark-sold-btn">🏷️ Mark as sold</button>' +
      '<button class="btn" id="delete-btn" style="color:var(--enamel-red);">🗑️ Delete</button>' +
      '</div>');

  document.getElementById('back-btn').addEventListener('click', renderCollectionTab);
  document.getElementById('recheck-btn')?.addEventListener('click', () => recheckValue(entry, item));
  attachSoldListingsToggleHandler('item-detail');
  document.getElementById('mark-sold-btn')?.addEventListener('click', () => openMarkAsSoldSheet(entry, item));
  document.getElementById('delete-btn')?.addEventListener('click', async () => {
    if (confirm('Delete "' + item.name + '" from your collection? This can\'t be undone.')) {
      await DB.deleteInventoryEntry(entry.id);
      await DB.deleteItemCascade(item.id);
      if (item.userImagePhotoBlobKey) await Photos.deletePhoto(item.userImagePhotoBlobKey);
      renderCollectionTab();
    }
  });

  hydrateThumbnails(mainEl);
  if (history.length >= 2) drawValueChart('value-chart', history);
}

async function recheckValue(entry, item) {
  showToast('Checking current value…');
  try {
    const estimate = await PriceService.estimateValue(item);
    const snapshot = DB.newPriceSnapshot(item.id, {
      estimatedValueLow: estimate.low,
      estimatedValueHigh: estimate.high,
      estimatedValueMedian: estimate.median,
      sampleSize: estimate.sampleSize,
      listings: estimate.listings || [],
      source: estimate.source || null
    });
    await DB.savePriceSnapshot(snapshot);
    entry.currentEstimatedValue = estimate.median;
    entry.lastValueCheck = Date.now();
    await DB.saveInventoryEntry(entry);
    showToast('Value updated');
    openItemDetail(entry.id);
  } catch (err) {
    showToast(err.message || 'Could not check value right now');
  }
}

// MARK: - Bulk value refresh

/// Re-checks every item in your OWN collection, one at a time, showing
/// live progress in a sheet. Deliberately restricted to your own
/// collection — refreshing a friend's imported (read-only) collection is
/// blocked even though it would only touch local price-history data on
/// this device, since "read-only" should be an unambiguous guarantee, not
/// something with a quiet exception.
async function openRefreshAllValuesSheet() {
  if (isViewingReadOnlyCollection()) {
    showToast("Can't refresh values for a friend's collection — switch to your own first.");
    return;
  }

  const collectionInventory = await DB.getInventoryEntriesByCollection(DB.OWN_COLLECTION_ID);
  if (collectionInventory.length === 0) {
    showToast('No items in your collection to refresh.');
    return;
  }

  let cancelled = false;

  openSheet(
    '<div class="sheet-header"><h2>Refresh all values</h2><button id="sheet-close">Cancel</button></div>' +
    '<p style="font-size:12px; color:var(--text-secondary); margin:0 0 14px;">Checking current sold-listing prices for ' + collectionInventory.length + ' item' + (collectionInventory.length === 1 ? '' : 's') + '. This makes one price lookup per item, so it may take a little while and will use some of your API quota.</p>' +
    '<div id="refresh-progress-bar" style="background:var(--surface-3); border-radius:6px; height:8px; margin-bottom:10px; overflow:hidden;"><div id="refresh-progress-fill" style="background:var(--brass); height:8px; width:0%; transition:width 0.2s;"></div></div>' +
    '<p id="refresh-progress-text" style="font-size:12px; color:var(--text-secondary); text-align:center; margin:0 0 14px;">Starting…</p>' +
    '<div id="refresh-log" style="max-height:220px; overflow-y:auto;"></div>',
    () => {
      document.getElementById('sheet-close').addEventListener('click', () => {
        cancelled = true;
        closeSheet();
        render();
      });
      runBulkRefresh(collectionInventory, () => cancelled);
    }
  );
}

async function runBulkRefresh(entries, isCancelled) {
  const items = await DB.getAllItems();
  const itemsById = Object.fromEntries(items.map(i => [i.id, i]));
  const log = document.getElementById('refresh-log');
  let succeeded = 0, failed = 0;

  for (let i = 0; i < entries.length; i++) {
    if (isCancelled()) return;

    const entry = entries[i];
    const item = itemsById[entry.itemId];
    const progressText = document.getElementById('refresh-progress-text');
    const progressFill = document.getElementById('refresh-progress-fill');
    if (!progressText) return; // sheet was closed mid-run

    progressText.textContent = 'Checking ' + (i + 1) + ' of ' + entries.length + '…';
    progressFill.style.width = Math.round(((i) / entries.length) * 100) + '%';

    if (!item) { failed++; continue; }

    const row = document.createElement('div');
    row.style.fontSize = '12px';
    row.style.padding = '4px 0';
    row.textContent = '⏳ ' + item.name;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;

    try {
      const estimate = await PriceService.estimateValue(item);
      await DB.savePriceSnapshot(DB.newPriceSnapshot(item.id, {
        estimatedValueLow: estimate.low,
        estimatedValueHigh: estimate.high,
        estimatedValueMedian: estimate.median,
        sampleSize: estimate.sampleSize,
        listings: estimate.listings || [],
        source: estimate.source || null
      }));
      entry.currentEstimatedValue = estimate.median;
      entry.lastValueCheck = Date.now();
      await DB.saveInventoryEntry(entry);
      row.textContent = '✓ ' + item.name + ' — ' + fmtCurrency(estimate.median);
      succeeded++;
    } catch (err) {
      row.textContent = '✗ ' + item.name + ' — no comps found';
      failed++;
    }
  }

  const progressFill = document.getElementById('refresh-progress-fill');
  const progressText = document.getElementById('refresh-progress-text');
  if (progressFill) progressFill.style.width = '100%';
  if (progressText) progressText.textContent = 'Done — ' + succeeded + ' updated' + (failed > 0 ? ', ' + failed + ' could not be priced' : '') + '.';

  showToast('Refresh complete');
  setTimeout(() => { closeSheet(); render(); }, 1200);
}

function drawValueChart(canvasId, history) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.clientWidth * 2;
  const h = canvas.height = 120 * 2;
  ctx.scale(2, 2);
  ctx.clearRect(0, 0, w, h);

  const values = history.map(s => s.estimatedValueMedian);
  const min = Math.min.apply(null, values) * 0.9;
  const max = Math.max.apply(null, values) * 1.1;
  const range = max - min || 1;
  const stepX = (canvas.clientWidth - 10) / (history.length - 1);

  ctx.beginPath();
  ctx.strokeStyle = '#1D9E75';
  ctx.lineWidth = 2;
  history.forEach((s, i) => {
    const x = 5 + i * stepX;
    const y = 110 - ((s.estimatedValueMedian - min) / range) * 100;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = 'rgba(29,158,117,0.08)';
  ctx.lineTo(5 + (history.length - 1) * stepX, 120);
  ctx.lineTo(5, 120);
  ctx.closePath();
  ctx.fill();
}

function openMarkAsSoldSheet(entry, item) {
  openSheet(
    '<div class="sheet-header"><h2>Mark as sold</h2><button id="sheet-close">Cancel</button></div>' +
    '<div class="card" style="display:flex; align-items:center; gap:12px;">' +
    '<div class="thumb" data-photo-key="' + (item.userImagePhotoBlobKey || '') + '" style="width:52px; height:52px; margin-bottom:0;"><span class="thumb-fallback">' + DB.CATEGORIES[item.category].icon + '</span></div>' +
    '<div><p style="font-size:13px; font-weight:500; margin:0;">' + escapeHtml(item.name) + '</p><p style="font-size:11px; color:var(--text-secondary); margin:0;">bought for ' + fmtCurrency(entry.purchasePrice) + '</p></div>' +
    '</div>' +
    '<div class="field"><label>Sold price</label><input type="number" id="sold-price" value="' + (entry.currentEstimatedValue ? Math.round(entry.currentEstimatedValue) : '') + '"></div>' +
    '<div class="field"><label>Platform</label><input type="text" id="sold-platform" placeholder="eBay, trade, etc."></div>' +
    '<div class="card" style="display:flex; justify-content:space-between; align-items:center;">' +
    '<span style="font-size:13px;">Profit / loss</span>' +
    '<span id="pl-preview" style="font-size:16px; font-weight:600;">$0</span>' +
    '</div>' +
    '<button class="btn block primary" id="confirm-sale-btn" style="margin-top:10px;">Confirm sale</button>',
    () => {
      document.getElementById('sheet-close').addEventListener('click', closeSheet);
      const priceInput = document.getElementById('sold-price');
      const updatePL = () => {
        const sold = parseFloat(priceInput.value) || 0;
        const pl = sold - (entry.purchasePrice || 0);
        const el = document.getElementById('pl-preview');
        el.textContent = fmtSignedCurrency(pl);
        el.style.color = pl >= 0 ? 'var(--enamel-teal)' : 'var(--enamel-red)';
      };
      priceInput.addEventListener('input', updatePL);
      updatePL();

      document.getElementById('confirm-sale-btn').addEventListener('click', async () => {
        const soldPrice = parseFloat(priceInput.value) || 0;
        const platform = document.getElementById('sold-platform').value;
        const transaction = DB.newTransaction(item.id, {
          price: soldPrice,
          platform: platform || null,
          profitLoss: soldPrice - (entry.purchasePrice || 0)
        });
        await DB.saveTransaction(transaction);
        await DB.deleteInventoryEntry(entry.id);
        closeSheet();
        showToast('Sale logged');
        renderCollectionTab();
      });
    }
  );
}

async function renderStatsTab() {
  const collections = await DB.getAllCollections();
  const activeCollection = collections.find(c => c.id === state.activeCollectionId) || { id: DB.OWN_COLLECTION_ID, name: 'My Collection', isOwn: true };

  const collectionInventory = await DB.getInventoryEntriesByCollection(state.activeCollectionId);
  const entries = await attachItems(collectionInventory);
  const collectionItems = await DB.getItemsByCollection(state.activeCollectionId);
  const collectionItemIds = new Set(collectionItems.map(i => i.id));
  const allTx = await attachItems(await DB.getAllTransactions());
  const sold = allTx.filter(t => t.type === 'sold' && collectionItemIds.has(t.itemId));

  const totalValue = entries.reduce((s, e) => s + (e.currentEstimatedValue || 0), 0);
  const totalInvested = entries.reduce((s, e) => s + (e.purchasePrice || 0), 0);
  const unrealizedGain = totalValue - totalInvested;
  const realizedPL = sold.reduce((s, t) => s + (t.profitLoss || 0), 0);

  const collectionBanner = activeCollection.isOwn
    ? ''
    : '<div class="card" style="background:rgba(200,140,40,0.08); font-size:12px; margin-bottom:10px;">👀 Showing stats for <strong>' + escapeHtml(activeCollection.name) + '</strong></div>';

  const refreshButtonHtml = activeCollection.isOwn
    ? '<button class="btn block" id="stats-refresh-all-btn" style="margin-bottom:14px;">↻ Refresh all values</button>'
    : '';

  if (entries.length === 0) {
    mainEl.innerHTML =
      collectionBanner +
      '<div class="metric-row">' +
      '<div class="metric-card"><p class="label">Current value</p><p class="value">' + fmtCurrency(0) + '</p></div>' +
      '<div class="metric-card"><p class="label">Total invested</p><p class="value">' + fmtCurrency(0) + '</p></div>' +
      '</div>' +
      '<div class="empty-state"><div class="icon">📈</div><p class="title">No data yet</p><p class="message">Add items to your collection to see stats here.</p></div>';
    return;
  }

  const categories = [...new Set(entries.map(e => e._item && e._item.category).filter(Boolean))];
  const lowConfidenceCount = await countLowConfidence(entries);
  const topGainers = entries
    .map(e => ({ e: e, pct: DB.percentChange(e) }))
    .filter(x => x.pct != null && x.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3);

  const facetOptions = Filtering.availableFacets(entries);
  const selectedFacet = state._statsFacet || facetOptions[0];

  const oldestCheck = entries.reduce((oldest, e) => {
    if (!e.lastValueCheck) return oldest;
    return (oldest === null || e.lastValueCheck < oldest) ? e.lastValueCheck : oldest;
  }, null);
  const staleHint = oldestCheck
    ? '<p style="font-size:11px; color:var(--text-secondary); text-align:center; margin:-8px 0 14px;">Oldest value check: ' + fmtDate(oldestCheck) + '</p>'
    : '';

  let html = collectionBanner +
    '<div class="metric-row">' +
    '<div class="metric-card"><p class="label">Current value</p><p class="value">' + fmtCurrency(totalValue) + '</p></div>' +
    '<div class="metric-card"><p class="label">Total invested</p><p class="value">' + fmtCurrency(totalInvested) + '</p></div>' +
    '</div>' +
    '<div class="metric-row">' +
    '<div class="metric-card"><p class="label">Unrealized gain</p><p class="value ' + (unrealizedGain >= 0 ? 'gain' : 'loss') + '">' + fmtSignedCurrency(unrealizedGain) + '</p></div>' +
    '<div class="metric-card"><p class="label">Realized P/L</p><p class="value ' + (realizedPL >= 0 ? 'gain' : 'loss') + '">' + fmtSignedCurrency(realizedPL) + '</p></div>' +
    '</div>' +
    refreshButtonHtml +
    staleHint;

  if (categories.length > 1) {
    const catSummaries = categories.map(c => ({
      label: DB.CATEGORIES[c].icon + ' ' + DB.CATEGORIES[c].pluralLabel,
      value: entries.filter(e => e._item && e._item.category === c).reduce((s, e) => s + (e.currentEstimatedValue || 0), 0)
    })).sort((a, b) => b.value - a.value);
    html += renderBarCard('Value by category', catSummaries);
  }

  const seriesMap = {};
  entries.forEach(e => {
    const key = (e._item && e._item.series) || 'Other';
    seriesMap[key] = (seriesMap[key] || 0) + (e.currentEstimatedValue || 0);
  });
  const seriesSummaries = Object.entries(seriesMap).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  html += renderBarCard('Value by series', seriesSummaries);

  if (facetOptions.length > 0) {
    const summaries = Filtering.groupSummaries(selectedFacet, entries).slice(0, 8)
      .map(s => ({ label: s.value, value: s.totalValue }));
    html += '<div class="card">' +
      '<div style="display:flex; justify-content:space-between; margin-bottom:10px;">' +
      '<span style="font-size:13px; font-weight:500;">Value by ' + Filtering.FACETS[selectedFacet].label.toLowerCase() + '</span>' +
      '<select id="facet-select" style="font-size:11px; border:none; background:var(--surface-3); border-radius:6px; padding:3px 6px;">' +
      facetOptions.map(f => '<option value="' + f + '" ' + (f === selectedFacet ? 'selected' : '') + '>' + Filtering.FACETS[f].label + '</option>').join('') +
      '</select>' +
      '</div>' +
      barsHtml(summaries) +
      '</div>';
  }

  if (topGainers.length > 0) {
    html += '<div class="card"><p style="font-size:13px; font-weight:500; margin:0 0 8px;">Top gainers</p>' +
      topGainers.map((x, i) =>
        '<div style="display:flex; justify-content:space-between; padding:4px 0; ' + (i > 0 ? 'border-top:1px solid var(--border);' : '') + '">' +
        '<span style="font-size:13px;">' + escapeHtml(x.e._item && x.e._item.name || '') + '</span>' +
        '<span style="font-size:13px; font-weight:600; color:var(--enamel-teal);">+' + Math.round(x.pct) + '%</span>' +
        '</div>'
      ).join('') + '</div>';
  }

  if (lowConfidenceCount > 0) {
    html += '<div class="card">' +
      '<div style="display:flex; justify-content:space-between;"><span style="font-size:13px; font-weight:500;">Low-confidence estimates</span><span style="font-size:11px; color:var(--text-secondary);">' + lowConfidenceCount + ' items</span></div>' +
      '<p style="font-size:11px; color:var(--text-secondary); margin:6px 0 0;">Fewer than ' + DB.LOW_CONFIDENCE_THRESHOLD + ' sold comps found — these values may be unreliable.</p>' +
      '</div>';
  }

  mainEl.innerHTML = html;

  const facetSelect = document.getElementById('facet-select');
  if (facetSelect) facetSelect.addEventListener('change', (e) => {
    state._statsFacet = e.target.value;
    renderStatsTab();
  });

  document.getElementById('stats-refresh-all-btn')?.addEventListener('click', openRefreshAllValuesSheet);
}

async function countLowConfidence(entries) {
  let count = 0;
  for (const e of entries) {
    const history = await DB.getPriceHistoryForItem(e.itemId);
    const latest = history[history.length - 1];
    if (latest && DB.isLowConfidence(latest)) count++;
  }
  return count;
}

function renderBarCard(title, summaries) {
  return '<div class="card"><p style="font-size:13px; font-weight:500; margin:0 0 10px;">' + title + '</p>' + barsHtml(summaries) + '</div>';
}

function barsHtml(summaries) {
  const max = Math.max.apply(null, summaries.map(s => s.value).concat([1]));
  return summaries.map(s =>
    '<div style="margin-bottom:8px;">' +
    '<div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:2px;">' +
    '<span style="color:var(--text-secondary);">' + escapeHtml(s.label) + '</span>' +
    '<span style="font-weight:500;">' + fmtCurrency(s.value) + '</span>' +
    '</div>' +
    '<div style="background:var(--surface-3); border-radius:4px; height:8px;">' +
    '<div style="background:var(--brass); border-radius:4px; height:8px; width:' + ((s.value / max) * 100) + '%;"></div>' +
    '</div>' +
    '</div>'
  ).join('');
}

render();
