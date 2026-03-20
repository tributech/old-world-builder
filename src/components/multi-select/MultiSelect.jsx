import React from "react";
import PropTypes from "prop-types";
import classNames from "classnames";

import "./MultiSelect.css";

/**
 * A multiselect component that shows selected items as tags
 * and an "add" dropdown for unselected options.
 */
export const MultiSelect = ({
  options,
  selected,
  onChange,
  placeholder,
  spaceTop,
  className,
}) => {
  const selectedSet = new Set(selected || []);
  const availableOptions = options.filter((opt) => !selectedSet.has(opt.id));
  const selectedOptions = (selected || [])
    .map((id) => options.find((opt) => opt.id === id))
    .filter(Boolean);

  const handleAdd = (event) => {
    const value = event.target.value;
    if (!value) return;
    onChange([...(selected || []), value]);
    event.target.value = "";
  };

  const handleRemove = (id) => {
    onChange((selected || []).filter((s) => s !== id));
  };

  return (
    <div
      className={classNames(
        "multi-select",
        spaceTop && "multi-select--spaceTop",
        className,
      )}
    >
      {selectedOptions.length > 0 && (
        <div className="multi-select__tags">
          {selectedOptions.map((opt) => (
            <span
              key={opt.id}
              className={classNames(
                "multi-select__tag",
                opt.builtIn && "multi-select__tag--builtin",
              )}
            >
              {opt.name}
              <button
                type="button"
                className="multi-select__tag-remove"
                onClick={() => handleRemove(opt.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {availableOptions.length > 0 && (
        <select
          className="multi-select__dropdown"
          value=""
          onChange={handleAdd}
        >
          <option value="">{placeholder || "Add..."}</option>
          {availableOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
};

MultiSelect.propTypes = {
  options: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      name: PropTypes.string.isRequired,
      builtIn: PropTypes.bool,
    }),
  ).isRequired,
  selected: PropTypes.arrayOf(PropTypes.string),
  onChange: PropTypes.func.isRequired,
  placeholder: PropTypes.string,
  spaceTop: PropTypes.bool,
  className: PropTypes.string,
};
