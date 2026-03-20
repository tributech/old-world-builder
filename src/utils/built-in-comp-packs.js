/**
 * Built-in composition rule packs.
 * These are the standard GW game formats expressed as comp pack data.
 * They are read-only and always available.
 */

export const builtInCompPacks = [
  {
    id: "grand-melee",
    name: "Grand Melee",
    builtIn: true,
    perUnitMaxPercent: {
      characters: 25,
      core: 25,
      special: 25,
      rare: 25,
      mercenaries: 25,
      allies: 25,
    },
    wizardLimits: [
      { level: 3, maxPerPoints: 1, pointsInterval: 1000 },
      { level: 4, maxPerPoints: 1, pointsInterval: 2000 },
    ],
  },
  {
    id: "combined-arms",
    name: "Combined Arms",
    builtIn: true,
    scalingDuplicateLimits: {
      characters: { base: 3, bonusPer: 1000, bonusAbove: 2000 },
      core: { base: 4, bonusPer: 1000, bonusAbove: 2000 },
      special: { base: 3, bonusPer: 1000, bonusAbove: 2000 },
      rare: { base: 2, bonusPer: 1000, bonusAbove: 2000 },
      mercenaries: { base: 2, bonusPer: 1000, bonusAbove: 2000 },
    },
    respectArmyLimits: true,
  },
  {
    id: "battle-march",
    name: "Battle March",
    builtIn: true,
    perUnitMaxPercent: {
      characters: 25,
      core: 35,
      special: 30,
      rare: 25,
      mercenaries: 25,
    },
    noDetachmentsForPerUnitPercent: true,
    minNonCharacterUnits: 2,
    max0XUnitTypes: 1,
  },
];

/**
 * Get a built-in pack by ID.
 */
export const getBuiltInPack = (id) =>
  builtInCompPacks.find((p) => p.id === id) || null;

/**
 * Check if an ID refers to a built-in pack.
 */
export const isBuiltInPack = (id) =>
  builtInCompPacks.some((p) => p.id === id);

/**
 * Get all built-in packs.
 */
export const getAllBuiltInPacks = () => builtInCompPacks;
