import { getAnyPackById, resolveCompPack } from "./comp-packs";
import { getUnitPoints } from "./points";
import { findAllOptions } from "./unit";
import { rules } from "./rules";
import { rulesMap } from "../components/rules-index/rules-map";
import { normalizeRuleName } from "./string";

// ─── Mount rules cache (per-army, loaded on demand) ───────────────────────

const armyRulesCache = {};

const fetchMountRules = async (mountName) => {
  const normalized = normalizeRuleName(mountName);
  const ruleData = rulesMap[normalized];
  if (!ruleData?.url?.startsWith("unit/")) return null;
  try {
    const resp = await fetch(
      `https://tow.whfb.app/${ruleData.url}?minimal=true`,
    );
    const html = await resp.text();
    const match = html.match(
      /Special Rules:?\s*<\/[^>]+>\s*(?:<[^>]+>)*([\s\S]*?)(?:<\/|$)/i,
    );
    if (match) {
      return match[1].replace(/<[^>]+>/g, "").trim();
    }
    const ruleLinks = [...html.matchAll(/>([^<]+)<\/a>/g)]
      .map((m) => m[1].trim())
      .filter((r) => r.length > 2 && r.length < 50);
    if (ruleLinks.length > 3) {
      return ruleLinks.join(", ");
    }
  } catch {
    // fetch failed
  }
  return null;
};

export const loadArmyRules = async (game, armyId) => {
  if (armyRulesCache[armyId]) return;
  try {
    const resp = await fetch(`/games/${game}/${armyId}.json`);
    const data = await resp.json();
    const nameMap = {};
    const mountsToFetch = [];

    for (const cat of ["characters", "core", "special", "rare"]) {
      if (data[cat]) {
        for (const unit of data[cat]) {
          if (unit.specialRules?.name_en && unit.name_en) {
            nameMap[unit.name_en.toLowerCase().replace(/ \{.*\}/, "")] =
              unit.specialRules.name_en;
          }
          if (unit.mounts) {
            for (const mount of unit.mounts) {
              const key = mount.name_en
                ?.toLowerCase()
                .replace(/ \{.*\}/, "");
              if (key && key !== "on foot" && !nameMap[key]) {
                mountsToFetch.push(mount.name_en);
              }
            }
          }
        }
      }
    }

    const uniqueMounts = [...new Set(mountsToFetch)];
    await Promise.all(
      uniqueMounts.map(async (mountName) => {
        const key = mountName.toLowerCase().replace(/ \{.*\}/, "");
        if (nameMap[key]) return;
        const mountRules = await fetchMountRules(mountName);
        if (mountRules) {
          nameMap[key] = mountRules;
        }
      }),
    );

    armyRulesCache[armyId] = nameMap;
  } catch {
    armyRulesCache[armyId] = {};
  }
};

const getMountRulesFromArmy = (mountName, armyId) => {
  const cache = armyRulesCache[armyId];
  if (!cache) return null;
  const key = mountName.toLowerCase().replace(/ \{.*\}/, "");
  return cache[key] || null;
};

// ─── Unit rule detection ──────────────────────────────────────────────────

export const unitHasRule = (unit, ruleName, armyComposition) => {
  const rulePattern = new RegExp(`\\b${escapeRegExp(ruleName)}\\b`, "i");

  const specialRules =
    unit?.armyComposition?.[armyComposition]?.specialRules ||
    unit.specialRules;

  if (specialRules?.name_en && rulePattern.test(specialRules.name_en)) {
    return true;
  }

  const matchingOptions = findAllOptions(
    unit.options || [],
    (option) => option.active && rulePattern.test(option.name_en || ""),
    true,
  );
  if (matchingOptions.length > 0) return true;

  if (unit.mounts) {
    const activeMounts = unit.mounts.filter(
      (mount) => mount.active && mount.name_en !== "On foot",
    );
    for (const mount of activeMounts) {
      if (rulePattern.test(mount.name_en || "")) return true;

      const mountRules = getMountRulesFromArmy(mount.name_en, armyComposition);
      if (mountRules && rulePattern.test(mountRules)) return true;

      const mountOptions = findAllOptions(
        mount.options || [],
        (option) => option.active && rulePattern.test(option.name_en || ""),
        true,
      );
      if (mountOptions.length > 0) return true;
    }
  }

  return false;
};

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Wizard level counting (ported from validation.js) ────────────────────

function incrementLevels(listOfOptionHolders, wizardLevels) {
  if (listOfOptionHolders && listOfOptionHolders.length) {
    listOfOptionHolders
      .filter((optionHolder) => optionHolder.options)
      .flatMap((optionHolder) => optionHolder.options)
      .filter((option) => option.active)
      .forEach((activeOption) => {
        const match = activeOption.name_en
          .toLowerCase()
          .match(/level\s*(\d+)\s*wizard/);
        if (match && match[1]) {
          wizardLevels[parseInt(match[1], 10)]++;
        }
        activeOption.options && incrementLevels([activeOption], wizardLevels);
      });
  }
}

const getWizardLevels = (unitToCheck) => {
  let wizardLevels = [0, 0, 0, 0, 0];
  incrementLevels([unitToCheck], wizardLevels);
  incrementLevels(unitToCheck.command, wizardLevels);
  incrementLevels(unitToCheck.mounts, wizardLevels);
  return wizardLevels;
};

// ─── Shared helpers ───────────────────────────────────────────────────────

const CATEGORIES = [
  "characters",
  "core",
  "special",
  "rare",
  "mercenaries",
  "allies",
];

const getAllUnits = (list) => {
  const units = [];
  for (const category of CATEGORIES) {
    if (list[category]) {
      for (const unit of list[category]) {
        units.push({ unit, category });
      }
    }
  }
  return units;
};

const hasSharedCombinedArmsLimit = (otherUnit, unitToValidate) => {
  return (
    otherUnit.sharedCombinedArmsUnits &&
    otherUnit.sharedCombinedArmsUnits.includes(unitToValidate.id.split(".")[0])
  );
};

// ─── Single pack validation ───────────────────────────────────────────────

/**
 * Validate a list against a single comp pack.
 * Returns { errors: [...], minNonCharacterUnits: number|null }
 */
export const validateSinglePack = ({ list, compPack }) => {
  if (!compPack) return { errors: [], minNonCharacterUnits: null };

  const armyId = list.army;
  const resolved = resolveCompPack(compPack, armyId);
  const errors = [];
  const effectivePoints = list.points + (resolved.pointsAdjustment || 0);
  const armyComposition = list.armyComposition || list.army;
  let minNonCharacterUnits = null;

  // --- Category percentage overrides ---
  for (const [category, limits] of Object.entries(resolved.categories)) {
    if (!list[category]) continue;

    let categoryPoints = 0;
    list[category].forEach((unit) => {
      categoryPoints += getUnitPoints(
        { ...unit, type: category },
        { armyComposition },
      );
    });

    if (
      limits.maxPercent !== undefined &&
      categoryPoints > Math.floor((effectivePoints / 100) * limits.maxPercent)
    ) {
      errors.push({
        message: "misc.error.compPackMaxPercent",
        section: category,
        percent: limits.maxPercent,
        name: compPack.name,
      });
    }

    if (
      limits.minPercent !== undefined &&
      categoryPoints < Math.floor((effectivePoints / 100) * limits.minPercent)
    ) {
      errors.push({
        message: "misc.error.compPackMinPercent",
        section: category,
        percent: limits.minPercent,
        name: compPack.name,
      });
    }

    // Flat max duplicates
    if (limits.maxDuplicates !== undefined) {
      const unitCounts = {};
      list[category].forEach((unit) => {
        const baseId = unit.id.split(".")[0];
        unitCounts[baseId] = (unitCounts[baseId] || 0) + 1;
      });
      for (const [baseId, count] of Object.entries(unitCounts)) {
        if (count > limits.maxDuplicates) {
          const unit = list[category].find(
            (u) => u.id.split(".")[0] === baseId,
          );
          errors.push({
            message: "misc.error.compPackMaxDuplicates",
            section: category,
            max: limits.maxDuplicates,
            diff: count - limits.maxDuplicates,
            name: compPack.name,
            unitName: unit?.name_en || baseId,
          });
        }
      }
    }
  }

  // --- Rule-based limits ---
  for (const ruleLimit of resolved.ruleLimits) {
    const allUnits = getAllUnits(list);
    const matchingUnits = allUnits.filter(({ unit }) =>
      unitHasRule(unit, ruleLimit.rule, armyComposition),
    );

    if (ruleLimit.maxPercent !== undefined) {
      let rulePoints = 0;
      matchingUnits.forEach(({ unit, category }) => {
        rulePoints += getUnitPoints(
          { ...unit, type: category },
          { armyComposition },
        );
      });
      const maxPoints = Math.floor(
        (effectivePoints / 100) * ruleLimit.maxPercent,
      );
      if (rulePoints > maxPoints) {
        errors.push({
          message: "misc.error.compPackRuleMaxPercent",
          section: matchingUnits[0]?.category || "global",
          rule: ruleLimit.rule,
          percent: ruleLimit.maxPercent,
          name: compPack.name,
        });
      }
    }

    if (ruleLimit.maxCount !== undefined) {
      if (matchingUnits.length > ruleLimit.maxCount) {
        errors.push({
          message: "misc.error.compPackRuleMaxCount",
          section: matchingUnits[0]?.category || "global",
          rule: ruleLimit.rule,
          max: ruleLimit.maxCount,
          diff: matchingUnits.length - ruleLimit.maxCount,
          name: compPack.name,
        });
      }
    }
  }

  // --- Unit-specific limits ---
  for (const unitLimit of resolved.unitLimits) {
    const allUnits = getAllUnits(list);
    const matchingUnits = allUnits.filter(({ unit }) =>
      unitLimit.ids.includes(unit.id.split(".")[0]),
    );

    if (unitLimit.max !== undefined && matchingUnits.length > unitLimit.max) {
      errors.push({
        message: "misc.error.compPackUnitMaxCount",
        section: matchingUnits[0]?.category || "global",
        diff: matchingUnits.length - unitLimit.max,
        name: compPack.name,
      });
    }

    if (unitLimit.maxPercent !== undefined) {
      let unitPoints = 0;
      matchingUnits.forEach(({ unit, category }) => {
        unitPoints += getUnitPoints(
          { ...unit, type: category },
          { armyComposition },
        );
      });
      const maxPoints = Math.floor(
        (effectivePoints / 100) * unitLimit.maxPercent,
      );
      if (unitPoints > maxPoints) {
        errors.push({
          message: "misc.error.compPackUnitMaxPercent",
          section: matchingUnits[0]?.category || "global",
          percent: unitLimit.maxPercent,
          name: compPack.name,
        });
      }
    }
  }

  // --- Per-unit max percent caps ---
  const noDetachments = compPack.noDetachmentsForPerUnitPercent || false;
  for (const [category, maxPercent] of Object.entries(
    resolved.perUnitMaxPercent,
  )) {
    if (!list[category]) continue;

    list[category].forEach((unit) => {
      const unitPoints = getUnitPoints(
        { ...unit, type: category },
        {
          armyComposition,
          ...(noDetachments && category !== "characters"
            ? { noDetachments: true }
            : {}),
        },
      );
      const maxPoints = Math.floor((effectivePoints / 100) * maxPercent);

      if (unitPoints > maxPoints) {
        errors.push({
          message: "misc.error.compPackPerUnitMaxPercent",
          section: category,
          percent: maxPercent,
          name: compPack.name,
        });
      }
    });
  }

  // --- Option/command limits ---
  for (const optionLimit of resolved.optionLimits) {
    const allUnits = getAllUnits(list);
    const matchingCommands = [];

    for (const { unit, category } of allUnits) {
      if (unit.command) {
        for (const cmd of unit.command) {
          if (
            cmd.active &&
            (cmd.name_en
              .toLowerCase()
              .replace(/ /g, "-")
              .includes(optionLimit.option) ||
              cmd.id === optionLimit.option)
          ) {
            matchingCommands.push({ cmd, category });
          }
        }
      }
    }

    if (optionLimit.disabled && matchingCommands.length > 0) {
      for (const { cmd, category } of matchingCommands) {
        errors.push({
          message: "misc.error.compPackDisabledCommand",
          section: category,
          command: cmd.name_en,
          name: compPack.name,
        });
      }
    }

    if (
      optionLimit.maxCount !== undefined &&
      matchingCommands.length > optionLimit.maxCount
    ) {
      errors.push({
        message: "misc.error.compPackOptionMaxCount",
        section: matchingCommands[0]?.category || "global",
        command: optionLimit.option.replace(/-/g, " "),
        max: optionLimit.maxCount,
        diff: matchingCommands.length - optionLimit.maxCount,
        name: compPack.name,
      });
    }
  }

  // --- Wizard limits (Grand Melee) ---
  if (compPack.wizardLimits) {
    const wizardSections = ["characters", "special", "rare"];
    for (const wl of compPack.wizardLimits) {
      const maxAllowed =
        Math.floor(effectivePoints / wl.pointsInterval) * wl.maxPerPoints;
      let totalAtLevel = 0;
      const sectionCounts = {};

      for (const section of wizardSections) {
        let sectionCount = 0;
        if (list[section]) {
          list[section].forEach((unit) => {
            const levels = getWizardLevels(unit);
            if (levels[wl.level] > 0) {
              sectionCount += levels[wl.level];
            }
          });
        }
        sectionCounts[section] = sectionCount;
        totalAtLevel += sectionCount;
      }

      if (totalAtLevel > maxAllowed) {
        for (const section of wizardSections) {
          if (sectionCounts[section] > 0) {
            errors.push({
              message: "misc.error.compPackWizardLimit",
              section,
              level: wl.level,
              max: maxAllowed,
              name: compPack.name,
            });
          }
        }
      }
    }
  }

  // --- Scaling duplicate limits (Combined Arms) ---
  if (compPack.scalingDuplicateLimits) {
    const armyRules = rules[armyComposition] || rules["grand-army"];

    for (const [category, scaling] of Object.entries(
      compPack.scalingDuplicateLimits,
    )) {
      if (!list[category]) continue;

      const maxDuplicates =
        scaling.base +
        Math.max(
          Math.floor((effectivePoints - scaling.bonusAbove) / scaling.bonusPer),
          0,
        );

      const categoryUnitsRules = armyRules?.[category]?.units;

      // Count duplicates per unit ID
      const unitCounts = {};
      list[category].forEach((unit) => {
        const baseId = unit.id.split(".")[0];

        // For core, also count shared combined arms units together
        if (category === "core") {
          const countKey =
            list[category].find(
              (other) =>
                other.id.split(".")[0] !== baseId &&
                hasSharedCombinedArmsLimit(other, unit),
            )?.id.split(".")[0] || baseId;
          // Use the lower ID as the canonical key for shared units
          const canonicalKey =
            countKey < baseId ? countKey : baseId;
          unitCounts[canonicalKey] = (unitCounts[canonicalKey] || 0) + 1;
        } else {
          unitCounts[baseId] = (unitCounts[baseId] || 0) + 1;
        }
      });

      for (const [baseId, count] of Object.entries(unitCounts)) {
        // Skip units already restricted by army rules
        if (compPack.respectArmyLimits && categoryUnitsRules) {
          const isRestricted = categoryUnitsRules.some((ruleUnit) => {
            if (!ruleUnit.ids.includes(baseId)) return false;
            // Characters: skip if has min or max
            if (category === "characters") return ruleUnit.max || ruleUnit.min;
            // Others: skip if has max
            return ruleUnit.max;
          });
          if (isRestricted) continue;
        }

        // Skip named characters (they're inherently unique)
        const unit = list[category].find(
          (u) => u.id.split(".")[0] === baseId,
        );
        if (category === "characters" && unit?.named) continue;

        if (count > maxDuplicates) {
          errors.push({
            message: "misc.error.maxUnits",
            section: category,
            diff: count - maxDuplicates,
            name: unit?.name_en || baseId,
          });
        }
      }
    }
  }

  // --- Min non-character units (Battle March) ---
  if (compPack.minNonCharacterUnits !== undefined) {
    minNonCharacterUnits = compPack.minNonCharacterUnits;
  }

  // --- Max 0-X unit types (Battle March) ---
  if (compPack.max0XUnitTypes !== undefined) {
    const armyRules = rules[armyComposition] || rules["grand-army"];
    const used0XTypes = new Set();

    // Scan all category rules for "0-X per 1000 points" entries with units in the list
    for (const category of CATEGORIES) {
      const categoryRules = armyRules?.[category]?.units;
      if (!categoryRules || !list[category]) continue;

      for (const ruleUnit of categoryRules) {
        if (ruleUnit.max > 0 && ruleUnit.points === 1000) {
          const unitsInList = list[category].filter(
            (unit) =>
              ruleUnit.ids && ruleUnit.ids.includes(unit.id.split(".")[0]),
          );
          if (unitsInList.length > 0) {
            unitsInList.forEach((unit) =>
              used0XTypes.add(unit.id.split(".")[0]),
            );
          }
        }
      }
    }

    if (used0XTypes.size > compPack.max0XUnitTypes) {
      // Report on each category that has 0-X units exceeding their limit
      for (const category of CATEGORIES) {
        const categoryRules = armyRules?.[category]?.units;
        if (!categoryRules || !list[category]) continue;

        for (const ruleUnit of categoryRules) {
          if (ruleUnit.max > 0 && ruleUnit.points === 1000) {
            const max =
              Math.floor(effectivePoints / ruleUnit.points) * ruleUnit.max;
            const unitsInList = list[category].filter(
              (unit) =>
                ruleUnit.ids && ruleUnit.ids.includes(unit.id.split(".")[0]),
            );
            if (unitsInList.length > max) {
              errors.push({
                message: "misc.error.battleMarchMultiple0XUnits",
                section: category,
              });
            }
          }
        }
      }
    }
  }

  return { errors, minNonCharacterUnits };
};

// ─── Multi-pack validation ────────────────────────────────────────────────

/**
 * Validate a list against all packs in compositionRules.
 * Returns { errors: [...], minNonCharacterUnits: number|null }
 */
export const validateCompPacks = ({ list }) => {
  const packIds = list.compositionRules || [];

  const allErrors = [];
  let minNonChar = null;

  for (const packId of packIds) {
    const compPack = getAnyPackById(packId);
    if (!compPack) continue;

    const { errors, minNonCharacterUnits } = validateSinglePack({
      list,
      compPack,
    });
    allErrors.push(...errors);

    if (minNonCharacterUnits !== null) {
      // Use the lowest override (most restrictive could go either way,
      // but Battle March uses 2 which is less than default 3)
      minNonChar =
        minNonChar === null
          ? minNonCharacterUnits
          : Math.min(minNonChar, minNonCharacterUnits);
    }
  }

  return { errors: allErrors, minNonCharacterUnits: minNonChar };
};

// ─── Editor helpers ───────────────────────────────────────────────────────

export const getCompPackMaxPercentData = ({
  type,
  armyPoints,
  points,
  compPack,
  armyId,
}) => {
  if (!compPack) return null;

  const resolved = resolveCompPack(compPack, armyId);
  const effectivePoints = armyPoints + (resolved.pointsAdjustment || 0);
  const categoryOverride = resolved.categories[type];

  if (!categoryOverride?.maxPercent) return null;

  const maxPoints = Math.floor(
    (effectivePoints / 100) * categoryOverride.maxPercent,
  );

  return {
    points: maxPoints,
    overLimit: points > maxPoints,
    diff: points > maxPoints ? Math.ceil(points - maxPoints) : 0,
  };
};

export const getCompPackMinPercentData = ({
  type,
  armyPoints,
  points,
  compPack,
  armyId,
}) => {
  if (!compPack) return null;

  const resolved = resolveCompPack(compPack, armyId);
  const effectivePoints = armyPoints + (resolved.pointsAdjustment || 0);
  const categoryOverride = resolved.categories[type];

  if (!categoryOverride?.minPercent) return null;

  const minPoints = Math.floor(
    (effectivePoints / 100) * categoryOverride.minPercent,
  );

  return {
    points: minPoints,
    overLimit: points <= minPoints,
    diff: points <= minPoints ? Math.ceil(minPoints - points) : 0,
  };
};

/**
 * Get the effective points budget for a list, accounting for all pack adjustments.
 */
export const getEffectivePoints = (list) => {
  const packIds = list.compositionRules || [];
  if (packIds.length === 0 && list.compPackId) {
    packIds.push(list.compPackId);
  }

  let adjustment = 0;
  for (const packId of packIds) {
    const compPack = getAnyPackById(packId);
    if (!compPack) continue;
    const resolved = resolveCompPack(compPack, list.army);
    adjustment += resolved.pointsAdjustment || 0;
  }

  return list.points + adjustment;
};
