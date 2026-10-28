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
and restores when reloading, resuming, or navigating the session tree. When a
profile is selected, the same row also shows it: `Workflow: normal | Profile: codex`.

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

## Model profiles

Profiles select models independently of the normal/plan/architect workflow:

```text
/profile                 Show last applied profile, current model and saved mappings
/profile list            List profile names
/profile codex           Apply the codex profile
/profile claude          Apply the claude profile
```

**Ctrl+Shift+Up** cycles profiles forward; **Ctrl+Shift+Down** cycles backward.
The cycle includes built-ins followed by custom profiles in configuration order,
wraps around, and routes through `/profile` with the same validation and reload.
Without a selected profile, Up starts at the first and Down at the last. Use the
shortcuts while idle; during an active turn they show a reminder without switching.
They dispatch the existing profile command rather than starting a model turn.
Run `/reload` after updating the extension to register these keys. On platforms
where these keys overlap fullscreen transcript navigation, keybinding conflicts
may need to be resolved; Windows/WSL normally use Ctrl+Up/Down for that navigation.

| Target | codex | claude |
| --- | --- | --- |
| Parent selected/default | openai / sol | anthropic / sonnet |
| Scout | openai / luna | anthropic / haiku |
| Worker | openai / terra | anthropic / sonnet |
| Reviewer | anthropic / opus | openai / sol |

Selectors match exact providers and delimited family tokens in model IDs, not
version numbers. `openai` never silently selects `openai-codex`. Models come from
Pi's current `/scoped-models` list; an empty scope means all available models,
matching Pi's unscoped behavior. A single match is selected automatically. Multiple
matches open a chooser with full IDs; the same selector is chosen once per switch.
Missing matches, missing credentials, or cancellation leave settings unchanged.
Ambiguous selections require an interactive/RPC UI; no highest-version guessing.

Definitions live in global `<agent-dir>/settings.json` (`~/.pi/agent` by default,
or `PI_CODING_AGENT_DIR`). Built-ins also work before installing their definitions.
To add or replace a profile, edit the `modelProfiles.profiles` object:

```json
{
  "modelProfiles": {
    "profiles": {
      "custom": {
        "model": { "provider": "openai", "family": "sol" },
        "agents": {
          "scout": { "provider": "anthropic", "family": "haiku" },
          "worker": { "provider": "openai", "family": "terra" },
          "reviewer": { "provider": "anthropic", "family": "opus" }
        }
      }
    }
  }
}
```

Each profile requires `model` and selectors for scout, worker, and reviewer;
additional agent roles may be included. Reapplying a profile resolves its selectors
against the current model scope, allowing versions to change without editing the
profile.

### First-install default

When `settings.json` does not exist **at the start of installation**, the installer
queues Claude as `modelProfiles.pendingDefault: "claude"`. Pi applies it on the
first idle interactive/RPC startup after pi-subagents is ready, through the same
`/profile claude` command and scoped-model, credential, and conflict checks. Missing
models/authentication or cancelled ambiguity leave it pending, not falsely active;
authenticate and run `/profile claude`, or reload to retry. Headless sessions do not
auto-switch. `/profile` shows the pending default separately from the active profile.

Existing settings files, even empty ones or ones with no selected profile, never
receive this automatic default. Reinstalling preserves any selected profile and
model defaults. Successful selection of any profile clears the pending request,
so choosing Codex cannot be undone by a later automatic Claude switch.

Applying a profile persists concrete `defaultProvider`, `defaultModel`, agent
`subagents.agentOverrides.<role>.model` values, and `modelProfiles.active`. Other
settings, thinking levels, and override fields are retained. The current parent
model changes too. Pi reloads automatically to refresh subagent configuration;
a one-time session receipt restores the current effort after reload. If the new
model cannot preserve that effort, selection is rejected before settings change.
`/normal` subsequently restores the newly saved profile parent default.

Switching waits for the parent to be idle and requires no active/queued subagents
in the current session. The installed pi-subagents v1 status RPC must respond;
missing/unverifiable status fails closed. Other Pi sessions are not reconfigured
live and should be reloaded separately when idle. Project model/default overrides,
disabled target agents, and provider-scoped model conflicts must be resolved first.
Enforced subagent model scopes are checked before saving. Per-run model overrides
still take precedence; profiles do not change delegation rules or force launches.

Settings writes use a same-directory temporary file and atomic replacement,
retain a unique exact backup in `<agent-dir>/profile-backups/`, and detect edits
made during selection before replacing settings. Avoid simultaneous settings edits
from other Pi instances. Pre-reload failures restore the previous model/effort
and, if already written, settings (unless a concurrent edit prevents safe rollback).
A reload/activation failure is reported explicitly with the backup path; run
`/reload` to retry a pending activation or restore the backup and reload. Do not
restore a backup blindly over settings changed afterward. Runtime profile selection
does not rewrite this repository's `.pi.user/settings.json` template.

The installer adds missing built-in definitions while preserving user profiles,
active selection, defaults, and unrelated settings in existing installations. Agent Markdown files are not
rewritten by the profile command.

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
