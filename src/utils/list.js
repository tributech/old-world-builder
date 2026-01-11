import { pushToOWR } from "./owr-sync";

export const updateLocalList = (updatedList) => {
  const localLists = JSON.parse(localStorage.getItem("owb.lists"));

  // Add timestamp for sync
  const listWithTimestamp = {
    ...updatedList,
    updated_at: new Date().toISOString(),
  };

  const updatedLists =
    localLists &&
    localLists.map((list) => {
      if (list.id === listWithTimestamp.id) {
        return listWithTimestamp;
      } else {
        return list;
      }
    });

  try {
    if (localLists) {
      localStorage.setItem("owb.lists", JSON.stringify(updatedLists));
      pushToOWR(updatedLists);
    }
  } catch (error) {}
};

export const removeFromLocalList = (listId) => {
  const localLists = JSON.parse(localStorage.getItem("owb.lists")) || [];

  // Mark as deleted with timestamp instead of filtering out
  // This allows the deletion to sync properly to the server
  const updatedLists = localLists.map((list) =>
    list.id === listId
      ? { ...list, _deleted: true, updated_at: new Date().toISOString() }
      : list
  );

  localStorage.setItem("owb.lists", JSON.stringify(updatedLists));
  pushToOWR(updatedLists);
};

export const updateListsFolder = (lists) => {
  const folderIndexes = {};
  let latestFolderIndex = null;

  lists.forEach((folder, index) => {
    if (folder.type === "folder") {
      folderIndexes[index] = folder.id;
    }
  });

  const newLists = lists.map((list, index) => {
    if (folderIndexes[index]) {
      latestFolderIndex = index;
    }

    if (list.type === "folder") {
      return list;
    }

    const newFolder =
      latestFolderIndex !== null ? folderIndexes[latestFolderIndex] : null;

    // Update timestamp if folder actually changed (for sync)
    if (list.folder !== newFolder) {
      return {
        ...list,
        folder: newFolder,
        updated_at: new Date().toISOString(),
      };
    }

    return {
      ...list,
      folder: newFolder,
    };
  });

  return newLists;
};
