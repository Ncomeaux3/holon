import { db } from '@/core/db'

// What the fitness form e2e tests type, taken out again so the mobile run and
// the later tests see the seed they assert on: the new plan archived the
// seeded one, a hand-logged workout moves the "by hand" count, and a goal
// moves the Goals counts. Local only, as e2e/seed.mts says.
if (!/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('e2e/fitness-cleanup.mts refuses to run: DATABASE_URL is not a local database.')
}

await db().query(
  `delete from core.entities where module = 'fitness'
      and entity_id in (select id::text from fitness.workout where name like 'E2E lift %'
                        union select id::text from fitness.plan where name like 'E2E plan %')`,
)
await db().query(
  `delete from core.entities where module = 'goals'
      and entity_id in (select id::text from goals.goal where title like 'E2E workouts %')`,
)
await db().query(`delete from goals.goal where title like 'E2E workouts %'`)
await db().query(`delete from fitness.workout where name like 'E2E lift %'`)
await db().query(`delete from fitness.exercise where name like 'E2E press %'`)
await db().query(`delete from fitness.plan where name like 'E2E plan %'`)
await db().query(`update fitness.plan set status = 'active' where source = 'demo' and external_id = 'plan-winter'`)
await db().end()
