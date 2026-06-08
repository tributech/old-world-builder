import { describe, test, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

// In-memory localStorage mock with iteration support (length + key(i))
class MemoryStorage {
  constructor() {
    this.store = {};
  }
  get length() {
    return Object.keys(this.store).length;
  }
  key(i) {
    return Object.keys(this.store)[i] ?? null;
  }
  getItem(k) {
    return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null;
  }
  setItem(k, v) {
    this.store[k] = String(v);
  }
  removeItem(k) {
    delete this.store[k];
  }
  clear() {
    this.store = {};
  }
}

vi.stubGlobal("localStorage", new MemoryStorage());

// Let fire-and-forget IndexedDB write-through transactions settle.
const flush = () => new Promise((r) => setTimeout(r, 15));

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("indexedDB", new IDBFactory()); // fresh empty DB each test
  vi.resetModules();
});

// ===========================================================================
// localStorage-resident scoped keys (settings, dirtyIds, owb.game.*)
// ===========================================================================
describe("setActiveStorageKey purges other scopes (localStorage keys)", () => {
  test("removes u.<otherKey>.* keys when activating a new key", async () => {
    localStorage.setItem("u.alice.owb.settings", "{a:1}");
    localStorage.setItem("u.bob.owb.settings", "{b:2}");
    localStorage.setItem("lang", "en"); // unscoped, should survive

    const m = await import("./storage");
    await m.ready;
    m.setActiveStorageKey("alice");

    expect(localStorage.getItem("u.alice.owb.settings")).toBe("{a:1}");
    expect(localStorage.getItem("u.bob.owb.settings")).toBeNull();
    expect(localStorage.getItem("lang")).toBe("en");
  });

  test("idempotent — re-activating the same key changes nothing", async () => {
    localStorage.setItem("owb.activeStorageKey", "alice");
    localStorage.setItem("u.alice.owb.settings", "{a:1}");

    const m = await import("./storage");
    await m.ready;
    const switched = m.setActiveStorageKey("alice");

    expect(switched).toBe(false);
    expect(localStorage.getItem("u.alice.owb.settings")).toBe("{a:1}");
  });

  test("module load purges stale scopes when activeKey is already set", async () => {
    localStorage.setItem("owb.activeStorageKey", "alice");
    localStorage.setItem("u.alice.owb.settings", "{a}");
    localStorage.setItem("u.bob.owb.settings", "{stale}");
    localStorage.setItem("u.carol.dirtyIds", '["x"]');

    const m = await import("./storage"); // hydrate runs the purge
    await m.ready;

    expect(localStorage.getItem("u.alice.owb.settings")).toBe("{a}");
    expect(localStorage.getItem("u.bob.owb.settings")).toBeNull();
    expect(localStorage.getItem("u.carol.dirtyIds")).toBeNull();
  });

  test("first-time activation migrates unscoped settings and purges stale users", async () => {
    localStorage.setItem("owb.settings", "{pre-login}");
    localStorage.setItem("u.bob.owb.settings", "{stale}");

    const m = await import("./storage");
    await m.ready;
    m.setActiveStorageKey("alice");

    expect(localStorage.getItem("u.alice.owb.settings")).toBe("{pre-login}");
    expect(localStorage.getItem("owb.settings")).toBeNull();
    expect(localStorage.getItem("u.bob.owb.settings")).toBeNull();
  });
});

describe("prefix-scoped keys (owb.game.*) stay in localStorage", () => {
  test("setItem under active key scopes the prefix-matching key", async () => {
    localStorage.setItem("owb.activeStorageKey", "alice");

    const m = await import("./storage");
    await m.ready;
    m.setItem("owb.game.abc123", '{"banners":2}');

    expect(localStorage.getItem("u.alice.owb.game.abc123")).toBe('{"banners":2}');
    expect(localStorage.getItem("owb.game.abc123")).toBeNull();
  });

  test("getItem reads back the scoped value", async () => {
    localStorage.setItem("owb.activeStorageKey", "alice");
    localStorage.setItem("u.alice.owb.game.abc123", '{"banners":2}');

    const m = await import("./storage");
    await m.ready;
    expect(m.getItem("owb.game.abc123")).toBe('{"banners":2}');
  });

  test("user switch purges other-user game state", async () => {
    localStorage.setItem("u.alice.owb.game.abc", "[alice-game]");
    localStorage.setItem("u.bob.owb.game.xyz", "[bob-game]");

    const m = await import("./storage");
    await m.ready;
    m.setActiveStorageKey("alice");

    expect(localStorage.getItem("u.alice.owb.game.abc")).toBe("[alice-game]");
    expect(localStorage.getItem("u.bob.owb.game.xyz")).toBeNull();
  });
});

// ===========================================================================
// owb.lists — IndexedDB-backed, behind the synchronous in-memory cache
// ===========================================================================
describe("owb.lists is backed by IndexedDB", () => {
  test("storageBackend reports idb when IndexedDB is available", async () => {
    const m = await import("./storage");
    await m.ready;
    expect(m.storageBackend()).toBe("idb");
  });

  test("round-trips through the synchronous cache", async () => {
    const m = await import("./storage");
    await m.ready;
    m.setItem("owb.lists", "[1,2,3]");
    expect(m.getItem("owb.lists")).toBe("[1,2,3]");
  });

  test("persists to IndexedDB across a reload (new module instance)", async () => {
    const m1 = await import("./storage");
    await m1.ready;
    m1.setItem("owb.lists", '[{"id":"x"}]');
    await flush(); // let the write-through commit

    vi.resetModules();
    const m2 = await import("./storage"); // re-hydrates from the same fake DB
    await m2.ready;
    expect(m2.getItem("owb.lists")).toBe('[{"id":"x"}]');
  });

  test("removeItem clears it from cache and IndexedDB", async () => {
    const m = await import("./storage");
    await m.ready;
    m.setItem("owb.lists", "[1]");
    m.removeItem("owb.lists");
    expect(m.getItem("owb.lists")).toBeNull();
  });

  test("is user-scoped (per-user lists don't collide)", async () => {
    localStorage.setItem("owb.activeStorageKey", "alice");
    const m = await import("./storage");
    await m.ready;
    m.setItem("owb.lists", "[alice]");
    expect(m.getItem("owb.lists")).toBe("[alice]");

    m.setActiveStorageKey("bob");
    expect(m.getItem("owb.lists")).toBeNull(); // bob has none
    m.setActiveStorageKey("alice");
    expect(m.getItem("owb.lists")).toBeNull(); // alice's was purged on the switch
  });
});

describe("owb.lists migration from localStorage on hydrate", () => {
  test("moves a plain-JSON unscoped blob into IndexedDB", async () => {
    localStorage.setItem("owb.lists", "[1,2]");

    const m = await import("./storage");
    await m.ready;

    expect(m.getItem("owb.lists")).toBe("[1,2]");
    expect(localStorage.getItem("owb.lists")).toBeNull(); // moved out
  });

  test("moves a plain-JSON SCOPED blob into IndexedDB", async () => {
    localStorage.setItem("owb.activeStorageKey", "alice");
    localStorage.setItem("u.alice.owb.lists", "[9]");

    const m = await import("./storage");
    await m.ready;

    expect(m.getItem("owb.lists")).toBe("[9]");
    expect(localStorage.getItem("u.alice.owb.lists")).toBeNull();
  });

  test("DROPS an unparseable (compressed/corrupt) blob instead of migrating it", async () => {
    // A previously lz-string-compressed blob is not valid JSON.
    localStorage.setItem("owb.lists", "ሴ噸 not json at all");

    const m = await import("./storage");
    await m.ready;

    expect(m.getItem("owb.lists")).toBeNull(); // dropped, not surfaced
    expect(localStorage.getItem("owb.lists")).toBeNull(); // and cleared
  });

  test("survives the migrated data across a reload", async () => {
    localStorage.setItem("owb.lists", '[{"id":"kept"}]');
    const m1 = await import("./storage");
    await m1.ready;
    await flush();

    vi.resetModules();
    const m2 = await import("./storage");
    await m2.ready;
    expect(m2.getItem("owb.lists")).toBe('[{"id":"kept"}]');
  });
});
