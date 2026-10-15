-- Meals.
--
-- Macros are stored per recipe as made, not per serving. A recipe that serves
-- four and a plan that eats one of those servings are different numbers, and
-- keeping the per-serving figure would make scaling a lossy division done twice.

create schema if not exists meals;

grant usage on schema meals to authenticated, service_role, pos_readonly;
-- So meals.query keeps working as this module adds tables.
alter default privileges in schema meals grant select on tables to pos_readonly;

create table meals.recipe (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Where it came from. Empty for one you wrote yourself.
  source_url text not null default '',
  notes text not null default '',

  servings integer not null default 1 check (servings > 0),
  -- Minutes, start to plate.
  time_minutes integer not null default 0 check (time_minutes >= 0),
  -- Cents for the whole recipe, not per serving.
  cost_cents integer not null default 0 check (cost_cents >= 0),

  -- Per serving, which is the number a person reasons about when planning a
  -- meal. Whole grams and whole calories: a tenth of a gram of fat is a
  -- precision no recipe has.
  kcal integer not null default 0 check (kcal >= 0),
  protein_g integer not null default 0 check (protein_g >= 0),
  carbs_g integer not null default 0 check (carbs_g >= 0),
  fat_g integer not null default 0 check (fat_g >= 0),

  tags text[] not null default '{}',
  favourite boolean not null default false,

  -- An imported recipe waits to be accepted, the same shape as the Second
  -- Brain draft and the Travel booking inbox. A parser reading someone's
  -- markup is proposing, not deciding.
  status text not null default 'ready' check (status in ('draft', 'ready')),

  source text not null default 'manual'
    check (source in ('manual', 'agent', 'notion_import', 'demo')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create index recipe_status_idx on meals.recipe (status, name);

create table meals.ingredient (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references meals.recipe (id) on delete cascade,
  -- "Chicken thigh". The thing you buy.
  item text not null,
  -- "600 g". Free text on purpose: a recipe says "a splash" and "2 cloves",
  -- and a schema that insisted on a number and a unit would reject both.
  quantity text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ingredient_recipe_idx on meals.ingredient (recipe_id, position);

create table meals.step (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references meals.recipe (id) on delete cascade,
  instruction text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index step_recipe_idx on meals.step (recipe_id, position);

-- What is planned for a slot on a day.
create table meals.plan_entry (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid references meals.recipe (id) on delete set null,
  -- Free text for the times you ate something with no recipe. Null recipe_id
  -- plus a label is a real state, not a broken row.
  label text not null default '',

  on_date date not null,
  slot text not null check (slot in ('breakfast', 'lunch', 'dinner', 'snack')),
  servings numeric(4, 2) not null default 1 check (servings > 0),

  -- Ticked when it was actually eaten. A plan is not a log, and the difference
  -- is the only thing that makes either number worth reading.
  eaten boolean not null default false,

  source text not null default 'manual'
    check (source in ('manual', 'agent', 'notion_import', 'demo')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (source, external_id),
  -- One thing per slot per day. Two dinners is a data entry mistake, and a
  -- schema that allowed it would make every macro total wrong.
  unique (on_date, slot)
);

create index plan_date_idx on meals.plan_entry (on_date, slot);

do $$
declare
  t text;
begin
  foreach t in array array['recipe', 'ingredient', 'step', 'plan_entry']
  loop
    execute format(
      'create trigger set_updated_at before update on meals.%I
       for each row execute function core.set_updated_at()', t);

    execute format('alter table meals.%I enable row level security', t);

    execute format(
      'create policy owner_all on meals.%I for all to authenticated
       using (true) with check (true)', t);

    execute format(
      'create policy readonly_select on meals.%I for select to pos_readonly using (true)', t);

    execute format('grant select, insert, update, delete on meals.%I to authenticated', t);
    execute format('grant all on meals.%I to service_role', t);
    execute format('grant select on meals.%I to pos_readonly', t);
  end loop;
end;
$$;

-- Cooking is the work, and it is worth something to Life ops. Planning a meal
-- is not, or the week grid would pay better than the kitchen.
insert into skills.xp_weight (event_type, weight)
values ('meal_cooked', 6), ('recipe_added', 4), ('meal_planned', 0)
on conflict (event_type) do nothing;
