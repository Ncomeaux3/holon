---
name: module
description: Load the spec for one POS module and plan or build it. Use when working on a specific module (finance, skill-tree, tasks, goals, insurance, second-brain, ideas, fitness, meals, travel, orchestrator).
---
Work on POS module: $ARGUMENTS

1. Read only that module's section in docs/SPEC.md plus the "Core architecture principles" and "Shared core schema" sections.
2. If docs/DECISIONS.md exists, check it. If any unresolved decision affects this module, ask before continuing.
3. Check modules/$ARGUMENTS/README.md for current state. If missing, this module has not started.
4. Read docs/ARCHITECTURE.md sections "Module contract" and "Conventions". In plan mode, propose: migrations (supabase/migrations/<ts>_$ARGUMENTS_*.sql, one grant to pos_readonly), manifest.ts (id, nav, pages, tools, guarded, requires, jobs, entityTypes), tools (get_digest, write, plus module-specific; query comes from core), jobs, UI pages, import/notion.ts, seed.ts, and the tests that prove it works. Write the plan to docs/plans/$ARGUMENTS.md.
5. Stop and wait for approval. Do not scaffold in the same session.
