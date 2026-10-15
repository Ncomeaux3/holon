import type { ComponentType } from 'react'
import type { z } from 'zod'

// The module contract: the types and the two identity functions a manifest
// calls. No imports beyond types, on purpose.
//
// A manifest imports defineModule from here, and the registry in core/modules.ts
// imports the manifests through modules/_index.ts. Keeping the contract in its
// own leaf module is what stops that being a cycle. It was one until 2026-09-08:
// Next's bundler hoisted around it, and plain Node did not, so the registry
// could not be loaded by the cron job, a script, or a test outside Next.
// See docs/ARCHITECTURE.md "Module contract".

export type ToolContext = {
  /** 'ui' for the owner's own writes, 'agent' for MCP and the orchestrator. */
  source: 'ui' | 'agent'
}

/**
 * As stored in the registry: input is erased, because a Record cannot hold
 * tools with different schemas and stay type safe. Authors use defineTool(),
 * which keeps the types at the definition site.
 */
export type ModuleTool = {
  description: string
  input: z.ZodTypeAny
  run: (input: unknown, ctx: ToolContext) => Promise<unknown>
}

/**
 * Pins the input type inside run() from the zod schema, and parses on the way
 * in so every caller (UI, MCP, orchestrator) gets validation for free.
 */
export function defineTool<I extends z.ZodTypeAny>(tool: {
  description: string
  input: I
  run: (input: z.infer<I>, ctx: ToolContext) => Promise<unknown>
}): ModuleTool {
  return {
    description: tool.description,
    input: tool.input,
    run: (raw, ctx) => tool.run(tool.input.parse(raw), ctx),
  }
}

export type ModuleJob = {
  name: string
  run: () => Promise<unknown>
}

/**
 * One dated thing a module shows on the Calendar.
 *
 * `startsAt` is YYYY-MM-DD for an all-day item and YYYY-MM-DDTHH:MM in the
 * owner's zone for a timed one; the day is always its first ten characters.
 */
export type CalendarItem = {
  /** Unique within the module for the range; a projected repeat adds its date. */
  id: string
  module: string
  title: string
  /** One grey line under the title: a location, an amount. */
  meta?: string
  startsAt: string
  endsAt?: string
  allDay: boolean
  href: string
  /** What sort of row it is inside its module: 'task', 'trip', 'charge'. */
  kind: string
  /** Already happened: a done task, a logged workout. Drawn muted. */
  done?: boolean
  /** Walked forward from a cadence, not a stored row. Drawn muted. */
  projected?: boolean
  entityRef?: string
}

/** One row another module keeps about an entity: a task on a goal. */
export type LinkedItem = { title: string; meta: string; done: boolean; href?: string }

export type ModuleManifest = {
  /** Postgres schema name and URL segment. Lowercase identifier. */
  id: string
  nav: { label: string; icon?: string; order: number }
  /** Keyed by path under /<id>/. '' is the index page, no leading slash. */
  pages: Record<string, ComponentType>
  /** core adds query and search; every module supplies at least get_digest. */
  tools: Record<string, ModuleTool>
  /** Called by an agent, these land in core.proposals instead of the table. */
  guarded?: string[]
  /** Integration ids that must be connected before the pages are useful. */
  requires?: string[]
  jobs?: ModuleJob[]
  entityTypes?: string[]
  searchText?: (row: Record<string, unknown>) => string
  /**
   * Payloads pushed at this module, keyed by the integration id that sends
   * them. The webhook route calls this after the integration manifest's own
   * zod schema has accepted the body, so the payload is shaped but untyped.
   *
   * A pull has a job to run through; a push has nothing until it arrives, and
   * this is where it goes. The integration owns the translation of its own
   * format and the module owns the write, the same split as a sync job. Core
   * names neither: a route matches ids, nothing more.
   */
  inbound?: Record<string, (payload: unknown) => Promise<void>>
  /**
   * Links an entity to skills. Core calls this from register() for every row
   * every module creates, so at most one module may provide it. No module
   * providing one means no classification, and nothing else changes: this is
   * what lets `rm -r modules/skills` leave a working app.
   */
  classifier?: (entityRef: string, text: string, module: string) => Promise<void>
  /**
   * Skill id to display name, for a module that shows the links the classifier
   * wrote. Same hole as `classifier`: core.skill_links holds ids, only the
   * module that owns the tree knows the names, and no module reads another's
   * files. Absent, links show their ids.
   */
  skillNames?: () => Promise<Record<string, string>>
  /**
   * Rows of this module that point at a registry entity, for the screen that
   * owns the entity to list. Tasks answers with the tasks on a goal. Core
   * concatenates every provider; no module reads another's schema.
   */
  linked?: (entityRef: string) => Promise<LinkedItem[]>
  /**
   * Money this module holds against registry entities: Finance answers with
   * the transactions tagged to a trip, or charged to an account, between two
   * days when a range is given. Keyed by entity ref; a ref with nothing is
   * absent. Travel reads trip spend this way and no finance table.
   */
  spend?: (
    entityRefs: string[],
    range?: { from: string; to: string },
  ) => Promise<Record<string, { cents: number; count: number }>>
  /**
   * Numbers this module will compute on request, for a goal to track.
   *
   * This is the whole cross-module read mechanism for a live value, and it
   * exists so Goals never parses a string like `finance.net_worth latest` and
   * never issues SQL against another module's schema. Goals enumerates what is
   * registered and stores the key it was given; deleting the module makes the
   * key stop resolving, and the goal falls back to manual check-ins rather than
   * erroring.
   */
  metrics?: Record<string, { label: string; unit: string; get: () => Promise<number> }>
  /**
   * This module's dated rows between two days, inclusive, both YYYY-MM-DD.
   * The Calendar asks every module and draws what comes back; it reads no
   * module schema, the same split as `review` and `linked`.
   */
  calendar?: (range: { from: string; to: string }) => Promise<CalendarItem[]>
  /**
   * The URL that opens this module's drawer for one of its registry entities,
   * so the Skill Tree can link an event to what earned it. Absent, or null for
   * a type with no drawer, means the module's page.
   */
  entityHref?: (entityType: string, entityId: string) => string | null

  /**
   * The module's own dashboard tile, rendered from its own digest payload.
   *
   * The same seam as `metrics` and `review`, and for the same reason. The
   * dashboard used to lay out every digest generically, by walking the payload
   * object and printing its keys, which is how "debt cents 231000" ended up on
   * screen: a database field name and an unformatted integer, in front of the
   * owner, every morning.
   *
   * Core cannot format that itself without knowing what a finance payload
   * contains, which is exactly the coupling the architecture forbids. So the
   * module says how its own numbers read, and core only places the result.
   * A module with no tile falls back to the generic list, so this stays
   * optional and a fork that deletes a module loses only that module's tile.
   */
  tile?: ComponentType<{ payload: Record<string, unknown> }>
  /**
   * The tile's head, when the module has something to say there: a label
   * other than its name ("Tasks · today") and the short line on the right
   * ("2 budgets flagged", "0 of 4 done"), both read off its own digest. Core
   * draws the name and nothing on the right when this is absent.
   */
  tileHead?: (payload: Record<string, unknown>) => { label?: string; meta?: string }
  /**
   * What this module contributes to the Weekly Review.
   *
   * The review is a core screen and core does not read module schemas, so a
   * module hands over its own rows rather than being queried for them. Every
   * part is optional and a module that supplies none simply does not appear:
   * a fork with no Tasks gets a review with a glance and a note, which still
   * closes.
   */
  review?: {
    /** Went well this week, offered for the owner to tick. */
    wins?: () => Promise<ReviewWin[]>
    /** Slipped this week and needs a decision: carry, shrink or drop. */
    slipped?: () => Promise<ReviewItem[]>
    /** Could be next week. Feeds the three priorities. */
    upcoming?: () => Promise<ReviewItem[]>
    /** Needs a number from the owner before the week closes. */
    pending?: () => Promise<ReviewCheck[]>
    /** Called on close, with what the owner decided about this module's items. */
    apply?: (decisions: ReviewDecisions) => Promise<void>
  }
}

/** One thing on the review's misses or backlog list. */
export type ReviewItem = {
  id: string
  title: string
  /** One grey line under it: where it came from, how late it is. */
  meta: string
  estimateMinutes?: number | null
  /**
   * The day it falls on, as YYYY-MM-DD, when it has one.
   *
   * This is what puts an item on the dashboard's week ahead. A module that
   * dates its upcoming items appears on the strip; one that does not still
   * contributes to the review's backlog, which has no dates in it.
   */
  at?: string | null
  /** Where the dashboard's week ahead sends you: the item's own drawer, not the module root. */
  href?: string
}

/**
 * Something that went well, proposed rather than asserted.
 *
 * A module offers what it can measure; whether it counts as a win is the
 * owner's call, which is why these arrive ticked by nobody.
 */
export type ReviewWin = {
  id: string
  title: string
  /** One grey line under it: the module, the count, the time it took. */
  meta: string
  /** A short mark on the right: "biggest", "new skill", "streak 3w". */
  tag?: string
}

/** Something the owner has to put a number on before the week closes. */
export type ReviewCheck = {
  id: string
  title: string
  unit: string
  /** True when the module computes it and no input is needed. */
  computed: boolean
  /** Where the number comes from: "Fitness, best 5K in 30 days". */
  source?: string
  /** 0 to 100. Absent when the module tracks no target. */
  percent?: number
  /** Points moved since last week, or null when there is nothing to compare. */
  movement?: number | null
  /** The module's own reading of whether it will make it. */
  status?: ReviewStatus
  /** One line saying why it has that status. Never a bare label. */
  note?: string
}

export type ReviewStatus = 'done' | 'on_track' | 'at_risk' | 'stalled'

/** What the owner decided, handed back to the module that owns the rows. */
export type ReviewDecisions = {
  /** Item ids to carry, with the date they move to. */
  carry: string[]
  carryTo: string
  /** Item ids to drop. */
  drop: string[]
  /** Check id to the value entered. */
  values: Record<string, number>
}

/** Identity, but it pins the manifest type at the definition site. */
export function defineModule(manifest: ModuleManifest): ModuleManifest {
  return manifest
}
