// photos.js — stores captured/selected photos as Blobs in their own
// IndexedDB store, referenced by key from CollectibleItem.userImagePhotoBlobKey.
// Keeping blobs out of the main 'items' store avoids bloating every
// items.getAll() call with image data when most views only need metadata.

const PHOTO_DB_NAME = 'pin-valuator-photos';
const PHOTO_DB_VERSION = 1;
let photoDbInstance = null;

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

async function savePhoto(blob) {
  const db = await openPhotoDB();
  const key = DB.uuid();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['photos'], 'readwrite');
    tx.objectStore('photos').put(blob, key);
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

window.Photos = { savePhoto, loadPhoto, loadPhotoURL, deletePhoto };
