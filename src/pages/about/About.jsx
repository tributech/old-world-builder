import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { FormattedMessage, useIntl } from "react-intl";
import { Helmet } from "react-helmet-async";

import { Header, Main } from "../../components/page";
import { getItem, storageBackend } from "../../utils/storage";
import { isValidRank } from "../../utils/order-keys";
import { version } from "../../../package.json";

import "./About.css";

const measureListsStorage = () => {
  const raw = getItem("owb.lists") || "[]";
  let listCount = 0;
  // Rank health: tells at a glance whether this builder is on the new
  // order-key ranks or still carrying legacy/decayed ranks that need migrating.
  let legacy = 0; // present but not a valid order key (old lexorank / corrupt)
  let unranked = 0; // no rank yet (new arrival awaiting ensureRanks)
  try {
    const parsed = JSON.parse(raw) || [];
    const live = parsed.filter((l) => l && !l._deleted);
    listCount = parsed.length;
    for (const l of live) {
      if (l.rank == null) unranked++;
      else if (!isValidRank(l.rank)) legacy++;
    }
  } catch {
    listCount = 0;
  }
  let dirtyCount = 0;
  try {
    dirtyCount = (JSON.parse(getItem("dirtyIds") || "[]") || []).length;
  } catch {
    dirtyCount = 0;
  }
  // String length is byte-equivalent for ASCII; close enough for a debug readout.
  const bytes = new Blob([raw]).size;
  return {
    kb: (bytes / 1024).toFixed(1),
    listCount,
    dirtyCount,
    legacy,
    unranked,
    backend: storageBackend(), // "idb" once IndexedDB is in use, "ls" fallback
  };
};

export const About = () => {
  const location = useLocation();
  const intl = useIntl();
  const [storage, setStorage] = useState(() => measureListsStorage());

  useEffect(() => {
    window.scrollTo(0, 0);
    setStorage(measureListsStorage());
  }, [location.pathname]);

  return (
    <>
      <Helmet>
        <title>
          {`Battle Builder | ${intl.formatMessage({ id: "footer.about" })}`}
        </title>
      </Helmet>

      <Header headline="Battle Builder" hasMainNavigation hasHomeButton />

      <Main compact>
        <h2 className="page-headline">
          <FormattedMessage id="about.title" />
        </h2>
        <p>
          <FormattedMessage id="about.text" />
        </p>

        <h2>Credits</h2>
        <p>
          <FormattedMessage
            id="about.text2"
            values={{
              github: (
                <a
                  href="https://github.com/nthiebes/old-world-builder"
                  target="_blank"
                  rel="noreferrer"
                >
                  GitHub
                </a>
              ),
            }}
          />
        </p>
        <p>
          <FormattedMessage
            id="about.rulesIndex"
            values={{
              rulesIndex: (
                <a
                  href="https://www.whfb.app/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Online Rules Index
                </a>
              ),
            }}
          />
        </p>
        <p>
          <FormattedMessage
            id="about.credits"
            values={{
              gameIcons: (
                <a
                  href="https://game-icons.net"
                  target="_blank"
                  rel="noreferrer"
                >
                  game-icons.net
                </a>
              ),
              license: (
                <a
                  href="https://creativecommons.org/licenses/by/3.0/"
                  target="_blank"
                  rel="noreferrer"
                >
                  CC BY 3.0
                </a>
              ),
            }}
          />
        </p>
        <br />
        <p>
          <b>
            <FormattedMessage id="about.disclaimer" />
          </b>
        </p>
        <p>
          Warhammer: the Old World, Citadel, Forge World, Games Workshop, GW,
          Warhammer, the 'winged-hammer' Warhammer logo, the Chaos devices, the
          Chaos logo, Citadel Device, the Double-Headed/Imperial Eagle device,
          'Eavy Metal, Games Workshop logo, Golden Demon, Great Unclean One, the
          Hammer of Sigmar logo, Horned Rat logo, Keeper of Secrets, Khemri,
          Khorne, Lord of Change, Nurgle, Skaven, the Skaven symbol devices,
          Slaanesh, Tomb Kings, Trio of Warriors, Twin Tailed Comet Logo,
          Tzeentch, Warhammer Online, Warhammer World logo, White Dwarf, the
          White Dwarf logo, and all associated logos, marks, names, races, race
          insignia, characters, vehicles, locations, units, illustrations and
          images from the Warhammer world are either ®, TM and/or © Copyright
          Games Workshop Ltd 2000-2024, variably registered in the UK and other
          countries around the world. Used without permission. No challenge to
          their status intended. All Rights Reserved to their respective owners.
        </p>
        <p className="about__version">
          v{version}
          {" · "}
          {storage.listCount} list{storage.listCount === 1 ? "" : "s"}
          {" · "}
          {storage.kb} KB
          {storage.dirtyCount > 0 && ` · ${storage.dirtyCount} dirty`}
          {" · "}
          {storage.legacy > 0
            ? `${storage.legacy} legacy rank${storage.legacy === 1 ? "" : "s"}`
            : storage.unranked > 0
            ? `${storage.unranked} unranked`
            : "order-keys"}
          {` · ${storage.backend}`}
        </p>
      </Main>
    </>
  );
};
