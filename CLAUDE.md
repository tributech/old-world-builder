# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a fork of [nthiebes/old-world-builder](https://github.com/nthiebes/old-world-builder) — a React PWA for building Warhammer: The Old World army lists. Our fork adds OWR (Old World Realm) cloud sync integration.

- **Upstream**: `https://github.com/nthiebes/old-world-builder.git`
- **Origin**: Our fork at `personal:tributech/old-world-builder.git`
- **Live site**: [old-world-builder.com](https://old-world-builder.com/)

## Common Commands

```bash
yarn start          # Dev server (CRA, hot reload)
yarn build          # Production build
yarn test           # Jest in watch mode
yarn deploy         # Build + deploy to GitHub Pages
```

## Git Workflow

This repo tracks an upstream repo. When syncing:

```bash
git fetch upstream
git rebase upstream/main
git push origin main --force-with-lease
git tag -f owr_latest
git push origin owr_latest --force
```

The `owr_latest` tag **must always be updated** after any push to `main` (not just rebases). Other repos (e.g. `owr-android`) pull from this tag, so it must always point to the latest commit. A GitHub Action (`.github/workflows/sync-upstream.yml`) automates the upstream rebase + retag daily at 6am UTC.

## Architecture

**Stack**: React 17 + Redux Toolkit + React Router v5 + react-intl (i18n) + Create React App

### Key directories

- `src/pages/` — Route-level page components (home, editor, unit, magic, print, etc.)
- `src/components/` — Reusable UI primitives (Button, Dialog, Icon, Select, etc.)
- `src/state/` — Redux Toolkit slices: `lists`, `army`, `items`, `errors`, `settings`, `rules-index`
- `src/utils/` — Business logic (~8700 LOC): validation, points calculation, rules database, OWR sync
- `src/i18n/` — 7 language files (en, de, fr, es, it, pl, cn)
- `public/games/the-old-world/` — Army dataset JSON files (one per faction + `magic-items.json`)
- `src/assets/` — SVG army icons, lores-of-magic data, game manifest

### Core data flow

1. Army datasets loaded from `/public/games/{game}/{army}.json`
2. User edits stored in Redux state + localStorage (`owb.settings`, `owb.lists`)
3. Points/validation calculated by `src/utils/points.js` and `src/utils/validation.js`
4. If authenticated, changes sync to OWR cloud via `src/utils/owr-sync.js`

### OWR Cloud Sync (`src/utils/owr-sync.js`)

Our fork's main addition. Bidirectional sync with the OWR backend:
- `pullFromOWR()` — merges cloud lists with localStorage on app load
- `pushToOWR()` — debounced (2s) push of changes to cloud
- Auth: JWT via `window.__OWR_AUTH__` (mobile) or cookies (web)
- API base URL: `window.__OWR_CONFIG__?.apiBaseUrl` (mobile) or same-origin (web)
- 7-day soft delete retention for cloud reconciliation

## Fork Extension Rules (Sprout Methods)

To keep upstream rebases clean, treat this repo as an upstream-first fork.

- **Default rule**: Do not modify shared upstream utilities/components when OWR behavior can be added via a wrapper/sprout module.
- **Prefer sprout files** for fork-specific logic (example naming: `src/utils/owr-*.js`).
- **Use composition/wrappers**:
  - Wrap core helpers and call the wrapper from pages/components.
  - Keep upstream files thin and generic.
- **If core-file edits are unavoidable**:
  - Keep changes minimal and localized.
  - Add a short comment explaining why sprouting was not sufficient.
  - Avoid stylistic/refactor churn in the same change.
- **When adding new fork behavior**, first ask: “Can this be sprouted?” If yes, sprout instead of patching upstream code paths.

### Routing

- Desktop: multi-column layout (sidebar + list + editor + detail)
- Mobile: single-column with nested routes
- Uses `HashRouter` for mobile app (file:// URLs), `BrowserRouter` for web
- Base path: `/builder` in production

### Army Dataset Structure

Each army JSON has categories: `characters`, `core`, `special`, `rare`, `mercenaries`, `allies`. Units have multilingual names (`name_en`, `name_de`, etc.), points, min/max model counts, and nested arrays for `command`, `equipment`, `armor`, `options`, `mounts`, `items`. Full schema in `docs/datasets.md`.

### Validation & Rules

- `src/utils/validation.js` (986 LOC) — army composition rules, wizard limits, character restrictions
- `src/utils/rules.js` (4074 LOC) — centralized game rules database, troop types, special rules
- `src/utils/points.js` — per-unit and per-model points calculations with magic item budgets

### OWR Theme / "Battle Builder" Rebrand

Our fork rebrands the app as "Battle Builder" with a clean OWR design system. All visual overrides live in `public/owr-overrides.css` — **no upstream CSS files are modified**, keeping rebases clean. The override file is loaded via a `<link>` tag in `public/index.html` before the React bundle.

Key points:
- CSS custom property overrides in `:root` can be outprioritied by `src/App.css` (CRA bundle loads later) — use direct class selectors with `!important` when needed
- Header includes OWR logo (`src/assets/owr-logo-white.svg`) next to "Battle Builder" text
- Footer nav links are hidden (covered by OWR website/Rails app)
- Full details in `docs/theming.md`

## i18n

All user-facing strings use react-intl message IDs. 7 languages supported. When adding UI text, add the key to all files in `src/i18n/`.
