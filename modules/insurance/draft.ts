// The shape of a drafted policy, and the parsing of the model's reply. No
// imports: the Insurance screen is a client component and anything reaching
// core/db.ts drags pg into the browser bundle.

export type DraftField = {
  key: string
  label: string
  value: string
  /** 0 to 1. Below LOW_CONFIDENCE the screen colours it amber and says why. */
  confidence: number
}

export const FIELDS: { key: string; label: string; hint: string }[] = [
  { key: 'name', label: 'Policy name', hint: 'What the owner would call it, like "2019 Civic, full coverage"' },
  { key: 'kind', label: 'Type', hint: 'one of auto, renters, homeowners, health, dental, vision, life, pet, device, umbrella, other' },
  { key: 'carrier', label: 'Carrier', hint: 'the insurer' },
  { key: 'policy_number', label: 'Policy number', hint: 'exactly as printed' },
  { key: 'expires_on', label: 'Expires', hint: 'YYYY-MM-DD, the end of the current term' },
  { key: 'premium', label: 'Premium', hint: 'the amount billed each period, in dollars, digits only' },
  { key: 'cadence', label: 'Billed', hint: 'one of monthly, quarterly, semiannual, annual' },
  { key: 'deductible', label: 'Deductible', hint: 'in dollars, digits only, or empty if the policy has none' },
  { key: 'limits', label: 'Coverage limits', hint: 'copied in the words on the page, like "100/300/100" or "$1,500 annual max"' },
  { key: 'agent_name', label: 'Agent', hint: 'the named contact, or empty' },
  { key: 'agent_contact', label: 'Agent contact', hint: 'phone or email, or empty' },
]

/**
 * Parse the model's reply into fields.
 *
 * Every field asked for comes back, whether or not the model mentioned it: a
 * missing field is an empty box the owner fills in, not a field that silently
 * disappears from the form. Anything unparseable yields a form of empty boxes
 * rather than an error, because the PDF is still attached and typing seven
 * fields is better than starting again.
 */
export function parseFields(reply: string): DraftField[] {
  let parsed: { key?: string; value?: string; confidence?: number }[] = []
  const json = reply.slice(reply.indexOf('['), reply.lastIndexOf(']') + 1)
  try {
    const candidate = JSON.parse(json)
    if (Array.isArray(candidate)) parsed = candidate
  } catch {
    parsed = []
  }

  return FIELDS.map((field) => {
    const found = parsed.find((p) => p.key === field.key)
    return {
      key: field.key,
      label: field.label,
      value: typeof found?.value === 'string' ? found.value : '',
      confidence:
        typeof found?.confidence === 'number' ? Math.min(Math.max(found.confidence, 0), 1) : 0,
    }
  })
}

/** Below this the screen marks a field and says the page was not clear. */
export const LOW_CONFIDENCE = 0.7
