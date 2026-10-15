# Insurance and policies

What is covered, what it costs, and when it runs out. Screen 19 of the design
bundle.

## It records, it does not judge

Deductible, coverage limits, agent and documents are discrete columns per the
2026-09-07 decision that amended SPEC section 8. They are facts copied off a
declarations page, not judgements.

SPEC's real rule is the one this module is built to and it is unchanged: nothing
here analyses them. No gap analysis, no adequacy scoring, no model opinion about
whether cover is enough. `limits` is free text in the words on the page, because
"100/300/100" and "$1,500 annual max" are not the same kind of thing and a
schema that tried to hold both would have to invent a meaning for one of them.
The screen says as much where a reader might expect a verdict.

## The number is encrypted and stays that way

`policy_number_encrypted` goes through core/crypto like every credential. The
list query decrypts only far enough to take the last four characters, and the
plaintext is never on the row it returns.

Reading the whole number is its own server action with an id behind it, so it
happens because the owner asked, once, and lives in one piece of component state
until they press Hide. A field that rode along in the list payload would put
every policy number in the page source of every screen that renders the list.

## Null is not zero

`deductible_cents` is nullable, and term life in the demo has none. A policy
with no deductible and a policy with a deductible of nothing are different
claims, and a NOT NULL DEFAULT 0 would have made them the same one.

The same reasoning runs through the module: no expiry date on file is its own
status rather than "active", because nobody has written the date down and the
screen has no evidence either way.

## Renewal keeps the row

Mark renewed moves `expires_on` on the same policy rather than creating a new
one, so a policy's history stays in one place and the documents attached to it
stay attached. Six month policies renew to six months on, everything else to a
year, and the button says which date it is offering: it is an offer, and the
owner types the real one when the carrier says different.

Reminders are an array of lead days, default 60, 30 and 7. The nightly job
queues one notification per lead that lands today, and queues nothing for a
policy that has already expired: the row on the screen is the message by then.

## The PDF is read by the model, not a parser

Dropping a declarations page sends the PDF to Anthropic as a document block
with the owner's own key. No local PDF library, no new dependency, and the
screen says plainly where the file goes before it goes there.

Nothing lands in `insurance.policy` until the owner presses Create. Every field
comes back with a confidence, a field the page did not clearly say comes back
empty at zero rather than guessed, and what gets stored is what is in the form
after editing, not what the model read. Discard removes the stored file.

## Posting to Finance

`postPremium(id, ctx)` in `post.ts` runs after `write_policy` and
`renew_policy`; `delete_policy` calls `unpostPremium` before the policy row
goes. It sends the pure `premiumPost()` payload from `premium.ts` to
`finance.write_recurring`, or calls `finance.delete_recurring`, through
`callTool` only, with the caller's source carried through. A policy posts only
when `inFinance()` holds: `post_to_finance` is on, it is active, its expiry is
today or later and the premium is above 0. The drawer chip and the list's
"in Finance" count read the same test. Annual becomes Finance's `yearly`.
Finance moves the next charge date on nightly; the nightly `remind` job only
removes the premium of a policy whose expiry has passed.

## Everything that writes a policy is guarded

`write_policy` and `renew_policy` both. Cover is money and a commitment, and a
wrong expiry date is the kind of mistake nobody notices until a claim. An agent
proposing either lands in the Review inbox with the diff on it.
