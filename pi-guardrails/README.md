# pi-guardrails

Pi extension enforcing two guardrails on tool calls.

## Rules

1. **Commit gate** (all processes, including subagents): `git commit` via `bash`/`powershell` is blocked until the `caveman-commit` SKILL.md has been read (via `read` or a shell command referencing it) in the session. Resets on `session_start`.
2. **Search gate** (main process only): search/investigation commands (`rg`, `grep`, `find`, `fd`, `findstr`, `ag`, `ack`, `tree`, `git grep`, `git ls-files`, `Select-String`, recursive `ls`/`dir`/`Get-ChildItem`) and built-in `grep`/`find`/`ls` tools are blocked; delegate to the `scout` subagent. Filters after a pipe (`git status | grep x`) are allowed.

## Environment variables

- `PI_OPEN_AGENTS_DEPTH` - `> 0` marks a subagent process (search gate disabled).
- `PI_GUARDRAILS_SEARCH` - `off` disables the search gate at startup.
- `PI_CAVEMAN_COMMIT_SKILL` - skill path shown in the block message (default `~/.agents/skills/caveman-commit/SKILL.md`).

## Command

- `/guardrails` or `/guardrails status` - show state.
- `/guardrails search off|on` - toggle the search gate.

## Install

Listed in `install.config.json` as `./pi-guardrails`; run the repo installer, then restart pi.

## Test

`npm test`
