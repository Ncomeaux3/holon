-- The Weekly Review's record: one row per week, holding the answers so a week
-- can be reopened and so the note it wrote can be traced back to them.
--
-- The close is four writes on separate connections (a note, rescheduled tasks,
-- goal check-ins, this row) rather than one transaction. It runs as a
-- best-effort sequence with this row written last, so a review that says it
-- closed is one whose other writes landed.

create table core.reviews (
  id uuid primary key default gen_random_uuid(),

  -- ISO week, as the Monday that starts it. A date rather than a year and week
  -- number pair, so ordering and arithmetic are ordinary date operations.
  week_of date not null unique,

  -- What was ticked, carried, dropped, shrunk and picked. Kept as written
  -- rather than normalised into tables: nothing queries inside it, the shape
  -- follows the wizard's steps, and a review is a document.
  answers jsonb not null default '{}'::jsonb,

  -- The three things for next week, in order.
  priorities text[] not null default '{}',

  -- The note the close wrote, so the review and its write-up stay linked.
  note_ref uuid references core.entities (id) on delete set null,

  -- Null while a review is still open. A half finished review is resumable,
  -- which is the point of storing the answers rather than only the outcome.
  closed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reviews_week_idx on core.reviews (week_of desc);

do $$
begin
  create trigger set_updated_at before update on core.reviews
    for each row execute function core.set_updated_at();

  alter table core.reviews enable row level security;

  create policy owner_all on core.reviews for all to authenticated
    using (true) with check (true);

  create policy readonly_select on core.reviews for select to pos_readonly
    using (true);

  grant select, insert, update, delete on core.reviews to authenticated;
  grant all on core.reviews to service_role;
  grant select on core.reviews to pos_readonly;
end;
$$;

-- Closing a week is a real piece of work and the only event this table emits.
insert into skills.xp_weight (event_type, weight)
values ('week_reviewed', 25)
on conflict (event_type) do nothing;
