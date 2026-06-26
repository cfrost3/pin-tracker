// db.js — IndexedDB persistence layer.
//
// Mirrors the SwiftData model from the native version: CollectibleItem,
// InventoryEntry, WishlistEntry, Transaction, PriceHistorySnapshot. Each is
// its own object store, linked by itemId rather than SwiftData relationships
// — IndexedDB has no native relationship/cascade-delete concept, so cascade
// behavior (e.g. deleting an item's history when the item is deleted) is
// implemented manually in the delete functions below.

const DB_NAME = 'pin-valuator';
const DB_VERSION = 1;

let dbInstance = null;

function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      const items = db.createObjectStore('items', { keyPath: 'id' });
      items.createIndex('category', 'category');

      const inventory = db.createObjectStore('inventory', { keyPath: 'id' });
      inventory.createIndex('itemId', 'itemId');
      inventory.createIndex('dateAcquired', 'dateAcquired');

      const wishlist = db.createObjectStore('wishlist', { keyPath: 'id' });
      wishlist.createIndex('itemId', 'itemId');

      const transactions = db.createObjectStore('transactions', { keyPath: 'id' });
      transactions.createIndex('itemId', 'itemId');
      transactions.createIndex('type', 'type');

      const priceHistory = db.createObjectStore('priceHistory', { keyPath: 'id' });
      priceHistory.createIndex('itemId', 'itemId');
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = () => reject(request.error);
  });
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function tx(db, storeNames, mode) {
  return db.transaction(storeNames, mode);
}

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// MARK: - Generic CRUD helpers

async function getAll(storeName) {
  const db = await openDB();
  const store = tx(db, [storeName], 'readonly').objectStore(storeName);
  return promisifyRequest(store.getAll());
}

async function getByIndex(storeName, indexName, value) {
  const db = await openDB();
  const store = tx(db, [storeName], 'readonly').objectStore(storeName);
  return promisifyRequest(store.index(indexName).getAll(value));
}

async function put(storeName, record) {
  const db = await openDB();
  const store = tx(db, [storeName], 'readwrite').objectStore(storeName);
  await promisifyRequest(store.put(record));
  return record;
}

async function deleteRecord(storeName, id) {
  const db = await openDB();
  const store = tx(db, [storeName], 'readwrite').objectStore(storeName);
  await promisifyRequest(store.delete(id));
}

// MARK: - CollectibleItem

const CATEGORIES = {
  pin: { label: 'Pin', pluralLabel: 'Pins', icon: '📌', identifierLabel: 'Trader number', usesOCR: true, ebayCategoryId: '2611', ebayKeyword: 'disney pin' },
  pinBag: { label: 'Pin bag', pluralLabel: 'Pin bags', icon: '👜', identifierLabel: 'Identifier', usesOCR: false, ebayCategoryId: '169291', ebayKeyword: 'disney pin trading bag' },
  art: { label: 'Art', pluralLabel: 'Art', icon: '🎨', identifierLabel: 'Edition number', usesOCR: false, ebayCategoryId: '550', ebayKeyword: 'disney convention art print' },
  toy: { label: 'Toy/figure', pluralLabel: 'Toys/figures', icon: '🧸', identifierLabel: 'Item/box number', usesOCR: false, ebayCategoryId: '220', ebayKeyword: 'disney convention exclusive figure' },
  apparel: { label: 'Apparel', pluralLabel: 'Apparel', icon: '👕', identifierLabel: 'Identifier', usesOCR: false, ebayCategoryId: '11450', ebayKeyword: 'disney convention exclusive apparel' },
  other: { label: 'Other', pluralLabel: 'Other', icon: '📦', identifierLabel: 'Identifier', usesOCR: false, ebayCategoryId: '1', ebayKeyword: 'disney convention exclusive' }
};

function newItem(overrides = {}) {
  return {
    id: uuid(),
    category: 'pin',
    name: '',
    series: null,
    itemIdentifier: null,
    releaseYear: null,
    userImagePhotoBlobKey: null, // key into the 'photos' IDB store, see photos.js
    referenceImageURL: null,
    dateAdded: Date.now(),
    notes: null,
    matchSource: null,
    matchConfidence: null,
    characters: [],
    movie: null,
    holiday: null,
    editionSize: null,
    park: null,
    attraction: null,
    ...overrides
  };
}

async function saveItem(item) {
  return put('items', item);
}

async function getItem(id) {
  const db = await openDB();
  const store = tx(db, ['items'], 'readonly').objectStore('items');
  return promisifyRequest(store.get(id));
}

async function getAllItems() {
  return getAll('items');
}

/// Deletes an item and cascades to every dependent record — IndexedDB has
/// no foreign-key cascade, so this is done by hand, mirroring the
/// `.cascade` delete rules from the SwiftData model.
async function deleteItemCascade(itemId) {
  const [invEntries, wishEntries, txEntries, historyEntries] = await Promise.all([
    getByIndex('inventory', 'itemId', itemId),
    getByIndex('wishlist', 'itemId', itemId),
    getByIndex('transactions', 'itemId', itemId),
    getByIndex('priceHistory', 'itemId', itemId)
  ]);
  await Promise.all([
    ...invEntries.map(e => deleteRecord('inventory', e.id)),
    ...wishEntries.map(e => deleteRecord('wishlist', e.id)),
    ...txEntries.map(e => deleteRecord('transactions', e.id)),
    ...historyEntries.map(e => deleteRecord('priceHistory', e.id))
  ]);
  await deleteRecord('items', itemId);
}

// MARK: - InventoryEntry

function newInventoryEntry(itemId, overrides = {}) {
  return {
    id: uuid(),
    itemId,
    dateAcquired: Date.now(),
    acquiredVia: 'bought', // bought | traded | gifted | parkPurchase
    purchasePrice: null,
    currentEstimatedValue: null,
    lastValueCheck: null,
    condition: 'mint', // mint | excellent | good | fair | damaged
    storageLocation: null,
    ...overrides
  };
}

async function saveInventoryEntry(entry) {
  return put('inventory', entry);
}

async function getAllInventoryEntries() {
  return getAll('inventory');
}

async function deleteInventoryEntry(id) {
  return deleteRecord('inventory', id);
}

function percentChange(entry) {
  if (!entry.purchasePrice || entry.purchasePrice <= 0 || entry.currentEstimatedValue == null) return null;
  return ((entry.currentEstimatedValue - entry.purchasePrice) / entry.purchasePrice) * 100;
}

// MARK: - WishlistEntry

function newWishlistEntry(itemId, overrides = {}) {
  return {
    id: uuid(),
    itemId,
    dateAdded: Date.now(),
    priority: 'medium', // low | medium | high
    maxPriceWillingToPay: null,
    notifyOnPriceMatch: true,
    lastKnownMarketLow: null,
    ...overrides
  };
}

async function saveWishlistEntry(entry) {
  return put('wishlist', entry);
}

async function getAllWishlistEntries() {
  return getAll('wishlist');
}

async function deleteWishlistEntry(id) {
  return deleteRecord('wishlist', id);
}

function isBelowTarget(entry) {
  if (entry.lastKnownMarketLow == null || entry.maxPriceWillingToPay == null) return false;
  return entry.lastKnownMarketLow <= entry.maxPriceWillingToPay;
}

// MARK: - Transaction

function newTransaction(itemId, overrides = {}) {
  return {
    id: uuid(),
    itemId,
    type: 'sold', // bought | sold
    date: Date.now(),
    price: 0,
    platform: null,
    counterparty: null,
    profitLoss: null,
    ...overrides
  };
}

async function saveTransaction(transaction) {
  return put('transactions', transaction);
}

async function getAllTransactions() {
  return getAll('transactions');
}

// MARK: - PriceHistorySnapshot

const LOW_CONFIDENCE_THRESHOLD = 5;

function newPriceSnapshot(itemId, overrides = {}) {
  return {
    id: uuid(),
    itemId,
    date: Date.now(),
    estimatedValueLow: 0,
    estimatedValueHigh: 0,
    estimatedValueMedian: 0,
    sampleSize: 0,
    ...overrides
  };
}

async function savePriceSnapshot(snapshot) {
  return put('priceHistory', snapshot);
}

async function getPriceHistoryForItem(itemId) {
  const entries = await getByIndex('priceHistory', 'itemId', itemId);
  return entries.sort((a, b) => a.date - b.date);
}

function isLowConfidence(snapshot) {
  return snapshot.sampleSize < LOW_CONFIDENCE_THRESHOLD;
}

// Exported as a single namespace object — avoids polluting global scope
// while keeping call sites readable (DB.saveItem(...) etc).
window.DB = {
  openDB,
  CATEGORIES,
  newItem, saveItem, getItem, getAllItems, deleteItemCascade,
  newInventoryEntry, saveInventoryEntry, getAllInventoryEntries, deleteInventoryEntry, percentChange,
  newWishlistEntry, saveWishlistEntry, getAllWishlistEntries, deleteWishlistEntry, isBelowTarget,
  newTransaction, saveTransaction, getAllTransactions,
  newPriceSnapshot, savePriceSnapshot, getPriceHistoryForItem, isLowConfidence,
  LOW_CONFIDENCE_THRESHOLD,
  uuid
};
