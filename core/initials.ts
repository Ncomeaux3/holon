/**
 * The avatar's letters: the first letter of the first two words of a name,
 * one letter for one word, a question mark for none. Its own file so the
 * avatar (a client component) and its test share it without pulling React in.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  return words
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}
