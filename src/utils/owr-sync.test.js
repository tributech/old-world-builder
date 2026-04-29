import { describe, test, expect, vi } from "vitest";

// vi.hoisted runs before any imports — set up browser globals that owr-sync.js
// needs at module init (window.__OWR_SYNC__, window.__OWR_AUTH__, etc.)
vi.hoisted(() => {
  globalThis.window = globalThis.window || globalThis;
  globalThis.document = globalThis.document || { addEventListener: () => {} };
  globalThis.fetch = globalThis.fetch || (() => {});
});

// Mock storage to avoid localStorage reference at module load
vi.mock("./storage", () => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  setActiveStorageKey: vi.fn(),
}));

import { __test__ } from "./owr-sync";

const {
  mergeLists,
  applyDelta,
  splitDirtyLists,
  addTimestamps,
  buildKnownManifest,
  applySyncResponse,
} = __test__;

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
// splitDirtyLists
// ---------------------------------------------------------------------------
describe("splitDirtyLists", () => {
  test("returns all as dirty when no syncedAt", () => {
    const lists = [
      { id: "1", updated_at: "2026-01-01T00:00:00Z" },
      { id: "2", updated_at: "2026-01-02T00:00:00Z" },
    ];
    const { dirty } = splitDirtyLists(lists, null);
    expect(dirty).toHaveLength(2);
  });

  test("returns only newer lists when syncedAt is set", () => {
    const lists = [
      { id: "1", updated_at: "2026-01-01T00:00:00Z" },
      { id: "2", updated_at: "2026-03-01T00:00:00Z" },
    ];
    const { dirty } = splitDirtyLists(lists, "2026-02-01T00:00:00Z");
    expect(dirty.map((l) => l.id)).toEqual(["2"]);
  });

  test("treats missing updated_at as always dirty", () => {
    const lists = [{ id: "1" }];
    const { dirty } = splitDirtyLists(lists, "2026-02-01T00:00:00Z");
    expect(dirty).toHaveLength(1);
  });

  test("builds known manifest for all lists", () => {
    const lists = [
      { id: "1", updated_at: "2026-01-01T00:00:00Z" },
      { id: "2", updated_at: "2026-02-01T00:00:00Z" },
    ];
    const { known } = splitDirtyLists(lists, null);
    expect(known).toEqual({
      "1": "2026-01-01T00:00:00Z",
      "2": "2026-02-01T00:00:00Z",
    });
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
