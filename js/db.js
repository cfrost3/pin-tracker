// db.js — IndexedDB persistence layer.
//
// Mirrors the SwiftData model from the native version: CollectibleItem,
// InventoryEntry, WishlistEntry, Transaction, PriceHistorySnapshot. Each is
// its own object store, linked by itemId rather than SwiftData relationships
// — IndexedDB has no native relationship/cascade-delete concept, so cascade
// behavior (e.g. deleting an item's history when the item is deleted) is
// implemented manually in the delete functions below.
//
// COLLECTIONS: every item belongs to a "collection" — your own (read-write)
// or one imported from a friend (read-only). Inventory/wishlist/
// transactions/price-history don't carry their own collectionId; they
// inherit it through whichever item they're linked to, since duplicating
// it onto every store would just be redundant denormalization with no
// benefit here (we always have the item in hand before we need to know
// which collection something belongs to).

const DB_NAME = 'pin-valuator';
const DB_VERSION = 2;
const OWN_COLLECTION_ID = 'own';

let dbInstance = null;

function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const oldVersion = event.oldVersion;
      const tx = event.target.transaction;

      if (oldVersion < 1) {
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
      }

      if (oldVersion < 2) {
        // New in v2: collections store, plus a collectionId index on items
        // so we can query "everything in collection X" efficiently rather
        // than loading every item and filtering in JS.
        const collections = db.createObjectStore('collections', { keyPath: 'id' });
        collections.createIndex('isOwn', 'isOwn');

        const items = tx.objectStore('items');
        items.createIndex('collectionId', 'collectionId');

        // Migration: anyone upgrading from v1 has items with no
        // collectionId at all. Tag every existing item as belonging to
        // the default "own" collection so nothing they already added
        // disappears or becomes orphaned after this upgrade.
        const cursorRequest = items.openCursor();
        cursorRequest.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const record = cursor.value;
            if (!record.collectionId) {
              record.collectionId = OWN_COLLECTION_ID;
              cursor.update(record);
            }
            cursor.continue();
          }
        };

        collections.transaction.oncomplete = () => {};
        collections.put({
          id: OWN_COLLECTION_ID,
          name: 'My Collection',
          isOwn: true,
          importedAt: null
        });
      }
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
    collectionId: OWN_COLLECTION_ID,
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

async function getItemsByCollection(collectionId) {
  return getByIndex('items', 'collectionId', collectionId);
}

// MARK: - Collections

/// A collection is either your own (editable) or one imported from a
/// friend's exported file (read-only, viewable for comparison). Inventory,
/// wishlist, transaction, and price-history records aren't tagged with a
/// collectionId directly — they inherit it from whichever item they
/// reference, since every call site that needs to know "which collection"
/// already has the item in hand.
function newCollection(overrides = {}) {
  return {
    id: uuid(),
    name: 'Imported collection',
    isOwn: false,
    importedAt: Date.now(),
    ...overrides
  };
}

async function saveCollection(collection) {
  return put('collections', collection);
}

async function getAllCollections() {
  return getAll('collections');
}

async function getCollection(id) {
  const db = await openDB();
  const store = tx(db, ['collections'], 'readonly').objectStore('collections');
  return promisifyRequest(store.get(id));
}

/// Deletes an imported collection and every item/inventory/wishlist/
/// transaction/price-history record that belongs to it, plus their
/// photos. Refuses to delete the owner's own collection — that's not a
/// supported action from this function (there's nothing to "remove" your
/// own collection into; clearing it would mean deleting records
/// individually, which the existing per-item delete already supports).
async function deleteCollectionCascade(collectionId) {
  if (collectionId === OWN_COLLECTION_ID) {
    throw new Error('Cannot delete your own collection.');
  }
  const items = await getItemsByCollection(collectionId);
  for (const item of items) {
    await deleteItemCascade(item.id);
    if (item.userImagePhotoBlobKey) {
      await Photos.deletePhoto(item.userImagePhotoBlobKey);
    }
  }
  await deleteRecord('collections', collectionId);
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

/// Inventory entries don't carry collectionId directly (see note at top of
/// file), so this joins through items first to find which inventory
/// entries belong to the given collection.
async function getInventoryEntriesByCollection(collectionId) {
  const items = await getItemsByCollection(collectionId);
  const itemIds = new Set(items.map(i => i.id));
  const all = await getAllInventoryEntries();
  return all.filter(e => itemIds.has(e.itemId));
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

async function getWishlistEntriesByCollection(collectionId) {
  const items = await getItemsByCollection(collectionId);
  const itemIds = new Set(items.map(i => i.id));
  const all = await getAllWishlistEntries();
  return all.filter(e => itemIds.has(e.itemId));
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
  OWN_COLLECTION_ID,
  newItem, saveItem, getItem, getAllItems, getItemsByCollection, deleteItemCascade,
  newCollection, saveCollection, getAllCollections, getCollection, deleteCollectionCascade,
  newInventoryEntry, saveInventoryEntry, getAllInventoryEntries, getInventoryEntriesByCollection, deleteInventoryEntry, percentChange,
  newWishlistEntry, saveWishlistEntry, getAllWishlistEntries, getWishlistEntriesByCollection, deleteWishlistEntry, isBelowTarget,
  newTransaction, saveTransaction, getAllTransactions,
  newPriceSnapshot, savePriceSnapshot, getPriceHistoryForItem, isLowConfidence,
  LOW_CONFIDENCE_THRESHOLD,
  uuid
};
