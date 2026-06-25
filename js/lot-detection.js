// lot-detection.js — fully client-side detection of multiple pins in a
// single photo, using a contrast-threshold + connected-components
// approach rather than a cloud vision call (kept free/offline/fast, at
// the cost of accuracy on busy or overlapping layouts).
//
// HOW IT WORKS
// 1. Downscale the image for speed (detection doesn't need full resolution).
// 2. Convert to grayscale and estimate the background brightness from the
//    image's border pixels (assumes pins are laid on a roughly uniform
//    background — a tray, paper, binder page — which is the realistic
//    case for "photo of a pin lot").
// 3. Threshold: any pixel sufficiently different from the background is
//    "foreground" (part of a pin).
// 4. Flood-fill connected components over the foreground mask to find
//    distinct blobs, then compute each blob's bounding box.
// 5. Filter out blobs that are too small (noise/dust) or too large
//    (likely the whole background got flagged, e.g. bad lighting).
//
// LIMITATIONS — surfaced directly to the user rather than hidden:
// - Pins that touch or overlap will merge into a single detected blob.
// - A cluttered or low-contrast background will under- or over-detect.
// - This is a starting point for the user to correct, not a final answer.

const LotDetection = (() => {
  const WORK_WIDTH = 800; // detection resolution; final crops are re-extracted from the full-res image

  async function detectPins(imageBitmap) {
    const scale = WORK_WIDTH / imageBitmap.width;
    const workWidth = WORK_WIDTH;
    const workHeight = Math.round(imageBitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = workWidth;
    canvas.height = workHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imageBitmap, 0, 0, workWidth, workHeight);

    const imageData = ctx.getImageData(0, 0, workWidth, workHeight);
    const gray = toGrayscale(imageData, workWidth, workHeight);
    const background = estimateBackground(gray, workWidth, workHeight);
    const mask = threshold(gray, workWidth, workHeight, background);
    const blobs = connectedComponents(mask, workWidth, workHeight);

    const minArea = workWidth * workHeight * 0.0015; // ignore specks
    const maxArea = workWidth * workHeight * 0.5;     // ignore "whole image is one blob"

    return blobs
      .filter(b => {
        const area = (b.maxX - b.minX) * (b.maxY - b.minY);
        return area >= minArea && area <= maxArea;
      })
      .map(b => ({
        // Scale bounding boxes back up to original image coordinates, with
        // a small padding margin so crops aren't razor-tight against the
        // pin's edge (trader-number OCR especially benefits from a little
        // breathing room).
        x: Math.max(0, b.minX / scale - 8),
        y: Math.max(0, b.minY / scale - 8),
        width: Math.min(imageBitmap.width, (b.maxX - b.minX) / scale + 16),
        height: Math.min(imageBitmap.height, (b.maxY - b.minY) / scale + 16)
      }))
      .sort((a, b) => (a.y - b.y) || (a.x - b.x)); // rough reading order: top-to-bottom, left-to-right
  }

  function toGrayscale(imageData, w, h) {
    const out = new Float32Array(w * h);
    const d = imageData.data;
    for (let i = 0; i < w * h; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      out[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    return out;
  }

  /// Samples a border strip around the image edge and takes the median —
  /// robust to a stray pin corner poking into the sampled border, unlike a
  /// mean which a single outlier pixel run could skew.
  function estimateBackground(gray, w, h) {
    const samples = [];
    const margin = Math.round(Math.min(w, h) * 0.04);
    for (let x = 0; x < w; x += 4) {
      samples.push(gray[x]);
      samples.push(gray[(h - 1) * w + x]);
    }
    for (let y = 0; y < h; y += 4) {
      samples.push(gray[y * w]);
      samples.push(gray[y * w + (w - 1)]);
    }
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)];
  }

  function threshold(gray, w, h, background) {
    const mask = new Uint8Array(w * h);
    const cutoff = 28; // brightness delta from background to count as foreground
    for (let i = 0; i < w * h; i++) {
      mask[i] = Math.abs(gray[i] - background) > cutoff ? 1 : 0;
    }
    return mask;
  }

  /// Iterative (stack-based, not recursive — avoids call-stack overflow on
  /// large blobs) flood fill over the binary mask to find connected
  /// foreground regions and their bounding boxes.
  function connectedComponents(mask, w, h) {
    const visited = new Uint8Array(w * h);
    const blobs = [];

    for (let start = 0; start < w * h; start++) {
      if (mask[start] === 0 || visited[start]) continue;

      let minX = w, minY = h, maxX = 0, maxY = 0;
      const stack = [start];
      visited[start] = 1;

      while (stack.length) {
        const idx = stack.pop();
        const x = idx % w, y = Math.floor(idx / w);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        const neighbors = [idx - 1, idx + 1, idx - w, idx + w];
        for (const n of neighbors) {
          if (n < 0 || n >= w * h || visited[n] || mask[n] === 0) continue;
          // Guard against wrap-around on row edges.
          const nx = n % w;
          if (Math.abs(nx - x) > 1) continue;
          visited[n] = 1;
          stack.push(n);
        }
      }

      blobs.push({ minX, minY, maxX, maxY });
    }

    return blobs;
  }

  /// Extracts a full-resolution crop from the original image for a given
  /// detected box — used once the user confirms boxes, so downstream OCR
  /// and image matching get full quality, not the downscaled detection copy.
  async function extractCrop(imageBitmap, box) {
    const canvas = document.createElement('canvas');
    canvas.width = box.width;
    canvas.height = box.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imageBitmap, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  }

  return { detectPins, extractCrop };
})();
