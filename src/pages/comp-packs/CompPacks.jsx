import { useState, createRef, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { FormattedMessage, useIntl } from "react-intl";
import { Helmet } from "react-helmet-async";

import { Header, Main } from "../../components/page";
import { Button } from "../../components/button";
import { Expandable } from "../../components/expandable";
import {
  getCompPacks,
  saveCompPack,
  deleteCompPack,
} from "../../utils/comp-packs";
import { getAllBuiltInPacks } from "../../utils/built-in-comp-packs";
import { rulesMap } from "../../components/rules-index/rules-map";
import { useLanguage } from "../../utils/useLanguage";
import theOldWorld from "../../assets/the-old-world.json";
import { nameMap } from "../magic";

import "./CompPacks.css";

// Build sorted list of special rules from the rules index
const specialRuleNames = Object.entries(rulesMap)
  .filter(([, v]) => v.url && v.url.startsWith("special-rules/"))
  .map(([name]) => name.charAt(0).toUpperCase() + name.slice(1))
  .sort();

// Army list with locale-aware names
const ARMIES = theOldWorld.armies.map((a) => a.id);

const CATEGORIES = [
  "characters",
  "core",
  "special",
  "rare",
  "mercenaries",
  "allies",
];

const emptyPack = () => ({
  name: "",
  categories: {},
  ruleLimits: [],
  optionLimits: [],
  unitLimits: [],
  perUnitMaxPercent: {},
  armyOverrides: {},
});

export const CompPacks = () => {
  const location = useLocation();
  const intl = useIntl();
  const { language } = useLanguage();
  const [packs, setPacks] = useState(getCompPacks());
  const [editing, setEditing] = useState(null);
  const [importError, setImportError] = useState(false);
  const [allUnits, setAllUnits] = useState([]); // { id, name, army }
  const fileInput = createRef();

  const getArmyName = (armyId) =>
    nameMap[armyId]?.[`name_${language}`] ||
    nameMap[armyId]?.name_en ||
    armyId;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // Load all unit IDs from army JSONs
  useEffect(() => {
    const loadUnits = async () => {
      const units = [];
      for (const army of theOldWorld.armies) {
        try {
          const resp = await fetch(
            `/games/the-old-world/${army.id}.json?v=${Date.now()}`,
          );
          const data = await resp.json();
          for (const cat of [
            "characters",
            "core",
            "special",
            "rare",
            "mercenaries",
            "allies",
          ]) {
            if (data[cat]) {
              for (const unit of data[cat]) {
                if (
                  unit.id &&
                  !units.find((u) => u.id === unit.id)
                ) {
                  units.push({
                    id: unit.id,
                    name: unit[`name_${language}`] || unit.name_en,
                    army: army.id,
                  });
                }
              }
            }
          }
        } catch {
          // skip armies that fail to load
        }
      }
      units.sort((a, b) => a.name.localeCompare(b.name));
      setAllUnits(units);
    };
    loadUnits();
  }, [language]);

  // --- CRUD ---
  const handleCreate = () => {
    setEditing(emptyPack());
  };

  const handleEdit = (pack) => {
    setEditing({ ...pack });
  };

  const handleDelete = (id) => {
    deleteCompPack(id);
    setPacks(getCompPacks());
  };

  const handleSave = () => {
    if (!editing.name.trim()) return;
    saveCompPack(editing);
    setPacks(getCompPacks());
    setEditing(null);
  };

  const handleCancel = () => {
    setEditing(null);
  };

  // --- Export ---
  const handleExport = (pack) => {
    const blob = new Blob([JSON.stringify(pack, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `comp-pack-${pack.id || "new"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- Import ---
  const handleImportChange = () => {
    const files = fileInput.current.files;
    if (files.length === 0) return;

    const reader = new FileReader();
    setImportError(false);

    reader.readAsText(files[0], "UTF-8");
    reader.onload = (event) => {
      try {
        const pack = JSON.parse(event.target.result);
        if (!pack.name) {
          setImportError(true);
          return;
        }
        saveCompPack(pack);
        setPacks(getCompPacks());
      } catch {
        setImportError(true);
      }
    };
    reader.onerror = () => setImportError(true);
  };

  // --- Form field helpers ---
  const updateField = (field, value) => {
    setEditing((prev) => ({ ...prev, [field]: value }));
  };

  // Category overrides
  const setCategoryPercent = (category, field, value) => {
    setEditing((prev) => ({
      ...prev,
      categories: {
        ...prev.categories,
        [category]: {
          ...(prev.categories[category] || {}),
          [field]: value === "" ? undefined : Number(value),
        },
      },
    }));
  };

  const removeCategory = (category) => {
    setEditing((prev) => {
      const cats = { ...prev.categories };
      delete cats[category];
      return { ...prev, categories: cats };
    });
  };

  // Rule limits
  const addRuleLimit = () => {
    setEditing((prev) => ({
      ...prev,
      ruleLimits: [...prev.ruleLimits, { rule: "", maxPercent: 33 }],
    }));
  };

  const updateRuleLimit = (index, field, value) => {
    setEditing((prev) => ({
      ...prev,
      ruleLimits: prev.ruleLimits.map((rl, i) =>
        i === index
          ? {
              ...rl,
              [field]:
                field === "rule" ? value : value === "" ? undefined : Number(value),
            }
          : rl,
      ),
    }));
  };

  const removeRuleLimit = (index) => {
    setEditing((prev) => ({
      ...prev,
      ruleLimits: prev.ruleLimits.filter((_, i) => i !== index),
    }));
  };

  // Unit limits
  const addUnitLimit = () => {
    setEditing((prev) => ({
      ...prev,
      unitLimits: [...prev.unitLimits, { ids: [""], max: 1 }],
    }));
  };

  const updateUnitLimit = (index, field, value) => {
    setEditing((prev) => ({
      ...prev,
      unitLimits: prev.unitLimits.map((ul, i) =>
        i === index
          ? {
              ...ul,
              [field]:
                field === "ids"
                  ? value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean)
                  : value === ""
                    ? undefined
                    : Number(value),
            }
          : ul,
      ),
    }));
  };

  const removeUnitLimit = (index) => {
    setEditing((prev) => ({
      ...prev,
      unitLimits: prev.unitLimits.filter((_, i) => i !== index),
    }));
  };

  // Option limits
  const addOptionLimit = () => {
    setEditing((prev) => ({
      ...prev,
      optionLimits: [
        ...(prev.optionLimits || []),
        { option: "", disabled: true, armies: [] },
      ],
    }));
  };

  const updateOptionLimit = (index, field, value) => {
    setEditing((prev) => ({
      ...prev,
      optionLimits: (prev.optionLimits || []).map((ol, i) =>
        i === index ? { ...ol, [field]: value } : ol,
      ),
    }));
  };

  const removeOptionLimit = (index) => {
    setEditing((prev) => ({
      ...prev,
      optionLimits: (prev.optionLimits || []).filter((_, i) => i !== index),
    }));
  };

  // Per-unit max percent
  const setPerUnitMaxPercent = (category, value) => {
    setEditing((prev) => {
      const pup = { ...prev.perUnitMaxPercent };
      if (value === "") {
        delete pup[category];
      } else {
        pup[category] = Number(value);
      }
      return { ...prev, perUnitMaxPercent: pup };
    });
  };

  // Army overrides
  const addArmyOverride = (armyId) => {
    if (!armyId || editing.armyOverrides[armyId]) return;
    setEditing((prev) => ({
      ...prev,
      armyOverrides: {
        ...prev.armyOverrides,
        [armyId]: { pointsAdjustment: 0 },
      },
    }));
  };

  const updateArmyOverride = (armyId, field, value) => {
    setEditing((prev) => ({
      ...prev,
      armyOverrides: {
        ...prev.armyOverrides,
        [armyId]: {
          ...prev.armyOverrides[armyId],
          [field]: value === "" ? undefined : Number(value),
        },
      },
    }));
  };

  const removeArmyOverride = (armyId) => {
    setEditing((prev) => {
      const overrides = { ...prev.armyOverrides };
      delete overrides[armyId];
      return { ...prev, armyOverrides: overrides };
    });
  };

  return (
    <>
      <Helmet>
        <title>{`Old World Builder | ${intl.formatMessage({ id: "compPacks.title" })}`}</title>
      </Helmet>

      <Header headline="Old World Builder" hasMainNavigation hasHomeButton />

      <Main compact className="comp-packs">
        <h2 className="page-headline">
          <FormattedMessage id="compPacks.title" />
        </h2>

        {/* Pack list */}
        <section>
          <ul>
            {getAllBuiltInPacks().map((pack) => (
              <li className="list" key={pack.id}>
                <div className="list__inner">
                  <span>
                    <span className="comp-packs__pack-name">
                      {intl.formatMessage({
                        id: `misc.${pack.id}`,
                        defaultMessage: pack.name,
                      })}
                    </span>
                    <br />
                    <span className="comp-packs__id">
                      {pack.id}{" "}
                      <i>
                        (<FormattedMessage id="compPacks.builtIn" />)
                      </i>
                    </span>
                  </span>
                  <span className="comp-packs__actions">
                    <Button
                      type="text"
                      icon="download"
                      color="dark"
                      label={intl.formatMessage({ id: "compPacks.export" })}
                      onClick={() => handleExport(pack)}
                    />
                  </span>
                </div>
              </li>
            ))}
            {packs.map((pack) => (
              <li className="list" key={pack.id}>
                <div className="list__inner">
                  <span>
                    <span className="comp-packs__pack-name">{pack.name}</span>
                    <br />
                    <span className="comp-packs__id">{pack.id}</span>
                  </span>
                  <span className="comp-packs__actions">
                    <Button
                      type="text"
                      icon="download"
                      color="dark"
                      label={intl.formatMessage({ id: "compPacks.export" })}
                      onClick={() => handleExport(pack)}
                    />
                    <Button
                      type="text"
                      icon="edit"
                      color="dark"
                      label={intl.formatMessage({ id: "misc.edit" })}
                      onClick={() => handleEdit(pack)}
                    />
                    <Button
                      type="text"
                      icon="delete"
                      color="dark"
                      label={intl.formatMessage({ id: "misc.delete" })}
                      onClick={() => handleDelete(pack.id)}
                    />
                  </span>
                </div>
              </li>
            ))}
            {packs.length === 0 && (
              <p>
                <i>
                  <FormattedMessage id="compPacks.empty" />
                </i>
              </p>
            )}
          </ul>
        </section>

        {/* Actions */}
        {!editing && (
          <section>
            <Button
              centered
              icon="add-list"
              onClick={handleCreate}
              spaceTop
              size="large"
            >
              <FormattedMessage id="compPacks.create" />
            </Button>

            <br />

            <label htmlFor="import-comp-pack">
              <FormattedMessage id="compPacks.import" />
            </label>
            <input
              type="file"
              accept=".json, application/json"
              id="import-comp-pack"
              className="input"
              onChange={handleImportChange}
              ref={fileInput}
            />
            {importError && (
              <p className="comp-packs__error">
                <FormattedMessage id="compPacks.importError" />
              </p>
            )}
          </section>
        )}

        {/* Edit/Create form */}
        {editing && (
          <section className="comp-packs__form">
            <h3>
              {editing.id ? (
                <FormattedMessage id="compPacks.editing" />
              ) : (
                <FormattedMessage id="compPacks.creating" />
              )}
            </h3>

            <label htmlFor="pack-name">
              <FormattedMessage id="misc.name" />
            </label>
            <input
              type="text"
              id="pack-name"
              className="input"
              value={editing.name}
              onChange={(e) => updateField("name", e.target.value)}
              autoComplete="off"
              required
              maxLength="100"
            />

            {/* Category percentage overrides */}
            <div className="comp-packs__section">
              <div className="comp-packs__section-header">
                <h3>
                  <FormattedMessage id="compPacks.categoryOverrides" />
                </h3>
              </div>
              {CATEGORIES.map((cat) => {
                const catData = editing.categories[cat];
                if (!catData) return null;
                return (
                  <div className="comp-packs__category-row" key={cat}>
                    <div className="comp-packs__category-header">
                      <strong>
                        <FormattedMessage id={`editor.${cat}`} />
                      </strong>
                      <Button
                        type="text"
                        icon="delete"
                        color="dark"
                        onClick={() => removeCategory(cat)}
                      />
                    </div>
                    <div className="comp-packs__category-fields">
                      <div className="comp-packs__field">
                        <label>
                          <FormattedMessage id="compPacks.minPercent" />
                        </label>
                        <input
                          type="number"
                          className="input"
                          value={catData.minPercent ?? ""}
                          onChange={(e) =>
                            setCategoryPercent(cat, "minPercent", e.target.value)
                          }
                          min={0}
                          max={100}
                        />
                      </div>
                      <div className="comp-packs__field">
                        <label>
                          <FormattedMessage id="compPacks.maxPercent" />
                        </label>
                        <input
                          type="number"
                          className="input"
                          value={catData.maxPercent ?? ""}
                          onChange={(e) =>
                            setCategoryPercent(cat, "maxPercent", e.target.value)
                          }
                          min={0}
                          max={100}
                        />
                      </div>
                      <div className="comp-packs__field">
                        <label>
                          <FormattedMessage id="compPacks.maxDuplicates" />
                        </label>
                        <input
                          type="number"
                          className="input"
                          value={catData.maxDuplicates ?? ""}
                          onChange={(e) =>
                            setCategoryPercent(
                              cat,
                              "maxDuplicates",
                              e.target.value,
                            )
                          }
                          min={0}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
              <select
                className="select"
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    setCategoryPercent(e.target.value, "maxPercent", "");
                  }
                }}
              >
                <option value="">
                  {intl.formatMessage({ id: "compPacks.addCategory" })}
                </option>
                {CATEGORIES.filter((c) => !editing.categories[c]).map((c) => (
                  <option key={c} value={c}>
                    {intl.formatMessage({ id: `editor.${c}` })}
                  </option>
                ))}
              </select>
            </div>

            {/* Rule limits */}
            <div className="comp-packs__section">
              <div className="comp-packs__section-header">
                <h3>
                  <FormattedMessage id="compPacks.ruleLimits" />
                </h3>
              </div>
              {editing.ruleLimits.map((rl, i) => (
                <div className="comp-packs__row" key={i}>
                  <select
                    className="select"
                    value={rl.rule}
                    onChange={(e) => updateRuleLimit(i, "rule", e.target.value)}
                  >
                    <option value="">
                      {intl.formatMessage({ id: "compPacks.ruleName" })}
                    </option>
                    {specialRuleNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    className="input"
                    placeholder="max %"
                    value={rl.maxPercent ?? ""}
                    onChange={(e) =>
                      updateRuleLimit(i, "maxPercent", e.target.value)
                    }
                    min={0}
                    max={100}
                  />
                  <input
                    type="number"
                    className="input"
                    placeholder="max #"
                    value={rl.maxCount ?? ""}
                    onChange={(e) =>
                      updateRuleLimit(i, "maxCount", e.target.value)
                    }
                    min={0}
                  />
                  <Button
                    type="text"
                    icon="delete"
                    color="dark"
                    onClick={() => removeRuleLimit(i)}
                  />
                </div>
              ))}
              <Button type="tertiary" color="dark" onClick={addRuleLimit}>
                <FormattedMessage id="compPacks.addRuleLimit" />
              </Button>
            </div>

            {/* Unit limits */}
            <div className="comp-packs__section">
              <div className="comp-packs__section-header">
                <h3>
                  <FormattedMessage id="compPacks.unitLimits" />
                </h3>
              </div>
              {editing.unitLimits.map((ul, i) => (
                <div key={i}>
                  <div className="comp-packs__row">
                    <select
                      className="select"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          const newIds = [
                            ...(ul.ids || []),
                            e.target.value,
                          ].filter(
                            (v, idx, arr) => arr.indexOf(v) === idx,
                          );
                          updateUnitLimit(i, "ids", newIds.join(", "));
                        }
                      }}
                    >
                      <option value="">
                        {intl.formatMessage({ id: "compPacks.addUnit" })}
                      </option>
                      {allUnits
                        .filter((u) => !(ul.ids || []).includes(u.id))
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({getArmyName(u.army)})
                          </option>
                        ))}
                    </select>
                    <input
                      type="number"
                      className="input"
                      placeholder="max #"
                      value={ul.max ?? ""}
                      onChange={(e) =>
                        updateUnitLimit(i, "max", e.target.value)
                      }
                      min={0}
                    />
                    <input
                      type="number"
                      className="input"
                      placeholder="max %"
                      value={ul.maxPercent ?? ""}
                      onChange={(e) =>
                        updateUnitLimit(i, "maxPercent", e.target.value)
                      }
                      min={0}
                      max={100}
                    />
                    <Button
                      type="text"
                      icon="delete"
                      color="dark"
                      onClick={() => removeUnitLimit(i)}
                    />
                  </div>
                  {(ul.ids || []).length > 0 && (
                    <div className="comp-packs__tags">
                      {(ul.ids || []).map((unitId) => {
                        const unitData = allUnits.find(
                          (u) => u.id === unitId,
                        );
                        return (
                          <span key={unitId} className="comp-packs__tag">
                            {unitData ? unitData.name : unitId}
                            <button
                              type="button"
                              className="comp-packs__tag-remove"
                              onClick={() => {
                                const newIds = (ul.ids || []).filter(
                                  (id) => id !== unitId,
                                );
                                updateUnitLimit(
                                  i,
                                  "ids",
                                  newIds.join(", "),
                                );
                              }}
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
              <Button type="tertiary" color="dark" onClick={addUnitLimit}>
                <FormattedMessage id="compPacks.addUnitLimit" />
              </Button>
            </div>

            {/* Option/command limits */}
            <div className="comp-packs__section">
              <div className="comp-packs__section-header">
                <h3>
                  <FormattedMessage id="compPacks.optionLimits" />
                </h3>
              </div>
              {(editing.optionLimits || []).map((ol, i) => (
                <div key={i}>
                  <div className="comp-packs__row">
                    <select
                      className="select"
                      value={ol.option}
                      onChange={(e) =>
                        updateOptionLimit(i, "option", e.target.value)
                      }
                    >
                      <option value="">
                        {intl.formatMessage({
                          id: "compPacks.selectOption",
                        })}
                      </option>
                      {[
                        "battle-standard-bearer",
                        "general",
                        "the-hierophant",
                        "level-1-wizard",
                        "level-2-wizard",
                        "level-3-wizard",
                        "level-4-wizard",
                      ].map((c) => (
                        <option key={c} value={c}>
                          {c.replace(/-/g, " ")}
                        </option>
                      ))}
                    </select>
                    <label className="comp-packs__checkbox">
                      <input
                        type="checkbox"
                        checked={ol.disabled ?? false}
                        onChange={(e) =>
                          updateOptionLimit(i, "disabled", e.target.checked)
                        }
                      />
                      {intl.formatMessage({ id: "compPacks.disabled" })}
                    </label>
                    <Button
                      type="text"
                      icon="delete"
                      color="dark"
                      onClick={() => removeOptionLimit(i)}
                    />
                  </div>
                  {/* Faction filter */}
                  <div className="comp-packs__row">
                    <span>
                      <FormattedMessage id="compPacks.armies" />
                    </span>
                    <select
                      className="select"
                      value=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        const newArmies = [
                          ...(ol.armies || []),
                          e.target.value,
                        ];
                        updateOptionLimit(i, "armies", newArmies);
                      }}
                    >
                      <option value="">
                        {intl.formatMessage({ id: "compPacks.allArmies" })}
                      </option>
                      {ARMIES.filter(
                        (id) => !(ol.armies || []).includes(id),
                      ).map((id) => (
                        <option key={id} value={id}>
                          {getArmyName(id)}
                        </option>
                      ))}
                    </select>
                  </div>
                  {(ol.armies || []).length > 0 && (
                    <div className="comp-packs__tags">
                      {ol.armies.map((armyId) => (
                        <span key={armyId} className="comp-packs__tag">
                          {getArmyName(armyId)}
                          <button
                            type="button"
                            className="comp-packs__tag-remove"
                            onClick={() => {
                              updateOptionLimit(
                                i,
                                "armies",
                                ol.armies.filter((a) => a !== armyId),
                              );
                            }}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <Button type="tertiary" color="dark" onClick={addOptionLimit}>
                <FormattedMessage id="compPacks.addOptionLimit" />
              </Button>
            </div>

            {/* Per-unit max percent */}
            <div className="comp-packs__section">
              <div className="comp-packs__section-header">
                <h3>
                  <FormattedMessage id="compPacks.perUnitMaxPercent" />
                </h3>
              </div>
              {CATEGORIES.map((cat) => (
                <div className="comp-packs__row" key={cat}>
                  <span >
                    <FormattedMessage id={`editor.${cat}`} />
                  </span>
                  <input
                    type="number"
                    className="input"
                    placeholder="%"
                    value={editing.perUnitMaxPercent[cat] ?? ""}
                    onChange={(e) =>
                      setPerUnitMaxPercent(cat, e.target.value)
                    }
                    min={0}
                    max={100}
                  />
                </div>
              ))}
            </div>

            {/* Army overrides */}
            <div className="comp-packs__section">
              <div className="comp-packs__section-header">
                <h3>
                  <FormattedMessage id="compPacks.armyOverrides" />
                </h3>
              </div>
              {Object.entries(editing.armyOverrides || {}).map(
                ([armyId, override]) => (
                  <Expandable
                    key={armyId}
                    headline={
                      <span className="comp-packs__pack-header">
                        <b>{getArmyName(armyId)}</b>
                        <Button
                          type="text"
                          icon="delete"
                          color="dark"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeArmyOverride(armyId);
                          }}
                        />
                      </span>
                    }
                    open
                    noMargin
                  >
                    <div className="comp-packs__row">
                      <span>
                        <FormattedMessage id="compPacks.pointsAdjustment" />
                      </span>
                      <input
                        type="number"
                        className="input"
                        value={override.pointsAdjustment ?? 0}
                        onChange={(e) =>
                          updateArmyOverride(
                            armyId,
                            "pointsAdjustment",
                            e.target.value,
                          )
                        }
                      />
                    </div>
                  </Expandable>
                ),
              )}
              <select
                className="select"
                value=""
                onChange={(e) => addArmyOverride(e.target.value)}
              >
                <option value="">
                  {intl.formatMessage({ id: "compPacks.addArmyOverride" })}
                </option>
                {ARMIES
                  .filter((id) => !editing.armyOverrides[id])
                  .map((id) => (
                    <option key={id} value={id}>
                      {getArmyName(id)}
                    </option>
                  ))}
              </select>
            </div>

            {/* Save/Cancel */}
            <br />
            <Button
              centered
              icon="check"
              onClick={handleSave}
              spaceTop
              size="large"
            >
              <FormattedMessage id="compPacks.save" />
            </Button>
            <Button
              centered
              type="tertiary"
              onClick={handleCancel}
              spaceTop
            >
              <FormattedMessage id="compPacks.cancel" />
            </Button>
          </section>
        )}
      </Main>
    </>
  );
};
