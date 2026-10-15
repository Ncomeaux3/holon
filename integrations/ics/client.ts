import { createHash } from 'node:crypto'
import { get } from '@/core/fetching'
import type { Credentials } from '@/core/integration-contract'

// A published calendar, read from its `.ics` URL and parsed here.
//
// No dependency: iCalendar is a line format, and the part a published calendar
// uses is small. What is supported is written down rather than guessed at, and
// a rule this cannot expand is kept as one event and named in the job log, so
// the screen is never quietly wrong about a series.
//
// Supported: VEVENT with UID, SUMMARY, LOCATION, URL, STATUS, DTSTART and
// DTEND (a date, a UTC stamp, a TZID zone or a floating time), EXDATE,
// RECURRENCE-ID overrides, and RRULE with FREQ, INTERVAL, COUNT, UNTIL and
// BYDAY. Not supported: DURATION without DTEND (the event is stored with no
// end), and every other RRULE part.

export type IcsEvent = {
  /** The feed's UID, plus the occurrence date when a rule made this instance. */
  uid: string
  title: string
  location: string
  url: string
  allDay: boolean
  /** YYYY-MM-DD for an all day event, an ISO instant otherwise. */
  start: string
  /** The inclusive last day, or the end instant. Null when the feed sent none. */
  end: string | null
}

export type IcsCalendar = {
  name: string
  events: IcsEvent[]
  /** Rules this did not expand, for the job log. */
  notes: string[]
}

const DAY = 86_400_000

/**
 * What one pull covers: 30 days back to a year ahead, the same window Google's
 * pull reads. It moves forward every night, so a missed run mends itself.
 */
export function pullWindow(now = new Date()): { from: Date; to: Date } {
  return { from: new Date(now.getTime() - 30 * DAY), to: new Date(now.getTime() + 365 * DAY) }
}

/** What the panel saves, or the single URL the card's own field takes. */
export function feedUrls(creds: Credentials | null): string[] {
  const raw = creds?.urls?.trim()
  if (!raw) return []
  if (raw.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === 'string' && u.trim() !== '') : []
    } catch {
      return []
    }
  }
  return raw
    .split(/[\n,]/)
    .map((u) => u.trim())
    .filter(Boolean)
}

/** webcal is Apple's subscription scheme. No HTTP client speaks it; https does. */
export function httpUrl(url: string): string {
  return url.trim().replace(/^webcal:\/\//i, 'https://')
}

/**
 * The prefix on every row's external_id, so one feed's window can be diffed
 * and a removed feed's rows found. Over the https form, so pasting the same
 * calendar as webcal does not orphan what it already brought.
 */
export function feedKey(url: string): string {
  return createHash('sha256').update(httpUrl(url)).digest('hex').slice(0, 8)
}

/** Through core/fetching, which is where the address rules live: the URL is pasted. */
export async function fetchIcs(url: string): Promise<string> {
  const res = await get(httpUrl(url), { headers: { accept: 'text/calendar,text/plain' } })
  if (res.status !== 200) throw new Error(`That URL answered ${res.status}.`)
  // A body cut at the byte cap parses as a calendar that lost its last events,
  // and the pull deletes what a feed stops sending. Failing loudly is the only
  // honest answer: half a calendar must never look like a shrunken one.
  if (res.truncated) throw new Error('That calendar is over the 5 MB limit, so it was not read.')
  return res.body
}

// Parsing -------------------------------------------------------------------

type Prop = { params: Record<string, string>; value: string }
type Block = { props: Record<string, Prop>; exdates: Prop[] }

const unescape = (v: string) =>
  v.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c))

/** Folded lines are joined, CRLF and CR alike, before anything reads them. */
function lines(text: string): string[] {
  return text.replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n')
}

function parseLine(line: string): { name: string; prop: Prop } | null {
  const colon = line.indexOf(':')
  if (colon < 1) return null
  const [name, ...paramParts] = line.slice(0, colon).split(';')
  const params: Record<string, string> = {}
  for (const part of paramParts) {
    const eq = part.indexOf('=')
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name: name.toUpperCase(), prop: { params, value: line.slice(colon + 1) } }
}

/** The VEVENT blocks and the calendar's name. VALARM and VTIMEZONE are skipped whole. */
function blocks(text: string): { name: string; events: Block[] } {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('That URL did not answer with a calendar.')

  let name = ''
  const events: Block[] = []
  let current: Block | null = null
  let skipping: string | null = null

  for (const line of lines(text)) {
    const parsed = parseLine(line)
    if (!parsed) continue
    const { name: key, prop } = parsed

    if (skipping) {
      if (key === 'END' && prop.value.toUpperCase() === skipping) skipping = null
      continue
    }
    if (key === 'BEGIN') {
      const component = prop.value.toUpperCase()
      if (component === 'VEVENT') current = { props: {}, exdates: [] }
      else if (component !== 'VCALENDAR') skipping = component
      continue
    }
    if (key === 'END') {
      if (prop.value.toUpperCase() === 'VEVENT' && current) events.push(current)
      current = null
      continue
    }
    if (!current) {
      if (key === 'X-WR-CALNAME') name = unescape(prop.value).trim()
      continue
    }
    if (key === 'EXDATE') current.exdates.push(prop)
    else current.props[key] = prop
  }

  return { name, events }
}

// Time ----------------------------------------------------------------------

type When = { date: string; time: string | null; zone: string | null; utc: boolean }

function parseWhen(prop: Prop | undefined): When | null {
  const match = prop?.value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/)
  if (!match) return null
  const [, y, m, d, hh, mm, ss, z] = match
  return {
    date: `${y}-${m}-${d}`,
    time: hh ? `${hh}:${mm}:${ss}` : null,
    zone: prop?.params.TZID ?? null,
    utc: z === 'Z',
  }
}

/**
 * How far a zone is from UTC at an instant, through Intl, so there is no
 * offset table to go stale when a country moves its clocks.
 */
function offsetAt(ms: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms))
  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return Date.UTC(at('year'), at('month') - 1, at('day'), at('hour') % 24, at('minute'), at('second')) - ms
}

/**
 * The instant a wall clock names in a zone. Two passes, because the offset has
 * to be read at the answer rather than at the guess, which is what makes the
 * hour after a daylight saving change land right.
 */
function instantIn(date: string, time: string, zone: string, fallback: string): number {
  const wall = Date.parse(`${date}T${time}Z`)
  let use = zone
  let offset: number
  try {
    offset = offsetAt(wall, use)
  } catch {
    // A feed naming a zone Intl does not know ("Customized Time Zone") reads
    // as the owner's own clock, which is where they were when they typed it.
    use = fallback
    offset = offsetAt(wall, use)
  }
  return wall - offsetAt(wall - offset, use)
}

const at = (when: When, time: string, zone: string) =>
  when.utc ? Date.parse(`${when.date}T${time}Z`) : instantIn(when.date, time, when.zone ?? zone, zone)

// Dates, at noon UTC so no zone or clock change can move a day.
const day = (iso: string) => new Date(`${iso}T12:00:00Z`)
const isoDay = (d: Date) => d.toISOString().slice(0, 10)
function addDays(iso: string, n: number): string {
  const d = day(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return isoDay(d)
}
function daysBetween(from: string, to: string): number {
  return Math.round((day(to).getTime() - day(from).getTime()) / 86_400_000)
}

// Recurrence ----------------------------------------------------------------

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const SUPPORTED = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'WKST'])
/** 55 years of a daily rule: enough to walk from an old DTSTART into the window. */
const STEPS = 20_000
/** What one rule may put on the calendar, however long the window is. */
const EMIT = 500

type Rule = { freq: string; interval: number; count: number | null; until: string | null; byday: string[] }

function parseRule(value: string): { rule: Rule | null; unsupported: boolean } {
  const parts = Object.fromEntries(
    value
      .split(';')
      .map((p) => p.split('='))
      .filter((p) => p.length === 2)
      .map(([k, v]) => [k.toUpperCase(), v]),
  )
  if (Object.keys(parts).some((k) => !SUPPORTED.has(k))) return { rule: null, unsupported: true }

  const freq = (parts.FREQ ?? '').toUpperCase()
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return { rule: null, unsupported: true }

  const interval = Math.max(1, Number(parts.INTERVAL ?? 1) || 1)
  const byday = parts.BYDAY ? parts.BYDAY.toUpperCase().split(',') : []

  // BYDAY means something different under each frequency, and only two of
  // them are expanded here: the days of a week, and "the second Tuesday" of a
  // month. Under DAILY or YEARLY, or MONTHLY with no ordinal ("every Tuesday
  // in the month"), reading it would be guessing, and a guessed series is the
  // thing this parser promises never to produce.
  const bydayOk =
    byday.length === 0 ||
    freq === 'WEEKLY' ||
    (freq === 'MONTHLY' && byday.every((code) => /^-?\d/.test(code)))
  // WKST only decides which days share a week, which only matters when weeks
  // are skipped.
  const wkstOk = (parts.WKST ?? 'MO').toUpperCase() === 'MO' || freq !== 'WEEKLY' || interval === 1
  if (!bydayOk || !wkstOk) return { rule: null, unsupported: true }

  const until = parseWhen({ params: {}, value: parts.UNTIL ?? '' })
  return {
    rule: { freq, interval, count: parts.COUNT ? Number(parts.COUNT) : null, until: until?.date ?? null, byday },
    unsupported: false,
  }
}

/** The nth weekday of a month, 1 to 4 or -1 for the last. Null when it does not exist. */
function nthWeekday(year: number, month: number, weekday: number, nth: number): string | null {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const days: number[] = []
  for (let d = 1; d <= last; d++) {
    if (new Date(Date.UTC(year, month, d)).getUTCDay() === weekday) days.push(d)
  }
  const picked = nth < 0 ? days[days.length + nth] : days[nth - 1]
  return picked ? isoDay(new Date(Date.UTC(year, month, picked))) : null
}

/**
 * The occurrence dates a rule names inside a window, in order.
 *
 * Counted from the rule's start but kept only inside the window: `COUNT` is
 * the ordinal from the first occurrence, so a standup that has run since 2015
 * has to be walked from 2015, and keeping every date it ever had would fill
 * the cap years before reaching the window and leave it empty.
 */
function occurrences(start: string, rule: Rule, window: { from: string; to: string }): string[] {
  const dates: string[] = []
  const [year, month, dayOfMonth] = start.split('-').map(Number)
  let made = 0

  /** False when nothing later can qualify. */
  const take = (date: string | null): boolean => {
    if (!date || date < start) return true
    if (rule.until && date > rule.until) return false
    if (rule.count && made >= rule.count) return false
    made++
    if (date >= window.from && date <= window.to && dates.length < EMIT) dates.push(date)
    return true
  }

  for (let step = 0; step < STEPS; step++) {
    // The earliest date this step could produce, which is what says whether
    // every later step is past the window.
    let base: string
    let more = true

    if (rule.freq === 'DAILY') {
      base = addDays(start, step * rule.interval)
      more = take(base)
    } else if (rule.freq === 'WEEKLY') {
      // Each interval-th week from the one DTSTART falls in, Monday first.
      const monday = addDays(start, -((day(start).getUTCDay() + 6) % 7))
      base = addDays(monday, step * rule.interval * 7)
      const days = rule.byday.length > 0 ? rule.byday : [WEEKDAYS[day(start).getUTCDay()]]
      const inWeek = days
        .map((code) => WEEKDAYS.indexOf(code.slice(-2)))
        .filter((index) => index >= 0)
        .map((index) => addDays(base, (index + 6) % 7))
        .sort()
      for (const date of inWeek) if (!(more = take(date))) break
    } else if (rule.freq === 'MONTHLY') {
      const target = new Date(Date.UTC(year, month - 1 + step * rule.interval, 1))
      base = isoDay(target)
      if (rule.byday.length > 0) {
        const inMonth = rule.byday
          .map((code) =>
            nthWeekday(
              target.getUTCFullYear(),
              target.getUTCMonth(),
              WEEKDAYS.indexOf(code.slice(-2)),
              Number(code.slice(0, -2) || 1),
            ),
          )
          .filter((date): date is string => date !== null)
          .sort()
        for (const date of inMonth) if (!(more = take(date))) break
      } else {
        // A 31st skips the months that have no 31st, as the standard says.
        const candidate = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), dayOfMonth))
        if (candidate.getUTCMonth() === target.getUTCMonth()) more = take(isoDay(candidate))
      }
    } else {
      const candidate = new Date(Date.UTC(year + step * rule.interval, month - 1, dayOfMonth))
      base = isoDay(new Date(Date.UTC(year + step * rule.interval, month - 1, 1)))
      if (candidate.getUTCDate() === dayOfMonth) more = take(isoDay(candidate))
    }

    if (!more || base > window.to || dates.length >= EMIT) break
    if (rule.count && made >= rule.count) break
  }

  return dates
}

// Assembly ------------------------------------------------------------------

export function parseIcs(
  text: string,
  window: { from: Date; to: Date; zone: string },
): IcsCalendar {
  const { name, events } = blocks(text)
  const notes: string[] = []
  const out: IcsEvent[] = []

  // A moved instance arrives as its own VEVENT carrying RECURRENCE-ID. It
  // replaces the date its series would have used, so the day shows one event.
  const overrides = new Map<string, Block>()
  for (const block of events) {
    const recurrence = parseWhen(block.props['RECURRENCE-ID'])
    const uid = block.props.UID?.value
    if (recurrence && uid) overrides.set(`${uid}/${recurrence.date}`, block)
  }

  for (const block of events) {
    if (block.props.STATUS?.value.toUpperCase() === 'CANCELLED') continue
    const uid = block.props.UID?.value?.trim()
    const start = parseWhen(block.props.DTSTART)
    if (!uid || !start) continue

    const title = (unescape(block.props.SUMMARY?.value ?? '').trim() || '(No title)').slice(0, 200)
    const allDay = block.props.DTSTART?.params.VALUE === 'DATE' || start.time === null
    const end = parseWhen(block.props.DTEND)
    const recurrence = parseWhen(block.props['RECURRENCE-ID'])

    // An all day DTEND is exclusive, as it is in Google's API; the row stores
    // the last day. A timed event keeps its length across every occurrence.
    const spanDays = allDay && end ? Math.max(0, daysBetween(start.date, end.date) - 1) : 0
    const lengthMs =
      !allDay && end && start.time && end.time
        ? at(end, end.time, window.zone) - at(start, start.time, window.zone)
        : null

    const { rule, unsupported } = block.props.RRULE
      ? parseRule(block.props.RRULE.value)
      : { rule: null, unsupported: false }
    if (unsupported) notes.push(`${title}: ${block.props.RRULE?.value} is kept as one event.`)

    const excluded = new Set(
      block.exdates.flatMap((p) =>
        p.value.split(',').map((v) => parseWhen({ params: p.params, value: v })?.date ?? ''),
      ),
    )
    // A day either side, so a multi-day event that straddles an edge is kept
    // and the instant test below decides.
    const span = { from: addDays(isoDay(window.from), -1), to: addDays(isoDay(window.to), 1) }
    const dates = rule
      ? occurrences(start.date, rule, span).filter((d) => !excluded.has(d))
      : [start.date]

    for (const date of dates) {
      // The override's own VEVENT carries the moved time, so the series skips
      // this date and the override's block is read on its own pass below.
      if (rule && overrides.has(`${uid}/${date}`)) continue
      // A moved instance keys on the date it replaces, in the same form the
      // series uses, so the two can never both be stored.
      const occurrence = (recurrence?.date ?? date).replace(/-/g, '')
      const key = recurrence || rule ? `${uid}/${occurrence}` : uid
      const startsAt = allDay ? date : new Date(at({ ...start, date }, start.time ?? '00:00:00', window.zone)).toISOString()
      const endsAt = allDay
        ? spanDays > 0
          ? addDays(date, spanDays)
          : null
        : lengthMs !== null
          ? new Date(Date.parse(startsAt) + lengthMs).toISOString()
          : null

      const fromMs = allDay
        ? instantIn(date, '00:00:00', window.zone, window.zone)
        : Date.parse(startsAt)
      const toMs = allDay
        ? instantIn(endsAt ?? date, '23:59:59', window.zone, window.zone)
        : Date.parse(endsAt ?? startsAt)
      if (fromMs >= window.to.getTime() || toMs < window.from.getTime()) continue

      out.push({
        uid: key,
        title,
        location: unescape(block.props.LOCATION?.value ?? '').trim().slice(0, 300),
        url: block.props.URL?.value.trim() ?? '',
        allDay,
        start: startsAt,
        end: endsAt,
      })
    }
  }

  out.sort((a, b) => a.start.slice(0, 10).localeCompare(b.start.slice(0, 10)) || a.start.localeCompare(b.start))
  return { name, events: out, notes }
}
