---
name: review
description: Adversarial review of the current diff against its plan, in a fresh subagent.
disable-model-invocation: true
---
Use the reviewer subagent to check the current diff against docs/plans/$ARGUMENTS.md. Report only gaps that affect correctness, the stated requirements, or the rules in CLAUDE.md (secrets, is_manual, rules-first classification). Ignore style.
