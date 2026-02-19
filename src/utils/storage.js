/**
 * User-scoped localStorage abstraction (OWR sprout)
 *
 * Prefixes user-specific keys with `u.{storageKey}.` so that
 * different users on the same browser don't collide.
 * The storageKey comes from the backend sync API response.
 *
 * Scoped keys: owb.lists, owb.settings
 * Non-scoped (browser-level): lang, owb.timezone, owb.datasets, etc.
 */

const ACTIVE_KEY = "owb.activeStorageKey";
const SCOPED_KEYS = ["owb.lists", "owb.settings"];

let activeKey = localStorage.getItem(ACTIVE_KEY) || null;

const resolveKey = (baseKey) =>
  activeKey && SCOPED_KEYS.includes(baseKey)
    ? `u.${activeKey}.${baseKey}`
    : baseKey;

export const getActiveStorageKey = () => activeKey;

/**
 * Set the active storage key (called when sync response arrives).
 * On first login, migrates unscoped data to the scoped key.
 * Returns true if a different user was previously active (user switch).
 */
export const setActiveStorageKey = (key) => {
  if (!key || key === activeKey) return false;
  const prev = activeKey;
  activeKey = key;
  localStorage.setItem(ACTIVE_KEY, key);
  if (!prev) migrateUnscopedToScoped(key);
  return prev !== null;
};

/**
 * One-time migration: move unscoped owb.lists / owb.settings
 * into the user-scoped key, then remove the unscoped copy.
 */
const migrateUnscopedToScoped = (key) => {
  for (const base of SCOPED_KEYS) {
    const scoped = `u.${key}.${base}`;
    const data = localStorage.getItem(base);
    if (data && !localStorage.getItem(scoped)) {
      localStorage.setItem(scoped, data);
      localStorage.removeItem(base);
    }
  }
};

export const getItem = (key) => localStorage.getItem(resolveKey(key));
export const setItem = (key, val) => localStorage.setItem(resolveKey(key), val);
export const removeItem = (key) => localStorage.removeItem(resolveKey(key));
