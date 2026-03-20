import { useEffect, useState, Fragment } from "react";
import { useParams, useLocation, Redirect } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import { FormattedMessage, useIntl } from "react-intl";
import classNames from "classnames";
import { Helmet } from "react-helmet-async";

import { getMaxPercentData, getMinPercentData } from "../../utils/rules";
import { getAnyPackById } from "../../utils/comp-packs";
import {
  getCompPackMaxPercentData,
  getCompPackMinPercentData,
  getEffectivePoints,
  loadArmyRules,
} from "../../utils/comp-pack-validation";
import { Button } from "../../components/button";
import { Icon } from "../../components/icon";
import { OrderableList } from "../../components/list";
import { Header, Main } from "../../components/page";
import { Dialog } from "../../components/dialog";
import { ListItem } from "../../components/list/ListItem";
import { ErrorMessage } from "../../components/error-message";
import { getAllOptions, getUnitName } from "../../utils/unit";
import { throttle } from "../../utils/throttle";
import { getUnitPoints, getPoints, getAllPoints } from "../../utils/points";
import { useLanguage } from "../../utils/useLanguage";
import { validateList } from "../../utils/validation";
import { removeFromLocalList } from "../../utils/list";
import { getGameSystems } from "../../utils/game-systems";
import { deleteList, moveUnit } from "../../state/lists";
import { setErrors } from "../../state/errors";

import "./Editor.css";

export const Editor = ({ isMobile }) => {
  const MainComponent = isMobile ? Main : Fragment;
  const { listId } = useParams();
  const intl = useIntl();
  const dispatch = useDispatch();
  const { language } = useLanguage();
  const [redirect, setRedirect] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const location = useLocation();
  const errors = useSelector((state) => state.errors);
  const list = useSelector((state) =>
    state.lists.find(({ id }) => listId === id),
  );
  const gameSystems = getGameSystems();
  const game = gameSystems.find((game) => game.id === list?.game);

  const handleCancel = (event) => {
    event.preventDefault();
    setIsDialogOpen(false);
  };

  const handleDeleteConfirm = () => {
    setIsDialogOpen(false);
    dispatch(deleteList(listId));
    removeFromLocalList(listId);
    setRedirect(true);
  };

  useEffect(() => {
    const onScroll = () => {
      if (document.location.hash === `#${location.pathname}`) {
        sessionStorage.setItem("scrollPosition", window.pageYOffset);
      }
    };
    window.addEventListener("scroll", throttle(onScroll, 100));
    window.scrollTo(0, Number(sessionStorage.getItem("scrollPosition")) || 0);

    return () => window.removeEventListener("scroll", onScroll);
  }, [location.pathname]);

  const [armyRulesReady, setArmyRulesReady] = useState(false);

  // Load army rules for mount special rule detection (e.g. Fly on Bone Dragon)
  useEffect(() => {
    const hasRuleLimits = (list?.compositionRules || []).some((id) => {
      const pack = getAnyPackById(id);
      return pack?.ruleLimits?.length > 0;
    });
    if (hasRuleLimits && list?.game && list?.army) {
      loadArmyRules(list.game, list.army).then(() => setArmyRulesReady(true));
    }
  }, [list?.compositionRules, list?.game, list?.army]);

  useEffect(() => {
    if (list) {
      dispatch(
        setErrors(
          validateList({
            list,
            language,
            intl,
          }),
        ),
      );
    }
  }, [list, dispatch, language, intl, armyRulesReady]);

  if (redirect) {
    return <Redirect to="/" />;
  }

  if (!list) {
    if (isMobile) {
      return (
        <>
          <Header to="/" />
          <Main loading />
        </>
      );
    } else {
      return (
        <>
          <Header to="/" isSection />
          <Main loading />
        </>
      );
    }
  }

  const armyComposition = list.armyComposition || list.army;
  const activePacks = (list.compositionRules || [])
    .map((id) => getAnyPackById(id))
    .filter(Boolean);
  const effectiveArmyPoints = getEffectivePoints(list);
  const allPoints = getAllPoints(list);
  const lordsPoints = getPoints({ list, type: "lords" });
  const heroesPoints = getPoints({ list, type: "heroes" });
  const charactersPoints = getPoints({ list, type: "characters" });
  const corePoints = getPoints({ list, type: "core" });
  const specialPoints = getPoints({ list, type: "special" });
  const rarePoints = getPoints({ list, type: "rare" });
  const mercenariesPoints = getPoints({ list, type: "mercenaries" });
  const alliesPoints = getPoints({ list, type: "allies" });

  // Helper: use strictest limit across base rules and all active packs (for max percent)
  const getEffectiveMaxData = (type, points) => {
    let result = getMaxPercentData({
      type,
      armyPoints: effectiveArmyPoints,
      points,
      armyComposition,
    });
    for (const pack of activePacks) {
      const compData = getCompPackMaxPercentData({
        type,
        armyPoints: effectiveArmyPoints,
        points,
        compPack: pack,
        armyId: list.army,
      });
      if (!compData) continue;
      if (!result || compData.points < result.points) {
        result = compData;
      }
    }
    return result;
  };

  // Helper: use strictest limit across base rules and all active packs (for min percent)
  const getEffectiveMinData = (type, points) => {
    let result = getMinPercentData({
      type,
      armyPoints: effectiveArmyPoints,
      points,
      armyComposition,
    });
    for (const pack of activePacks) {
      const compData = getCompPackMinPercentData({
        type,
        armyPoints: effectiveArmyPoints,
        points,
        compPack: pack,
        armyId: list.army,
      });
      if (!compData) continue;
      if (!result || compData.points > result.points) {
        result = compData;
      }
    }
    return result;
    // Use whichever limit is stricter (higher min points)
    return compData.points > baseData.points ? compData : baseData;
  };

  const lordsData = list.lords && getEffectiveMaxData("lords", lordsPoints);
  const heroesData = list.lords && getEffectiveMaxData("heroes", heroesPoints);
  const charactersData =
    list.characters && getEffectiveMaxData("characters", charactersPoints);
  const coreData = getEffectiveMinData("core", corePoints);
  const specialData = getEffectiveMaxData("special", specialPoints);
  const rareData = getEffectiveMaxData("rare", rarePoints);
  const mercenariesData =
    list.mercenaries && getEffectiveMaxData("mercenaries", mercenariesPoints);
  const alliesData =
    list.allies && getEffectiveMaxData("allies", alliesPoints);
  const moreButtons = [
    {
      name: intl.formatMessage({
        id: "misc.edit",
      }),
      icon: "edit",
      to: `/editor/${listId}/edit`,
    },
    {
      name: intl.formatMessage({
        id: "misc.duplicate",
      }),
      icon: "duplicate",
      to: `/editor/${listId}/duplicate`,
    },
    {
      name: intl.formatMessage({
        id: "misc.delete",
      }),
      icon: "delete",
      callback: () => setIsDialogOpen(true),
    },
    {
      name: intl.formatMessage({
        id: "misc.export",
      }),
      icon: "export",
      to: `/editor/${listId}/export`,
    },
    {
      name: intl.formatMessage({
        id: "misc.print",
      }),
      icon: "print",
      to: `/print/${listId}`,
    },
    {
      name: intl.formatMessage({
        id: "misc.gameView",
      }),
      icon: "shield",
      to: `/game-view/${listId}`,
    },
  ];

  return (
    <>
      <Helmet>
        <title>{`Old World Builder | ${list?.name}`}</title>
      </Helmet>

      <Dialog open={isDialogOpen} onClose={() => setIsDialogOpen(false)}>
        <p>
          <FormattedMessage
            id="editor.confirmDelete"
            values={{
              list: <b>{list.name}</b>,
            }}
          />
        </p>
        <div className="editor__delete-dialog">
          <Button
            type="text"
            onClick={handleCancel}
            icon="close"
            spaceTop
            color="dark"
          >
            <FormattedMessage id="misc.cancel" />
          </Button>
          <Button
            type="primary"
            submitButton
            onClick={handleDeleteConfirm}
            icon="delete"
            spaceTop
          >
            <FormattedMessage id="misc.delete" />
          </Button>
        </div>
      </Dialog>

      {isMobile && (
        <Header
          to="/"
          headline={list.name}
          subheadline={
            <>
              <span
                className={classNames(
                  "magic__header-points",
                  allPoints > effectiveArmyPoints &&
                    "magic__header-points--error",
                )}
              >
                {allPoints}&nbsp;
              </span>
              {`/ ${effectiveArmyPoints} ${intl.formatMessage({
                id: "app.points",
              })}`}
              {activePacks.length > 0 &&
                effectiveArmyPoints !== list.points &&
                ` (${list.points}${effectiveArmyPoints > list.points ? "+" : ""}${effectiveArmyPoints - list.points})`}
            </>
          }
          hasPointsError={allPoints > effectiveArmyPoints}
          moreButton={moreButtons}
          navigationIcon="more"
        />
      )}

      <MainComponent>
        {!isMobile && (
          <Header
            isSection
            to="/"
            headline={list.name}
            subheadline={
              <>
                <span
                  className={classNames(
                    "magic__header-points",
                    allPoints > effectiveArmyPoints &&
                      "magic__header-points--error",
                  )}
                >
                  {allPoints}&nbsp;
                </span>
                {`/ ${effectiveArmyPoints} ${intl.formatMessage({
                  id: "app.points",
                })}`}
                {compPack &&
                  effectiveArmyPoints !== list.points &&
                  ` (${list.points}${effectiveArmyPoints > list.points ? "+" : ""}${effectiveArmyPoints - list.points})`}
              </>
            }
            hasPointsError={allPoints > effectiveArmyPoints}
            moreButton={moreButtons}
            navigationIcon="more"
          />
        )}
        <section>
          {activePacks.length > 0 && (
            <p className="unit__notes" style={{ marginBottom: "0.5rem" }}>
              <Icon symbol="shield" className="unit__notes-icon" />
              <FormattedMessage
                id="editor.compPackActive"
                values={{
                  name: activePacks.map((p) => p.name).join(", "),
                }}
              />
            </p>
          )}
          {errors
            .filter(({ section }) => section === "global")
            .map(({ message }) => (
              <ErrorMessage key={message} spaceAfter spaceBefore={isMobile}>
                <FormattedMessage id={message} />
              </ErrorMessage>
            ))}
        </section>
        {list.lords && (
          <section className="editor__section">
            <header className="editor__header">
              <h2>
                <FormattedMessage id="editor.lords" />
              </h2>
              <p className="editor__points">
                {lordsData.diff > 0 ? (
                  <>
                    <strong>{lordsData.diff}</strong>
                    <FormattedMessage id="editor.tooManyPoints" />
                    <Icon symbol="error" color="red" />
                  </>
                ) : (
                  <>
                    <strong>{lordsData.points - lordsPoints}</strong>
                    <FormattedMessage id="editor.availablePoints" />
                    <Icon symbol="check" />
                  </>
                )}
              </p>
            </header>

            <OrderableUnitList
              units={list.lords}
              type="lords"
              listId={listId}
              armyComposition={armyComposition}
            />

            <Button
              type="primary"
              centered
              to={`/editor/${listId}/add/lords`}
              icon="add"
              spaceTop
            >
              <FormattedMessage id="editor.add" />
            </Button>
          </section>
        )}

        {list.heroes && (
          <section className="editor__section">
            <header className="editor__header">
              <h2>
                <FormattedMessage id="editor.heroes" />
              </h2>
              <p className="editor__points">
                {heroesData.diff > 0 ? (
                  <>
                    <strong>{heroesData.diff}</strong>
                    <FormattedMessage id="editor.tooManyPoints" />
                    <Icon symbol="error" color="red" />
                  </>
                ) : (
                  <>
                    <strong>{heroesData.points - heroesPoints}</strong>
                    <FormattedMessage id="editor.availablePoints" />
                    <Icon symbol="check" />
                  </>
                )}
              </p>
            </header>

            <OrderableUnitList
              units={list.heroes}
              type="heroes"
              listId={listId}
              armyComposition={armyComposition}
            />

            <Button
              type="primary"
              centered
              to={`/editor/${listId}/add/heroes`}
              icon="add"
              spaceTop
            >
              <FormattedMessage id="editor.add" />
            </Button>
          </section>
        )}

        {list.characters && (
          <section className="editor__section">
            <header className="editor__header">
              <h2>
                <FormattedMessage id="editor.characters" />
              </h2>
              <p className="editor__points">
                {charactersData.diff > 0 ? (
                  <>
                    <strong>{charactersData.diff}</strong>
                    <FormattedMessage id="editor.tooManyPoints" />
                    <Icon symbol="error" color="red" />
                  </>
                ) : (
                  <>
                    <strong>{charactersData.points - charactersPoints}</strong>
                    <FormattedMessage id="editor.availablePoints" />
                    <Icon symbol="check" />
                  </>
                )}
              </p>
            </header>

            <OrderableUnitList
              units={list.characters}
              type="characters"
              listId={listId}
              armyComposition={armyComposition}
            />

            {errors
              .filter(({ section }) => section === "characters")
              .map(({ message, name, diff, min, max, option, command, percent, rule, unitName, level }, index) => (
                <ErrorMessage key={message + index} spaceBefore>
                  <FormattedMessage
                    id={message}
                    values={{
                      name,
                      diff,
                      min,
                      max,
                      option,
                      command,
                      percent,
                      rule,
                      unitName,
                      level,
                    }}
                  />
                </ErrorMessage>
              ))}

            <Button
              type="primary"
              centered
              to={`/editor/${listId}/add/characters`}
              icon="add"
              spaceTop
            >
              <FormattedMessage id="editor.add" />
            </Button>
          </section>
        )}

        <section className="editor__section">
          <header className="editor__header">
            <h2>
              <FormattedMessage id="editor.core" />
            </h2>
            <p className="editor__points">
              {coreData.diff > 0 ? (
                <>
                  <strong>{coreData.diff}</strong>
                  <FormattedMessage id="editor.missingPoints" />
                  <Icon symbol="error" color="red" />
                </>
              ) : (
                <>
                  <strong>{corePoints}</strong>
                  {` / ${coreData.points} `}
                  <FormattedMessage id="app.points" />
                  <Icon symbol="check" />
                </>
              )}
            </p>
          </header>

          <OrderableUnitList
            units={list.core}
            type="core"
            listId={listId}
            armyComposition={armyComposition}
          />

          {errors
            .filter(({ section }) => section === "core")
            .map(({ message, name, min, max, diff, option, command, percent, rule, unitName, level }, index) => (
              <ErrorMessage key={message + index} spaceBefore>
                <FormattedMessage
                  id={message}
                  values={{
                    name,
                    min,
                    max,
                    diff,
                    option,
                    command,
                    percent,
                    rule,
                    unitName,
                    level,
                  }}
                />
              </ErrorMessage>
            ))}

          <Button
            type="primary"
            centered
            to={`/editor/${listId}/add/core`}
            icon="add"
            spaceTop
          >
            <FormattedMessage id="editor.add" />
          </Button>
        </section>

        <section className="editor__section">
          <header className="editor__header">
            <h2>
              <FormattedMessage id="editor.special" />
            </h2>
            <p className="editor__points">
              {specialData.diff > 0 ? (
                <>
                  <strong>{specialData.diff}</strong>
                  <FormattedMessage id="editor.tooManyPoints" />
                  <Icon symbol="error" color="red" />
                </>
              ) : (
                <>
                  <strong>{specialData.points - specialPoints}</strong>
                  <FormattedMessage id="editor.availablePoints" />
                  <Icon symbol="check" />
                </>
              )}
            </p>
          </header>

          <OrderableUnitList
            units={list.special}
            type="special"
            listId={listId}
            armyComposition={armyComposition}
          />

          {errors
            .filter(({ section }) => section === "special")
            .map(({ message, name, diff, min, max, option, command, percent, rule, unitName, level }, index) => (
              <ErrorMessage key={message + index} spaceBefore>
                <FormattedMessage
                  id={message}
                  values={{
                    name,
                    diff,
                    min,
                    max,
                    option,
                    command,
                    percent,
                    rule,
                    unitName,
                    level,
                  }}
                />
              </ErrorMessage>
            ))}

          <Button
            type="primary"
            centered
            to={`/editor/${listId}/add/special`}
            icon="add"
            spaceTop
          >
            <FormattedMessage id="editor.add" />
          </Button>
        </section>

        <section className="editor__section">
          <header className="editor__header">
            <h2>
              <FormattedMessage id="editor.rare" />
            </h2>
            <p className="editor__points">
              {rareData.diff > 0 ? (
                <>
                  <strong>{rareData.diff}</strong>
                  <FormattedMessage id="editor.tooManyPoints" />
                  <Icon symbol="error" color="red" />
                </>
              ) : (
                <>
                  <strong>{rareData.points - rarePoints}</strong>
                  <FormattedMessage id="editor.availablePoints" />
                  <Icon symbol="check" />
                </>
              )}
            </p>
          </header>

          <OrderableUnitList
            units={list.rare}
            type="rare"
            listId={listId}
            armyComposition={armyComposition}
          />

          {errors
            .filter(({ section }) => section === "rare")
            .map(({ message, name, diff, min, max, option, command, percent, rule, unitName, level }, index) => (
              <ErrorMessage key={message + index} spaceBefore>
                <FormattedMessage
                  id={message}
                  values={{
                    name,
                    diff,
                    min,
                    max,
                    option,
                    command,
                    percent,
                    rule,
                    unitName,
                    level,
                  }}
                />
              </ErrorMessage>
            ))}

          <Button
            type="primary"
            centered
            to={`/editor/${listId}/add/rare`}
            icon="add"
            spaceTop
          >
            <FormattedMessage id="editor.add" />
          </Button>
        </section>

        {list.mercenaries &&
          mercenariesData &&
          armyComposition &&
          list?.army !== "daemons-of-chaos" &&
          list?.army !== "vampire-counts" && (
            <section className="editor__section">
              <header className="editor__header">
                <h2>
                  <FormattedMessage id="editor.mercenaries" />
                </h2>
                <p className="editor__points">
                  {mercenariesData.diff > 0 ? (
                    <>
                      <strong>{mercenariesData.diff}</strong>
                      <FormattedMessage id="editor.tooManyPoints" />
                      <Icon symbol="error" color="red" />
                    </>
                  ) : (
                    <>
                      <strong>
                        {mercenariesData.points - mercenariesPoints}
                      </strong>
                      <FormattedMessage id="editor.availablePoints" />
                      <Icon symbol="check" />
                    </>
                  )}
                </p>
              </header>

              <OrderableUnitList
                units={list.mercenaries}
                type="mercenaries"
                listId={listId}
                armyComposition={armyComposition}
              />

              {errors
                .filter(({ section }) => section === "mercenaries")
                .map(({ message, name, diff, min, max, option, command, percent, rule, unitName, level }, index) => (
                  <ErrorMessage key={message + index} spaceBefore>
                    <FormattedMessage
                      id={message}
                      values={{
                        name,
                        diff,
                        min,
                        max,
                        option,
                        command,
                        percent,
                        rule,
                        unitName,
                        level,
                      }}
                    />
                  </ErrorMessage>
                ))}

              <Button
                type="primary"
                centered
                to={`/editor/${listId}/add/mercenaries`}
                icon="add"
                spaceTop
              >
                <FormattedMessage id="editor.add" />
              </Button>
            </section>
          )}

        {list.allies && alliesData && list?.army !== "daemons-of-chaos" && (
          <section className="editor__section">
            <header className="editor__header">
              <h2>
                <FormattedMessage id="editor.allies" />
              </h2>
              <p className="editor__points">
                {alliesData.diff > 0 ? (
                  <>
                    <strong>{alliesData.diff}</strong>
                    <FormattedMessage id="editor.tooManyPoints" />
                    <Icon symbol="error" color="red" />
                  </>
                ) : (
                  <>
                    <strong>{alliesData.points - alliesPoints}</strong>
                    <FormattedMessage id="editor.availablePoints" />
                    <Icon symbol="check" />
                  </>
                )}
              </p>
            </header>

            <OrderableUnitList
              units={list.allies}
              type="allies"
              listId={listId}
              armyComposition={armyComposition}
            />

            {errors
              .filter(({ section }) => section === "allies")
              .map(({ message, name, diff, min, max, option, command, percent, rule, unitName, level }, index) => (
                <ErrorMessage key={message + index} spaceBefore>
                  <FormattedMessage
                    id={message}
                    values={{
                      name,
                      diff,
                      min,
                      max,
                      option,
                      command,
                      percent,
                      rule,
                      unitName,
                      level,
                    }}
                  />
                </ErrorMessage>
              ))}

            <Button
              type="primary"
              centered
              to={`/editor/${listId}/add/allies`}
              icon="add"
              spaceTop
            >
              <FormattedMessage id="editor.add" />
            </Button>
          </section>
        )}

        <Button
          type="secondary"
          centered
          to={`/game-view/${listId}`}
          icon="shield"
          spaceTop
        >
          <FormattedMessage id="misc.gameView" />
        </Button>
      </MainComponent>
    </>
  );
};

/**
 * @param {object} props
 * @param {object[]} props.units
 * @param {string} props.type
 * @param {string} props.listId
 */
export const OrderableUnitList = ({ units, type, listId, armyComposition }) => {
  const dispatch = useDispatch();
  const location = useLocation();
  const intl = useIntl();
  const { language } = useLanguage();

  const handleMoved = (indexes) =>
    dispatch(
      moveUnit({
        listId,
        type,
        ...indexes,
      }),
    );

  return (
    <OrderableList id={type} onMoved={handleMoved}>
      {units?.length > 0 &&
        units.map((unit, index) => (
          <ListItem
            key={index}
            to={`/editor/${listId}/${type}/${unit.id}`}
            className="editor__list"
            active={location.pathname.includes(unit.id)}
          >
            <div className="editor__list-inner">
              {unit.strength || unit.minimum ? (
                <span>{`${unit.strength || unit.minimum}`}</span>
              ) : null}
              <b>{getUnitName({ unit, language })}</b>
              <i>{`${getUnitPoints(
                { ...unit, type },
                {
                  armyComposition,
                },
              )} ${intl.formatMessage({
                id: "app.points",
              })}`}</i>
            </div>
            <p>{getAllOptions(unit, { armyComposition })}</p>
          </ListItem>
        ))}
    </OrderableList>
  );
};
