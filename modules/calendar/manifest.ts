import { z } from 'zod'
import { defineModule, defineTool } from '@/core/module-contract'
import { deleteEvent, listEvents, setHidden, toItems, writeEvent } from './data'
import { nightlyDigest } from './jobs/nightly-digest'
import { pullGoogle } from './jobs/pull-google'
import { pullIcs } from './jobs/pull-ics'
import CalendarPage from './ui/CalendarPage'
import { CalendarTile } from './ui/Tile'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM')

export const EVENT_INPUT = z
  .object({
    id: z.uuid().optional(),
    title: z.string().trim().min(1, 'Title is required').max(200),
    on_date: date,
    all_day: z.boolean(),
    starts: time.nullable().optional(),
    ends: time.nullable().optional(),
    location: z.string().max(300).optional(),
  })
  .refine((e) => e.all_day || e.starts, {
    message: 'A timed event needs a start time',
    path: ['starts'],
  })
  .refine((e) => e.all_day || !e.ends || !e.starts || e.ends > e.starts, {
    message: 'End must be after the start',
    path: ['ends'],
  })

// One calendar of everything dated in POS. The rows shown are almost all other
// modules', reached through their `calendar` seam; this module owns only the
// events typed here and, from Phases 7a and 7b, the read-only feeds.
//
// Events are not registered in core.entities: register() classifies every row
// to skills, and a feed brings hundreds of meetings that would each take a
// classifier pass for nothing an appointment could earn.

export default defineModule({
  id: 'calendar',
  // After Tasks (20) in the rail and in Onboarding.
  nav: { label: 'Calendar', icon: 'calendar', order: 25 },
  pages: { '': CalendarPage },

  tools: {
    get_digest: defineTool({
      description: "How many things are on today and tomorrow, across every module, and the next few.",
      input: z.object({}),
      run: () => nightlyDigest(),
    }),

    write_event: defineTool({
      description:
        'Add an event to the calendar, or edit one added here. Times are the owner\'s local wall clock; all_day ignores them.',
      input: EVENT_INPUT,
      run: async (input, ctx) => ({ id: await writeEvent(input, ctx.source === 'agent' ? 'agent' : 'manual') }),
    }),

    delete_event: defineTool({
      description: 'Delete an event added here. Events from a feed cannot be deleted.',
      input: z.object({ id: z.uuid() }),
      run: async ({ id }) => {
        await deleteEvent(id)
        return { id }
      },
    }),

    set_hidden: defineTool({
      description: 'Which modules the Calendar screen leaves out, by module id.',
      input: z.object({ hidden: z.array(z.string().regex(/^[a-z_]+$/)).max(50) }),
      run: async ({ hidden }) => {
        await setHidden(hidden)
        return { hidden }
      },
    }),
  },

  calendar: async (range) => toItems(await listEvents(range)),

  tile: CalendarTile,
  tileHead: (payload) => {
    const today = typeof payload.today === 'number' ? payload.today : null
    return today === null ? {} : { label: 'Calendar · today', meta: `${today} today` }
  },

  // The pull first, so the digest counts what it brought. Not `requires`:
  // that would call the whole screen unsynced without Google, when every
  // other module still feeds it.
  jobs: [
    { name: 'pull_google', run: pullGoogle },
    { name: 'pull_ics', run: pullIcs },
    { name: 'nightly_digest', run: nightlyDigest },
  ],
})
