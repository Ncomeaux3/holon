// What a push notification says. No imports: the Settings screen is a client
// component and anything reaching core/db.ts drags pg into the browser bundle.

export type PushItem = { title: string; urgency: string }

/**
 * One notification for the whole send.
 *
 * The first item is the headline because it is the most urgent: pending() puts
 * urgent first. The rest become a count, since a push that lists six things is
 * a push nobody reads on a lock screen.
 */
export function renderPush(items: PushItem[]): { title: string; body: string } | null {
  if (items.length === 0) return null

  const [first, ...rest] = items
  const urgent = items.some((i) => i.urgency === 'urgent')

  return {
    title: urgent ? `Needs you: ${first.title}` : first.title,
    body:
      rest.length === 0
        ? 'Open the dashboard for the detail.'
        : `and ${rest.length} more ${rest.length === 1 ? 'thing' : 'things'} waiting.`,
  }
}
