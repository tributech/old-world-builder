import { Fragment, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useLocation } from "react-router-dom";
import { useDispatch } from "react-redux";
import { FormattedMessage, useIntl } from "react-intl";
import { Helmet } from "react-helmet-async";
import classNames from "classnames";

import { Button } from "../../components/button";
import { Icon } from "../../components/icon";
import { ListItem, OrderableList } from "../../components/list";
import { Header, Main } from "../../components/page";
import { Dialog } from "../../components/dialog";
import { getAllPoints } from "../../utils/points";

import { setArmy } from "../../state/army";
import { setItems } from "../../state/items";
import owb from "../../assets/army-icons/owb.svg";
import owrLogo from "../../assets/owr-logo-black.svg";
import theEmpire from "../../assets/army-icons/the-empire.svg";
import dwarfs from "../../assets/army-icons/dwarfs.svg";
import greenskins from "../../assets/army-icons/greenskins.svg";
import beastmen from "../../assets/army-icons/beastmen.svg";
import chaosDeamons from "../../assets/army-icons/chaos-deamons.svg";
import chaosWarriors from "../../assets/army-icons/chaos-warriors.svg";
import darkElves from "../../assets/army-icons/dark-elves.svg";
import highElves from "../../assets/army-icons/high-elves.svg";
import lizardmen from "../../assets/army-icons/lizardmen.svg";
import ogres from "../../assets/army-icons/ogres.svg";
import skaven from "../../assets/army-icons/skaven.svg";
import tombKings from "../../assets/army-icons/tomb-kings.svg";
import vampireCounts from "../../assets/army-icons/vampire-counts.svg";
import woodElves from "../../assets/army-icons/wood-elves.svg";
import chaosDwarfs from "../../assets/army-icons/chaos-dwarfs.svg";
import bretonnia from "../../assets/army-icons/bretonnia.svg";
import cathay from "../../assets/army-icons/cathay.svg";
import renegade from "../../assets/army-icons/renegade.svg";
import { useLanguage } from "../../utils/useLanguage";
import { updateLocalList, addAtTopOp, patchListOp, togglePinnedOp, deleteListOp, deleteFolderOp } from "../../utils/owr-list";
import { useListCommit } from "../../utils/owr-list-commit";
import { sortByRank, sortWithPins, ensureRanks, reorderList, reorderFolder, dropFolderFor } from "../../utils/list-ordering";
import { SwipeableListItem } from "../../components/swipeable-list-item";
import { checkAuth, owrApiFetch, safeJson } from "../../utils/owr-sync";
import { getItem, setItem } from "../../utils/storage";
import { toggleFolder, updateList } from "../../state/lists";
import { updateSetting } from "../../state/settings";
import { getRandomId } from "../../utils/id";

import "./Home.css";

const armyIconMap = {
  "the-empire": theEmpire,
  dwarfs: dwarfs,
  greenskins: greenskins,
  "empire-of-man": theEmpire,
  "orc-and-goblin-tribes": greenskins,
  "dwarfen-mountain-holds": dwarfs,
  "warriors-of-chaos": chaosWarriors,
  "kingdom-of-bretonnia": bretonnia,
  "beastmen-brayherds": beastmen,
  "wood-elf-realms": woodElves,
  "tomb-kings-of-khemri": tombKings,
  "high-elf-realms": highElves,
  "dark-elves": darkElves,
  skaven: skaven,
  "vampire-counts": vampireCounts,
  "daemons-of-chaos": chaosDeamons,
  "ogre-kingdoms": ogres,
  lizardmen: lizardmen,
  "chaos-dwarfs": chaosDwarfs,
  "grand-cathay": cathay,
  "renegade-crowns": renegade,
};

// Comparator for the name/faction sort modes. Only items in the SAME context
// (both top-level lists, or both lists in one folder) are reordered; folders and
// cross-context pairs keep their position (0). `dir` is 1 (asc) or -1 (desc).
const fieldComparator = (field, dir) => (a, b) => {
  const sameContext =
    a.type !== "folder" &&
    b.type !== "folder" &&
    ((!a.folder && !b.folder) || (a.folder && a.folder === b.folder));
  if (!sameContext || !a[field] || !b[field]) return 0;
  return dir * a[field].localeCompare(b[field]);
};
const LIST_SORTERS = {
  nameAsc: fieldComparator("name", 1),
  nameDesc: fieldComparator("name", -1),
  faction: fieldComparator("army", 1),
};

export const Home = ({ isMobile }) => {
  const MainComponent = isMobile ? Main : Fragment;
  const settings = useSelector((state) => state.settings);
  const dispatch = useDispatch();
  const commit = useListCommit();
  const rawLists = useSelector((state) => state.lists);

  // Ensure all lists have ranks (migration for legacy lists). Reads fresh
  // storage so tombstones survive, runs ensureRanks over the live lists only,
  // and commits (which auto-marks the re-ranked ids dirty) just when something
  // actually changed — committing every render would loop.
  useEffect(() => {
    if (!rawLists || rawLists.length === 0) return;
    const stored = JSON.parse(getItem("owb.lists")) || [];
    const live = stored.filter((l) => !l._deleted);
    const tombstones = stored.filter((l) => l._deleted);
    const { lists: withRanks, needsUpdate } = ensureRanks(live);
    if (needsUpdate) {
      commit(() => [...withRanks, ...tombstones]);
    }
  }, [rawLists, commit]);

  // Sort by rank - folder values are stored explicitly and synced
  // (ensureRanks handles migration of legacy lists without ranks/folders)
  let lists = sortByRank(ensureRanks(rawLists).lists);

  // Sort lists based on the current sorting setting (manual = leave rank order).
  const sorter = LIST_SORTERS[settings.listSorting];
  if (sorter) lists = [...lists].sort(sorter);

  // Float pinned items to the top within their context group
  lists = sortWithPins(lists);

  // Insert a phantom drop-zone after each open folder's last child (or
  // right after the header if the folder is empty). Phantoms are visual
  // only — they exist in the array passed to OrderableList so rbd reports
  // a destination index for them, then they're filtered out before any
  // state is persisted. They make "drop into the LAST position of an
  // open folder" reachable without overloading the boundary slot.
  const listsWithPhantoms = (() => {
    const result = [];
    let i = 0;
    while (i < lists.length) {
      const item = lists[i];
      result.push(item);
      i++;
      if (item.type === "folder" && item.open !== false) {
        while (i < lists.length && lists[i].folder === item.id) {
          result.push(lists[i]);
          i++;
        }
        result.push({
          id: `phantom-${item.id}`,
          _phantom: true,
          folder: item.id,
        });
      }
    }
    return result;
  })();

  const location = useLocation();
  const { language } = useLanguage();
  const intl = useIntl();
  const [listsInFolder, setListsInFolder] = useState([]);
  const [dragIntoFolder, setDragIntoFolder] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Per-folder child count, used to flag empty-open folders for a small
  // margin (so users can see they really are empty).
  const folderChildCounts = useMemo(() => {
    const counts = new Map();
    for (const item of lists) {
      if (item.type === "folder") {
        if (!counts.has(item.id)) counts.set(item.id, 0);
      } else if (item.folder) {
        counts.set(item.folder, (counts.get(item.folder) || 0) + 1);
      }
    }
    return counts;
  }, [lists]);
  const [dialogOpen, setDialogOpen] = useState(null);
  const [activeMenu, setActiveMenu] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [activeDeleteOption, setActiveDeleteOption] = useState("delete");
  const [tournamentMap, setTournamentMap] = useState({});

  useEffect(() => {
    let cancelled = false;
    const fetchTournaments = async () => {
      const authed = await checkAuth();
      if (cancelled || !authed) return;
      try {
        const res = await owrApiFetch("/api/builder/tournaments");
        if (!res.ok) return;
        const data = await safeJson(res);
        if (!data) return; // dev server returned HTML — silently ignore
        const map = {};
        (data.tournaments || []).forEach((t) => {
          if (t.submitted_list_id) {
            map[t.submitted_list_id] = {
              approved: t.list_approved,
              name: t.name,
              url: t.friendly_url,
            };
          }
        });
        if (!cancelled) setTournamentMap(map);
      } catch (e) {
        console.warn("Failed to fetch tournament status:", e);
      }
    };
    fetchTournaments();
    return () => { cancelled = true; };
  }, []);

  const resetState = () => {
    dispatch(setArmy(null));
    dispatch(setItems(null));
  };
  const updateLocalSettings = (newSettings) => {
    setItem("owb.settings", JSON.stringify(newSettings));
  };
  // Stamp settings.lastChanged in both Redux and localStorage (used by drag,
  // rename, and new-folder so the list view re-renders / re-syncs).
  const touchLastChanged = () => {
    const lastChanged = new Date().toString();
    dispatch(updateSetting({ lastChanged }));
    setItem("owb.settings", JSON.stringify({ ...settings, lastChanged }));
  };
  const folders = lists.filter((list) => list.type === "folder");
  // Drag-and-drop only makes sense in manual order. When a Name/Faction sort
  // is active the comparator would immediately override any dragged rank, so
  // we disable dragging entirely until the user switches back to Manual.
  const sortActive = !!settings.listSorting && settings.listSorting !== "manual";
  // Hover tooltip explaining why drag-to-reorder is inert while a Name/Faction
  // sort is active (drag is disabled in that mode — see OrderableList).
  const reorderHint = sortActive
    ? intl.formatMessage({ id: "home.reorderDisabledSorted" })
    : undefined;

  const handleListMoved = ({ sourceIndex, destinationIndex }) => {
    // Indices from rbd are into listsWithPhantoms — same array passed to
    // OrderableList. We pass that augmented list to reorder* so prev/next
    // anchors include phantoms; phantoms are filtered out of the result
    // before any state is touched (they're never persisted).
    const draggedItem = listsWithPhantoms[sourceIndex];
    const difference = sourceIndex - destinationIndex;

    setListsInFolder([]);
    setIsDragging(false);
    setDragIntoFolder(false);

    if (difference === 0 || !draggedItem || draggedItem._phantom) {
      return;
    }

    if (draggedItem.type === "folder") {
      // reorderFolder only changes the folder's rank; its contents follow via
      // sort. We extract that new rank and patch it onto fresh storage so any
      // pending tombstones survive.
      const reordered = reorderFolder(
        listsWithPhantoms,
        sourceIndex,
        destinationIndex,
      );
      const moved = reordered.find((l) => l.id === draggedItem.id);
      commit(patchListOp(draggedItem.id, { rank: moved.rank }));
    } else {
      // reorderList computes the dragged item's new rank + folder; patch just
      // those onto fresh storage.
      const reordered = reorderList(
        listsWithPhantoms,
        sourceIndex,
        destinationIndex,
      );
      const moved = reordered.find((l) => l.id === draggedItem.id);
      commit(
        patchListOp(draggedItem.id, { rank: moved.rank, folder: moved.folder }),
      );
      touchLastChanged();
    }
  };
  const listsWithoutFolders = lists.filter((list) => list.type !== "folder");
  const moreButtonsFolder = [
    {
      name: intl.formatMessage({
        id: "misc.rename",
      }),
      icon: "edit",
      callback: ({ name }) => {
        setFolderName(name);
        setDialogOpen("edit");
      },
    },
    {
      name: intl.formatMessage({
        id: "misc.delete",
      }),
      icon: "delete",
      callback: ({ name }) => {
        setFolderName(name);
        setActiveDeleteOption("delete");
        setDialogOpen("delete");
      },
    },
  ];
  const moreButtonsSort = [
    {
      name: intl.formatMessage({
        id: "misc.manual",
      }),
      type: "manual",
      callback: () => {
        setSortMenuOpen(false);
        updateLocalSettings({
          ...settings,
          listSorting: "manual",
        });
        dispatch(
          updateSetting({
            listSorting: "manual",
            lastChanged: new Date().toString(),
          }),
        );
      },
    },
    {
      name: intl.formatMessage({
        id: "misc.faction",
      }),
      type: "faction",
      callback: () => {
        setSortMenuOpen(false);
        updateLocalSettings({
          ...settings,
          listSorting: "faction",
        });
        dispatch(
          updateSetting({
            listSorting: "faction",
            lastChanged: new Date().toString(),
          }),
        );
      },
    },
    {
      name: intl.formatMessage({
        id: "misc.nameAsc",
      }),
      type: "nameAsc",
      callback: () => {
        setSortMenuOpen(false);
        updateLocalSettings({
          ...settings,
          listSorting: "nameAsc",
        });
        dispatch(
          updateSetting({
            listSorting: "nameAsc",
            lastChanged: new Date().toString(),
          }),
        );
      },
    },
    {
      name: intl.formatMessage({
        id: "misc.nameDesc",
      }),
      type: "nameDesc",
      callback: () => {
        setSortMenuOpen(false);
        updateLocalSettings({
          ...settings,
          listSorting: "nameDesc",
        });
        dispatch(
          updateSetting({
            listSorting: "nameDesc",
            lastChanged: new Date().toString(),
          }),
        );
      },
    },
  ];
  const handleCancelClick = (event) => {
    event.preventDefault();
    setDialogOpen(null);
    setActiveMenu(null);
    setFolderName("");
  };
  const handleDeleteConfirm = () => {
    const folderId = activeMenu;
    setDialogOpen(null);
    setActiveMenu(null);
    // "delete" tombstones the folder + its lists; "keep" tombstones only the
    // folder and re-parents its lists to top level (so they don't orphan).
    commit(
      deleteFolderOp(folderId, {
        deleteContents: activeDeleteOption === "delete",
      }),
    );
  };
  const handleEditConfirm = () => {
    const list = lists.find((list) => list.id === activeMenu);

    setDialogOpen(null);
    setActiveMenu(null);
    dispatch(updateList({ ...list, listId: list.id, name: folderName }));
    updateLocalList({
      ...list,
      name: folderName,
    });
    touchLastChanged();
  };
  const handleNewConfirm = () => {
    // New folder lands at the very top, just below any pinned lists.
    commit(
      addAtTopOp({
        id: `folder-${getRandomId()}`,
        name: folderName || intl.formatMessage({ id: "home.newFolder" }),
        type: "folder",
        open: true,
      }),
    );
    touchLastChanged();
    setFolderName("");
    setDialogOpen(null);
  };
  // onBeforeCapture fires BEFORE rbd measures dimensions, so the phantom
  // drop slots can grow to their active height in time to be measured. If
  // we deferred this to onBeforeDragStart, rbd would still see them as
  // zero-height and the user couldn't reliably drop into them.
  const handleBeforeCapture = () => {
    setIsDragging(true);
  };
  const handleDragStart = (start) => {
    const draggedItem = lists.find(
      (list) =>
        list.id === start.draggableId || list.folder === start.draggableId,
    );
    const listsInFolder = lists
      .map((list, index) => ({ folder: list.folder, index: index }))
      .filter((list) => list.folder);

    if (draggedItem?.type === "folder") {
      setListsInFolder(listsInFolder);
    }
  };
  const handleDragEnd = () => {
    // Always clear transient drag state — even when the drop is cancelled
    // (Esc, dropped outside the list). handleListMoved only runs on a real
    // drop, so the cleanup has to live here too.
    setIsDragging(false);
    setDragIntoFolder(false);
    setListsInFolder([]);
  };
  const handleDragUpdate = (update) => {
    if (!update.destination) {
      setDragIntoFolder(false);
      return;
    }
    const sourceItem = listsWithPhantoms[update.source.index];
    // Folders never go INTO folders.
    if (sourceItem?.type === "folder") {
      setDragIntoFolder(false);
      return;
    }
    // Use the same prev/next-based rule as the actual drop so the visual
    // indent agrees with where the item will land. Indices are into the
    // augmented list (with phantoms).
    const withoutItem = listsWithPhantoms.filter(
      (_, i) => i !== update.source.index,
    );
    setDragIntoFolder(
      dropFolderFor(withoutItem, update.destination.index) !== null,
    );
  };
  const handleDeleteOptionChange = (option) => {
    setActiveDeleteOption(option);
  };
  const handleTogglePin = (listId) => {
    commit(togglePinnedOp(listId));
  };
  // Swipe-left commits the delete immediately. The snap-open + 300ms
  // settle inside useSwipeGesture is the visual confirmation; the user
  // had to drag past the snap threshold to get here so a dialog adds
  // friction without value.
  const handleSwipeDelete = (listId) => {
    commit(deleteListOp(listId));
  };

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <>
      <Helmet>
        <title>
          Battle Builder - Army list builder for Warhammer: The Old World
        </title>
      </Helmet>

      <Dialog
        open={dialogOpen === "delete"}
        onClose={() => setDialogOpen(null)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleDeleteConfirm();
          }}
        >
          <p className="home__delete-text">
            <FormattedMessage
              id="home.confirmDelete"
              values={{
                folder: <b>{folderName}</b>,
              }}
            />
          </p>
          <div className="radio">
            <input
              type="radio"
              id="delete-lists"
              name="lists"
              value="delete"
              onChange={() => handleDeleteOptionChange("delete")}
              checked={activeDeleteOption === "delete"}
              className="radio__input"
            />
            <label htmlFor="delete-lists" className="radio__label">
              <span className="unit__label-text">
                <FormattedMessage id="home.deleteLists" />
              </span>
            </label>
          </div>
          <div className="radio">
            <input
              type="radio"
              id="keep-lists"
              name="lists"
              value="keep"
              onChange={() => handleDeleteOptionChange("keep")}
              checked={activeDeleteOption === "keep"}
              className="radio__input"
            />
            <label htmlFor="keep-lists" className="radio__label">
              <span className="unit__label-text">
                <FormattedMessage id="home.keepLists" />
              </span>
            </label>
          </div>
          <div className="editor__delete-dialog">
            <Button
              type="text"
              onClick={handleCancelClick}
              icon="close"
              spaceTop
              color="dark"
            >
              <FormattedMessage id="misc.cancel" />
            </Button>
            <Button type="primary" submitButton icon="delete" spaceTop>
              <FormattedMessage id="misc.delete" />
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={dialogOpen === "edit"} onClose={() => setDialogOpen(null)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleEditConfirm();
          }}
        >
          <label htmlFor="folderName">
            <FormattedMessage id="misc.folderName" />
          </label>
          <input
            type="text"
            id="folderName"
            className="input"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            autoComplete="off"
            maxLength="100"
            required
          />
          <div className="editor__delete-dialog">
            <Button
              type="text"
              onClick={handleCancelClick}
              icon="close"
              spaceTop
              color="dark"
            >
              <FormattedMessage id="misc.cancel" />
            </Button>
            <Button type="primary" submitButton icon="check" spaceTop>
              <FormattedMessage id="misc.confirm" />
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={dialogOpen === "new"} onClose={() => setDialogOpen(null)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleNewConfirm();
          }}
        >
          <label htmlFor="newFolderName">
            <FormattedMessage id="misc.folderName" />
          </label>
          <input
            type="text"
            id="newFolderName"
            className="input"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            autoComplete="off"
            maxLength="100"
            required
          />
          <div className="editor__delete-dialog">
            <Button
              type="text"
              onClick={handleCancelClick}
              icon="close"
              spaceTop
              color="dark"
            >
              <FormattedMessage id="misc.cancel" />
            </Button>
            <Button type="primary" submitButton icon="check" spaceTop>
              <FormattedMessage id="misc.confirm" />
            </Button>
          </div>
        </form>
      </Dialog>

      {isMobile && <Header headline="Battle Builder" hasMainNavigation hasOWRButton />}
      <MainComponent>
        {listsWithoutFolders.length > 0 && (
          <section className="column-header home__header">
            <Button
              type="text"
              label={intl.formatMessage({ id: "home.newFolder" })}
              color="dark"
              icon="new-folder"
              onClick={() => {
                setFolderName("");
                setDialogOpen("new");
              }}
            >
              <FormattedMessage id="home.newFolder" />
            </Button>
            <Button
              type="text"
              label={reorderHint || intl.formatMessage({ id: "misc.sort" })}
              color="dark"
              onClick={() => {
                setSortMenuOpen(!sortMenuOpen);
              }}
              className={classNames(sortMenuOpen && "header__more-button")}
            >
              <FormattedMessage
                id={`misc.${settings.listSorting || "manual"}`}
              />
              <Icon symbol="sort" className="home__sort-icon" />
            </Button>
            {sortMenuOpen && (
              <ul className="header__more">
                {moreButtonsSort.map(
                  ({ callback, name, type, to: moreButtonTo }) => (
                    <li key={name}>
                      <Button
                        type="text"
                        onClick={() => callback({ type })}
                        to={moreButtonTo}
                      >
                        {name}
                      </Button>
                    </li>
                  ),
                )}
              </ul>
            )}
          </section>
        )}

        {lists.length > 0 ? <hr className="home__divider" /> : null}

        {listsWithoutFolders.length === 0 && (
          <>
            <img
              src={owrLogo}
              alt=""
              width="120"
              height="120"
              className="home__logo"
            />
            <i className="home__empty">
              <FormattedMessage id="home.empty" />
            </i>
          </>
        )}
        <OrderableList
          id="armies"
          onMoved={handleListMoved}
          onBeforeCapture={handleBeforeCapture}
          onDragStart={handleDragStart}
          onDragUpdate={handleDragUpdate}
          onDragEnd={handleDragEnd}
          intoFolder={dragIntoFolder}
          disabled={sortActive}
        >
          {listsWithPhantoms.map(
            ({
              id,
              name,
              description,
              points,
              game,
              army,
              type,
              folder,
              open,
              pinned_at,
              _phantom,
              ...list
            }) =>
              _phantom ? (
                <li
                  key={id}
                  className={classNames(
                    "home__phantom-drop",
                    isDragging && "home__phantom-drop--active",
                  )}
                  data-folder={folder}
                  // dragDisabled is read by OrderableList to skip rbd drag
                  // handlers; the slot still occupies an rbd index so the
                  // user can drop ON it (= last position in folder).
                  dragDisabled
                />
              ) : type === "folder" ? (
                <ListItem
                  key={id}
                  as="div"
                  title={reorderHint}
                  onClick={() => {
                    updateLocalList({ id, name, type, open: !open });
                    dispatch(toggleFolder({ folderId: id }));
                  }}
                  className={classNames(
                    "home__folder",
                    activeMenu === id && "home__folder--active",
                    open &&
                      (folderChildCounts.get(id) || 0) === 0 &&
                      "home__folder--empty-open",
                  )}
                >
                  <span className="home__list-item">
                    <h2 className="home__headline home__headline--folder">
                      <Button
                        type="text"
                        label={intl.formatMessage({
                          id: "export.optionsTitle",
                        })}
                        color="dark"
                        icon="more"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (activeMenu === id) {
                            setActiveMenu(null);
                          } else {
                            setActiveMenu(id);
                          }
                        }}
                        className={classNames(
                          activeMenu === id && "header__more-button",
                        )}
                      />
                      <span className="home__folder-name">{name}</span>
                      <Icon
                        symbol={open ? "folder-open" : "folder-closed"}
                        className="home__folder-state-icon"
                      />
                    </h2>
                  </span>
                  {activeMenu === id && (
                    <ul className="header__more folder__more">
                      {moreButtonsFolder.map(
                        ({
                          callback,
                          name: buttonName,
                          icon,
                          to: moreButtonTo,
                        }) => (
                          <li key={buttonName}>
                            <Button
                              type="text"
                              onClick={(event) => {
                                event.stopPropagation();
                                callback({ name });
                              }}
                              to={moreButtonTo}
                              icon={icon}
                            >
                              {buttonName}
                            </Button>
                          </li>
                        ),
                      )}
                    </ul>
                  )}
                </ListItem>
              ) : (
                <SwipeableListItem
                  key={id}
                  to={`/editor/${id}`}
                  title={reorderHint}
                  active={location.pathname.includes(id)}
                  onClick={resetState}
                  hide={
                    folders.find((folderData) => folderData.id === folder)
                      ?.open === false
                  }
                  className={classNames(
                    listsInFolder.length > 0 && "home__list--dragging",
                  )}
                  isPinned={!!pinned_at}
                  onSwipeLeft={() => handleSwipeDelete(id)}
                  onSwipeRight={() => handleTogglePin(id)}
                >
                  {folder ? (
                    <Icon symbol="folder" className="home__folder-icon" />
                  ) : null}
                  {pinned_at && (
                    <Icon symbol="pin" className="home__pin-icon" />
                  )}
                  <span className="home__list-item">
                    <h2 className="home__headline">{name}</h2>
                    {description && (
                      <p className="home__description">{description}</p>
                    )}
                    <p className="home__points">
                      {getAllPoints({
                        ...list,
                        points,
                      })}{" "}
                      / {points} <FormattedMessage id="app.points" />
                    </p>
                  </span>
                  <div className="home__info">
                    <img
                      height="40"
                      width="40"
                      src={armyIconMap[army] || owb}
                      alt=""
                    />
                    {tournamentMap[id] && (
                      <a
                        href={tournamentMap[id].url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`home__tournament-icon ${
                          tournamentMap[id].approved
                            ? "home__tournament-icon--approved"
                            : "home__tournament-icon--pending"
                        }`}
                        title={tournamentMap[id].name}
                        onClick={(e) => e.stopPropagation()}
                      >
                        🏟️
                      </a>
                    )}
                  </div>
                </SwipeableListItem>
              ),
          )}
        </OrderableList>
        <Button
          centered
          to="/new"
          icon="new-list"
          spaceTop
          onClick={resetState}
          size="large"
        >
          <FormattedMessage id="home.newList" />
        </Button>
        <Button
          centered
          to="/import"
          type="text"
          icon="import"
          color="dark"
          spaceTop
          onClick={resetState}
        >
          <FormattedMessage id="home.import" />
        </Button>
      </MainComponent>
    </>
  );
};
