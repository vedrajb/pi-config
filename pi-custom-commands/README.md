# Pi custom commands

`agent-shortcuts.ts` registers parent workflow commands. Delegation is provided
by `pi-subagents`; these commands do not switch primary agents or start children.

| Command | Behavior |
| --- | --- |
| `/plan` | Read-only parent tools, planning instructions, high thinking. Delegate only to scout, plan, or oracle. |
| `/architect` | Complex orchestration instructions, normal tools, high thinking. |
| `/none` | Normal coordination with worker implementation; restore prior tools and configured default model/effort. |

The current workflow is always shown above the input as `Workflow: normal`,
`Workflow: plan`, or `Workflow: architect`. The label updates when switching modes
and restores when reloading, resuming, or navigating the session tree.

**Ctrl+Shift+Right** cycles normal → plan → architect → normal using these same commands.
**Ctrl+Shift+Left** cycles in reverse: normal → architect → plan → normal.
Wait for the current turn to finish before cycling. After changing this extension,
run `/reload` or restart Pi to register the shortcut; reinstalling is unnecessary.

Normal work uses scouts for discovery and workers for implementation. The parent
coordinates and checks results. Other specialists require an explicit user request
or the complex workflow; a worker may use reviewer for independent review.
Architect mode uses plan → scout/oracle and worker → reviewer when useful.
Delegation restrictions are instructions; there is no parent agent allowlist extension.

Workflow state follows the session branch and survives resume, reload, and tree
navigation. Fresh sessions start in normal mode. Returning to normal selects the
effective settings' `defaultProvider`, `defaultModel`, and `defaultThinkingLevel`.
Plan and architect use high thinking without changing the parent model. If no
default effort is configured, normal falls back to the captured effort. If no
default model is configured, the current model stays selected. An unavailable or
unauthenticated configured model reports an error instead of completing the switch.
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
