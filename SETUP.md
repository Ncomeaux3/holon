# Transfer to Claude Code (VS Code)

## 1. Install
1. Node.js 18+ installed. Then `npm install -g @anthropic-ai/claude-code` (no sudo). Run `claude doctor` to confirm.
2. In VS Code, install the "Claude Code" extension from the marketplace. It uses the same install.
3. Install the GitHub CLI (`gh`) and log in. Claude Code uses it for commits and PRs.

## 2. Create the repo
Done on 2026-09-05 by the architecture session: `git init`, first commit, `gh repo create pos --private`.

## 3. Connect tools
Run inside the repo:
```
claude mcp add --transport http supabase https://mcp.supabase.com/mcp
claude mcp add --transport http vercel https://mcp.vercel.com
```
Each will prompt for auth in the browser. Run `/mcp` inside Claude Code to confirm they're connected. Account credentials for providers (Anthropic, Voyage, Resend, SimpleFIN, Strava) are not MCP connections: they are entered in the app on Settings > Connections once Phase 1 ships. Add Claude Code MCP connections only when a module needs them.

## 4. First session
Done on 2026-09-05. The interview produced docs/ARCHITECTURE.md, a decision log and the first phase plan (the log and the plans are kept in the private working repo; a fork writes its own under `decisions/` and `docs/plans/`). Next:
1. `/clear`, then in a fresh session: "Implement docs/plans/<phase>.md. Start with Step 0 research. Write tests first. Show test output when done."
2. `/review <phase>` before merging.

## 5. Per-module loop (repeat for each module in build order)
0. Export the matching Notion data (CSV or Markdown) into `imports/<module>/`. Gitignored.
1. `/research <vendor or library>` for any new dependency. Decide, log it.
2. `/module <name>` in plan mode. Approve the plan.
3. `/clear`. Implement the plan in a fresh session.
4. `/review <name>`. Fix gaps. Commit.
5. Run the module's Notion import against `imports/<module>/`. Compare row counts to Notion by hand.
6. Update modules/<name>/README.md with status and connections.md if a system was added. Retire that section of Notion.

## 6. Habits that matter
- `/clear` between unrelated tasks. After two failed corrections on the same thing, `/clear` and rewrite the prompt.
- Keep CLAUDE.md under roughly 60 lines. If Claude ignores a rule, the file is too long; cut, or turn the rule into a hook. Run `/doctor` occasionally and take the cuts it proposes.
- Use `/btw` for side questions so they don't enter context.
- Name sessions with `/rename` per module (`finance`, `skill-tree`).
- Commit before any risky change. Checkpoints are not git.

## 7. Cadence (do last, after modules work manually)
Scheduled runs use `claude -p` (non-interactive). Example daily digest, from cron or n8n:
```
claude -p "/digest" --permission-mode auto --allowedTools "mcp__supabase__*,Read"
```
Only automate a workflow after it has worked by hand at least three times.

## What's in this workspace
- `CLAUDE.md`: rules loaded every session. Short on purpose.
- `docs/SPEC.md`: full module spec, loaded on demand.
- `docs/DECISIONS.md`, `docs/plans/` and `decisions/log.md`: open choices, approved plans and the append-only decision log. Kept in the private working repo, not in this one; a fork starts its own.
- `connections.md`: every external system, its purpose, its status.
- `.claude/settings.json`: permission allowlist and hooks.
- `.claude/hooks/`: blocks edits to shipped migrations; flags em dashes.
- `docs/ARCHITECTURE.md`: how it is built, the module and integration contracts, platform concerns.
- `.claude/skills/`: `/module`, `/integration`, `/digest`, `/review`, `/research`.
- `.claude/agents/`: `reviewer` (read-only adversarial), `researcher` (keeps exploration out of main context).
