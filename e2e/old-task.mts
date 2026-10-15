import { db } from '@/core/db'

// A task done a month ago, for the skill event drill-through e2e: the board
// loads done tasks from the last week only, so a link to this one has to be
// fetched by id. Outside that window, it shows in no board view and moves no
// count the other tests read. Prints the id. Local only, as e2e/seed.mts says.
if (!/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('e2e/old-task.mts refuses to run: DATABASE_URL is not a local database.')
}

const { rows } = await db().query<{ id: string }>(
  `insert into tasks.task (title, priority, source, external_id, status, completed_at)
   values ('Wired the old export', 'P3', 'demo', 'e2e-old-done', 'done', now() - interval '30 days')
   on conflict (source, external_id) do update set completed_at = excluded.completed_at
   returning id`,
)
console.log(rows[0].id)
await db().end()
