# OWR Fork Changelog

Documents what each fork commit group contains on top of upstream.
These are maintained as a small set of squashed commits to keep rebases clean.

---

## 1. Fork infrastructure: CI, CDN icons, and PWA removal
- GitHub Action for daily upstream sync + `owr_latest` tag
- Inline SVG icons (CDN cross-origin `<use>` fix)
- Remove PWA/service worker (OWR serves as a web app, not standalone)
- CLAUDE.md, AGENTS.md, editor config
- OWR favicon/app icons

## 2. Battle Builder rebrand with OWR theme and nav cleanup
- Rename to "Battle Builder" throughout (index.html, manifest, i18n)
- OWR logo in header (`owr-logo-white.svg`, `owr-logo-black.svg`)
- Hide upstream footer nav (covered by OWR Rails app)
- i18n key updates for rebrand across all 7 languages

## 3. OWR cloud sync with optimized dirty-only push and delta response
- `src/utils/owr-sync.js` — bidirectional sync (pull on load, debounced push)
- `src/utils/owr-list.js` — meaningful change detection, list persistence
- `src/utils/storage.js` — user-scoped localStorage (`u.{key}.owb.*`)
- `src/utils/lexorank.js` + `src/utils/list-ordering.js` — drag-to-reorder with lexorank
- Auth: JWT via `window.__OWR_AUTH__` (mobile) or cookies (web)
- 7-day soft delete retention for cloud reconciliation
- SyncButton component with dirty/syncing/error states

## 4. Add tournament submission from export page with sidebar icons
- `src/pages/export/TournamentSubmit.jsx` — submit list to OWR tournament
- Sidebar icons on export page
- `owrApiFetch` helper for authenticated API calls

## 5. OWR Pro gate: upgrade dialog, Go Pro button, sync entitlement
- `SyncUpgradeDialog` — shown once for non-entitled users
- "Go Pro" pill button in header when not entitled
- `cloudSyncEntitled` flag from sync API response

## 6. OWR fixes: Vite compat, dark mode, scoped storage, Sentry removal
- `.jsx` extensions for Vite (SyncButton, SyncUpgradeDialog, TournamentSubmit)
- CSS `@import` order fix for Vite bundling
- Move `owr-overrides.css` from `public/` to `src/` for content-hashed bundling
- Remove Sentry entirely (was upstream's account, not ours)
- Dark mode: white text for header buttons and editor section headers
- Reduce h1 to 1.2rem, h2 to 1rem
- Fix scoped storage: `getItem()` instead of raw `localStorage` in Header, index, BattleTavern
- Export `hasMeaningfulListChange`, strip `open` field from diff comparison
- `.node-version` file (Vite requires Node 22.12+)
