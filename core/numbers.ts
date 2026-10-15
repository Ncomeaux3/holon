// Numbers typed or pasted into a field. Pure, so it can be tested without a
// browser; the inputs that use it are plain text with inputMode="decimal",
// because type="number" blanks a pasted "$1,200" and grows spinner arrows.

/** "$1,200.50" -> 1200.5. Keeps digits, dot and minus; null when nothing numeric is left. */
export function parseNumber(text: string): number | null {
  const s = text.replace(/[^0-9.-]/g, '')
  if (s === '' || s === '-' || s === '.') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
