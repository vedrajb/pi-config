# Pi custom commands

`agent-shortcuts.ts` registers parent workflow commands. Delegation is provided
by `pi-subagents`; these commands do not switch primary agents or start children.

| Command | Behavior |
| --- | --- |
| `/plan` | Read-only parent tools, planning instructions, high thinking. Delegate only to scout, plan, or oracle. |
| `/architect` | Complex orchestration instructions, normal tools, high thinking. |
| `/none` | Normal parent implementation; restore tools and thinking from before the workflow. |

**Ctrl+Shift+Right** cycles normal → plan → architect → normal using these same commands.
**Ctrl+Shift+Left** cycles in reverse: normal → architect → plan → normal.
Wait for the current turn to finish before cycling. After changing this extension,
run `/reload` or restart Pi to register the shortcut; reinstalling is unnecessary.

Normal work uses only scouts for discovery unless the user explicitly requests
another specialist or the complex workflow. The parent implements directly.
Architect mode uses plan → scout/oracle and worker → reviewer when useful.
Delegation restrictions are instructions; there is no parent agent allowlist extension.

Workflow state follows the session branch and survives resume, reload, and tree
navigation. Fresh sessions start in normal mode. The parent model is unchanged.
Background children do not register these commands or inherit parent mode state.

Plan mode disables shell, edit, write, and other unrecognized parent tools, and
blocks their invocation if another extension reactivates them. Child planning
roles must obey their no-edit instructions, including when using inspection shells.
Mode changes do not override unrelated guardrails or authorize edits by themselves.

To install the package globally from the workspace root:

```powershell
pi install .\pi-custom-commands
```

Pi loads the package from this workspace path without copying it. Keep the
package directory here and run `/reload` or restart Pi after installing or
changing it.

To run its tests:

```powershell
npm test --prefix .\pi-custom-commands
```
