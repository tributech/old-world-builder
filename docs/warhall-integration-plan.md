# Warhall Integration Plan

**Status**: Draft — March 2026
**Parties**: OWR (Old World Rankings) × Warhall (Greenfeet)
**Goal**: Make OWR the primary tournament + army-list platform provider feeding into Warhall, replacing/complementing the existing New Recruit integration.

---

## Background

[Warhall](https://www.warhall.eu) is a free browser/mobile 3D wargaming simulator for rank-and-flank games (The Old World, 9th Age, WAP, Armada). It currently integrates tightly with [New Recruit](https://www.newrecruit.eu) for army lists and tournament pairing. OWR runs its own:

- **Battle Builder** — army list builder (this repo), with text-to-list import
- **BattleHub** — tournament management hub
- **BattleScorer** — turn-by-turn in-game tracking utility

OWR also holds regional player/ranking data and acts as an **OAuth 2 provider**, enabling account-linked integrations.

---

## Integration Touchpoints

### 1. Tournament Pairings → Warhall Rooms

**Flow**: OWR BattleHub hosts a tournament → round pairings are published → paired players get a deep-link/button to join a pre-configured private Warhall room for their game.

- OWR calls a Warhall API endpoint (or webhook) with pairing data: player A, player B, round, game system, optional army list refs
- Warhall creates a private room and returns a join URL for each player
- Players see a "Play on Warhall" button next to their pairing in BattleHub
- Game result reported back from Warhall → OWR records the result automatically (bidirectional: Warhall's Pro-tier auto-reporting, directed to OWR instead of New Recruit)

**Why this matters**: Reduces friction for online tournament games. Eliminates the manual "create a room, share a link" step.

---

### 2. One-Click Access from BattleScorer

**Flow**: BattleScorer is tracking a live in-person or online game → player taps "Open in Warhall" → lands directly in a Warhall room pre-loaded with their army.

- BattleScorer passes the active army list (already in Battle Builder format) + optional opponent list as a deep-link or short token
- Warhall resolves the token and deploys the army to the table
- Useful for players who want a digital referee/visualisation alongside a physical game

**Screenshot variant**: BattleScorer currently prompts players to take progress photos. Alternative: instead of a camera photo, tap "Screenshot from Warhall" — which captures the current board state in the Warhall room and posts it back to the BattleScorer game log.

---

### 3. Army List → Warhall ("Visualise My List")

**Flow**: Any army list in Battle Builder gets a "Visualise on Warhall" button → one click deploys it to Warhall's 3D view.

- OWR already parses text army lists into internal JSON (Battle Builder format)
- Add an export transform: Battle Builder JSON → Warhall army schema
- Pass the serialised list as a URL parameter or POST payload to Warhall's import endpoint
- User lands in Warhall with their exact list on the table, ready to play or browse

**Reverse direction** (Warhall → OWR): Any Warhall user can click "Edit in Battle Builder" to open their list in OWR's army editor — useful for players who discover the app via Warhall.

---

### 4. OWR as OAuth 2 Provider (Account Linking)

**Flow**: Warhall's login screen adds "Connect with OWR" → user authorises → Warhall receives an OWR identity token.

- OWR exposes standard OAuth 2 Authorization Code flow
- Scopes: `profile` (username, region, avatar), `lists:read` (army lists), `tournaments:read` (tournament memberships)
- Once linked, Warhall can:
  - Auto-import army lists from OWR without manual re-entry
  - Pre-fill player name and region in lobby
  - Surface OWR ranking/faction badges in Warhall's player profile
- OWR benefits: Warhall login funnel brings new users to OWR platform

---

### 5. Open Warhall Rooms Widget (Opt-In, Region-Aware)

**Flow**: OWR knows a user's region from their ranking profile. With opt-in consent, show a live widget on OWR pages (home, army list view, etc.) listing open Warhall rooms nearby looking for opponents.

- User opts in via OWR account settings: "Show Warhall open rooms"
- OWR polls or subscribes to a Warhall rooms feed, filtered by game system (TOW) and region
- Widget shows: room name, host player, army faction, format — with a direct "Join" button
- Converts passive OWR visitors (browsing lists, rankings) into active Warhall players
- Warhall gets a discovery channel outside their own lobby

**Privacy**: Opt-in only. Room visibility subject to Warhall room privacy settings (public rooms only).

---

## Data Schemas

### Battle Builder → Warhall Army List Transform

OWR can already parse text army lists into its internal JSON. The Warhall import accepts:

1. **Clipboard text** (free tier): T9A-style plain text — OWR can render this from any list today
2. **Structured import** (Pro): direct JSON via the New Recruit API pattern — OWR would negotiate an equivalent endpoint

Priority: implement text-format export first (no Warhall API changes needed), then work toward structured JSON import for Pro users.

### Pairing Webhook Payload (proposed)

```json
{
  "tournament_id": "owr-t-1234",
  "round": 3,
  "game_system": "the-old-world",
  "player_a": {
    "owr_id": "player-uuid",
    "display_name": "Gommo",
    "army_list_url": "https://cdn.oldworldrankings.com/lists/xyz.json"
  },
  "player_b": {
    "owr_id": "player-uuid",
    "display_name": "Sueko",
    "army_list_url": "https://cdn.oldworldrankings.com/lists/abc.json"
  }
}
```

Warhall responds with `room_url_a` and `room_url_b` (player-specific join links).

---

## Phased Rollout

| Phase | Scope | Effort |
|-------|-------|--------|
| 1 | Army list text export → Warhall clipboard import ("Visualise" button) | Low — OWR already renders text lists |
| 2 | OAuth 2 "Connect with OWR" in Warhall | Medium — OWR OAuth server + Warhall login UI change |
| 3 | Tournament pairing → Warhall room creation | Medium — needs Warhall room-creation API |
| 4 | BattleScorer ↔ Warhall deep-link + screenshot return | Medium — BattleScorer + Warhall mobile/web API |
| 5 | Open rooms widget on OWR (opt-in, regional) | Low-Medium — Warhall rooms feed API + OWR frontend widget |

---

## Open Questions

- Does Warhall expose a public room-creation API, or would this require a private integration agreement?
- What is the Warhall army list JSON schema for structured imports (beyond clipboard text)?
- Is Warhall's auto-reporting endpoint (currently pointed at New Recruit) configurable per tournament?
- Can the Warhall screenshot function be triggered programmatically / returned to an external caller?
- OAuth 2: does Warhall currently support any SSO, or would this be a new auth path entirely?

---

## Notes

- Warhall is free to play; Pro features (private rooms, auto-reporting, structured list import) are paid. Integration touchpoints that rely on Pro features should either require Pro on the Warhall side or negotiate a tournament/partner tier.
- New Recruit's existing TOW support means there is precedent for the data formats needed — their [Reports API](https://www.newrecruit.eu/tutorials/reports) is a useful reference for the pairing/results flow.
- OWR's CDN (`cdn.oldworldrankings.com`) can serve pre-exported army lists as stable URLs for Warhall to fetch, avoiding large payloads in deep-links.
