import { getCompPackById, resolveCompPack } from "./comp-packs";
import { getUnitPoints } from "./points";
import { findAllOptions } from "./unit";
import { rulesMap } from "../components/rules-index/rules-map";
import { normalizeRuleName } from "./string";

/**
 * Cache: army ID → map of unit/creature name → specialRules text.
 * Loaded per-army on demand (single fetch per army).
 */
const armyRulesCache = {};

/**
 * Fetch special rules text from tow.whfb.app for a mount/creature.
 */
const fetchMountRules = async (mountName) => {
  const normalized = normalizeRuleName(mountName);
  const ruleData = rulesMap[normalized];
  if (!ruleData?.url?.startsWith("unit/")) return null;
  try {
    const resp = await fetch(
      `https://tow.whfb.app/${ruleData.url}?minimal=true`,
    );
    const html = await resp.text();
    // Parse special rules from the page — they're in a consistent format
    const match = html.match(
      /Special Rules:?\s*<\/[^>]+>\s*(?:<[^>]+>)*([\s\S]*?)(?:<\/|$)/i,
    );
    if (match) {
      // Clean HTML tags and extract text
      return match[1].replace(/<[^>]+>/g, "").trim();
    }
    // Fallback: look for rules in links
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

/**
 * Load a single army's unit/mount name → specialRules mapping.
 * Fetches the army JSON, indexes all units, then fetches mount rules
 * from tow.whfb.app for any mounts not already covered.
 */
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
          // Index unit's own special rules
          if (unit.specialRules?.name_en && unit.name_en) {
            nameMap[unit.name_en.toLowerCase().replace(/ \{.*\}/, "")] =
              unit.specialRules.name_en;
          }
          // Collect mount names that aren't already indexed
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

    // Fetch special rules for unresolved mounts from tow.whfb.app
    const uniqueMounts = [...new Set(mountsToFetch)];
    await Promise.all(
      uniqueMounts.map(async (mountName) => {
        const key = mountName.toLowerCase().replace(/ \{.*\}/, "");
        if (nameMap[key]) return; // already resolved
        const rules = await fetchMountRules(mountName);
        if (rules) {
          nameMap[key] = rules;
        }
      }),
    );

    armyRulesCache[armyId] = nameMap;
    console.log(
      `[Comp Pack] Army rules loaded for ${armyId}: ${Object.keys(nameMap).length} entries`,
    );
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

/**
 * Check if a unit has a given special rule (e.g. "Fly", "Ethereal").
 * Checks both inherent specialRules text and active selectable options.
 *
 * @param {object} unit - The unit object from the list
 * @param {string} ruleName - The rule name to search for (case-insensitive)
 * @param {string} armyComposition - The army composition key for resolving specialRules
 * @returns {boolean}
 */
export const unitHasRule = (unit, ruleName, armyComposition) => {
  const rulePattern = new RegExp(`\\b${escapeRegExp(ruleName)}\\b`, "i");

  // Check inherent specialRules (may be on unit directly or under armyComposition variant)
  const specialRules =
    unit?.armyComposition?.[armyComposition]?.specialRules ||
    unit.specialRules;

  if (specialRules?.name_en && rulePattern.test(specialRules.name_en)) {
    return true;
  }

  // Check active selectable options (recursive through nested options)
  const matchingOptions = findAllOptions(
    unit.options || [],
    (option) => option.active && rulePattern.test(option.name_en || ""),
    true,
  );

  if (matchingOptions.length > 0) {
    return true;
  }

  // Check active mount options (mounts can grant rules like Fly)
  if (unit.mounts) {
    const activeMounts = unit.mounts.filter(
      (mount) => mount.active && mount.name_en !== "On foot",
    );

    for (const mount of activeMounts) {
      // Check if mount name itself matches the rule
      if (rulePattern.test(mount.name_en || "")) {
        return true;
      }

      // Check mount's special rules from army data (e.g. Bone Dragon has Fly)
      const mountRules = getMountRulesFromArmy(mount.name_en, armyComposition);
      if (mountRules && rulePattern.test(mountRules)) {
        return true;
      }

      // Check mount sub-options
      const mountOptions = findAllOptions(
        mount.options || [],
        (option) => option.active && rulePattern.test(option.name_en || ""),
        true,
      );
      if (mountOptions.length > 0) {
        return true;
      }
    }
  }

  return false;
};

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CATEGORIES = [
  "characters",
  "core",
  "special",
  "rare",
  "mercenaries",
  "allies",
];

/**
 * Get all units from a list across specified categories, each tagged with their category.
 */
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

/**
 * Validate a list against a comp pack. Returns an array of error objects
 * in the same shape as validateList errors: { message, section, ...values }
 */
export const validateCompPack = ({ list }) => {
  const compPack = list.compPackId
    ? getCompPackById(list.compPackId)
    : null;

  if (!compPack) return [];

  const armyId = list.army;
  const resolved = resolveCompPack(compPack, armyId);
  const errors = [];

  // Effective army points budget (base + adjustment)
  const effectivePoints = list.points + (resolved.pointsAdjustment || 0);
  const armyComposition = list.armyComposition || list.army;

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

    // Max duplicates of any single unit in this category
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

    console.group(`[Comp Pack] Rule limit: ${ruleLimit.rule}`);
    console.log(`Effective army points: ${effectivePoints}`);
    console.log(`Max %: ${ruleLimit.maxPercent}, Max pts: ${Math.floor((effectivePoints / 100) * ruleLimit.maxPercent)}`);
    allUnits.forEach(({ unit, category }) => {
      const has = unitHasRule(unit, ruleLimit.rule, armyComposition);
      const pts = getUnitPoints({ ...unit, type: category }, { armyComposition });
      const activeMountName = unit.mounts?.find((m) => m.active && m.name_en !== "On foot")?.name_en;
      console.log(
        `  ${has ? "✓" : "✗"} ${unit.name_en} (${category}, ${pts}pts)` +
        (activeMountName ? ` [mount: ${activeMountName}]` : "") +
        ` rules: ${unit.specialRules?.name_en?.substring(0, 80) || "none"}`,
      );
    });
    console.log(`Total matching: ${matchingUnits.length} units`);

    // Max percentage of points on units with this rule
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
      console.log(`Total ${ruleLimit.rule} points: ${rulePoints} / ${maxPoints} (${rulePoints > maxPoints ? "OVER" : "ok"})`);
      console.groupEnd();
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

    // Max count of units with this rule
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

    // Max count
    if (unitLimit.max !== undefined && matchingUnits.length > unitLimit.max) {
      errors.push({
        message: "misc.error.compPackUnitMaxCount",
        section: matchingUnits[0]?.category || "global",
        diff: matchingUnits.length - unitLimit.max,
        name: compPack.name,
      });
    }

    // Max percentage of points
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
  for (const [category, maxPercent] of Object.entries(
    resolved.perUnitMaxPercent,
  )) {
    if (!list[category]) continue;

    list[category].forEach((unit) => {
      const unitPoints = getUnitPoints(
        { ...unit, type: category },
        { armyComposition },
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
            (cmd.name_en.toLowerCase().replace(/ /g, "-").includes(optionLimit.option) ||
              cmd.id === optionLimit.option)
          ) {
            matchingCommands.push({ cmd, category });
          }
        }
      }
    }

    // Disabled option
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

    // Max count
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

  return errors;
};

/**
 * Get comp-pack-adjusted max percent data for a category.
 * Returns the same shape as getMaxPercentData from rules.js,
 * but uses comp pack overrides if stricter.
 */
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

/**
 * Get comp-pack-adjusted min percent data for a category.
 */
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
 * Get the effective points budget for a list, accounting for comp pack adjustment.
 */
export const getEffectivePoints = (list) => {
  if (!list.compPackId) return list.points;

  const compPack = getCompPackById(list.compPackId);
  if (!compPack) return list.points;

  const resolved = resolveCompPack(compPack, list.army);
  return list.points + (resolved.pointsAdjustment || 0);
};
