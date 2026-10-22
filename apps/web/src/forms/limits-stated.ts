/**
 * Whether an input's description already says its limits (#14), so the
 * page's own line ("At least 1. At most 10.") would only repeat it. A limit
 * counts as said when its number is in the description, in figures ("10",
 * "0.5") or, up to twenty, in words ("three"). Only the numbers are
 * compared: what the description says of them is its own business.
 */

const WORDS: readonly string[] = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
];

/** The numbers a text names, in figures or in words. */
export function numbersIn(text: string): ReadonlySet<number> {
  const found = new Set<number>();
  for (const match of text.matchAll(/-?\d+(?:\.\d+)?/g)) found.add(Number(match[0]));
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const index = WORDS.indexOf(word);
    if (index >= 0) found.add(index);
  }
  return found;
}

/** Whether `description` names every one of `limits`; never for no description or no limits. */
export function limitsStated(description: string | undefined, limits: readonly number[]): boolean {
  if (description === undefined || limits.length === 0) return false;
  const said = numbersIn(description);
  return limits.every((limit) => said.has(limit));
}
