/**
 * Simple lexorank implementation for syncable list ordering.
 * Generates strings that sort alphabetically between two values.
 *
 * This enables folder/order changes to sync across devices by storing
 * an explicit rank rather than relying on array position.
 *
 * Uses fixed boundary markers (MIN/MAX) to ensure we can always
 * find a midpoint, even at list extremes.
 *
 * For upstream: https://github.com/oldworldbuilder/old-world-builder
 */

// Fixed boundary markers - never assign these as actual ranks
// Using multiple chars ensures we always have room for midpoints
const MIN_RANK = "000000"; // Lower boundary
const MAX_RANK = "zzzzzz"; // Upper boundary

/**
 * Generate a rank string that sorts between prev and next.
 * @param {string|null} prev - Rank of item before, or null if first
 * @param {string|null} next - Rank of item after, or null if last
 * @returns {string} A rank that sorts between prev and next
 */
export function generateRank(prev, next) {
  // Use boundary markers when at list extremes
  const lower = prev || MIN_RANK;
  const upper = next || MAX_RANK;

  return midpoint(lower, upper);
}

// Character codes for boundary handling in midpoint (0-9, a-z range)
const MIN_CHAR = 48; // '0'
const MAX_CHAR = 122; // 'z'

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
    // Use boundary chars when string is exhausted
    const charA = a.charCodeAt(i) || MIN_CHAR;
    const charB = b.charCodeAt(i) || MAX_CHAR;

    if (charA === charB) {
      result += a[i] || String.fromCharCode(MIN_CHAR);
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
