// app.js — view router + screens for Collection and Stats tabs.
// Scan tab logic lives in scan.js since it's substantial on its own.

const state = {
  activeTab: 'scan',
  collectionSegment: 'inventory', // inventory | wishlist | ledger
  categoryFilter: null,
  activeFilter: Filtering.createActiveFilter(),
  sortOption: 'dateAcquiredNewest'
};

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

function openSheet(html, onMount) {
  sheetRoot.innerHTML = '<div class="sheet-overlay" id="sheet-overlay"><div class="sheet">' + html + '</div></div>';
  document.getElementById('sheet-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'sheet-overlay') closeSheet();
  });
  if (onMount) onMount();
}

function closeSheet() {
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
  mainEl.innerHTML =
    '<div class="segmented" id="collection-segmented">' +
      '<button data-seg="inventory">My items</button>' +
      '<button data-seg="wishlist">Wishlist</button>' +
      '<button data-seg="ledger">Bought / sold</button>' +
    '</div>' +
    '<div id="collection-body"></div>';

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

async function renderInventoryBody() {
  const body = document.getElementById('collection-body');

  headerActionsEl.innerHTML = '<button id="sort-btn">⇅</button><button id="filter-btn">▽</button>';
  document.getElementById('sort-btn').addEventListener('click', openSortSheet);
  document.getElementById('filter-btn').addEventListener('click', () => openFilterSheet());

  const allEntries = await attachItems(await DB.getAllInventoryEntries());

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
      '<p class="message">' + (allEntries.length === 0 ? 'Scan a pin or other collectible to add it to your collection.' : 'Try a different filter.') + '</p>' +
      '</div>';
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
  const entries = await attachItems(await DB.getAllWishlistEntries());
  entries.sort((a, b) => b.dateAdded - a.dateAdded);

  if (entries.length === 0) {
    body.innerHTML =
      '<div class="empty-state">' +
      '<div class="icon">💗</div>' +
      '<p class="title">Wishlist is empty</p>' +
      '<p class="message">Scan an item or add one manually to start tracking it.</p>' +
      '</div>' +
      '<button class="btn block primary" id="add-wishlist-btn">+ Add to wishlist</button>';
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
    }).join('') + '<button class="btn block" id="add-wishlist-btn" style="margin-top:6px;">+ Add to wishlist</button>';
  }

  const addBtn = document.getElementById('add-wishlist-btn');
  if (addBtn) addBtn.addEventListener('click', () => Scan.openManualEntrySheet({ defaultDestination: 'wishlist', onSaved: renderCollectionTab }));
  hydrateThumbnails(body);
}

async function renderLedgerBody() {
  const body = document.getElementById('collection-body');
  const allTx = await attachItems(await DB.getAllTransactions());
  const sold = allTx.filter(t => t.type === 'sold').sort((a, b) => b.date - a.date);
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
  const entries = await attachItems(await DB.getAllInventoryEntries());
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
    '<button class="btn block" id="recheck-btn" style="margin-top:10px;">↻ Re-check value</button>' +
    '</div>' +

    (tagPairs.length > 0 ? '<div class="card"><p style="font-size:13px; font-weight:500; margin:0 0 8px;">Tags</p><div class="tags">' + tagPairs.map(p => '<span class="tag-chip">' + p[0] + ' ' + escapeHtml(p[1]) + '</span>').join('') + '</div></div>' : '') +

    '<div class="card">' +
    '<div style="display:flex; justify-content:space-between; padding:5px 0;"><span style="font-size:13px; color:var(--text-secondary);">📅 Acquired</span><span style="font-size:13px;">' + fmtDate(entry.dateAcquired) + ' · ' + entry.acquiredVia + '</span></div>' +
    '<div style="display:flex; justify-content:space-between; padding:5px 0;"><span style="font-size:13px; color:var(--text-secondary);">✨ Condition</span><span style="font-size:13px;">' + entry.condition + '</span></div>' +
    '<div style="display:flex; justify-content:space-between; padding:5px 0;"><span style="font-size:13px; color:var(--text-secondary);">📦 Storage</span><span style="font-size:13px;">' + escapeHtml(entry.storageLocation || 'Not set') + '</span></div>' +
    '</div>' +

    (item.notes ? '<div class="card"><p style="font-size:13px; font-weight:500; margin:0 0 6px;">Notes</p><p style="font-size:13px; color:var(--text-secondary); margin:0;">' + escapeHtml(item.notes) + '</p></div>' : '') +

    '<div class="btn-row">' +
    '<button class="btn" id="mark-sold-btn">🏷️ Mark as sold</button>' +
    '<button class="btn" id="delete-btn" style="color:var(--enamel-red);">🗑️ Delete</button>' +
    '</div>';

  document.getElementById('back-btn').addEventListener('click', renderCollectionTab);
  document.getElementById('recheck-btn').addEventListener('click', () => recheckValue(entry, item));
  document.getElementById('mark-sold-btn').addEventListener('click', () => openMarkAsSoldSheet(entry, item));
  document.getElementById('delete-btn').addEventListener('click', async () => {
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
      sampleSize: estimate.sampleSize
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
  const entries = await attachItems(await DB.getAllInventoryEntries());
  const allTx = await attachItems(await DB.getAllTransactions());
  const sold = allTx.filter(t => t.type === 'sold');

  const totalValue = entries.reduce((s, e) => s + (e.currentEstimatedValue || 0), 0);
  const totalInvested = entries.reduce((s, e) => s + (e.purchasePrice || 0), 0);
  const unrealizedGain = totalValue - totalInvested;
  const realizedPL = sold.reduce((s, t) => s + (t.profitLoss || 0), 0);

  if (entries.length === 0) {
    mainEl.innerHTML =
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

  let html = '<div class="metric-row">' +
    '<div class="metric-card"><p class="label">Current value</p><p class="value">' + fmtCurrency(totalValue) + '</p></div>' +
    '<div class="metric-card"><p class="label">Total invested</p><p class="value">' + fmtCurrency(totalInvested) + '</p></div>' +
    '</div>' +
    '<div class="metric-row">' +
    '<div class="metric-card"><p class="label">Unrealized gain</p><p class="value ' + (unrealizedGain >= 0 ? 'gain' : 'loss') + '">' + fmtSignedCurrency(unrealizedGain) + '</p></div>' +
    '<div class="metric-card"><p class="label">Realized P/L</p><p class="value ' + (realizedPL >= 0 ? 'gain' : 'loss') + '">' + fmtSignedCurrency(realizedPL) + '</p></div>' +
    '</div>';

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
