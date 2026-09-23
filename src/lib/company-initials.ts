/**
 * Two-letter monogram for a company avatar.
 *
 * The avatars used `name.slice(0, 2)`, which gave "TH" for The Boston Globe
 * and "BO" to both Boston Herald and Boston.com, so the one visual cue meant
 * to tell rows apart made them look the same. A leading "The" is dropped, a
 * leading acronym keeps its own letters (WBUR, GBH, STAT), and otherwise the
 * first letters of the first two words are used, splitting on dots too so
 * Boston.com reads BC.
 */
export function companyInitials(name: string): string {
  const words = name
    .trim()
    .replace(/^the\s+/i, '')
    .split(/[\s.\-_/]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0];
  const isAcronym = first.length >= 2 && first === first.toUpperCase() && /\p{L}/u.test(first);
  if (words.length === 1 || isAcronym) return Array.from(first).slice(0, 2).join('').toUpperCase();
  return (Array.from(first)[0] + Array.from(words[1])[0]).toUpperCase();
}
