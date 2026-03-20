import { getRandomId } from "./id";

/**
 * Comp Pack schema:
 *
 * {
 *   id: string,                    // stable ID for external reference (e.g. tournament systems)
 *   name: string,                  // human-readable name
 *
 *   // Category percentage overrides (merged on top of armyComposition rules)
 *   categories: {
 *     [category]: {
 *       minPercent?: number,
 *       maxPercent?: number,
 *       maxDuplicates?: number,   // max copies of any single unit (e.g. 1 = no duplicates)
 *     },
 *   },
 *
 *   // Rule-based limits — constrain units that have a specific special rule
 *   ruleLimits: [
 *     {
 *       rule: string,              // rule name to match (e.g. "Fly", "Ethereal")
 *       maxPercent?: number,        // max % of army points on units with this rule
 *       maxCount?: number,          // max number of units with this rule
 *       armies?: string[],          // optional: only apply to these armies (all if omitted)
 *     },
 *   ],
 *
 *   // Option/command limits — disable or restrict specific options/commands
 *   optionLimits: [
 *     {
 *       option: string,            // option/command ID (e.g. "battle-standard-bearer")
 *       disabled?: boolean,         // if true, this option is banned
 *       maxCount?: number,          // max times this option can appear across army
 *       armies?: string[],          // optional: only apply to these armies (all if omitted)
 *     },
 *   ],
 *
 *   // Unit-specific limits — override or add to army book unit rules
 *   unitLimits: [
 *     {
 *       ids: string[],             // unit IDs (same as rules.js format)
 *       max?: number,              // hard cap on count
 *       maxPercent?: number,        // max % of army points
 *       armies?: string[],          // optional: only apply to these armies (all if omitted)
 *     },
 *   ],
 *
 *   // Per-single-unit percentage caps (like battle-march but customisable)
 *   perUnitMaxPercent: {
 *     [category]: number,          // max % of army points any single unit in this category can cost
 *   },
 *
 *   // Army-specific overrides — for points adjustments and category % tweaks
 *   armyOverrides: {
 *     [armyId]: {
 *       pointsAdjustment?: number, // extra points budget (e.g. +200 for weaker factions)
 *       categories?: { ... },      // same shape as top-level categories
 *       perUnitMaxPercent?: { ... },
 *     },
 *   },
 * }
 */

const STORAGE_KEY = "owb.compPacks";

/**
 * Get all saved comp packs from localStorage.
 */
export const getCompPacks = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

/**
 * Get a single comp pack by ID.
 */
export const getCompPackById = (id) => {
  return getCompPacks().find((pack) => pack.id === id) || null;
};

/**
 * Get any pack by ID — checks built-in packs first, then user packs.
 * This is the unified lookup function.
 */
export const getAnyPackById = (id) => {
  // Lazy import to avoid circular dependency
  const { getBuiltInPack } =
    require("./built-in-comp-packs");
  return getBuiltInPack(id) || getCompPackById(id);
};

/**
 * Save a comp pack (create or update). Returns the saved pack.
 */
export const saveCompPack = (compPack) => {
  const packs = getCompPacks();
  const pack = {
    ...compPack,
    id: compPack.id || getRandomId(),
  };
  const existingIndex = packs.findIndex((p) => p.id === pack.id);

  if (existingIndex >= 0) {
    packs[existingIndex] = pack;
  } else {
    packs.push(pack);
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(packs));
  return pack;
};

/**
 * Delete a comp pack by ID.
 */
export const deleteCompPack = (id) => {
  const packs = getCompPacks().filter((p) => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(packs));
};

/**
 * Resolve a comp pack's effective settings for a given army,
 * merging army-specific overrides on top of defaults.
 */
export const resolveCompPack = (compPack, armyId) => {
  if (!compPack) return null;

  const override = compPack.armyOverrides?.[armyId];

  // Deep merge categories: army-level wins per category
  const mergedCategories = { ...(compPack.categories || {}) };
  if (override?.categories) {
    Object.entries(override.categories).forEach(([cat, values]) => {
      mergedCategories[cat] = {
        ...(mergedCategories[cat] || {}),
        ...values,
      };
    });
  }

  // Filter limits to those applicable to this army
  const filterByArmy = (limit) =>
    !limit.armies || limit.armies.includes(armyId);

  return {
    pointsAdjustment: override?.pointsAdjustment || 0,
    categories: mergedCategories,
    ruleLimits: (compPack.ruleLimits || []).filter(filterByArmy),
    optionLimits: (compPack.optionLimits || []).filter(filterByArmy),
    unitLimits: (compPack.unitLimits || []).filter(filterByArmy),
    perUnitMaxPercent: {
      ...(compPack.perUnitMaxPercent || {}),
      ...(override?.perUnitMaxPercent || {}),
    },
  };
};
