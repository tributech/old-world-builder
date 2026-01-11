/**
 * Simple lexorank implementation for syncable list ordering.
 * Generates strings that sort alphabetically between two values.
 *
 * This enables folder/order changes to sync across devices by storing
 * an explicit rank rather than relying on array position.
 *
 * For upstream: https://github.com/oldworldbuilder/old-world-builder
 */

const MID = "n"; // Middle of alphabet for initial items

/**
 * Generate a rank string that sorts between prev and next.
 * @param {string|null} prev - Rank of item before, or null if first
 * @param {string|null} next - Rank of item after, or null if last
 * @returns {string} A rank that sorts between prev and next
 */
export function generateRank(prev, next) {
  // No neighbors - use middle
  if (!prev && !next) return MID;

  // Only next exists - prepend 'a' to sort before
  if (!prev) return "a" + next;

  // Only prev exists - append 'z' to sort after
  if (!next) return prev + "z";

  // Find midpoint between prev and next
  return midpoint(prev, next);
}

/**
 * Find lexicographic midpoint between two strings.
 * @param {string} a - Lower bound
 * @param {string} b - Upper bound
 * @returns {string} A string that sorts between a and b
 */
function midpoint(a, b) {
  let result = "";
  let i = 0;

  while (true) {
    const charA = a.charCodeAt(i) || 96; // 'a' - 1 if exhausted
    const charB = b.charCodeAt(i) || 123; // 'z' + 1 if exhausted

    if (charA === charB) {
      result += a[i] || "a";
      i++;
      continue;
    }

    const mid = Math.floor((charA + charB) / 2);
    if (mid === charA) {
      result += a[i];
      i++;
      continue;
    }

    return result + String.fromCharCode(mid);
  }
}
