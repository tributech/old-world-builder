// OWR: superseded by owr-list.js — kept to minimize upstream diff
export const updateLocalList = (updatedList) => {
  const localLists = JSON.parse(localStorage.getItem("owb.lists"));
  const updatedLists =
    localLists &&
    localLists.map((list) => {
      if (list.id === updatedList.id) {
        return updatedList;
      } else {
        return list;
      }
    });

  try {
    localLists &&
      localStorage.setItem("owb.lists", JSON.stringify(updatedLists));
  } catch (error) {}
};

// OWR: superseded by owr-list.js — kept to minimize upstream diff
export const removeFromLocalList = (listId) => {
  const localLists = JSON.parse(localStorage.getItem("owb.lists"));
  const updatedLists = localLists.filter(({ id }) => listId !== id);

  localStorage.setItem("owb.lists", JSON.stringify(updatedLists));
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

    // Respect explicit folder assignment — only use positional logic
    // for items that have no folder property at all (legacy migration).
    if (list.folder !== undefined) {
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
