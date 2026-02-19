import { updateLocalList } from "./owr-list";
import { pushToOWR } from "./owr-sync";

jest.mock("./owr-sync", () => ({
  pushToOWR: jest.fn(),
}));

describe("owr-list sprout updateLocalList", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  test("merges partial updates with stored list before syncing", () => {
    const existingList = {
      id: "list-1",
      name: "Original",
      army: "the-empire",
      units: [{ id: "u-1" }],
      updated_at: "2026-01-01T00:00:00.000Z",
    };

    localStorage.setItem("owb.lists", JSON.stringify([existingList]));

    updateLocalList({
      id: "list-1",
      name: "Renamed",
    });

    const stored = JSON.parse(localStorage.getItem("owb.lists"));
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

    localStorage.setItem("owb.lists", JSON.stringify([existingList]));

    updateLocalList({
      id: "list-1",
      updated_at: "2026-01-03T00:00:00.000Z",
      _broadcast_until: "2026-01-04T00:00:00.000Z",
    });

    const stored = JSON.parse(localStorage.getItem("owb.lists"));
    expect(stored[0]).toEqual(existingList);
    expect(pushToOWR).not.toHaveBeenCalled();
  });
});
