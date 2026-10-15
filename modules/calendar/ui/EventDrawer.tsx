'use client'

import { useId, useState, useTransition } from 'react'
import { ActionButton, Field, Overlay, Switch, fieldClass, timeFieldClass, useFormErrors, useToast } from '@/components/pos'
import { ConfirmButton } from '@/components/pos/edit'
import type { CalendarItem } from '@/core/module-contract'
import { cn } from '@/lib/utils'
import { removeEvent, saveEvent } from './actions'

// Add or edit one event typed here. A feed's events never open this: they are
// the feed's, and the next pull would overwrite any edit.

export function EventDrawer({
  event,
  day,
  onClose,
  onSaved,
}: {
  /** Absent for a new event. */
  event?: CalendarItem
  /** The selected day, the new event's date. */
  day: string
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [pending, start] = useTransition()
  const formId = useId()

  const initial = {
    title: event?.title ?? '',
    on_date: event?.startsAt.slice(0, 10) ?? day,
    // A new event starts all day, so a title alone saves.
    all_day: event?.allDay ?? true,
    starts: event && !event.allDay ? event.startsAt.slice(11, 16) : '',
    ends: event?.endsAt?.slice(11, 16) ?? '',
    location: event?.meta ?? '',
  }
  const [d, setD] = useState(initial)
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => d[k] !== initial[k])
  const set = (key: 'title' | 'on_date' | 'starts' | 'ends' | 'location') => (e: { target: { value: string } }) =>
    setD((prev) => ({ ...prev, [key]: e.target.value }))

  // The tool's own zod check stays the truth; this saves the round trip.
  const { errors, ref, submit } = useFormErrors(() => ({
    title: d.title.trim() ? undefined : 'Title is required',
    on_date: d.on_date ? undefined : 'Date is required',
    starts: d.all_day || d.starts ? undefined : 'A timed event needs a start time',
    ends: d.all_day || !d.starts || !d.ends || d.ends > d.starts ? undefined : 'End must be after the start',
  }))

  const save = () => {
    if (!submit()) return
    start(async () => {
      const result = await saveEvent({
        ...(event && { id: event.id }),
        title: d.title.trim(),
        on_date: d.on_date,
        all_day: d.all_day,
        starts: d.all_day ? null : d.starts || null,
        ends: d.all_day ? null : d.ends || null,
        location: d.location.trim(),
      })
      if (result.ok) {
        toast(event ? 'Saved' : `Added. ${d.title.trim()}`)
        onSaved()
      } else {
        toast(result.error)
      }
    })
  }

  const remove = () => {
    if (!event) return
    start(async () => {
      const result = await removeEvent(event.id)
      toast(result.ok ? 'Deleted' : result.error)
      if (result.ok) onSaved()
    })
  }

  return (
    <Overlay
      open
      onClose={onClose}
      dirty={dirty}
      narrow
      eyebrow="Calendar"
      title={event ? 'Edit event' : 'New event'}
      // Hidden while a save or delete runs: ConfirmButton takes no disabled.
      actions={
        event && !pending && (
          <ConfirmButton confirmLabel="Delete" title="Delete this event?" onConfirm={remove}>
            Delete
          </ConfirmButton>
        )
      }
      footer={
        <>
          <ActionButton variant="quiet" onClick={onClose}>
            Cancel
          </ActionButton>
          <ActionButton variant="solid" type="submit" form={formId} disabled={pending}>
            {event ? 'Save' : 'Add'}
          </ActionButton>
        </>
      }
    >
      <form
        id={formId}
        ref={ref}
        noValidate
        className="flex flex-col gap-[18px]"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <Field label="Title" required error={errors.title}>
          <input value={d.title} onChange={set('title')} className={cn(fieldClass, 'w-full')} />
        </Field>
        <Field label="Date" required error={errors.on_date}>
          <input type="date" value={d.on_date} onChange={set('on_date')} className={cn(fieldClass, 'num w-full')} />
        </Field>
        <div className="flex items-center justify-between gap-3">
          <span className="text-body text-label">All day</span>
          <Switch label="All day" checked={d.all_day} onChange={(all_day) => setD((prev) => ({ ...prev, all_day }))} />
        </div>
        {!d.all_day && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts" required error={errors.starts}>
              <input type="time" value={d.starts} onChange={set('starts')} className={cn(timeFieldClass, 'w-full')} />
            </Field>
            <Field label="Ends" error={errors.ends}>
              <input type="time" value={d.ends} onChange={set('ends')} className={cn(timeFieldClass, 'w-full')} />
            </Field>
          </div>
        )}
        <Field label="Location">
          <input value={d.location} onChange={set('location')} className={cn(fieldClass, 'w-full')} />
        </Field>
      </form>
    </Overlay>
  )
}
