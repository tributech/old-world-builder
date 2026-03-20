/**
 * Migrate lists from the old compositionRule + compPackId fields
 * to the new unified compositionRules array.
 */

/**
 * Migrate a single list.
 */
export const migrateList = (list) => {
  if (!list || list.type === "folder") return list;
  if (list.compositionRules) return list; // already migrated

  const rules = [];

  if (list.compositionRule) {
    if (list.compositionRule === "grand-melee-combined-arms") {
      rules.push("grand-melee", "combined-arms");
    } else if (list.compositionRule !== "open-war") {
      rules.push(list.compositionRule);
    }
  }

  if (list.compPackId) {
    rules.push(list.compPackId);
  }

  return {
    ...list,
    compositionRules: rules,
  };
};

/**
 * Migrate all lists in an array.
 */
export const migrateLists = (lists) => {
  if (!lists || !Array.isArray(lists)) return lists;
  return lists.map(migrateList);
};
