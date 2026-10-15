---
name: digest
description: Run the orchestrator manually. Reads every module digest and compiles the dashboard summary.
disable-model-invocation: true
---
1. Call get_digest on every module that has one (check modules/*/README.md for status).
2. Compile: top 3 things needing attention today, upcoming charges and renewals in 14 days, goals at risk, skills stagnant 60+ days.
3. Write to core.dashboard_summary. Propose tasks as review-state only. Never create active tasks.
4. Print the summary. Keep it under 200 words.
