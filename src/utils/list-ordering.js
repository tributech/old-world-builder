/**
 * Explicit list ordering using lexorank.
 * Replaces position-based folder assignment for syncable ordering.
 *
 * This is a NEW file - existing list.js is unchanged.
 * For upstream: https://github.com/oldworldbuilder/old-world-builder
 */

import { generateRank } from "./lexorank";

/**
 * Sort lists by rank for display.
 * Items without rank sort to the end (legacy lists).
 */
export const sortByRank = (lists) => {
  return [...lists].sort((a, b) => {
    if (!a.rank && !b.rank) return 0;
    if (!a.rank) return 1;
    if (!b.rank) return -1;
    return a.rank.localeCompare(b.rank);
  });
};

/**
 * Assign initial ranks to items that don't have them.
 * Called on app load to migrate legacy lists.
 *
 * Walks through lists in current order and generates ranks that
 * preserve that order. This is a one-time migration - once lists
 * have ranks, they keep them.
 *
 * @param {Array} lists - Lists to process (in current order)
 * @returns {{ lists: Array, needsUpdate: boolean }} - Lists with ranks, and whether any were added
 */
export const ensureRanks = (lists) => {
  let lastRank = null;
  let needsUpdate = false;

  const result = lists.map((list, index) => {
    // Already has rank - use it
    if (list.rank) {
      lastRank = list.rank;
      return list;
    }

    // Needs a rank - generate one between prev and next
    needsUpdate = true;
    const nextWithRank = lists.slice(index + 1).find((l) => l.rank);
    const newRank = generateRank(lastRank, nextWithRank?.rank);
    lastRank = newRank;

    return { ...list, rank: newRank, updated_at: new Date().toISOString() };
  });

  return { lists: result, needsUpdate };
};

/**
 * Reorder a list item, updating its rank and folder explicitly.
 *
 * @param {Array} lists - Current lists (already sorted by rank)
 * @param {number} sourceIndex - Where item is dragged from
 * @param {number} destIndex - Where item is dropped
 * @returns {Array} Updated lists with new rank/folder
 */
export const reorderList = (lists, sourceIndex, destIndex) => {
  const item = lists[sourceIndex];

  // Determine neighbors at destination (accounting for removal of source)
  const withoutSource = lists.filter((_, i) => i !== sourceIndex);
  const adjustedDest = destIndex > sourceIndex ? destIndex - 1 : destIndex;

  const prevItem = adjustedDest > 0 ? withoutSource[adjustedDest - 1] : null;
  const nextItem =
    adjustedDest < withoutSource.length ? withoutSource[adjustedDest] : null;

  // Determine folder: item goes in whatever folder precedes it
  // If no folder precedes it, folder = null
  let newFolder = null;
  for (let i = adjustedDest - 1; i >= 0; i--) {
    if (withoutSource[i]?.type === "folder") {
      newFolder = withoutSource[i].id;
      break;
    }
  }

  // Generate rank between neighbors
  const newRank = generateRank(prevItem?.rank || null, nextItem?.rank || null);

  return lists.map((list) =>
    list.id === item.id
      ? {
          ...list,
          rank: newRank,
          folder: newFolder,
          updated_at: new Date().toISOString(),
        }
      : list
  );
};
