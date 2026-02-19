import { updateListsFolder } from "./list";

describe("updateListsFolder", () => {
  const makeList = (id, name, folder = null) => ({
    id,
    name,
    type: "list",
    folder,
  });

  const makeFolder = (id, name) => ({
    id,
    name,
    type: "folder",
    folder: null,
    open: true,
  });

  describe("new folder at end of array", () => {
    test("does not capture existing folder:null lists", () => {
      const list1 = makeList("list-1", "List 1", null);
      const list2 = makeList("list-2", "List 2", null);
      const newFolder = makeFolder("folder-new", "New Folder");

      // New folder appended at end
      const input = [list1, list2, newFolder];
      const result = updateListsFolder(input);

      // Lists should remain at top level
      expect(result[0].folder).toBeNull();
      expect(result[1].folder).toBeNull();
      // New folder should also be at top level
      expect(result[2].folder).toBeNull();
      expect(result[2].type).toBe("folder");
    });

    test("new folder at end doesn't affect existing folder structure", () => {
      const folder1 = makeFolder("folder-1", "Folder 1");
      const list1 = makeList("list-1", "List 1", null);
      const list2 = makeList("list-2", "List 2", null);
      const newFolder = makeFolder("folder-new", "New Folder");

      // Existing folder, some lists, then new folder
      const input = [folder1, list1, list2, newFolder];
      const result = updateListsFolder(input);

      // Folder 1 stays at top level
      expect(result[0].folder).toBeNull();
      expect(result[0].type).toBe("folder");

      // Lists after folder-1 should be assigned to it
      expect(result[1].folder).toBe("folder-1");
      expect(result[2].folder).toBe("folder-1");

      // New folder should remain at top level
      expect(result[3].folder).toBeNull();
      expect(result[3].type).toBe("folder");
    });

    test("multiple folders at end maintain independence", () => {
      const list1 = makeList("list-1", "List 1", null);
      const folder1 = makeFolder("folder-1", "Folder 1");
      const folder2 = makeFolder("folder-2", "Folder 2");

      const input = [list1, folder1, folder2];
      const result = updateListsFolder(input);

      // Top-level list
      expect(result[0].folder).toBeNull();
      // Both folders at top level
      expect(result[1].folder).toBeNull();
      expect(result[2].folder).toBeNull();
    });
  });

  describe("new folder at beginning of array (current buggy behavior)", () => {
    test("SHOULD FAIL: incorrectly captures folder:null lists", () => {
      const list1 = makeList("list-1", "List 1", null);
      const list2 = makeList("list-2", "List 2", null);
      const newFolder = makeFolder("folder-new", "New Folder");

      // New folder prepended (current buggy behavior)
      const input = [newFolder, list1, list2];
      const result = updateListsFolder(input);

      // This test documents the bug - it will pass with current code
      // but demonstrates incorrect behavior
      expect(result[1].folder).toBe("folder-new"); // BUG: should be null
      expect(result[2].folder).toBe("folder-new"); // BUG: should be null
    });
  });
});
