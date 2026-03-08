#!/usr/bin/env node
/**
 * Army List Text Parser
 *
 * Parses army list text (e.g. from New Recruit or similar tools) and generates
 * an OWB-compatible .owb.json file that can be imported into Old World Builder.
 *
 * Usage:
 *   node tools/parse-army-list.js <input.txt> <army> [armyComposition] [--out output.owb.json]
 *
 * Examples:
 *   node tools/parse-army-list.js list.txt wood-elf-realms
 *   node tools/parse-army-list.js list.txt wood-elf-realms host-of-talsyn
 *   node tools/parse-army-list.js list.txt wood-elf-realms --out my-list.owb.json
 *
 * The army dataset JSONs are read from public/games/the-old-world/<army>.json
 * Magic items from public/games/the-old-world/magic-items.json
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ---------------------------------------------------------------------------
// Config / paths
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "public", "games", "the-old-world");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId() {
  return crypto.randomBytes(6).toString("hex");
}

function normalize(str) {
  return str
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^\w\s'&-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fuzzyMatch(needle, haystack) {
  const n = normalize(needle);
  const h = normalize(haystack);
  if (n === h) return 1.0;
  if (h.includes(n) || n.includes(h)) return 0.9;
  // Check if all words in needle appear in haystack
  // Ignore very short words (articles, prepositions) for matching
  const stopWords = new Set(["a", "an", "of", "the", "in", "on", "to", "for"]);
  const nWords = n.split(/\s+/).filter((w) => w.length > 1);
  const hWords = h.split(/\s+/).filter((w) => w.length > 1);
  if (nWords.length === 0 || hWords.length === 0) return 0;
  const matched = nWords.filter((w) =>
    hWords.some((hw) => {
      if (stopWords.has(w) || stopWords.has(hw)) return w === hw;
      return hw.includes(w) || w.includes(hw);
    })
  );
  if (matched.length === nWords.length) return 0.8;
  if (nWords.length >= 2 && matched.length / nWords.length >= 0.7) return 0.6;
  return 0;
}

/**
 * Strict match: exact match or the needle IS the haystack (not just a substring).
 * Allows minor differences like pluralization.
 */
function strictMatch(needle, haystack) {
  const n = normalize(needle);
  const h = normalize(haystack);
  if (n === h) return true;
  // Allow singular/plural: "hand weapon" matches "hand weapons"
  if (n + "s" === h || h + "s" === n) return true;
  // Allow the needle to match the full haystack when haystack is a compound
  // e.g., "asrai longbow" matches "hand weapon, asrai longbows"
  const hParts = h.split(",").map((p) => p.trim());
  return hParts.some((p) => p === n || p + "s" === n || n + "s" === p);
}

function findBestMatch(name, candidates, nameKey = "name_en") {
  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    const candidateName = typeof c === "string" ? c : c[nameKey];
    if (!candidateName) continue;
    const score = fuzzyMatch(name, candidateName);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore >= 0.6 ? best : null;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function loadArmyData(armyId) {
  const filePath = path.join(DATA_DIR, `${armyId}.json`);
  if (!fs.existsSync(filePath)) {
    console.error(`Army data file not found: ${filePath}`);
    console.error(
      "Available armies:",
      fs
        .readdirSync(DATA_DIR)
        .filter((f) => f.endsWith(".json") && f !== "magic-items.json")
        .map((f) => f.replace(".json", ""))
        .join(", ")
    );
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadMagicItems() {
  const filePath = path.join(DATA_DIR, "magic-items.json");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * Build a flat lookup of all magic items available to this army.
 * Returns Map<normalizedName, itemObj>
 */
function buildMagicItemIndex(magicItemsData, armyId) {
  const index = new Map();
  // Sections that are potentially relevant:
  // "general" is always available
  // army-specific section
  // special sections like "forest-spites", "kindreds", etc.
  const relevantSections = getRelevantMagicSections(armyId);

  for (const section of relevantSections) {
    const items = magicItemsData[section];
    if (!items) continue;
    for (const item of items) {
      const key = normalize(item.name_en);
      index.set(key, { ...item, _section: section });
    }
  }
  return index;
}

/**
 * Determine which magic-items.json sections are relevant for a given army.
 */
function getRelevantMagicSections(armyId) {
  // Map army IDs to their magic item sections
  const armySectionMap = {
    "wood-elf-realms": ["general", "wood-elf-realms", "forest-spites", "kindreds"],
    "high-elf-realms": ["general", "high-elf-realms", "elven-honours"],
    "kingdom-of-bretonnia": ["general", "kingdom-of-bretonnia", "knightly-virtues"],
    "empire-of-man": ["general", "empire-of-man"],
    "dwarfen-mountain-holds": ["general", "dwarfen-mountain-holds"],
    "orc-and-goblin-tribes": ["general", "orc-and-goblin-tribes"],
    "beastmen-brayherds": ["general", "beastmen-brayherds", "gifts-of-chaos", "chaos-mutations"],
    "tomb-kings-of-khemri": ["general", "tomb-kings-of-khemri", "incantation-scrolls"],
    "warriors-of-chaos": [
      "general",
      "warriors-of-chaos",
      "gifts-of-chaos",
      "chaos-mutations",
      "chaotic-traits",
    ],
    "chaos-dwarfs": ["general", "chaos-dwarfs"],
    "lizardmen": ["general", "lizardmen", "disciplines-old-ones"],
    "dark-elves": ["general", "dark-elves", "forbidden-poisons", "gifts-of-khaine"],
    "ogre-kingdoms": ["general", "ogre-kingdoms", "big-names"],
    skaven: ["general", "skaven"],
    "vampire-counts": ["general", "vampire-counts", "vampiric-powers"],
    "daemons-of-chaos": [
      "general",
      "daemonic-gifts-common",
      "daemonic-icons-common",
      "daemonic-gifts-khorne",
      "daemonic-icons-khorne",
      "daemonic-gifts-nurgle",
      "daemonic-icons-nurgle",
      "daemonic-gifts-slaanesh",
      "daemonic-icons-slaanesh",
      "daemonic-gifts-tzeentch",
      "daemonic-icons-tzeentch",
    ],
    "grand-cathay": ["general", "grand-cathay"],
    "renegade-crowns": ["general"],
  };

  return armySectionMap[armyId] || ["general", armyId];
}

// ---------------------------------------------------------------------------
// Text parser
// ---------------------------------------------------------------------------

/**
 * Parse the army list text into a structured intermediate representation.
 *
 * Expected format:
 *   Title Line - Army Name - Composition - [XXXpts]
 *   # Main Force [XXXpts]
 *   ## Characters [XXXpts]
 *   Unit Name [XXXpts]: option1, option2, ...
 *   Nx Unit Name [XXXpts]:
 *   • Mx Model Name [XXXpts]: equipment...
 *   • 1x Champion [XXXpts]
 */
function parseText(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const result = {
    listName: "",
    armyName: "",
    compositionName: "",
    totalPoints: 0,
    categories: {},
  };

  let currentCategory = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Title line: "Name - Army - Composition - [XXXpts]"
    if (i === 0 && !line.startsWith("#")) {
      const titleMatch = line.match(/^(.+?)\s*-\s*(.+?)\s*-\s*(.+?)\s*-\s*\[(\d+)pts\]/);
      if (titleMatch) {
        result.listName = titleMatch[1].trim();
        result.armyName = titleMatch[2].trim();
        result.compositionName = titleMatch[3].trim();
        result.totalPoints = parseInt(titleMatch[4], 10);
      } else {
        // Try simpler format: "Name - Army - [XXXpts]"
        const simpleMatch = line.match(/^(.+?)\s*-\s*(.+?)\s*-\s*\[(\d+)pts\]/);
        if (simpleMatch) {
          result.listName = simpleMatch[1].trim();
          result.armyName = simpleMatch[2].trim();
          result.totalPoints = parseInt(simpleMatch[3], 10);
        } else {
          result.listName = line.replace(/\[.*?\]/g, "").trim();
        }
      }
      continue;
    }

    // Main force header: "# Main Force [XXXpts]"
    if (line.startsWith("# ") && !line.startsWith("## ")) {
      continue; // skip, we don't need this
    }

    // Category header: "## Characters [XXXpts]"
    if (line.startsWith("## ")) {
      const catMatch = line.match(/^##\s+(.+?)(?:\s*\[(\d+)pts\])?$/);
      if (catMatch) {
        currentCategory = catMatch[1].trim().toLowerCase();
        if (!result.categories[currentCategory]) {
          result.categories[currentCategory] = [];
        }
      }
      continue;
    }

    // Sub-line (bullet point): "• Nx Model [XXXpts]: stuff"
    if (line.startsWith("•") || line.startsWith("-") || line.startsWith("*")) {
      // Attach to the last unit in current category
      if (currentCategory && result.categories[currentCategory].length > 0) {
        const lastUnit =
          result.categories[currentCategory][
            result.categories[currentCategory].length - 1
          ];
        lastUnit.subLines.push(parseSubLine(line));
      }
      continue;
    }

    // Unit line: "Nx Unit Name [XXXpts]: options..." or "Unit Name [XXXpts]: options..."
    if (currentCategory) {
      const unitLine = parseUnitLine(line);
      if (unitLine) {
        if (!result.categories[currentCategory]) {
          result.categories[currentCategory] = [];
        }
        result.categories[currentCategory].push(unitLine);
      }
    }
  }

  return result;
}

/**
 * Parse a unit header line like:
 *   "2x Deepwood Scouts [141pts]:"
 *   "Glade Lord [555pts]: Hand Weapon, Light Armour, ..."
 *   "Glade Guard [65pts]:"
 */
function parseUnitLine(line) {
  // Match: optional "Nx " prefix, unit name, [pts], optional ": options"
  const match = line.match(
    /^(\d+)x\s+(.+?)\s*\[(\d+)pts\]\s*:?\s*(.*)?$/
  );
  if (match) {
    return {
      count: parseInt(match[1], 10),
      name: match[2].trim(),
      points: parseInt(match[3], 10),
      optionsText: match[4] ? match[4].trim() : "",
      subLines: [],
    };
  }

  // No count prefix
  const match2 = line.match(/^(.+?)\s*\[(\d+)pts\]\s*:?\s*(.*)?$/);
  if (match2) {
    return {
      count: 1,
      name: match2[1].trim(),
      points: parseInt(match2[2], 10),
      optionsText: match2[3] ? match2[3].trim() : "",
      subLines: [],
    };
  }

  return null;
}

/**
 * Parse a sub-line like:
 *   "• 9x Deepwood Scout [15pts]: Asrai Longbow, Hand Weapon, Hagbane Tips"
 *   "• 1x Musician [6pts]"
 *   "• 1x Standard Bearer [21pts]: Banner of Midsummer's Eve"
 */
function parseSubLine(line) {
  // Strip bullet
  const stripped = line.replace(/^[•\-*]\s*/, "").trim();

  const match = stripped.match(
    /^(\d+)x\s+(.+?)\s*\[(\d+)pts\]\s*:?\s*(.*)?$/
  );
  if (match) {
    return {
      count: parseInt(match[1], 10),
      name: match[2].trim(),
      points: parseInt(match[3], 10),
      optionsText: match[4] ? match[4].trim() : "",
    };
  }

  // No count
  const match2 = stripped.match(/^(.+?)\s*\[(\d+)pts\]\s*:?\s*(.*)?$/);
  if (match2) {
    return {
      count: 1,
      name: match2[1].trim(),
      points: parseInt(match2[2], 10),
      optionsText: match2[3] ? match2[3].trim() : "",
    };
  }

  return { count: 1, name: stripped, points: 0, optionsText: "" };
}

// ---------------------------------------------------------------------------
// OWB list builder
// ---------------------------------------------------------------------------

/**
 * Given parsed text and army data, build an OWB list JSON.
 */
function buildOwbList(parsed, armyData, magicItemIndex, armyId, armyComposition) {
  const list = {
    id: generateId(),
    name: parsed.listName || "Imported List",
    game: "the-old-world",
    army: armyId,
    armyComposition: armyComposition,
    points: parsed.totalPoints || 2000,
    characters: [],
    core: [],
    special: [],
    rare: [],
    mercenaries: [],
    allies: [],
  };

  const warnings = [];

  // Build a flat lookup of all units by name
  const unitIndex = buildUnitIndex(armyData, armyComposition);

  // Process each category
  for (const [catName, units] of Object.entries(parsed.categories)) {
    const owbCategory = mapCategoryName(catName);
    if (!list[owbCategory]) {
      warnings.push(`Unknown category "${catName}", skipping`);
      continue;
    }

    for (const parsedUnit of units) {
      // How many copies of this unit entry?
      const copies = parsedUnit.count || 1;

      for (let c = 0; c < copies; c++) {
        const result = buildUnit(parsedUnit, unitIndex, magicItemIndex, armyComposition, warnings);
        if (result) {
          list[owbCategory].push(result);
        }
      }
    }
  }

  return { list, warnings };
}

function mapCategoryName(catName) {
  const mapping = {
    characters: "characters",
    core: "core",
    special: "special",
    rare: "rare",
    mercenaries: "mercenaries",
    allies: "allies",
  };
  return mapping[catName] || catName;
}

/**
 * Build an index of all units across all categories.
 * Returns Map<normalizedName, {unit, category}>
 */
function buildUnitIndex(armyData, armyComposition) {
  const index = new Map();
  const categories = ["characters", "core", "special", "rare", "mercenaries", "allies"];

  for (const cat of categories) {
    const units = armyData[cat] || [];
    for (const unit of units) {
      // Check armyComposition filter
      if (unit.armyComposition && !unit.armyComposition[armyComposition]) {
        continue;
      }
      const key = normalize(unit.name_en);
      index.set(key, { unit, category: cat });
    }
  }
  return index;
}

/**
 * Build a single unit for the OWB list.
 */
function buildUnit(parsedUnit, unitIndex, magicItemIndex, armyComposition, warnings) {
  // Find the unit definition in army data
  const unitKey = normalize(parsedUnit.name);
  let unitEntry = unitIndex.get(unitKey);

  // If not found by exact match, try fuzzy
  if (!unitEntry) {
    for (const [key, entry] of unitIndex.entries()) {
      if (fuzzyMatch(parsedUnit.name, entry.unit.name_en) >= 0.7) {
        unitEntry = entry;
        break;
      }
    }
  }

  if (!unitEntry) {
    warnings.push(`Unit not found in army data: "${parsedUnit.name}"`);
    return null;
  }

  const templateUnit = unitEntry.unit;
  const uid = generateId();

  // Deep clone the template
  const unit = JSON.parse(JSON.stringify(templateUnit));
  unit.id = `${templateUnit.id}.${uid}`;

  // Determine unit strength from sub-lines
  const strength = determineStrength(parsedUnit, templateUnit);
  if (strength) {
    unit.strength = strength;
  }

  // Collect all mentioned option/equipment/item names from text
  const allMentionedNames = collectMentionedNames(parsedUnit);

  // Activate equipment
  activateEquipment(unit, allMentionedNames, warnings);

  // Activate armor
  activateArmor(unit, allMentionedNames, warnings);

  // Activate options (including nested wizard levels)
  activateOptions(unit, allMentionedNames, armyComposition, warnings);

  // Activate mounts
  activateMount(unit, allMentionedNames, warnings);

  // Activate command (general, champion, standard bearer, musician)
  activateCommand(unit, parsedUnit, magicItemIndex, warnings);

  // Assign magic items
  assignMagicItems(unit, allMentionedNames, magicItemIndex, warnings);

  // Set active lore for wizards
  setActiveLore(unit, allMentionedNames, warnings);

  return unit;
}

/**
 * Determine unit strength (model count) from sub-lines.
 */
function determineStrength(parsedUnit, templateUnit) {
  if (!parsedUnit.subLines || parsedUnit.subLines.length === 0) {
    // Single model unit (character) - no sub-lines
    return templateUnit.minimum || 1;
  }

  // Sum up the counts from sub-lines that represent regular models
  // (not command group upgrades)
  let total = 0;
  const commandNames = [
    "musician",
    "standard bearer",
    "champion",
    "general",
    "battle standard bearer",
  ];

  for (const sub of parsedUnit.subLines) {
    const subNorm = normalize(sub.name);
    const isCommand = commandNames.some(
      (cn) => subNorm.includes(cn) || fuzzyMatch(sub.name, cn) >= 0.7
    );
    // Count all models including command - they're part of the unit strength
    total += sub.count;
  }

  return total || templateUnit.minimum || 1;
}

/**
 * Collect all mentioned names from the unit line and sub-lines into a flat set.
 * Splits on commas from the options text and strips parenthetical mount equipment.
 */
function collectMentionedNames(parsedUnit) {
  const names = new Set();

  // From main unit line options
  if (parsedUnit.optionsText) {
    splitOptions(parsedUnit.optionsText).forEach((n) => names.add(normalize(n)));
  }

  // From sub-lines
  if (parsedUnit.subLines) {
    for (const sub of parsedUnit.subLines) {
      if (sub.optionsText) {
        splitOptions(sub.optionsText).forEach((n) => names.add(normalize(n)));
      }
      // The sub-line name itself might be a command group name
      names.add(normalize(sub.name));
    }
  }

  return names;
}

/**
 * Split an options text string on commas, handling parenthetical groups.
 * "Hand Weapon, Elven Steed (Hand Weapon), Wizard Level 2"
 * → ["Hand Weapon", "Elven Steed", "Hand Weapon", "Wizard Level 2"]
 */
function splitOptions(text) {
  if (!text) return [];

  // Count parens to detect unbalanced input
  const openCount = (text.match(/\(/g) || []).length;
  const closeCount = (text.match(/\)/g) || []).length;

  // If unbalanced, find the last closing paren and treat everything after
  // it as top-level options. This handles formats like:
  // "Forest Dragon (Full Plate Armour (Serrated Maw (Soporific Breath (Wicked Claws), Great Weapon, ..."
  // where parenthetical mount equipment runs into the main option list.
  if (openCount > closeCount && closeCount > 0) {
    const lastClose = text.lastIndexOf(")");
    const beforeParens = text.substring(0, text.indexOf("("));
    const afterLastClose = text.substring(lastClose + 1);

    const results = [];

    // Split the part before first paren
    beforeParens.split(",").forEach((s) => {
      const trimmed = s.trim();
      if (trimmed) results.push(trimmed);
    });

    // Split the part after last closing paren
    afterLastClose.split(",").forEach((s) => {
      const trimmed = s.trim();
      if (trimmed) results.push(trimmed);
    });

    return results;
  }

  const results = [];
  let current = "";
  let depth = 0;

  for (const ch of text) {
    if (ch === "(") {
      // Save what we have before the paren as the main option
      if (current.trim()) {
        results.push(current.trim());
      }
      current = "";
      depth++;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        current = "";
      }
    } else if (ch === "," && depth === 0) {
      if (current.trim()) {
        results.push(current.trim());
      }
      current = "";
    } else if (depth === 0) {
      current += ch;
    }
  }
  if (current.trim()) {
    results.push(current.trim());
  }

  return results;
}

/**
 * Activate equipment entries that match mentioned names.
 */
function activateEquipment(unit, mentionedNames, warnings) {
  if (!unit.equipment) return;

  for (const equip of unit.equipment) {
    const equipName = normalize(equip.name_en);
    // Equipment names can be compound: "Hand weapon, Asrai longbows"
    const equipParts = equip.name_en
      .split(",")
      .map((p) => normalize(p.trim()));

    // Check if any mentioned name matches this equipment or its parts
    const isDefault = equip.active || equip.equippedDefault;
    let isMatch = false;

    for (const mentioned of mentionedNames) {
      // Use strict matching for equipment to avoid
      // "hand weapon" matching "additional hand weapon"
      if (
        strictMatch(mentioned, equipName) ||
        equipParts.some((p) => strictMatch(mentioned, p))
      ) {
        isMatch = true;
        break;
      }
    }

    if (isMatch || isDefault) {
      equip.active = true;
    } else {
      delete equip.active;
    }
  }
}

/**
 * Activate armor entries that match mentioned names.
 */
function activateArmor(unit, mentionedNames, warnings) {
  if (!unit.armor) return;

  for (const armor of unit.armor) {
    const armorName = normalize(armor.name_en);
    // Armor names can have parenthetical: "Full plate armour (Arboreal armour)"
    const armorParts = armor.name_en
      .replace(/[()]/g, ",")
      .split(",")
      .map((p) => normalize(p.trim()))
      .filter(Boolean);

    const isDefault = armor.active;
    let isMatch = false;

    for (const mentioned of mentionedNames) {
      if (
        fuzzyMatch(mentioned, armorName) >= 0.7 ||
        armorParts.some((p) => fuzzyMatch(mentioned, p) >= 0.7)
      ) {
        isMatch = true;
        break;
      }
    }

    if (isMatch || isDefault) {
      armor.active = true;
    } else {
      delete armor.active;
    }
  }
}

/**
 * Activate options (including nested wizard levels).
 */
function activateOptions(unit, mentionedNames, armyComposition, warnings) {
  if (!unit.options) return;

  for (const opt of unit.options) {
    // Skip options restricted to different army compositions
    if (opt.armyComposition && opt.armyComposition !== armyComposition) {
      continue;
    }

    const optName = normalize(opt.name_en);

    // Handle nested options (e.g., Wizard → Level 1/2/3/4)
    if (opt.options && Array.isArray(opt.options)) {
      // The parent "Wizard" option should be alwaysActive
      if (opt.alwaysActive) {
        opt.active = true;
      }

      // Check which sub-option matches
      let foundSubMatch = false;
      for (const subOpt of opt.options) {
        const subName = normalize(subOpt.name_en);
        let isMatch = false;

        for (const mentioned of mentionedNames) {
          if (fuzzyMatch(mentioned, subName) >= 0.7) {
            isMatch = true;
            break;
          }
          // Also check for shorthand like "Wizard Level 2" matching "Level 2 Wizard"
          if (
            mentioned.includes("wizard") &&
            mentioned.includes("level") &&
            subName.includes("wizard") &&
            subName.includes("level")
          ) {
            // Extract level numbers
            const mentionedLevel = mentioned.match(/level\s*(\d)/);
            const subLevel = subName.match(/level\s*(\d)/);
            if (mentionedLevel && subLevel && mentionedLevel[1] === subLevel[1]) {
              isMatch = true;
              break;
            }
          }
        }

        if (isMatch) {
          subOpt.active = true;
          foundSubMatch = true;
          // Deactivate other exclusive options
          if (subOpt.exclusive) {
            for (const other of opt.options) {
              if (other !== subOpt && other.exclusive) {
                delete other.active;
              }
            }
          }
        } else if (!subOpt.active || foundSubMatch) {
          delete subOpt.active;
        }
      }
      continue;
    }

    // Regular option
    let isMatch = false;
    for (const mentioned of mentionedNames) {
      if (fuzzyMatch(mentioned, optName) >= 0.7) {
        isMatch = true;
        break;
      }
    }

    if (isMatch) {
      opt.active = true;
      // If this is exclusive, deactivate other exclusive options
      if (opt.exclusive) {
        for (const other of unit.options) {
          if (other !== opt && other.exclusive) {
            delete other.active;
          }
        }
      }
    } else if (!opt.alwaysActive) {
      delete opt.active;
    }
  }
}

/**
 * Activate the correct mount.
 */
function activateMount(unit, mentionedNames, warnings) {
  if (!unit.mounts || unit.mounts.length === 0) return;

  let foundMount = false;

  for (const mount of unit.mounts) {
    const mountName = normalize(mount.name_en.replace(/\s*\{mount\}/g, ""));

    let isMatch = false;
    for (const mentioned of mentionedNames) {
      if (fuzzyMatch(mentioned, mountName) >= 0.7) {
        isMatch = true;
        break;
      }
    }

    if (isMatch && mountName !== normalize("On foot")) {
      mount.active = true;
      foundMount = true;
    } else if (!isMatch) {
      delete mount.active;
    }
  }

  // If no mount was found, activate "On foot" (if available)
  if (!foundMount) {
    const onFoot = unit.mounts.find((m) => normalize(m.name_en) === normalize("On foot"));
    if (onFoot) {
      onFoot.active = true;
    }
  } else {
    // Deactivate "On foot" if another mount is selected
    const onFoot = unit.mounts.find((m) => normalize(m.name_en) === normalize("On foot"));
    if (onFoot) {
      delete onFoot.active;
    }
  }
}

/**
 * Activate command group options (General, Champion, Standard Bearer, Musician).
 */
function activateCommand(unit, parsedUnit, magicItemIndex, warnings) {
  if (!unit.command || unit.command.length === 0) return;

  // Collect all mentioned names from main line and sub-lines
  const allMentioned = collectMentionedNames(parsedUnit);

  // Also check sub-lines specifically for command positions
  const subLineNames = (parsedUnit.subLines || []).map((s) => ({
    name: normalize(s.name),
    optionsText: s.optionsText,
    original: s.name,
  }));

  for (const cmd of unit.command) {
    const cmdName = normalize(cmd.name_en);

    // Check if this command option is mentioned
    let isMatch = false;

    // Check in main options text
    for (const mentioned of allMentioned) {
      if (fuzzyMatch(mentioned, cmdName) >= 0.7) {
        isMatch = true;
        break;
      }
    }

    // Check in sub-line names (e.g., "1x Musician [6pts]")
    for (const sub of subLineNames) {
      if (fuzzyMatch(sub.name, cmdName) >= 0.7) {
        isMatch = true;

        // If the sub-line has options text, it might contain a magic banner
        if (sub.optionsText && cmd.magic) {
          const bannerItems = splitOptions(sub.optionsText);
          for (const bannerName of bannerItems) {
            const itemKey = normalize(bannerName);
            const magicItem = magicItemIndex.get(itemKey);
            if (magicItem) {
              if (!cmd.magic.selected) {
                cmd.magic.selected = [];
              }
              cmd.magic.selected.push({
                name_en: magicItem.name_en,
                points: magicItem.points,
                type: magicItem.type,
                name: magicItem.name,
              });
            }
          }
        }
        break;
      }
    }

    if (isMatch) {
      cmd.active = true;
    }
    // Don't deactivate commands - they might have defaults
  }
}

/**
 * Assign magic items to the unit's items slots.
 */
function assignMagicItems(unit, mentionedNames, magicItemIndex, warnings) {
  if (!unit.items || unit.items.length === 0) return;

  // Build a list of magic items that are mentioned
  const foundItems = [];
  for (const mentioned of mentionedNames) {
    const item = magicItemIndex.get(mentioned);
    if (item) {
      foundItems.push(item);
    } else {
      // Try fuzzy match
      for (const [key, mi] of magicItemIndex.entries()) {
        if (fuzzyMatch(mentioned, mi.name_en) >= 0.8) {
          foundItems.push(mi);
          break;
        }
      }
    }
  }

  // Assign each found item to the appropriate items slot
  for (const item of foundItems) {
    let assigned = false;
    for (const slot of unit.items) {
      if (slot.types && slot.types.includes(item.type)) {
        if (!slot.selected) {
          slot.selected = [];
        }
        // Don't add duplicates
        if (!slot.selected.some((s) => normalize(s.name_en) === normalize(item.name_en))) {
          slot.selected.push({
            name_en: item.name_en,
            name: item.name,
            points: item.points,
            type: item.type,
            ...(item.onePerArmy !== undefined ? { onePerArmy: item.onePerArmy } : {}),
          });
          assigned = true;
        }
        break;
      }
    }
    if (!assigned) {
      warnings.push(
        `Magic item "${item.name_en}" (type: ${item.type}) - no matching slot found on ${unit.name_en}`
      );
    }
  }
}

/**
 * Set the active lore for wizard units.
 */
function setActiveLore(unit, mentionedNames, warnings) {
  if (!unit.lores || unit.lores.length === 0) return;

  // Check if a lore is mentioned
  for (const lore of unit.lores) {
    const loreName = normalize(lore.replace(/-/g, " "));
    for (const mentioned of mentionedNames) {
      if (fuzzyMatch(mentioned, loreName) >= 0.7) {
        unit.activeLore = lore;
        return;
      }
    }
  }

  // Check for common shorthand: "Battle Magic" → "battle-magic"
  for (const mentioned of mentionedNames) {
    if (mentioned.includes("battle magic") || mentioned.includes("battle-magic")) {
      if (unit.lores.includes("battle-magic")) {
        unit.activeLore = "battle-magic";
        return;
      }
    }
    if (mentioned.includes("elementalism")) {
      if (unit.lores.includes("elementalism")) {
        unit.activeLore = "elementalism";
        return;
      }
    }
    if (mentioned.includes("high magic") || mentioned.includes("high-magic")) {
      if (unit.lores.includes("high-magic")) {
        unit.activeLore = "high-magic";
        return;
      }
    }
    if (mentioned.includes("illusion")) {
      if (unit.lores.includes("illusion")) {
        unit.activeLore = "illusion";
        return;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log(`Usage: node tools/parse-army-list.js <input.txt> <army-id> [armyComposition] [--out output.owb.json]`);
    console.log();
    console.log("Arguments:");
    console.log("  input.txt        Path to the army list text file");
    console.log("  army-id          Army identifier (e.g., wood-elf-realms)");
    console.log("  armyComposition  Army composition variant (defaults to army-id)");
    console.log("  --out            Output file path (defaults to <listname>.owb.json)");
    console.log();
    console.log("Available armies:");
    const armies = fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.endsWith(".json") && f !== "magic-items.json")
      .map((f) => f.replace(".json", ""));
    console.log("  " + armies.join("\n  "));
    process.exit(1);
  }

  const inputFile = args[0];
  const armyId = args[1];
  const armyComposition = args[2] && !args[2].startsWith("--") ? args[2] : armyId;

  let outputFile = null;
  const outIdx = args.indexOf("--out");
  if (outIdx !== -1 && args[outIdx + 1]) {
    outputFile = args[outIdx + 1];
  }

  // Read input
  if (!fs.existsSync(inputFile)) {
    console.error(`Input file not found: ${inputFile}`);
    process.exit(1);
  }
  const inputText = fs.readFileSync(inputFile, "utf8");

  // Load data
  const armyData = loadArmyData(armyId);
  const magicItemsData = loadMagicItems();
  const magicItemIndex = buildMagicItemIndex(magicItemsData, armyId);

  // Parse
  const parsed = parseText(inputText);

  // Build OWB list
  const { list, warnings } = buildOwbList(
    parsed,
    armyData,
    magicItemIndex,
    armyId,
    armyComposition
  );

  // Determine output path
  if (!outputFile) {
    const safeName = (list.name || "army-list")
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    outputFile = `${safeName}.owb.json`;
  }

  // Write output
  fs.writeFileSync(outputFile, JSON.stringify(list, null, 2));
  console.log(`\nGenerated: ${outputFile}`);
  console.log(`  List: ${list.name}`);
  console.log(`  Army: ${armyId}`);
  console.log(`  Composition: ${armyComposition}`);
  console.log(`  Points target: ${list.points}`);

  // Count units
  const unitCount =
    list.characters.length +
    list.core.length +
    list.special.length +
    list.rare.length +
    list.mercenaries.length +
    list.allies.length;
  console.log(`  Units: ${unitCount}`);

  if (warnings.length > 0) {
    console.log(`\nWarnings (${warnings.length}):`);
    for (const w of warnings) {
      console.log(`  ⚠ ${w}`);
    }
  }

  console.log("\nDone! Import this file into Old World Builder.");
}

// Allow importing as a module for testing
if (require.main === module) {
  main();
} else {
  module.exports = {
    parseText,
    buildOwbList,
    loadArmyData,
    loadMagicItems,
    buildMagicItemIndex,
    splitOptions,
    normalize,
    fuzzyMatch,
  };
}
