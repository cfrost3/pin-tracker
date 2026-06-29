// photos.js — stores captured/selected photos as Blobs in their own
// IndexedDB store, referenced by key from CollectibleItem.userImagePhotoBlobKey.
// Keeping blobs out of the main 'items' store avoids bloating every
// items.getAll() call with image data when most views only need metadata.
//
// LOW-RESOLUTION STORAGE: every photo is downscaled before it's ever
// written to IndexedDB — there's no value in keeping a pin photo at full
// camera resolution (often 3000px+ wide) when the app only ever displays
// it as a small thumbnail or a modest detail-view image. Resizing at save
// time, once, keeps the on-device storage footprint small permanently,
// rather than relying on cleanup later. A typical multi-megabyte camera
// photo becomes roughly 10-30KB at these settings.

const PHOTO_DB_NAME = 'pin-valuator-photos';
const PHOTO_DB_VERSION = 1;
let photoDbInstance = null;

/// Longest edge a stored photo is allowed to be, in pixels. 240px is
/// comfortably more than enough for the thumbnails and detail-view images
/// this app ever renders (the largest is the ~84px detail header
/// thumbnail, displayed at up to roughly 2x for retina screens) — going
/// any higher just spends storage for resolution the UI never shows.
const MAX_STORED_DIMENSION = 240;
const STORED_JPEG_QUALITY = 0.7;

function openPhotoDB() {
  if (photoDbInstance) return Promise.resolve(photoDbInstance);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PHOTO_DB_NAME, PHOTO_DB_VERSION);
    request.onupgradeneeded = (event) => {
      event.target.result.createObjectStore('photos');
    };
    request.onsuccess = (event) => {
      photoDbInstance = event.target.result;
      resolve(photoDbInstance);
    };
    request.onerror = () => reject(request.error);
  });
}

/// Downscales a blob so its longest edge is at most MAX_STORED_DIMENSION,
/// re-encoding as JPEG at STORED_JPEG_QUALITY. If the source is already
/// smaller than the target (e.g. a synthetic test image, or a photo
/// picked from an already-small file), it's left at its original size —
/// this only ever shrinks, never upscales.
async function resizeForStorage(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const longestEdge = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, MAX_STORED_DIMENSION / longestEdge);
    const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
    const targetHeight = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, targetWidth, targetHeight);

    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (resizedBlob) => resizedBlob ? resolve(resizedBlob) : reject(new Error('Failed to encode resized photo')),
        'image/jpeg',
        STORED_JPEG_QUALITY
      );
    });
  } finally {
    bitmap.close();
  }
}

/// Resizes then stores a photo. Resize failures (e.g. an unsupported or
/// corrupt image) fall back to storing the original blob rather than
/// losing the photo entirely — better to keep a full-size image than no
/// image at all.
async function savePhoto(blob) {
  let toStore = blob;
  try {
    toStore = await resizeForStorage(blob);
  } catch (err) {
    console.warn('Photo resize failed, storing original:', err);
  }

  const db = await openPhotoDB();
  const key = DB.uuid();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['photos'], 'readwrite');
    tx.objectStore('photos').put(toStore, key);
    tx.oncomplete = () => resolve(key);
    tx.onerror = () => reject(tx.error);
  });
}

async function loadPhoto(key) {
  if (!key) return null;
  const db = await openPhotoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['photos'], 'readonly');
    const request = tx.objectStore('photos').get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

/// Returns an object URL for a stored photo, suitable for an <img src>.
/// Caller is responsible for revoking it (URL.revokeObjectURL) when the
/// image is removed from the DOM, to avoid leaking memory over a long
/// session.
async function loadPhotoURL(key) {
  const blob = await loadPhoto(key);
  return blob ? URL.createObjectURL(blob) : null;
}

async function deletePhoto(key) {
  if (!key) return;
  const db = await openPhotoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['photos'], 'readwrite');
    tx.objectStore('photos').delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

window.Photos = { savePhoto, loadPhoto, loadPhotoURL, deletePhoto, MAX_STORED_DIMENSION, STORED_JPEG_QUALITY };
