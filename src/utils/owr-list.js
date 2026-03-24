import { pushToOWR } from "./owr-sync";
import { updateListsFolder } from "./list";
import { getItem, setItem } from "./storage";

const stripMetadataFields = (list) => {
  if (!list) return list;
  const { updated_at, _broadcast_until, open, ...rest } = list;
  return rest;
};

export const hasMeaningfulListChange = (currentList, nextList) => {
  const currentSerialized = JSON.stringify(stripMetadataFields(currentList));
  const nextSerialized = JSON.stringify(stripMetadataFields(nextList));
  return currentSerialized !== nextSerialized;
};

const persistAndSyncLists = (lists) => {
  setItem("owb.lists", JSON.stringify(lists));
  pushToOWR(lists);
};

export const updateLocalList = (updatedList) => {
  const localLists = JSON.parse(getItem("owb.lists")) || [];
  const currentList = localLists.find((list) => list.id === updatedList?.id);
  if (!currentList) return;

  const mergedList = {
    ...currentList,
    ...updatedList,
  };

  if (!hasMeaningfulListChange(currentList, mergedList)) return;

  const listWithTimestamp = {
    ...mergedList,
    updated_at: new Date().toISOString(),
  };

  const updatedLists = localLists.map((list) =>
    list.id === listWithTimestamp.id ? listWithTimestamp : list
  );

  try {
    persistAndSyncLists(updatedLists);
  } catch (error) {}
};

export const removeFromLocalList = (listId) => {
  const localLists = JSON.parse(getItem("owb.lists")) || [];

  const updatedLists = localLists.map((list) =>
    list.id === listId
      ? { ...list, _deleted: true, updated_at: new Date().toISOString() }
      : list
  );

  persistAndSyncLists(updatedLists);
};

export { updateListsFolder };
