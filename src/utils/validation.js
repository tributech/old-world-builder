import { rules } from "./rules";
import { uniq } from "./collection";
import { equalsOrIncludes } from "./string";
import { getUnitPoints } from "./points";
import { getUnitName, getUnitLeadership, getUnitRuleData } from "./unit";
import { joinWithAnd, joinWithOr } from "./string";
import { validateCompPacks } from "./comp-pack-validation";

const filterByTroopType = (unit) => {
  const ruleData = getUnitRuleData(unit.name_en);
  return [
    "MCa",
    "LCa",
    "HCa",
    "MI",
    "RI",
    "HI",
    "HCh",
    "LCh",
    "MCr",
    "Be",
  ].includes(ruleData?.troopType);
};

/**
 * In a single pass recursively find all wizard levels
 */
function incrementLevels(listOfOptionHolders, wizardLevels) {
  if (listOfOptionHolders && listOfOptionHolders.length) {
    listOfOptionHolders
      .filter((optionHolder) => optionHolder.options)
      .flatMap((optionHolder) => optionHolder.options)
      .filter((option) => option.active)
      .forEach((activeOption) => {
        const match = activeOption.name_en
          .toLowerCase()
          .match(/level\s*(\d+)\s*wizard/);
        if (match && match[1]) {
          wizardLevels[parseInt(match[1], 10)]++;
        }
        // Sometimes the options are nested, check them recursively
        activeOption.options && incrementLevels([activeOption], wizardLevels);
      });
  }
}

/**
 * Iterate the target Character or Units Options stored in the target itself, it's Command Group and mounts
 * This is because in some armies (Mainly Daemons), Unit Champions and Mounts can also be high level wizards
 * which can breach validation rules
 */
const getWizardLevels = (unitToCheck) => {
  // Quantity of wizards of each level from 0-4 (though we're only going to be validating 3 & 4)
  let wizardLevels = [0, 0, 0, 0, 0];

  // Check the unit itself
  incrementLevels([unitToCheck], wizardLevels);
  // Check the units champion and mounts
  incrementLevels(unitToCheck.command, wizardLevels);
  incrementLevels(unitToCheck.mounts, wizardLevels);

  return wizardLevels;
};

export const validateList = ({ list, language, intl }) => {
  const errors = [];
  const generals = !list?.characters?.length
    ? []
    : list.characters.filter(
        (unit) =>
          unit.command &&
          unit.command.find(
            (command) => command.active && command.name_en === "General",
          ),
      );
  // The general must be one of the characters with the highest leadership
  let highestLeadership = 0;
  // The hierophant must be one of the liche priests with the highest wizard level
  let highestLichePriestLevel = 0;

  if (list?.characters?.length) {
    list.characters.forEach((unit) => {
      // Highest leadership for general
      if (
        unit.command &&
        unit.command.find(
          (command) =>
            command.name_en === "General" &&
            (!command.armyComposition ||
              equalsOrIncludes(command.armyComposition, list.armyComposition)),
        )
      ) {
        const unitName =
          unit.name_en.includes("renegade") &&
          list.armyComposition?.includes("renegade")
            ? unit.name_en
            : unit.name_en.replace(" {renegade}", "");
        const leadership = getUnitLeadership(unitName);

        if (leadership && leadership > highestLeadership) {
          highestLeadership = leadership;
        }
      }

      // Highest liche priest level
      if (
        unit.command &&
        unit.command.find(
          (command) =>
            command.name_en === "The Hierophant" &&
            (!command.armyComposition ||
              equalsOrIncludes(command.armyComposition, list.armyComposition)),
        )
      ) {
        const wizardLevel = getWizardLevels(unit).lastIndexOf(1);
        if (wizardLevel && wizardLevel > highestLichePriestLevel) {
          // Settra is always the Hierophant
          highestLichePriestLevel =
            unit.name_en === "Settra the Imperishable" ? 6 : wizardLevel;
        }
      }
    });
  }

  const hierophants = !list?.characters?.length
    ? []
    : list.characters.filter(
        (unit) =>
          unit.command &&
          unit.command.find(
            (command) => command.active && command.name_en === "The Hierophant",
          ),
      );

  const BSBs = !list.characters?.length
    ? []
    : list.characters.filter(
        (unit) =>
          unit.command &&
          unit.command.find(
            (command) =>
              command.active &&
              command.name_en.includes("Battle Standard Bearer"),
          ),
      );

  const coreUnits = list?.core?.length
    ? list.core.filter(filterByTroopType).length
    : 0;
  const specialUnits = list?.special?.length
    ? list.special.filter(filterByTroopType).length
    : 0;
  const rareUnits = list?.rare?.length
    ? list.rare.filter(filterByTroopType).length
    : 0;
  const mercUnits = list?.mercenaries?.length
    ? list.mercenaries.filter(filterByTroopType).length
    : 0;
  const allyUnits = list?.allies?.length
    ? list.allies
        .filter((unit) => unit.unitType !== "characters")
        .filter(filterByTroopType).length
    : 0;
  const generalsCount = generals.length;
  const BSBsCount = BSBs.length;
  const nonCharactersCount =
    coreUnits + specialUnits + rareUnits + mercUnits + allyUnits;
  const characterUnitsRules = rules[list.armyComposition]
    ? rules[list.armyComposition].characters.units
    : rules["grand-army"].characters.units;
  const coreUnitsRules = rules[list.armyComposition]
    ? rules[list.armyComposition].core.units
    : rules["grand-army"].core.units;
  const specialUnitsRules = rules[list.armyComposition]
    ? rules[list.armyComposition].special.units
    : rules["grand-army"].special.units;
  const rareUnitsRules = rules[list.armyComposition]
    ? rules[list.armyComposition].rare.units
    : rules["grand-army"].rare.units;
  const alliesUnitsRules = rules[list.armyComposition]
    ? rules[list.armyComposition]?.allies?.units
    : rules["grand-army"]?.allies?.units;
  const mercenariesUnitsRules = rules[list.armyComposition]
    ? rules[list.armyComposition]?.mercenaries?.units
    : rules["grand-army"]?.mercenaries?.units;

  // Composition rules validation (comp packs + built-in rules)
  const compPackResult = validateCompPacks({ list });
  errors.push(...compPackResult.errors);

  // Not enough non-character units
  const minNonChar = compPackResult.minNonCharacterUnits ?? 3;
  if (nonCharactersCount < minNonChar) {
    errors.push({
      message:
        minNonChar < 3
          ? "misc.error.notEnoughNonCharactersBattleMarch"
          : "misc.error.notEnoughNonCharacters",
      section: "global",
    });
  }

  // No general
  generalsCount === 0 &&
    errors.push({
      message: "misc.error.noGeneral",
      section: "characters",
    });

  // Multiple generals
  generalsCount > 1 &&
    errors.push({
      message: "misc.error.multipleGenerals",
      section: "characters",
    });

  // Multiple hierophants
  hierophants.length > 1 &&
    errors.push({
      message: "misc.error.multipleHierophants",
      section: "characters",
    });

  // General doesn't have highest leadership in the army
  const unitLeadership =
    generalsCount === 1 && getUnitLeadership(generals[0].name_en);

  generalsCount === 1 &&
    unitLeadership &&
    unitLeadership < highestLeadership &&
    errors.push({
      message: "misc.error.generalLeadership",
      section: "characters",
    });

  // Hierophant doesn't have highest wizard level
  const hierophantLevel =
    hierophants.length > 0 &&
    (hierophants[0].name_en === "Settra the Imperishable"
      ? 6
      : getWizardLevels(hierophants[0]).lastIndexOf(1));

  hierophants.length > 0 &&
    hierophantLevel &&
    hierophantLevel < highestLichePriestLevel &&
    errors.push({
      message: "misc.error.hierophantLevel",
      section: "characters",
    });

  // Multiple BSBs
  BSBsCount > 1 &&
    errors.push({
      message: "misc.error.multipleBSBs",
      section: "characters",
    });

  const checkRules = ({ ruleUnit, type }) => {
    const unitsInList = (
      ruleUnit?.requiredByType === "all"
        ? [...list.characters, ...list.core, ...list.special, ...list.rare]
        : list[type]
    ).filter(
      (unit) => ruleUnit.ids && ruleUnit.ids.includes(unit.id.split(".")[0]),
    );
    const requiredUnitsInList =
      ruleUnit.requiresType &&
      (ruleUnit.requiresType === "all"
        ? [...list.characters, ...list.core, ...list.special, ...list.rare]
        : list[ruleUnit.requiresType]
      ).filter(
        (unit) =>
          ruleUnit.requires &&
          ruleUnit.requires.includes(unit.id.split(".")[0]),
      );
    const namesInList = joinWithOr(
      uniq(unitsInList.map((unit) => getUnitName({ unit, language }))),
    );
    const unitNames =
      ruleUnit.min > 0 &&
      joinWithOr(
        uniq(
          ruleUnit.ids.map((id) => {
            const name = intl.formatMessage({ id });

            return getUnitName({ unit: { name }, language });
          }),
        ),
      );
    const requiredNames =
      ruleUnit.requires &&
      joinWithOr(
        uniq(
          ruleUnit.requires.map((id) => {
            const name = intl.formatMessage({ id });

            return getUnitName({ unit: { name }, language });
          }),
        ),
      );
    const points = ruleUnit.points;
    const min = points
      ? Math.floor(list.points / points) * ruleUnit.min
      : ruleUnit.min;
    const max = points
      ? Math.floor(list.points / points) * ruleUnit.max
      : ruleUnit.max;

    // Not enough units
    if (
      (!ruleUnit.requires || (ruleUnit.requires && ruleUnit.requiresGeneral)) &&
      unitsInList.length < min
    ) {
      errors.push({
        message: "misc.error.minUnits",
        section: type,
        name: unitNames,
        min,
      });
    }

    // Too many units
    // Battle March 0-X exception is now handled by max0XUnitTypes in comp packs
    const hasBattleMarch = (list.compositionRules || []).includes("battle-march");
    if (
      (!ruleUnit.requires || (ruleUnit.requires && ruleUnit.requiresGeneral)) &&
      unitsInList.length > max &&
      !hasBattleMarch
    ) {
      errors.push({
        message: "misc.error.maxUnits",
        section: type,
        name: namesInList,
        diff: unitsInList.length - max,
      });
    }

    // Unit requires general
    if (ruleUnit.requiresGeneral && unitsInList.length > 0) {
      const matchingGeneral = generals.find((general) => {
        return ruleUnit.requires.includes(general.id.split(".")[0]);
      });

      !matchingGeneral &&
        errors.push({
          message: "misc.error.requiresGeneral",
          section: type,
          name: requiredNames,
        });

      // Unit requires general with specific active option
      if (ruleUnit.requiresOption) {
        const generalWithOption = generals
          .filter(
            (general) =>
              ruleUnit.requiresOption.unit === general.id.split(".")[0],
          )
          .find((general) =>
            general.options.find(
              (option) =>
                option.id === ruleUnit.requiresOption.id && option.active,
            ),
          );

        if (
          !generalWithOption &&
          matchingGeneral &&
          matchingGeneral.id.split(".")[0] === ruleUnit.requiresOption.unit
        ) {
          errors.push({
            message: "misc.error.requiresOption",
            section: type,
            name: intl.formatMessage({ id: ruleUnit.requiresOption.unit }),
            option: intl.formatMessage({ id: ruleUnit.requiresOption.id }),
          });
        }
      }
    }

    // General requires unit (especially for the renegade rules)
    if (ruleUnit.requiresIfGeneral && generals.length > 0) {
      const requiredUnitsByGeneralInList = [
        ...list.characters,
        ...list.core,
        ...list.special,
        ...list.rare,
      ].filter(
        (unit) =>
          ruleUnit.requiresIfGeneral &&
          ruleUnit.requiresIfGeneral.includes(unit.id.split(".")[0]),
      );
      if (requiredUnitsByGeneralInList.length === 0) {
        errors.push({
          message: "misc.error.requiresUnits",
          section: type,
          name: ruleUnit.requiresIfGeneral,
          diff: 1,
        });
      }
    }

    // Unit should be mounted
    if (ruleUnit.requiresMounted && unitsInList.length > 0) {
      const charactersNotMounted = unitsInList.filter(
        (character) =>
          !Boolean(
            character.mounts.find(
              (mount) => mount.active && mount.name_en !== "On foot",
            ),
          ),
      );
      const requiredNames = joinWithAnd(
        charactersNotMounted.map((unit) => getUnitName({ unit, language })),
      );

      charactersNotMounted.length &&
        errors.push({
          message: "misc.error.requiresMounted",
          section: type,
          name: requiredNames,
        });
    }

    // Unit requires specific active option
    if (ruleUnit.requiresOption) {
      const charactersInList = unitsInList.filter(
        (character) =>
          ruleUnit.requiresOption.unit === character.id.split(".")[0],
      );
      const characterWithOption = charactersInList.find((character) =>
        character.options.find(
          (option) => option.id === ruleUnit.requiresOption.id && option.active,
        ),
      );

      if (charactersInList.length && !characterWithOption) {
        errors.push({
          message: "misc.error.requiresOption",
          section: type,
          name: intl.formatMessage({ id: ruleUnit.requiresOption.unit }),
          option: intl.formatMessage({ id: ruleUnit.requiresOption.id }),
        });
      }
    }

    // Unit requires specific active command
    if (ruleUnit.requiresCommand) {
      const charactersInList = unitsInList.filter(
        (character) =>
          ruleUnit.requiresCommand.unit === character.id.split(".")[0],
      );
      const characterWithCommand = charactersInList.find((character) =>
        character.command.find(
          (command) =>
            command.id === ruleUnit.requiresCommand.id && command.active,
        ),
      );

      if (charactersInList.length && !characterWithCommand) {
        errors.push({
          message: "misc.error.requiresCommand",
          section: type,
          name: intl.formatMessage({ id: ruleUnit.requiresCommand.unit }),
          command: intl.formatMessage({ id: ruleUnit.requiresCommand.id }),
        });
      }
    }

    // Requires other unit
    if (!ruleUnit.requiresGeneral && ruleUnit.requires) {
      if (!max && ruleUnit.perUnit && unitsInList.length < min) {
        errors.push({
          message: "misc.error.minUnits",
          section: type,
          name: unitNames,
          min,
        });
      }

      // Each other unit allows another unit
      if (
        max &&
        ruleUnit.perUnit &&
        unitsInList.length > requiredUnitsInList.length * max
      ) {
        errors.push({
          message: "misc.error.requiresUnits",
          section: type,
          name: requiredNames,
          diff: unitsInList.length - requiredUnitsInList.length * max,
        });
        // Each other unit allows another unit with scaling max value
      } else if (
        !max &&
        ruleUnit.perUnit &&
        unitsInList.length > requiredUnitsInList.length + min
      ) {
        errors.push({
          message: "misc.error.requiresUnits",
          section: type,
          name: requiredNames,
          diff: unitsInList.length - requiredUnitsInList.length - min,
        });
      } else if (
        !ruleUnit.perUnit &&
        !requiredUnitsInList.length &&
        unitsInList.length > 0
      ) {
        errors.push({
          message: "misc.error.requiresUnits",
          section: type,
          name: requiredNames,
          diff: 1,
        });
      }
      if (!ruleUnit.perUnit && unitsInList.length > max) {
        errors.push({
          message: "misc.error.maxUnits",
          section: type,
          name: namesInList,
          diff: unitsInList.length - max,
        });
      }
    }

    // Requires magic item
    if (ruleUnit.requiresMagicItem && unitsInList.length > 0) {
      let hasMagicItem;

      generals.forEach((unit) => {
        unit.items.forEach((itemCategory) => {
          if (
            itemCategory.selected.find(
              (item) =>
                item.name_en.replace(/ /g, "-").toLowerCase() ===
                ruleUnit.requiresMagicItem,
            )
          ) {
            hasMagicItem = true;
          }
        });
      });

      !hasMagicItem &&
        errors.push({
          message: "misc.error.requiresMagicItem",
          section: type,
          name: intl.formatMessage({ id: ruleUnit.requiresMagicItem }),
        });
    }
  };

  characterUnitsRules &&
    characterUnitsRules.forEach((ruleUnit) => {
      checkRules({ ruleUnit, type: "characters" });
    });

  coreUnitsRules &&
    coreUnitsRules.forEach((ruleUnit) => {
      checkRules({ ruleUnit, type: "core" });
    });

  specialUnitsRules &&
    specialUnitsRules.forEach((ruleUnit) => {
      checkRules({ ruleUnit, type: "special" });
    });

  rareUnitsRules &&
    rareUnitsRules.forEach((ruleUnit) => {
      checkRules({ ruleUnit, type: "rare" });
    });

  alliesUnitsRules &&
    alliesUnitsRules.forEach((ruleUnit) => {
      checkRules({ ruleUnit, type: "allies" });
    });

  mercenariesUnitsRules &&
    mercenariesUnitsRules.forEach((ruleUnit) => {
      checkRules({ ruleUnit, type: "mercenaries" });
    });


  return errors;
};
