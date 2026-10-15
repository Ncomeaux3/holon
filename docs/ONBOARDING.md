# First run

Six steps. Screen 02 of the design bundle.

## There is no submit

Every step writes as you touch it. The wizard is a guided tour of settings that
already exist, so leaving halfway leaves a half configured app rather than
nothing, and coming back resumes because **the settings are the state**. There
is no draft table, no partial record, and nothing to reconcile.

The step is in the URL, so a refresh keeps your place.

The one exception is the goals, which are written on Finish. Picking one is a
plan, not a decision, and changing your mind before the last step should cost
nothing.

## The connector catalogue

`config/connectors.yaml`, committed, edited by a fork. It is the one place that
knows what a person might plausibly want to connect, and it is deliberately
aspirational: it lists banks and airlines this build cannot speak to.

That is only honest because of what happens when you pick one.

A provider with a matching integration manifest is starred and can really sync,
after being authorised at Settings, because a wizard is no place to handle a
secret. **Everything else is written to `core.connections` with
`status = 'requested'`** and shows up in a Requested section on Settings,
Connections, labelled "no integration".

`credentials_encrypted` is empty for those rows, because there are none. Giving
a request a fake secret to satisfy a NOT NULL would be exactly the quiet lie the
rest of this codebase spends comments avoiding. Nothing can mistake it for a
connection either: `core/modules.ts` asks for `status = 'connected'` by name.

The catalogue is filtered to installed modules, so a fork without Travel is
never offered airline loyalty.

## Starter goals

Three, and each names the metric it would like. Whether that metric exists is
decided at render against `core/metrics.ts`.

A goal whose metric is not installed is created for hand check-ins rather than
pointed at a key that would never resolve. A goal sitting at zero forever
because it references a module you deleted looks broken, and looking broken on
day one is how a tool gets abandoned.

## Modules

The toggle writes `modules_enabled`, which is **visibility only**. A module
turned off keeps its data, its tools, its jobs and its direct URL; it just stops
taking up room in the nav. The step says so, because a switch next to the word
"Finance" looks destructive and is not.

## Settings it may write

`saveSetting` filters against a fixed list. A server action is a public POST
endpoint and its type parameter is erased at runtime, so without that list the
wizard would be a general purpose write to any setting, including the model
spend cap and the agent autonomy level.
