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
 * Allows minor differences like pluralization and "and" vs comma separators.
 */
function strictMatch(needle, haystack) {
  const n = normalize(needle);
  const h = normalize(haystack);
  if (n === h) return true;
  // Allow singular/plural: "hand weapon" matches "hand weapons"
  if (n + "s" === h || h + "s" === n) return true;
  // Allow "and" as a separator equivalent to comma:
  // "iron hail guns and dragon fire bombs" matches "iron hail guns, dragon fire bombs"
  const nNoAnd = n.replace(/\s+and\s+/g, " ");
  const hNoAnd = h.replace(/\s+and\s+/g, " ");
  if (nNoAnd === hNoAnd) return true;
  if (nNoAnd + "s" === hNoAnd || hNoAnd + "s" === nNoAnd) return true;
  // Allow the needle to match a part of a compound haystack
  // Split on commas BEFORE normalizing to preserve the delimiter
  const hParts = haystack.split(",").map((p) => normalize(p.trim()));
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
  // Load all sections — allied units may use items from their own army's section
  // Priority: army-specific sections first, then all others
  const relevantSections = getRelevantMagicSections(armyId);
  const allSections = Object.keys(magicItemsData);
  const orderedSections = [
    ...relevantSections,
    ...allSections.filter((s) => !relevantSections.includes(s)),
  ];

  for (const section of orderedSections) {
    const items = magicItemsData[section];
    if (!items) continue;
    for (const item of items) {
      const key = normalize(item.name_en);
      // Don't overwrite — first match wins (army-specific takes priority)
      if (!index.has(key)) {
        index.set(key, { ...item, _section: section });
      }
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
 * Auto-detect format and parse the army list text.
 *
 * Supported formats:
 *
 * Format A (New Recruit / markdown):
 *   Title Line - Army Name - Composition - [XXXpts]
 *   # Main Force [XXXpts]
 *   ## Characters [XXXpts]
 *   Unit Name [XXXpts]: option1, option2, ...
 *   Nx Unit Name [XXXpts]:
 *   • Mx Model Name [XXXpts]: equipment...
 *
 * Format B (dash / points-first):
 *   485 - Miao Ying, The Storm Dragon, General, Wizard Level 2
 *   269 - 8 Jade Lancer, options...
 *     • 1x Ogre Loader, Gunpowder Bombs
 *
 * Format C (OWB text export):
 *   ===
 *   List Name [pts]
 *   Warhammer: The Old World, Army, Composition
 *   ===
 *   ++ Characters [pts] ++
 *   Unit Name [pts]
 *   - option1
 *   - option2 [sub-option]
 */
function parseText(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // Detect format
  const dashPattern = /^\d+\s+-\s+/;
  const bracketPattern = /\[\d+pts\]/i;
  const owbCategoryPattern = /^\+\+\s+.+\s+\+\+$/;

  let dashCount = 0;
  let bracketCount = 0;
  let owbCategoryCount = 0;
  for (const line of lines) {
    if (dashPattern.test(line)) dashCount++;
    if (bracketPattern.test(line)) bracketCount++;
    if (owbCategoryPattern.test(line)) owbCategoryCount++;
  }

  // Format C: OWB text export (++ Category [pts] ++ headers with - option lines)
  if (owbCategoryCount >= 1) {
    return parseTextOwbFormat(lines);
  }
  // Format B: dash/points-first
  if (dashCount > bracketCount) {
    return parseTextDashFormat(lines);
  }
  // Format A: bracket/markdown
  return parseTextBracketFormat(lines);
}

/**
 * Parse Format A: bracket/markdown format (New Recruit style).
 */
function parseTextBracketFormat(lines) {
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
 * Parse Format B: dash/points-first format.
 * Lines like: "485 - Miao Ying, The Storm Dragon, General, ..."
 *             "269 - 8 Jade Lancer, Celestial Dragon Guard, ..."
 *             "  • 1x Ogre Loader, Gunpowder Bombs"
 *
 * Since there are no category headers, all units go into "_uncategorized"
 * and buildOwbList will auto-assign categories from the army data.
 */
function parseTextDashFormat(lines) {
  const result = {
    listName: "",
    armyName: "",
    compositionName: "",
    totalPoints: 0,
    categories: { _uncategorized: [] },
  };

  const dashPattern = /^(\d+)\s+-\s+(.+)$/;
  let lastUnit = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Sub-line (bullet point): "• 1x Ogre Loader, Gunpowder Bombs"
    if (line.startsWith("•") || (line.startsWith("-") && !dashPattern.test(line)) || line.startsWith("*")) {
      if (lastUnit) {
        lastUnit.subLines.push(parseDashSubLine(line));
      }
      continue;
    }

    // Main unit line: "485 - Miao Ying, The Storm Dragon, General, ..."
    const match = line.match(dashPattern);
    if (match) {
      const points = parseInt(match[1], 10);
      const rest = match[2].trim();

      const unitLine = parseDashUnitContent(rest, points);
      result.categories._uncategorized.push(unitLine);
      result.totalPoints += points;
      lastUnit = unitLine;
      continue;
    }
  }

  return result;
}

/**
 * Parse the content part of a dash-format unit line.
 * "8 Jade Lancer, Celestial Dragon Guard, Drilled, ..."
 * "Miao Ying, The Storm Dragon, General, ..."
 * "2 Cathayan Grand Cannon"
 */
function parseDashUnitContent(content, points) {
  // Check for a leading count: "8 Jade Lancer" or "26 Jade Warriors" or "2 Cathayan Grand Cannon"
  // Be careful: "Miao Ying" should NOT match (Miao is not a number)
  const countMatch = content.match(/^(\d+)\s+(.+)$/);

  let unitCount = 0; // 0 means single/character - let strength be determined later
  let nameAndOptions;

  if (countMatch) {
    unitCount = parseInt(countMatch[1], 10);
    nameAndOptions = countMatch[2];
  } else {
    nameAndOptions = content;
  }

  // Split on commas - first part is the unit name, rest are options
  // But unit names can contain commas for named characters: "Miao Ying, The Storm Dragon"
  // Strategy: try progressively longer comma-separated prefixes as the name
  const parts = nameAndOptions.split(",").map((p) => p.trim());

  return {
    count: 1, // In dash format, count of 2+ means model count, not duplicate entries
    name: parts[0], // Start with first part; will be refined during matching
    _nameParts: parts, // Keep all parts for fuzzy unit name resolution
    _modelCount: unitCount,
    points: points,
    optionsText: "", // Will be set during unit matching
    subLines: [],
  };
}

/**
 * Parse a sub-line in dash format: "• 1x Ogre Loader, Gunpowder Bombs"
 */
function parseDashSubLine(line) {
  const stripped = line.replace(/^[•\-*]\s*/, "").trim();

  // "1x Ogre Loader, Gunpowder Bombs"
  const match = stripped.match(/^(\d+)x\s+(.+)$/);
  if (match) {
    const count = parseInt(match[1], 10);
    const rest = match[2].trim();
    const parts = rest.split(",").map((p) => p.trim());
    return {
      count,
      name: parts[0],
      points: 0,
      optionsText: parts.slice(1).join(", "),
    };
  }

  // No count prefix
  const parts = stripped.split(",").map((p) => p.trim());
  return {
    count: 1,
    name: parts[0],
    points: 0,
    optionsText: parts.slice(1).join(", "),
  };
}

/**
 * Parse Format C: OWB's own text export format.
 *
 * Structure:
 *   ===
 *   List Name [pts]
 *   Warhammer: The Old World, Army, Composition
 *   ===
 *   ++ Characters [pts] ++
 *   Unit Name [pts]
 *   - option1
 *   - option2 [sub-option]
 *   - On foot
 *   13 Chaos Warriors [240 pts]
 *   - Hand weapons
 *   ---
 *   Created with "Old World Builder"
 */
function parseTextOwbFormat(lines) {
  const result = {
    listName: "",
    armyName: "",
    compositionName: "",
    totalPoints: 0,
    categories: {},
  };

  let currentCategory = null;
  let lastUnit = null;
  let inHeader = false;
  let headerLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip footer
    if (line === "---" || line.startsWith("Created with")) continue;

    // Header block between === lines
    if (line === "===") {
      if (!inHeader) {
        inHeader = true;
        headerLines = [];
      } else {
        inHeader = false;
        // Parse header: line 1 = "List Name [pts]", line 2 = "Warhammer: TOW, Army, Composition"
        if (headerLines.length >= 1) {
          const titleMatch = headerLines[0].match(/^(.+?)\s*\[(\d+)\s*pts?\]/i);
          if (titleMatch) {
            result.listName = titleMatch[1].trim();
            result.totalPoints = parseInt(titleMatch[2], 10);
          } else {
            result.listName = headerLines[0];
          }
        }
        if (headerLines.length >= 2) {
          // "Warhammer: The Old World, Warriors of Chaos, Open War"
          const metaParts = headerLines[1].split(",").map((p) => p.trim());
          if (metaParts.length >= 2) {
            result.armyName = metaParts[1];
          }
          if (metaParts.length >= 3) {
            result.compositionName = metaParts[2];
          }
        }
      }
      continue;
    }
    if (inHeader) {
      headerLines.push(line);
      continue;
    }

    // Category header: "++ Characters [650 pts] ++"
    const catMatch = line.match(/^\+\+\s+(.+?)\s*(?:\[[\d,.]+ pts?\])?\s*\+\+$/i);
    if (catMatch) {
      currentCategory = catMatch[1].trim().toLowerCase();
      // Normalize category names: "Core Units" → "core", "Rare Units" → "rare"
      currentCategory = currentCategory
        .replace(/\s*units?\s*$/i, "")
        .trim();
      if (!result.categories[currentCategory]) {
        result.categories[currentCategory] = [];
      }
      lastUnit = null;
      continue;
    }

    // Option line: "- Hand weapon" or "- Wizard [Level 4 Wizard]" or "- Mark of Chaos [Mark of Tzeentch]"
    if (line.startsWith("- ") && lastUnit) {
      const optLine = line.substring(2).trim();
      // Add to the unit's options text
      if (lastUnit.optionsText) {
        lastUnit.optionsText += ", " + optLine;
      } else {
        lastUnit.optionsText = optLine;
      }
      continue;
    }

    // Unit line: "Sorcerer Lord [315 pts]" or "13 Chaos Warriors [240 pts]"
    if (currentCategory) {
      const unitMatch = line.match(/^(?:(\d+)\s+)?(.+?)\s*\[(\d+)\s*pts?\]\s*$/i);
      if (unitMatch) {
        const unitLine = {
          count: 1,
          name: unitMatch[2].trim(),
          _modelCount: unitMatch[1] ? parseInt(unitMatch[1], 10) : 0,
          points: parseInt(unitMatch[3], 10),
          optionsText: "",
          subLines: [],
        };
        if (!result.categories[currentCategory]) {
          result.categories[currentCategory] = [];
        }
        result.categories[currentCategory].push(unitLine);
        lastUnit = unitLine;
        continue;
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

  // Build a cross-army index for allies (lazy, only if needed)
  let allArmiesIndex = null;

  // Process each category
  for (const [catName, units] of Object.entries(parsed.categories)) {
    // Special handling for _uncategorized (dash format - no category headers)
    if (catName === "_uncategorized") {
      for (const parsedUnit of units) {
        const resolved = resolveDashFormatUnit(parsedUnit, unitIndex);
        if (!resolved) {
          warnings.push(`Unit not found in army data: "${parsedUnit.name}"`);
          continue;
        }

        const { unitEntry, resolvedParsedUnit } = resolved;
        const owbCategory = unitEntry.category;

        const { copies, strength } = interpretDashModelCount(
          resolvedParsedUnit,
          unitEntry.unit
        );

        for (let c = 0; c < copies; c++) {
          const unitToBuild = { ...resolvedParsedUnit, _modelCount: strength > 1 ? strength : 0 };
          const result = buildUnit(unitToBuild, unitIndex, magicItemIndex, armyComposition, warnings);
          if (result) {
            list[owbCategory].push(result);
          }
        }
      }
      continue;
    }

    const owbCategory = mapCategoryName(catName);
    if (!list[owbCategory]) {
      warnings.push(`Unknown category "${catName}", skipping`);
      continue;
    }

    // For allies, build a cross-army index to find units from other armies
    const searchIndex = owbCategory === "allies"
      ? (allArmiesIndex || (allArmiesIndex = buildAllArmiesIndex(armyId)))
      : unitIndex;

    for (const parsedUnit of units) {
      const copies = parsedUnit.count || 1;

      for (let c = 0; c < copies; c++) {
        // For units with _modelCount (OWB format), handle copies vs strength
        let unitToBuild = parsedUnit;
        let numCopies = copies;
        if (parsedUnit._modelCount && parsedUnit._modelCount > 0 && c === 0) {
          const entry = findUnitEntry(parsedUnit.name, searchIndex);
          if (entry) {
            const { copies: mc, strength } = interpretDashModelCount(parsedUnit, entry.unit);
            if (mc > 1) {
              numCopies = mc;
              unitToBuild = { ...parsedUnit, _modelCount: 0 };
            } else {
              unitToBuild = { ...parsedUnit, _modelCount: strength };
            }
          }
        }

        const result = buildUnit(unitToBuild, searchIndex, magicItemIndex, armyComposition, warnings);
        if (result) {
          list[owbCategory].push(result);
        }

        // If we determined more copies are needed, add them
        if (c === 0 && numCopies > copies) {
          for (let extra = copies; extra < numCopies; extra++) {
            const extraResult = buildUnit(unitToBuild, searchIndex, magicItemIndex, armyComposition, warnings);
            if (extraResult) {
              list[owbCategory].push(extraResult);
            }
          }
        }
      }
    }
  }

  return { list, warnings };
}

/**
 * Find a unit entry by name in a unit index.
 */
function findUnitEntry(name, unitIndex) {
  const key = normalize(name);
  let entry = unitIndex.get(key);
  if (entry) return entry;
  for (const [, e] of unitIndex.entries()) {
    if (fuzzyMatch(name, e.unit.name_en) >= 0.7) return e;
  }
  return null;
}

/**
 * Build an index across ALL army datasets (for finding allied units).
 */
function buildAllArmiesIndex(excludeArmyId) {
  const index = new Map();
  const armyFiles = fs.readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json") && f !== "magic-items.json");

  for (const file of armyFiles) {
    const aId = file.replace(".json", "");
    if (aId === excludeArmyId) continue; // Skip the main army — already in unitIndex
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
      const categories = ["characters", "core", "special", "rare"];
      for (const cat of categories) {
        for (const unit of data[cat] || []) {
          const key = normalize(unit.name_en);
          // Don't overwrite — first match wins
          if (!index.has(key)) {
            index.set(key, { unit, category: "allies" });
          }
        }
      }
    } catch (e) {
      // Skip unreadable files
    }
  }
  return index;
}

/**
 * For dash-format units, resolve the unit name by trying progressively longer
 * prefixes of the comma-separated name parts.
 *
 * E.g. "Miao Ying, The Storm Dragon, General, ..." → try "Miao Ying",
 * then "Miao Ying, The Storm Dragon", etc. until a match is found.
 * The remaining parts become the options text.
 */
function resolveDashFormatUnit(parsedUnit, unitIndex) {
  const nameParts = parsedUnit._nameParts || [parsedUnit.name];

  // Try progressively longer prefixes
  for (let len = 1; len <= Math.min(nameParts.length, 4); len++) {
    const candidateName = nameParts.slice(0, len).join(", ");
    const key = normalize(candidateName);

    // Try exact match
    let entry = unitIndex.get(key);
    if (entry) {
      return {
        unitEntry: entry,
        resolvedParsedUnit: {
          ...parsedUnit,
          name: candidateName,
          optionsText: nameParts.slice(len).join(", "),
        },
      };
    }

    // Try fuzzy match
    for (const [, e] of unitIndex.entries()) {
      if (fuzzyMatch(candidateName, e.unit.name_en) >= 0.8) {
        return {
          unitEntry: e,
          resolvedParsedUnit: {
            ...parsedUnit,
            name: e.unit.name_en,
            optionsText: nameParts.slice(len).join(", "),
          },
        };
      }
    }
  }

  // Fall back to single-part name with fuzzy matching at lower threshold
  for (const [, e] of unitIndex.entries()) {
    if (fuzzyMatch(nameParts[0], e.unit.name_en) >= 0.7) {
      return {
        unitEntry: e,
        resolvedParsedUnit: {
          ...parsedUnit,
          name: e.unit.name_en,
          optionsText: nameParts.slice(1).join(", "),
        },
      };
    }
  }

  return null;
}

/**
 * Determine if a _modelCount in dash format represents duplicate units
 * (war machines, single-model units) or model count (rank-and-file).
 * Returns { copies, strength }.
 */
function interpretDashModelCount(parsedUnit, templateUnit) {
  const count = parsedUnit._modelCount || 0;
  if (count <= 0) {
    return { copies: 1, strength: templateUnit.minimum || 1 };
  }

  // If the unit has no minimum (war machine/single model), count = number of copies
  if (!templateUnit.minimum || templateUnit.minimum <= 1) {
    return { copies: count, strength: 1 };
  }

  // Otherwise count = model count in the unit
  return { copies: 1, strength: count };
}

/**
 * Check if an armyComposition restriction allows the given composition.
 * Can be a string, an array of strings, or an object with keys.
 */
function matchesArmyComposition(restriction, armyComposition) {
  if (!restriction) return true;
  if (typeof restriction === "string") return restriction === armyComposition;
  if (Array.isArray(restriction)) return restriction.includes(armyComposition);
  if (typeof restriction === "object") return armyComposition in restriction;
  return false;
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
 * Determine unit strength (model count) from sub-lines or _modelCount.
 */
function determineStrength(parsedUnit, templateUnit) {
  // Dash format provides _modelCount directly (e.g., "8 Jade Lancer" → 8)
  if (parsedUnit._modelCount && parsedUnit._modelCount > 0) {
    return parsedUnit._modelCount;
  }

  if (!parsedUnit.subLines || parsedUnit.subLines.length === 0) {
    // Single model unit (character) - no sub-lines
    return templateUnit.minimum || 1;
  }

  // Sum up the counts from sub-lines that represent regular models
  let total = 0;
  for (const sub of parsedUnit.subLines) {
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
    splitOptions(parsedUnit.optionsText).forEach((n) => {
      addNameWithBrackets(n, names);
    });
  }

  // From sub-lines
  if (parsedUnit.subLines) {
    for (const sub of parsedUnit.subLines) {
      if (sub.optionsText) {
        splitOptions(sub.optionsText).forEach((n) => {
          addNameWithBrackets(n, names);
        });
      }
      // The sub-line name itself might be a command group name
      names.add(normalize(sub.name));
    }
  }

  return names;
}

/**
 * Add a name to the set, extracting bracket sub-options.
 * "Wizard [Level 4 Wizard]" → adds "wizard", "level 4 wizard", "wizard level 4 wizard"
 * "Mark of Chaos [Mark of Tzeentch]" → adds "mark of chaos", "mark of tzeentch", etc.
 * "Standard bearer [Icon of Darkness]" → adds "standard bearer", "icon of darkness"
 */
function addNameWithBrackets(name, names) {
  const bracketMatch = name.match(/^(.+?)\s*\[(.+?)\]\s*$/);
  if (bracketMatch) {
    const parent = bracketMatch[1].trim();
    const child = bracketMatch[2].trim();
    names.add(normalize(parent));
    names.add(normalize(child));
    // Also add the combined form for matching compound option names
    names.add(normalize(parent + " " + child));
  } else {
    names.add(normalize(name));
  }
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

  // First pass: find matches
  let hasExplicitNonDefaultMatch = false;
  const matches = new Map();

  for (const equip of unit.equipment) {
    const equipName = normalize(equip.name_en);
    const equipParts = equip.name_en
      .split(",")
      .map((p) => normalize(p.trim()));

    let isMatch = false;
    for (const mentioned of mentionedNames) {
      if (
        strictMatch(mentioned, equipName) ||
        equipParts.some((p) => strictMatch(mentioned, p))
      ) {
        isMatch = true;
        break;
      }
    }

    matches.set(equip, isMatch);
    if (isMatch && !equip.active && !equip.equippedDefault) {
      hasExplicitNonDefaultMatch = true;
    }
  }

  // Second pass: activate. When a non-default is matched, deactivate defaults
  for (const equip of unit.equipment) {
    const isMatch = matches.get(equip);
    const isDefault = equip.active || equip.equippedDefault;

    if (isMatch) {
      equip.active = true;
    } else if (isDefault && !hasExplicitNonDefaultMatch) {
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

  // First pass: find which armor entries are explicitly mentioned
  let hasExplicitMatch = false;
  const matches = new Map();

  for (const armor of unit.armor) {
    const armorName = normalize(armor.name_en);
    const armorParts = armor.name_en
      .replace(/[()]/g, ",")
      .split(",")
      .map((p) => normalize(p.trim()))
      .filter(Boolean);

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

    matches.set(armor, isMatch);
    if (isMatch) hasExplicitMatch = true;
  }

  // Second pass: activate matched armor; only keep defaults if no explicit match
  for (const armor of unit.armor) {
    const isMatch = matches.get(armor);
    const isDefault = armor.active;

    if (isMatch) {
      armor.active = true;
    } else if (isDefault && !hasExplicitMatch) {
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
    if (opt.armyComposition && !matchesArmyComposition(opt.armyComposition, armyComposition)) {
      continue;
    }

    const optName = normalize(opt.name_en);

    // Handle nested options (e.g., Wizard → Level 1/2/3/4, Ogre Loader → Gunpowder bombs)
    if (opt.options && Array.isArray(opt.options)) {
      // Check if parent option is mentioned or alwaysActive
      let parentMatch = opt.alwaysActive;
      if (!parentMatch) {
        for (const mentioned of mentionedNames) {
          if (fuzzyMatch(mentioned, optName) >= 0.7) {
            parentMatch = true;
            break;
          }
        }
      }

      if (parentMatch) {
        opt.active = true;
      }

      // Check which sub-option matches
      let foundSubMatch = false;
      for (const subOpt of opt.options) {
        const subName = normalize(subOpt.name_en);
        let isMatch = false;

        for (const mentioned of mentionedNames) {
          // For wizard level sub-options, only match on exact level numbers
          if (subName.includes("wizard") && subName.includes("level")) {
            // Only consider mentioned names that include both "wizard" and "level"
            if (mentioned.includes("wizard") && mentioned.includes("level")) {
              const mentionedLevel = mentioned.match(/level\s*(\d)/);
              const subLevel = subName.match(/level\s*(\d)/);
              if (mentionedLevel && subLevel && mentionedLevel[1] === subLevel[1]) {
                isMatch = true;
                break;
              }
            }
            // Skip generic matches like "wizard" alone — they shouldn't
            // activate a specific wizard level
            continue;
          }
          if (fuzzyMatch(mentioned, subName) >= 0.7) {
            isMatch = true;
            break;
          }
        }

        if (isMatch) {
          subOpt.active = true;
          foundSubMatch = true;
          // Also activate parent if a sub-option matches
          opt.active = true;
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
 * Also assigns magic items to command positions that have magic budgets.
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

  // For dash format: parse the flat options list to associate magic items
  // with the command position they follow.
  // E.g., "Jade Lancer Officer, Sword of Might, Standard Bearer, War Banner, Musician"
  // → Officer gets Sword of Might, Standard Bearer gets War Banner
  const commandMagicAssignments = buildCommandMagicAssignments(
    unit,
    parsedUnit,
    magicItemIndex
  );

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

    // Apply magic assignments from flat options parsing
    if (commandMagicAssignments.has(cmdName) && cmd.magic) {
      const items = commandMagicAssignments.get(cmdName);
      if (!cmd.magic.selected) {
        cmd.magic.selected = [];
      }
      for (const item of items) {
        cmd.magic.selected.push({
          name_en: item.name_en,
          points: item.points,
          type: item.type,
          name: item.name,
        });
      }
      isMatch = true;
    }

    if (isMatch) {
      cmd.active = true;
    }
  }
}

/**
 * Parse a flat options list and figure out which magic items belong to which
 * command position. Items listed between two command names belong to the
 * preceding command.
 */
function buildCommandMagicAssignments(unit, parsedUnit, magicItemIndex) {
  const assignments = new Map();
  if (!unit.command || !parsedUnit.optionsText) return assignments;

  // Build set of command names for this unit
  const cmdNames = unit.command.map((c) => normalize(c.name_en));

  // Split the options text
  const parts = splitOptions(parsedUnit.optionsText);

  let currentCmd = null;

  for (const rawPart of parts) {
    // Handle bracket notation: "Standard bearer [Icon of Darkness]"
    const bracketMatch = rawPart.match(/^(.+?)\s*\[(.+?)\]\s*$/);
    if (bracketMatch) {
      const parentNorm = normalize(bracketMatch[1]);
      const childNorm = normalize(bracketMatch[2]);

      // Check if parent is a command name
      for (const cn of cmdNames) {
        if (fuzzyMatch(parentNorm, cn) >= 0.7) {
          // Child is a magic item for this command
          const item = magicItemIndex.get(childNorm);
          if (item) {
            if (!assignments.has(cn)) assignments.set(cn, []);
            assignments.get(cn).push(item);
          } else {
            for (const [, mi] of magicItemIndex.entries()) {
              if (fuzzyMatch(childNorm, mi.name_en) >= 0.9) {
                if (!assignments.has(cn)) assignments.set(cn, []);
                assignments.get(cn).push(mi);
                break;
              }
            }
          }
          currentCmd = cn;
          break;
        }
      }
      continue;
    }

    const partNorm = normalize(rawPart);

    // Check if this part is a command name
    let isCmd = false;
    for (const cn of cmdNames) {
      if (fuzzyMatch(partNorm, cn) >= 0.7) {
        currentCmd = cn;
        isCmd = true;
        break;
      }
    }
    if (isCmd) continue;

    // Check if this part is a magic item following a command name
    if (currentCmd) {
      const item = magicItemIndex.get(partNorm);
      if (item) {
        if (!assignments.has(currentCmd)) {
          assignments.set(currentCmd, []);
        }
        assignments.get(currentCmd).push(item);
      } else {
        // Try fuzzy (high threshold to avoid false positives)
        for (const [, mi] of magicItemIndex.entries()) {
          if (fuzzyMatch(partNorm, mi.name_en) >= 0.9) {
            if (!assignments.has(currentCmd)) {
              assignments.set(currentCmd, []);
            }
            assignments.get(currentCmd).push(mi);
            break;
          }
        }
      }
    }
  }

  return assignments;
}

/**
 * Assign magic items to the unit's items slots.
 */
function assignMagicItems(unit, mentionedNames, magicItemIndex, warnings) {
  if (!unit.items || unit.items.length === 0) return;

  // Collect items already assigned to command positions to avoid duplicates
  const commandItemNames = new Set();
  for (const cmd of unit.command || []) {
    if (cmd.magic && cmd.magic.selected) {
      for (const sel of cmd.magic.selected) {
        commandItemNames.add(normalize(sel.name_en));
      }
    }
  }

  // Common game terms that should never match magic items
  const nonItemNames = new Set([
    "wizard", "general", "champion", "musician", "standard bearer",
    "hand weapon", "hand weapons", "heavy armour", "light armour",
    "full plate armour", "shields", "shield", "barding",
    "on foot", "battle magic", "mark of chaos", "formation",
    "ambushers", "drilled", "stubborn", "vanguard", "detachment",
    "skirmishers", "chaotic cult", "none",
  ]);

  // Build a list of magic items that are mentioned
  const foundItems = [];
  for (const mentioned of mentionedNames) {
    // Skip common game terms
    if (nonItemNames.has(mentioned)) continue;
    // Skip if already assigned to a command position
    const item = magicItemIndex.get(mentioned);
    if (item) {
      if (!commandItemNames.has(normalize(item.name_en))) {
        foundItems.push(item);
      }
    } else {
      // Try fuzzy match — require high threshold to avoid false positives
      for (const [key, mi] of magicItemIndex.entries()) {
        if (fuzzyMatch(mentioned, mi.name_en) >= 0.9) {
          if (!commandItemNames.has(normalize(mi.name_en))) {
            foundItems.push(mi);
          }
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
