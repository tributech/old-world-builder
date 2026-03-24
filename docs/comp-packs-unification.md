# Comp Packs — Unification with Composition Rules

## Current Architecture (3 axes)

```
List
 ├── armyComposition: "tomb-kings-of-khemri"     ← unit availability, category %, unit rules
 ├── compositionRule: "grand-melee"               ← hardcoded validation in validation.js
 └── compPackId: "aussie-comp-2026"               ← user-created validation
```

`compositionRule` and `compPackId` do the same thing — layer validation restrictions on top. The only difference is one is hardcoded, one is data-driven.

## Proposed Architecture (2 axes)

```
List
 ├── armyComposition: "tomb-kings-of-khemri"      ← unit availability (unchanged)
 └── compositionRules: ["grand-melee", "aussie-comp-2026"]  ← stackable rule packs
```

All composition rules — built-in and custom — become comp packs. Multiselect, stackable. Built-in packs are read-only presets. Custom packs are user-created via the editor.

## Built-in Packs as Data

### Grand Melee

**Current hardcoded behaviour:**
- No single character or unit can exceed 25% of army points
- 0-1 Level 3 Wizard per 1000 points
- 0-1 Level 4 Wizard per 2000 points

**As comp pack data:**

```json
{
  "id": "grand-melee",
  "name": "Grand Melee",
  "builtIn": true,
  "perUnitMaxPercent": {
    "characters": 25,
    "core": 25,
    "special": 25,
    "rare": 25,
    "mercenaries": 25,
    "allies": 25
  },
  "optionLimits": [
    { "option": "level-3-wizard", "maxPerPoints": 1, "pointsInterval": 1000 },
    { "option": "level-4-wizard", "maxPerPoints": 1, "pointsInterval": 2000 }
  ]
}
```

**Schema gap:** `maxPerPoints` + `pointsInterval` — a new concept. "0-1 per 1000 points" means `Math.floor(armyPoints / 1000)` is the max count. This is a scaling limit that our current schema doesn't support.

### Combined Arms

**Current hardcoded behaviour:**
- Max unit duplicates per category, scaling with points:
  - Characters: `3 + Math.max(floor((pts - 2000) / 1000), 0)`
  - Core: `4 + ...`
  - Special: `3 + ...`
  - Rare/Merc: `2 + ...`
- Only applies to units NOT already restricted by army-specific rules

**As comp pack data:**

```json
{
  "id": "combined-arms",
  "name": "Combined Arms",
  "builtIn": true,
  "categoryDuplicateLimits": {
    "characters": { "base": 3, "perPoints": 1, "pointsInterval": 1000, "above": 2000 },
    "core":       { "base": 4, "perPoints": 1, "pointsInterval": 1000, "above": 2000 },
    "special":    { "base": 3, "perPoints": 1, "pointsInterval": 1000, "above": 2000 },
    "rare":       { "base": 2, "perPoints": 1, "pointsInterval": 1000, "above": 2000 },
    "mercenaries":{ "base": 2, "perPoints": 1, "pointsInterval": 1000, "above": 2000 }
  }
}
```

**Schema gaps:**
1. `categoryDuplicateLimits` with scaling — our `maxDuplicates` is a flat number, this needs `base + perPoints * floor((pts - above) / interval)`
2. The "only applies to unrestricted units" exemption — Combined Arms skips units that already have a `max` in the army composition rules

### Battle March

**Current hardcoded behaviour:**
- Per-unit % caps: 25% characters, 35% core, 30% special, 25% rare/merc
- Min 2 non-character units (instead of normal 3)
- Only one '0-X per 1000 points' unit type allowed

**As comp pack data:**

```json
{
  "id": "battle-march",
  "name": "Battle March",
  "builtIn": true,
  "perUnitMaxPercent": {
    "characters": 25,
    "core": 35,
    "special": 30,
    "rare": 25,
    "mercenaries": 25
  },
  "minNonCharacterUnits": 2,
  "max0XUnitTypes": 1
}
```

**Schema gaps:**
1. `minNonCharacterUnits` — overrides the default "3 non-character units" rule
2. `max0XUnitTypes` — "only one 0-X per 1000pts unit type across the army" — very specific to Battle March

### Grand Melee + Combined Arms (combo)

Currently `compositionRule: "grand-melee-combined-arms"` — just both rules applied. In the new model this is simply `compositionRules: ["grand-melee", "combined-arms"]`. No special handling needed.

## Schema Extensions Needed

To cover all built-in rules, the comp pack schema needs these additions:

| Feature | Current | Needed |
|---------|---------|--------|
| Per-unit % caps | `perUnitMaxPercent` ✅ | Already works |
| Flat max duplicates | `categories.X.maxDuplicates` ✅ | Already works |
| Scaling max duplicates | — | `categoryDuplicateLimits` with `base`/`perPoints`/`pointsInterval`/`above` |
| Scaling option limits | — | `optionLimits.X.maxPerPoints` + `pointsInterval` |
| Min non-character units | — | `minNonCharacterUnits` |
| Max 0-X unit types | — | `max0XUnitTypes` (Battle March specific) |
| Skip already-restricted units | — | `respectArmyLimits: true` flag on duplicate limits |

## Feasibility Assessment

### Easy to convert (no schema changes):
- **Grand Melee per-unit 25%** → `perUnitMaxPercent` ✅
- **Battle March per-unit %** → `perUnitMaxPercent` ✅

### Needs new schema field but straightforward:
- **Scaling wizard limits** → add `pointsInterval` to `optionLimits`
- **Min non-character override** → add `minNonCharacterUnits`
- **Scaling duplicate limits** → add `categoryDuplicateLimits` or extend `maxDuplicates` to support scaling

### Tricky / needs thought:
- **Combined Arms "skip restricted units"** — this interacts with the army composition rules from `rules.js`. The comp pack would need awareness of whether a unit already has a max from the base army rules. Could be handled with a `respectArmyLimits: true` flag.
- **Battle March 0-X restriction** — very specific rule about unit types that have "0-X per 1000 points" in their army rules. Niche, could stay as a special-case flag.

## Recommendation

The migration is feasible but needs **3-4 schema extensions**. I'd approach it in phases:

### Phase 1: Add scaling support (enables Grand Melee + Battle March as data)
- Add `pointsInterval` to `optionLimits` (for wizard level scaling)
- Add `minNonCharacterUnits` to schema
- Convert Grand Melee and Battle March to built-in comp packs
- Change `compositionRule` to `compositionRules` (array, multiselect)

### Phase 2: Add scaling duplicates (enables Combined Arms as data)
- Add `categoryDuplicateLimits` with scaling formula
- Add `respectArmyLimits` flag
- Convert Combined Arms to built-in comp pack
- Remove all hardcoded validation from `validation.js`

### Phase 3: UI unification
- Single multiselect for all composition rules (built-in + custom)
- Built-in packs shown as read-only in the comp pack editor (viewable but not editable)
- Remove the separate "Composition Rule" dropdown
