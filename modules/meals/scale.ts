// Scaling an ingredient quantity for cook mode. No imports: the Meals screen is
// a client component and anything reaching core/db.ts drags pg into the browser
// bundle.
//
// Quantities are free text on purpose, because recipes say "a splash" and "2
// cloves". So this scales what is scalable and says plainly when it did not,
// the same stance the grocery list takes about adding grams to cloves.

export type Scaled = {
  text: string
  /** False when there was no leading number to multiply, so the text is as written. */
  scaled: boolean
}

/** A leading count: 600, 1.5, or 1/2, followed by the rest of the line. */
const LEADING = /^\s*(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)\s*(.*)$/

/**
 * Multiply the leading number of a quantity, leaving everything after it alone.
 *
 * Only the first number moves. "2 x 180 g" doubled is "4 x 180 g", because the
 * 180 is the size of the fillet and not a count of anything: scaling both would
 * turn two fillets into four twice as large.
 *
 * A quantity with no leading number comes back exactly as written with
 * `scaled: false`. Half a splash is not a measurement, and inventing one would
 * be worse than leaving the cook to judge it.
 */
export function scaleQuantity(quantity: string, factor: number): Scaled {
  const match = quantity.match(LEADING)
  if (!match || factor <= 0) return { text: quantity, scaled: false }

  const [, number, rest] = match
  const value = number.includes('/')
    ? Number(number.split('/')[0]) / Number(number.split('/')[1])
    : Number(number)

  if (!Number.isFinite(value) || value === 0) return { text: quantity, scaled: false }

  return { text: `${tidy(value * factor)}${rest ? ` ${rest}` : ''}`, scaled: true }
}

/**
 * Two decimal places at most, and no trailing zeros.
 *
 * 133.33333 grams of oats is a precision no kitchen scale has and no cook
 * wants to read, and 3.0 eggs reads as a rounding error rather than three eggs.
 */
function tidy(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/** The multiplier for cooking `wanted` servings of a recipe that makes `makes`. */
export function servingFactor(makes: number, wanted: number): number {
  if (makes <= 0 || wanted <= 0) return 1
  return wanted / makes
}
