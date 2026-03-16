# Comp Packs

Comp packs allow tournament organisers and players to define custom army composition restrictions beyond the standard game formats (Open War, Grand Melee, Combined Arms, Battle March).

A comp pack is a reusable set of rules that can be applied to any list. Each comp pack has a stable ID, making it easy to share and reference across external systems (e.g. tournament platforms).

## How it works

```
┌─────────────────────────────────────────────────┐
│                    List                          │
│                                                  │
│  armyComposition ──► Base rules (rules.js)       │
│                      Category %, unit min/max    │
│                                                  │
│  compositionRule ──► Game format validation       │
│                      Grand Melee, Combined Arms  │
│                                                  │
│  compPackId ─────► Comp pack (localStorage)      │
│                    Custom restrictions on top     │
└─────────────────────────────────────────────────┘
```

All three layers stack. The base army composition rules always apply, the game format adds its constraints, and the comp pack adds further restrictions on top of both.

## Features

### Category total % limits

Override the min/max percentage of army points allowed for a category.

Example: restrict Rare to 20% instead of the default 25%.

```json
{
  "categories": {
    "rare": { "maxPercent": 20 },
    "characters": { "maxPercent": 40 }
  }
}
```

### Max duplicates per category

Limit how many copies of the same unit can appear in a category.

Example: only 1 of each Rare unit (no duplicate Rare choices).

```json
{
  "categories": {
    "rare": { "maxDuplicates": 1 }
  }
}
```

### Rule-based limits

Constrain units that have a specific special rule. Checks both inherent special rules (on the unit's profile) and active selectable options/mounts.

Example: max 33% of army points on units with Fly.

```json
{
  "ruleLimits": [
    { "rule": "Fly", "maxPercent": 33 },
    { "rule": "Ethereal", "maxCount": 3 }
  ]
}
```

Supports optional faction filter — see [Faction filters](#faction-filters) below.

### Option / command limits

Disable or restrict specific options and commands (e.g. Battle Standard Bearer, wizard levels).

Example: ban BSB for Vampire Counts and Tomb Kings.

```json
{
  "optionLimits": [
    {
      "option": "battle-standard-bearer",
      "disabled": true,
      "armies": ["vampire-counts", "tomb-kings-of-khemri"]
    }
  ]
}
```

### Unit-specific limits

Override or add hard caps on specific units by ID, across all categories.

Example: max 2 Sky Lanterns for Grand Cathay.

```json
{
  "unitLimits": [
    {
      "ids": ["sky-lantern-special"],
      "max": 2,
      "armies": ["grand-cathay"]
    }
  ]
}
```

### Single unit max % limits

Cap how much of the army's points any single unit can cost, per category. Prevents deathstar units.

Example: no single character can exceed 25% of army points.

```json
{
  "perUnitMaxPercent": {
    "characters": 25,
    "special": 30,
    "rare": 25
  }
}
```

### Army-specific overrides

Adjust points budgets and category limits per faction. Useful for "square-based comp" style packs where weaker factions get bonus points.

Example: Tomb Kings get +200 points, Bretonnia gets +150.

```json
{
  "armyOverrides": {
    "tomb-kings-of-khemri": {
      "pointsAdjustment": 200,
      "categories": {
        "characters": { "maxPercent": 60 }
      }
    },
    "kingdom-of-bretonnia": {
      "pointsAdjustment": 150
    }
  }
}
```

When a points adjustment is active, the editor header displays it: `2200 / 2200 pts (2000+200)`.

### Faction filters

`ruleLimits`, `optionLimits`, and `unitLimits` all support an optional `armies` array. When present, the limit only applies to lists using one of the specified armies. When omitted, the limit applies to all armies.

```json
{
  "ruleLimits": [
    { "rule": "Fly", "maxPercent": 33 },
    { "rule": "Fly", "maxPercent": 50, "armies": ["daemons-of-chaos"] }
  ]
}
```

When multiple limits match the same rule for an army, all are enforced.

## Full schema

```json
{
  "id": "string",
  "name": "string",

  "categories": {
    "[category]": {
      "minPercent": "number (optional)",
      "maxPercent": "number (optional)",
      "maxDuplicates": "number (optional)"
    }
  },

  "ruleLimits": [
    {
      "rule": "string",
      "maxPercent": "number (optional)",
      "maxCount": "number (optional)",
      "armies": ["string (optional)"]
    }
  ],

  "optionLimits": [
    {
      "option": "string",
      "disabled": "boolean (optional)",
      "maxCount": "number (optional)",
      "armies": ["string (optional)"]
    }
  ],

  "unitLimits": [
    {
      "ids": ["string"],
      "max": "number (optional)",
      "maxPercent": "number (optional)",
      "armies": ["string (optional)"]
    }
  ],

  "perUnitMaxPercent": {
    "[category]": "number"
  },

  "armyOverrides": {
    "[armyId]": {
      "pointsAdjustment": "number (optional)",
      "categories": "same as top-level (optional)",
      "perUnitMaxPercent": "same as top-level (optional)"
    }
  }
}
```

### Categories

Valid category keys: `characters`, `core`, `special`, `rare`, `mercenaries`, `allies`.

### Army IDs

Valid army IDs match those in `the-old-world.json`: `empire-of-man`, `kingdom-of-bretonnia`, `dwarfen-mountain-holds`, `high-elf-realms`, `wood-elf-realms`, `dark-elves`, `orc-and-goblin-tribes`, `warriors-of-chaos`, `beastmen-brayherds`, `tomb-kings-of-khemri`, `vampire-counts`, `skaven`, `daemons-of-chaos`, `ogre-kingdoms`, `lizardmen`, `chaos-dwarfs`, `grand-cathay`.

### Option IDs

Option IDs are lowercase, hyphenated versions of command names: `battle-standard-bearer`, `general`, `the-hierophant`, `level-1-wizard`, `level-2-wizard`, `level-3-wizard`, `level-4-wizard`.

## How rule detection works

When enforcing `ruleLimits`, the system checks each unit for the named special rule in this order:

1. **Unit's inherent special rules** — `specialRules.name_en` on the unit (or under the army composition variant)
2. **Active selectable options** — recursive search through `options` for active options matching the rule name
3. **Active mount's special rules** — looks up the mount name in the army dataset and fetches its rules from the [TOW Rules Index](https://tow.whfb.app/) if not already known

This means a Tomb King on a Necrolith Bone Dragon will correctly count as having Fly, even though the Fly rule comes from the mount rather than the character.

## Sharing comp packs

Comp packs are stored in `localStorage` under the key `owb.compPacks`.

From the Comp Packs page (`/comp-packs`):
- **Export**: downloads a `.json` file containing the comp pack
- **Import**: upload a `.json` file to add a comp pack

The comp pack's `id` field is stable and can be used by external systems to identify which comp is applied to a list. The `compPackId` field on the list object carries this reference.

## Example: Tournament comp pack

```json
{
  "id": "nz-masters-2026",
  "name": "NZ Masters 2026",
  "categories": {
    "rare": { "maxPercent": 20, "maxDuplicates": 1 },
    "characters": { "maxPercent": 40 }
  },
  "ruleLimits": [
    { "rule": "Fly", "maxPercent": 33 }
  ],
  "optionLimits": [
    {
      "option": "battle-standard-bearer",
      "disabled": true,
      "armies": ["vampire-counts", "tomb-kings-of-khemri"]
    }
  ],
  "unitLimits": [
    {
      "ids": ["sky-lantern-special"],
      "max": 1,
      "armies": ["grand-cathay"]
    }
  ],
  "perUnitMaxPercent": {
    "characters": 25,
    "rare": 25
  },
  "armyOverrides": {
    "tomb-kings-of-khemri": { "pointsAdjustment": 200 },
    "kingdom-of-bretonnia": { "pointsAdjustment": 150 },
    "orc-and-goblin-tribes": { "pointsAdjustment": 100 }
  }
}
```

## Known limitations

- **Mount special rules**: Mount entries in the army JSON don't carry `specialRules`. The system fetches these from `tow.whfb.app` at runtime. Adding `specialRules` to mount entries in the dataset would remove this dependency.
- **Option limits matching**: Option/command matching uses string includes on the `name_en` field. Custom or unusually named commands may not match.
- **No nested army overrides for rule/option/unit limits**: Army-specific rule, option, and unit limits use the top-level `armies` filter rather than nesting inside `armyOverrides`. This keeps the schema flat but means you can't have completely different rule limit sets per army — only include/exclude.
