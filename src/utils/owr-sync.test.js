import { describe, test, expect, beforeEach, vi } from "vitest";

// vi.hoisted runs before any imports — set up browser globals that owr-sync.js
// needs at module init (window.__OWR_SYNC__, window.__OWR_AUTH__, etc.)
vi.hoisted(() => {
  globalThis.window = globalThis.window || globalThis;
  globalThis.document = globalThis.document || { addEventListener: () => {} };
  globalThis.fetch = globalThis.fetch || (() => {});
});

// In-memory store backing the storage mock so dirty-set helpers
// (which read/write `dirtyIds`) work as if backed by real localStorage.
const memStore = {};
vi.mock("./storage", () => ({
  getItem: (k) => (Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : null),
  setItem: (k, v) => { memStore[k] = String(v); },
  setActiveStorageKey: vi.fn(),
}));

import { __test__ } from "./owr-sync";

const {
  mergeLists,
  applyDelta,
  reparentOrphans,
  splitDirtyLists,
  addTimestamps,
  buildKnownManifest,
  applySyncResponse,
  getDirtyIds,
  markDirty,
  clearDirty,
  reconcileDirtyAfterPull,
  cleanupDeletedLists,
} = __test__;

const resetStore = () => {
  for (const k of Object.keys(memStore)) delete memStore[k];
};

// ---------------------------------------------------------------------------
// mergeLists
// ---------------------------------------------------------------------------
describe("mergeLists", () => {
  test("adds server-only lists", () => {
    const server = [{ id: "s1", name: "Server", updated_at: "2026-01-01T00:00:00Z" }];
    const result = mergeLists([], server);
    expect(result.some((l) => l.id === "s1")).toBe(true);
  });

  test("keeps local-only lists", () => {
    const local = [{ id: "l1", name: "Local", updated_at: "2026-01-01T00:00:00Z" }];
    const result = mergeLists(local, []);
    expect(result.some((l) => l.id === "l1")).toBe(true);
  });

  test("keeps local version when local is newer", () => {
    const local = [{ id: "1", name: "Local", updated_at: "2026-02-01T00:00:00Z" }];
    const server = [{ id: "1", name: "Server", updated_at: "2026-01-01T00:00:00Z" }];
    const result = mergeLists(local, server);
    expect(result.find((l) => l.id === "1").name).toBe("Local");
  });

  test("keeps server version when server is newer", () => {
    const local = [{ id: "1", name: "Local", updated_at: "2026-01-01T00:00:00Z" }];
    const server = [{ id: "1", name: "Server", updated_at: "2026-02-01T00:00:00Z" }];
    const result = mergeLists(local, server);
    expect(result.find((l) => l.id === "1").name).toBe("Server");
  });

  test("undeletes local when server is newer", () => {
    const local = [{ id: "1", _deleted: true, updated_at: "2026-01-01T00:00:00Z" }];
    const server = [{ id: "1", name: "Restored", updated_at: "2026-02-01T00:00:00Z" }];
    const result = mergeLists(local, server);
    expect(result.find((l) => l.id === "1").name).toBe("Restored");
    expect(result.find((l) => l.id === "1")._deleted).toBeUndefined();
  });

  test("stays deleted when local delete is newer", () => {
    const local = [{ id: "1", _deleted: true, updated_at: "2026-02-01T00:00:00Z" }];
    const server = [{ id: "1", name: "Old", updated_at: "2026-01-01T00:00:00Z" }];
    const result = mergeLists(local, server);
    expect(result.find((l) => l.id === "1")).toBeUndefined();
  });

  test("skips server _deleted lists not in local", () => {
    const server = [{ id: "s1", _deleted: true, updated_at: "2026-01-01T00:00:00Z" }];
    const result = mergeLists([], server);
    expect(result.find((l) => l.id === "s1")).toBeUndefined();
  });

  test("drops list when server tombstone supersedes local non-deleted", () => {
    const local = [{ id: "1", name: "Local", updated_at: "2026-01-01T00:00:00Z" }];
    const server = [{ id: "1", _deleted: true, updated_at: "2026-02-01T00:00:00Z" }];
    const result = mergeLists(local, server);
    expect(result.find((l) => l.id === "1")).toBeUndefined();
  });

  test("drops both tombstones when local delete and server delete agree", () => {
    const local = [{ id: "1", _deleted: true, updated_at: "2026-01-01T00:00:00Z" }];
    const server = [{ id: "1", _deleted: true, updated_at: "2026-01-01T00:00:00Z" }];
    const result = mergeLists(local, server);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// applyDelta
// ---------------------------------------------------------------------------
describe("applyDelta", () => {
  test("removes deleted IDs", () => {
    const local = [{ id: "1" }, { id: "2" }];
    const result = applyDelta(local, [], ["2"]);
    expect(result.map((l) => l.id)).toEqual(["1"]);
  });

  test("replaces existing with delta version", () => {
    const local = [{ id: "1", name: "Old" }];
    const delta = [{ id: "1", name: "New" }];
    const result = applyDelta(local, delta, []);
    expect(result.find((l) => l.id === "1").name).toBe("New");
  });

  test("keeps unchanged local lists", () => {
    const local = [{ id: "1", name: "Keep" }];
    const result = applyDelta(local, [], []);
    expect(result.find((l) => l.id === "1").name).toBe("Keep");
  });

  test("adds new lists from delta", () => {
    const local = [{ id: "1" }];
    const delta = [{ id: "2", name: "New" }];
    const result = applyDelta(local, delta, []);
    expect(result.some((l) => l.id === "2")).toBe(true);
  });

  test("skips server tombstones not in local", () => {
    const local = [{ id: "1" }];
    const delta = [{ id: "2", _deleted: true, updated_at: "2026-01-01T00:00:00Z" }];
    const result = applyDelta(local, delta, []);
    expect(result.some((l) => l.id === "2")).toBe(false);
  });

  test("drops local list when delta replaces it with a tombstone", () => {
    const local = [{ id: "1", name: "Local" }];
    const delta = [{ id: "1", _deleted: true, updated_at: "2026-01-01T00:00:00Z" }];
    const result = applyDelta(local, delta, []);
    expect(result.some((l) => l.id === "1")).toBe(false);
  });

  test("drops stale local tombstone when server stops broadcasting", () => {
    const local = [
      { id: "1", name: "Keep" },
      { id: "2", _deleted: true, updated_at: "2026-01-01T00:00:00Z" },
    ];
    const result = applyDelta(local, [], []);
    expect(result.map((l) => l.id)).toEqual(["1"]);
  });
});

// ---------------------------------------------------------------------------
// reparentOrphans (orphan repair at the merge seam)
// ---------------------------------------------------------------------------
describe("orphan repair", () => {
  beforeEach(resetStore);

  test("reparentOrphans clears a pointer to a missing folder and marks dirty", () => {
    const result = reparentOrphans([
      { id: "child", folder: "gone", updated_at: "2026-01-01T00:00:00Z" },
    ]);
    expect(result.find((l) => l.id === "child").folder).toBe(null);
    expect(getDirtyIds().has("child")).toBe(true);
  });

  test("reparentOrphans bumps updated_at so the fix wins LWW", () => {
    const before = "2026-01-01T00:00:00Z";
    const result = reparentOrphans([{ id: "child", folder: "gone", updated_at: before }]);
    const repaired = result.find((l) => l.id === "child");
    expect(new Date(repaired.updated_at).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  test("reparentOrphans treats a tombstoned folder as missing", () => {
    const result = reparentOrphans([
      { id: "f1", type: "folder", _deleted: true, updated_at: "2026-01-01T00:00:00Z" },
      { id: "child", folder: "f1", updated_at: "2026-01-01T00:00:00Z" },
    ]);
    expect(result.find((l) => l.id === "child").folder).toBe(null);
  });

  test("reparentOrphans leaves a child of a live folder untouched and clean", () => {
    const result = reparentOrphans([
      { id: "f1", type: "folder", updated_at: "2026-01-01T00:00:00Z" },
      { id: "child", folder: "f1", updated_at: "2026-01-01T00:00:00Z" },
    ]);
    expect(result.find((l) => l.id === "child").folder).toBe("f1");
    expect(getDirtyIds().has("child")).toBe(false);
  });

  test("reparentOrphans is idempotent for already top-level lists", () => {
    const result = reparentOrphans([{ id: "child", folder: null, updated_at: "x" }]);
    expect(result.find((l) => l.id === "child").folder).toBe(null);
    expect(getDirtyIds().has("child")).toBe(false);
  });

  test("mergeLists repairs an orphan surfaced by the merge", () => {
    // Server has the child pointing at a folder that exists nowhere.
    const server = [{ id: "child", folder: "gone", updated_at: "2026-02-01T00:00:00Z" }];
    const merged = mergeLists([], server);
    expect(merged.find((l) => l.id === "child").folder).toBe(null);
    expect(getDirtyIds().has("child")).toBe(true);
  });

  test("applyDelta repairs an orphan surfaced by the delta", () => {
    const local = [{ id: "child", folder: "f1", updated_at: "2026-01-01T00:00:00Z" }];
    // Delta drops the folder (tombstone) but never clears the child's pointer.
    const delta = [{ id: "f1", type: "folder", _deleted: true, updated_at: "2026-02-01T00:00:00Z" }];
    const merged = applyDelta(local, delta, []);
    expect(merged.find((l) => l.id === "child").folder).toBe(null);
    expect(getDirtyIds().has("child")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// splitDirtyLists (persistent dirty-set)
// ---------------------------------------------------------------------------
describe("splitDirtyLists", () => {
  beforeEach(resetStore);

  test("returns only lists whose ids are in the dirty set", () => {
    const lists = [
      { id: "1", updated_at: "2026-01-01T00:00:00Z" },
      { id: "2", updated_at: "2026-01-02T00:00:00Z" },
    ];
    const { dirty } = splitDirtyLists(lists, new Set(["2"]));
    expect(dirty.map((l) => l.id)).toEqual(["2"]);
  });

  test("returns empty when nothing is dirty", () => {
    const lists = [{ id: "1", updated_at: "2026-01-01T00:00:00Z" }];
    const { dirty } = splitDirtyLists(lists, new Set());
    expect(dirty).toHaveLength(0);
  });

  test("builds the manifest from every list regardless of dirty state", () => {
    const lists = [
      { id: "1", updated_at: "2026-01-01T00:00:00Z" },
      { id: "2", updated_at: "2026-02-01T00:00:00Z" },
    ];
    const { known } = splitDirtyLists(lists, new Set(["1"]));
    expect(known).toEqual({
      "1": "2026-01-01T00:00:00Z",
      "2": "2026-02-01T00:00:00Z",
    });
  });
});

// ---------------------------------------------------------------------------
// dirty-set tracking through edits and acks
// ---------------------------------------------------------------------------
describe("dirty-set tracking", () => {
  beforeEach(resetStore);

  test("seeds dirty from existing lists when owb.dirty is missing", () => {
    memStore["owb.lists"] = JSON.stringify([{ id: "a" }, { id: "b" }]);
    const dirty = getDirtyIds();
    expect([...dirty].sort()).toEqual(["a", "b"]);
  });

  test("subsequent reads use the persisted set, not re-seed", () => {
    memStore["owb.lists"] = JSON.stringify([{ id: "a" }, { id: "b" }]);
    memStore["dirtyIds"] = JSON.stringify([]);
    const dirty = getDirtyIds();
    expect([...dirty]).toEqual([]);
  });

  test("markDirty adds an id and persists", () => {
    memStore["dirtyIds"] = JSON.stringify([]);
    markDirty("x");
    expect(JSON.parse(memStore["dirtyIds"])).toEqual(["x"]);
  });

  test("applySyncResponse clears sent ids from the dirty set", () => {
    memStore["dirtyIds"] = JSON.stringify(["1", "2"]);
    const sent = [{ id: "1", updated_at: "2026-02-01T00:00:00Z" }];
    applySyncResponse([], { synced_at: "2026-02-01T00:00:00Z" }, sent);
    expect(JSON.parse(memStore["dirtyIds"])).toEqual(["2"]);
  });

  test("clearDirty removes only the specified ids", () => {
    memStore["dirtyIds"] = JSON.stringify(["a", "b", "c"]);
    clearDirty([{ id: "a" }, { id: "c" }]);
    expect(JSON.parse(memStore["dirtyIds"])).toEqual(["b"]);
  });

  test("clearDirty keeps id dirty when local updated_at moved during round-trip", () => {
    memStore["dirtyIds"] = JSON.stringify(["a"]);
    memStore["owb.lists"] = JSON.stringify([
      { id: "a", updated_at: "2026-02-02T00:00:00Z" }, // user edited mid-flight
    ]);
    clearDirty([{ id: "a", updated_at: "2026-02-01T00:00:00Z" }]);
    expect(JSON.parse(memStore["dirtyIds"])).toEqual(["a"]);
  });

  test("clearDirty clears id when local updated_at still matches what we sent", () => {
    memStore["dirtyIds"] = JSON.stringify(["a"]);
    memStore["owb.lists"] = JSON.stringify([
      { id: "a", updated_at: "2026-02-01T00:00:00Z" },
    ]);
    clearDirty([{ id: "a", updated_at: "2026-02-01T00:00:00Z" }]);
    expect(JSON.parse(memStore["dirtyIds"])).toEqual([]);
  });

  test("clearDirty clears id when local list is gone (tombstone collapsed)", () => {
    memStore["dirtyIds"] = JSON.stringify(["a"]);
    memStore["owb.lists"] = JSON.stringify([]);
    clearDirty([{ id: "a", updated_at: "2026-02-01T00:00:00Z" }]);
    expect(JSON.parse(memStore["dirtyIds"])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// cleanupDeletedLists
// ---------------------------------------------------------------------------
describe("cleanupDeletedLists", () => {
  beforeEach(resetStore);

  const ancient = "2020-01-01T00:00:00.000Z"; // well past the 7-day window
  const idsIn = () =>
    JSON.parse(memStore["owb.lists"]).map((l) => l.id).sort();

  test("purges an ACKED tombstone older than the retention window", () => {
    memStore["dirtyIds"] = JSON.stringify([]); // nothing pending = server confirmed
    memStore["owb.lists"] = JSON.stringify([
      { id: "live", updated_at: ancient },
      { id: "gone", _deleted: true, updated_at: ancient },
    ]);
    cleanupDeletedLists();
    expect(idsIn()).toEqual(["live"]);
  });

  test("keeps an UNACKED tombstone past the window — the resurrection-bug guard", () => {
    // Delete made offline: id still dirty, tombstone aged out the window. It
    // must survive so the delete still gets a chance to reach the server;
    // otherwise the next pull resurrects the list.
    memStore["dirtyIds"] = JSON.stringify(["gone"]);
    memStore["owb.lists"] = JSON.stringify([
      { id: "live", updated_at: ancient },
      { id: "gone", _deleted: true, updated_at: ancient },
    ]);
    cleanupDeletedLists();
    expect(idsIn()).toEqual(["gone", "live"]);
  });

  test("keeps a fresh (within-window) acked tombstone", () => {
    memStore["dirtyIds"] = JSON.stringify([]);
    memStore["owb.lists"] = JSON.stringify([
      { id: "gone", _deleted: true, updated_at: new Date().toISOString() },
    ]);
    cleanupDeletedLists();
    expect(idsIn()).toEqual(["gone"]);
  });

  test("never purges non-deleted lists, dirty or not", () => {
    memStore["dirtyIds"] = JSON.stringify([]);
    memStore["owb.lists"] = JSON.stringify([
      { id: "a", updated_at: ancient },
      { id: "b", updated_at: ancient },
    ]);
    cleanupDeletedLists();
    expect(idsIn()).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// applySyncResponse handles unknown_ids from the server
// ---------------------------------------------------------------------------
describe("applySyncResponse — unknown_ids", () => {
  beforeEach(resetStore);

  test("marks server-reported unknown_ids as dirty for next push", () => {
    memStore["dirtyIds"] = JSON.stringify([]);
    applySyncResponse([], { unknown_ids: ["new-1", "new-2"] }, []);
    expect(JSON.parse(memStore["dirtyIds"]).sort()).toEqual(["new-1", "new-2"]);
  });

  test("ignores absent unknown_ids field (legacy server)", () => {
    memStore["dirtyIds"] = JSON.stringify([]);
    applySyncResponse([], { lists: [], deleted_ids: [] }, []);
    expect(JSON.parse(memStore["dirtyIds"])).toEqual([]);
  });

  test("clears sent ids and marks unknown_ids in the same response", () => {
    memStore["dirtyIds"] = JSON.stringify(["sent-id"]);
    memStore["owb.lists"] = JSON.stringify([
      { id: "sent-id", updated_at: "2026-02-01T00:00:00Z" },
    ]);
    applySyncResponse(
      [],
      { unknown_ids: ["unknown-id"] },
      [{ id: "sent-id", updated_at: "2026-02-01T00:00:00Z" }]
    );
    expect(JSON.parse(memStore["dirtyIds"])).toEqual(["unknown-id"]);
  });
});

// ---------------------------------------------------------------------------
// reconcileDirtyAfterPull — preserves pending edits, never auto-adds
// ---------------------------------------------------------------------------
describe("reconcileDirtyAfterPull", () => {
  test("keeps an existing dirty id when the list is still in merged", () => {
    const currentDirty = new Set(["X"]);
    const merged = [{ id: "X" }, { id: "Y" }];
    const next = reconcileDirtyAfterPull(currentDirty, merged);
    expect([...next].sort()).toEqual(["X"]);
  });

  test("does NOT auto-mark local-only ids as dirty (server's unknown_ids handles that)", () => {
    const currentDirty = new Set();
    const merged = [{ id: "X" }, { id: "local-only" }];
    const next = reconcileDirtyAfterPull(currentDirty, merged);
    expect([...next]).toEqual([]);
  });

  test("drops dirty ids whose lists no longer exist locally", () => {
    const currentDirty = new Set(["gone", "still-here"]);
    const merged = [{ id: "still-here" }];
    const next = reconcileDirtyAfterPull(currentDirty, merged);
    expect([...next]).toEqual(["still-here"]);
  });
});

// ---------------------------------------------------------------------------
// addTimestamps
// ---------------------------------------------------------------------------
describe("addTimestamps", () => {
  test("adds updated_at to lists missing it", () => {
    const lists = [{ id: "1" }];
    const result = addTimestamps(lists);
    expect(result[0].updated_at).toBeDefined();
  });

  test("preserves existing updated_at", () => {
    const ts = "2026-01-01T00:00:00Z";
    const lists = [{ id: "1", updated_at: ts }];
    const result = addTimestamps(lists);
    expect(result[0].updated_at).toBe(ts);
  });
});

// ---------------------------------------------------------------------------
// buildKnownManifest
// ---------------------------------------------------------------------------
describe("buildKnownManifest", () => {
  test("returns id-to-updated_at map", () => {
    const lists = [
      { id: "a", updated_at: "2026-01-01T00:00:00Z" },
      { id: "b", updated_at: "2026-02-01T00:00:00Z" },
    ];
    expect(buildKnownManifest(lists)).toEqual({
      a: "2026-01-01T00:00:00Z",
      b: "2026-02-01T00:00:00Z",
    });
  });

  test("skips entries without id or updated_at", () => {
    const lists = [
      { id: "a" },
      { updated_at: "2026-01-01T00:00:00Z" },
      { id: "b", updated_at: "2026-02-01T00:00:00Z" },
    ];
    expect(buildKnownManifest(lists)).toEqual({
      b: "2026-02-01T00:00:00Z",
    });
  });
});

// ---------------------------------------------------------------------------
// applySyncResponse
// ---------------------------------------------------------------------------
describe("applySyncResponse", () => {
  test("applies delta when deleted_ids present", () => {
    const local = [{ id: "1" }, { id: "2" }];
    const data = { deleted_ids: ["2"], lists: [], synced_at: "2026-01-01T00:00:00Z" };
    const result = applySyncResponse(local, data);
    expect(result.map((l) => l.id)).toEqual(["1"]);
  });

  test("merges full response when no deleted_ids", () => {
    const local = [{ id: "1", name: "Local", updated_at: "2026-01-01T00:00:00Z" }];
    const data = {
      lists: [{ id: "1", name: "Server", updated_at: "2026-02-01T00:00:00Z" }],
      synced_at: "2026-02-01T00:00:00Z",
    };
    const result = applySyncResponse(local, data);
    expect(result.find((l) => l.id === "1").name).toBe("Server");
  });

  test("returns local lists when response is empty", () => {
    const local = [{ id: "1" }];
    const result = applySyncResponse(local, {});
    expect(result).toEqual(local);
  });

  test("drops acked tombstones from local after merge response", () => {
    const local = [
      { id: "1", name: "Keep" },
      { id: "2", _deleted: true, updated_at: "2026-01-01T00:00:00Z" },
    ];
    const data = {
      lists: [
        { id: "2", _deleted: true, updated_at: "2026-01-01T00:00:00Z" },
      ],
    };
    const dirty = [{ id: "2", _deleted: true, updated_at: "2026-01-01T00:00:00Z" }];
    const result = applySyncResponse(local, data, dirty);
    expect(result.map((l) => l.id)).toEqual(["1"]);
  });

  test("drops acked tombstones from local after delta response", () => {
    const local = [
      { id: "1", name: "Keep" },
      { id: "2", _deleted: true, updated_at: "2026-01-01T00:00:00Z" },
    ];
    const data = {
      lists: [{ id: "2", _deleted: true, updated_at: "2026-01-01T00:00:00Z" }],
      deleted_ids: [],
    };
    const dirty = [{ id: "2", _deleted: true, updated_at: "2026-01-01T00:00:00Z" }];
    const result = applySyncResponse(local, data, dirty);
    expect(result.map((l) => l.id)).toEqual(["1"]);
  });

  test("keeps resurrected list when another device modified after our delete", () => {
    const local = [
      { id: "2", _deleted: true, updated_at: "2026-01-01T00:00:00Z" },
    ];
    const data = {
      lists: [{ id: "2", name: "Resurrected", updated_at: "2026-02-01T00:00:00Z" }],
    };
    const dirty = [{ id: "2", _deleted: true, updated_at: "2026-01-01T00:00:00Z" }];
    const result = applySyncResponse(local, data, dirty);
    expect(result.find((l) => l.id === "2").name).toBe("Resurrected");
  });
});

// ---------------------------------------------------------------------------
// `open` (folder collapsed/expanded) syncs across devices
// ---------------------------------------------------------------------------
describe("`open` is a synced field", () => {
  test("splitDirtyLists keeps `open` on outgoing payload", () => {
    const lists = [
      {
        id: "f1",
        type: "folder",
        name: "Folder",
        open: false,
        updated_at: "2026-02-01T00:00:00Z",
      },
    ];
    const { dirty } = splitDirtyLists(lists, new Set(["f1"]));
    expect(dirty).toHaveLength(1);
    expect(dirty[0].open).toBe(false);
  });

  test("mergeLists takes server `open` when the server version wins", () => {
    const local = [
      {
        id: "f1",
        name: "Folder",
        type: "folder",
        open: false,
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];
    const server = [
      {
        id: "f1",
        name: "Folder",
        type: "folder",
        open: true,
        updated_at: "2026-02-01T00:00:00Z",
      },
    ];
    const merged = mergeLists(local, server).find((l) => l.id === "f1");
    expect(merged.open).toBe(true);
  });

  test("applyDelta takes delta `open` when it replaces the entry", () => {
    const local = [
      {
        id: "f1",
        name: "Folder",
        type: "folder",
        open: false,
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];
    const delta = [
      {
        id: "f1",
        name: "Folder",
        type: "folder",
        open: true,
        updated_at: "2026-02-01T00:00:00Z",
      },
    ];
    const merged = applyDelta(local, delta, []).find((l) => l.id === "f1");
    expect(merged.open).toBe(true);
  });
});
