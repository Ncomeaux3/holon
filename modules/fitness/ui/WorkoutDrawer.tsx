'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { ActionButton, Chip, Eyebrow, MetricStrip, MetricTile, Overlay, SkillPicker, useToast } from '@/components/pos'
import { fieldClass } from '@/components/pos/field'
import { clock12, distance, duration, elevation, mass, pace, shortDate, speed, temperature, toGrams } from '../units'
import { addSets } from './actions'
import type { FitnessData } from './Fitness'

type Workout = FitnessData['workouts'][number]
type Tile = [label: string, value: ReactNode | null | undefined]

// Columns by tile count, so no row ends in an empty slot: two on a phone with
// an odd last tile across the row, three in the drawer when there are three.
// MetricStrip's own `sm:` auto-fit gives two at the drawer's width, so every
// entry sets `sm:` too. Literal classes, for Tailwind to find them.
const ODD = 'max-sm:[&>:last-child:nth-child(odd)]:col-span-2'
const COLS: Record<number, string> = {
  1: 'grid-cols-1 sm:grid-cols-1',
  2: 'grid-cols-2 sm:grid-cols-2',
  3: `grid-cols-2 sm:grid-cols-3 ${ODD}`,
  4: 'grid-cols-2 sm:grid-cols-2',
}

/**
 * One workout, everything the source sent. A section whose readings are all
 * absent is not drawn, so a manual lift shows Time, Effort and skills only.
 */
export function WorkoutDrawer({
  workout: w,
  kindLabel,
  sourceLabel,
  timeZone,
  skills,
  exercises,
  onClose,
}: {
  workout: Workout
  kindLabel: string
  sourceLabel: string
  timeZone: string
  skills: FitnessData['skills']
  exercises: FitnessData['exercises']
  onClose: () => void
}) {
  const s = w.stats
  const unit = w.kind === 'swim' ? 'yd' : 'mi'
  // "6:42 am" never breaks between the time and the am.
  const clock = (iso: string) => clock12(iso, timeZone).replace(' ', '\u00a0')
  const sections: [string, Tile[]][] = [
    [
      'Time',
      [
        ['Date', shortDate(w.startedAt, timeZone)],
        s.endedAt ? ['Start to end', `${clock(w.startedAt)} to ${clock(s.endedAt)}`] : ['Start', clock(w.startedAt)],
        ['Duration', duration(w.durationS)],
      ],
    ],
    [
      'Effort',
      [
        ['Distance', w.distanceM > 0 ? distance(w.distanceM, unit) : null],
        // A ride reads as speed, everything else with a distance as pace. A
        // ride from a source with no stats reads speed off the two columns.
        w.kind === 'ride'
          ? ['Avg speed', s.avgSpeedMps ? speed(s.avgSpeedMps) : w.distanceM > 0 && w.durationS > 0 ? speed(w.distanceM / w.durationS) : null]
          : ['Pace', pace(w.distanceM, w.durationS, unit) || null],
        ['Max speed', s.maxSpeedMps ? speed(s.maxSpeedMps) : null],
        ['MET', s.met],
        ['Best set', w.best ? `${mass(w.best.weightG)} × ${w.best.reps}` : null],
      ],
    ],
    [
      'Heart rate',
      [
        ['Min', s.minHr && `${s.minHr} bpm`],
        ['Avg', w.avgHr && `${w.avgHr} bpm`],
        ['Max', s.maxHr && `${s.maxHr} bpm`],
      ],
    ],
    [
      'Energy',
      [
        ['Active', s.activeKcal !== undefined ? `${s.activeKcal} kcal` : null],
        ['Total', s.totalKcal !== undefined ? `${s.totalKcal} kcal` : null],
      ],
    ],
    [
      'Terrain and conditions',
      [
        ['Climb', s.elevationUpM !== undefined ? elevation(s.elevationUpM) : null],
        ['Descent', s.elevationDownM !== undefined ? elevation(s.elevationDownM) : null],
        ['Temperature', s.tempC !== undefined ? temperature(s.tempC) : null],
        ['Humidity', s.humidityPct !== undefined ? `${s.humidityPct}%` : null],
      ],
    ],
    [
      'Steps',
      [
        ['Steps', s.steps?.toLocaleString('en-US')],
        ['Cadence', s.cadenceSpm && `${s.cadenceSpm} spm`],
        ['Flights', s.flights],
      ],
    ],
    [
      'Swim',
      [
        ['Lap length', s.lapLengthM ? distance(s.lapLengthM, 'yd') : null],
        ['Strokes', s.strokes?.toLocaleString('en-US')],
      ],
    ],
  ]

  return (
    <Overlay
      open
      narrow
      onClose={onClose}
      eyebrow={
        <>
          Fitness <span className="text-secondary-label">/</span> Workout
        </>
      }
      title={w.name}
    >
      <div className="space-y-[18px]">
        <div className="flex flex-wrap gap-1.5">
          <Chip tone="quiet">{kindLabel}</Chip>
          <Chip tone="quiet">{sourceLabel}</Chip>
          {s.location && <Chip tone="quiet">{s.location}</Chip>}
        </div>
        {/* The row's free text: notes typed by hand, or the energy line a
            source with no stats wrote. Apple's energy is its own section. */}
        {w.detail && s.activeKcal === undefined && <p className="text-footnote text-secondary-label">{w.detail}</p>}

        {sections.map(([title, tiles]) => {
          const shown = tiles.filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== 0)
          if (shown.length === 0) return null
          return (
            <section key={title} aria-label={title}>
              <Eyebrow>{title}</Eyebrow>
              <MetricStrip className={`mt-2 ${COLS[shown.length] ?? `grid-cols-2 sm:grid-cols-3 ${ODD}`}`}>
                {shown.map(([label, value]) => (
                  <MetricTile key={label} size="sm" label={label} value={value} />
                ))}
              </MetricStrip>
            </section>
          )
        })}

        {(w.source === 'manual' || w.source === 'agent') && <SetLogger workout={w} exercises={exercises} />}

        <section aria-label="Linked skills">
          <Eyebrow>Linked skills</Eyebrow>
          {w.entityRef ? (
            <SkillPicker entityRef={w.entityRef} links={w.links} skills={skills} className="mt-2" />
          ) : (
            <p className="mt-2 text-footnote text-secondary-label">Nothing matched yet.</p>
          )}
        </section>
      </div>
    </Overlay>
  )
}

/**
 * Add sets to a workout logged by hand, one at a time. A source's own workout
 * is rewritten by its next sync, so only a hand-logged one takes sets here.
 * Time and distance exercises have no set shape, so they are not offered.
 */
function SetLogger({ workout: w, exercises }: { workout: Workout; exercises: FitnessData['exercises'] }) {
  const usable = exercises.filter((e) => e.measure === 'weight_reps' || e.measure === 'reps')
  const [exercise, setExercise] = useState(usable[0]?.name ?? '')
  const [reps, setReps] = useState('')
  const [lb, setLb] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const toast = useToast()
  const weighted = usable.find((e) => e.name === exercise)?.measure !== 'reps'

  const add = () => {
    const n = Number(reps)
    const pounds = lb.trim() === '' ? 0 : Number(lb)
    if (!Number.isInteger(n) || n < 1) return setError('Reps must be a whole number above zero')
    if (weighted && (!Number.isFinite(pounds) || pounds < 0)) return setError('Weight must be a number')
    setError(null)
    start(async () => {
      const result = await addSets(w.id, [{ exercise, reps: n, weight_g: weighted ? toGrams(pounds, 'lb') : 0 }])
      if (!result.ok) toast(result.error)
      else {
        toast('Set added.')
        setReps('')
      }
    })
  }

  return (
    <section aria-label="Sets">
      <Eyebrow>Sets</Eyebrow>
      <p className="mt-2 text-footnote text-secondary-label">
        {w.setCount} set{w.setCount === 1 ? '' : 's'} logged
        {w.best ? ` · best ${w.best.exercise} ${mass(w.best.weightG)} × ${w.best.reps}` : ''}
      </p>
      {usable.length === 0 ? (
        <p className="mt-2 text-footnote text-secondary-label">Add an exercise on the Exercises tab, then log its sets here.</p>
      ) : (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <select aria-label="Set exercise" value={exercise} onChange={(e) => setExercise(e.target.value)} className={`${fieldClass} w-auto min-w-0 flex-1`}>
            {usable.map((e) => (
              <option key={e.id} value={e.name}>
                {e.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            aria-label="Set reps"
            placeholder="Reps"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
            className={`${fieldClass} w-20`}
          />
          {weighted && (
            <input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              aria-label="Set lb"
              placeholder="Lb"
              value={lb}
              onChange={(e) => setLb(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
              className={`${fieldClass} w-20`}
            />
          )}
          <ActionButton variant="outline" size="md" onClick={add} disabled={pending}>
            Add set
          </ActionButton>
        </div>
      )}
      {error && (
        <span role="alert" className="mt-1 block text-footnote text-red-text">
          {error}
        </span>
      )}
    </section>
  )
}
