# Agent task list

A small, tool-agnostic protocol so agents work a to-do list and only pull a human in when needed.
It follows the pattern in [“I ran 43 Claude Code agents at once…”](https://www.reddit.com/r/ClaudeAI/comments/1xc2hn1/) and works with a task-runner such as [Debo](https://getdebo.com) or plain GitHub issues. We have not verified any Debo-specific import format; nothing here depends on it.

## A task is the conversation

- **Title** — what the human wants.
- **Description** — the context (links, constraints, definition of done).
- **Comments** — where the agent and the human talk. The agent records decisions, blockers and results here.

## States

`todo` → `in progress` → `needs-human` → `in progress` → `done`

A task goes to **needs-human** only for: a decision, a credential/secret, an approval for anything outward-facing (merge, close, post, delete, spend), or something the agent cannot verify. Put the *question* in the comment, with a recommended default, so it can be answered in one line.

## Roles (`.claude/agents/`)

| Agent | Job |
| --- | --- |
| `dispatcher` | Owns the one queue; orders and assigns; prevents file overlap |
| `lead-builder` | Implements one task end to end → draft PR |
| `context-scout` | Read-only context brief so work isn't re-derived |
| `parity-guard` | Web ↔ iOS parity and theme-token sync |
| `ui-reviewer` | Screenshot review, light/dark, desktop/phone |
| `watcher` | Spots stuck PRs/CI/data/tasks; escalates only real problems |

The scheduled pipeline agents (`agent:*`, see `README-AGENTS.md`) keep running on their own; `watcher` reads their output rather than replacing them.

## Rules

- One builder per set of files. Branch from fresh `origin/main`; open **draft** PRs.
- Never hand-edit generated data. Never try to defeat anti-bot controls — report BLOCKED.
- Say what you could not verify (e.g. Swift is not compilable in the Linux sandbox).
