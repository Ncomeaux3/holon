-- v1.2 phase 5c. A rule says where it came from, and money to a person is
-- spending.
--
-- SPEC asks every model decision to store confidence and classified_by, and
-- the model arm in 5d writes rules rather than only filing rows. A boolean
-- cannot say whether a rule came from the owner or from the model, nor how
-- sure the model was, so the two columns go on the rule. `is_manual` keeps its
-- one job: the override flag no job may overwrite.

alter table finance.category_rule
  add column classified_by text not null default 'human'
    check (classified_by in ('human', 'model')),
  add column confidence numeric;

-- Money to or from a person is spending. A Zelle to someone for a trip was
-- filed `Account transfer`, whose kind is never counted, so real money left
-- and Finance said nothing had. Money back from the same person is a negative
-- row in this category and nets by itself.
insert into finance.category (name, description, kind, is_fixed, position) values
  ('People', 'Money to and from individuals', 'expense', false, 22)
on conflict (name) do nothing;

-- The rows already in the ledger, once.
--
-- The three peer patterns are built-ins in modules/finance/categorise.ts, not
-- rows in finance.category_rule, so no write_rule or delete_rule ever fires a
-- back-file for them and the nightly sweep only looks at rows with no category
-- at all. Without this statement the fix would hold for new rows only, while
-- the Zelle payment that prompted it stayed an Account transfer counted as
-- no spending.
--
-- The two guards are the ranking in categorise(): a row the owner filed by
-- hand is never touched, and a manual rule outranks a built-in whatever its
-- priority, so a row one of those already claims is left where it is. The
-- normalisation is the SQL twin of normalise(); LIKE needs no escaping because
-- a stored pattern is normalised before it is written.
update finance.transaction t
   set category_id = (select id from finance.category where name = 'People'),
       classified_by = 'rule',
       confidence = 1
 where t.is_manual = false
   and t.category_id is distinct from (select id from finance.category where name = 'People')
   and (
     trim(regexp_replace(lower(t.descriptor), '[^a-z0-9]+', ' ', 'g')) like '%zelle%'
     or trim(regexp_replace(lower(t.descriptor), '[^a-z0-9]+', ' ', 'g')) like '%venmo%'
     or trim(regexp_replace(lower(t.descriptor), '[^a-z0-9]+', ' ', 'g')) like '%cash app%'
   )
   and not exists (
     select 1 from finance.category_rule r
      where r.is_manual
        and trim(regexp_replace(lower(t.descriptor), '[^a-z0-9]+', ' ', 'g')) like '%' || r.pattern || '%'
   );
