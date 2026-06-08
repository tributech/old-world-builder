import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

// Consolidated guard: the user-scoped keys (owb.lists — IndexedDB-backed — plus
// owb.settings, dirtyIds, owb.game.*) must ONLY ever be touched through the
// storage.js seam (getItem/setItem/removeItem). Raw localStorage access bypasses
// per-user scoping (and, for owb.lists, IndexedDB), so it reads/writes the wrong
// or a stale copy. This test fails the build if any source file reintroduces a
// direct localStorage access to a scoped key. (owb.lists divergence is what left
// a phone stuck on 61 lists; owb.settings was being written unscoped while read
// scoped.) Browser-level keys (lang, owb.timezone, owb.datasets) are NOT scoped
// and may use raw localStorage.

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const walk = (dir) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
};

// Raw localStorage access to any user-scoped key, in any form.
const FORBIDDEN =
  /localStorage\s*\.\s*(get|set|remove)Item\s*\(\s*["'`](owb\.lists|owb\.settings|dirtyIds|owb\.game)/;

describe("storage seam guard", () => {
  test("no source file touches a scoped key via raw localStorage (storage.js only)", () => {
    const offenders = [];
    for (const file of walk(SRC)) {
      if (file.endsWith(`${join("utils", "storage.js")}`)) continue; // the seam itself
      const src = readFileSync(file, "utf8");
      const idx = src.search(FORBIDDEN);
      if (idx !== -1) {
        const line = src.slice(0, idx).split("\n").length;
        offenders.push(`${file.replace(SRC, "src")}:${line}`);
      }
    }
    expect(offenders, `Use getItem/setItem from utils/storage instead:\n${offenders.join("\n")}`).toEqual([]);
  });

  test("no source file imports the (removed) dropbox sync module", () => {
    const offenders = [];
    for (const file of walk(SRC)) {
      const src = readFileSync(file, "utf8");
      if (/dropbox-auth-and-synchronization/.test(src)) {
        offenders.push(file.replace(SRC, "src"));
      }
    }
    expect(offenders).toEqual([]);
  });
});
