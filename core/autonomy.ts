// The autonomy vocabulary, with no imports.
//
// core/tools.ts reaches pg, the module registry and through it every module's
// React pages, so a client component that imports the type from there drags the
// whole server graph into the browser bundle. It lives here instead, the same
// way the owner rule lives in core/owner.ts.

export type Autonomy = 'observe' | 'propose' | 'act'

export const AUTONOMY_LEVELS: Autonomy[] = ['observe', 'propose', 'act']

export const AUTONOMY_LABELS: Record<Autonomy, string> = {
  observe: 'Observe only',
  propose: 'Propose, I approve',
  act: 'Act, then tell me',
}
