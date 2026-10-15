import { db } from '@/core/db'

// What the Home form e2e test types, taken out again so the mobile run and the
// later Home tests see the seed they assert on. Deleting the asset takes its
// services and log with it (on delete cascade). Local only, as e2e/seed.mts says.
if (!/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('e2e/home-cleanup.mts refuses to run: DATABASE_URL is not a local database.')
}

await db().query(
  `delete from core.entities where module = 'home'
      and entity_id in (select id::text from home.asset where name like 'E2E asset %')`,
)
await db().query(`delete from home.warranty where name like 'E2E cover %'`)
await db().query(`delete from home.asset where name like 'E2E asset %'`)
await db().end()
