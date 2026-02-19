import { useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import {
  Switch,
  Route,
  BrowserRouter,
  HashRouter,
  useLocation,
} from "react-router-dom";
import { isMobileAppContext } from "./utils/owr-sync";

import { NewList } from "./pages/new-list";
import { Editor } from "./pages/editor";
import { Home } from "./pages/home";
import { Unit } from "./pages/unit";
import { EditList } from "./pages/edit-list";
import { Magic } from "./pages/magic";
import { About } from "./pages/about";
import { Add } from "./pages/add";
import { Help } from "./pages/help";
import { Export } from "./pages/export";
import { Print } from "./pages/print";
import { DuplicateList } from "./pages/duplicate-list";
import { Rename } from "./pages/rename";
import { Datasets } from "./pages/datasets";
import { NotFound } from "./pages/not-found";
import { Privacy } from "./pages/privacy";
import { Changelog } from "./pages/changelog";
import { Import } from "./pages/import";
import { GameView } from "./pages/game-view";
import { CustomDatasets } from "./pages/custom-datasets";
import { setLists } from "./state/lists";
import { setSettings } from "./state/settings";
import { Header, Main } from "./components/page";
import {
  pullFromOWR,
  cleanupDeletedLists,
  flushPendingSync,
} from "./utils/owr-sync";

import "./App.css";

const LIST_ROUTE_PATTERNS = [
  /^\/editor\/([^/]+)/,
  /^\/game-view\/([^/]+)/,
  /^\/print\/([^/]+)/,
];

const getListIdFromPathname = (pathname) => {
  for (const pattern of LIST_ROUTE_PATTERNS) {
    const match = pathname.match(pattern);
    if (match) return match[1];
  }
  return null;
};

const SyncOnListNavigation = () => {
  const location = useLocation();
  const previousListIdRef = useRef(null);

  useEffect(() => {
    const currentListId = getListIdFromPathname(location.pathname);
    const previousListId = previousListIdRef.current;

    if (previousListId && previousListId !== currentListId) {
      void flushPendingSync();
    }

    previousListIdRef.current = currentListId;
  }, [location.pathname]);

  return null;
};

export const App = () => {
  const dispatch = useDispatch();
  const [isMobile, setIsMobile] = useState(
    window.matchMedia("(max-width: 1279px)").matches
  );

  useEffect(() => {
    const initApp = async () => {
      console.log("🚀 App.js: Initializing app");
      console.log("   isMobileAppContext:", isMobileAppContext());
      console.log("   window.__OWR_AUTH__:", window.__OWR_AUTH__);
      console.log("   window.__OWR_CONFIG__:", window.__OWR_CONFIG__);

      const localListsRaw = localStorage.getItem("owb.lists");
      const localSettings = localStorage.getItem("owb.settings");
      const localLists = JSON.parse(localListsRaw) || [];

      console.log("📋 App.js: Loaded local lists:", localLists.length);

      dispatch(setSettings(JSON.parse(localSettings)));

      // IMMEDIATELY show local lists (filter out deleted) to avoid empty flash
      const displayLists = localLists.filter((l) => !l._deleted);
      dispatch(setLists(displayLists));
      console.log("📋 App.js: Immediately showing", displayLists.length, "local lists");

      // Then sync with OWR in background (will gracefully fail if not authenticated)
      try {
        console.log("🔄 App.js: Calling pullFromOWR...");
        const mergedLists = await pullFromOWR(localLists);
        const cleanMerged = mergedLists.filter((l) => !l._deleted);
        console.log("✅ App.js: pullFromOWR returned", cleanMerged.length, "lists");

        // Only update if there are actual changes
        if (JSON.stringify(cleanMerged) !== JSON.stringify(displayLists)) {
          localStorage.setItem("owb.lists", JSON.stringify(mergedLists));
          dispatch(setLists(cleanMerged));
        }

        // Cleanup deleted lists from storage after successful sync
        cleanupDeletedLists();
      } catch (e) {
        console.error("❌ App.js: Error during pullFromOWR:", e);
        // Already showing local lists, no action needed
      }
    };

    initApp();
  }, [dispatch]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1279px)");

    if (mediaQuery?.addEventListener) {
      mediaQuery.addEventListener("change", (event) =>
        setIsMobile(event.matches)
      );
    } else {
      mediaQuery.addListener((event) => setIsMobile(event.matches));
    }
  }, []);

  // Use HashRouter for mobile app (file:// URLs don't work with BrowserRouter)
  const Router = isMobileAppContext() ? HashRouter : BrowserRouter;
  const routerProps = isMobileAppContext() ? {} : { basename: "/builder" };

  return (
    <Router {...routerProps}>
      <SyncOnListNavigation />
      {isMobile ? (
        <Switch>
          <Route path="/editor/:listId/edit">{<EditList isMobile />}</Route>
          <Route path="/editor/:listId/export">{<Export isMobile />}</Route>
          <Route path="/editor/:listId/duplicate">
            {<DuplicateList isMobile />}
          </Route>
          <Route path="/editor/:listId/add/:type">{<Add isMobile />}</Route>
          <Route path="/editor/:listId/:type/:unitId/magic/:command">
            {<Magic isMobile />}
          </Route>
          <Route path="/editor/:listId/:type/:unitId/rename">
            {<Rename isMobile />}
          </Route>
          <Route path="/editor/:listId/:type/:unitId/items/:group">
            {<Magic isMobile />}
          </Route>
          <Route path="/editor/:listId/:type/:unitId">
            {<Unit isMobile />}
          </Route>
          <Route path="/editor/:listId">{<Editor isMobile />}</Route>
          <Route path="/import">{<Import isMobile />}</Route>
          <Route path="/new">{<NewList isMobile />}</Route>
          <Route path="/about">{<About />}</Route>
          <Route path="/help">{<Help />}</Route>
          <Route path="/custom-datasets">{<CustomDatasets />}</Route>
          <Route path="/privacy">{<Privacy />}</Route>
          <Route path="/datasets">{<Datasets isMobile />}</Route>
          <Route path="/changelog">{<Changelog />}</Route>
          <Route path="/print/:listId">{<Print />}</Route>
          <Route path="/game-view/:listId">{<GameView />}</Route>
          <Route path="/" exact>
            {<Home isMobile />}
          </Route>
          <Route path="*">{<NotFound />}</Route>
        </Switch>
      ) : (
        <Switch>
          <Route path="/about">{<About />}</Route>
          <Route path="/help">{<Help />}</Route>
          <Route path="/custom-datasets">{<CustomDatasets />}</Route>
          <Route path="/privacy">{<Privacy />}</Route>
          <Route path="/datasets">{<Datasets />}</Route>
          <Route path="/changelog">{<Changelog />}</Route>
          <Route path="/print/:listId">{<Print />}</Route>
          <Route path="/game-view/:listId">{<GameView />}</Route>
          <Route path="/">
            <Header headline="Battle Builder" hasMainNavigation hasOWRButton />
            <Main isDesktop>
              <section className="column">
                <Home />
              </section>
              <section className="column">
                <Switch>
                  <Route path="/new">{<NewList />}</Route>
                  <Route path="/import">{<Import />}</Route>
                  <Route path="/editor/:listId">{<Editor />}</Route>
                </Switch>
              </section>
              <section className="column">
                <Switch>
                  <Route path="/editor/:listId/edit">{<EditList />}</Route>
                  <Route path="/editor/:listId/export">{<Export />}</Route>
                  <Route path="/editor/:listId/duplicate">
                    <DuplicateList />
                  </Route>
                  <Route path="/editor/:listId/add/:type">{<Add />}</Route>
                  <Route path="/editor/:listId/:type/:unitId">{<Unit />}</Route>
                </Switch>
              </section>
              <section className="column">
                <Switch>
                  <Route path="/editor/:listId/:type/:unitId/magic/:command">
                    <Magic />
                  </Route>
                  <Route path="/editor/:listId/:type/:unitId/rename">
                    <Rename />
                  </Route>
                  <Route path="/editor/:listId/:type/:unitId/items/:group">
                    <Magic />
                  </Route>
                </Switch>
              </section>
            </Main>
          </Route>
        </Switch>
      )}
    </Router>
  );
};
