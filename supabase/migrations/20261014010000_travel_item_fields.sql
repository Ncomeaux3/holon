-- An itinerary item gains what a day plan and a reservation need (v1.2 phase 10a).
--
-- kind 'other', for what is none of the five. status 'idea', for something
-- you might do that day: drawn on the day, never counted as planned spend.
-- status 'dismissed', for an emailed item the owner rejected or removed: kept
-- and never drawn, so the same email read the next night is known and not
-- written again.
-- place overrides the city the day is in; empty means the destination whose
-- dates cover the day, worked out on read, because the destinations are
-- deleted and written again on every trip save and a foreign key to one would
-- be nulled each time. provider and file_path make a reservation: who it is
-- with and the confirmation PDF or image in the module's private bucket.

alter table travel.itinerary_item drop constraint itinerary_item_kind_check;
alter table travel.itinerary_item add constraint itinerary_item_kind_check
  check (kind in ('flight', 'lodging', 'transit', 'activity', 'food', 'other'));

alter table travel.itinerary_item drop constraint itinerary_item_status_check;
alter table travel.itinerary_item add constraint itinerary_item_status_check
  check (status in ('idea', 'pending', 'confirmed', 'dismissed'));

alter table travel.itinerary_item
  add column place text not null default '',
  add column provider text not null default '',
  add column file_path text;
