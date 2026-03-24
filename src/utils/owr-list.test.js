import { describe, test, expect, beforeEach, vi } from "vitest";

// In-memory store backing the storage mock
const store = {};
vi.mock("./storage", () => ({
  getItem: (key) => store[key] ?? null,
  setItem: (key, val) => { store[key] = String(val); },
  removeItem: (key) => { delete store[key]; },
  setActiveStorageKey: vi.fn(),
}));

vi.mock("./owr-sync", () => ({
  pushToOWR: vi.fn(),
}));

import { updateLocalList, removeFromLocalList } from "./owr-list";
import { pushToOWR } from "./owr-sync";

const clearStore = () => Object.keys(store).forEach((k) => delete store[k]);

describe("updateLocalList", () => {
  beforeEach(() => {
    clearStore();
    vi.clearAllMocks();
  });

  test("merges partial updates with stored list before syncing", () => {
    const existingList = {
      id: "list-1",
      name: "Original",
      army: "the-empire",
      units: [{ id: "u-1" }],
      updated_at: "2026-01-01T00:00:00.000Z",
    };

    store["owb.lists"] = JSON.stringify([existingList]);

    updateLocalList({
      id: "list-1",
      name: "Renamed",
    });

    const stored = JSON.parse(store["owb.lists"]);
    expect(stored[0].name).toBe("Renamed");
    expect(stored[0].army).toBe("the-empire");
    expect(stored[0].units).toEqual([{ id: "u-1" }]);
    expect(stored[0].updated_at).not.toBe(existingList.updated_at);
    expect(pushToOWR).toHaveBeenCalledTimes(1);
  });

  test("does not sync when only sync-only fields change", () => {
    const existingList = {
      id: "list-1",
      name: "Original",
      army: "the-empire",
      updated_at: "2026-01-01T00:00:00.000Z",
      _broadcast_until: "2026-01-02T00:00:00.000Z",
    };

    store["owb.lists"] = JSON.stringify([existingList]);

    updateLocalList({
      id: "list-1",
      updated_at: "2026-01-03T00:00:00.000Z",
      _broadcast_until: "2026-01-04T00:00:00.000Z",
    });

    const stored = JSON.parse(store["owb.lists"]);
    expect(stored[0]).toEqual(existingList);
    expect(pushToOWR).not.toHaveBeenCalled();
  });
});

describe("removeFromLocalList", () => {
  beforeEach(() => {
    clearStore();
    vi.clearAllMocks();
  });

  test("marks list as _deleted with timestamp and syncs", () => {
    const lists = [
      { id: "list-1", name: "Keep" },
      { id: "list-2", name: "Delete Me" },
    ];
    store["owb.lists"] = JSON.stringify(lists);

    removeFromLocalList("list-2");

    const stored = JSON.parse(store["owb.lists"]);
    expect(stored).toHaveLength(2);
    expect(stored[0]._deleted).toBeUndefined();
    expect(stored[1]._deleted).toBe(true);
    expect(stored[1].updated_at).toBeDefined();
    expect(pushToOWR).toHaveBeenCalledTimes(1);
  });

  test("leaves other lists unchanged when deleting", () => {
    store["owb.lists"] = JSON.stringify([{ id: "list-1", name: "Only" }]);

    removeFromLocalList("nonexistent-id");

    const stored = JSON.parse(store["owb.lists"]);
    expect(stored).toHaveLength(1);
    expect(stored[0]._deleted).toBeUndefined();
  });

  test("handles empty localStorage", () => {
    removeFromLocalList("any-id");

    const stored = JSON.parse(store["owb.lists"]);
    expect(stored).toHaveLength(0);
  });
});
