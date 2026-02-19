# Repository Guidelines

Primary contributor guidance lives in `CLAUDE.md`. Read it first and treat it as the source of truth for workflow, architecture, coding rules, and fork/upstream strategy.

## Quick Start
- Install deps: `yarn`
- Dev server: `yarn start`
- Build: `yarn build`
- Tests: `yarn test`
- CI-style tests: `CI=true yarn test --watch=false --watchman=false`

## Repository Map
- App code: `src/`
- Static/data assets: `public/`
- Documentation: `docs/`

## Contributor Note
- Prefer OWR-specific sprout modules (for example `src/utils/owr-*.js`) when adding fork behavior, and keep upstream-facing edits minimal.
