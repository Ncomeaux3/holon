# Meals

A week of slots, what each comes to, and the list to shop from. Screen 14 of the
design bundle.

## A plan is not a log

`plan_entry.eaten` is the whole distinction, and it is why `total()` takes an
`eatenOnly` flag rather than being two functions: they are different questions
asked of the same rows, and the screen shows both side by side.

Conflating them makes both useless. A week that is fully planned and half eaten
is a normal week, and a screen that could not tell you which was which would be
reporting an intention as a fact.

## Nothing is guessed

A meal eaten with no recipe behind it contributes **zero** macros, and the count
of those is shown. That is what makes a low total visibly incomplete rather than
quietly wrong.

The calorie target comes from Fitness through the metric registry, not from a
number stored here, and it is labelled an estimate wherever it appears: fifteen
calories a pound of body weight is a rule of thumb, not a prescription. When
Fitness is not installed there is no target rather than an invented one.

Nothing in this module offers a nutritional opinion.

## The grocery list does not add up

The list is grouped by recipe, and every quantity is as the recipe wrote it.
`600 g` and `3 cloves` and `a splash` do not add, and a list that tried would
either refuse the recipe or invent a number by silently dropping a unit. A
recipe planned three times says so in its group head and, when it serves one,
beside each quantity; a batch recipe that serves six is cooked once.

`ingredient.quantity` is free text for the same reason: recipes say "a splash"
and "2 cloves", and a schema insisting on a number and a unit would reject both.

## A recipe can be typed

New recipe on the Recipes tab, and Edit in the recipe drawer, are one form over
`write_recipe`. A typed recipe is saved `ready` with `source = 'manual'`; it is
not a draft, because nobody but the owner proposed it. Editing a draft keeps it
a draft until it is accepted.

Macros beside an ingredient searches USDA FoodData Central (see
docs/SETUP-INTEGRATIONS.md) through `GET /api/meals/foods`, a route rather
than a server action so a slow USDA call never holds Save. A match stores
`fdc_id`, `grams` and the macros for those grams on the ingredient row. The
per-serving fields follow the sum of the matched ingredients divided by
servings until the owner types in one, and the form says "from N of M
ingredients", because an unmatched ingredient counts as nothing and a total
that hid that would be quietly low. The recipe's own per-serving columns stay
what the week reads.

## A recipe can be pasted

Paste on the Recipes tab sends text to `parse_recipe_text`. Rules read it
first (`text-recipe.ts`): the first line is the name, a line starting with a
number and a unit is an ingredient, a numbered line is a step, and every line
under an Ingredients or Method heading is one of those. When the rules find
both ingredients and steps no model is called. Otherwise one Haiku call reads
the whole text under the capped `recipe` purpose. Over the cap, or with no
Anthropic key, the draft is the rules' reading and its notes say why.

The draft carries `classified_by` (`rule` or `model`) and `confidence`, shown
as a chip in the drawer. Instagram links are not fetched (the post is behind a
login); the form asks for the caption instead. `parse_recipe_text` is the one
guarded tool here, because it is the one that can spend money.

## A recipe comes in from a page's JSON-LD, and waits

`import_recipe` reads the schema.org `Recipe` block out of a page's source and
files it as a `draft`: name, ingredients split into a quantity and the thing
you buy, steps, yield, time, and per-serving nutrition when the page has it.
No model reads the page. A page with no Recipe block is refused rather than
guessed at; the Python scrapers that read other formats cannot run in the
Vercel Node runtime, so there is no fallback.

A failed import says why under the URL box, with Paste it instead beside it:
no JSON-LD, blocked (a 4xx or 5xx answer, or a refused address), timeout, or
parse error. Each failure is also written to `core.request_log` through
`recordError('meals/import_recipe', ...)`, so the Errors tab lists it under
Meals for 90 days with its URL. That is where parser gaps are found; no table
of attempts is kept. Strings in the JSON-LD are HTML-decoded (`1 &frac12;
cups` reads `1 ½ cups`).

The tool fetches the page through `core/fetching.ts`, the same checked fetch
Second Brain uses, so a pasted URL cannot reach a private address. An agent
that already has the page source can pass it as `html` and skip the fetch.

## Suggest week is a rule, not a model

`fill_week` puts a recipe in every empty slot between two dates: one tagged
for that slot, favourites first, rotating by day so a week is not seven of the
same breakfast. A slot with nothing tagged for it stays empty. Nothing already
planned is touched.

## Macros are per serving

Stored per serving, because that is the number a person reasons about when
planning a meal, and scaled by `plan_entry.servings` at read time. Whole grams
and whole calories: a tenth of a gram of fat is a precision no recipe has.

`recipe.cost_cents` is for the whole recipe, not per serving, and is named so.

## One thing per slot per day

Enforced by constraint. Two dinners on one day is a data entry mistake, and a
schema that allowed it would make every macro total wrong without anything
looking broken.

## One tool is guarded

`parse_recipe_text`, because it can spend money. An imported recipe already
lands as a `draft` and waits in the inbox, which is this module's version of
the gate. Planning a meal is reversible by planning a different one.

## Cook mode scales what can be scaled

One step at a time in 30px type, the ingredients beside it, and the screen
kept awake, because a phone that sleeps between step four and step five is why
a paper recipe still beats a screen.

Quantities scale by the servings you pick, and only the leading number moves.
"2 x 180 g" doubled is "4 x 180 g": the 180 is the size of the fillet, not a
count, and scaling both would turn two fillets into four twice as large.

A quantity with no number comes back exactly as written and the screen names
it. Half a splash is not a measurement, and inventing one would be worse than
leaving the cook to judge it. That is the same stance the grocery list takes
about adding grams to cloves.

The step and the servings are in the URL, so a reload in a kitchen does not
lose your place.
