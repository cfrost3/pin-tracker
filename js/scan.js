// scan.js — camera capture via getUserMedia, manual entry, and the
// (currently stubbed) match/price pipeline.
//
// IMPORTANT: getUserMedia requires HTTPS (or localhost) — it will silently
// fail to even prompt for permission on a plain http:// page. Whatever
// host you deploy this to must serve over https.

const Scan = (() => {
  let mediaStream = null;
  let currentCategory = 'pin';
  let captureStage = 'front'; // front | back
  let frontBlob = null;
  let backBlob = null;
  let captureMode = 'single'; // single | lot

  async function renderCaptureScreen(mainEl) {
    stopStream(); // clean up any previous session's camera before re-rendering
    captureStage = 'front';
    frontBlob = null;
    backBlob = null;

    mainEl.innerHTML =
      '<div class="segmented" id="scan-mode-toggle" style="margin-bottom:10px;">' +
      '<button data-mode="single">Single item</button>' +
      '<button data-mode="lot">Lot of items</button>' +
      '</div>' +
      '<div id="scan-mode-body"></div>';

    document.querySelectorAll('#scan-mode-toggle button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === captureMode);
      btn.addEventListener('click', () => {
        captureMode = btn.dataset.mode;
        renderCaptureScreen(mainEl);
      });
    });

    if (captureMode === 'lot') {
      stopStream();
      await LotScan.renderLotCaptureScreen(document.getElementById('scan-mode-body'));
      return;
    }

    await renderSingleCaptureScreen(document.getElementById('scan-mode-body'));
  }

  async function renderSingleCaptureScreen(mainEl) {
    mainEl.innerHTML =
      '<div class="chip-row" id="scan-category-chips">' +
      Object.entries(DB.CATEGORIES).map(([key, cat]) =>
        '<button class="chip ' + (currentCategory === key ? 'active' : '') + '" data-cat="' + key + '">' + cat.icon + ' ' + cat.label + '</button>'
      ).join('') +
      '</div>' +
      '<div class="camera-frame" id="camera-frame">' +
      '<video id="camera-video" autoplay playsinline muted></video>' +
      '<div class="guide"></div>' +
      '<span class="label-pill top-left" id="stage-label"></span>' +
      '<span class="label-pill bottom-center" id="hint-label"></span>' +
      '</div>' +
      '<div class="shutter-row">' +
      '<button class="icon-btn" id="upload-btn">🖼️</button>' +
      '<button class="shutter-btn" id="shutter-btn"></button>' +
      '<span style="width:22px;"></span>' +
      '</div>' +
      '<input type="file" id="file-input" accept="image/*" style="display:none;">' +
      '<p id="footer-hint" style="text-align:center; font-size:11px; color:var(--text-secondary);"></p>';

    document.querySelectorAll('#scan-category-chips .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        currentCategory = chip.dataset.cat;
        renderSingleCaptureScreen(mainEl);
      });
    });

    updateStageLabels();
    await startCamera();

    document.getElementById('shutter-btn').addEventListener('click', () => capturePhoto(mainEl));
    document.getElementById('upload-btn').addEventListener('click', () => document.getElementById('file-input').click());
    document.getElementById('file-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleCapturedBlob(file, mainEl);
    });
  }

  function updateStageLabels() {
    const cat = DB.CATEGORIES[currentCategory];
    const stageLabel = document.getElementById('stage-label');
    const hintLabel = document.getElementById('hint-label');
    const footerHint = document.getElementById('footer-hint');
    if (!stageLabel) return;

    stageLabel.textContent = (captureStage === 'front' ? 'Front of ' : 'Back of ') + cat.label.toLowerCase();
    hintLabel.textContent = 'Center the item on a plain background';

    if (!cat.usesOCR) {
      footerHint.textContent = "We'll match this against catalog and marketplace listings.";
    } else {
      footerHint.textContent = captureStage === 'front'
        ? 'Next: photo of the back, for the trader number'
        : "Last step — we'll match this against pin catalogs";
    }
  }

  async function startCamera() {
    const video = document.getElementById('camera-video');
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false
      });
      // Re-check rather than trust the captured `video` reference — if the
      // user navigated away from the Scan tab while getUserMedia was
      // pending, the element (and the whole screen) may no longer exist.
      const freshVideo = document.getElementById('camera-video');
      if (freshVideo) freshVideo.srcObject = mediaStream;
    } catch (err) {
      // Common causes: not served over HTTPS, permission denied, or no
      // camera available (desktop browser without a webcam). Fall back to
      // the file picker so the flow isn't a dead end.
      const frame = document.getElementById('camera-frame');
      if (frame) {
        frame.innerHTML =
          '<div style="display:flex; align-items:center; justify-content:center; height:100%; color:#aaa; font-size:12px; text-align:center; padding:20px;">' +
          'Camera unavailable (' + escapeAttr(err.message) + ').<br>Use the photo picker below instead.</div>';
      }
    }
  }

  function stopStream() {
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }
  }

  function escapeAttr(str) {
    return (str || '').replace(/</g, '&lt;');
  }

  function capturePhoto(mainEl) {
    const video = document.getElementById('camera-video');
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob((blob) => handleCapturedBlob(blob, mainEl), 'image/jpeg', 0.85);
  }

  async function handleCapturedBlob(blob, mainEl) {
    const cat = DB.CATEGORIES[currentCategory];

    if (captureStage === 'front') {
      frontBlob = blob;
      if (cat.usesOCR) {
        captureStage = 'back';
        updateStageLabels();
        return;
      }
    } else {
      backBlob = blob;
    }

    stopStream();
    await renderProcessingScreen(mainEl, currentCategory, frontBlob, backBlob);
  }

  // MARK: - Processing screen

  async function renderProcessingScreen(mainEl, category, frontBlob, backBlob) {
    const frontUrl = URL.createObjectURL(frontBlob);
    const cat = DB.CATEGORIES[category];
    const steps = cat.usesOCR
      ? [['ocr', 'Reading ' + cat.identifierLabel.toLowerCase() + ' from back'], ['match', 'Searching catalog and marketplace matches'], ['price', 'Checking recent sold prices']]
      : [['match', 'Searching catalog and marketplace matches'], ['price', 'Checking recent sold prices']];

    mainEl.innerHTML =
      '<img class="captured-preview" src="' + frontUrl + '" style="width:100%; aspect-ratio:3/4; object-fit:cover; border-radius:16px; margin-bottom:16px;">' +
      '<p style="text-align:center; font-size:14px; font-weight:500; margin-bottom:12px;">Matching against catalogs and listings</p>' +
      '<div id="step-list" style="max-width:280px; margin:0 auto;">' +
      steps.map(([key, label]) => '<div class="processing-step" data-step="' + key + '"><span class="spinner"></span><span>' + label + '</span></div>').join('') +
      '</div>' +
      '<p id="process-error" style="text-align:center; font-size:12px; color:var(--enamel-red); margin-top:12px;"></p>';

    const vocabulary = await PinTagExtractor.liveVocabulary();
    const result = await IdentifyPipeline.identify({
      category, frontBlob, backBlob, vocabulary,
      onStep: markStepDone
    });

    if (result.errorMessage) {
      document.getElementById('process-error').textContent = result.errorMessage + ' You can still enter details manually.';
    }

    await renderResultsScreen(mainEl, {
      category, frontBlob, backBlob,
      matches: result.matches,
      priceEstimate: result.priceEstimate,
      detectedIdentifier: result.detectedIdentifier
    });
  }

  function markStepDone(key) {
    const el = document.querySelector('.processing-step[data-step="' + key + '"]');
    if (!el) return;
    el.querySelector('.spinner').outerHTML = '<span class="check">✓</span>';
  }

  // MARK: - Results screen

  async function renderResultsScreen(mainEl, ctx) {
    const { category, frontBlob, matches, priceEstimate, detectedIdentifier } = ctx;
    const cat = DB.CATEGORIES[category];
    const best = matches[0];
    const frontUrl = URL.createObjectURL(frontBlob);
    let editableTags = best ? (best.extractedTags || {}) : {};

    function tagsHtml() {
      const pairs = []
        .concat((editableTags.characters || []).map(c => ['🧑', c]))
        .concat(editableTags.movie ? [['🎬', editableTags.movie]] : [])
        .concat(editableTags.holiday ? [['🎁', editableTags.holiday]] : [])
        .concat(editableTags.park ? [['🗺️', editableTags.park]] : [])
        .concat(editableTags.attraction ? [['🎡', editableTags.attraction]] : []);
      if (pairs.length === 0) return '';
      return '<div style="border-top:1px solid var(--border); margin-top:10px; padding-top:10px;">' +
        '<div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span style="font-size:11px; color:var(--text-secondary);">Suggested tags</span><button id="edit-tags-btn" style="background:none;border:none;font-size:11px;color:var(--text);">Edit</button></div>' +
        '<div class="tags">' + pairs.map(p => '<span class="tag-chip">' + p[0] + ' ' + escapeHtmlLocal(p[1]) + '</span>').join('') + '</div>' +
        '</div>';
    }

    function draw() {
      mainEl.innerHTML =
        (best
          ? '<div class="card">' +
            '<div style="display:flex; gap:14px;">' +
            '<img src="' + frontUrl + '" style="width:72px; height:72px; border-radius:10px; object-fit:cover;">' +
            '<div>' +
            '<p style="font-size:15px; font-weight:600; margin:0 0 2px;">' + escapeHtmlLocal(best.name) + '</p>' +
            (best.series ? '<p style="font-size:12px; color:var(--text-secondary); margin:0 0 6px;">' + escapeHtmlLocal(best.series) + (best.releaseYear ? ' · ' + best.releaseYear : '') + '</p>' : '') +
            '<span style="font-size:11px; background:' + (detectedIdentifier ? 'rgba(29,158,117,0.15)' : 'rgba(200,140,40,0.15)') + '; color:' + (detectedIdentifier ? 'var(--enamel-teal)' : '#a06b1f') + '; padding:2px 8px; border-radius:6px;">' +
            (detectedIdentifier ? 'Matched via ' + cat.identifierLabel.toLowerCase() : 'Matched via image similarity') + '</span>' +
            '</div></div>' +
            ((best.itemIdentifier || detectedIdentifier) ? '<p style="font-size:12px; color:var(--text-secondary); border-top:1px solid var(--border); margin-top:10px; padding-top:8px;">' + cat.identifierLabel + ' ' + escapeHtmlLocal(best.itemIdentifier || detectedIdentifier) + '</p>' : '') +
            tagsHtml() +
            '</div>'
          : '<div class="card empty-state"><div class="icon">❔</div><p class="title">No catalog match found</p><p class="message">Try searching manually or enter the item\'s details yourself.</p></div>'
        ) +
        (priceEstimate
          ? '<div class="card">' +
            '<div style="display:flex; justify-content:space-between;"><span style="font-size:13px; font-weight:500;">Estimated value</span><span style="font-size:11px; color:var(--text-secondary);">' + priceEstimate.sampleSize + ' sold comps</span></div>' +
            '<p style="font-size:26px; font-weight:600; margin:6px 0 2px;">' + fmtCurrencyLocal(priceEstimate.low) + '–' + fmtCurrencyLocal(priceEstimate.high) + '</p>' +
            '<p style="font-size:12px; color:var(--text-secondary); margin:0;">Median ' + fmtCurrencyLocal(priceEstimate.median) + ', as of today</p>' +
            (priceEstimate.sampleSize < DB.LOW_CONFIDENCE_THRESHOLD ? '<p style="font-size:11px; color:#a06b1f; margin-top:6px;">⚠️ Low confidence — small sample size</p>' : '') +
            renderSoldListingsToggle(priceEstimate, 'scan-result') +
            '</div>'
          : '') +
        (best
          ? '<div class="btn-row" style="margin-bottom:10px;"><button class="btn" id="add-inventory-btn">+ Add to my collection</button><button class="btn" id="add-wishlist-btn">♡ Wishlist</button></div>'
          : '') +
        '<button class="btn block" id="search-again-btn" style="border:none; color:var(--text-secondary); font-size:12px;">Not the right match? Search again</button>';

      const editBtn = document.getElementById('edit-tags-btn');
      if (editBtn) editBtn.addEventListener('click', openTagEditor);

      attachSoldListingsToggleHandler('scan-result');

      document.getElementById('add-inventory-btn')?.addEventListener('click', () => commitItem('inventory'));
      document.getElementById('add-wishlist-btn')?.addEventListener('click', () => commitItem('wishlist'));
      document.getElementById('search-again-btn').addEventListener('click', () => {
        openManualEntrySheet({ defaultDestination: 'inventory', initialCategory: category, frontBlob, onSaved: () => { app_returnToScan(); } });
      });
    }

    function openTagEditor() {
      openSheet(
        '<div class="sheet-header"><h2>Edit tags</h2><button id="sheet-close">Cancel</button></div>' +
        '<p style="font-size:12px; color:var(--text-secondary); margin-bottom:12px;">These were guessed from the catalog match — fix anything that\'s wrong or missing.</p>' +
        '<div class="field"><label>Character(s) — comma separated</label><input id="tag-characters" value="' + (editableTags.characters || []).join(', ') + '"></div>' +
        '<div class="field"><label>Movie or franchise</label><input id="tag-movie" value="' + (editableTags.movie || '') + '"></div>' +
        '<div class="field"><label>Holiday or season</label><input id="tag-holiday" value="' + (editableTags.holiday || '') + '"></div>' +
        '<div class="field"><label>Park</label><input id="tag-park" value="' + (editableTags.park || '') + '"></div>' +
        '<div class="field"><label>Attraction</label><input id="tag-attraction" value="' + (editableTags.attraction || '') + '"></div>' +
        '<button class="btn block primary" id="tag-save-btn">Done</button>',
        () => {
          document.getElementById('sheet-close').addEventListener('click', closeSheet);
          document.getElementById('tag-save-btn').addEventListener('click', () => {
            editableTags = {
              characters: document.getElementById('tag-characters').value.split(',').map(s => s.trim()).filter(Boolean),
              movie: document.getElementById('tag-movie').value || null,
              holiday: document.getElementById('tag-holiday').value || null,
              park: document.getElementById('tag-park').value || null,
              attraction: document.getElementById('tag-attraction').value || null
            };
            closeSheet();
            draw();
          });
        }
      );
    }

    async function commitItem(destination) {
      const photoKey = await Photos.savePhoto(frontBlob);
      const item = DB.newItem({
        category,
        name: best.name,
        series: best.series,
        itemIdentifier: best.itemIdentifier || detectedIdentifier,
        releaseYear: best.releaseYear,
        matchSource: detectedIdentifier ? 'trader_number' : 'image_match',
        matchConfidence: best.confidence,
        userImagePhotoBlobKey: photoKey,
        characters: editableTags.characters || [],
        movie: editableTags.movie || null,
        holiday: editableTags.holiday || null,
        park: editableTags.park || null,
        attraction: editableTags.attraction || null
      });
      await DB.saveItem(item);

      if (priceEstimate) {
        await DB.savePriceSnapshot(DB.newPriceSnapshot(item.id, {
          estimatedValueLow: priceEstimate.low, estimatedValueHigh: priceEstimate.high,
          estimatedValueMedian: priceEstimate.median, sampleSize: priceEstimate.sampleSize,
          listings: priceEstimate.listings || [], source: priceEstimate.source || null
        }));
      }

      if (destination === 'inventory') {
        const entry = DB.newInventoryEntry(item.id, {
          currentEstimatedValue: priceEstimate ? priceEstimate.median : null,
          lastValueCheck: priceEstimate ? Date.now() : null
        });
        await DB.saveInventoryEntry(entry);
      } else {
        const wish = DB.newWishlistEntry(item.id, { lastKnownMarketLow: priceEstimate ? priceEstimate.low : null });
        await DB.saveWishlistEntry(wish);
      }

      app_returnToScan();
      showToast('Added to ' + (destination === 'inventory' ? 'your collection' : 'wishlist'));
    }

    draw();
  }

  function app_returnToScan() {
    state.activeTab = 'collection';
    state.collectionSegment = 'inventory';
    render();
  }

  function escapeHtmlLocal(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
  function fmtCurrencyLocal(v) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0);
  }

  // MARK: - Manual entry (also used by Wishlist's "+ Add" button)

  function openManualEntrySheet(opts) {
    opts = opts || {};
    const destination = opts.defaultDestination || 'inventory';
    const initialCategory = opts.initialCategory || 'pin';

    openSheet(
      '<div class="sheet-header"><h2>Enter details</h2><button id="sheet-close">Cancel</button></div>' +
      '<div class="field"><label>Category</label><select id="me-category">' +
      Object.entries(DB.CATEGORIES).map(([k, c]) => '<option value="' + k + '" ' + (k === initialCategory ? 'selected' : '') + '>' + c.icon + ' ' + c.label + '</option>').join('') +
      '</select></div>' +
      '<div class="field"><label>Name</label><input id="me-name"></div>' +
      '<div class="field"><label>Series or event</label><input id="me-series"></div>' +
      '<div class="field"><label id="me-identifier-label">Identifier (optional)</label><input id="me-identifier"></div>' +
      '<div class="field"><label>Release year</label><input id="me-year" type="number"></div>' +
      '<div class="field"><label>Character(s) — comma separated</label><input id="me-characters"></div>' +
      '<div class="field"><label>Movie or franchise</label><input id="me-movie"></div>' +
      '<div class="field"><label>Holiday or season</label><input id="me-holiday"></div>' +
      '<div class="field"><label>Limited edition size</label><input id="me-edition" type="number"></div>' +
      '<div class="field"><label>Park</label><input id="me-park"></div>' +
      '<div class="field"><label>Attraction</label><input id="me-attraction"></div>' +
      '<div class="field"><label>Notes</label><input id="me-notes"></div>' +
      (destination === 'inventory'
        ? '<div class="field"><label>Price paid</label><input id="me-price" type="number"></div>'
        : '') +
      '<button class="btn block primary" id="me-save-btn">Save</button>',
      () => {
        document.getElementById('sheet-close').addEventListener('click', closeSheet);
        const catSelect = document.getElementById('me-category');
        const idLabel = document.getElementById('me-identifier-label');
        idLabel.textContent = DB.CATEGORIES[catSelect.value].identifierLabel + ' (optional)';
        catSelect.addEventListener('change', () => {
          idLabel.textContent = DB.CATEGORIES[catSelect.value].identifierLabel + ' (optional)';
        });

        document.getElementById('me-save-btn').addEventListener('click', async () => {
          const name = document.getElementById('me-name').value.trim();
          if (!name) { showToast('Name is required'); return; }

          let photoKey = null;
          if (opts.frontBlob) photoKey = await Photos.savePhoto(opts.frontBlob);

          const item = DB.newItem({
            category: catSelect.value,
            name,
            series: document.getElementById('me-series').value || null,
            itemIdentifier: document.getElementById('me-identifier').value || null,
            releaseYear: parseInt(document.getElementById('me-year').value) || null,
            matchSource: 'manual',
            userImagePhotoBlobKey: photoKey,
            characters: document.getElementById('me-characters').value.split(',').map(s => s.trim()).filter(Boolean),
            movie: document.getElementById('me-movie').value || null,
            holiday: document.getElementById('me-holiday').value || null,
            editionSize: parseInt(document.getElementById('me-edition').value) || null,
            park: document.getElementById('me-park').value || null,
            attraction: document.getElementById('me-attraction').value || null,
            notes: document.getElementById('me-notes').value || null
          });
          await DB.saveItem(item);

          if (destination === 'inventory') {
            const entry = DB.newInventoryEntry(item.id, { purchasePrice: parseFloat(document.getElementById('me-price')?.value) || null });
            await DB.saveInventoryEntry(entry);
          } else {
            await DB.saveWishlistEntry(DB.newWishlistEntry(item.id));
          }

          closeSheet();
          showToast('Saved');
          if (opts.onSaved) opts.onSaved();
        });
      }
    );
  }

  return { renderCaptureScreen, openManualEntrySheet };
})();
