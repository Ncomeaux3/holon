# Is the Open-Meteo geocoding API fit for a single-user personal app with no key: terms for non-commercial use, any daily or per-second limit, required attribution wording, and the response shape?
Researched 2026-09-13

## Answer
Yes. Open-Meteo's geocoding API needs no key for non-commercial use, states explicit
free-tier rate limits well above what a single-user form will ever generate, and its
required attribution is one short line. It fits this use.

## What I confirmed
- No API key or sign-up is required for non-commercial use. (https://open-meteo.com/en/features, fetched 2026-09-13; https://open-meteo.com/en/docs/geocoding-api, fetched 2026-09-13)
- Free tier rate limits, stated on the pricing page: 10,000 calls per day, 5,000 per
  hour, 600 per minute. (https://open-meteo.com/en/pricing, fetched 2026-09-13)
- The terms page states the same daily/hourly/minute figures as the non-commercial
  free-tier limit and requires CC-BY 4.0 attribution to Open-Meteo for any use of the
  data. (https://open-meteo.com/en/terms, fetched 2026-09-13)
- A private, non-subscription, non-advertising personal app is explicitly listed as an
  example of non-commercial use; commercial use is defined as a product with
  subscriptions or ads, or the service resold/embedded in a commercial product.
  (https://open-meteo.com/en/terms, fetched 2026-09-13)
- The geocoding docs page states the required attribution wording for this specific
  endpoint: "Location data based on GeoNames". (https://open-meteo.com/en/docs/geocoding-api, fetched 2026-09-13)
- Response shape, confirmed both from the docs page and a live request (`curl
  'https://geocoding-api.open-meteo.com/v1/search?name=Portland&count=3&language=en'`,
  run 2026-09-13): a top-level `results` array of objects, each with `name`,
  `latitude`, `longitude`, `country`, and `admin1` (plus fields this app does not use:
  `id`, `elevation`, `country_code`, `admin2` through `admin4`, `timezone`,
  `population`, `postcodes`).
- A query under two characters returns no `results` key at all (confirmed live:
  `name=a` returned only `{"generationtime_ms":...}`); a two-character query returns
  matches (confirmed live: `name=au` returned a match named "Au").

## What I'm inferring
- "No uptime guarantee" (stated on the pricing page for the free tier) means an
  occasional failed request is expected behavior, not a bug; this is why the plan has
  `geocode()` swallow every error and return `[]` rather than surface it.
- The per-day and per-minute ceilings are far above anything one owner's form typing
  will produce, so no client-side rate limiting beyond the 300 ms debounce in 3.3 is
  needed.

## What I couldn't answer
- Whether the free tier's lack of an uptime guarantee has ever meant real outages, and
  how often: not stated on any page fetched, and not worth a support ticket for a
  single-user app that already treats every failure as "no suggestions this time."
- Whether an unauthenticated client is IP-rate-limited separately from the
  documented per-key limits: not stated; the terms page only says misuse can get an
  application or IP blocked without notice.

## Conflicts
- The terms page frames attribution as CC-BY 4.0 credit to Open-Meteo generally; the
  geocoding docs page gives the narrower, specific wording "Location data based on
  GeoNames" for this endpoint. Not a contradiction, just general policy versus the
  specific line for this API: the plan's wording in 3.3, "Location search by
  Open-Meteo and GeoNames", covers both by naming Open-Meteo and GeoNames.

## Sources
- https://open-meteo.com/en/docs/geocoding-api, fetched 2026-09-13
- https://open-meteo.com/en/terms, fetched 2026-09-13
- https://open-meteo.com/en/pricing, fetched 2026-09-13
- https://open-meteo.com/en/features, fetched 2026-09-13
- Live request: `curl 'https://geocoding-api.open-meteo.com/v1/search?name=Portland&count=3&language=en'`, run 2026-09-13
