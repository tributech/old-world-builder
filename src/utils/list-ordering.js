/**
 * Explicit list ordering using lexorank.
 * Replaces position-based folder assignment for syncable ordering.
 *
 * This is a NEW file - existing list.js is unchanged.
 * For upstream: https://github.com/oldworldbuilder/old-world-builder
 */

import { generateRank } from "./lexorank";

/**
 * Sort lists by rank for display, grouping folder contents after their folder.
 *
 * Order:
 * 1. Items with folder:null and folders themselves, sorted by rank
 * 2. After each folder, its contents sorted by rank
 *
 * This means moving a folder only requires changing the folder's rank -
 * contents automatically follow because they're grouped.
 */
export const sortByRank = (lists) => {
  // Separate top-level items (folder:null) and folders
  const topLevel = lists.filter(
    (l) => l.folder === null || l.folder === undefined || l.type === "folder"
  );

  // Sort top-level by rank (using < > for ASCII order, not localeCompare)
  const sortedTopLevel = [...topLevel].sort((a, b) => {
    if (!a.rank && !b.rank) return 0;
    if (!a.rank) return 1;
    if (!b.rank) return -1;
    // Simple string comparison for consistent ASCII ordering
    if (a.rank < b.rank) return -1;
    if (a.rank > b.rank) return 1;
    return 0;
  });

  // Build result: for each top-level item, if it's a folder, insert its contents after
  const result = [];
  for (const item of sortedTopLevel) {
    result.push(item);

    if (item.type === "folder") {
      // Get folder contents and sort by rank
      const contents = lists
        .filter((l) => l.folder === item.id)
        .sort((a, b) => {
          if (!a.rank && !b.rank) return 0;
          if (!a.rank) return 1;
          if (!b.rank) return -1;
          // Simple string comparison for consistent ASCII ordering
          if (a.rank < b.rank) return -1;
          if (a.rank > b.rank) return 1;
          return 0;
        });
      result.push(...contents);
    }
  }

  return result;
};

/**
 * Assign initial ranks and folders to items that don't have them.
 * Called on app load to migrate legacy lists.
 *
 * Walks through lists in current order and generates ranks that
 * preserve that order. Also calculates folder membership from position
 * for items that don't have a rank yet (legacy migration).
 *
 * @param {Array} lists - Lists to process (in current order)
 * @returns {{ lists: Array, needsUpdate: boolean }} - Lists with ranks, and whether any were added
 */
export const ensureRanks = (lists) => {
  let lastRank = null;
  let needsUpdate = false;
  let currentFolder = null;

  const result = lists.map((list, index) => {
    // Track current folder from position (for legacy migration)
    if (list.type === "folder") {
      currentFolder = list.id;
    }

    // Already has rank - use it as-is
    if (list.rank) {
      lastRank = list.rank;
      return list;
    }

    // Needs a rank - generate one between prev and next
    needsUpdate = true;
    const nextWithRank = lists.slice(index + 1).find((l) => l.rank);
    const newRank = generateRank(lastRank, nextWithRank?.rank);
    lastRank = newRank;

    // For legacy items without rank, also set folder from position
    const newFolder = list.type === "folder" ? list.folder : currentFolder;

    return {
      ...list,
      rank: newRank,
      folder: newFolder,
      updated_at: new Date().toISOString(),
    };
  });

  return { lists: result, needsUpdate };
};

/**
 * Reorder a list item - generate rank between neighbors at destination.
 *
 * @param {Array} lists - Current lists (already sorted by rank)
 * @param {number} sourceIndex - Index where item is dragged from
 * @param {number} destIndex - Index where item is dropped
 * @returns {Array} Updated lists with new rank/folder
 */
export const reorderList = (lists, sourceIndex, destIndex) => {
  const item = lists[sourceIndex];

  // Get prev/next at destination
  const withoutItem = lists.filter((_, i) => i !== sourceIndex);
  const insertAt = destIndex;

  const prev = withoutItem[insertAt - 1] || null;
  const next = withoutItem[insertAt] || null;

  // Folder = nearest folder header before destination
  let newFolder = null;
  for (let i = insertAt - 1; i >= 0; i--) {
    if (withoutItem[i]?.type === "folder") {
      newFolder = withoutItem[i].id;
      break;
    }
  }

  // If dropping after a collapsed folder, go to END of its contents
  let prevRank = prev?.rank || null;
  if (prev?.type === "folder" && !prev?.open && newFolder) {
    const contents = lists.filter((l) => l.folder === newFolder);
    if (contents.length > 0) {
      const last = contents.reduce((a, b) => ((b.rank || "") > (a.rank || "") ? b : a));
      prevRank = last.rank;
    }
  }

  const newRank = generateRank(prevRank, next?.rank || null);

  return lists.map((l) =>
    l.id === item.id
      ? { ...l, rank: newRank, folder: newFolder, updated_at: new Date().toISOString() }
      : l
  );
};

/**
 * Reorder a folder - just changes the folder's rank.
 * Contents automatically follow because sortByRank groups them after their folder.
 */
export const reorderFolder = (lists, sourceIndex, destIndex) => {
  const folder = lists[sourceIndex];

  if (folder?.type !== "folder") {
    return reorderList(lists, sourceIndex, destIndex);
  }

  // Exclude folder and its contents to find real neighbors
  const contentIds = new Set(lists.filter((l) => l.folder === folder.id).map((l) => l.id));
  const others = lists.filter((l) => l.id !== folder.id && !contentIds.has(l.id));

  // Find where folder lands among "others"
  // Count how many "others" are before destIndex in original list
  let insertAt = 0;
  for (let i = 0; i < destIndex; i++) {
    if (lists[i].id !== folder.id && !contentIds.has(lists[i].id)) {
      insertAt++;
    }
  }

  const prev = others[insertAt - 1] || null;
  const next = others[insertAt] || null;

  // If prev is a collapsed folder, rank after its last content
  let prevRank = prev?.rank || null;
  if (prev?.type === "folder" && !prev?.open) {
    const contents = lists.filter((l) => l.folder === prev.id);
    if (contents.length > 0) {
      const last = contents.reduce((a, b) => ((b.rank || "") > (a.rank || "") ? b : a));
      prevRank = last.rank;
    }
  }

  const newRank = generateRank(prevRank, next?.rank || null);

  return lists.map((l) =>
    l.id === folder.id
      ? { ...l, rank: newRank, updated_at: new Date().toISOString() }
      : l
  );
};
