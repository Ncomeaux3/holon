// What the Shortcut posts, turned into what Tasks writes. Shortcuts sends
// every field as text, and its ISO 8601 date is the owner's own wall clock
// with an offset on the end, so the date and time are read as written rather
// than converted: a reminder due at 09:00 is due at 09:00.

export type Reminder = {
  externalId: string
  title: string
  /** YYYY-MM-DD, or null when the reminder has no due date. */
  dueOn: string | null
  /** HH:MM, or null for a whole-day reminder. */
  dueAt: string | null
  notes: string
  /** The Reminders list, which becomes a project. Empty when it sends none. */
  list: string
}

type Raw = { id: string; title?: string; due?: string; notes?: string; list?: string }

export function toReminders(payload: unknown): Reminder[] {
  const list = (payload as { reminders?: Raw[] })?.reminders ?? []
  return list.flatMap((r) => {
    const externalId = String(r.id ?? '').trim()
    if (!externalId) return []
    const due = String(r.due ?? '').match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/)
    return [
      {
        externalId,
        title: (String(r.title ?? '').trim() || 'Reminder').slice(0, 200),
        dueOn: due?.[1] ?? null,
        dueAt: due?.[2] ?? null,
        notes: String(r.notes ?? '').trim(),
        list: String(r.list ?? '').trim().slice(0, 80),
      },
    ]
  })
}
