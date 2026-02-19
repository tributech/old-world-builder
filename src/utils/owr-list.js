import { pushToOWR } from "./owr-sync";
import { removeFromLocalList, updateListsFolder } from "./list";

const stripSyncOnlyFields = (list) => {
  if (!list) return list;
  const { updated_at, _broadcast_until, ...rest } = list;
  return rest;
};

const hasMeaningfulListChange = (currentList, nextList) => {
  const currentSerialized = JSON.stringify(stripSyncOnlyFields(currentList));
  const nextSerialized = JSON.stringify(stripSyncOnlyFields(nextList));
  return currentSerialized !== nextSerialized;
};

const persistAndSyncLists = (lists) => {
  localStorage.setItem("owb.lists", JSON.stringify(lists));
  pushToOWR(lists);
};

export const updateLocalList = (updatedList) => {
  const localLists = JSON.parse(localStorage.getItem("owb.lists")) || [];
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

export { removeFromLocalList, updateListsFolder };
