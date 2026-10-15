-- Meals, v1.2 Phase 12: a recipe typed by hand with USDA matches, and a
-- recipe pasted as text.
--
-- An ingredient matched to a USDA FoodData Central food keeps the food's id,
-- the grams the recipe uses, and the macros for that amount. The recipe's own
-- per-serving columns stay what the week reads; the form fills them from the
-- matched ingredients and the owner can still overwrite them.

alter table meals.ingredient
  add column fdc_id integer,
  add column grams numeric check (grams > 0),
  -- For `grams` of this food, not per 100 g and not per serving. Null when
  -- the ingredient has no match, which is not the same as zero.
  add column kcal numeric check (kcal >= 0),
  add column protein_g numeric check (protein_g >= 0),
  add column carbs_g numeric check (carbs_g >= 0),
  add column fat_g numeric check (fat_g >= 0);

-- A pasted recipe is read by rules first and by the model only for what the
-- rules could not place. Null on a recipe nothing classified (typed, imported
-- from JSON-LD).
alter table meals.recipe
  add column classified_by text check (classified_by in ('rule', 'model')),
  add column confidence numeric(3, 2) check (confidence between 0 and 1);
