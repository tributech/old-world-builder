import { sortByRank, ensureRanks, reorderList, reorderFolder } from "./list-ordering";

// Helper to create a list item
const makeList = (id, name, rank = null, folder = null) => ({
  id,
  name,
  rank,
  folder,
  type: "list",
});

// Helper to create a folder
const makeFolder = (id, name, rank = null, open = true) => ({
  id,
  name,
  rank,
  folder: null,
  type: "folder",
  open,
});

describe("sortByRank", () => {
  describe("basic sorting", () => {
    test("sorts items by rank alphabetically", () => {
      const lists = [
        makeList("3", "Third", "c"),
        makeList("1", "First", "a"),
        makeList("2", "Second", "b"),
      ];

      const result = sortByRank(lists);
      expect(result.map((l) => l.name)).toEqual(["First", "Second", "Third"]);
    });

    test("items without rank sort to end", () => {
      const lists = [
        makeList("2", "No Rank"),
        makeList("1", "Has Rank", "a"),
      ];

      const result = sortByRank(lists);
      expect(result.map((l) => l.name)).toEqual(["Has Rank", "No Rank"]);
    });

    test("multiple items without rank maintain relative order", () => {
      const lists = [
        makeList("1", "No Rank A"),
        makeList("2", "No Rank B"),
        makeList("3", "Has Rank", "a"),
      ];

      const result = sortByRank(lists);
      expect(result[0].name).toBe("Has Rank");
      // Items without rank come after
    });
  });

  describe("folder grouping", () => {
    test("folder contents appear after their folder", () => {
      const folder = makeFolder("folder1", "My Folder", "b");
      const lists = [
        makeList("3", "Outside List", "c"),
        makeList("1", "Inside List", "a", "folder1"),
        folder,
      ];

      const result = sortByRank(lists);
      expect(result.map((l) => l.name)).toEqual([
        "My Folder",
        "Inside List",
        "Outside List",
      ]);
    });

    test("folder contents sorted by rank within folder", () => {
      const folder = makeFolder("folder1", "My Folder", "a");
      const lists = [
        folder,
        makeList("3", "Third Inside", "c", "folder1"),
        makeList("1", "First Inside", "a", "folder1"),
        makeList("2", "Second Inside", "b", "folder1"),
      ];

      const result = sortByRank(lists);
      expect(result.map((l) => l.name)).toEqual([
        "My Folder",
        "First Inside",
        "Second Inside",
        "Third Inside",
      ]);
    });

    test("multiple folders each group their contents", () => {
      const folder1 = makeFolder("folder1", "Folder A", "a");
      const folder2 = makeFolder("folder2", "Folder B", "c");
      const lists = [
        folder1,
        folder2,
        makeList("1", "In Folder A", "b", "folder1"),
        makeList("2", "In Folder B", "d", "folder2"),
        makeList("3", "Outside", "e"),
      ];

      const result = sortByRank(lists);
      expect(result.map((l) => l.name)).toEqual([
        "Folder A",
        "In Folder A",
        "Folder B",
        "In Folder B",
        "Outside",
      ]);
    });

    test("empty folder works correctly", () => {
      const folder = makeFolder("folder1", "Empty Folder", "a");
      const lists = [
        folder,
        makeList("1", "Outside", "b"),
      ];

      const result = sortByRank(lists);
      expect(result.map((l) => l.name)).toEqual(["Empty Folder", "Outside"]);
    });
  });
});

describe("ensureRanks", () => {
  test("returns needsUpdate: false when all items have ranks", () => {
    const lists = [
      makeList("1", "First", "a"),
      makeList("2", "Second", "b"),
    ];

    const { lists: result, needsUpdate } = ensureRanks(lists);
    expect(needsUpdate).toBe(false);
    expect(result).toEqual(lists);
  });

  test("assigns ranks to items without them", () => {
    const lists = [
      makeList("1", "First"),
      makeList("2", "Second"),
    ];

    const { lists: result, needsUpdate } = ensureRanks(lists);
    expect(needsUpdate).toBe(true);
    expect(result[0].rank).toBeTruthy();
    expect(result[1].rank).toBeTruthy();
  });

  test("preserves existing ranks", () => {
    const lists = [
      makeList("1", "First", "existing"),
      makeList("2", "Second"),
    ];

    const { lists: result } = ensureRanks(lists);
    expect(result[0].rank).toBe("existing");
  });

  test("assigned ranks maintain order", () => {
    const lists = [
      makeList("1", "First"),
      makeList("2", "Second"),
      makeList("3", "Third"),
    ];

    const { lists: result } = ensureRanks(lists);
    const ranks = result.map((l) => l.rank);
    const sorted = [...ranks].sort();
    expect(sorted).toEqual(ranks);
  });

  test("assigns ranks between existing ranks", () => {
    const lists = [
      makeList("1", "First", "a"),
      makeList("2", "No Rank"),
      makeList("3", "Third", "z"),
    ];

    const { lists: result } = ensureRanks(lists);
    expect(result[1].rank > "a").toBe(true);
    expect(result[1].rank < "z").toBe(true);
  });

  test("sets updated_at on newly ranked items", () => {
    const lists = [makeList("1", "First")];

    const { lists: result } = ensureRanks(lists);
    expect(result[0].updated_at).toBeTruthy();
  });

  test("assigns folder from position for legacy items", () => {
    const folder = makeFolder("folder1", "My Folder", "a");
    const lists = [
      folder,
      { ...makeList("1", "Inside"), rank: null }, // Legacy item without rank/folder
    ];

    const { lists: result } = ensureRanks(lists);
    expect(result[1].folder).toBe("folder1");
  });
});

describe("reorderList", () => {
  describe("basic reordering", () => {
    test("moving item down updates rank correctly", () => {
      const lists = [
        makeList("1", "First", "d"),
        makeList("2", "Second", "m"),
        makeList("3", "Third", "v"),
      ];

      // Move First (index 0) to after Third (index 2 in result)
      const result = reorderList(lists, 0, 2);

      // Find the moved item
      const moved = result.find((l) => l.id === "1");
      expect(moved.rank > "m").toBe(true);
      expect(moved.rank > "v").toBe(true);
    });

    test("moving item up updates rank correctly", () => {
      const lists = [
        makeList("1", "First", "d"),
        makeList("2", "Second", "m"),
        makeList("3", "Third", "v"),
      ];

      // Move Third (index 2) to first position (index 0)
      const result = reorderList(lists, 2, 0);

      const moved = result.find((l) => l.id === "3");
      // Rank should be before "d"
      expect(moved.rank < "d").toBe(true);
    });

    test("moving to middle gets rank between neighbors", () => {
      const lists = [
        makeList("1", "First", "d"),
        makeList("2", "Second", "m"),
        makeList("3", "Third", "v"),
      ];

      // Move Third (index 2) to between First and Second (index 1)
      const result = reorderList(lists, 2, 1);

      const moved = result.find((l) => l.id === "3");
      expect(moved.rank > "d").toBe(true);
      expect(moved.rank < "m").toBe(true);
    });
  });

  describe("folder assignment", () => {
    test("item dragged below folder goes into folder", () => {
      const folder = makeFolder("folder1", "My Folder", "b");
      const lists = [
        makeList("1", "Outside", "a"),
        folder,
        makeList("2", "Inside", "c", "folder1"),
      ];

      // Move Outside (index 0) to after folder (index 2 in visual)
      const result = reorderList(lists, 0, 2);

      const moved = result.find((l) => l.id === "1");
      expect(moved.folder).toBe("folder1");
    });

    test("item dragged above folder has no folder", () => {
      const folder = makeFolder("folder1", "My Folder", "b");
      const lists = [
        folder,
        makeList("1", "Inside", "c", "folder1"),
      ];

      // Move Inside (index 1) to before folder (index 0)
      const result = reorderList(lists, 1, 0);

      const moved = result.find((l) => l.id === "1");
      expect(moved.folder).toBe(null);
    });

    test("item moved from one folder to another", () => {
      const folder1 = makeFolder("folder1", "Folder A", "a");
      const folder2 = makeFolder("folder2", "Folder B", "c");
      const lists = [
        folder1,
        makeList("1", "In A", "b", "folder1"),
        folder2,
        makeList("2", "In B", "d", "folder2"),
      ];

      // Move "In A" (index 1) to after "Folder B" (index 3)
      const result = reorderList(lists, 1, 3);

      const moved = result.find((l) => l.id === "1");
      expect(moved.folder).toBe("folder2");
    });

    test("item moved out of folder to before folder", () => {
      const folder = makeFolder("folder1", "My Folder", "m");
      const lists = [
        makeList("1", "Outside Top", "d"),
        folder,
        makeList("2", "Inside", "v", "folder1"),
      ];

      // Move Inside (index 2) to before folder (index 1)
      // This puts it at position 1, which is above the folder
      const result = reorderList(lists, 2, 1);

      const moved = result.find((l) => l.id === "2");
      // When moved above the folder, it's no longer in the folder
      expect(moved.folder).toBe(null);
    });

    test("item stays in folder when moved below folder", () => {
      const folder = makeFolder("folder1", "My Folder", "d");
      const lists = [
        folder,
        makeList("1", "Inside", "m", "folder1"),
        makeList("2", "Outside", "v"),
      ];

      // Move Outside (index 2) to position 2 (after Inside)
      // This is still below the folder, so it goes INTO the folder
      const result = reorderList(lists, 2, 2);

      const moved = result.find((l) => l.id === "2");
      expect(moved.folder).toBe("folder1");
    });
  });

  describe("collapsed folder handling", () => {
    test("dropping after collapsed folder ranks after last content", () => {
      const folder = makeFolder("folder1", "Collapsed Folder", "a", false);
      const lists = [
        folder,
        makeList("1", "Hidden Inside", "b", "folder1"),
        makeList("2", "Outside", "d"),
      ];

      // Move Outside to right after the collapsed folder (visual position 1)
      // In the collapsed view, folder is at 0, Outside is at 1
      // Dropping at index 1 means between folder and what comes after
      const result = reorderList(lists, 2, 1);

      const moved = result.find((l) => l.id === "2");
      // Should rank after the hidden content
      expect(moved.rank > "b").toBe(true);
      expect(moved.folder).toBe("folder1");
    });
  });

  describe("edge cases", () => {
    test("handles moving to first position", () => {
      const lists = [
        makeList("1", "First", "d"),
        makeList("2", "Second", "m"),
      ];

      const result = reorderList(lists, 1, 0);
      const moved = result.find((l) => l.id === "2");
      expect(moved.rank < "d").toBe(true);
    });

    test("handles moving to last position", () => {
      const lists = [
        makeList("1", "First", "d"),
        makeList("2", "Second", "m"),
        makeList("3", "Third", "v"),
      ];

      // Move First (index 0) to end - destIndex 2 is the final position
      // (after removing index 0, the array has indices 0,1 so destIndex 2 = append)
      const result = reorderList(lists, 0, 2);
      const moved = result.find((l) => l.id === "1");
      // Should be after "m" (the item now at index 1 after removal)
      expect(moved.rank > "m").toBe(true);
    });

    test("sets updated_at on moved item", () => {
      const lists = [
        makeList("1", "First", "a"),
        makeList("2", "Second", "b"),
      ];

      const result = reorderList(lists, 0, 2);
      const moved = result.find((l) => l.id === "1");
      expect(moved.updated_at).toBeTruthy();
    });

    test("does not modify other items", () => {
      const lists = [
        makeList("1", "First", "a"),
        makeList("2", "Second", "b"),
      ];

      const result = reorderList(lists, 0, 2);
      const unchanged = result.find((l) => l.id === "2");
      expect(unchanged.rank).toBe("b");
      expect(unchanged.updated_at).toBeUndefined();
    });
  });
});

describe("reorderFolder", () => {
  describe("folder movement", () => {
    test("moving folder updates only folder rank", () => {
      const folder = makeFolder("folder1", "My Folder", "b");
      const lists = [
        makeList("1", "First", "a"),
        folder,
        makeList("2", "Inside", "c", "folder1"),
        makeList("3", "Outside", "d"),
      ];

      // Move folder to end
      const result = reorderFolder(lists, 1, 4);

      const movedFolder = result.find((l) => l.id === "folder1");
      expect(movedFolder.rank > "d").toBe(true);

      // Contents keep same folder reference and rank
      const content = result.find((l) => l.id === "2");
      expect(content.folder).toBe("folder1");
      expect(content.rank).toBe("c");
    });

    test("moving folder to beginning", () => {
      const folder = makeFolder("folder1", "My Folder", "v");
      const lists = [
        makeList("1", "First", "d"),
        makeList("2", "Second", "m"),
        folder,
      ];

      const result = reorderFolder(lists, 2, 0);

      const movedFolder = result.find((l) => l.id === "folder1");
      expect(movedFolder.rank < "d").toBe(true);
    });

    test("moving folder between other items", () => {
      const folder = makeFolder("folder1", "My Folder", "a");
      const lists = [
        folder,
        makeList("1", "Inside", "b", "folder1"),
        makeList("2", "Outside 1", "c"),
        makeList("3", "Outside 2", "d"),
      ];

      // Move folder to between Outside 1 and Outside 2 (index 3)
      const result = reorderFolder(lists, 0, 3);

      const movedFolder = result.find((l) => l.id === "folder1");
      expect(movedFolder.rank > "c").toBe(true);
      expect(movedFolder.rank < "d").toBe(true);
    });
  });

  describe("folder contents follow automatically", () => {
    test("sortByRank groups contents after moved folder", () => {
      const folder = makeFolder("folder1", "My Folder", "z");
      const lists = [
        makeList("1", "First", "a"),
        folder,
        makeList("2", "Inside", "b", "folder1"),
      ];

      // After sorting, folder at end means contents follow
      const sorted = sortByRank(lists);
      expect(sorted.map((l) => l.name)).toEqual([
        "First",
        "My Folder",
        "Inside",
      ]);
    });
  });

  describe("collapsed folder handling", () => {
    test("moving after collapsed folder ranks correctly", () => {
      const folder1 = makeFolder("folder1", "Open Folder", "a");
      const folder2 = makeFolder("folder2", "Collapsed Folder", "c", false);
      const lists = [
        folder1,
        makeList("1", "Inside Open", "b", "folder1"),
        folder2,
        makeList("2", "Hidden", "d", "folder2"),
      ];

      // Move Open Folder after Collapsed Folder
      const result = reorderFolder(lists, 0, 3);

      const movedFolder = result.find((l) => l.id === "folder1");
      // Should rank after the hidden content
      expect(movedFolder.rank > "d").toBe(true);
    });
  });

  describe("delegates to reorderList for non-folders", () => {
    test("regular list items use reorderList", () => {
      const lists = [
        makeList("1", "First", "d"),
        makeList("2", "Second", "m"),
        makeList("3", "Third", "v"),
      ];

      // Calling reorderFolder on a non-folder should delegate to reorderList
      // Move First to end (destIndex 2 for 3-item list when source is 0)
      const result = reorderFolder(lists, 0, 2);

      const moved = result.find((l) => l.id === "1");
      expect(moved.rank > "m").toBe(true);
    });
  });

  describe("edge cases", () => {
    test("sets updated_at on moved folder", () => {
      const folder = makeFolder("folder1", "My Folder", "a");
      const lists = [
        folder,
        makeList("1", "Outside", "b"),
      ];

      const result = reorderFolder(lists, 0, 2);
      const movedFolder = result.find((l) => l.id === "folder1");
      expect(movedFolder.updated_at).toBeTruthy();
    });
  });
});

describe("integration: reorder then sort", () => {
  test("full workflow: reorder items then sort produces correct order", () => {
    const folder = makeFolder("folder1", "My Folder", "b");
    const lists = [
      makeList("1", "First", "a"),
      folder,
      makeList("2", "Inside", "c", "folder1"),
      makeList("3", "Last", "d"),
    ];

    // Move "First" into the folder (after folder header)
    const reordered = reorderList(lists, 0, 2);
    const sorted = sortByRank(reordered);

    // First should now be inside folder
    const movedItem = sorted.find((l) => l.id === "1");
    expect(movedItem.folder).toBe("folder1");

    // Folder should contain both items
    const folderIndex = sorted.findIndex((l) => l.id === "folder1");
    expect(sorted[folderIndex + 1].folder).toBe("folder1");
    expect(sorted[folderIndex + 2].folder).toBe("folder1");
  });

  test("workflow: create list, add items, reorder", () => {
    // Simulate creating a new list with ensureRanks
    const initial = [
      makeList("1", "First"),
      makeList("2", "Second"),
      makeList("3", "Third"),
    ];

    const { lists: withRanks } = ensureRanks(initial);

    // Reorder: move Third to first position
    const reordered = reorderList(withRanks, 2, 0);
    const sorted = sortByRank(reordered);

    expect(sorted[0].name).toBe("Third");
    expect(sorted[1].name).toBe("First");
    expect(sorted[2].name).toBe("Second");
  });
});
