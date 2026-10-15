// Posts a Health Auto Export manual export to the app's webhook, a month at
// a time. The app's REST automation cannot send a custom date range (its
// periods stop at the previous seven days, per help.healthyapps.dev, checked
// 2026-09-18), so history comes from Manual Export with a Custom range,
// aggregated by Days, JSON, shared to this machine, and this script does the
// posting. Each request stays small enough for the function's body and time
// limits, and the pause keeps under the app's 60 requests a minute.
//
//   HAE_SECRET=<secret from the Connections card> \
//   pnpm exec tsx scripts/hae-backfill.mts <export.json> [--url <webhook url>] [--dry-run] [--sleep]
//
// The URL defaults to production. --dry-run prints the requests and sends
// nothing. --sleep prints the export's nights and sends nothing: each one's
// span beside the hours the app summed and the minutes the webhook would
// store, which is how a night that reads wrong gets found in the file.

import { readFileSync } from 'node:fs'
import { chunk, parseArgs, sleepReport, type Options } from './hae-backfill-lib'

const DEFAULT_URL = 'https://pos-gilt-rho.vercel.app/api/integrations/health_auto_export/webhook'
const PAUSE_MS = 1_500
const USAGE =
  'usage: HAE_SECRET=... pnpm exec tsx scripts/hae-backfill.mts <export.json> [--url <url>] [--dry-run] [--sleep]'

function options(): Options {
  try {
    return parseArgs(process.argv.slice(2), DEFAULT_URL)
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`)
    process.exit(1)
  }
}

const { file, url, dryRun, sleep } = options()
const payload = JSON.parse(readFileSync(file, 'utf8'))

/** `2026-06-22 00:37:00 -0500` to `00:37`. */
const clock = (stamp: string) => (stamp.length >= 16 ? stamp.slice(11, 16) : stamp || '-')
const hm = (min: number | null) =>
  min === null ? '-' : `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}m`

const WIDTHS = [12, 5, 8, 8, 9, 9, 9, 9]
const line = (cells: string[]) =>
  cells.map((cell, i) => (i === 0 ? cell.padEnd(WIDTHS[i]) : cell.padStart(WIDTHS[i]))).join('')

if (sleep) {
  const nights = sleepReport(payload)
  if (nights.length === 0) {
    console.log('No sleep_analysis points in this export.')
    process.exit(0)
  }
  const days = nights.map((night) => night.day).filter((day) => day !== '?')
  const range = days.length ? `, ${days[0]} to ${days[days.length - 1]}` : ''
  console.log(`${nights.length} nights${range}. Nothing is sent.\n`)
  console.log(line(['day', 'pts', 'start', 'end', 'own', 'total', 'inBed', 'stored']))

  for (const night of nights) {
    // The day, its count and the stored value belong to the night, so they
    // print once; the columns either side of them are per point.
    night.points.forEach((point, i) =>
      console.log(
        line([
          i === 0 ? night.day : '',
          i === 0 ? String(night.points.length) : '',
          clock(point.start),
          clock(point.end),
          hm(point.ownMin),
          hm(point.totalSleepMin),
          hm(point.inBedMin),
          i === 0 ? hm(night.storedMin) : '',
        ]),
      ),
    )
  }

  // The webhook skips a night it cannot read or that is over its cap, so a
  // stored '-' beside readable points is a night the app will not have.
  const skipped = nights.filter((night) => night.storedMin === null)
  console.log(
    skipped.length === 0
      ? '\nEvery night stores.'
      : `\n${skipped.length} skipped: ${skipped
          .map(
            (night) =>
              `${night.day} (${night.points
                .map((point) => `${clock(point.start)} to ${clock(point.end)}, total ${hm(point.totalSleepMin)}`)
                .join('; ')})`,
          )
          .join(', ')}`,
  )
  process.exit(0)
}

const secret = process.env.HAE_SECRET
if (!secret && !dryRun) {
  console.error(`HAE_SECRET is not set\n${USAGE}`)
  process.exit(1)
}

const requests = chunk(payload)
for (const [i, body] of requests.entries()) {
  const text = JSON.stringify(body)
  const what = body.data.metrics
    ? `${body.data.metrics[0]?.data?.[0]?.date?.toString().slice(0, 7) ?? '?'}: ${body.data.metrics.length} metrics`
    : `${body.data.workouts?.length} workouts`
  const label = `${i + 1}/${requests.length} ${what}, ${(text.length / 1024).toFixed(0)} KB`
  if (dryRun) {
    console.log(label)
    continue
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pos-secret': secret! },
    body: text,
  })
  console.log(`${label}: ${res.status}`)
  if (!res.ok) {
    console.error(await res.text())
    process.exit(1)
  }
  if (i < requests.length - 1) await new Promise((r) => setTimeout(r, PAUSE_MS))
}
