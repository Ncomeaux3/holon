-- A transaction can belong to a trip (v1.2 phase 10b).
--
-- trip_ref points at the trip's registry row, so Finance never reads the
-- travel schema. trip_classified_by is its own provenance, apart from the
-- category's: 'rule' is a suggestion the pre-tag rule wrote, 'manual' is the
-- owner's answer (a confirm, a change or a clear to null) and no rule touches
-- it again. Reusing is_manual would lock the category on every trip answer and
-- keep the rule off every row filed by hand.
--
-- Accounts join the registry so a loyalty program can name the card that
-- earns it. Backfilled here; the sync registers new ones.

alter table finance.transaction
  add column trip_ref uuid references core.entities (id) on delete set null,
  add column trip_classified_by text check (trip_classified_by in ('rule', 'manual'));

create index transaction_trip_idx on finance.transaction (trip_ref) where trip_ref is not null;

insert into core.entities (module, entity_type, entity_id, title)
select 'finance', 'account', a.id::text, a.name
  from finance.account a
on conflict (module, entity_type, entity_id) do update set title = excluded.title;
