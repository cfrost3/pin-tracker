// identify-pipeline.js — the headless OCR -> match -> price pipeline,
// factored out so both the single-item scan flow (scan.js) and the
// multi-pin lot scan flow (lot-scan.js) call the exact same logic rather
// than maintaining two copies that could drift apart.
//
// This module has no UI of its own — callers render their own progress
// indicators and call onStep(key) to mark steps complete as they happen.

const IdentifyPipeline = (() => {
  /// Runs OCR (if applicable) + image match + price lookup for a single
  /// front/back photo pair. Returns the same shape used by the single-item
  /// results screen, so both flows can share rendering logic too if wanted.
  ///
  /// onStep(key) is called with 'ocr', 'match', then 'price' as each
  /// finishes — used to drive progress UI without this module knowing
  /// anything about DOM structure.
  async function identify({ category, frontBlob, backBlob, vocabulary, onStep }) {
    const cat = DB.CATEGORIES[category];
    let detectedIdentifier = null;

    if (cat.usesOCR && backBlob) {
      detectedIdentifier = await OCR.recognizeIdentifier(backBlob);
      if (onStep) onStep('ocr');
    }

    let matches = [];
    let errorMessage = null;
    try {
      if (detectedIdentifier) {
        matches = [{
          name: 'Matched via ' + cat.identifierLabel.toLowerCase(),
          series: null, releaseYear: null, itemIdentifier: detectedIdentifier,
          confidence: 0.98, extractedTags: {}
        }];
      } else {
        matches = await ImageMatchService.search(frontBlob, vocabulary);
      }
    } catch (err) {
      errorMessage = err.message || "Couldn't find a catalog match.";
    }
    if (onStep) onStep('match');

    let priceEstimate = null;
    if (matches.length > 0) {
      try {
        const tempItem = DB.newItem({
          category,
          name: matches[0].name,
          series: matches[0].series,
          itemIdentifier: matches[0].itemIdentifier || detectedIdentifier
        });
        priceEstimate = await PriceService.estimateValue(tempItem);
      } catch (err) {
        // Leave priceEstimate null — caller shows "no comps found".
      }
    }
    if (onStep) onStep('price');

    return { matches, priceEstimate, detectedIdentifier, errorMessage };
  }

  return { identify };
})();
