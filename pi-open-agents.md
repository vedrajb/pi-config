# Pi agents

Use [`pi-open-agents`](https://pi.dev/packages/pi-open-agents) to switch the active
Pi agent or delegate a focused task to a subagent. Each agent has its own model,
thinking level, prompt, and tool list.

## Install and locate the agents

Install the extension globally if it is not already listed in Pi's global
`settings.json`:

```powershell
pi install npm:pi-open-agents
```

The active definitions are in the global `~/.pi/agent/agents/` directory (on
this Windows setup, `C:\Users\Kira9\.pi\agent\agents\`). A project can override
one by adding a definition with the same name under its `.pi/agents/` directory.

| Agent | Mode | Model | Thinking | Purpose |
| --- | --- | --- | --- | --- |
| [`orchestrator`](../../../.pi/agent/agents/orchestrator.md) | Primary | `openai-codex/gpt-5.6-luna` | Max | Delegate as needed and give one unified response. |
| [`planner`](../../../.pi/agent/agents/planner.md) | All | `amazon-bedrock/us.openai.gpt-5.6-terra` | High | Inspect code and plan a change without editing. |
| [`scout`](../../../.pi/agent/agents/scout.md) | Subagent | `amazon-bedrock/us.openai.gpt-5.6-luna` | Medium | Find relevant code and return file and line evidence. |
| [`implementer`](../../../.pi/agent/agents/implementer.md) | All | `openai-codex/gpt-5.6-luna` | Max | Make focused edits and run relevant tests. |
| [`reviewer`](../../../.pi/agent/agents/reviewer.md) | All | `amazon-bedrock/us.openai.gpt-5.6-sol` | High | Check a change for concrete defects without editing. |

The `orchestrator`, `planner`, `scout`, and `reviewer` tool lists are read-only.
The `implementer` can also use Pi's Windows `powershell`, `edit`, and `write`
tools. `mode: all` lets `planner`, `implementer`, and `reviewer` run either as
the active agent or as a delegated subagent. The prompts in the linked global
files include restrictions on variable renaming, unrelated refactors, and
committed tests.

## Select an agent automatically

```json
"defaultAgent": "plan"
```

Restart Pi after changing the setting. The selected agent supplies its own
model (`openai-codex/gpt-5.6-luna`) and thinking level (`max`), overriding
the global model and thinking defaults while it is active. Use
`pi --agent planner` to select a different agent for one launch. When resuming
a session, Pi restores that session's last selected agent before considering
`defaultAgent`.

Only one primary agent is selected at startup. The orchestrator can call
`planner`, `scout`, `implementer`, and `reviewer` when their specialties help.
It checks their results and returns one synthesized answer to the user.

## Use them in Pi

Start or restart `pi` after changing agent files, then run:

```text
/agents
/agent orchestrator
/agent planner
/agent implementer
/agent reviewer
```

`/agents` lists the available definitions. `/agent <name>` changes the active
agent in the current session. Give the orchestrator the full task; it decides
whether to delegate bounded parts, such as code search to `scout` or change
review to `reviewer`. A subagent runs in a separate Pi process and returns its
findings to the orchestrator, which gives one unified response.

Use `/model` to verify that the configured model IDs are available and
`/thinking` to inspect supported levels. If your Bedrock region or model ID
differs, update the `model:` field in the global agent definition.

The [preset extension](ext-preset.md) is separate: presets change the current
session's configuration, while these definitions also provide delegated
subagents.
