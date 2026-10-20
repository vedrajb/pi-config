# Pi custom commands

`agent-shortcuts.ts` registers parent workflow commands. Delegation is provided
by `pi-subagents`; these commands do not switch primary agents or start children.

| Command | Behavior |
| --- | --- |
| `/plan` | Read-only parent tools, planning instructions, high thinking. Delegate only to scout, plan, or oracle. |
| `/architect` | Complex orchestration instructions, normal tools, high thinking. |
| `/normal` | Parent implementation with scout-only delegation; restore prior tools and configured default model/effort. |

The current workflow is always shown above the input as `Workflow: normal`,
`Workflow: plan`, or `Workflow: architect`. The label updates when switching modes
and restores when reloading, resuming, or navigating the session tree.

**Ctrl+Shift+Right** cycles normal → plan → architect → normal using these same commands.
**Ctrl+Shift+Left** cycles in reverse: normal → architect → plan → normal.
Wait for the current turn to finish before cycling. After changing this extension,
run `/reload` or restart Pi to register the shortcut; reinstalling is unnecessary.

Normal work delegates only repository investigation to scouts and implements in
the parent. Switch to plan or architect before delegating to other specialists.
Architect mode uses plan → scout/oracle and worker → reviewer when useful.
The guardrails extension blocks non-scout delegation and executable workflow scripts
in normal mode. Plan and architect keep their specialist workflows.

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

When the user explicitly approves implementing a discussed plan, the agent calls
`start_implementation` to leave plan mode automatically, restore the configured
default model/effort, and implement directly in the parent. Approval is interpreted by the agent
in context, rather than by matching words in every message. Questions, quotations,
and permission to keep planning do not authorize the handoff. Architect mode is
selected only by the user; implementation approval leaves an active architect
workflow unchanged.

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
