// lot-scan.js — "photo of a pile of pins" flow: capture one photo,
// auto-detect individual pins via LotDetection, let the user fix up the
// boxes (resize/delete/add), then run each crop through the same
// IdentifyPipeline used for single-item scans, and show a combined value
// for the whole lot plus a per-pin breakdown.

const LotScan = (() => {
  let mediaStream = null;
  let lotCategory = 'pin';
  let sourceImageBitmap = null; // full-resolution source, kept for re-cropping
  let boxes = []; // [{ id, x, y, width, height }]

  // MARK: - Capture

  async function renderLotCaptureScreen(container) {
    container.innerHTML =
      '<div class="card" style="font-size:12px; color:var(--text-secondary); margin-bottom:12px;">' +
      'Lay your pins out separately on a plain background (a tray, paper, or binder page works well) and photograph the whole group. ' +
      "Pins that touch or overlap may be detected as one — you'll get a chance to fix that next." +
      '</div>' +
      '<div class="chip-row" id="lot-category-chips">' +
      Object.entries(DB.CATEGORIES).map(([key, cat]) =>
        '<button class="chip ' + (lotCategory === key ? 'active' : '') + '" data-cat="' + key + '">' + cat.icon + ' ' + cat.label + '</button>'
      ).join('') +
      '</div>' +
      '<div class="camera-frame" id="lot-camera-frame">' +
      '<video id="lot-camera-video" autoplay playsinline muted></video>' +
      '<span class="label-pill bottom-center">Fit the whole group in frame</span>' +
      '</div>' +
      '<div class="shutter-row">' +
      '<button class="icon-btn" id="lot-upload-btn">🖼️</button>' +
      '<button class="shutter-btn" id="lot-shutter-btn"></button>' +
      '<span style="width:22px;"></span>' +
      '</div>' +
      '<input type="file" id="lot-file-input" accept="image/*" style="display:none;">';

    document.querySelectorAll('#lot-category-chips .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        lotCategory = chip.dataset.cat;
        renderLotCaptureScreen(container);
      });
    });

    await startCamera();

    document.getElementById('lot-shutter-btn').addEventListener('click', () => captureLotPhoto(container));
    document.getElementById('lot-upload-btn').addEventListener('click', () => document.getElementById('lot-file-input').click());
    document.getElementById('lot-file-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleLotBlob(file, container);
    });
  }

  async function startCamera() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1920 } },
        audio: false
      });
      const freshVideo = document.getElementById('lot-camera-video');
      if (freshVideo) freshVideo.srcObject = mediaStream;
    } catch (err) {
      const frame = document.getElementById('lot-camera-frame');
      if (frame) {
        frame.innerHTML =
          '<div style="display:flex; align-items:center; justify-content:center; height:100%; color:#aaa; font-size:12px; text-align:center; padding:20px;">' +
          'Camera unavailable. Use the photo picker below instead.</div>';
      }
    }
  }

  function stopStream() {
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }
  }

  function captureLotPhoto(container) {
    const video = document.getElementById('lot-camera-video');
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob((blob) => handleLotBlob(blob, container), 'image/jpeg', 0.9);
  }

  async function handleLotBlob(blob, container) {
    stopStream();
    sourceImageBitmap = await createImageBitmap(blob);
    await renderDetectingScreen(container);
  }

  // MARK: - Detection

  async function renderDetectingScreen(container) {
    container.innerHTML =
      '<p style="text-align:center; font-size:13px; color:var(--text-secondary); margin-top:60px;">Finding individual pins…</p>';

    const detected = await LotDetection.detectPins(sourceImageBitmap);
    boxes = detected.map((box, i) => Object.assign({ id: 'box-' + i }, box));

    if (boxes.length === 0) {
      // Detection found nothing usable — most likely a low-contrast
      // background. Give the user one starting box covering most of the
      // photo so they have something to work with rather than a dead end.
      boxes = [{
        id: 'box-0',
        x: sourceImageBitmap.width * 0.1,
        y: sourceImageBitmap.height * 0.1,
        width: sourceImageBitmap.width * 0.8,
        height: sourceImageBitmap.height * 0.8
      }];
    }

    renderBoxReviewScreen(container);
  }

  // MARK: - Box review / adjustment

  function renderBoxReviewScreen(container) {
    if (!sourceImageBitmap._cachedUrl) {
      sourceImageBitmap._cachedUrl = bitmapToDataUrl(sourceImageBitmap);
    }
    const imgUrl = sourceImageBitmap._cachedUrl;

    container.innerHTML =
      '<div class="card" id="box-count-card" style="font-size:12px; color:var(--text-secondary); margin-bottom:10px;">' +
      boxCountText() +
      '</div>' +
      '<div id="review-stage" style="position:relative; width:100%; border-radius:16px; overflow:hidden; background:var(--ink); touch-action:none;">' +
      '<img id="review-image" src="" style="width:100%; display:block;">' +
      '<div id="box-layer" style="position:absolute; inset:0;"></div>' +
      '</div>' +
      '<div class="btn-row" style="margin-top:12px;">' +
      '<button class="btn" id="add-box-btn">+ Add box</button>' +
      '<button class="btn primary" id="confirm-boxes-btn">' + processButtonText() + '</button>' +
      '</div>' +
      '<button class="btn block" id="retake-btn" style="margin-top:10px; border:none; color:var(--text-secondary); font-size:12px;">Retake photo</button>';

    const img = document.getElementById('review-image');
    img.onload = () => drawBoxes();
    img.src = imgUrl;

    document.getElementById('add-box-btn').addEventListener('click', () => {
      const w = sourceImageBitmap.width * 0.15;
      const h = sourceImageBitmap.height * 0.15;
      boxes.push({
        id: 'box-' + Date.now(),
        x: sourceImageBitmap.width / 2 - w / 2,
        y: sourceImageBitmap.height / 2 - h / 2,
        width: w, height: h
      });
      drawBoxes();
      refreshCounts();
    });

    document.getElementById('confirm-boxes-btn').addEventListener('click', () => processLot(container));
    document.getElementById('retake-btn').addEventListener('click', () => {
      stopStream();
      renderLotCaptureScreen(container);
    });
  }

  function boxCountText() {
    return 'Found <strong>' + boxes.length + '</strong> item' + (boxes.length === 1 ? '' : 's') +
      '. Drag the corner dot to resize, tap the × to delete, or tap "+ Add box" for a missed pin.';
  }
  function processButtonText() {
    return 'Process ' + boxes.length + ' item' + (boxes.length === 1 ? '' : 's');
  }

  function bitmapToDataUrl(bitmap) {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  /// Renders each box as an absolutely-positioned overlay div with a
  /// delete tap-target and a drag handle in the bottom-right corner for
  /// resizing. Coordinates are stored in original-image pixel space and
  /// converted to percentages for display, so they stay correct regardless
  /// of how large the image renders on screen.
  function drawBoxes() {
    const layer = document.getElementById('box-layer');
    if (!layer) return;
    const iw = sourceImageBitmap.width, ih = sourceImageBitmap.height;

    layer.innerHTML = boxes.map(b => {
      const left = (b.x / iw) * 100, top = (b.y / ih) * 100;
      const w = (b.width / iw) * 100, h = (b.height / ih) * 100;
      return '<div class="lot-box" data-box-id="' + b.id + '" style="position:absolute; left:' + left + '%; top:' + top + '%; width:' + w + '%; height:' + h + '%; border:2px solid var(--brass); border-radius:6px; box-sizing:border-box;">' +
        '<button class="lot-box-delete" data-box-id="' + b.id + '" style="position:absolute; top:-10px; right:-10px; width:22px; height:22px; border-radius:50%; background:var(--enamel-red); color:white; border:none; font-size:13px; line-height:1;">×</button>' +
        '<div class="lot-box-handle" data-box-id="' + b.id + '" style="position:absolute; bottom:-7px; right:-7px; width:18px; height:18px; border-radius:50%; background:var(--brass); border:2px solid white;"></div>' +
        '</div>';
    }).join('');

    layer.querySelectorAll('.lot-box-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        boxes = boxes.filter(b => b.id !== btn.dataset.boxId);
        drawBoxes();
        refreshCounts();
      });
    });

    layer.querySelectorAll('.lot-box-handle').forEach(handle => {
      attachResizeDrag(handle, handle.dataset.boxId);
    });
  }

  function refreshCounts() {
    const card = document.getElementById('box-count-card');
    if (card) card.innerHTML = boxCountText();
    const confirmBtn = document.getElementById('confirm-boxes-btn');
    if (confirmBtn) confirmBtn.textContent = processButtonText();
  }

  /// Pointer-event-based drag handler for the resize handle. Pointer
  /// events (rather than separate mouse/touch listeners) work uniformly
  /// for mouse, touch, and stylus — important since this needs to work
  /// well on an iPhone touchscreen.
  function attachResizeDrag(handle, boxId) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const stage = document.getElementById('review-stage');
      const stageRect = stage.getBoundingClientRect();
      const box = boxes.find(b => b.id === boxId);
      if (!box) return;

      const iw = sourceImageBitmap.width, ih = sourceImageBitmap.height;

      function onMove(moveEvent) {
        const relX = (moveEvent.clientX - stageRect.left) / stageRect.width;
        const relY = (moveEvent.clientY - stageRect.top) / stageRect.height;
        box.width = Math.max(20, relX * iw - box.x);
        box.height = Math.max(20, relY * ih - box.y);
        drawBoxes();
      }
      function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  // MARK: - Per-pin processing

  async function processLot(container) {
    stopStream();
    const vocabulary = await PinTagExtractor.liveVocabulary();
    const results = []; // { box, cropBlob, cropUrl, matches, priceEstimate, detectedIdentifier, selected, editedName }

    container.innerHTML =
      '<p style="text-align:center; font-size:14px; font-weight:500; margin-bottom:14px;">Identifying ' + boxes.length + ' items…</p>' +
      '<div id="lot-progress-list"></div>';

    const progressList = document.getElementById('lot-progress-list');

    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      const rowEl = document.createElement('div');
      rowEl.className = 'processing-step';
      rowEl.innerHTML = '<span class="spinner"></span><span>Item ' + (i + 1) + ' of ' + boxes.length + '</span>';
      progressList.appendChild(rowEl);

      const cropBlob = await LotDetection.extractCrop(sourceImageBitmap, box);
      const cropUrl = URL.createObjectURL(cropBlob);

      let identifyResult;
      try {
        identifyResult = await IdentifyPipeline.identify({
          category: lotCategory, frontBlob: cropBlob, backBlob: null, vocabulary
        });
      } catch (err) {
        identifyResult = { matches: [], priceEstimate: null, detectedIdentifier: null, errorMessage: err.message };
      }

      const best = identifyResult.matches[0];
      results.push({
        box, cropBlob, cropUrl,
        matches: identifyResult.matches,
        priceEstimate: identifyResult.priceEstimate,
        detectedIdentifier: identifyResult.detectedIdentifier,
        selected: true,
        editedName: best ? best.name : ('Item ' + (i + 1))
      });

      rowEl.innerHTML = '<span class="check">✓</span><span>Item ' + (i + 1) + ' of ' + boxes.length +
        (best ? ' — ' + escapeHtmlLocal(best.name) : ' — no match') + '</span>';
    }

    renderLotSummary(container, results);
  }

  // MARK: - Summary

  function renderLotSummary(container, results) {
    function computeTotals() {
      const selected = results.filter(r => r.selected);
      return {
        low: selected.reduce((s, r) => s + (r.priceEstimate ? r.priceEstimate.low : 0), 0),
        high: selected.reduce((s, r) => s + (r.priceEstimate ? r.priceEstimate.high : 0), 0),
        median: selected.reduce((s, r) => s + (r.priceEstimate ? r.priceEstimate.median : 0), 0),
        unmatchedCount: selected.filter(r => !r.priceEstimate).length,
        selectedCount: selected.length
      };
    }

    function draw() {
      const totals = computeTotals();
      container.innerHTML =
        '<div class="card">' +
        '<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span style="font-size:13px; font-weight:500;">Estimated lot value</span><span style="font-size:11px; color:var(--text-secondary);">' + totals.selectedCount + ' of ' + results.length + ' items</span></div>' +
        '<p style="font-size:28px; font-weight:600; margin:4px 0 2px;">' + fmtCurrencyLocal(totals.low) + '–' + fmtCurrencyLocal(totals.high) + '</p>' +
        '<p style="font-size:12px; color:var(--text-secondary); margin:0;">Combined median ' + fmtCurrencyLocal(totals.median) + '</p>' +
        (totals.unmatchedCount > 0
          ? '<p style="font-size:11px; color:#a06b1f; margin-top:8px;">⚠️ ' + totals.unmatchedCount + ' item' + (totals.unmatchedCount === 1 ? '' : 's') + ' could not be priced and ' + (totals.unmatchedCount === 1 ? 'is' : 'are') + ' excluded from this total.</p>'
          : '') +
        '</div>' +
        '<p style="font-size:12px; color:var(--text-secondary); margin:14px 0 8px;">Tap a name to edit it, or uncheck items you don\'t want to keep.</p>' +
        '<div id="lot-item-list">' + results.map((r, i) => renderLotItemRow(r, i)).join('') + '</div>' +
        '<div class="btn-row" style="margin-top:14px;">' +
        '<button class="btn" id="lot-retake-btn">Retake photo</button>' +
        '<button class="btn primary" id="lot-add-all-btn">+ Add ' + totals.selectedCount + ' to my collection</button>' +
        '</div>';

      document.querySelectorAll('.lot-item-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
          results[parseInt(e.target.dataset.index)].selected = e.target.checked;
          draw();
        });
      });
      document.querySelectorAll('.lot-item-name-input').forEach(input => {
        input.addEventListener('input', (e) => {
          results[parseInt(e.target.dataset.index)].editedName = e.target.value;
        });
      });
      document.getElementById('lot-retake-btn').addEventListener('click', () => renderLotCaptureScreen(container));
      document.getElementById('lot-add-all-btn').addEventListener('click', () => commitLot(results));
    }

    draw();
  }

  function renderLotItemRow(r, index) {
    const idLabel = DB.CATEGORIES[lotCategory].identifierLabel;
    return '<div class="card" style="display:flex; align-items:center; gap:10px; padding:10px;">' +
      '<input type="checkbox" class="lot-item-checkbox" data-index="' + index + '" ' + (r.selected ? 'checked' : '') + ' style="width:18px; height:18px; flex-shrink:0;">' +
      '<img src="' + r.cropUrl + '" style="width:46px; height:46px; border-radius:8px; object-fit:cover; flex-shrink:0;">' +
      '<div style="flex:1; min-width:0;">' +
      '<input class="lot-item-name-input" data-index="' + index + '" value="' + escapeHtmlLocal(r.editedName) + '" style="border:none; background:none; font-size:13px; font-weight:500; width:100%; padding:2px 0;">' +
      '<p style="font-size:11px; color:var(--text-secondary); margin:0;">' +
      (r.detectedIdentifier ? idLabel + ' ' + escapeHtmlLocal(r.detectedIdentifier) : (r.matches[0] ? 'Image match' : 'No match found')) +
      '</p>' +
      '</div>' +
      '<span style="font-size:13px; font-weight:600; flex-shrink:0;">' + (r.priceEstimate ? fmtCurrencyLocal(r.priceEstimate.median) : '—') + '</span>' +
      '</div>';
  }

  async function commitLot(results) {
    const selected = results.filter(r => r.selected);
    let savedCount = 0;

    for (const r of selected) {
      const photoKey = await Photos.savePhoto(r.cropBlob);
      const best = r.matches[0];
      const item = DB.newItem({
        category: lotCategory,
        name: r.editedName,
        series: best ? best.series : null,
        itemIdentifier: (best ? best.itemIdentifier : null) || r.detectedIdentifier,
        matchSource: r.detectedIdentifier ? 'trader_number' : (best ? 'image_match' : 'manual'),
        matchConfidence: best ? best.confidence : null,
        userImagePhotoBlobKey: photoKey
      });
      await DB.saveItem(item);

      if (r.priceEstimate) {
        await DB.savePriceSnapshot(DB.newPriceSnapshot(item.id, {
          estimatedValueLow: r.priceEstimate.low,
          estimatedValueHigh: r.priceEstimate.high,
          estimatedValueMedian: r.priceEstimate.median,
          sampleSize: r.priceEstimate.sampleSize,
          listings: r.priceEstimate.listings || [],
          source: r.priceEstimate.source || null
        }));
      }

      await DB.saveInventoryEntry(DB.newInventoryEntry(item.id, {
        currentEstimatedValue: r.priceEstimate ? r.priceEstimate.median : null,
        lastValueCheck: r.priceEstimate ? Date.now() : null,
        notes: 'Added from a lot scan'
      }));

      savedCount++;
    }

    state.activeTab = 'collection';
    state.collectionSegment = 'inventory';
    render();
    showToast('Added ' + savedCount + ' item' + (savedCount === 1 ? '' : 's') + ' to your collection');
  }

  function escapeHtmlLocal(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
  function fmtCurrencyLocal(v) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0);
  }

  return { renderLotCaptureScreen };
})();
