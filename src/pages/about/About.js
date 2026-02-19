import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { FormattedMessage, useIntl } from "react-intl";
import { Helmet } from "react-helmet-async";

import { Header, Main } from "../../components/page";

import "./About.css";

export const About = () => {
  const location = useLocation();
  const intl = useIntl();

  useEffect(() => {
    window.scrollTo(0, 0);
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
      </Main>
    </>
  );
};
