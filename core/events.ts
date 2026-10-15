import { db } from './db'

export type EmitArgs = {
  module: string
  entityRef: string
  eventType: string
  payload?: Record<string, unknown>
  /** Imports backdate this so the skill tree reflects real history. */
  occurredAt?: Date
  /** Defaults to the entity's current title. */
  titleSnapshot?: string
}

/**
 * Appends to core.events, the log every XP total and digest is computed from.
 *
 * The title is snapshotted because deletes are hard: when the entity goes, the
 * event stays and its ref goes null, so history still reads.
 */
export async function emit({
  module,
  entityRef,
  eventType,
  payload = {},
  occurredAt,
  titleSnapshot,
}: EmitArgs): Promise<void> {
  await db().query(
    `insert into core.events (module, entity_ref, event_type, payload, occurred_at, title_snapshot)
     values ($1, $2, $3, $4::jsonb, coalesce($5, now()),
             coalesce($6, (select title from core.entities where id = $2), ''))`,
    [module, entityRef, eventType, JSON.stringify(payload), occurredAt ?? null, titleSnapshot ?? null],
  )
}
