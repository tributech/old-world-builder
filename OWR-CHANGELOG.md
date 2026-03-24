# OWR Fork Changelog

Documents what each fork commit group contains on top of upstream.
These are maintained as a small set of squashed commits to keep rebases clean.

---

## 1. Fork infrastructure: CI, CDN icons, PWA removal, build config
- GitHub Action for daily upstream sync + `owr_latest` tag
- Inline SVG icons (CDN cross-origin `<use>` fix)
- Remove PWA/service worker (OWR serves as a web app, not standalone)
- CLAUDE.md, AGENTS.md, editor config, `.claude/commands/` skills
- OWR favicon/app icons
- Pre-push hygiene scan in `/retag` and `/consolidate` skills
- Requires **Yarn Berry** (v4+) — the lockfile is Berry format. Run `corepack enable && corepack prepare yarn@stable --activate` if `yarn install` fails with Yarn Classic (1.x).

## 2. Battle Builder rebrand with OWR theme and nav cleanup
- Rename to "Battle Builder" throughout (index.html, manifest, i18n)
- OWR logo in header (`owr-logo-white.svg`, `owr-logo-black.svg`)
- `owr-overrides.css` — all visual overrides, imported after `App.css`
- Hide upstream footer nav (covered by OWR Rails app)
- UTM source tag: `owb` → `owr` in rules index iframe
- i18n key updates for rebrand across all 7 languages

## 3. OWR cloud sync with delta push, list ordering, and scoped storage
- `src/utils/owr-sync.js` — bidirectional sync (pull on load, debounced push)
- `src/utils/owr-list.js` — meaningful change detection, list persistence, soft-delete
- `src/utils/storage.js` — user-scoped localStorage (`u.{key}.owb.*`)
- `src/utils/lexorank.js` + `src/utils/list-ordering.js` — drag-to-reorder with lexorank
- Auth: JWT via `window.__OWR_AUTH__` (mobile) or cookies (web)
- Delta sync: `splitDirtyLists` sends only changed lists, `applySyncResponse` handles delta/full responses
- 7-day soft delete retention for cloud reconciliation
- SyncButton component with dirty/syncing/error states
- `list.js` reverted toward upstream (sync-aware ops moved to `owr-list.js` sprout)
- Test coverage: `owr-sync.test.js` (22 tests), `owr-list.test.js` (5 tests), plus fixes to all existing test files

## 4. OWR Pro gate: upgrade dialog, Go Pro button, sync entitlement
- `SyncUpgradeDialog` — shown once for non-entitled users
- "Go Pro" pill button in header when not entitled
- `cloudSyncEntitled` flag from sync API response

## 5. OWR features: tournament submission, swipe gestures, pin/unpin
- `src/pages/export/TournamentSubmit.jsx` — submit list to OWR tournament
- Sidebar icons on export page
- `owrApiFetch` helper for authenticated API calls
- Swipeable list items with pin/unpin and delete gestures
- Pin/unpin lists to top of folder or top-level group

## 6. OWR fixes: dark mode, Sentry removal, compatibility patches
- Remove Sentry entirely (was upstream's account, not ours)
- Dark mode: white text for header buttons and editor section headers
- Fix scoped storage: `getItem()` instead of raw `localStorage`
- Fix Header.jsx stale import (was using dead `list.js:updateLocalList`)
- `.node-version` file (Vite requires Node 22.12+)
