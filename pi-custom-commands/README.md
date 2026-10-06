# Pi custom commands

`agent-shortcuts.ts` registers slash commands for `/plan`, `/architect`,
and `/none`. It also registers a `shift+tab` shortcut that cycles
the active global Pi agent: plan → architect → review.

`shift+tab` requires moving Pi's thinking-level cycle off that key in
`~/.pi/agent/keybindings.json` (it is set to `ctrl+shift+t`).

The global agent definitions are in `~/.pi/agent/agents/`. `plan` and `review`
must use `mode: all` so they can be selected as active agents. `architect` is a
primary agent. `worker`, `scout`, and `oracle` are subagent-only
and are not part of the cycle.

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
