# Agent Execution Guardrails (Windows)

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

