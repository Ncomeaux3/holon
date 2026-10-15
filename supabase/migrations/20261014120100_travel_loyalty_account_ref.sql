-- A loyalty program names the card account that earns it (v1.2 phase 10b),
-- through the registry, so Travel reads no finance table. The balance stays
-- typed by hand.

alter table travel.loyalty_program
  add column account_ref uuid references core.entities (id) on delete set null;
