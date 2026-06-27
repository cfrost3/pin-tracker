// export-import.js — packages the whole collection (items, inventory,
// wishlist, transactions, price history, and photos) into one JSON file
// someone else can open and browse, or you can use as a backup.
//
// FORMAT NOTES
// - Photos are embedded as base64 data URIs directly in the JSON rather
//   than as separate files. This keeps the export as a single
//   self-contained file (easier to share — one attachment, not a zip),
//   at the cost of a larger file size than a zip-with-separate-images
//   would produce. For a personal pin collection (dozens to low hundreds
//   of items), this tradeoff is the right one for "send a friend a file
//   they can open."
// - On import, every record gets a NEW id and items get re-linked by
//   those new ids — this avoids any possibility of an imported record
//   silently overwriting one of the receiving person's own records that
//   happens to share an id.
// - Wishlist items import as wishlist items, inventory items import as
//   inventory items — the export preserves which list each item was in
//   for the person who exported it.

const ExportImport = (() => {
  const FORMAT_VERSION = 1;

  // MARK: - Export

  async function buildExportPayload(ownerName) {
    const [allItems, allInventory, allWishlist, allTransactions] = await Promise.all([
      DB.getAllItems(),
      DB.getAllInventoryEntries(),
      DB.getAllWishlistEntries(),
      DB.getAllTransactions()
    ]);

    // Only export your OWN collection's data — if you've already imported
    // a friend's collection into this same app instance, re-exporting
    // should never re-bundle their data as if it were yours to share
    // onward.
    const items = allItems.filter(i => i.collectionId === DB.OWN_COLLECTION_ID || !i.collectionId);
    const ownItemIds = new Set(items.map(i => i.id));
    const inventory = allInventory.filter(e => ownItemIds.has(e.itemId));
    const wishlist = allWishlist.filter(e => ownItemIds.has(e.itemId));
    const transactions = allTransactions.filter(t => ownItemIds.has(t.itemId));

    const priceHistoryByItem = {};
    for (const item of items) {
      priceHistoryByItem[item.id] = await DB.getPriceHistoryForItem(item.id);
    }

    // Embed photos as base64 data URIs, keyed by the item's existing
    // photo-blob key so import can re-associate them after regenerating ids.
    const photosByKey = {};
    for (const item of items) {
      if (item.userImagePhotoBlobKey) {
        const blob = await Photos.loadPhoto(item.userImagePhotoBlobKey);
        if (blob) photosByKey[item.userImagePhotoBlobKey] = await blobToDataUri(blob);
      }
    }

    return {
      formatVersion: FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      ownerName: ownerName || null,
      appName: 'Pin Valuator',
      items,
      inventory,
      wishlist,
      transactions,
      priceHistoryByItem,
      photosByKey
    };
  }

  async function blobToDataUri(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function dataUriToBlob(dataUri) {
    const res = await fetch(dataUri);
    return res.blob();
  }

  /// Triggers a browser download of the export file. iOS Safari handles
  /// this via the system share/save sheet rather than a desktop-style
  /// downloads folder, which is the expected behavior for sharing the
  /// file via Messages, AirDrop, Files, email, etc.
  async function exportToFile(ownerName) {
    const payload = await buildExportPayload(ownerName);
    const json = JSON.stringify(payload, null, 0);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const safeName = (ownerName || 'my').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'my';
    const filename = 'pin-collection-' + safeName + '-' + new Date().toISOString().slice(0, 10) + '.json';
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    return { filename, itemCount: payload.items.length };
  }

  // MARK: - Import

  /// Parses and validates a selected file without writing anything yet —
  /// used to show the user a preview/summary before they confirm the
  /// import, since merging in someone else's whole collection is not an
  /// action you want to silently auto-commit.
  async function parseImportFile(file) {
    const text = await file.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (err) {
      throw new Error('This file is not valid JSON. Make sure you selected an exported Pin Valuator file.');
    }

    if (!payload || !Array.isArray(payload.items)) {
      throw new Error('This file doesn\'t look like a Pin Valuator export.');
    }
    if (payload.formatVersion > FORMAT_VERSION) {
      throw new Error('This file was exported from a newer version of the app and may not import correctly here.');
    }

    const inventoryCount = (payload.inventory || []).length;
    const wishlistCount = (payload.wishlist || []).length;
    const transactionCount = (payload.transactions || []).length;

    return {
      payload,
      summary: {
        itemCount: payload.items.length,
        inventoryCount,
        wishlistCount,
        transactionCount,
        exportedAt: payload.exportedAt
      }
    };
  }

  /// Creates a new, separate, read-only collection for the imported data
  /// and writes every record into it. Every record gets a fresh id; a
  /// lookup map translates old item ids to new ones so inventory/wishlist/
  /// transaction/price-history records stay correctly linked to their
  /// (renumbered) item after import. Nothing here ever touches the
  /// importer's own collection — this is intentionally additive and
  /// isolated, not a merge.
  async function commitImport(payload, collectionName) {
    const collection = DB.newCollection({
      name: collectionName || payload.ownerName || 'Imported collection',
      isOwn: false
    });
    await DB.saveCollection(collection);

    const oldIdToNewId = {};
    let importedItems = 0, importedInventory = 0, importedWishlist = 0, importedTransactions = 0, importedSnapshots = 0;

    for (const oldItem of payload.items) {
      const newId = DB.uuid();
      oldIdToNewId[oldItem.id] = newId;

      let newPhotoKey = null;
      if (oldItem.userImagePhotoBlobKey && payload.photosByKey && payload.photosByKey[oldItem.userImagePhotoBlobKey]) {
        const blob = await dataUriToBlob(payload.photosByKey[oldItem.userImagePhotoBlobKey]);
        newPhotoKey = await Photos.savePhoto(blob);
      }

      const newItem = { ...oldItem, id: newId, collectionId: collection.id, userImagePhotoBlobKey: newPhotoKey };
      await DB.saveItem(newItem);
      importedItems++;
    }

    for (const entry of payload.inventory || []) {
      const newItemId = oldIdToNewId[entry.itemId];
      if (!newItemId) continue; // orphaned reference in a malformed file — skip rather than crash
      await DB.saveInventoryEntry({ ...entry, id: DB.uuid(), itemId: newItemId });
      importedInventory++;
    }

    for (const entry of payload.wishlist || []) {
      const newItemId = oldIdToNewId[entry.itemId];
      if (!newItemId) continue;
      await DB.saveWishlistEntry({ ...entry, id: DB.uuid(), itemId: newItemId });
      importedWishlist++;
    }

    for (const tx of payload.transactions || []) {
      const newItemId = oldIdToNewId[tx.itemId];
      if (!newItemId) continue;
      await DB.saveTransaction({ ...tx, id: DB.uuid(), itemId: newItemId });
      importedTransactions++;
    }

    const historyMap = payload.priceHistoryByItem || {};
    for (const [oldItemId, snapshots] of Object.entries(historyMap)) {
      const newItemId = oldIdToNewId[oldItemId];
      if (!newItemId) continue;
      for (const snapshot of snapshots) {
        await DB.savePriceSnapshot({ ...snapshot, id: DB.uuid(), itemId: newItemId });
        importedSnapshots++;
      }
    }

    return { collection, importedItems, importedInventory, importedWishlist, importedTransactions, importedSnapshots };
  }

  return { exportToFile, parseImportFile, commitImport };
})();
