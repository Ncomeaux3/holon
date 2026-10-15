import { db } from './db'
import { emit } from './events'

export type RegisterArgs = {
  module: string
  entityType: string
  /** The module row's own id. Unique within module and type. */
  entityId: string
  title: string
  /** Indexable text. Classification, search, and embedding all read it. */
  text?: string
  /**
   * Defaults to `<entityType>_created`, which is emitted only the first time a
   * row registers. Pass one explicitly for something that genuinely happens
   * again on the same row: task_completed, book_finished, workout_logged.
   */
  eventType?: string
  /** Imports backdate this so XP reflects real history. */
  occurredAt?: Date
  /**
   * False registers and classifies the row without emitting anything.
   *
   * For a backfill of things that already existed. Pulling four hundred vault
   * notes written over five years is not four hundred notes of work tonight,
   * and emitting for each would award every one of them today's XP and spike
   * the Skill Tree, which is the same failure the `xmax = 0` guard below was
   * added to stop. The row still registers, so search and skills can see it.
   */
  emit?: boolean
  /**
   * False keeps the row off the skills classifier. For a row that is a place
   * money sits, not something done: a bank account has no skill to link.
   */
  classify?: boolean
  /**
   * Seeds only. Drops this row's earlier events of the same type before
   * emitting, so a re-seed moves a demo event to today's date instead of adding
   * one: every e2e run re-seeds, and a named event always emits. Real writes
   * never pass it, so core.events stays append-only for everything that happened.
   */
  replace?: boolean
  payload?: Record<string, unknown>
}

/**
 * The one call every module makes when it creates a row: register the entity,
 * classify it, emit the event. That is what keeps the Skill Tree, Goals, and
 * the dashboard consistent without any module knowing about them.
 *
 * Classification is whatever module declares a `classifier`, which today is
 * modules/skills. None installed means no classification and no error.
 */
export async function register({
  module,
  entityType,
  entityId,
  title,
  text,
  eventType,
  occurredAt,
  payload,
  emit: shouldEmit = true,
  classify = true,
  replace = false,
}: RegisterArgs): Promise<string> {
  // xmax = 0 means this upsert inserted rather than updated. Without it every
  // re-register emits another <type>_created and awards its XP again: five demo
  // notes had thirty-eight creation events each before this, and the Skill Tree
  // is the screen where that stops being invisible.
  const { rows } = await db().query<{ id: string; inserted: boolean }>(
    `insert into core.entities (module, entity_type, entity_id, title, body)
     values ($1, $2, $3, $4, $5)
     on conflict (module, entity_type, entity_id) do update
       set title = excluded.title, body = excluded.body
     returning id, (xmax = 0) as inserted`,
    [module, entityType, entityId, title, text ?? null],
  )
  const entityRef = rows[0].id

  // Dynamic, and it has to stay that way. A static import of the registry here
  // closes a cycle: core/modules.ts imports modules/_index.ts, which imports
  // every manifest, and a manifest imports register from this file. Next's
  // bundler hoists around that and plain Node does not, so a static import
  // works in dev and breaks the cron job, pnpm setup and any test outside Next.
  // See docs/ARCHITECTURE.md "Module contract".
  const { getClassifier } = await import('./modules')
  const classifier = getClassifier()
  if (classifier && classify) await classifier(entityRef, [title, text].filter(Boolean).join('\n'), module)

  // A named event is something that happened, so it always emits. The default
  // is a creation, and a row is created once. A backfill opts out of both.
  if (shouldEmit && (eventType || rows[0].inserted)) {
    const type = eventType ?? `${entityType}_created`
    if (replace) {
      await db().query(`delete from core.events where entity_ref = $1 and event_type = $2`, [entityRef, type])
    }
    await emit({
      module,
      entityRef,
      eventType: type,
      occurredAt,
      payload,
      titleSnapshot: title,
    })
  }

  return entityRef
}
