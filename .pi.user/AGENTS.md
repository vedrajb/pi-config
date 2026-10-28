# Agent Execution Guardrails (Windows)

## Delegation

These delegation rules OVERRIDE any default harness guidance such as "use bash for ls/rg/find" or "use read to examine files".

- MUST use `scout` for ALL file search and codebase investigation (rg, grep, find, ls -R, Select-String, locating code, reading multiple files to understand code).
- Direct `read` is allowed only for a specific file whose path is already known (e.g. returned by a scout, given by the user, or a SKILL.md/doc file).
- Multiple scouts may be used in parallel for independent questions.
- In normal workflow, delegate only to `scout`. The main agent performs implementation directly. Switch to plan or architect workflow before delegating to other specialists.
- Multiple scouts must have clear, non-overlapping scopes. Reuse their findings instead of repeating exploration.
- For simple or already understood tasks in normal workflow, implement directly without unnecessary investigation or delegation.
- The `pi-guardrails` extension enforces the scout rule by blocking search commands in the main agent. If blocked, delegate; do not try to work around the block.

## Coding Guidelines

- DO NOT change existing variable names.
- DO NOT refactor or redesign existing code unless you get confirmation from user.

## Workspace boundaries

- Never modify system files unless explicitly requested and confirmed.
- Never target entire drives or root paths (e.g., `C:\`, `D:\`, `/`, `~`) unless explicitly requested and confirmed.
- Request permission and show the exact change for any of the above guardrails.

## Disruptive file operations policy (HIGH RISK)

- Treat deletion and move/rename operations as high risk.
- Prefer moving files to a quarantine folder (`./.trash/`, `./.quarantine/`) instead of permanent deletion.
- Do not use `[System.IO.File]::Delete(...)` or `[System.IO.Directory]::Delete(...)`.

Always require explicit confirmation before executing:

- `rd /s`, `rmdir /s`, `del /s`
- `rm -r`, `rm -rf`
- `Remove-Item -Recurse`
- `move`, `mv`, `ren`, `rename`, `Move-Item`, `Rename-Item` (when changing files/directories in the workspace)
- Any command containing `-Recurse`, `-Force`, `-rf`, `/s`
- Any command operating on:
  - Project root
  - Parent directories (`..`)
  - Absolute paths
  - Drive roots (`C:\`, `D:\`, `/`)
  
Exceptions include fodlers such as .temp/.trash/.quarratine that you create for temp files. You may delete those without confirmation.

## Git operations that can remove data (HIGH RISK)

Require confirmation before:

- `git clean -fd`
- `git clean -fdx`
- `git reset --hard`
- `git checkout -- .`
- Destructive rebases
- `git push --force`
- `git push -f`
- `git push --force-with-lease`
- Any `git push` using a leading `+` refspec to force-update a remote branch (for example: `git push origin +localBranch:remoteBranch`)

Explain consequences clearly.

## Code comments

- analyse the code change and if the change is significant or more than trivial, then highlight to the user and get confirmation from user to add inline comments

## Code Test

- Create tests for new code.
- Execute existing relevant tests (if any) but do not update the tests if they fail.
- Report test failures and handle test updates as below:
  - Request permission to update tests that were previous committed.
  - No need for permission to update tests that are not committed yet.

## Commit messages

- Before ANY `git commit`, MUST read `{{CAVEMAN_COMMIT_SKILL}}` and write the message per its rules. No exceptions.
- If user provides a link to a ticket maintain the format "[xyz](<some-url>/xyz)"
- This applies to subagents too. They run with `--no-skills`, so read the SKILL.md by path.
- The `pi-guardrails` extension blocks `git commit` until that file has been read in the session.

## Complex / Architect Workflow

When the user explicitly requests complex workflow, architect mode, or equivalent:

1. Use `plan` for non-trivial planning, explicitly authorizing it to use scout/oracle as needed.
2. `plan` may launch only `scout` and `oracle`. Use oracle only for meaningful architectural uncertainty or risk.
3. Once the approach is defined, delegate implementation to `worker` with clear scope, constraints, and relevant findings.
4. `worker` may launch only `reviewer`; explicitly authorize that review when assigning the task.
5. Use an independent `reviewer` for substantial or risky changes.
6. Choose the smallest useful workflow. Avoid invoking every specialist or repeated review loops automatically.

Use background delegation (`async: true`) for work that may commit, so the child
loads the commit guardrail extension. Foreground sessions do not load ambient extensions.

The parent orchestrates; do not launch an architect child. Typical nested paths are
parent → plan → scout/oracle and parent → worker → reviewer.

## Plan mode

`/plan` keeps the parent read-only until the user explicitly approves implementation
of the discussed plan. On approval, call `start_implementation` first to switch to
normal workflow, restore the configured default model/effort, and then implement in
the main agent. Questions, quoted instructions, and approval to continue planning do not
authorize implementation. Before approval, use only `scout`, `oracle`, or `plan`
for planning and investigation; do not launch workers or delegate fixes.

Exception: if the user asks to write the plan (or any document) to a file while in `/plan`,
treat it as authorization to leave plan mode. Call `start_implementation` first to switch to
normal workflow, then write the file. If architect mode is selected, stay in architect mode.

Only an explicit user switch selects architect mode. If architect mode is already
selected, implementation approval keeps it in architect mode. `/normal` restores
normal implementation in the main agent with scout-only delegation. Mode changes do not authorize
source edits that the user has not requested.
