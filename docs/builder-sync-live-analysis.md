# Old World Builder Sync Analysis (Pre-Live)

Date: 2026-02-16  
Scope: `old-world-builder` fork + Rails backend integration in `/Users/colin/dev/tributech/oldworldrankings`

## Executive Summary

The current sync implementation is functionally solid (especially deletion conflict handling), but it is likely to generate avoidable write churn under real usage. The core issue is that many UI transitions trigger sync-worthy timestamps and full-payload POSTs even when no meaningful content changed.

Primary risk is not a classic "undo engine" bottleneck. The risk is repeated updates to `users.builder_lists_json` (large jsonb payloads) and associated `users` row writes, which can degrade backend efficiency as usage scales.

## What Is Working Well

1. Clear, simple architecture:
- Full snapshot sync (`lists` array) with server-side merge.
- Last-write-wins merge using per-list `updated_at`.

2. Deletion handling is robust:
- Server supports `_deleted` + `_broadcast_until` window.
- Well-covered by request specs for stale client, undelete, and broadcast extension.

3. Shared merge logic across web and mobile APIs:
- Rails controller and Grape endpoint both use `BuilderSyncService`.

## Findings

## 1) Over-sync trigger surface is broad

The app calls `updateLocalList(list)` in multiple route-level components on list state changes:

- `src/pages/editor/Editor.js:77`
- `src/pages/unit/Unit.js:486`
- `src/pages/magic/Magic.js:379`
- `src/pages/edit-list/EditList.js:86`
- `src/pages/rename/Rename.js:50`

This means normal navigation/editing flows can produce frequent sync scheduling.

## 2) Local update path always mutates timestamp and schedules sync

`updateLocalList` always stamps a new timestamp and calls sync:

- `src/utils/list.js:7`
- `src/utils/list.js:25`

Even when data is semantically unchanged, this makes the list look "newer" and pushes it.

## 3) Sync payload is full snapshot every time

Client POST sends all lists, not a delta:

- `src/utils/owr-sync.js:212`

This is simple and safe, but increases network and backend merge/update cost per event.

## 4) In-flight sync drops subsequent attempts instead of queueing

If `isSyncing` is true, push exits early:

- `src/utils/owr-sync.js:200`

A change made during an in-flight request may not sync until a future edit/manual sync occurs.

## 5) Sync success can be reported without checking HTTP success

In debounced push flow, response status is not checked before `lastSyncedAt` is set:

- POST call: `src/utils/owr-sync.js:207`
- success timestamp set: `src/utils/owr-sync.js:215`

Potential result: false-positive "synced" state on non-2xx responses.

## 6) Backend writes on every POST, even when merged data is unchanged

Both sync endpoints always call `current_user.update!` with merged payload:

- Web: `/Users/colin/dev/tributech/oldworldrankings/app/controllers/api/builder_sync_controller.rb:31`
- Mobile: `/Users/colin/dev/tributech/oldworldrankings/app/api/owr/v1/builder_sync.rb:32`

This is the main backend performance concern.

## 7) Additional write pressure from `last_seen_at` touch path

`ApplicationController#set_current_user` touches `last_seen_at` (throttled to 1 min):

- `/Users/colin/dev/tributech/oldworldrankings/app/controllers/application_controller.rb:91`

Builder sync controller skips region/tenant/season checks, but not this current-user hook. This can add periodic extra writes during active sync sessions.

## 8) Merge tie-break rule differs client vs server

- Client merge keeps local on equal timestamps (`>=`):
  - `src/utils/owr-sync.js:347`
- Server merge keeps server on equal timestamps (`>` for client win only):
  - `/Users/colin/dev/tributech/oldworldrankings/app/services/builder_sync_service.rb:51`

Usually harmless, but inconsistent tie behavior can produce edge-case surprises.

## 9) No dedicated builder-specific undo/version framework found

I did not find `paper_trail`/`audited` style versioning on this path. So "undo performance" concerns map primarily to sync-induced row churn and payload rewrites, not version-table explosion in this feature.

## Backend Validation Snapshot

Deletion/broadcast behavior appears intentionally hardened and tested:

- Service:
  - `/Users/colin/dev/tributech/oldworldrankings/app/services/builder_sync_service.rb:21`
  - `/Users/colin/dev/tributech/oldworldrankings/app/services/builder_sync_service.rb:67`
- Specs:
  - `/Users/colin/dev/tributech/oldworldrankings/spec/requests/api/v1/builder_sync_spec.rb:208`

## Recommended Hardening (Small + Fast)

1. Add no-op guard in `updateLocalList`
- Only stamp `updated_at` and sync when effective list content changed.

2. Add pending-sync queue in client
- If `isSyncing`, set `pendingSync = true`; run one follow-up sync when current request completes.

3. Validate POST status before marking sync success
- Set `lastSyncedAt` only when response is `ok`.

4. Add backend no-op short-circuit
- If merged result equals stored JSON, skip write to `builder_lists_json`.

5. Optional: increase debounce (2s -> 3-5s)
- Reduces write rate at cost of slightly delayed cross-device propagation.

## Open Product/Technical Decisions

1. Acceptable sync latency target for live:
- 2s, 3s, or 5s debounce?

2. Should folder open/closed state sync across devices?
- If no, exclude it from sync payload to reduce noise.

3. Should backend always update `builder_lists_synced_at`, or only when payload changes?

4. Rollout preference:
- Client hardening first, then backend optimization, or both in one release?

