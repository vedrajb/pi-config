# pi-guardrails

Pi extension enforcing three guardrails on tool calls.

## Rules

1. **Commit gate** (all processes, including subagents): `git commit` via `bash`/`powershell` is blocked until the `caveman-commit` SKILL.md has been read (via `read` or a shell command referencing it) in the session. Resets on `session_start`.
2. **Search gate** (main process only): search/investigation commands (`rg`, `grep`, `find`, `fd`, `findstr`, `ag`, `ack`, `tree`, `git grep`, `git ls-files`, `Select-String`, recursive `ls`/`dir`/`Get-ChildItem`) and built-in `grep`/`find`/`ls` tools are blocked; delegate to the `scout` subagent. Filters after a pipe (`git status | grep x`) are allowed.
3. **Normal delegation gate** (main process only): only `scout` launches are allowed in normal workflow, including scout-only legacy batches. The parent implements directly. Non-scout launches, executable workflow scripts, and resume/steer actions are blocked; use direct scout calls for parallel investigations or switch to `/plan` or `/architect` for specialist workflows. Listing, status, guide, and stop controls remain available. The gate reads the latest workflow entry on the current session branch; fresh sessions default to normal. Turning search protection off does not disable this rule. Child processes retain their own role allowlists.

## Environment variables

- `PI_SUBAGENT_CHILD` - `1` marks a pi-subagents background child process (search gate disabled).
- `PI_GUARDRAILS_SEARCH` - `off` disables the search gate at startup.
- `PI_CAVEMAN_COMMIT_SKILL` - skill path shown in the block message (default `~/.agents/skills/caveman-commit/SKILL.md`).

## Command

- `/guardrails` or `/guardrails status` - show state.
- `/guardrails search off|on` - toggle the search gate.

## Install

Listed in `install.config.json` as `./pi-guardrails`; run the repo installer, then restart pi.

## Test

`npm test`

Background children load ambient extensions, including these guardrails. Foreground
pi-subagents sessions run in the parent process and do not load ambient extensions;
the process marker does not identify them. Use background delegation when the commit
gate must be enforced in a child. Never set a process-wide marker for foreground work.
