# Army List Text Parser

A standalone Node.js utility that converts army list text (from tools like New Recruit, or copy-pasted from forums) into `.owb.json` files importable by Old World Builder.

## Usage

```bash
node tools/parse-army-list.js <input.txt> <army-slug> [armyComposition] [--out output.owb.json]

# Examples
node tools/parse-army-list.js my-list.txt wood-elf-realms
node tools/parse-army-list.js my-list.txt wood-elf-realms host-of-talsyn
node tools/parse-army-list.js my-list.txt grand-cathay --out cathay-2500.owb.json
```

The tool reads army dataset JSONs from `public/games/the-old-world/<army>.json` and magic items from `public/games/the-old-world/magic-items.json`.

## Architecture

```
Input Text ──► Format Detection ──► Text Parser ──► Intermediate Representation ──► OWB JSON Builder ──► .owb.json
```

### Pipeline stages

1. **Format detection** — auto-detects which text format the input uses by counting line patterns
2. **Text parsing** — extracts unit names, model counts, options, equipment, and magic items into a flat intermediate representation (IR)
3. **Unit matching** — fuzzy-matches each IR entry against the army dataset to find the correct unit template
4. **Option activation** — deep-clones the unit template and sets `active: true` on matched equipment, armour, options, mounts, command, and magic items
5. **JSON assembly** — wraps activated units into the OWB list format with correct category slots and point totals

## Supported Text Formats

### Format A — Bracket/pts format (New Recruit style)

```
Glade Lord [185pts]
  - Forest Dragon, Full Plate Armour, Serrated Maw [310pts]
  - Hail of Doom Arrow [30pts]
  - The Bow of Loren [25pts]

12 Glade Guard [144pts]
  - Standard Bearer [10pts]
  - Musician [10pts]
```

Detected by: lines containing `[XXXpts]`

### Format B — Dash/points-first format

```
185 - Glade Lord
310 - Forest Dragon, Full Plate Armour, Serrated Maw
30 - Hail of Doom Arrow
25 - The Bow of Loren

144 - 12 Glade Guard
10 - Standard Bearer
10 - Musician
```

Detected by: lines matching `number - text`

### Format C — OWB's own text export

```
++ Characters ++

Glade Lord
- Forest Dragon
- Full Plate Armour
- Serrated Maw
- Hail of Doom Arrow
- The Bow of Loren

++ Core ++

12 Glade Guard
- Standard Bearer
- Musician
```

Detected by: lines matching `++ Category ++`

## Matching Strategy

### Unit name matching

- **Normalize** both needle and haystack: lowercase, strip punctuation, collapse whitespace
- **Fuzzy match** with word-overlap scoring: `score = matchedWords / max(needleWords, haystackWords)`
  - Stop words (`a`, `an`, `the`, `of`, `and`, `with`) require exact equality — they don't count toward fuzzy overlap. This prevents false positives like "serrated maw" matching "a blight of terrors"
  - Substring inclusion bonus: if one normalized string is a substring of the other, score is boosted to 0.9
- **Named characters** in dash format use progressive prefix matching: "Miao Ying" matches "Miao Ying, The Storm Dragon"
- **War machines** vs rank-and-file disambiguation uses the `minimum` field from army data

### Equipment & armour matching

- Uses **strict matching** instead of fuzzy: the needle must appear as-is in the haystack (after normalization)
- Handles compound entries: `"Iron hail guns, Dragon fire bombs"` is split on commas and each part matched independently
- Handles `and` vs `,` differences: `"iron hail guns and dragon fire bombs"` matches `"Iron hail guns, Dragon fire bombs"`

### Option activation

- **Two-pass activation**: first scan for explicit matches, then deactivate defaults if an explicit non-default was selected. This prevents both "Light Armour" and "Heavy Armour" being active simultaneously
- **Wizard level matching**: extracts the level number and matches exactly, skipping fuzzy fallback for all wizard/level sub-options. Prevents "Wizard Level 3" from matching all wizard levels
- **Nested options**: recursively traverses `options[].options[]` trees

### Magic items

- Builds an index from `magic-items.json` keyed by normalized name
- Scans available `items[]` slots on each unit, matching `types[]` against magic item sections
- **Command group magic items**: handles both bracket notation (`Standard bearer [Icon of Darkness]`) and positional assignment from flat option lists
- **Non-item blocklist**: prevents false positives like "wizard" matching "Wizarding Hat"

### Allies & cross-army units

- Builds a lazy all-armies index on first encounter of an unresolved unit
- Searches all army datasets for matching units and applies the correct army's data template

### Army composition filtering

- `armyComposition` field can be a string, an array, or an object with keys
- `matchesArmyComposition()` helper handles all three forms when filtering units/options that are restricted to specific army compositions

## Output Format

The generated `.owb.json` matches OWB's import format:

```json
{
  "id": "unique-hex-id",
  "name": "Imported: army-slug",
  "game": "the-old-world",
  "army": "army-slug",
  "armyComposition": "composition-slug",
  "points": 2500,
  "characters": [ /* unit objects */ ],
  "core": [ /* unit objects */ ],
  "special": [ /* unit objects */ ],
  "rare": [ /* unit objects */ ],
  "mercenaries": [],
  "allies": [ /* unit objects */ ]
}
```

Each unit object is a deep clone of the army dataset template with `active: true` set on selected options and a unique `id` in the format `baseId.randomHex`.

## Planned: Hybrid LLM Mode

The deterministic parser handles well-structured text reliably. A future enhancement will add an optional LLM extraction layer:

1. **LLM extracts** a lightweight mappings JSON from freeform/messy input text (unit names, counts, options)
2. **Deterministic builder** consumes the mappings JSON and produces the full `.owb.json` using the exact same unit-template cloning and option-activation logic

This keeps the authoritative game-data mapping deterministic (no hallucinated point values or missing fields) while leveraging LLM flexibility for the text-parsing step where format variation is highest.

## Module API

The parser exports key functions for programmatic use:

```js
const {
  parseText,           // (text, army, armyComp) → intermediate representation
  buildOwbList,        // (parsedUnits, army, armyComp, armyData, magicItems, magicIndex) → OWB JSON
  loadArmyData,        // (armySlug) → army dataset object
  loadMagicItems,      // () → magic items object
  buildMagicItemIndex, // (magicItems) → Map<normalizedName, itemObject>
  splitOptions,        // (optionString) → string[]
  normalize,           // (str) → lowercase normalized string
  fuzzyMatch,          // (needle, haystack) → 0..1 score
} = require("./tools/parse-army-list");
```
