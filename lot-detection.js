// ocr.js — in-browser OCR via Tesseract.js (loaded from CDN), since there's
// no on-device Vision-framework equivalent in a browser. This is slower and
// less accurate than Apple's native OCR, and only worth it for the narrow
// trader-number-style task (a handful of digits), not general text.

const OCR = (() => {
  let tesseractLoaded = false;

  async function ensureTesseract() {
    if (tesseractLoaded) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    tesseractLoaded = true;
  }

  async function recognizeIdentifier(blob) {
    try {
      await ensureTesseract();
      const result = await Tesseract.recognize(blob, 'eng');
      const text = result.data.text || '';
      const match = text.match(/\b\d{4,6}\b/);
      return match ? match[0] : null;
    } catch (err) {
      console.warn('OCR failed or unavailable:', err);
      return null;
    }
  }

  return { recognizeIdentifier };
})();
