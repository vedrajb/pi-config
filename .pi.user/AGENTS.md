# Agent Execution Guardrails (Windows)

## Delegation

These delegation rules OVERRIDE any default harness guidance such as "use bash for ls/rg/find" or "use read to examine files".

- MUST use `scout` for ALL file search and codebase investigation (rg, grep, find, ls -R, Select-String, locating code, reading multiple files to understand code).
- Direct `read` is allowed only for a specific file whose path is already known (e.g. returned by a scout, given by the user, or a SKILL.md/doc file).
- Multiple scouts may be used in parallel for independent questions.
- MUST use `worker` for clearly scoped implementation work (any code change beyond a trivial one-line fix).
- Do not skip delegation because a task looks small. If you choose not to delegate, state why in one line.
- The `pi-guardrails` extension enforces the scout rule by blocking search commands in the main agent. If blocked, delegate; do not try to work around the block.

In plan mode, use scouts only. Do not delegate implementation to workers.

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

- Before ANY `git commit`, MUST read `C:\Users\Kira9\.agents\skills\caveman-commit\SKILL.md` and write the message per its rules. No exceptions.
- This applies to subagents too. They run with `--no-skills`, so read the SKILL.md by path.
- The `pi-guardrails` extension blocks `git commit` until that file has been read in the session.
