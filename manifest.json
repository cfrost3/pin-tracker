// filtering.js — facet filtering, sorting, and grouped value summaries.
// Direct port of the Swift InventoryFiltering.swift logic.

const FACETS = {
  character: { label: 'Character', icon: '🧑', values: (item) => item.characters || [] },
  movie: { label: 'Movie', icon: '🎬', values: (item) => item.movie ? [item.movie] : [] },
  holiday: { label: 'Holiday', icon: '🎁', values: (item) => item.holiday ? [item.holiday] : [] },
  editionSize: { label: 'Edition size', icon: '#️⃣', values: (item) => item.editionSize ? [`LE ${item.editionSize}`] : [] },
  park: { label: 'Park', icon: '🗺️', values: (item) => item.park ? [item.park] : [] },
  attraction: { label: 'Attraction', icon: '🎡', values: (item) => item.attraction ? [item.attraction] : [] }
};

const SORT_OPTIONS = {
  dateAcquiredNewest: { label: 'Newest first', sort: (entries) => [...entries].sort((a, b) => b.dateAcquired - a.dateAcquired) },
  dateAcquiredOldest: { label: 'Oldest first', sort: (entries) => [...entries].sort((a, b) => a.dateAcquired - b.dateAcquired) },
  nameAZ: { label: 'Name (A–Z)', sort: (entries) => [...entries].sort((a, b) => (a._item?.name || '').localeCompare(b._item?.name || '')) },
  valueHighLow: { label: 'Value (high to low)', sort: (entries) => [...entries].sort((a, b) => (b.currentEstimatedValue || 0) - (a.currentEstimatedValue || 0)) },
  valueLowHigh: { label: 'Value (low to high)', sort: (entries) => [...entries].sort((a, b) => (a.currentEstimatedValue || 0) - (b.currentEstimatedValue || 0)) },
  percentChangeHighLow: { label: 'Gain % (high to low)', sort: (entries) => [...entries].sort((a, b) => (DB.percentChange(b) ?? -Infinity) - (DB.percentChange(a) ?? -Infinity)) },
  percentChangeLowHigh: { label: 'Gain % (low to high)', sort: (entries) => [...entries].sort((a, b) => (DB.percentChange(a) ?? Infinity) - (DB.percentChange(b) ?? Infinity)) }
};

/// Active filter state: one facet key + a Set of selected values, OR'd
/// together. Mirrors the Swift ActiveFilter struct.
function createActiveFilter() {
  return { facetKey: null, selectedValues: new Set() };
}

function filterIsActive(filter) {
  return filter.facetKey !== null && filter.selectedValues.size > 0;
}

function filterMatches(filter, item) {
  if (!filterIsActive(filter) || !item) return true;
  const facet = FACETS[filter.facetKey];
  const itemValues = new Set(facet.values(item));
  for (const v of filter.selectedValues) {
    if (itemValues.has(v)) return true;
  }
  return false;
}

function toggleFilterValue(filter, facetKey, value) {
  if (filter.facetKey !== facetKey) {
    filter.facetKey = facetKey;
    filter.selectedValues = new Set([value]);
  } else if (filter.selectedValues.has(value)) {
    filter.selectedValues.delete(value);
    if (filter.selectedValues.size === 0) filter.facetKey = null;
  } else {
    filter.selectedValues.add(value);
  }
}

function clearFilter(filter) {
  filter.facetKey = null;
  filter.selectedValues = new Set();
}

/// Builds "value by [facet]" summaries across a set of inventory entries
/// (each entry must have `_item` attached — see attachItems in app.js).
/// Mirrors FilterFacet.groupSummaries(for:) from the Swift version.
function groupSummaries(facetKey, entries) {
  const facet = FACETS[facetKey];
  const totals = {}; // value -> { value, invested, count }

  for (const entry of entries) {
    if (!entry._item) continue;
    const values = facet.values(entry._item);
    if (values.length === 0) continue;

    for (const value of values) {
      const bucket = totals[value] || { value: 0, invested: 0, count: 0 };
      bucket.value += entry.currentEstimatedValue || 0;
      bucket.invested += entry.purchasePrice || 0;
      bucket.count += 1;
      totals[value] = bucket;
    }
  }

  return Object.entries(totals)
    .map(([key, bucket]) => ({
      value: key,
      totalValue: bucket.value,
      totalInvested: bucket.invested,
      itemCount: bucket.count,
      unrealizedGain: bucket.value - bucket.invested
    }))
    .sort((a, b) => b.totalValue - a.totalValue);
}

/// Which facets have at least one populated value across a set of entries
/// — used to hide filter/breakdown options that would otherwise show empty.
function availableFacets(entries) {
  return Object.keys(FACETS).filter(facetKey =>
    entries.some(entry => entry._item && FACETS[facetKey].values(entry._item).length > 0)
  );
}

window.Filtering = {
  FACETS, SORT_OPTIONS,
  createActiveFilter, filterIsActive, filterMatches, toggleFilterValue, clearFilter,
  groupSummaries, availableFacets
};
